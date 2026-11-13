# NectarPush（蜂鸟推送）API 文档

> 接口定义以 [`openapi.yaml`](openapi.yaml)（OpenAPI 3.1）为准；两者不一致时，以它为准。
>
> 本文件面向使用者：认证 → 推送快速上手（curl / python / js）→ 各资源 CRUD → 实时（SSE / WebSocket）→ 错误码表 → 变更记录。

---

## 1. 基础约定

- **Base URL**：`http://127.0.0.1:3000`（示例统一用 `https://push.example.com`）。
- **统一的响应格式**：成功 `{ "success": true, "message"?, "data"? }`；失败 `{ "success": false, "message": "…", "code": "…" }`。HTTP 语义保留：401 鉴权失败、403 无权/禁用、404 不存在、422 校验/依赖失败、429 限流。
- **时间**：ISO 8601 UTC（如 `2026-11-08T14:03:22Z`）。
- **分页**：`?page=1&page_size=10`（page_size ≤ 100），响应 `data.page = { page, page_size, total, total_pages }`。
- **语言**：接口文案为简体中文；代码标识符英文。

### 1.1 认证与鉴权（两级）

| 场景 | 方式 |
| --- | --- |
| Web 控制台 API（`/api/**`） | 会话 Cookie `np_session`（登录后 `Set-Cookie`，HttpOnly）；或 `Authorization: Bearer <用户全局令牌>` |
| 推送 `/push/{username}` | **推送令牌有两种**：用户全局令牌或目标通道令牌，**任一设置即必须匹配**；都未设置则开放。令牌可放 query `?token=`、请求体 `token` 字段、或 `Authorization: Bearer` |
| Webhook 触发 `POST /webhook/{name}` | 免令牌（link 即 32 位不可预测短链） |
| `GET /api/messages/{uuid}/status`、`/api/public/*`、`/api/health`、`/api/version` | 公开 |

- 令牌错误时：缺令牌 → 401 `TOKEN_REQUIRED`「通道维度或用户维度设置了鉴权令牌，需要提供鉴权令牌」；令牌错 → 401 `INVALID_TOKEN`「无效的 token」。
- **root 首次登录强制改密**：首次启动内置 `root/123456`；登录响应 `must_change_password=true` 时，前端会强制跳转到改密页；改密走 `PATCH /api/me`（带 `old_password`）。
- **Turnstile**：启用后注册/验证码/重置等敏感请求需带 `turnstile_token`。

---

## 2. 推送快速上手

### 2.1 字段速查（`GET|POST /push/{username}`）

| 参数 | 必填 | 说明 / 别名 |
| --- | --- | --- |
| `title` | 否 | 标题；缺省用系统名 |
| `description` | 否 | 纯文本正文；别名 `short` |
| `content` | 否 | 长文 / Markdown 源；别名 `desp` |
| `url` | 否 | 点击跳转链接 |
| `channel` | 否 | 目标通道名；缺省用户默认通道 → 再缺省 `email` |
| `token` | 条件 | 推送令牌（见 §1.1） |
| `to` | 否 | `@all` 广播全部启用通道；`a|b` 多目标；别名 `openid` |
| `async` | 否 | `"true"` 异步（立即返回 uuid；需消息持久化权限，否则 422 `ASYNC_NOT_ALLOWED`） |
| `render_mode` | 否 | `markdown`（默认）/ `code`（content 包成代码块）/ `raw` |

成功返回：`{ "success": true, "message": "", "data": { "uuid": "…" } }`（未持久化时 `uuid` 为 `"unsaved"`）。

### 2.2 curl

```bash
# GET（Server酱 风格，query 推送）
curl 'https://push.example.com/push/hope?title=部署完成&description=服务已重启&to=@all&token=e5f60718293a4b5c6d7e8f9a0b1c2d34'

# POST JSON + 异步 + Bearer 令牌
curl -X POST 'https://push.example.com/push/hope' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer e5f60718293a4b5c6d7e8f9a0b1c2d34' \
  -d '{
    "title": "构建失败",
    "content": "# 构建日志\n```text\nexit 1\n```",
    "channel": "my-ding",
    "to": "@all",
    "async": "true",
    "render_mode": "markdown"
  }'

# 查询异步状态（公开）
curl 'https://push.example.com/api/messages/9f8b2a1c7d6e4f0a3b2c1d0e9f8a7b6c/status'
```

### 2.3 Python（requests）

