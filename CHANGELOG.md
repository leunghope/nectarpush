# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.1] - 2026-11-24

> 没有新功能、没有接口变化、没有数据迁移：本次只改镜像构建方式，功能与 0.2.0 完全一致，0.2.0 的数据卷可直接沿用。

### 构建

- **Docker 镜像瘦身约 40%**：生产依赖安装、Prisma Client 生成与安装残留清理合并进同一条 `RUN`（此前跨层删除只留 whiteout，镜像里实际带着 pnpm store、Prisma 引擎下载缓存与仅用于安装的全局 pnpm，合计约 250MB）；`binaryTargets` 收敛为 `["native"]`，按目标架构原生构建后不再额外生成一份跨架构引擎（33.5MB）。实测镜像真实占用 745.2MB → 449.9MB，`docker pull` 下载的压缩体积 260.3MB → 150.3MB，`docker images` 显示 1.08GB → 669MB；amd64 与 arm64 均已构建并跑通冒烟。无依赖变更、无数据库迁移，`pnpm-lock.yaml` 不变。
- pnpm 版本固定为 `10.30.3`（与根 `package.json` 的 `packageManager` 一致），避免构建期浮动版本导致依赖布局漂移。

## [0.2.0] - 2026-11-24

> 兼容新增能力：没有破坏性变更，也没有数据库迁移，0.1.1 可直接升级。

### 新增

- **5 类通道接入真实发送**：`test`（微信测试号模板消息）、`corp_app`（企微应用号）、`corp`（企微群机器人）、`lark_app`（飞书自建应用）、`one_bot`（QQ OneBot v11）。企业微信 / 飞书 / 微信的 access token 改为懒加载缓存：首次发送时取一次，缓存到上游声明有效期前 5 分钟，失效时自动重取，不必每条消息都换 token。
- **通道配置指引补齐**：5 类新增逐协议中文配置指引（摘要 / 步骤 / 文档链接 / 注意事项），随 `GET /api/channels/types` 的 `guide` 字段下发给前端；配置指引里「骨架未联调」的提示现在只在 `tencent_alarm` 上出现。

### 修复

- **WebSocket 客户端通道误报「客户端未连接」**：新连接顶替旧连接后，旧连接的清理逻辑会把新连接的注册项一起删掉，之后的推送找不到客户端。现在清理与心跳巡检都会校验连接归属，只处置自己那条连接，不再误踢当前在线客户端。

### 变更

- **5 类通道的 `status` 从 `draft` 变为 `core`**：`GET /api/channels/types` 现在返回 15 类 `core` + 1 类 `draft`（`tencent_alarm`），类型总数仍是 16。前端新建通道列表、按 `status` 取值的筛选或判断需要同步（README / `docs/API.md` / `docs/openapi.yaml` 已更新）。
- **验证口径**：上述 5 类验收到 A/B 级（mock 单测 + 契约 + 前端回归），**尚未用真实凭据实发确认到达**；`tencent_alarm` 仍为占位实现。投产后请逐类用「测试发送」确认到达。

## [0.1.1] - 2026-11-15

> **注意：0.1.1 只是 patch 版本号，但包含破坏性变更**（通道类型重命名、OAuth 接口调整、compose 数据落点改变）。升级前请先读本节与部署指南 §7.1。

### 破坏性变更

- **通道类型 `custom` 重命名为 `webhook`**：适配器标识、`GET /api/channels/types` 的输出，以及 `POST /api/channels` 的 `type` 字段现在都用 `webhook`。升级会自动执行迁移 `20261114160000_rename_custom_to_webhook` 改写已有通道行；历史消息记录保留发送当时的 `channelType`，作为审计痕迹。
- **解绑第三方登录改为按提供方删除**：`DELETE /api/me/oauth` 换成 `DELETE /api/me/oauth/{provider}`，一次只解绑一个提供方；支持多绑后，不再存在「一次解绑全部」的语义。
- **`GET /api/me/security` 的 OAuth 字段改为列表**：原来的单绑字段换成 `oauth.bindings[]`（当前用户每个提供方的绑定记录）与 `oauth.providers[]`（站内启用的提供方）；读取该接口的客户端需要按数组取值。
- **compose 的数据落点从命名卷改为宿主机目录**：`deploy/docker-compose.yml` 改为 `./data:/data` 绑定挂载，数据在 `deploy/data/`，`docker compose down -v` 与 Docker Desktop 重置都不会删除它。旧的命名卷 `deploy_nectarpush-data` **不会自动迁移**，升级前按部署指南 §7.1 备份并还原到新目录，或继续把 compose 改回旧卷方式。

