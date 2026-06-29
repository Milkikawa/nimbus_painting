package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Config struct {
	ListenAddr       string
	DBDriver         string
	SQLitePath       string
	MariaDBDSN       string
	UpstreamEndpoint string
	ImageDir         string
	PublicBaseURL    string
	ModelCatalogPath string
	SessionTTL       time.Duration
	DefaultTimeout   time.Duration
}

func Load() Config {
	return Config{
		ListenAddr:       env("LISTEN_ADDR", ":4030"),
		DBDriver:         env("DB_DRIVER", "sqlite"),
		SQLitePath:       env("SQLITE_PATH", filepath.FromSlash("config/app.db")),
		MariaDBDSN:       env("MARIADB_DSN", ""),
		UpstreamEndpoint: env("UPSTREAM_ENDPOINT", ""),
		ImageDir:         env("IMAGE_DIR", filepath.FromSlash("images")),
		PublicBaseURL:    env("PUBLIC_BASE_URL", ""),
		ModelCatalogPath: env("MODEL_CATALOG_PATH", filepath.FromSlash("config/upstream_models.json")),
		SessionTTL:       time.Duration(envInt("SESSION_TTL_HOURS", 24)) * time.Hour,
		DefaultTimeout:   time.Duration(envInt("DEFAULT_TIMEOUT_SECONDS", 120)) * time.Second,
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
