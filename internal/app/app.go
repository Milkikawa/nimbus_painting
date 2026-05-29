package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/bcrypt"

	"nimbus-painting/internal/config"
	imageio "nimbus-painting/internal/image"
	"nimbus-painting/internal/model"
	"nimbus-painting/internal/parser"
	"nimbus-painting/internal/store"
	"nimbus-painting/internal/upstream"
)

type App struct {
	cfg            config.Config
	store          *store.Store
	start          time.Time
	activeRequests atomic.Int64
}

func New(cfg config.Config, db *store.Store) *App {
	return &App{cfg: cfg, store: db, start: time.Now()}
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /v1/models", a.models)
	mux.HandleFunc("POST /v1/chat/completions", a.chatCompletions)
	mux.HandleFunc("GET /dashboard", a.dashboard)
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join("web", "assets")))))
	mux.HandleFunc("POST /admin/init", a.adminInit)
	mux.HandleFunc("POST /admin/login", a.adminLogin)
	mux.HandleFunc("POST /admin/logout", a.adminLogout)
	mux.HandleFunc("GET /admin/api/status", a.adminStatus)
	mux.HandleFunc("GET /admin/api/settings", a.requireAdmin(a.getSettings))
	mux.HandleFunc("PUT /admin/api/settings", a.requireAdmin(a.updateSettings))
	mux.HandleFunc("GET /admin/api/monitoring/summary", a.requireAdmin(a.monitoringSummary))
	mux.HandleFunc("GET /admin/api/prompt-groups", a.requireAdmin(a.listPromptGroups))
	mux.HandleFunc("POST /admin/api/prompt-groups", a.requireAdmin(a.savePromptGroup))
	mux.HandleFunc("DELETE /admin/api/prompt-groups/", a.requireAdmin(a.deletePromptGroup))
	mux.HandleFunc("GET /admin/api/logs", a.requireAdmin(a.listLogs))
	mux.HandleFunc("GET /admin/api/images", a.requireAdmin(a.listImages))
	mux.HandleFunc("DELETE /admin/api/images/", a.requireAdmin(a.deleteImage))
	mux.HandleFunc("GET /images/", a.serveImage)
	return secureHeaders(mux)
}

func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	settings, _ := a.store.GetSettings(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "version": "0.2.0", "database": a.store.Driver(),
		"upstream_configured": settings["upstream_endpoint"] != "",
		"uptime_seconds":      int(time.Since(a.start).Seconds()),
	})
}

func (a *App) models(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": []map[string]any{
		{"id": "sd-generate", "object": "model", "created": 0, "owned_by": "image-proxy"},
		{"id": "sd-edit", "object": "model", "created": 0, "owned_by": "image-proxy"},
	}})
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}
type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