### 新增

- **通道编辑页带逐协议中文配置指引**：`GET /api/channels/types` 的每个类型新增 `guide` 字段（摘要 / 步骤 / 文档链接 / 注意事项，来源 `apps/api/src/channels/guides.ts`），前端在「协议类型」下方直接渲染；新增通道类型只需补一条指引，前端无需按类型写分支。
- **站点品牌可配置**：系统设置新增站点英文名（`SiteEnglishName`）与站点图标（`SiteIcon`），并新增公开接口 `GET /api/public/branding`；浏览器标题、favicon、侧栏与登录页统一使用配置值，不再写死。
- **系统设置里的「版本更新」**：新增 `GET /api/update/check`（仅 root），读取 GitHub Release 并与当前版本比较，结果缓存 10 分钟（`?force=1` 跳过缓存）；上游可用 `UPDATE_CHECK_URL` 覆盖，需要更高配额时可设 `GITHUB_TOKEN`。
- **管理员可查看与解绑用户的第三方登录**：新增 `GET /api/users/{id}/oauth` 与 `DELETE /api/users/{id}/oauth/{provider}`；用户编辑页会列出该用户已绑定的提供方（含 OAuth ID），并可就地解绑，便于清理失效账号。

### 变更

- **通道列表改为表格**：名称 / 类型 / 说明 / 状态 / 创建时间 / 操作六列，去掉卡片网格；说明列吃掉剩余宽度并截断，状态与操作列右对齐。
- **通道编辑页改为单列布局**：协议类型改为下拉选择，选中后在下方展示该协议的配置指引与对应字段，不再平铺所有协议。
- **系统设置按模块独立保存并可折叠**：每个模块（邮件、站点、OAuth2…）各自「保存」，只提交本模块的字段；侧栏「管理」组移到最底部。
- **OAuth2 表单精简**：GitHub 只要显示名称 / Client ID / Client Secret 三项；自定义提供方只要四项 + OIDC 发现端点 + 图标，端点、scope 与字段映射由后端在保存时从发现端点补全；提供方可单独启用 / 停用，多个提供方以手风琴收起。
- **`OAuth2Providers` 配置形状随之调整**：每个提供方新增 `enabled` / `icon` / `discovery_url`，端点字段改为可省略（保存时由发现端点补全）；旧配置仍可读取，未提交的字段保持原值。
- **「不推送」（`none`）不再出现在新建通道的类型列表**：适配器保留注册，已有通道照常编辑与收发，用 API 创建 `type: "none"` 也仍然可用；`GET /api/channels/types` 的条目新增 `hidden` 字段供前端区分。
- **群组通道的子通道改为从已有通道中勾选**：`group` 的配置由「手填子通道 ID 列表」变为多选，候选是当前用户名下、非群组、排除自身的通道（含已停用者并标注「已停用」）；保存时服务端校验子通道归属，禁止自引用与群组嵌套，已失效的子通道会保留勾选并在表单上提示。
- **群组「测试发送」走真实扇出**：此前直接调用适配器必然失败（群组由发送管道扇出），现在按子通道逐个发送，并返回每个子通道的结果。
- **compose 构建支持注入版本与提交号**：`deploy/docker-compose.yml` 把 `APP_VERSION` / `GIT_COMMIT` 作为 build args 传给镜像，`/api/version` 与「检查更新」据此判断当前版本；本地不传时回退到 `package.json`。

### 修复

