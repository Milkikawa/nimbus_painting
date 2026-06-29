package model

import "encoding/json"

const (
	UpstreamModelTypeImage = "image"
	UpstreamModelTypeVideo = "video"
	UpstreamModelTypeEdit  = "edit"
)

type UpstreamModelRules struct {
	ForceSteps                  *int `json:"force_steps"`
	AppendDefaultPositivePrompt bool `json:"append_default_positive_prompt"`
}

func (r *UpstreamModelRules) UnmarshalJSON(data []byte) error {
	var raw struct {
		ForceSteps                  *int  `json:"force_steps"`
		AppendDefaultPositivePrompt *bool `json:"append_default_positive_prompt"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	r.ForceSteps = raw.ForceSteps
	r.AppendDefaultPositivePrompt = true
	if raw.AppendDefaultPositivePrompt != nil {
		r.AppendDefaultPositivePrompt = *raw.AppendDefaultPositivePrompt
	}
	return nil
}

type UpstreamModel struct {
	Index     int                 `json:"index"`
	ID        string              `json:"id"`
	Name      string              `json:"name"`
	Type      string              `json:"type"`
	Available bool                `json:"available"`
	Rules     *UpstreamModelRules `json:"rules"`
}

const (
	DefaultUpstreamModelIndex = 4
	ZImageModelIndex          = 15
)

var DefaultUpstreamModels = []UpstreamModel{
	{Index: 0, ID: "sd0", Name: "[全新模型]Anima V1", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 1, ID: "sd1", Name: "Miaomiao Harem vPred Dogma 1.1", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 2, ID: "sd2", Name: "MiaoMiao Pixel 像素 1.0", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 3, ID: "sd3", Name: "NoobAIXL V1.1", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 4, ID: "sd4", Name: "illustrious_pencil 融合", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 5, ID: "sd5", Name: "[全新模型]one_obsession", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 6, ID: "sd6", Name: "[全新模型]MiaoMiao RealSkin EPS 1.3", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 7, ID: "sd7", Name: "[全新模型]Newbie exp 0.1", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 8, ID: "sd8", Name: "[全新模型]MiaoMiao RealSkin vPred 1.1", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 9, ID: "sd9", Name: "[新服开放]MiaoMiao RealSkin vPred 1.0", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 10, ID: "sd10", Name: "[全新模型]Wainsfw illustrious v17", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 11, ID: "sd11", Name: "[全新模型]Wainsfw illustrious v16", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 12, ID: "sd12", Name: "[新服开放]Wainsfw illustrious v15", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 13, ID: "sd13", Name: "[新服开放]MiaoMiao Harem 1.75", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 14, ID: "sd14", Name: "[新服开放]MiaoMiao Harem 1.6G", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 15, ID: "sd15", Name: "[自然语言文生图]Z-Image(步数请改成8步并取消勾选附加推荐质量提示词)", Type: UpstreamModelTypeImage, Available: true, Rules: zImageModelRules()},
	{Index: 16, ID: "sd16", Name: "Qwen Image Edit2511版", Type: UpstreamModelTypeImage, Available: true, Rules: defaultUpstreamModelRules()},
	{Index: 17, ID: "sd17", Name: "[新年贺庆版]视频生成模型 rpwan2.2-14B-fast(5秒视频)", Type: UpstreamModelTypeVideo, Available: false, Rules: defaultUpstreamModelRules()},
	{Index: 18, ID: "sd18", Name: "[动态加强-实验性]视频生成模型 rpwan2.2-14B-fast(5秒视频)", Type: UpstreamModelTypeVideo, Available: false, Rules: defaultUpstreamModelRules()},
}

var UpstreamModels = cloneUpstreamModels(DefaultUpstreamModels)

func defaultUpstreamModelRules() *UpstreamModelRules {
	return &UpstreamModelRules{AppendDefaultPositivePrompt: true}
}

func zImageModelRules() *UpstreamModelRules {
	steps := 8
	return &UpstreamModelRules{ForceSteps: &steps, AppendDefaultPositivePrompt: false}
}

func UpstreamModelByIndex(index int) (UpstreamModel, bool) {
	for _, item := range DefaultUpstreamModels {
		if item.Index == index {
			return item, true
		}
	}
	return UpstreamModel{}, false
}

func IsImageGenerationModel(index int) bool {
	item, ok := UpstreamModelByIndex(index)
	return ok && item.Available && item.Type == UpstreamModelTypeImage
}

func MaxUpstreamModelIndex() int {
	max := -1
	for _, item := range DefaultUpstreamModels {
		if item.Index > max {
			max = item.Index
		}
	}
	return max
}

func cloneUpstreamModels(models []UpstreamModel) []UpstreamModel {
	cloned := make([]UpstreamModel, len(models))
	for i, item := range models {
		cloned[i] = item
		if item.Rules != nil {
			rules := *item.Rules
			cloned[i].Rules = &rules
		}
	}
	return cloned
}
