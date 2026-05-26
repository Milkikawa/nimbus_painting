package parser

import (
	"crypto/rand"
	"encoding/binary"
	"regexp"
	"strconv"
	"strings"

	"nimbus-painting/internal/model"
)

type Result struct {
	ModelIndex int
	Prompt     string
	Width      int
	Height     int
	Steps      int
	CFG        float64
	Seed       int64
	Warnings   []string
}

var (
	sdRe    = regexp.MustCompile(`(?i)(^|[\s,;])sd(\d+)($|[\s,;])`)
	sizeRe  = regexp.MustCompile(`(?i)(^|[\s,;])(\d{1,5})\s*[x\*]\s*(\d{1,5})($|[\s,;])`)
	seedRe  = regexp.MustCompile(`(?i)(^|[\s,;])--seed\s+(\d+)($|[\s,;])`)
	stepsRe = regexp.MustCompile(`(?i)(^|[\s,;])--steps?\s+(\d+)($|[\s,;])`)
	cfgRe   = regexp.MustCompile(`(?i)(^|[\s,;])--cfg\s+(\d+(?:\.\d+)?)($|[\s,;])`)
)

func Parse(raw string, settings model.Settings) Result {
	cleaned := normalize(raw)
	result := Result{
		ModelIndex: settings.DefaultModel,
		Width:      settings.DefaultWidth,
		Height:     settings.DefaultHeight,
		Steps:      settings.DefaultSteps,
		CFG:        settings.DefaultCFG,
		Seed:       randomSeed(),
	}

	if matches := sdRe.FindAllStringSubmatch(cleaned, -1); len(matches) > 0 {
		if parsed, err := strconv.Atoi(matches[0][2]); err == nil {
			result.ModelIndex = parsed
		}
		cleaned = sdRe.ReplaceAllString(cleaned, "$1$3")
	}

	if matches := sizeRe.FindAllStringSubmatch(cleaned, -1); len(matches) > 0 {
		width, _ := strconv.Atoi(matches[0][2])
		height, _ := strconv.Atoi(matches[0][3])
		if validDimension(width, settings) && validDimension(height, settings) {
			result.Width = width
			result.Height = height
		} else {
			result.Warnings = append(result.Warnings, "invalid_dimensions_fallback_to_default")
		}
		cleaned = sizeRe.ReplaceAllString(cleaned, "$1$4")
	}

	if matches := seedRe.FindStringSubmatch(cleaned); len(matches) > 0 {
		if seed, err := strconv.ParseInt(matches[2], 10, 64); err == nil && seed >= 0 && seed <= 2147483646 {
			result.Seed = seed
		}
		cleaned = seedRe.ReplaceAllString(cleaned, "$1$3")
	}

	if matches := stepsRe.FindStringSubmatch(cleaned); len(matches) > 0 {
		if steps, err := strconv.Atoi(matches[2]); err == nil && steps >= 1 && steps <= 50 {
			result.Steps = steps
		}
		cleaned = stepsRe.ReplaceAllString(cleaned, "$1$3")
	}

	if matches := cfgRe.FindStringSubmatch(cleaned); len(matches) > 0 {
		if cfg, err := strconv.ParseFloat(matches[2], 64); err == nil && cfg >= 1 && cfg <= 10 {
			result.CFG = cfg
		}
		cleaned = cfgRe.ReplaceAllString(cleaned, "$1$3")
	}

	result.Prompt = tidyCommas(cleaned)
	return result
}

func normalize(input string) string {
	replacer := strings.NewReplacer(
		"\r", " ", "\n", " ",
		"，", ",", "、", ",", "。", ",", "：", ":", "；", ";",
		"（", "(", "）", ")", "【", "[", "】", "]",
		"“", "\"", "”", "\"", "‘", "'", "’", "'",
	)
	return replacer.Replace(input)
}

func tidyCommas(input string) string {
	parts := strings.FieldsFunc(input, func(r rune) bool { return r == ',' || r == ';' })
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, ", ")
}

func validDimension(value int, settings model.Settings) bool {
	return value >= settings.MinDimension && value <= settings.MaxDimension
}

func randomSeed() int64 {
	var buf [8]byte
	_, _ = rand.Read(buf[:])
	return int64(binary.BigEndian.Uint64(buf[:]) % 2147483647)
}

func AppendPositive(prompt, positive string) string {
	if strings.TrimSpace(positive) == "" {
		return tidyCommas(prompt)
	}
	return tidyCommas(prompt + ", " + positive)
}
