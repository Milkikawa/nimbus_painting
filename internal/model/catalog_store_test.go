package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCatalogStoreRejectsCatalogWithoutAvailableImageModel(t *testing.T) {
	store := NewCatalogStore(filepath.Join(t.TempDir(), "models.json"))

	if err := store.Save(nil); err == nil {
		t.Fatalf("expected empty catalog to be rejected")
	}

	models := cloneUpstreamModels(DefaultUpstreamModels)
	for i := range models {
		models[i].Available = false
	}
	if err := store.Save(models); err == nil {
		t.Fatalf("expected catalog with no available image model to be rejected")
	}

	models = []UpstreamModel{{Index: 20, ID: "video20", Name: "video", Type: UpstreamModelTypeVideo, Available: true}}
	if err := store.Save(models); err == nil {
		t.Fatalf("expected catalog with only video models to be rejected")
	}
}

func TestCatalogStoreNormalizesModelFields(t *testing.T) {
	store := NewCatalogStore(filepath.Join(t.TempDir(), "models.json"))
	models := []UpstreamModel{{Index: 7, ID: " sd7 ", Name: " Test Model ", Type: " image ", Available: true}}

	if err := store.Save(models); err != nil {
		t.Fatalf("save models: %v", err)
	}

	got := store.List()
	if len(got) != 1 {
		t.Fatalf("expected one model, got %#v", got)
	}
	if got[0].ID != "sd7" || got[0].Name != "Test Model" || got[0].Type != UpstreamModelTypeImage {
		t.Fatalf("expected trimmed model fields, got %#v", got[0])
	}
	if got[0].Rules == nil || !got[0].Rules.AppendDefaultPositivePrompt {
		t.Fatalf("expected default rules, got %#v", got[0].Rules)
	}
}

func TestCatalogStoreSaveSkipsUnchangedCatalogWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "models.json")
	store := NewCatalogStore(path)
	models := []UpstreamModel{{Index: 7, ID: "sd7", Name: "Test Model", Type: UpstreamModelTypeImage, Available: true}}

	if err := store.Save(models); err != nil {
		t.Fatalf("initial save: %v", err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat catalog: %v", err)
	}
	if err := os.Chtimes(path, before.ModTime().Add(-time.Hour), before.ModTime().Add(-time.Hour)); err != nil {
		t.Fatalf("adjust mtime: %v", err)
	}
	before, err = os.Stat(path)
	if err != nil {
		t.Fatalf("stat adjusted catalog: %v", err)
	}

	if err := store.Save(models); err != nil {
		t.Fatalf("unchanged save: %v", err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat catalog after unchanged save: %v", err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("unchanged save should not rewrite catalog: before=%s after=%s", before.ModTime(), after.ModTime())
	}
}

func TestCatalogStoreLoadOrInitRejectsInvalidExistingCatalog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "models.json")
	if err := os.WriteFile(path, []byte("{\"version\":1,\"models\":[]}"), 0o644); err != nil {
		t.Fatalf("write invalid catalog: %v", err)
	}

	store := NewCatalogStore(path)
	if err := store.LoadOrInit(); err == nil {
		t.Fatalf("expected invalid existing catalog to be rejected")
	}
}

func TestFirstAvailableImageModelReturnsFalseWhenUnavailable(t *testing.T) {
	models := []UpstreamModel{{Index: 2, ID: "video2", Name: "video", Type: UpstreamModelTypeVideo, Available: true}}
	if got, ok := FirstAvailableImageModelFrom(models, DefaultUpstreamModelIndex); ok || got != 0 {
		t.Fatalf("expected no available image model, got index=%d ok=%v", got, ok)
	}

	models = []UpstreamModel{
		{Index: 1, ID: "sd1", Name: "image 1", Type: UpstreamModelTypeImage, Available: true},
		{Index: DefaultUpstreamModelIndex, ID: "sd4", Name: "default", Type: UpstreamModelTypeImage, Available: true},
	}
	if got, ok := FirstAvailableImageModelFrom(models, DefaultUpstreamModelIndex); !ok || got != DefaultUpstreamModelIndex {
		t.Fatalf("expected fallback image model, got index=%d ok=%v", got, ok)
	}
}

func TestCatalogStoreResolveImageModelReportsFoundAndAvailability(t *testing.T) {
	store := NewCatalogStore(filepath.Join(t.TempDir(), "models.json"))
	models := []UpstreamModel{
		{Index: 1, ID: "sd1", Name: "image", Type: UpstreamModelTypeImage, Available: true},
		{Index: 2, ID: "sd2", Name: "disabled", Type: UpstreamModelTypeImage, Available: false},
		{Index: 3, ID: "video3", Name: "video", Type: UpstreamModelTypeVideo, Available: true},
	}
	if err := store.Save(models); err != nil {
		t.Fatalf("save models: %v", err)
	}

	got, found, available := store.ResolveImageModel(1)
	if !found || !available || got.Index != 1 {
		t.Fatalf("expected available image model, got %#v found=%v available=%v", got, found, available)
	}

	got, found, available = store.ResolveImageModel(2)
	if !found || available || got.Index != 2 {
		t.Fatalf("expected disabled image model to be found but unavailable, got %#v found=%v available=%v", got, found, available)
	}

	got, found, available = store.ResolveImageModel(3)
	if !found || available || got.Index != 3 {
		t.Fatalf("expected non-image model to be found but unavailable, got %#v found=%v available=%v", got, found, available)
	}

	got, found, available = store.ResolveImageModel(99)
	if found || available || got.Index != 0 {
		t.Fatalf("expected missing model, got %#v found=%v available=%v", got, found, available)
	}
}
