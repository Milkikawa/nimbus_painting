package image

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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

	baseDir := t.TempDir()
	record, err := Save(context.Background(), baseDir, server.URL+"/nimbus", server.URL+"/image.png", model.RequestLog{
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
	info, err := os.Stat(record.LocalPath)
	if err != nil {
		t.Fatalf("stat saved image: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o644 {
		t.Fatalf("saved image permissions = %04o, want 0644", got)
	}
	tempMatches, err := filepath.Glob(filepath.Join(filepath.Dir(record.LocalPath), "."+record.Filename+".*.tmp"))
	if err != nil {
		t.Fatalf("glob temporary images: %v", err)
	}
	if len(tempMatches) != 0 {
		t.Fatalf("temporary images remain after successful save: %v", tempMatches)
	}
	files, err := filesUnder(baseDir)
	if err != nil {
		t.Fatalf("list saved files: %v", err)
	}
	if len(files) != 1 || files[0] != record.LocalPath {
		t.Fatalf("saved files = %v, want only %q", files, record.LocalPath)
	}
}

func TestSaveStopsWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	baseDir := t.TempDir()
	_, err := Save(ctx, baseDir, "https://example.com/nimbus", "https://example.com/image.png", model.RequestLog{ModelIndex: 4, Seed: 1})
	if err == nil {
		t.Fatalf("expected context cancellation error")
	}
	if !strings.Contains(err.Error(), "failed after 1 attempts") || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("unexpected error: %v", err)
	}
	assertNoFiles(t, baseDir)
}

func TestSaveRemovesPartialFilesWhenResponseBodyFails(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", "6")
		_, _ = w.Write([]byte("png"))
	}))
	defer server.Close()

	baseDir := t.TempDir()
	_, err := Save(context.Background(), baseDir, "", server.URL, model.RequestLog{ModelIndex: 4, Seed: 2})
	if err == nil {
		t.Fatalf("expected interrupted response error")
	}
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("expected unexpected EOF, got %v", err)
	}
	if attempts.Load() != maxImageDownloadAttempts {
		t.Fatalf("download attempts = %d, want %d", attempts.Load(), maxImageDownloadAttempts)
	}
	assertNoFiles(t, baseDir)
}

func TestSaveRemovesTempFileWhenContextCancelledDuringDownload(t *testing.T) {
	var attempts atomic.Int32
	var startedOnce sync.Once
	bodyStarted := make(chan struct{})
	releaseHandler := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("partial"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		startedOnce.Do(func() { close(bodyStarted) })
		select {
		case <-r.Context().Done():
		case <-releaseHandler:
		}
	}))
	defer func() {
		close(releaseHandler)
		server.Close()
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	baseDir := t.TempDir()
	result := make(chan error, 1)
	go func() {
		_, err := Save(ctx, baseDir, "", server.URL, model.RequestLog{ModelIndex: 4, Seed: 3})
		result <- err
	}()

	select {
	case <-bodyStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for response body")
	}
	files := waitForFiles(t, baseDir)
	if len(files) != 1 || !strings.HasPrefix(filepath.Base(files[0]), ".") || !strings.HasSuffix(files[0], ".tmp") {
		t.Fatalf("in-progress download files = %v, want one hidden temporary file", files)
	}

	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("expected context cancellation error")
		}
		if !strings.Contains(err.Error(), "failed after 1 attempts") || !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected cancellation error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Save to stop after cancellation")
	}
	if attempts.Load() != 1 {
		t.Fatalf("download attempts = %d, want 1", attempts.Load())
	}
	assertNoFiles(t, baseDir)
}

func TestSaveRejectsOversizedImageWithoutRetryOrFiles(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.FormatInt(maxImageSize+1, 10))
		_, _ = io.CopyN(w, repeatedByteReader('x'), maxImageSize+1)
	}))
	defer server.Close()

	baseDir := t.TempDir()
	_, err := Save(context.Background(), baseDir, "", server.URL, model.RequestLog{ModelIndex: 4, Seed: 4})
	if !errors.Is(err, errImageTooLarge) {
		t.Fatalf("expected errImageTooLarge, got %v", err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("download attempts = %d, want 1", attempts.Load())
	}
	assertNoFiles(t, baseDir)
}

