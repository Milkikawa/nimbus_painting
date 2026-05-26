# Nimbus Painting Proxy

一个面向特定绘图站点的 OpenAI 兼容转发层。

它的作用很简单：让 NewAPI、Koishi、NapCat、Telegram Bot、Discord Bot 等下游工具，可以像调用 OpenAI Chat Completions 一样调用原站的绘图接口。

```text
QQ / Telegram / Discord
        ↓
Bot / 插件
        ↓
NewAPI
        ↓
Nimbus Painting Proxy
        ↓
上游绘图 API
```

本项目不是通用绘图平台，也不是前端绘图站。它主要解决“原站 API 端点不规则、不兼容 OpenAI 格式、不方便直接接入 NewAPI”的问题。

---

## 主要功能

- 对 NewAPI 暴露 OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`
- 对外只暴露两个模型：`sd-generate` 和 `sd-edit`
- 用户在聊天里输入 `sd4, 1girl, cat ears` 即可选择内部模型编号
- 自动解析尺寸、seed、steps、cfg 等参数
- 自动把控制参数从最终 prompt 里清理掉
- API Key 只从请求头透传给上游，不保存、不展示、不写日志
- 支持 WebUI 配置上游 endpoint、默认参数、提示词组
- 支持默认正面提示词组后插
- 支持默认负面提示词组单独传给上游 `negative_prompt`
- 自动下载上游返回的图片并保存到本地
- 支持 SQLite 和 MariaDB
- 支持 Docker 部署

---

## 当前模型规则

| 用户输入 | 含义 | 当前状态 |
|---|---|---|
| `sd0` - `sd13` | 普通文生图模型 | 可用 |
| `sd14` | 图片编辑模型 | 保留，暂不实现 |
| `sd15+` | 视频或其他不支持模型 | 禁止 |
| 不写 `sdX` | 使用默认模型 | 默认回退 `sd4` |

`sd-edit` 这个抽象模型会保留，但当前不会真正改图。原因是不同聊天平台和插件传入图片的方式还没有统一确认。

---

## 快速开始：Docker

### 1. 准备环境文件

复制示例环境文件：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

默认端口是 `4030`。一般情况下，先不用改 `.env`。

### 2. 启动服务

```bash
docker compose up -d --build
```

### 3. 打开 WebUI

浏览器访问：

```text
http://localhost:4030/dashboard
```

首次进入时，设置管理员密码。

### 4. 配置上游 endpoint

登录 WebUI 后，在“基础设置”里填写上游完整 endpoint。

注意：这里必须填写完整生成接口地址。本项目不会在源码里写死真实站点，也不会帮你拼接 path。

也可以在 `.env` 里提前填写：

```env
UPSTREAM_ENDPOINT=https://你的上游域名/完整/生成接口/path
```

这只是首次初始化数据库时的便捷入口。之后你仍然可以在 WebUI 的“基础设置”里修改它。

### 5. 配置 NewAPI

在 NewAPI 中添加一个 OpenAI 兼容渠道：

```text
Base URL: http://你的机器IP:4030
模型: sd-generate
```

API Key 仍然填写原站 API Key。NewAPI 请求本项目时会带上 `Authorization: Bearer ...`，本项目只负责原样透传给上游。

---

## 没有 Docker 怎么办

Windows 没有 Docker 时，可以直接运行 Go 版本。

### 1. 安装 Go

安装 Go 1.22 或更高版本。

### 2. 下载依赖

```powershell
go mod tidy
```

### 3. 启动服务

```powershell
go run ./cmd/server
```

默认访问地址：

```text
http://localhost:4030/dashboard
```

本地直跑时，默认会使用：

```text
config/app.db
images/
```

这两个目录已经被 `.gitignore` 忽略，不会误提交。

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LISTEN_ADDR` | `:4030` | 服务监听地址 |
| `DB_DRIVER` | `sqlite` | 数据库类型：`sqlite` 或 `mariadb` |
| `SQLITE_PATH` | `/app/config/app.db` | Docker 中 SQLite 数据库路径 |
| `MARIADB_DSN` | 空 | MariaDB 连接字符串 |
| `UPSTREAM_ENDPOINT` | 空 | 上游完整生图 endpoint，可留空后在 WebUI 配置 |
| `IMAGE_DIR` | `/app/images` | Docker 中图片保存目录 |
| `PUBLIC_BASE_URL` | 空 | 返回图片 URL 时使用的外部访问前缀 |
| `SESSION_TTL_HOURS` | `24` | WebUI 登录有效期 |
| `DEFAULT_TIMEOUT_SECONDS` | `120` | 默认上游请求超时 |