```python
import requests

BASE = "https://push.example.com"
TOKEN = "e5f60718293a4b5c6d7e8f9a0b1c2d34"

# 同步推送
r = requests.post(
    f"{BASE}/push/hope",
    json={"title": "训练完成", "description": "loss=0.42", "channel": "my-tg"},
    params={"token": TOKEN},  # token 也可放 body 或 Authorization 头
)
print(r.json())  # {'success': True, 'message': '', 'data': {'uuid': '…'}}

# 异步推送 + 轮询状态
r = requests.post(f"{BASE}/push/hope", params={"async": "true", "token": TOKEN},
                  json={"title": "备份", "description": "db dump ok", "async": "true"})
uuid = r.json()["data"]["uuid"]
status = requests.get(f"{BASE}/api/messages/{uuid}/status").json()["data"]["status"]
print(status)  # async_pending -> success / partial / failed
```

### 2.4 JavaScript（fetch）

```js
const BASE = "https://push.example.com";
const TOKEN = "e5f60718293a4b5c6d7e8f9a0b1c2d34";

// POST JSON 推送（别名演示：desp -> content, openid -> to）
const res = await fetch(`${BASE}/push/hope?token=${TOKEN}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "新评论",
    desp: "# 有人评论了你的博客",
    channel: "email",
    openid: "@all",
  }),
});
const body = await res.json();
console.log(body); // { success: true, message: '', data: { uuid: '…' } }

// SSE 订阅（控制台，需会话 Cookie）
const es = new EventSource(`${BASE}/api/events`);
es.addEventListener("message.created", (e) => console.log("新消息", JSON.parse(e.data)));
es.addEventListener("delivery.updated", (e) => console.log("投递更新", JSON.parse(e.data)));
```

---

## 3. 认证（auth）

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/auth/register` | POST | 公开 | 用户名 ≤12 唯一、密码 8–20；受注册/密码注册开关与 Turnstile 约束 |
| `/api/auth/login` | POST | 公开 | 成功 Set-Cookie；返回 `user` + `must_change_password`（root 首次登录为 true） |
| `/api/auth/logout` | POST | 用户 | 清除会话 |
| `/api/auth/verification` | POST | 公开 | 发邮箱验证码（注册/绑定用，临界限流） |
| `/api/auth/reset-request` | POST | 公开 | 发找回密码邮件（不泄露邮箱存在性） |
| `/api/auth/reset-confirm` | POST | 公开 | 凭 `email`+`token` 重置，**直接返回一次性随机 12 位新密码** |
| `/api/auth/oauth/providers` | GET | 公开 | 已配置的登录方式 `{items:[{id,display_name}]}`（供登录页渲染按钮，不含任何凭据） |
| `/api/auth/oauth/{provider}/start` | GET | 公开 | 302 跳转 Provider 授权页（`github` 预设 + 自定义 Provider；**无微信 OAuth**） |
| `/api/auth/oauth/{provider}/callback` | GET | 公开 | 授权码回调：换 token → userinfo → 字段映射建号/绑定 → 建会话；失败 302 到前端错误页（`/login?oauth_error=` 或 `/me?oauth_error=`） |

自定义 OAuth2 Provider 以 Option `OAuth2Providers` 配置（JSON 数组：`id / display_name / authorize_url / token_url / userinfo_url / client_id / client_secret / scope / map_username / map_email / discovery_url`，client_secret 为敏感项不回显）。`discovery_url` 记录 OIDC 发现端点，仅用于下次一键刷新端点。注册开关关闭时，OAuth 仅允许已绑定用户登录，不再自动建号。

```bash
curl -X POST 'https://push.example.com/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username": "hope", "password": "h0pe!pass42"}' -c cookies.txt
```

---