func TestCopyImageWithLimitPrefersTooLargeOverReadError(t *testing.T) {
	readErr := errors.New("read failed")
	reader := &dataAndErrorReader{data: []byte("12345"), err: readErr}
	var dst strings.Builder

	err := copyImageWithLimit(&dst, reader, 4)
	if !errors.Is(err, errImageTooLarge) {
		t.Fatalf("copy error = %v, want errImageTooLarge", err)
	}
	if got := dst.String(); got != "12345" {
		t.Fatalf("copied content = %q, want %q", got, "12345")
	}
}

func TestCopyImageWithLimitAllowsExactLimit(t *testing.T) {
	const content = "1234"
	var dst strings.Builder

	if err := copyImageWithLimit(&dst, strings.NewReader(content), int64(len(content))); err != nil {
		t.Fatalf("copy exact limit: %v", err)
	}
	if got := dst.String(); got != content {
		t.Fatalf("copied content = %q, want %q", got, content)
	}
}

func TestSaveOnceRemovesTempFileWhenRenameFails(t *testing.T) {
	bodyStarted := make(chan struct{})
	releaseHandler := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("partial"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		close(bodyStarted)
		<-releaseHandler
		_, _ = w.Write([]byte("complete"))
	}))
	defer func() {
		close(releaseHandler)
		server.Close()
	}()

	baseDir := t.TempDir()
	result := make(chan error, 1)
	go func() {
		_, err := saveOnce(context.Background(), baseDir, "", server.URL, model.RequestLog{ModelIndex: 4, Seed: 5})
		result <- err
	}()

	select {
	case <-bodyStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for response body")
	}
	files := waitForFiles(t, baseDir)
	if len(files) != 1 || !strings.HasPrefix(filepath.Base(files[0]), ".") || !strings.HasSuffix(files[0], ".tmp") {
		t.Fatalf("in-progress download files = %v, want one hidden temporary file", files)
	}
	tempPath := files[0]
	tempName := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(tempPath), "."), ".tmp")
	randomSeparator := strings.LastIndexByte(tempName, '.')
	if randomSeparator <= 0 {
		t.Fatalf("unexpected temporary filename %q", filepath.Base(tempPath))
	}
	finalPath := filepath.Join(filepath.Dir(tempPath), tempName[:randomSeparator])
	if err := os.Mkdir(finalPath, 0o755); err != nil {
		t.Fatalf("create existing final path: %v", err)
	}
	markerPath := filepath.Join(finalPath, "keep")
	if err := os.WriteFile(markerPath, []byte("original"), 0o644); err != nil {
		t.Fatalf("write final path marker: %v", err)
	}

	releaseHandler <- struct{}{}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("expected rename error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for rename failure")
	}

	marker, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("read final path marker: %v", err)
	}
	if string(marker) != "original" {
		t.Fatalf("final path marker = %q, want %q", marker, "original")
	}
	files, err = filesUnder(baseDir)
	if err != nil {
		t.Fatalf("list files after rename failure: %v", err)
	}
	if len(files) != 1 || files[0] != markerPath {
		t.Fatalf("files after rename failure = %v, want only %q", files, markerPath)
	}
}

type dataAndErrorReader struct {
	data []byte
	err  error
}

func (r *dataAndErrorReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := copy(p, r.data)
	r.data = r.data[n:]
	if len(r.data) == 0 {
		return n, r.err
	}
	return n, nil
}

type repeatedByteReader byte

func (r repeatedByteReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(r)
	}
	return len(p), nil
}

func waitForFiles(t *testing.T, root string) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		files, err := filesUnder(root)
		if err != nil {
			t.Fatalf("list files under %q: %v", root, err)
		}
		if len(files) != 0 {
			return files
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for a file under %q", root)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func assertNoFiles(t *testing.T, root string) {
	t.Helper()
	files, err := filesUnder(root)
	if err != nil {
		t.Fatalf("list files under %q: %v", root, err)
	}
	if len(files) != 0 {
		t.Fatalf("unexpected files under %q: %v", root, files)
	}
}

func filesUnder(root string) ([]string, error) {
	var files []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}