func (a *App) chatCompletions(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		openAIError(w, http.StatusBadRequest, "invalid json", "invalid_request_error", "invalid_json")
		return
	}
	content, err := extractPrompt(req.Messages)
	if err != nil {
		openAIError(w, http.StatusBadRequest, "missing prompt", "invalid_request_error", "missing_prompt")
		return
	}
	if req.Model == "sd-edit" {
		openAIError(w, http.StatusBadRequest, "sd-edit is reserved but not implemented yet.", "invalid_request_error", "edit_not_implemented")
		return
	}
	if req.Model != "sd-generate" {
		openAIError(w, http.StatusBadRequest, "invalid model", "invalid_request_error", "invalid_model")
		return
	}
	authorization := r.Header.Get("Authorization")
	if authorization == "" {
		openAIError(w, http.StatusUnauthorized, "authorization missing", "invalid_request_error", "authorization_missing")
		return
	}

	settings, err := a.loadSettings(r.Context())
	if err != nil {
		openAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "settings_load_failed")
		return
	}
	if settings.UpstreamEndpoint == "" {
		openAIError(w, http.StatusBadRequest, "upstream endpoint is not configured", "invalid_request_error", "upstream_endpoint_missing")
		return
	}

	parsed := parser.Parse(content, settings)
	if parsed.ModelIndex == 14 {
		openAIError(w, http.StatusBadRequest, "sd14 is edit-only and cannot be used by sd-generate", "invalid_request_error", "unsupported_model_index")
		return
	}
	if parsed.ModelIndex < 0 || parsed.ModelIndex > 13 {
		openAIError(w, http.StatusBadRequest, "unsupported model index", "invalid_request_error", "unsupported_model_index")
		return
	}
	if parsed.Prompt == "" {
		openAIError(w, http.StatusBadRequest, "missing prompt", "invalid_request_error", "missing_prompt")
		return
	}

	positive, negative := a.selectedPrompts(r.Context(), settings)
	finalPrompt := parser.AppendPositive(parsed.Prompt, positive)
	reqLog := model.RequestLog{ID: store.NewID("req"), CreatedAt: time.Now(), Model: req.Model, ModelIndex: parsed.ModelIndex, RawPrompt: content, FinalPrompt: finalPrompt, NegativePrompt: negative, Width: parsed.Width, Height: parsed.Height, Steps: parsed.Steps, CFG: parsed.CFG, Seed: parsed.Seed, UpstreamEndpoint: settings.UpstreamEndpoint, ImageReturnMode: "upstream_url"}
	a.activeRequests.Add(1)
	defer a.activeRequests.Add(-1)

	upReq := upstream.Request{Prompt: finalPrompt, NegativePrompt: negative, Width: parsed.Width, Height: parsed.Height, Steps: parsed.Steps, CFG: parsed.CFG, ModelIndex: parsed.ModelIndex, Seed: parsed.Seed}
	if body, err := json.Marshal(upReq); err == nil {
		reqLog.UpstreamRequestBody = string(body)
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(settings.RequestTimeout)*time.Second)
	defer cancel()
	upResult, err := upstream.Generate(ctx, settings.UpstreamEndpoint, authorization, time.Duration(settings.RequestTimeout)*time.Second, upReq)
	reqLog.UpstreamStatus = upResult.StatusCode
	reqLog.UpstreamResponseBody = string(upResult.Body)
	if err != nil {
		reqLog.ErrorMessage = err.Error()
		_ = a.store.InsertRequestLog(context.Background(), reqLog)
		openAIError(w, http.StatusBadGateway, err.Error(), "upstream_error", "upstream_request_failed")
		return
	}

	imageURL := upResult.Parsed.Data.ImageURL
	reqLog.UpstreamImageURL = imageURL
	reqLog.UpstreamImageID = stringifyAny(upResult.Parsed.Data.ImageID)
	reqLog.UpstreamModelName = upResult.Parsed.Data.ModelName
	reqLog.PointsUsed = upResult.Parsed.Data.PointsUsed
	reqLog.RemainingPoints = upResult.Parsed.Data.RemainingPoints
	reqLog.DownstreamImageURL = imageURL
	saved, saveErr := imageio.Save(context.Background(), a.effectiveImageDir(settings), a.cfg.PublicBaseURL, imageURL, reqLog)
	if saveErr != nil {
		reqLog.ImageSaveError = saveErr.Error()
		log.Printf("image_save_failed request_id=%s error=%v", reqLog.ID, saveErr)
	} else {
		saved.UpstreamImageID = reqLog.UpstreamImageID
		saved.UpstreamModelName = reqLog.UpstreamModelName
		reqLog.ImageRecordID = saved.ID
		_ = a.store.InsertImageRecord(context.Background(), saved)
	}
	reqLog.Success = true
	_ = a.store.InsertRequestLog(context.Background(), reqLog)

	if req.Stream {
		a.writeStream(w, req.Model, imageURL, reqLog)
		return
	}
	writeJSON(w, http.StatusOK, chatCompletion(req.Model, imageURL, reqLog))
}

func extractPrompt(messages []chatMessage) (string, error) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "user" {
			continue
		}
		switch value := messages[i].Content.(type) {
		case string:
			if strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value), nil
			}
		case []any:
			var parts []string
			for _, item := range value {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				if m["type"] == "text" {
					if text, ok := m["text"].(string); ok {
						parts = append(parts, text)
					}
				}
			}
			if strings.TrimSpace(strings.Join(parts, " ")) != "" {
				return strings.TrimSpace(strings.Join(parts, " ")), nil
			}
		}
	}
	return "", fmt.Errorf("missing prompt")
}

func (a *App) loadSettings(ctx context.Context) (model.Settings, error) {
	items, err := a.store.GetSettings(ctx)
	if err != nil {
		return model.Settings{}, err
	}
	return model.Settings{UpstreamEndpoint: items["upstream_endpoint"], DefaultModel: atoi(items["default_model_index"], 4), DefaultWidth: atoi(items["default_width"], 832), DefaultHeight: atoi(items["default_height"], 1216), DefaultSteps: atoi(items["default_steps"], 20), DefaultCFG: atof(items["default_cfg"], 7), MinDimension: atoi(items["min_dimension"], 64), MaxDimension: atoi(items["max_dimension"], 2048), RequestTimeout: atoi(items["request_timeout_seconds"], 120), PositiveGroupID: items["selected_positive_group_id"], NegativeGroupID: items["selected_negative_group_id"], ImageSaveDir: items["image_save_dir"]}, nil
}

