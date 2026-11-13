# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.0]: https://github.com/leunghope/nectarpush/releases/tag/v0.1.0
