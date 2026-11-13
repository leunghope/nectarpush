#!/bin/sh
set -e
# 迁移到最新 schema（幂等），随后启动服务。
# prisma CLI 随生产依赖安装，这里用本地二进制，避免 npx 运行期联网拉包。
cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
exec node dist/main.js
