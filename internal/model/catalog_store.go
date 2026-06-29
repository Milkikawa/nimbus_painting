package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const DefaultCatalogVersion = 1

type ModelCatalog struct {
	Version int             `json:"version"`
	Models  []UpstreamModel `json:"models"`
}

type CatalogStore struct {
	path    string
	mu      sync.RWMutex
	catalog ModelCatalog
}

func NewCatalogStore(path string) *CatalogStore {
	return &CatalogStore{path: path}
}

func (s *CatalogStore) LoadOrInit() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	content, err := os.ReadFile(s.path)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("read model catalog: %w", err)
		}
		catalog := ModelCatalog{Version: DefaultCatalogVersion, Models: cloneUpstreamModels(DefaultUpstreamModels)}
		if err := validateAndDefaultModels(catalog.Models); err != nil {
			return err
		}
		if err := s.writeCatalogLocked(catalog); err != nil {
			return err
		}
		s.catalog = catalog
		return nil
	}

	var catalog ModelCatalog
	if err := json.Unmarshal(content, &catalog); err != nil {
		return fmt.Errorf("decode model catalog: %w", err)
	}
	if catalog.Version == 0 {
		catalog.Version = DefaultCatalogVersion
	}
	if err := validateAndDefaultModels(catalog.Models); err != nil {
		return err
	}
	s.catalog = catalog
	return nil
}

func (s *CatalogStore) List() []UpstreamModel {
	s.mu.RLock()
	defer s.mu.RUnlock()

	models := cloneUpstreamModels(s.catalog.Models)
	sortModelsByIndex(models)
	return models
}

func (s *CatalogStore) FindByIndex(index int) (UpstreamModel, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, item := range s.catalog.Models {
		if item.Index == index {
			return item, true
		}
	}
	return UpstreamModel{}, false
}

func (s *CatalogStore) IsImageGenerationModel(index int) bool {
	item, ok := s.FindByIndex(index)
	return ok && item.Available && item.Type == UpstreamModelTypeImage
}

func (s *CatalogStore) MaxIndex() int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	max := -1
	for _, item := range s.catalog.Models {
		if item.Index > max {
			max = item.Index
		}
	}
	return max
}

func (s *CatalogStore) FirstAvailableImageModel(fallback int) int {
	if s.IsImageGenerationModel(fallback) {
		return fallback
	}

	for _, item := range s.List() {
		if item.Available && item.Type == UpstreamModelTypeImage {
			return item.Index
		}
	}
	return fallback
}

func (s *CatalogStore) Save(models []UpstreamModel) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	models = cloneUpstreamModels(models)
	if err := validateAndDefaultModels(models); err != nil {
		return err
	}
	catalog := ModelCatalog{Version: DefaultCatalogVersion, Models: models}
	if s.catalog.Version > 0 {
		catalog.Version = s.catalog.Version
	}
	if err := s.writeCatalogLocked(catalog); err != nil {
		return err
	}
	s.catalog = catalog
	return nil
}

func (s *CatalogStore) writeCatalogLocked(catalog ModelCatalog) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create model catalog directory: %w", err)
	}

	data, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return fmt.Errorf("encode model catalog: %w", err)
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(s.path), "."+filepath.Base(s.path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create temp model catalog: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp model catalog: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp model catalog: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp model catalog: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("replace model catalog: %w", err)
	}
	if dir, err := os.Open(filepath.Dir(s.path)); err == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func validateAndDefaultModels(models []UpstreamModel) error {
	seen := make(map[int]struct{}, len(models))
	for i := range models {
		item := &models[i]
		if item.Index < 0 {
			return fmt.Errorf("model index must be >= 0: %d", item.Index)
		}
		if _, ok := seen[item.Index]; ok {
			return fmt.Errorf("duplicate model index: %d", item.Index)
		}
		seen[item.Index] = struct{}{}
		if strings.TrimSpace(item.ID) == "" {
			return fmt.Errorf("model %d id is required", item.Index)
		}
		if strings.TrimSpace(item.Name) == "" {
			return fmt.Errorf("model %d name is required", item.Index)
		}
		if !allowedUpstreamModelType(item.Type) {
			return fmt.Errorf("model %d type must be one of %s, %s, %s", item.Index, UpstreamModelTypeImage, UpstreamModelTypeVideo, UpstreamModelTypeEdit)
		}
		if item.Rules == nil {
			item.Rules = defaultUpstreamModelRules()
		}
		if item.Rules.ForceSteps != nil && *item.Rules.ForceSteps <= 0 {
			return fmt.Errorf("model %d rules.force_steps must be > 0", item.Index)
		}
	}
	return nil
}

func allowedUpstreamModelType(modelType string) bool {
	switch modelType {
	case UpstreamModelTypeImage, UpstreamModelTypeVideo, UpstreamModelTypeEdit:
		return true
	default:
		return false
	}
}

func sortModelsByIndex(models []UpstreamModel) {
	sort.Slice(models, func(i, j int) bool {
		return models[i].Index < models[j].Index
	})
}
