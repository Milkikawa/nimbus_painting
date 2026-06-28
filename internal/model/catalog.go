package model

const (
	UpstreamModelTypeImage = "image"
	UpstreamModelTypeVideo = "video"
)

type UpstreamModel struct {
	Index     int    `json:"index"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Available bool   `json:"available"`
}

const (
	DefaultUpstreamModelIndex = 4
	ZImageModelIndex          = 15
)

var UpstreamModels = []UpstreamModel{
	{Index: 0, ID: "sd0", Name: "[全新模型]Anima V1", Type: UpstreamModelTypeImage, Available: true},
	{Index: 1, ID: "sd1", Name: "Miaomiao Harem vPred Dogma 1.1", Type: UpstreamModelTypeImage, Available: true},
	{Index: 2, ID: "sd2", Name: "MiaoMiao Pixel 像素 1.0", Type: UpstreamModelTypeImage, Available: true},
	{Index: 3, ID: "sd3", Name: "NoobAIXL V1.1", Type: UpstreamModelTypeImage, Available: true},
	{Index: 4, ID: "sd4", Name: "illustrious_pencil 融合", Type: UpstreamModelTypeImage, Available: true},
	{Index: 5, ID: "sd5", Name: "[全新模型]one_obsession", Type: UpstreamModelTypeImage, Available: true},
	{Index: 6, ID: "sd6", Name: "[全新模型]MiaoMiao RealSkin EPS 1.3", Type: UpstreamModelTypeImage, Available: true},
	{Index: 7, ID: "sd7", Name: "[全新模型]Newbie exp 0.1", Type: UpstreamModelTypeImage, Available: true},
	{Index: 8, ID: "sd8", Name: "[全新模型]MiaoMiao RealSkin vPred 1.1", Type: UpstreamModelTypeImage, Available: true},
	{Index: 9, ID: "sd9", Name: "[新服开放]MiaoMiao RealSkin vPred 1.0", Type: UpstreamModelTypeImage, Available: true},
	{Index: 10, ID: "sd10", Name: "[全新模型]Wainsfw illustrious v17", Type: UpstreamModelTypeImage, Available: true},
	{Index: 11, ID: "sd11", Name: "[全新模型]Wainsfw illustrious v16", Type: UpstreamModelTypeImage, Available: true},
	{Index: 12, ID: "sd12", Name: "[新服开放]Wainsfw illustrious v15", Type: UpstreamModelTypeImage, Available: true},
	{Index: 13, ID: "sd13", Name: "[新服开放]MiaoMiao Harem 1.75", Type: UpstreamModelTypeImage, Available: true},
	{Index: 14, ID: "sd14", Name: "[新服开放]MiaoMiao Harem 1.6G", Type: UpstreamModelTypeImage, Available: true},
	{Index: 15, ID: "sd15", Name: "[自然语言文生图]Z-Image(步数请改成8步并取消勾选附加推荐质量提示词)", Type: UpstreamModelTypeImage, Available: true},
	{Index: 16, ID: "sd16", Name: "Qwen Image Edit2511版", Type: UpstreamModelTypeImage, Available: true},
	{Index: 17, ID: "sd17", Name: "[新年贺庆版]视频生成模型 rpwan2.2-14B-fast(5秒视频)", Type: UpstreamModelTypeVideo, Available: false},
	{Index: 18, ID: "sd18", Name: "[动态加强-实验性]视频生成模型 rpwan2.2-14B-fast(5秒视频)", Type: UpstreamModelTypeVideo, Available: false},
}

func UpstreamModelByIndex(index int) (UpstreamModel, bool) {
	for _, item := range UpstreamModels {
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
	for _, item := range UpstreamModels {
		if item.Index > max {
			max = item.Index
		}
	}
	return max
}