func (a *App) selectedPrompts(ctx context.Context, settings model.Settings) (string, string) {
	positive, negative := "", ""
	if settings.PositiveGroupID != "" {
		if group, ok, _ := a.store.GetPromptGroup(ctx, settings.PositiveGroupID); ok && group.Type == "positive" {
			positive = group.Content
		}
	}
	if settings.NegativeGroupID != "" {
		if group, ok, _ := a.store.GetPromptGroup(ctx, settings.NegativeGroupID); ok && group.Type == "negative" {
			negative = group.Content
		}
	}
	return positive, negative
}

func (a *App) effectiveImageDir(settings model.Settings) string {
	if settings.ImageSaveDir != "" {
		return settings.ImageSaveDir
	}
	return a.cfg.ImageDir
}

func (a *App) serveImage(w http.ResponseWriter, r *http.Request) {
	settings, err := a.loadSettings(r.Context())
	if err != nil {
		http.NotFound(w, r)
		return
	}
	base, err := filepath.Abs(a.effectiveImageDir(settings))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/images/")
	target, err := filepath.Abs(filepath.Join(base, relative))
	if err != nil || !strings.HasPrefix(target, base) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, target)
}

func chatCompletion(modelName, imageURL string, log model.RequestLog) map[string]any {
	content := fmt.Sprintf("![generated image](%s)\n\nImage URL: %s\nSeed: %d\nModel: sd%d", imageURL, imageURL, log.Seed, log.ModelIndex)
	return map[string]any{"id": log.ID, "object": "chat.completion", "created": time.Now().Unix(), "model": modelName, "choices": []map[string]any{{"index": 0, "message": map[string]any{"role": "assistant", "content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
}

func stringifyAny(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func (a *App) writeStream(w http.ResponseWriter, modelName, imageURL string, log model.RequestLog) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	chunk := chatCompletion(modelName, imageURL, log)
	data, _ := json.Marshal(chunk)
	fmt.Fprintf(w, "data: %s\n\n", data)
	fmt.Fprint(w, "data: [DONE]\n\n")
}

func openAIError(w http.ResponseWriter, status int, message, typ, code string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"message": message, "type": typ, "code": code}})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}
func atof(value string, fallback float64) float64 {
	if n, err := strconv.ParseFloat(value, 64); err == nil {
		return n
	}
	return fallback
}

func (a *App) dashboard(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, filepath.Join("web", "dashboard.html"))
}

func (a *App) adminStatus(w http.ResponseWriter, r *http.Request) {
	hash, _ := a.store.GetSetting(r.Context(), "dashboard_password_hash")
	settings, _ := a.store.GetSettings(r.Context())
	authenticated := false
	if cookie, err := r.Cookie("np_session"); err == nil {
		authenticated, _ = a.store.ValidSession(r.Context(), cookie.Value)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"initialized":         hash != "",
		"authenticated":       authenticated,
		"upstream_configured": settings["upstream_endpoint"] != "",
		"version_or_name":     "Nimbus Painting Proxy 0.2.0",
		"uptime_seconds":      int(time.Since(a.start).Seconds()),
	})
}

func (a *App) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("np_session")
		if err != nil {
			openAIError(w, http.StatusUnauthorized, "login required", "auth_error", "login_required")
			return
		}
		valid, err := a.store.ValidSession(r.Context(), cookie.Value)
		if err != nil || !valid {
			openAIError(w, http.StatusUnauthorized, "login required", "auth_error", "login_required")
			return
		}
		next(w, r)
	}
}

