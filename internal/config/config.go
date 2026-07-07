package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	ImageReturnModeLocalURL    = "local_url"
	ImageReturnModeUpstreamURL = "upstream_url"
)

type Config struct {
	ListenAddr       string
	DBDriver         string
	SQLitePath       string
	MariaDBDSN       string
	UpstreamEndpoint string
	ImageDir         string
	PublicBaseURL    string
	ImageReturnMode  string
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
		ImageReturnMode:  env("IMAGE_RETURN_MODE", ImageReturnModeLocalURL),
		ModelCatalogPath: env("MODEL_CATALOG_PATH", filepath.FromSlash("config/upstream_models.json")),
		SessionTTL:       time.Duration(envInt("SESSION_TTL_HOURS", 24)) * time.Hour,
		DefaultTimeout:   time.Duration(envInt("DEFAULT_TIMEOUT_SECONDS", 120)) * time.Second,
	}
}

func (c Config) Validate() error {
	if c.PublicBaseURL == "" {
		return fmt.Errorf("PUBLIC_BASE_URL is required")
	}
	parsed, err := url.Parse(c.PublicBaseURL)
	if err != nil {
		return fmt.Errorf("PUBLIC_BASE_URL must be a valid http(s) absolute URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("PUBLIC_BASE_URL must use http or https scheme")
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return fmt.Errorf("PUBLIC_BASE_URL must include a host")
	}
	if parsed.ForceQuery || parsed.RawQuery != "" {
		return fmt.Errorf("PUBLIC_BASE_URL must not include a query string")
	}
	if parsed.Fragment != "" || strings.Contains(c.PublicBaseURL, "#") {
		return fmt.Errorf("PUBLIC_BASE_URL must not include a fragment")
	}

	switch c.ImageReturnMode {
	case ImageReturnModeLocalURL, ImageReturnModeUpstreamURL:
		return nil
	default:
		return fmt.Errorf("IMAGE_RETURN_MODE must be %q or %q", ImageReturnModeLocalURL, ImageReturnModeUpstreamURL)
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
