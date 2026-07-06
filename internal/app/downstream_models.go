package app

const (
	downstreamModelGenerate = "sd-generate"
	downstreamModelEdit     = "sd-edit"
)

type downstreamModel struct {
	ID      string
	OwnedBy string
}

var downstreamModels = []downstreamModel{
	{ID: downstreamModelGenerate, OwnedBy: "image-proxy"},
	{ID: downstreamModelEdit, OwnedBy: "image-proxy"},
}

func downstreamModelList() []map[string]any {
	data := make([]map[string]any, 0, len(downstreamModels))
	for _, item := range downstreamModels {
		data = append(data, map[string]any{
			"id":       item.ID,
			"object":   "model",
			"created":  0,
			"owned_by": item.OwnedBy,
		})
	}
	return data
}
