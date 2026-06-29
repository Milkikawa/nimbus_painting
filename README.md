# Nimbus Painting

面向特定上游绘图服务的 OpenAI 兼容转发层。

项目将上游绘图接口封装为标准 OpenAI Chat Completions 格式，使 NewAPI、Koishi、NapCat 及各类即时通讯 Bot 等下游工具能够以调用 OpenAI 的方式接入上游绘图能力，无需针对上游非标准 API 单独适配。

## 转发链路

```text
QQ / Telegram / Discord
        ↓
Bot / 插件
        ↓
NewAPI
        ↓
Nimbus Painting
        ↓
上游绘图服务
```

---

## 工作原理

一次完整的生图请求经历以下阶段：

1. **接收请求** — 下游工具按 OpenAI Chat Completions 格式发送请求，消息内容即用户提示词。
2. **解析参数** — 从提示词中识别模型编号、尺寸、seed、steps、cfg 等控制参数，识别完成后将其从提示词中移除，避免控制参数污染最终发送给上游的 prompt。
3. **拼接提示词** — 若管理后台配置了默认正面 / 负面提示词组，正面词追加至用户提示词末尾，负面词作为独立的 `negative_prompt` 传递给上游。
4. **调用上游** — 整理后的参数发送至上游绘图接口，请求头中的 `Authorization` 字段原样透传。项目不保存、不展示、不记录 API Key。
5. **返回结果** — 上游返回图片地址后，包装为 OpenAI 风格回复返回给下游。
6. **本地归档** — 生成成功后，项目将图片下载至本地归档，供管理后台图片管理页面查看。
7. **记录日志** — 请求的关键信息写入数据库，包括原始输入、最终 prompt、发送给上游的完整参数、上游响应状态、图片地址、点数消耗等。

对外暴露两个抽象模型：一个用于文生图，一个预留给图片编辑。用户在提示词中通过 `sd` 加数字选择上游内部模型编号，省略时使用默认编号。可选范围、可用状态和特殊兼容规则可在管理后台「模型目录」中维护；默认编号和生成参数在「基础设置」中配置。

---

## 核心特性

- 向下游暴露 OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`
- 自动解析尺寸、seed、steps、cfg 等参数，并从最终 prompt 中移除控制参数
- 支持在管理后台配置默认正面 / 负面提示词组，正面词后插、负面词单独传递
- API Key 仅从请求头透传至上游，不保存、不展示、不写入日志
- 生成成功后自动下载图片至本地归档
- 提供管理后台，支持配置上游、默认参数、模型目录、提示词组，查看请求日志与图片
- 管理后台包含概览、项目监测、基础设置、模型目录、提示词组、图片管理、请求日志等多个视图
- 支持 SQLite 与 MariaDB
- 支持 Docker 部署

---

## 部署

### Docker 部署

项目提供两套 Docker 部署方案，分别对应不同的网络环境：

| 方案             | 适用环境     | Dockerfile      | Compose 文件            | 镜像源       |
| ---------------- | ------------ | --------------- | ----------------------- | ------------ |
| **默认方案**     | 常规网络环境 | `Dockerfile`    | `docker-compose.yml`    | 官方源       |
| **国内加速方案** | 国内网络环境 | `Dockerfile.cn` | `docker-compose.cn.yml` | 腾讯云镜像源 |

两套配置均会自动加入已有的外部网络 `1panel-network`，便于在 1Panel 环境下与其他容器互通。若服务器尚未创建该网络，需先手动创建：

```bash
docker network create 1panel-network
```

#### 1. 准备环境文件

复制示例环境文件：

```bash
cp .env.example .env
```

默认端口为 `4030`，通常无需修改 `.env`。

#### 2. 启动服务

**默认方案**（常规网络环境）：

```bash
docker compose up -d --build
```

**国内加速方案**（国内网络环境）：

```bash
docker compose -f docker-compose.cn.yml up -d --build
```

#### 3. 打开管理后台

浏览器访问：

```text
http://localhost:4030/dashboard
```

首次进入时设置管理员密码。

#### 4. 配置上游接口

登录后台后，在「基础设置」中填写上游的完整生图 endpoint。

需填写完整的生成接口地址，例如 `https://[上游域名]/完整/生成接口/path`。项目不会在源码中写死真实站点，也不会自动拼接 path，地址完全由使用者填写。

也可在 `.env` 中提前配置：

```env
UPSTREAM_ENDPOINT=https://[上游域名]/完整/生成接口/path
```

该配置项仅用于首次初始化数据库时的便捷写入，之后仍可在后台「基础设置」中修改。

#### 5. 配置 NewAPI

在 NewAPI 中添加一个 OpenAI 兼容渠道：

```text
Base URL: http://<服务器IP>:4030
模型: sd-generate
```

API Key 照常填写原站 API Key。NewAPI 请求项目时会携带 `Authorization: Bearer ...`，项目负责原样透传至上游。

