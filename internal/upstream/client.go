package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Request struct {
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negative_prompt"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Steps          int     `json:"steps"`
	CFG            float64 `json:"cfg"`
	ModelIndex     int     `json:"model_index"`
	Seed           int64   `json:"seed"`
}

type Response struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		ImageURL        string `json:"image_url"`
		ImageID         any    `json:"image_id"`
		ModelName       string `json:"model_name"`
		PointsUsed      int    `json:"points_used"`
		RemainingPoints int    `json:"remaining_points"`
	} `json:"data"`
	Error string `json:"error"`
}

type Result struct {
	StatusCode int
	Body       []byte
	Parsed     Response
}

func Generate(ctx context.Context, endpoint, authorization string, timeout time.Duration, payload Request) (Result, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}

	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authorization)

	resp, err := client.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Result{StatusCode: resp.StatusCode}, err
	}

	result := Result{StatusCode: resp.StatusCode, Body: respBody}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, string(respBody))
	}
	if err := json.Unmarshal(respBody, &result.Parsed); err != nil {
		return result, err
	}
	if !result.Parsed.Success || result.Parsed.Data.ImageURL == "" {
		if result.Parsed.Error != "" {
			return result, errors.New(result.Parsed.Error)
		}
		return result, errors.New("upstream response missing image_url")
	}
	return result, nil
}