func (a *App) adminInit(w http.ResponseWriter, r *http.Request) {
	if hash, _ := a.store.GetSetting(r.Context(), "dashboard_password_hash"); hash != "" {
		openAIError(w, http.StatusBadRequest, "already initialized", "invalid_request_error", "already_initialized")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Password) < 8 {
		openAIError(w, http.StatusBadRequest, "password must be at least 8 chars", "invalid_request_error", "weak_password")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	_ = a.store.SetSetting(r.Context(), "dashboard_password_hash", string(hash))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) adminLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	hash, _ := a.store.GetSetting(r.Context(), "dashboard_password_hash")
	if hash == "" {
		openAIError(w, http.StatusBadRequest, "not initialized", "auth_error", "not_initialized")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		openAIError(w, http.StatusUnauthorized, "invalid password", "auth_error", "invalid_password")
		return
	}
	sid := store.NewID("sess")
	_ = a.store.SaveSession(r.Context(), sid, time.Now().Add(a.cfg.SessionTTL))
	http.SetCookie(w, &http.Cookie{Name: "np_session", Value: sid, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(a.cfg.SessionTTL)})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) adminLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("np_session"); err == nil {
		_ = a.store.DeleteSession(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "np_session", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *App) getSettings(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.GetSettings(r.Context())
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "settings_load_failed")
		return
	}
	writeJSON(w, 200, items)
}
func (a *App) updateSettings(w http.ResponseWriter, r *http.Request) {
	var items map[string]string
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		openAIError(w, 400, "invalid json", "invalid_request_error", "invalid_json")
		return
	}
	for k, v := range items {
		if k == "dashboard_password_hash" {
			continue
		}
		_ = a.store.SetSetting(r.Context(), k, v)
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (a *App) listPromptGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := a.store.ListPromptGroups(r.Context())
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "prompt_groups_failed")
		return
	}
	writeJSON(w, 200, groups)
}
func (a *App) savePromptGroup(w http.ResponseWriter, r *http.Request) {
	var g model.PromptGroup
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		openAIError(w, 400, "invalid json", "invalid_request_error", "invalid_json")
		return
	}
	if g.Type != "positive" && g.Type != "negative" {
		openAIError(w, 400, "invalid group type", "invalid_request_error", "invalid_group_type")
		return
	}
	if err := a.store.SavePromptGroup(r.Context(), g); err != nil {
		openAIError(w, 500, err.Error(), "server_error", "prompt_group_save_failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (a *App) deletePromptGroup(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/admin/api/prompt-groups/")
	if err := a.store.DeletePromptGroup(r.Context(), id); err != nil {
		openAIError(w, 500, err.Error(), "server_error", "prompt_group_delete_failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (a *App) listLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := a.store.ListRequestLogs(r.Context(), 100)
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "logs_failed")
		return
	}
	writeJSON(w, 200, logs)
}
func (a *App) listImages(w http.ResponseWriter, r *http.Request) {
	images, err := a.store.ListImages(r.Context(), 100)
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "images_failed")
		return
	}
	writeJSON(w, 200, images)
}

func (a *App) monitoringSummary(w http.ResponseWriter, r *http.Request) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)

	imageStats, err := a.store.ImageStats(r.Context())
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "image_stats_failed")
		return
	}
	taskStats, err := a.store.TaskStats(r.Context())
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "task_stats_failed")
		return
	}

	// 监测面板只做当前快照：不启动后台采样，不写入数据库，避免额外资源开销。
	successRate := 0.0
	if taskStats.Total > 0 {
		successRate = float64(taskStats.Success) / float64(taskStats.Total)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"process": map[string]any{
			"uptime_seconds":     int(time.Since(a.start).Seconds()),
			"goroutines":         runtime.NumGoroutine(),
			"memory_alloc_bytes": memory.Alloc,
			"memory_total_bytes": memory.TotalAlloc,
			"gc_count":           memory.NumGC,
			"memory_sys_bytes":   memory.Sys,
		},
		"images": map[string]any{
			"total":         imageStats.Total,
			"active":        imageStats.Active,
			"deleted":       imageStats.Deleted,
			"latest_image":  imageStats.LatestImage,
			"storage_bytes": imageStats.StorageBytes,
		},
		"tasks": map[string]any{
			"total":          taskStats.Total,
			"success":        taskStats.Success,
			"failed":         taskStats.Failed,
			"running":        a.activeRequests.Load(),
			"latest_request": taskStats.LatestRequest,
		},
		"success_rate": map[string]any{
			"value":      successRate,
			"percentage": successRate * 100,
		},
	})
}

func (a *App) deleteImage(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/admin/api/images/")
	path, err := a.store.MarkImageDeleted(r.Context(), id)
	if err != nil {
		openAIError(w, 500, err.Error(), "server_error", "image_delete_failed")
		return
	}
	if abs, err := filepath.Abs(path); err == nil {
		settings, _ := a.loadSettings(r.Context())
		base, _ := filepath.Abs(a.effectiveImageDir(settings))
		if strings.HasPrefix(abs, base) {
			_ = os.Remove(abs)
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
