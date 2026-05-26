# Changelog

## 0.1.0 - 初始框架版

### 已加入

- Go 单体 HTTP 服务。
- OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`。
- 对 NewAPI 只暴露 `sd-generate` 和 `sd-edit`。
- `sd0` 到 `sd13` 支持普通生图，`sd14` 作为编辑模型保留但暂不实现。
- Prompt 参数解析：`sdX`、`宽*高`、`--seed`、`--steps`、`--cfg`。
- 未指定 seed 时由本服务本地生成随机 seed。
- 上游 `Authorization` 仅透传，不保存。
- 图片下载保存到本地，并通过 `/images/...` 访问。
- WebUI：首次初始化密码、登录、基础设置、提示词组、请求日志、图片管理。
- SQLite WAL 和 MariaDB 支持。
- Dockerfile、docker-compose、`.env.example`。

### 暂未加入

- 真正的图片编辑链路。
- 真实进度流式输出。
- 图片批量打包下载。
- MariaDB / SQLite 之间的数据迁移。
- PostgreSQL 实现。
