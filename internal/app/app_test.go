package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nimbus-painting/internal/config"
	"nimbus-painting/internal/model"
	"nimbus-painting/internal/store"
)

func newTestApp(t *testing.T) (*App, http.Handler) {
	t.Helper()
	cfg := config.Config{
		DBDriver:       "sqlite",
		SQLitePath:     filepath.Join(t.TempDir(), "app.db"),
		ImageDir:       filepath.Join(t.TempDir(), "images"),
		SessionTTL:     time.Hour,
		DefaultTimeout: time.Minute,
	}
	db, err := store.Open(cfg)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Migrate(context.Background()); err != nil {
		if strings.Contains(err.Error(), "go-sqlite3 requires cgo") {
			t.Skip("sqlite driver requires CGO in this environment")
		}
		t.Fatalf("migrate store: %v", err)
	}
	application := New(cfg, db)
	return application, application.Routes()
}

func TestAdminStatusLifecycle(t *testing.T) {
	_, handler := newTestApp(t)

	var status map[string]any
	requestJSON(t, handler, http.MethodGet, "/admin/api/status", nil, http.StatusOK, &status, nil)
	if status["initialized"].(bool) || status["authenticated"].(bool) {
		t.Fatalf("new app should not be initialized or authenticated: %#v", status)
	}

	requestJSON(t, handler, http.MethodPost, "/admin/init", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)
	requestJSON(t, handler, http.MethodGet, "/admin/api/status", nil, http.StatusOK, &status, nil)
	if !status["initialized"].(bool) || status["authenticated"].(bool) {
		t.Fatalf("initialized app should still require login: %#v", status)
	}

	cookies := requestJSON(t, handler, http.MethodPost, "/admin/login", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)
	requestJSON(t, handler, http.MethodGet, "/admin/api/status", nil, http.StatusOK, &status, cookies)
	if !status["initialized"].(bool) || !status["authenticated"].(bool) {
		t.Fatalf("logged in app should be authenticated: %#v", status)
	}
}

func TestMonitoringSummaryAuthAndStats(t *testing.T) {
	application, handler := newTestApp(t)
	requestJSON(t, handler, http.MethodGet, "/admin/api/monitoring/summary", nil, http.StatusUnauthorized, nil, nil)

	requestJSON(t, handler, http.MethodPost, "/admin/init", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)
	cookies := requestJSON(t, handler, http.MethodPost, "/admin/login", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)

	now := time.Now().UTC()
	insertLog(t, application, "log_success", true, now.Add(-2*time.Minute))
	insertLog(t, application, "log_failed", false, now.Add(-time.Minute))
	writeImageFile(t, application.cfg.ImageDir, "img_active.png", 2048)
	writeImageFile(t, application.cfg.ImageDir, "img_deleted.png", 4096)
	insertImage(t, application, "img_active", now.Add(-2*time.Minute))
	insertImage(t, application, "img_deleted", now.Add(-time.Minute))
	if _, err := application.store.MarkImageDeleted(context.Background(), "img_deleted"); err != nil {
		t.Fatalf("mark image deleted: %v", err)
	}

	var summary map[string]any
	requestJSON(t, handler, http.MethodGet, "/admin/api/monitoring/summary", nil, http.StatusOK, &summary, cookies)
	images := summary["images"].(map[string]any)
	tasks := summary["tasks"].(map[string]any)
	successRate := summary["success_rate"].(map[string]any)
	if images["total"].(float64) != 2 || images["active"].(float64) != 1 || images["deleted"].(float64) != 1 {
		t.Fatalf("unexpected image stats: %#v", images)
	}
	if tasks["total"].(float64) != 2 || tasks["success"].(float64) != 1 || tasks["failed"].(float64) != 1 {
		t.Fatalf("unexpected task stats: %#v", tasks)
	}
	if images["storage_bytes"].(float64) != 2048 {
		t.Fatalf("unexpected image storage bytes: %#v", images)
	}
	if successRate["percentage"].(float64) != 50 {
		t.Fatalf("unexpected success rate: %#v", successRate)
	}
}

func TestMonitoringSummaryEmptyStats(t *testing.T) {
	_, handler := newTestApp(t)
	requestJSON(t, handler, http.MethodPost, "/admin/init", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)
	cookies := requestJSON(t, handler, http.MethodPost, "/admin/login", map[string]string{"password": "password123"}, http.StatusOK, nil, nil)

	var summary map[string]any
	requestJSON(t, handler, http.MethodGet, "/admin/api/monitoring/summary", nil, http.StatusOK, &summary, cookies)
	images := summary["images"].(map[string]any)
	tasks := summary["tasks"].(map[string]any)
	if images["total"].(float64) != 0 || tasks["total"].(float64) != 0 {
		t.Fatalf("empty database should report zero stats: images=%#v tasks=%#v", images, tasks)
	}
}

