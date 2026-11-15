# NectarPush 部署指南

本指南覆盖单端口 Docker 部署、环境变量、首次初始化、反向代理 / TLS、备份还原与升级回滚。接口定义见 [openapi.yaml](openapi.yaml)，使用指南见 [API.md](API.md)。

---

## 1. 部署形态

镜像对外只暴露**一个端口**（容器内 `3000`），API 与 Web SPA 由同一个进程提供。内网 / 局域网直接访问时**不需要反向代理**，也不需要额外组件。

- 数据保存在容器内 `/data/nectarpush.db`（SQLite）；compose 默认把它**绑定挂载**到仓库的 `deploy/data/`（已在 `.gitignore`），所以重建镜像、`down`/`up`、甚至 Docker Desktop 重置虚拟机都不会动这份数据——只有主动删除 `deploy/data/` 才会清空。
- 旧的命名卷（`deploy_nectarpush-data`）仍可用于 `-v` 方式部署；`backup.sh` / `restore.sh` 会自动区分目录与卷。
- 入口脚本在每次启动前执行 `prisma migrate deploy`（可重复执行，不会重复建表），随后启动服务。
- 镜像内置健康检查 `GET /api/health`；`docker ps` 显示 `healthy` 后再对外提供服务。
- 镜像不终止 TLS。纯内网 HTTP 访问时会话 Cookie 不带 `Secure`，属预期行为；公网 HTTPS 请叠加反向代理（§5）。

## 2. 环境变量

### 2.1 必需 / 常用

| 变量 | 必需 | 默认 / 示例 | 说明 |
| --- | --- | --- | --- |
| `SESSION_SECRET` | **是** | 32+ 字节随机串 | 会话 HMAC 密钥；compose 用 `${SESSION_SECRET:?…}` 强制要求。轮换会使全部会话失效 |
| `ENCRYPTION_KEY` | 强烈建议 | 32+ 字节随机串 | 通道凭据 AES-256-GCM 加密；未设置时回退到 `SESSION_SECRET`。**一旦有加密数据，不可随意更换**，否则旧凭据无法解密 |
| `DATABASE_URL` | 否 | `file:/data/nectarpush.db` | Prisma 连接串 |
| `PORT` | 否 | `3000` | 容器内监听端口；compose 的 `PORT` 同时决定宿主机映射端口 |
| `PUBLIC_BASE_URL` | 否 | `https://push.example.com` | 生成 Webhook 触发 URL / OAuth 回调 / 邮件链接的基址；系统设置里的 `ServerAddress` 优先 |
| `TZ` | 否 | `Asia/Shanghai` | 容器时区 |
| `COOKIE_SECURE` | 否 | 未设置（自动推导） | 会话 Cookie 的 `Secure` 属性。显式 `true`/`false` 优先；未设置且 `PUBLIC_BASE_URL` 为 `https://` 时自动开启 |
| `TRUST_PROXY` | 否 | `false` | 是否信任 `X-Forwarded-For`。默认 `false`：限流只按直连 IP 计数；只有部署在会**覆盖**该头的反向代理后才设为 `true`（见 §5） |
| `CORS_ORIGINS` | 否 | 未设置（反射请求源） | 允许跨源携带 Cookie 调用 API 的源，逗号分隔。未设置时反射任意 Origin（仅为本地开发保留）；**生产必须设置** |
| `NODE_ENV` | 否 | `production` | 镜像已设置 |

生成密钥：

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

### 2.2 通过系统设置（数据库）配置，不是环境变量

以下由 root 在「系统设置」页面写入，敏感项在数据库中加密存储，页面不回显明文，**不要写进镜像或 compose 明文**：

- **SMTP**：`SMTPServer` / `SMTPAccount` / `SMTPPort`（默认 465）/ `SMTPToken`。
- **OAuth2 提供方**：卡片式表单管理，内置 GitHub 预设 + 自定义 Provider。每个提供方填写 `id`、显示名称、`authorize_url` / `token_url` / `userinfo_url`、`client_id`、`client_secret`、`scope`、`map_username`、`map_email`。`client_secret` 保存后不回显（只返回 `has_secret`），再次编辑留空表示保持不变。需在身份提供方登记 Redirect URI：`<PUBLIC_BASE_URL>/api/auth/oauth/<provider-id>/callback`。
- **Turnstile**：`TurnstileEnabled` / `TurnstileSiteKey` / `TurnstileSecretKey`。
- 注册 / 登录 / 邮箱验证开关、站点名称、`ServerAddress`、公告、关于、页脚、首页链接。