## 4. 通道（channels）

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/channels` | GET | 用户 | 自己的通道列表（`?keyword=` 搜索、`?brief=true` 精简） |
| `/api/channels` | POST | 用户 | 新建（名称 1–20、本人唯一、保留名 `email` 不可手动创建）；带 `token` 时响应一次性返回 `access_token` 明文 |
| `/api/channels/{id}` | GET | 用户 | 详情（**config 敏感字段返回 `******`；通道级令牌永不回显**） |
| `/api/channels/{id}` | PATCH | 用户 | 编辑；`status_only=true` 仅切换 `enabled`；敏感字段留空 = 不修改 |
| `/api/channels/{id}` | DELETE | 用户 | 删除（清理令牌缓存） |
| `/api/channels/{id}/test` | POST | 用户 | 测试发送（默认用通道默认目标；email 可临时指定 `to`） |
| `/api/channels/{id}/token` | POST | 用户 | **重新生成/设置通道级推送令牌**；明文仅本次返回，旧值立即失效 |
| `/api/channels/types` | GET | 用户 | **16 类通道清单**（见 §4.1） |

- 敏感配置 AES-GCM 加密后写入数据库（密钥独立可配），接口不返回明文。

### 4.1 通道类型清单（驱动动态表单）

`GET /api/channels/types` 每项含：

- `type` / `display_name` / `status`（`core`｜`draft`，draft=占位，还没做完）；
- `capabilities`：`title/description/content/url/to/markdown` 布尔位 + **`to_mode`**（`recipient` 收件人 / `@mention` @成员 / `chat` 会话目标 / `none` 无 to）→ 前端据此显隐字段、切换 to 文案与校验；
- `config_schema.fields[]`：`{ key, label, type(string|password|number|boolean|select|multiselect|textarea), required, secret, placeholder?, help?, default?, options? }` → 前端据此渲染动态表单；`secret=true` 渲染密码框、响应不返回明文、写入数据库前加密。

16 类（QQ 通道为 **`one_bot`**，不用 `one_api`）：

| type | 中文名 | status | 备注 |
| --- | --- | --- | --- |
| email | 邮件 | core | 绑定邮箱自动创建，通道名保留 |
| telegram | Telegram | core | secret=Bot Token，account_id=Chat ID |
| discord | Discord | core | url=Webhook |
| ding | 钉钉群机器人 | core | url+secret（加签） |
| lark | 飞书群机器人 | core | url+secret（签名） |
| bark | Bark | core | url（可空默认）+secret（Push Key） |
| custom | 自定义 | core | url 必须 HTTPS 且禁指向本服务；other=JSON 模板（`$title/$description/$content/$url/$to`） |
| client | WebSocket 客户端 | core | secret=连接密钥；协议见 §8.2 |
| group | 群组 | core | 分发给子通道，父状态按各子通道结果汇总（success/partial/failed） |
| none | 不推送 | core | 只存入数据库 |
| test | 微信测试号 | draft | 占位 |
| corp_app | 企微应用号 | draft | 占位 |
| corp | 企微群机器人 | draft | 占位 |
| lark_app | 飞书自建应用 | draft | 占位 |
| one_bot | QQ(OneBot) | draft | 占位 |
| tencent_alarm | 腾讯云告警 | draft | 占位；title 不保证进入告警 |

---

## 5. 消息（messages）

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/messages` | GET | 用户 | 分页 + `keyword/status/channel/since/until` 筛选；列表精简，不含正文 |
| `/api/messages` | POST | 用户 | 控制台发送（免推送令牌；`async` 布尔） |
| `/api/messages` | DELETE | **root** | 清空**自己**的全部消息（只删本人） |
| `/api/messages/{id}` | GET | 用户 | 详情（正文 + `deliveries[]` 投递明细：子通道/状态/耗时/错误） |
| `/api/messages/{id}` | DELETE | 用户 | 删除单条 |
| `/api/messages/{id}/resend` | POST | 用户 | 重发（新记录新 uuid，原消息保留） |
| `/api/messages/{uuid}/status` | GET | **公开** | 异步状态轮询：`pending/async_pending/success/partial/failed` |

---

## 6. Webhook（由外部事件触发推送）

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/webhooks` | GET/POST | 用户 | 列表（含 `trigger_url`）/ 新建（服务端生成 32 位不可预测 `link`） |
| `/api/webhooks/{id}` | GET/PATCH/DELETE | 用户 | 详情 / 编辑（`status_only` 仅启停）/ 删除 |
| `/webhook/{name}` | POST | **免令牌** | 外部触发；`name` 即 32 位 `link` |

**映射规则**：`extract_rule`（键 → 请求体 JSON 路径，如 `repo: repository.full_name`）取值 → 替换 `construct_rule`（消息字段模板，`$键` 引用）→ 组装 PushMessage → 交给推送流程。不存在→404；未启用→403。

```bash
curl -X POST 'https://push.example.com/webhook/7c9f1d2e3b4a5f60718293a4b5c6d7e8' \
  -H 'Content-Type: application/json' \
  -d '{"action":"starred","repository":{"full_name":"hope/nectarpush","stargazers_count":128},"sender":{"login":"someone"}}'
