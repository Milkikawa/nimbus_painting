package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"

	"nimbus-painting/internal/config"
	"nimbus-painting/internal/model"
)

type Store struct {
	db     *sql.DB
	driver string
	cfg    config.Config
}

func Open(cfg config.Config) (*Store, error) {
	driver := strings.ToLower(cfg.DBDriver)
	switch driver {
	case "sqlite", "sqlite3", "":
		if err := os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755); err != nil {
			return nil, err
		}
		db, err := sql.Open("sqlite3", cfg.SQLitePath+"?_busy_timeout=5000&_foreign_keys=on")
		if err != nil {
			return nil, err
		}
		return &Store{db: db, driver: "sqlite", cfg: cfg}, nil
	case "mariadb", "mysql":
		if cfg.MariaDBDSN == "" {
			return nil, errors.New("MARIADB_DSN is required when DB_DRIVER=mariadb")
		}
		db, err := sql.Open("mysql", cfg.MariaDBDSN)
		if err != nil {
			return nil, err
		}
		return &Store{db: db, driver: "mariadb", cfg: cfg}, nil
	case "postgres", "postgresql", "pg":
		return nil, errors.New("postgres driver is reserved but not implemented")
	default:
		return nil, fmt.Errorf("unsupported DB_DRIVER: %s", cfg.DBDriver)
	}
}

func (s *Store) Close() error   { return s.db.Close() }
func (s *Store) Driver() string { return s.driver }

func (s *Store) Migrate(ctx context.Context) error {
	if s.driver == "sqlite" {
		for _, pragma := range []string{"PRAGMA journal_mode=WAL", "PRAGMA synchronous=NORMAL", "PRAGMA busy_timeout=5000"} {
			if _, err := s.db.ExecContext(ctx, pragma); err != nil {
				return err
			}
		}
	}
	stmts := s.schema()
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return s.seedDefaults(ctx, s.cfg)
}

func (s *Store) schema() []string {
	textPK := "TEXT PRIMARY KEY"
	text := "TEXT"
	integer := "INTEGER"
	real := "REAL"
	if s.driver == "mariadb" {
		textPK = "VARCHAR(64) PRIMARY KEY"
		text = "TEXT"
		integer = "BIGINT"
		real = "DOUBLE"
	}
	return []string{
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS settings (key_name %s, value_text %s NOT NULL, updated_at %s NOT NULL)`, textPK, text, text),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS prompt_groups (id %s, name %s NOT NULL, type %s NOT NULL, content %s NOT NULL, remark %s NOT NULL, created_at %s NOT NULL, updated_at %s NOT NULL)`, textPK, text, text, text, text, text, text),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS request_logs (id %s, created_at %s NOT NULL, model %s NOT NULL, model_index %s NOT NULL, raw_prompt %s NOT NULL, final_prompt %s NOT NULL, negative_prompt %s NOT NULL, width %s NOT NULL, height %s NOT NULL, steps %s NOT NULL, cfg %s NOT NULL, seed %s NOT NULL, success %s NOT NULL, error_message %s NOT NULL, upstream_status %s NOT NULL, image_record_id %s NOT NULL)`, textPK, text, text, integer, text, text, text, integer, integer, integer, real, integer, integer, text, integer, text),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS image_records (id %s, created_at %s NOT NULL, upstream_image_url %s NOT NULL, local_path %s NOT NULL, public_url %s NOT NULL, filename %s NOT NULL, model_index %s NOT NULL, seed %s NOT NULL, width %s NOT NULL, height %s NOT NULL, prompt %s NOT NULL, negative_prompt %s NOT NULL, deleted_at %s NOT NULL DEFAULT '')`, textPK, text, text, text, text, text, integer, integer, integer, integer, text, text, text),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS admin_sessions (id %s, expires_at %s NOT NULL)`, textPK, text),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS audit_logs (id %s, created_at %s NOT NULL, action %s NOT NULL, message %s NOT NULL)`, textPK, text, text, text),
	}
}