## 3. Docker 部署

### 3.1 compose（推荐，长期主机）

```bash
cd deploy

cat > .env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
PORT=3000
PUBLIC_BASE_URL=https://push.example.com
TZ=Asia/Shanghai
EOF

docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

要点：

- 官方镜像发布在 `ghcr.io/leunghope/nectarpush`，同时提供 `linux/amd64` 与 `linux/arm64`。不想本地构建时用 `docker compose pull && docker compose up -d --no-build`；要固定版本就在 `.env` 里写 `NECTARPUSH_VERSION=0.1.1`（缺省为 `latest`）。
- `SESSION_SECRET` 必填；`docker compose down` 等子命令也会校验该变量，建议始终带 `.env`。
- 镜像构建上下文是仓库根目录（`deploy/docker-compose.yml` 的 `context: ..`）。
- 版本号与提交号通过构建参数注入：CI 在 `v*` 标签构建时传 `APP_VERSION`（标签名）与 `GIT_COMMIT`；本地 `docker build --build-arg APP_VERSION=0.2.0 --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) …` 可得到同样的 `/api/version` 输出。未传时回退到 `package.json` 的版本号。
- 「系统设置 → 版本更新 → 检查更新」会读取 GitHub Release 并与上面的版本号比较，因此自定义构建请显式传 `APP_VERSION`，否则永远显示「已是最新」。检查更新的上游默认是 GitHub Releases API，可用环境变量 `UPDATE_CHECK_URL` 覆盖为自建镜像（返回同样结构的 JSON）；GitHub 匿名接口有速率限制，可设 `GITHUB_TOKEN` 提高配额。
- 数据目录 `deploy/data/`（绑定挂载）→ 容器 `/data`；不要把它当缓存删除，删了等于清库。
- 静态资源：`/` 与 `/message/<uuid>` 应返回 `text/html`，`/assets/*.js|css` 应返回 200 且 MIME 正确。

### 3.2 单镜像运行

```bash
docker run -d --name nectarpush \
  -p 8080:3000 \
  -v "$PWD/np-data":/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e TZ=Asia/Shanghai \
  ghcr.io/leunghope/nectarpush:0.1.1
```

镜像名可以换成本地构建的 tag（如 `nectarpush:0.1.1`），两者行为一致。

升级：`docker rm -f nectarpush` → 用同一条 `docker run` 挂同一个卷挂载新镜像；启动时自动迁移。

## 4. 首次初始化与安全

1. 打开站点，使用 `root / 123456` 登录。
2. 系统**强制跳转改密**（服务端拦截，未改密只能访问改密与登出接口）；设置强密码后进入工作台。
3. 进入「系统设置」：填写 SMTP、站点名称、`ServerAddress` / 公开地址；按需开启邮箱验证 / Turnstile。
4. 先创建一个 `none` 通道做测试发送（不会真的发出去），再配置真实通道。
5. 如需封闭部署，关闭自助注册。

上线前必须：

- 立即修改 root 初始密码，不要把 `123456` 留在任何环境。
- 配置 SMTP 并发送一封测试邮件（未配置时找回密码接口仍返回统一提示，但邮件不会真正发出）。
- 使用 HTTPS 并设置 `PUBLIC_BASE_URL=https://…`（或 `COOKIE_SECURE=true`），使会话 Cookie 带 `Secure`。
- 生产设置 `CORS_ORIGINS`，否则任意站点都能用用户 Cookie 调用接口。
- 备份 `deploy/data/`（`./deploy/backup.sh -c nectarpush`），定期演练恢复。
- 轮换 `ENCRYPTION_KEY` 会导致已有通道凭据无法解密；如需轮换，先导出 / 重录所有通道 secret。

角色：`user` / `admin` / `root`；root 仅一个，不能注销。

## 5. 反向代理与 TLS（可选）

仅在需要公网 HTTPS / 对外域名时采用。配置模板：[`deploy/nginx.conf.example`](../deploy/nginx.conf.example)。应用只监听内网 / 回环，由 nginx 终止 TLS。

### 5.1 三个必须保持一致的环境变量

| 变量 | 生产取值 | 作用 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `https://push.example.com` | 拼 OAuth 回调、Webhook 触发地址、邮件链接的基址 |
| `TRUST_PROXY` | `true`（仅在代理**覆盖**了 `X-Forwarded-For` 时） | 让限流按真实客户端 IP 计数 |
| `COOKIE_SECURE` | `true` | 会话 Cookie 带 `Secure` |

三者必须保持一致：`PUBLIC_BASE_URL` 写成 `http://` 会让 OAuth 回调和 Cookie 一起退回不安全形态；`TRUST_PROXY=true` 但代理用追加而非覆盖，等于把限流键交给客户端控制；`COOKIE_SECURE=true` 而实际仍是明文 HTTP，浏览器会拒绝回传 Cookie，表现为「登录成功但立刻掉登录」。

### 5.2 必须覆盖 `X-Forwarded-For`

```nginx
proxy_set_header X-Forwarded-For $remote_addr;              # 正确：整体替换
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 错误：把客户端自带值追加在最左
```

应用开启 `TRUST_PROXY=true` 后取 `X-Forwarded-For` 的**最左值**作为限流键。`$proxy_add_x_forwarded_for` 会保留客户端伪造值并置于最左，导致限流被绕过；`$remote_addr` 用代理实际看到的对端地址替换整个头。多层代理（CDN + nginx）时应在**边缘**做覆盖。

### 5.3 SSE 必须关闭代理缓冲

`GET /api/events` 是长连接事件流（25 秒心跳）。反向代理需单独一个 `location = /api/events`：

```nginx
proxy_buffering off;
proxy_cache off;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_read_timeout 3600s;
```

若出现「打开页面后消息不刷新、刷新才出现」，优先检查 `proxy_buffering` 与 `proxy_read_timeout`。

### 5.4 请求体上限对应

应用侧请求体上限是 1MB，nginx 侧应保持一致：`client_max_body_size 1m;`。若业务需要调大，**同时**改两处。

### 5.5 OAuth 回调与配置步骤

`redirect_uri` 由系统设置里的 `ServerAddress` 优先拼装（其次 `PUBLIC_BASE_URL`，都没有才回退 `http://127.0.0.1:<PORT>`），即 `<基址>/api/auth/oauth/<provider-id>/callback`，**不读请求头**。实际生效的基址可在「系统设置 → OAuth2」每个提供方的回调地址处看到并复制（接口 `GET /api/options/oauth2/callback` 返回 `{base_url, source}`）。换域名 / 换端口后，必须到身份提供方登记新的完整 URI，否则 IdP 会以 `redirect_uri_mismatch` 拒绝。基址必须与浏览器地址栏的 scheme/host/port 完全一致。

配置步骤：

1. 复制 `deploy/nginx.conf.example`，替换 `server_name`、证书路径、`upstream` 地址。
2. 应用侧设置 `PUBLIC_BASE_URL=https://<域名>`、`TRUST_PROXY=true`、`COOKIE_SECURE=true`，重启。
3. `nginx -t` 通过后 reload；确认 80→443 跳转生效。
4. 快速验证：登录响应 `Set-Cookie` 应含 `Secure; HttpOnly; SameSite=Lax`；OAuth `start` 的 `Location` 中 `redirect_uri` 应为 https 域名；`curl -N https://<域名>/api/events` 应持续收到心跳。
5. 到身份提供方登记新回调 URI，并做一次真实登录验证。

> 正式上线须使用受信证书，并把 IdP 侧回调、DNS、HSTS 一并切换。

## 6. 备份与还原

镜像里没有 `sqlite3` CLI，备份走**短暂停机 + 归档**，停机后归档可以保证数据一致。

```bash
# 备份：停容器 → 归档 → 自动重启，产出 backups/nectarpush-<时间戳>.tar.gz + sha256
./deploy/backup.sh -c nectarpush

# 还原：非空目标必须显式 --force（会清空目标内现有数据）
./deploy/restore.sh backups/nectarpush-<时间戳>.tar.gz -c nectarpush --force
```

默认目标是宿主机目录 `deploy/data/`（compose 的绑定挂载），脚本直接在宿主机用 `tar` 打包/解包，不需要辅助镜像。加 `-v deploy_nectarpush-data` 则回到旧的 Docker 卷模式（需要含 `tar` 的辅助镜像，默认 `deploy-nectarpush:latest`，可用 `NP_IMAGE` 指定）。

脚本选项：`-d/--dir` 指定数据目录、`-v/--volume` 指定数据卷、`-o/--out` 指定备份输出目录、`-c/--container` 指定停启的容器；`NP_DATA` / `NP_VOLUME` / `NP_BACKUP_DIR` / `NP_CONTAINER` 可覆盖默认值。

## 7. 升级与回滚

### 7.1 升级

```bash
./deploy/backup.sh -c nectarpush     # 先备份

cd deploy
# 用预构建镜像时：改 .env 里的 NECTARPUSH_VERSION，再拉取
docker compose pull
docker compose up -d --no-build

# 从源码构建时改为：
# docker compose down && docker compose up -d --build
curl -fsS http://127.0.0.1:3000/api/health
```

入口脚本会在启动前执行 `prisma migrate deploy`（可重复执行，不会重复建表）。升级后检查：`/` 返回 HTML、`/api/health` 200、登录、消息列表、公开页。

#### 从 0.1.x 命名卷升级

0.1.0 及更早的 compose 把数据放在命名卷 `deploy_nectarpush-data`；0.1.1 起改为 `deploy/data/` 绑定挂载，旧卷**不会自动迁移**。先备份旧卷，再还原到新目录（在仓库根目录执行）：

```bash
./deploy/backup.sh -v deploy_nectarpush-data -c nectarpush -o backups
./deploy/restore.sh backups/nectarpush-<时间戳>.tar.gz -d deploy/data -c nectarpush --force
```

卷模式需要含 `tar` 的辅助镜像，默认 `deploy-nectarpush:latest`；本机没有该镜像时用 `NP_IMAGE=<含 tar 的镜像>` 指定。也可以不迁移，把 `deploy/docker-compose.yml` 的 `volumes` 改回 `deploy_nectarpush-data:/data` 继续用旧卷。

### 7.2 回滚

1. 保留上一版本镜像 tag（不要只用 `latest`）。
2. `./deploy/backup.sh -c nectarpush` 留一份当前状态。
3. `docker compose down`（保留 `deploy/data/`，不要删除绑定挂载目录）。
4. 如有破坏性变更：`./deploy/restore.sh backups/<归档> -c nectarpush --force`。
5. 用上一版本镜像 `docker compose up -d`。
6. 验证 `/api/health`、登录、消息 / 通道数量。

> 如果新版本已执行破坏性迁移，仅回滚镜像可能不兼容；以数据库备份恢复为准。回滚前先确认迁移是否可逆。

## 8. 通道与真实到达状态

**核心通道（10）**

| 类型 | 名称 | 实测发送 | 说明 |
| --- | --- | --- | --- |
| `none` | 不推送（已从新建列表隐藏） | ✅ 已验证 | 仅保存到本地数据库 / 直接成功，无外发依赖 |
| `group` | 群组 | ✅ 已验证 | 父消息聚合，分发给已验证的子通道 |
| `email` | 邮件 | ✅ 已验证 | 真实投递到收件箱；接生产邮件服务商注意 SPF/DKIM |
| `telegram` | Telegram | ⚠️ 只测过发送失败的情况 | 需 Bot Token / Chat ID；成功发送还没验证 |
| `discord` | Discord | 未实测 | 需 Webhook URL |
| `ding` | 钉钉 | 未实测 | 需 Webhook URL + 加签 Secret |
| `lark` | 飞书 | 未实测 | 需 Webhook URL + 签名密钥 |
| `bark` | Bark | 未实测 | 需 Push Key / 服务器地址 |
| `webhook` | Webhook（原 custom） | 未实测 | 需外部 HTTPS 端点 |
| `client` | WebSocket 客户端 | 未实测 | 还没做真实收发测试 |

**占位通道（6 个，`status: draft`）**：`test`、`corp_app`、`corp`、`lark_app`、`one_bot`、`tencent_alarm`。只有配置表单、能力标记与占位实现，**全部还没用真实凭据实测发送，不能用于生产**。其中 `tencent_alarm` 以 `description` 作为告警内容，`title` 不保证进入告警。

## 9. 已知限制

- 当前版本只在 **SQLite** 上测试过。切换 MySQL / PostgreSQL 需修改 Prisma datasource provider 并生成对应迁移，未做测试。
- `ENCRYPTION_KEY` 必须保持稳定；接口定义以 [openapi.yaml](openapi.yaml) 为准，升级客户端前先比对枚举与状态码。
- 多数核心通道也还没用真实凭据实测发送（见 §8）；欢迎反馈实测结果。