# -> {"success":true,"message":"","data":{"uuid":"…"}}
```

---

## 7. 用户 / 设置 / 公开

### 7.1 用户管理（admin，管理员不能操作同级或更高权限的用户）

- `GET /api/users`（分页+搜索）、`POST /api/users`（不可创建 ≥ 自身权限者）；
- `GET/PATCH/DELETE /api/users/{id}`（PATCH 允许修改：用户名/显示名/密码；DELETE 软删+匿名化）；
- `POST /api/users/{id}/manage`：`enable | disable | promote | demote | allow_send_email_to_others | disallow_send_email_to_others | allow_save_message | disallow_save_message`（仅 root 可提升为 admin；不可禁用/删除 root）。

### 7.2 当前用户

- `GET/PATCH/DELETE /api/me`：允许修改的资料字段（username/display_name/email/email_code/password/default_channel）；改密码时已有密码需 `old_password`，OAuth 首次建号（无密码）可直接设置；DELETE = 注销（软删匿名化 + 清令牌缓存）。
- `PATCH /api/me` 修改 `email`：已配置 SMTP 时必须同时提交 6 位 `email_code`（与 `EmailVerificationEnabled` 无关）；未配置 SMTP 可直接保存，但该邮箱暂时无法用于找回密码；修改成功自动同步（或创建/停用）`email` 通道；提交空串或 `null` 清空邮箱。
- `GET /api/me/security`：返回 `has_password`、`email_verification_enabled`、`email_change_requires_code`、`oauth.bound`（provider/display_name/oauth_id）与 `oauth.providers`。
- `POST /api/me/email/verification`：`{email}` 发送邮箱变更验证码；未配置 SMTP 时返回 `{sent:false,required:false}` 并提示邮箱仍可保存。
- `GET /api/me/oauth/{provider}/start`：302 发起绑定；`DELETE /api/me/oauth`：解绑（无密码账号需先设置密码，否则 422）。
- `POST /api/me/token`：生成/重置全局推送令牌（去掉连字符的 UUID；**仅本次完整返回**，旧令牌立即失效）。
- `GET/PATCH /api/me/push`：推送设置（默认通道、令牌掩码、push_endpoint、可复制示例）。

### 7.3 系统设置（root）

- `GET /api/options`：全部 Option（键名含 Token/Secret/Password 的敏感项**不回显明文**，仅 `configured` 标记）；
- `PATCH /api/options`：`{ key, value }` 单项更新；启用 OAuth2/Turnstile/邮箱验证前校验依赖已填，缺失 → 422 `DEPENDENCY_MISSING`。
- `POST /api/options/oauth2/discover`：`{ url }` 拉取 OIDC 发现文档并自动填入 `authorize_url / token_url / userinfo_url / scope / map_username / map_email`，返回 `warnings`（如缺 userinfo_endpoint）；URL 非法 422，上游不可用 502 `OAUTH_DISCOVERY_FAILED`。
- 常用键：`SystemName / ServerAddress / RegisterEnabled / PasswordLoginEnabled / EmailVerificationEnabled / MessagePersistenceEnabled / MessageRenderEnabled / SMTPServer / SMTPAccount / SMTPPort / SMTPToken / OAuth2Providers / TurnstileCheckEnabled / TurnstileSiteKey / TurnstileSecretKey / Notice / About / Footer / HomePageLink`。

### 7.4 公开

`GET /api/public/about`、`GET /api/public/announcement`、`GET /api/health`、`GET /api/version`（均免鉴权，全局限流保护）。

---

## 8. 实时

### 8.1 SSE（`GET /api/events`，登录用户）

`text/event-stream` 长连接；每 25s 注释行心跳。事件：

| event | data（JSON） | 触发 |
| --- | --- | --- |
| `message.created` | MessageSummary | 新消息写入数据库 |
| `delivery.updated` | MessageDelivery（含 message_id） | 投递明细状态变化 |
| `heartbeat` | 注释行 `: heartbeat` | 保活 |

断线后前端会自动重连，并重新拉取一次列表。

### 8.2 WebSocket 客户端通道（`GET /ws/client`）

> 本端点为协议升级（HTTP 101），不属 REST，故在 openapi.yaml 中以说明形式登记（realtime tag 描述），协议以本节为准。

- **握手**：`GET /ws/client?username={用户名}&channel={通道名}&secret={连接密钥}`。鉴权用 **client 通道的连接密钥（channel.config.secret）**，不是推送令牌。失败：401（密钥错误）/ 404（用户或通道不存在）。
- **单连接**：每个「通道:用户」仅保留 1 条连接；新连接成功后，旧连接会收到下线提示帧，并被服务端断开。
- **欢迎帧**（连接成功立即下发）：

```json
{ "type": "welcome", "message": "客户端连接成功" }
```

- **心跳**：服务端每 ~56s 发 ping；客户端须 60s 内回 pong，超时断开。

```json
{ "type": "ping" }   // ->
{ "type": "pong" }
```

- **下行消息帧**（推送投递到该通道）：

```json
{
  "type": "message",
  "title": "部署完成",
  "description": "服务已重启",
  "content": "# 详情…",
  "html_content": "<h1>详情…</h1>",
  "url": "https://example.com/log",
  "render_mode": "markdown"
}
```

- **未连接时**：向该 client 通道推送返回错误「客户端未连接」（`code: CLIENT_NOT_CONNECTED`）。

---

## 9. 限流

| 端点类别 | 限制 |
| --- | --- |
| 全局 API / Web | 60 次 / 3 分钟 |
| 临界端点（注册/登录/验证码/重置） | 20 次 / 20 分钟 |
| 超限 | 429 `{ success:false, message:"操作过于频繁，请稍后再试", code:"RATE_LIMITED" }` |

---

## 10. 错误码表

| code | HTTP | message 示例 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未登录或会话已过期 |
| `TOKEN_REQUIRED` | 401 | 通道维度或用户维度设置了鉴权令牌，需要提供鉴权令牌 |
| `INVALID_TOKEN` | 401 | 无效的 token |
| `FORBIDDEN` | 403 | 无权执行该操作 / 管理员关闭了新用户注册 / Webhook 未启用 |
| `NOT_FOUND` | 404 | 消息不存在 / 渠道不存在 |
| `USER_NOT_FOUND` | 404 | 用户不存在 |
| `USER_DISABLED` | 403 | 用户已被封禁 |
| `CHANNEL_NOT_FOUND` | 404 | 无效的渠道名称 |
| `CHANNEL_DISABLED` | 403 | 该渠道已被禁用 |
| `CHANNEL_NAME_RESERVED` | 422 | 通道名 email 为保留名 |
| `DUPLICATE_NAME` | 422 | 名称已存在 |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook 不存在 |
| `WEBHOOK_DISABLED` | 403 | Webhook 未启用 |
| `VALIDATION_FAILED` | 422 | 参数校验失败（details 附字段错误） |
| `ASYNC_NOT_ALLOWED` | 422 | 异步发送消息需要用户具备消息持久化的权限 |
| `SMTP_NOT_CONFIGURED` | 422 | 邮件服务未配置 |
| `CLIENT_NOT_CONNECTED` | 422 | 客户端未连接 |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 403 | OAuth2 Provider 未配置或未启用 |
| `OAUTH_ALREADY_BOUND` | 409 | 该第三方账号已绑定其他用户 |
| `OAUTH_DISCOVERY_FAILED` | 502 | OIDC 发现端点不可用或返回文档不合法 |
| `DEPENDENCY_MISSING` | 422 | 启用前需先填写依赖配置 |
| `RATE_LIMITED` | 429 | 操作过于频繁，请稍后再试 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 11. 安全与数据处理说明（对外承诺）

- 通道密钥 AES-GCM 加密存储（密钥独立可配），接口不返回明文（显示为 `******`）。
- 系统设置敏感项（Token/Secret/Password 键）不回显明文。
- 注销账号 = 软删除 + 匿名化（消息/通道保留归属但不含个人信息）。
- root 首次登录 / 密码重置后强制改密（`must_change_password`，未改密前服务端拦截）。
- 通用 OAuth2 授权码登录（GitHub 预设 + 自定义 Provider），支持登录、绑定与解绑；OIDC 发现端点可一键自动填入授权/Token/用户信息端点；**不支持微信登录**；**无附件/文件上传**；QQ 通道命名 **`one_bot`**。
- Markdown 渲染在服务端清洗（防 XSS，即防止往页面注入脚本）；custom 通道禁止 http 和指向本服务地址（防 SSRF，即防止服务端被诱导访问内网）。

---

## 12. 变更记录

| 版本 | 日期 | 变更 | 依据 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-08 | 初版定稿：覆盖认证、推送、消息、通道、Webhook、用户、系统设置与实时（SSE / WebSocket）全部能力；含 `POST /api/channels/{id}/test`、消息筛选、`to_mode`、Webhook 32 位 link、软删匿名化 | — |

> **变更规则**：任何接口 / 模型变更须先修改 [`openapi.yaml`](openapi.yaml) 并在本表登记。