### 源码运行

不使用 Docker 时，可直接使用 Go 运行。

#### 1. 安装 Go

安装 Go 1.22 或更高版本。国内环境建议配置 Go 模块代理：

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

#### 2. 下载依赖

```bash
go mod tidy
```

#### 3. 启动服务

```bash
go run ./cmd/server
```

默认访问地址：

```text
http://localhost:4030/dashboard
```

源码运行时默认使用 `config/app.db`、`config/upstream_models.json` 与 `images/`；其中运行时生成的数据库、模型目录和图片目录均已被 `.gitignore` 忽略，不会误提交至版本库。仓库中保留了 `config/upstream_models.example.json` 作为可见示例文件。

---

## 环境变量

| 变量                      | Docker 默认值                      | 源码默认值                    | 说明                                                            |
| ------------------------- | ---------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `LISTEN_ADDR`             | `:4030`                            | `:4030`                       | 服务监听地址                                                    |
| `DB_DRIVER`               | `sqlite`                           | `sqlite`                      | 数据库类型：`sqlite` 或 `mariadb`                               |
| `SQLITE_PATH`             | `/app/config/app.db`               | `config/app.db`               | SQLite 数据库路径                                               |
| `MARIADB_DSN`             | 空                                 | 空                            | MariaDB 连接字符串                                              |
| `UPSTREAM_ENDPOINT`       | 空                                 | 空                            | 上游完整生图 endpoint，可留空后于后台配置                       |
| `IMAGE_DIR`               | `/app/images`                      | `images`                      | 图片保存目录                                                    |
| `MODEL_CATALOG_PATH`      | `/app/config/upstream_models.json` | `config/upstream_models.json` | 上游模型能力目录文件；Docker 中随 `/app/config` 挂载持久化      |
| `PUBLIC_BASE_URL`         | 空                                 | 空                            | 本地归档图片 URL 的外部访问前缀；不影响返回给下游的上游原图链接 |
| `SESSION_TTL_HOURS`       | `24`                               | `24`                          | 后台登录有效期                                                  |
| `DEFAULT_TIMEOUT_SECONDS` | `120`                              | `120`                         | 默认上游请求超时                                                |

MariaDB DSN 示例：

```text
user:password@tcp(127.0.0.1:3306)/database?parseTime=true&charset=utf8mb4
```

> 若使用 Docker 部署且 MariaDB 同位于 Docker 网络中，host 需填写 MariaDB 的服务名，而非 `127.0.0.1`。

---

## 提示词语法

用户在聊天中直接输入提示词即可，可在开头使用 `sd` 加数字选择内部模型编号，省略时使用默认编号。

基本输入：

```text
1girl, cat ears
```

指定模型编号：

```text
sd4, 1girl, cat ears
```

指定尺寸（`*` 或 `x` 均可）：

```text
sd4, 1girl, cat ears, 832*1216
```

指定 seed：

```text
sd4, 1girl, cat ears, --seed 8848
```

指定 steps 与 cfg：

```text
sd4, 1girl, cat ears, --steps 28, --cfg 7.5
```

上述控制参数会被自动识别并从提示词中移除，不会出现在最终传递给上游的 prompt 中。可选编号范围、模型类型、可用状态及特殊参数规则可在后台「模型目录」中查看和维护；默认值及参数边界在「基础设置」中查看。

---

## 模型目录

后台「模型目录」维护的是本地上游模型能力配置，用于未来请求的准入和兼容处理：

- 模型索引、ID、本地显示名、类型和启用状态
- 是否可用于图片生成链路
- 特殊参数规则，例如强制 steps、是否追加默认正面提示词
- `/v1/models` 当前返回给调用方的上游模型元数据

模型目录运行文件由 `MODEL_CATALOG_PATH` 指定：

```text
Docker 容器内默认：/app/config/upstream_models.json
Docker 宿主机对应：./config/upstream_models.json
源码直接运行默认：config/upstream_models.json
```

仓库同时提供一份可见示例文件：

```text
config/upstream_models.example.json
```

这份 example 只用于查看字段结构、复制初始化或对照默认内容；服务运行时不会自动读取或覆盖 example。首次启动时，如果 `MODEL_CATALOG_PATH` 指向的真实运行文件不存在，服务会根据内置默认模板自动生成运行文件。Docker 部署时该运行文件随 `./config:/app/config` 挂载持久化。

WebUI「模型目录」页面的读写对象就是 `MODEL_CATALOG_PATH` 指向的真实运行文件：

1. 打开页面时，后端从内存中的 catalog 返回当前模型目录。
2. 点击保存时，WebUI 调用 `PUT /admin/api/models` 整表提交。
3. 后端校验并规范化目录后写回同一个 JSON 文件。
4. 保存会拒绝空目录或没有任何可用图片模型的目录，避免默认生图链路不可用。