func (s *Store) seedDefaults(ctx context.Context, cfg config.Config) error {
	defaults := map[string]string{
		"default_model_index":     "4",
		"default_width":           "832",
		"default_height":          "1216",
		"default_steps":           "20",
		"default_cfg":             "7",
		"min_dimension":           "64",
		"max_dimension":           "2048",
		"request_timeout_seconds": "120",
		"image_save_dir":          "images",
	}
	if cfg.UpstreamEndpoint != "" {
		defaults["upstream_endpoint"] = cfg.UpstreamEndpoint
	}
	for key, value := range defaults {
		exists, err := s.SettingExists(ctx, key)
		if err != nil {
			return err
		}
		if !exists {
			if err := s.SetSetting(ctx, key, value); err != nil {
				return err
			}
		}
	}
	return s.seedPromptGroups(ctx)
}

func (s *Store) seedPromptGroups(ctx context.Context) error {
	count := 0
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM prompt_groups`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := nowText()
	groups := []model.PromptGroup{
		{ID: NewID("pg"), Name: "默认正面质量", Type: "positive", Content: "masterpiece, best quality", Remark: "默认后插正面质量提示词"},
		{ID: NewID("pg"), Name: "默认负面质量", Type: "negative", Content: "lowres, bad anatomy, bad hands, blurry", Remark: "默认负面质量提示词"},
	}
	for _, group := range groups {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO prompt_groups (id,name,type,content,remark,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, group.ID, group.Name, group.Type, group.Content, group.Remark, now, now); err != nil {
			return err
		}
		key := "selected_positive_group_id"
		if group.Type == "negative" {
			key = "selected_negative_group_id"
		}
		if err := s.SetSetting(ctx, key, group.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) SettingExists(ctx context.Context, key string) (bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value_text FROM settings WHERE key_name=?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	if s.driver == "mariadb" {
		_, err := s.db.ExecContext(ctx, `INSERT INTO settings (key_name,value_text,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), updated_at=VALUES(updated_at)`, key, value, nowText())
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings (key_name,value_text,updated_at) VALUES (?,?,?) ON CONFLICT(key_name) DO UPDATE SET value_text=excluded.value_text, updated_at=excluded.updated_at`, key, value, nowText())
	return err
}

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value_text FROM settings WHERE key_name=?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s *Store) GetSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key_name,value_text FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := map[string]string{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		items[key] = value
	}
	return items, rows.Err()
}

