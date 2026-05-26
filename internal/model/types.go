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
	ID             string
	CreatedAt      time.Time
	Model          string
	ModelIndex     int
	RawPrompt      string
	FinalPrompt    string
	NegativePrompt string
	Width          int
	Height         int
	Steps          int
	CFG            float64
	Seed           int64
	Success        bool
	ErrorMessage   string
	UpstreamStatus int
	ImageRecordID  string
}

type ImageRecord struct {
	ID               string    `json:"id"`
	CreatedAt        time.Time `json:"created_at"`
	UpstreamImageURL string    `json:"upstream_image_url"`
	LocalPath        string    `json:"local_path"`
	PublicURL        string    `json:"public_url"`
	Filename         string    `json:"filename"`
	ModelIndex       int       `json:"model_index"`
	Seed             int64     `json:"seed"`
	Width            int       `json:"width"`
	Height           int       `json:"height"`
	Prompt           string    `json:"prompt"`
	NegativePrompt   string    `json:"negative_prompt"`
}