机械硬盘 HDD 部署时也可以放心使用：模型目录通常是人工低频编辑；后端会在内容没有变化时跳过落盘，不写临时文件、不执行 fsync、不 rename。有变化时仍采用“临时文件 + sync + rename”的方式保证配置文件不被半写入破坏。不建议用脚本高频循环调用模型目录保存接口。

> 注意：模型目录只影响未来请求和当前 UI 展示。请求日志、图片记录和统计中的实际模型名，仍以上游响应体里的 `model_name` 为准，不会因为后来修改本地目录名称而被重写。

---

## 返回格式

当前返回给下游的为 Markdown 图片格式，图片地址默认使用上游返回的原始链接：

```text
![generated image](上游图片URL)

Image URL: 上游图片URL
Seed: 8848
Model: sd4
```

生成成功后，项目仍会将图片下载至本地归档，供后台图片管理页面查看。本地归档地址不会覆盖返回给下游的图片地址，以避免 NewAPI、Koishi、NapCat、QQ 客户端等外部用户收到 `/images/...` 这类仅能在本项目内部访问的相对路径。

---

## 图片归档

生成成功后，项目会下载上游图片并保存至本地。

Docker 默认挂载：

```text
./config:/app/config
./images:/app/images
```

其中 `./config` 保存 SQLite 数据库和模型目录 JSON，`./images` 保存本地归档图片。

文件路径格式：

```text
images/YYYY-MM-DD/YYYY-MM-DD_HH-mm_sd4_seed8848_ab12cd.jpg
```

文件名包含：生成日期、生成时间（精确到分钟）、模型编号、seed、随机字符（规避并发冲突）。

后台会同时记录上游原图链接、本地归档链接、上游图片 ID、上游模型名称及实际返回给下游的图片链接。`PUBLIC_BASE_URL` 仅用于将本地归档链接从 `/images/...` 拼接为外部绝对地址；若无可公开访问的项目地址，保持为空即可。

---

## 请求日志

后台「请求日志」记录每次生图的关键上下文：

- 用户原始输入、最终正面提示词与负面提示词
- 实际发送给上游的完整参数，包括缺省后的尺寸、steps、cfg、seed 与模型编号
- 上游 HTTP 状态码、原始响应体、`image_url`、`image_id`、`model_name`
- 上游返回的 `points_used` 与 `remaining_points`
- 实际返回给下游的图片 URL、图片返回模式、本地保存错误

点数信息仅在单条日志中展示，不纳入全局统计。不同上游地址与不同 API Key 的余额口径可能不同，混入总览会产生误导。点击单条日志可展开查看完整请求 / 响应 JSON。

---

## 管理后台

访问地址：

```text
http://localhost:4030/dashboard
```

包含以下视图：

- **概览** — 核心指标卡片、运行状态摘要、模型使用统计、最近活动
- **项目监测** — 进程资源占用（内存、协程、GC）、图片统计、任务统计与成功率
- **基础设置** — 上游接口、默认模型、默认尺寸、steps、cfg、尺寸边界、请求超时、图片保存目录、默认提示词组选择
- **模型目录** — 新增 / 编辑 / 删除本地上游模型能力配置，维护可用状态和特殊参数规则
- **提示词组** — 新增 / 编辑 / 删除正面与负面提示词组
- **图片管理** — 查看与删除已保存的生成图片
- **请求日志** — 按成功 / 失败筛选，查看每条请求的完整详情

支持浅色 / 深色主题切换。

---

## 数据库

### SQLite

默认使用 SQLite，适合个人部署，开箱即用。

```env
DB_DRIVER=sqlite
SQLITE_PATH=/app/config/app.db
```

### MariaDB

```env
DB_DRIVER=mariadb
MARIADB_DSN=user:password@tcp(host:3306)/database?parseTime=true&charset=utf8mb4
```

数据库仅在服务启动时读取。后台不支持修改底层数据库，也不做在线热切换。SQLite 与 MariaDB 的数据不会自动互通，中途切换数据库需自行处理数据迁移，或接受新数据库从空数据开始。

---

## 安全说明

- 上游 API Key 不保存在项目中。
- 上游 API Key 不在后台展示。
- 日志不记录完整 `Authorization`。
- 后台具备登录密码与 session cookie 机制。
- 项目默认不启用 HTTPS，适合内网或反向代理后使用。

若需暴露至公网，务必置于反向代理之后，并启用 HTTPS 与访问控制。

---

## 当前限制

- 图片编辑模型仅保留接口，暂不支持真实图片编辑（不同聊天平台与插件的传图方式尚未统一确认）。
- `stream: true` 为伪流式：等待上游完成后一次性返回结果。
- 暂不支持图片批量 zip 下载。
- 暂不支持 SQLite / MariaDB 之间的数据互迁。
- 暂不支持 PostgreSQL。
- 暂不做多用户系统。

更详细的实现状态会随版本整理至 `docs/changelog/`，当前版本以本 README 与更新记录为准。