func (s *Store) ListPromptGroups(ctx context.Context) ([]model.PromptGroup, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,type,content,remark,created_at,updated_at FROM prompt_groups ORDER BY type,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []model.PromptGroup
	for rows.Next() {
		var g model.PromptGroup
		var created, updated string
		if err := rows.Scan(&g.ID, &g.Name, &g.Type, &g.Content, &g.Remark, &created, &updated); err != nil {
			return nil, err
		}
		g.CreatedAt = parseTime(created)
		g.UpdatedAt = parseTime(updated)
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func (s *Store) GetPromptGroup(ctx context.Context, id string) (model.PromptGroup, bool, error) {
	var g model.PromptGroup
	var created, updated string
	err := s.db.QueryRowContext(ctx, `SELECT id,name,type,content,remark,created_at,updated_at FROM prompt_groups WHERE id=?`, id).Scan(&g.ID, &g.Name, &g.Type, &g.Content, &g.Remark, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return g, false, nil
	}
	if err != nil {
		return g, false, err
	}
	g.CreatedAt = parseTime(created)
	g.UpdatedAt = parseTime(updated)
	return g, true, nil
}

func (s *Store) SavePromptGroup(ctx context.Context, g model.PromptGroup) error {
	now := nowText()
	if g.ID == "" {
		g.ID = NewID("pg")
		_, err := s.db.ExecContext(ctx, `INSERT INTO prompt_groups (id,name,type,content,remark,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, g.ID, g.Name, g.Type, g.Content, g.Remark, now, now)
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE prompt_groups SET name=?, type=?, content=?, remark=?, updated_at=? WHERE id=?`, g.Name, g.Type, g.Content, g.Remark, now, g.ID)
	return err
}

func (s *Store) DeletePromptGroup(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM prompt_groups WHERE id=?`, id)
	return err
}

func (s *Store) InsertRequestLog(ctx context.Context, log model.RequestLog) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO request_logs (id,created_at,model,model_index,raw_prompt,final_prompt,negative_prompt,width,height,steps,cfg,seed,success,error_message,upstream_status,image_record_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, log.ID, log.CreatedAt.Format(time.RFC3339), log.Model, log.ModelIndex, log.RawPrompt, log.FinalPrompt, log.NegativePrompt, log.Width, log.Height, log.Steps, log.CFG, log.Seed, boolInt(log.Success), log.ErrorMessage, log.UpstreamStatus, log.ImageRecordID)
	return err
}

func (s *Store) ListRequestLogs(ctx context.Context, limit int) ([]model.RequestLog, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,created_at,model,model_index,raw_prompt,final_prompt,negative_prompt,width,height,steps,cfg,seed,success,error_message,upstream_status,image_record_id FROM request_logs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []model.RequestLog
	for rows.Next() {
		var item model.RequestLog
		var created string
		var success int
		if err := rows.Scan(&item.ID, &created, &item.Model, &item.ModelIndex, &item.RawPrompt, &item.FinalPrompt, &item.NegativePrompt, &item.Width, &item.Height, &item.Steps, &item.CFG, &item.Seed, &success, &item.ErrorMessage, &item.UpstreamStatus, &item.ImageRecordID); err != nil {
			return nil, err
		}
		item.CreatedAt = parseTime(created)
		item.Success = success != 0
		logs = append(logs, item)
	}
	return logs, rows.Err()
}

func (s *Store) InsertImageRecord(ctx context.Context, image model.ImageRecord) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO image_records (id,created_at,upstream_image_url,local_path,public_url,filename,model_index,seed,width,height,prompt,negative_prompt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, image.ID, image.CreatedAt.Format(time.RFC3339), image.UpstreamImageURL, image.LocalPath, image.PublicURL, image.Filename, image.ModelIndex, image.Seed, image.Width, image.Height, image.Prompt, image.NegativePrompt)
	return err
}

func (s *Store) ListImages(ctx context.Context, limit int) ([]model.ImageRecord, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,created_at,upstream_image_url,local_path,public_url,filename,model_index,seed,width,height,prompt,negative_prompt FROM image_records WHERE deleted_at='' ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var images []model.ImageRecord
	for rows.Next() {
		var image model.ImageRecord
		var created string
		if err := rows.Scan(&image.ID, &created, &image.UpstreamImageURL, &image.LocalPath, &image.PublicURL, &image.Filename, &image.ModelIndex, &image.Seed, &image.Width, &image.Height, &image.Prompt, &image.NegativePrompt); err != nil {
			return nil, err
		}
		image.CreatedAt = parseTime(created)
		images = append(images, image)
	}
	return images, rows.Err()
}

func (s *Store) MarkImageDeleted(ctx context.Context, id string) (string, error) {
	var path string
	if err := s.db.QueryRowContext(ctx, `SELECT local_path FROM image_records WHERE id=?`, id).Scan(&path); err != nil {
		return "", err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE image_records SET deleted_at=? WHERE id=?`, nowText(), id)
	return path, err
}

func (s *Store) SaveSession(ctx context.Context, id string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO admin_sessions (id,expires_at) VALUES (?,?)`, id, expires.Format(time.RFC3339))
	return err
}

func (s *Store) ValidSession(ctx context.Context, id string) (bool, error) {
	var expires string
	err := s.db.QueryRowContext(ctx, `SELECT expires_at FROM admin_sessions WHERE id=?`, id).Scan(&expires)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return parseTime(expires).After(time.Now()), nil
}

func (s *Store) DeleteSession(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM admin_sessions WHERE id=?`, id)
	return err
}

func nowText() string                  { return time.Now().Format(time.RFC3339) }
func parseTime(value string) time.Time { t, _ := time.Parse(time.RFC3339, value); return t }
func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
