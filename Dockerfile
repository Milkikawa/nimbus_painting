# 默认 Dockerfile —— 适用于海外网络环境，使用官方源。
# 国内网络环境请使用 Dockerfile.cn。
FROM golang:1.22-alpine AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -o /out/nimbus-painting ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/nimbus-painting /app/nimbus-painting
COPY web /app/web
ENV LISTEN_ADDR=:4030 DB_DRIVER=sqlite SQLITE_PATH=/app/config/app.db IMAGE_DIR=/app/images MODEL_CATALOG_PATH=/app/config/upstream_models.json
VOLUME ["/app/config", "/app/images"]
EXPOSE 4030
CMD ["/app/nimbus-painting"]