- **OAuth2 回调地址改用系统设置里的服务器地址**：此前 `redirect_uri` 只认环境变量 `PUBLIC_BASE_URL`，容器未配置时会拼成 `http://127.0.0.1:3000/api/auth/oauth/<id>/callback`，第三方（Authentik / Keycloak 等）因此报 `Redirect URI Error`。现在按「服务器地址 → `PUBLIC_BASE_URL` → 本地回退」取基址，登录、绑定与 token 交换三处使用同一个值；新增 `GET /api/options/oauth2/callback` 返回生效基址与来源。
- **设置页为每个 OAuth2 提供方展示回调地址**：不再只对 GitHub 显示，也不再用浏览器 origin 猜测；每个提供方都按服务端基址给出可复制的回调地址，回退到 127.0.0.1 时在页面顶部警告。
- **通道列表的「状态」「操作」两列改为右对齐**：状态列的开关与「已启用」文字此前无间距（包裹层用了不存在的样式类），操作按钮也未真正贴右；现两列一并右对齐、开关与文字留 8px 间距。
- **群组消息的投递明细改为逐子通道一行**：`GET /api/messages/{id}` 的 `deliveries[]` 现在为群组内每个子通道各一条（含各自的状态 / 耗时 / 错误），子通道被删除后会保留一条 `channel_id: null` 的失败记录；消息详情页的「状态」列显示该通道自己的投递结果，被截断的错误可展开查看全文。
- **新增 `POST /api/messages/{id}/retry`：只重试失败的投递项**：原位更新明细与该消息状态，不新建消息、不变更 uuid；消息详情页的「重试失败项」由「整条重发」换成该接口；没有失败项时返回 422。此前群组部分失败时点它会重新发送全部通道。
- **修复飞书群机器人发送报 `19002 unknown card value`**：消息卡片改为自定义机器人要求的顶层 `card` 字段（此前误用了 IM OpenAPI 的 `content` 包装）。

### 已知限制

- 原位重试不适用于「发往指定邮箱」的消息（`channel_type=email` 且 `to` 与通道绑定邮箱不同）：重试会绕过 `allowSendEmailToOthers` 授权与跨用户邮件限流，因此返回 422 并提示改用「重新发送」。
- 本次改造前发送的群组消息只有一条汇总投递行，无法拆分重试；详情页会提示其为旧版汇总记录。
- 「检查更新」依赖实例能访问 GitHub API；离线或受限网络可用 `UPDATE_CHECK_URL` 指向自建镜像，不设置时该功能只报错，不影响推送。
- 从 0.1.x 的命名卷迁移到 `deploy/data/` 需要手动执行（见部署指南 §7.1），没有自动迁移。

## [0.1.0] - 2026-11-13

首个公开版本。

### 新增

- **多渠道推送**：10 个核心通道（邮件 / Telegram / Discord / 钉钉 / 飞书 / Bark / 自定义 HTTP / WebSocket 客户端 / 群组 / 不推送），一条消息分发到多个目标。
- **Web 工作台**：仪表盘、快速发送、消息管理、通道管理、用户与系统设置，深色 / 浅色双主题。
- **Webhook 触发**：每通道一条不可预测触发 URL，支持 JSONPath 变量提取与模板规则。
- **实时消息流**：SSE（`/api/events`）按用户隔离推送；WebSocket 客户端通道双向收发。
- **异步推送**：`async=true` 立即返回消息 UUID，随后查询投递状态。
- **OAuth2 登录**：卡片式表单管理提供方，内置 GitHub 预设 + 自定义 OIDC Provider；首次登录强制改密。
- **消息公开分享**：按 UUID 生成公开页，Markdown 渲染经 DOMPurify 清洗。
- **安全默认**：通道凭据 AES-256-GCM 加密、接口不返回明文、自定义通道防 SSRF、分级限流。
- **单端口 Docker 部署**：API 与 SPA 同进程，一个镜像 + 一个数据卷；附备份 / 还原脚本与 nginx 模板。
- **预构建镜像**：`ghcr.io/leunghope/nectarpush`（amd64 / arm64），`docker pull` 即可运行，不必本地构建；推送版本标签时由 GitHub Actions 自动发布。

### 已知限制

- 只在 SQLite 上测试过；MySQL / PostgreSQL 未测试。
- 6 个占位通道（`test` / `corp_app` / `corp` / `lark_app` / `one_bot` / `tencent_alarm`）还没接入真实服务，不可用于生产。
- 多数核心通道的真实到达尚未验证。

[0.2.0]: https://github.com/leunghope/nectarpush/releases/tag/v0.2.0
[0.1.1]: https://github.com/leunghope/nectarpush/releases/tag/v0.1.1
[0.1.0]: https://github.com/leunghope/nectarpush/releases/tag/v0.1.0