func TestChatCompletionReturnsUpstreamImageURLAndLogsMetadata(t *testing.T) {
	application, handler := newTestApp(t)
	var imageURL string
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/generate":
			if r.Header.Get("Authorization") != "Bearer test-key" {
				t.Fatalf("authorization not forwarded: %q", r.Header.Get("Authorization"))
			}
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode upstream request: %v", err)
			}
			if payload["model_index"].(float64) == float64(model.ZImageModelIndex) {
				if payload["steps"].(float64) != 8 {
					t.Fatalf("Z-Image must force 8 steps, got %#v", payload["steps"])
				}
				if strings.Contains(payload["prompt"].(string), "masterpiece") {
					t.Fatalf("Z-Image prompt should not append selected quality prompt: %q", payload["prompt"])
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"success": true,
				"message": "图像生成成功",
				"data": map[string]any{
					"image_url":        imageURL,
					"image_id":         "up-img-1",
					"model_name":       "上游模型名",
					"points_used":      1,
					"remaining_points": 99,
				},
			})
		case "/image.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("png"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstreamServer.Close()
	imageURL = upstreamServer.URL + "/image.png"
	if err := application.store.SetSetting(context.Background(), "upstream_endpoint", upstreamServer.URL+"/generate"); err != nil {
		t.Fatalf("set upstream endpoint: %v", err)
	}

	var response map[string]any
	requestJSON(t, handler, http.MethodPost, "/v1/chat/completions", map[string]any{
		"model":    "sd-generate",
		"messages": []map[string]any{{"role": "user", "content": "sd4 1girl,solo,nahida,dress"}},
	}, http.StatusOK, &response, nil, map[string]string{"Authorization": "Bearer test-key"})
	choices := response["choices"].([]any)
	message := choices[0].(map[string]any)["message"].(map[string]any)
	content := message["content"].(string)
	if !strings.Contains(content, imageURL) {
		t.Fatalf("response should contain upstream image url: %s", content)
	}
	if strings.Contains(content, "/images/") {
		t.Fatalf("response should not expose local image url: %s", content)
	}

	logs, err := application.store.ListRequestLogs(context.Background(), 1)
	if err != nil {
		t.Fatalf("list request logs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("unexpected logs count: %d", len(logs))
	}
	log := logs[0]
	if log.DownstreamImageURL != imageURL || log.UpstreamImageURL != imageURL || log.UpstreamImageID != "up-img-1" || log.UpstreamModelName != "上游模型名" {
		t.Fatalf("unexpected logged metadata: %#v", log)
	}
	if log.ImageRecordID == "" || log.ImageReturnMode != "upstream_url" || !strings.Contains(log.UpstreamResponseBody, "图像生成成功") {
		t.Fatalf("missing log detail fields: %#v", log)
	}

	requestJSON(t, handler, http.MethodPost, "/v1/chat/completions", map[string]any{
		"model":    "sd-generate",
		"messages": []map[string]any{{"role": "user", "content": "sd15 landscape --steps 30"}},
	}, http.StatusOK, &response, nil, map[string]string{"Authorization": "Bearer test-key"})
}

func requestJSON(t *testing.T, handler http.Handler, method, path string, body any, want int, out any, cookies []*http.Cookie, extraHeaders ...map[string]string) []*http.Cookie {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	for _, headers := range extraHeaders {
		for key, value := range headers {
			req.Header.Set(key, value)
		}
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, rec.Code, want, rec.Body.String())
	}
	if out != nil {
		if err := json.NewDecoder(rec.Body).Decode(out); err != nil {
			t.Fatalf("decode response: %v body=%s", err, rec.Body.String())
		}
	}
	return rec.Result().Cookies()
}

func insertLog(t *testing.T, application *App, id string, success bool, created time.Time) {
	t.Helper()
	if err := application.store.InsertRequestLog(context.Background(), model.RequestLog{
		ID: id, CreatedAt: created, Model: "sd-generate", ModelIndex: 4, RawPrompt: "raw", FinalPrompt: "final", Width: 832, Height: 1216, Steps: 20, CFG: 7, Seed: 1, Success: success,
	}); err != nil {
		t.Fatalf("insert request log: %v", err)
	}
}

func insertImage(t *testing.T, application *App, id string, created time.Time) {
	t.Helper()
	if err := application.store.InsertImageRecord(context.Background(), model.ImageRecord{
		ID: id, CreatedAt: created, UpstreamImageURL: "https://example.com/image.png", LocalPath: filepath.Join(application.cfg.ImageDir, id+".png"), PublicURL: "/images/" + id + ".png", Filename: id + ".png", ModelIndex: 4, Seed: 1, Width: 832, Height: 1216, Prompt: "prompt",
	}); err != nil {
		t.Fatalf("insert image record: %v", err)
	}
}

func writeImageFile(t *testing.T, dir, name string, size int) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir image dir: %v", err)
	}
	content := bytes.Repeat([]byte{0x61}, size)
	if err := os.WriteFile(filepath.Join(dir, name), content, 0o644); err != nil {
		t.Fatalf("write image file: %v", err)
	}
}
