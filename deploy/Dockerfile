# syntax=docker/dockerfile:1
# NectarPush —— 多阶段构建：deps+build（API + Web SPA）→ 精简运行时
# 构建上下文为仓库根目录：docker build -f deploy/Dockerfile .
#
# Q-01：镜像必须同时包含 API dist 与已构建的 Web dist。API 进程通过
# main.ts 的 WEB_DIST = <app>/apps/web/dist 托管 SPA，所以运行时把
# build 阶段产出的 apps/web/dist 复制到同样位置（/app/apps/web/dist）。

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.30.3
# 先复制清单文件以利用层缓存（workspace 的每个包都要有 package.json，
# 否则 pnpm install 无法解析 workspace:* 链接）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter api exec prisma generate \
  && pnpm --filter api run build \
  && pnpm --filter web run build

FROM node:22-alpine AS runtime
WORKDIR /app
# 发布时由 CI 注入（tag 名，如 v0.1.1）；本地构建不传时 API 回退到 package.json 版本。
ARG APP_VERSION=""
ARG GIT_COMMIT=""
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/nectarpush.db \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
# schema 必须先于 install 存在；generate 需显式执行（postinstall 在 pnpm 布局下找不到子包 schema）。
# 安装、生成与残留清理必须在同一条 RUN 内完成：镜像层只读叠加，跨 RUN 删除只留下
# whiteout，层体积不会下降（这正是本镜像曾多出约 250MB 安装残留的根因）。
# 清理项：pnpm store、Prisma 引擎下载缓存、npm 缓存、仅用于本次安装的全局 pnpm。
# 注意别把这条 RUN 拆开，否则体积会立刻回涨（验收阈值见 docs/qa-evidence/image-slim-2026-11-24.txt）。
RUN set -eu; \
    export npm_config_cache=/tmp/npm-cache; \
    export XDG_CACHE_HOME=/tmp/prisma-cache; \
    npm install -g pnpm@10.30.3; \
    pnpm install --frozen-lockfile --prod --store-dir /tmp/pnpm-store; \
    pnpm --filter api exec prisma generate; \
    npm rm -g pnpm; \
    rm -rf /tmp/npm-cache /tmp/prisma-cache /tmp/pnpm-store \
           /root/.local/share/pnpm /root/.cache/prisma /root/.npm \
           /usr/local/lib/node_modules/pnpm /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=build /app/apps/api/dist ./apps/api/dist
# Q-01：SPA 静态资源必须随镜像分发（main.ts 期望 /app/apps/web/dist）
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/api
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]

