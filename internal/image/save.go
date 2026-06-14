package image

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"nimbus-painting/internal/model"
	"nimbus-painting/internal/store"
)

func Save(ctx context.Context, baseDir, publicBaseURL, imageURL string, parsed model.RequestLog) (model.ImageRecord, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return model.ImageRecord{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return model.ImageRecord{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return model.ImageRecord{}, fmt.Errorf("download image status %d", resp.StatusCode)
	}

	now := time.Now().In(time.FixedZone("UTC+8", 8*3600))
	day := now.Format("2006-01-02")
	filename := fmt.Sprintf("%s_sd%d_seed%d_%s%s", now.Format("2006-01-02_15-04"), parsed.ModelIndex, parsed.Seed, store.ShortID(), extFromContentType(resp.Header.Get("Content-Type")))
	dir := filepath.Join(baseDir, day)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return model.ImageRecord{}, err
	}
	localPath := filepath.Join(dir, filename)
	out, err := os.Create(localPath)
	if err != nil {
		return model.ImageRecord{}, err
	}
	defer out.Close()
	limited := io.LimitReader(resp.Body, (64<<20)+1)
	written, err := io.Copy(out, limited)
	if err != nil {
		return model.ImageRecord{}, err
	}
	if written > 64<<20 {
		_ = out.Close()
		_ = os.Remove(localPath)
		return model.ImageRecord{}, fmt.Errorf("downloaded image exceeds 64 MiB limit")
	}

	relativeURL := "/images/" + day + "/" + filename
	publicURL := strings.TrimRight(publicBaseURL, "/") + relativeURL
	if publicBaseURL == "" {
		publicURL = relativeURL
	}

	return model.ImageRecord{
		ID: store.NewID("img"), CreatedAt: time.Now(), UpstreamImageURL: imageURL,
		LocalPath: localPath, PublicURL: publicURL, Filename: filename,
		ModelIndex: parsed.ModelIndex, Seed: parsed.Seed, Width: parsed.Width, Height: parsed.Height,
		Prompt: parsed.FinalPrompt, NegativePrompt: parsed.NegativePrompt,
	}, nil
}

func extFromContentType(contentType string) string {
	if strings.Contains(contentType, "png") {
		return ".png"
	}
	if strings.Contains(contentType, "webp") {
		return ".webp"
	}
	return ".jpg"
}
