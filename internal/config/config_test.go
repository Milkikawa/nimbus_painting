package config

import (
	"strings"
	"testing"
)

func TestValidateRequiresPublicBaseURL(t *testing.T) {
	cfg := Config{ImageReturnMode: ImageReturnModeLocalURL}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "PUBLIC_BASE_URL is required") {
		t.Fatalf("expected PUBLIC_BASE_URL required error, got %v", err)
	}
}

func TestValidateRejectsInvalidPublicBaseURL(t *testing.T) {
	cases := []struct {
		name          string
		publicBaseURL string
	}{
		{name: "relative", publicBaseURL: "/images"},
		{name: "unsupported scheme", publicBaseURL: "ftp://example.com/nimbus"},
		{name: "missing host", publicBaseURL: "https:///nimbus"},
		{name: "empty hostname with port", publicBaseURL: "http://:4030"},
		{name: "query string", publicBaseURL: "https://example.com/nimbus?token=1"},
		{name: "fragment", publicBaseURL: "https://example.com/nimbus#section"},
		{name: "empty fragment", publicBaseURL: "https://example.com/nimbus#"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{PublicBaseURL: tc.publicBaseURL, ImageReturnMode: ImageReturnModeLocalURL}
			if err := cfg.Validate(); err == nil {
				t.Fatalf("expected validation error for %q", tc.publicBaseURL)
			}
		})
	}
}

func TestValidateAcceptsHTTPAndHTTPSPublicBaseURL(t *testing.T) {
	cases := []string{
		"http://127.0.0.1:4030",
		"https://example.com",
		"https://example.com/nimbus",
		"https://example.com/nimbus/",
	}

	for _, publicBaseURL := range cases {
		t.Run(publicBaseURL, func(t *testing.T) {
			cfg := Config{PublicBaseURL: publicBaseURL, ImageReturnMode: ImageReturnModeLocalURL}
			if err := cfg.Validate(); err != nil {
				t.Fatalf("expected %q to be valid: %v", publicBaseURL, err)
			}
		})
	}
}

func TestValidateAcceptsSupportedImageReturnModes(t *testing.T) {
	for _, mode := range []string{ImageReturnModeLocalURL, ImageReturnModeUpstreamURL} {
		t.Run(mode, func(t *testing.T) {
			cfg := Config{PublicBaseURL: "https://example.com/nimbus", ImageReturnMode: mode}
			if err := cfg.Validate(); err != nil {
				t.Fatalf("expected mode %q to be valid: %v", mode, err)
			}
		})
	}
}

func TestValidateRejectsInvalidImageReturnMode(t *testing.T) {
	cfg := Config{PublicBaseURL: "https://example.com/nimbus", ImageReturnMode: "local"}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "IMAGE_RETURN_MODE") {
		t.Fatalf("expected IMAGE_RETURN_MODE validation error, got %v", err)
	}
}
