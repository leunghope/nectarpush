# 安全政策

## 支持的版本

| 版本 | 支持状态 |
| --- | --- |
| 0.1.x | ✅ 接收安全修复 |
| 更早 | ❌ 不再维护 |

## 报告漏洞

请不要为安全漏洞创建公开 Issue。

使用 GitHub 的**私密漏洞报告**：进入仓库的 **Security → Report a vulnerability**，提交细节。我们会在确认后尽快响应，并在修复发布前与你保持沟通。

报告时请尽量包含：复现步骤、影响范围、可能的修复建议。

## 部署安全要点

NectarPush 的安全默认值需要正确的部署配置才能生效，上线前请确认：

- **立即修改初始密码**：默认 `root / 123456` 首次登录强制改密，不要把初始密码留在任何环境。
- **`SESSION_SECRET`**：必填，32+ 字节随机串；轮换会使全部会话失效。
- **`ENCRYPTION_KEY`**：通道凭据 AES-256-GCM 加密密钥；一旦有加密数据不可随意更换。
- **`CORS_ORIGINS`**：生产必须设置，否则任意站点都能用用户 Cookie 调用接口。
- **`TRUST_PROXY`**：默认 `false`；仅在反向代理**覆盖** `X-Forwarded-For` 后才设为 `true`，否则限流可被伪造头绕过。
- **HTTPS**：设置 `PUBLIC_BASE_URL=https://…` 或 `COOKIE_SECURE=true`，使会话 Cookie 带 `Secure`。

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
