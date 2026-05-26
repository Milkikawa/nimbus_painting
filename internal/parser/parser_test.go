package parser

import (
	"strings"
	"testing"

	"nimbus-painting/internal/model"
)

func TestParseCleansControlParams(t *testing.T) {
	settings := testSettings()
	result := Parse("sd6，1girl，cat ears，1024*768，--seed 8848, --steps 28, --cfg 7.5", settings)

	if result.ModelIndex != 6 || result.Width != 1024 || result.Height != 768 || result.Seed != 8848 || result.Steps != 28 || result.CFG != 7.5 {
		t.Fatalf("unexpected parsed result: %+v", result)
	}
	for _, forbidden := range []string{"sd6", "1024*768", "--seed", "--steps", "--cfg"} {
		if strings.Contains(result.Prompt, forbidden) {
			t.Fatalf("prompt still contains %q: %s", forbidden, result.Prompt)
		}
	}
	if result.Prompt != "1girl, cat ears" {
		t.Fatalf("unexpected prompt: %q", result.Prompt)
	}
}

func TestParseKeepsFirstSDAndCleansRest(t *testing.T) {
	result := Parse("sd6, sd10, 1girl", testSettings())
	if result.ModelIndex != 6 {
		t.Fatalf("expected first sd index, got %d", result.ModelIndex)
	}
	if result.Prompt != "1girl" {
		t.Fatalf("expected all sd tokens cleaned, got %q", result.Prompt)
	}
}

func TestInvalidDimensionFallsBack(t *testing.T) {
	settings := testSettings()
	result := Parse("sd4, 99999*1, 1girl", settings)
	if result.Width != settings.DefaultWidth || result.Height != settings.DefaultHeight {
		t.Fatalf("expected default dimensions, got %dx%d", result.Width, result.Height)
	}
	if result.Prompt != "1girl" {
		t.Fatalf("expected invalid dimension cleaned, got %q", result.Prompt)
	}
}

func testSettings() model.Settings {
	return model.Settings{DefaultModel: 4, DefaultWidth: 832, DefaultHeight: 1216, DefaultSteps: 20, DefaultCFG: 7, MinDimension: 64, MaxDimension: 2048}
}
