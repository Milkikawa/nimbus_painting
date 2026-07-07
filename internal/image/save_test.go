package image

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"nimbus-painting/internal/model"
)

func TestSaveRetriesImageDownloadAndReturnsPublicURLWithBasePath(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/image.png" {
			http.NotFound(w, r)
			return
		}
		attempt := attempts.Add(1)
		if attempt < 3 {
			http.Error(w, "temporary image host error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png"))
	}))
	defer server.Close()

	record, err := Save(context.Background(), t.TempDir(), server.URL+"/nimbus", server.URL+"/image.png", model.RequestLog{
		ModelIndex:     4,
		Seed:           8848,
		Width:          832,
		Height:         1216,
		FinalPrompt:    "prompt",
		NegativePrompt: "negative",
	})
	if err != nil {
		t.Fatalf("save image: %v", err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("expected 3 download attempts, got %d", attempts.Load())
	}
	if !strings.HasPrefix(record.PublicURL, server.URL+"/nimbus/images/") {
		t.Fatalf("public URL should include base path, got %q", record.PublicURL)
	}
	content, err := os.ReadFile(record.LocalPath)
	if err != nil {
		t.Fatalf("read saved image: %v", err)
	}
	if string(content) != "png" {
		t.Fatalf("unexpected saved content: %q", string(content))
	}
}

func TestSaveStopsWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := Save(ctx, t.TempDir(), "https://example.com/nimbus", "https://example.com/image.png", model.RequestLog{ModelIndex: 4, Seed: 1})
	if err == nil {
		t.Fatalf("expected context cancellation error")
	}
	if !strings.Contains(err.Error(), "failed after 1 attempts") || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("unexpected error: %v", err)
	}
}
