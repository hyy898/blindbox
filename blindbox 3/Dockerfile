# 开盲盒：前端 + C++ 后端 一体镜像（多阶段构建，最终镜像约 15MB）
#   docker build -t blindbox .
#   docker run -d -p 8080:8080 -v blindbox-data:/data --name blindbox blindbox
#   浏览器打开 http://<服务器IP>:8080/
#   放自己的模型：再加  -v /path/to/models:/app/web/models
# 构建上下文 = 项目根目录（含 package.json、src/、server/）

# ---------- 1. 构建网页 ----------
FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npx vite build

# ---------- 2. 编译 C++ 服务器（静态链接） ----------
FROM alpine:3.20 AS server
RUN apk add --no-cache g++ musl-dev
WORKDIR /src
COPY server ./server
RUN cd server && rm -rf build && EXTRA_FLAGS="-s -static" ./build.sh

# ---------- 3. 运行 ----------
FROM alpine:3.20
WORKDIR /app
COPY --from=server /src/server/blindbox-server /app/blindbox-server
COPY --from=web /app/dist /app/web
# 存档放在 /data，用 volume 持久化；模型可以挂载到 /app/web/models
RUN mkdir -p /data /app/web/models && chown -R nobody /data /app/web/models
VOLUME ["/data"]
EXPOSE 8080
USER nobody
ENTRYPOINT ["/app/blindbox-server", "--host", "0.0.0.0", "--port", "8080", "--web", "/app/web", "--db", "/data/blindbox-save.db"]
