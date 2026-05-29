package model

import "time"

type Settings struct {
	UpstreamEndpoint string
	DefaultModel     int
	DefaultWidth     int
	DefaultHeight    int
	DefaultSteps     int
	DefaultCFG       float64
	MinDimension     int
	MaxDimension     int
	RequestTimeout   int
	PositiveGroupID  string
	NegativeGroupID  string
	ImageSaveDir     string
}

type PromptGroup struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Remark    string    `json:"remark"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RequestLog struct {
	ID                   string    `json:"id"`
	CreatedAt            time.Time `json:"created_at"`
	Model                string    `json:"model"`
	ModelIndex           int       `json:"model_index"`
	RawPrompt            string    `json:"raw_prompt"`
	FinalPrompt          string    `json:"final_prompt"`
	NegativePrompt       string    `json:"negative_prompt"`
	Width                int       `json:"width"`
	Height               int       `json:"height"`
	Steps                int       `json:"steps"`
	CFG                  float64   `json:"cfg"`
	Seed                 int64     `json:"seed"`
	Success              bool      `json:"success"`
	ErrorMessage         string    `json:"error_message"`
	UpstreamStatus       int       `json:"upstream_status"`
	UpstreamEndpoint     string    `json:"upstream_endpoint"`
	UpstreamRequestBody  string    `json:"upstream_request_body"`
	UpstreamResponseBody string    `json:"upstream_response_body"`
	UpstreamImageURL     string    `json:"upstream_image_url"`
	UpstreamImageID      string    `json:"upstream_image_id"`
	UpstreamModelName    string    `json:"upstream_model_name"`
	PointsUsed           int       `json:"points_used"`
	RemainingPoints      int       `json:"remaining_points"`
	DownstreamImageURL   string    `json:"downstream_image_url"`
	ImageReturnMode      string    `json:"image_return_mode"`
	ImageSaveError       string    `json:"image_save_error"`
	ImageRecordID        string    `json:"image_record_id"`
}

type ImageRecord struct {
	ID                string    `json:"id"`
	CreatedAt         time.Time `json:"created_at"`
	UpstreamImageURL  string    `json:"upstream_image_url"`
	UpstreamImageID   string    `json:"upstream_image_id"`
	UpstreamModelName string    `json:"upstream_model_name"`
	LocalPath         string    `json:"local_path"`
	PublicURL         string    `json:"public_url"`
	Filename          string    `json:"filename"`
	ModelIndex        int       `json:"model_index"`
	Seed              int64     `json:"seed"`
	Width             int       `json:"width"`
	Height            int       `json:"height"`
	Prompt            string    `json:"prompt"`
	NegativePrompt    string    `json:"negative_prompt"`
}