MariaDB DSN 示例：

```text
user:password@tcp(127.0.0.1:3306)/database?parseTime=true&charset=utf8mb4
```

如果你使用 Docker 部署，并且 MariaDB 也在 Docker 网络里，host 通常要写 MariaDB 服务名，而不是 `127.0.0.1`。

---

## 用户怎么发图

最简单的输入：

```text
sd4, 1girl, cat ears
```

带尺寸：

```text
sd4, 1girl, cat ears, 832*1216
```

带 seed：

```text
sd4, 1girl, cat ears, --seed 8848
```

带 steps 和 cfg：

```text
sd4, 1girl, cat ears, --steps 28, --cfg 7.5
```

这些控制参数会被自动删除，不会污染最终传给上游的 prompt。

---

## 返回图片

当前返回给下游的是 Markdown 图片格式：

```text
![generated image](图片URL)

Image URL: 图片URL
Seed: 8848
Model: sd4
```

如果后续发现某些插件不解析 Markdown，可以再调整成纯文本或其他格式。

---

## 图片保存

生成成功后，服务会下载上游图片并保存到本地。

Docker 默认挂载：

```text
./images:/app/images
```

文件路径格式：

```text
images/YYYY-MM-DD/YYYY-MM-DD_HH-mm_sd4_seed8848_ab12cd.jpg
```

文件名包含：

- 生成日期
- 生成时间，精确到分钟
- 模型编号
- seed
- 随机字符，避免并发冲突

---

## WebUI 能做什么

访问：

```text
http://localhost:4030/dashboard
```

当前支持：

- 首次初始化管理员密码
- 登录和退出
- 配置上游 endpoint
- 配置默认模型、默认宽高、steps、cfg
- 配置尺寸边界和请求超时
- 配置图片保存目录
- 管理正面提示词组
- 管理负面提示词组
- 全局单选当前使用的正面组和负面组
- 查看请求日志
- 查看和删除已保存图片

---

## 数据库选择

### SQLite

默认就是 SQLite，适合个人部署。

```env
DB_DRIVER=sqlite
SQLITE_PATH=/app/config/app.db
```

### MariaDB

如果你已经有 MariaDB，可以改成：

```env
DB_DRIVER=mariadb
MARIADB_DSN=user:password@tcp(host:3306)/database?parseTime=true&charset=utf8mb4
```

数据库只在服务启动时读取。WebUI 不支持修改底层数据库，也不做在线热切换。

SQLite 和 MariaDB 的数据不会自动互通。如果中途切换数据库，需要自己处理数据迁移，或者接受新数据库从空数据开始。

---

## 安全说明

- 上游 API Key 不会保存在本项目里。
- 上游 API Key 不会显示在 WebUI。
- 日志不会记录完整 `Authorization`。
- WebUI 有登录密码和 session cookie。
- 本项目默认不启用 HTTPS，适合内网或反向代理后使用。

如果你要暴露到公网，请务必放在反向代理后，并启用 HTTPS 和访问控制。

---

## 当前限制

- `sd-edit` 只是保留接口，暂不支持真实图片编辑。
- `stream: true` 是伪流式：等待上游完成后一次性返回结果。
- 暂不支持图片批量 zip 下载。
- 暂不支持数据库互迁。
- 暂不支持 PostgreSQL。
- 暂不做多用户系统。

更详细的实现状态会随着后续版本整理到公开文档中；当前版本以本 README 和更新记录为准。
