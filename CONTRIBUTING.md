# 贡献指南

感谢你有兴趣为 NectarPush 做贡献。

## 开发环境

- Node.js 22
- pnpm 10.30.3（`corepack enable` 后由 `packageManager` 字段自动锁定）
- Docker（可选，用于部署相关改动）

```bash
pnpm install --frozen-lockfile

pnpm --filter api dev      # API（默认 http://127.0.0.1:3000）
pnpm --filter web dev      # Web（Vite 开发服务器）
```

## 提交前校验

所有改动必须通过完整检查：

```bash
pnpm run verify            # 类型检查 + 构建 + API 单测 + Web 单测 + e2e
```

e2e 直接启动构建产物，因此检查脚本会先构建再跑 Playwright。涉及部署的改动请额外验证 `docker build -f deploy/Dockerfile .`。

## 约定

- **界面文案用简体中文，代码与注释用英文**。
- 接口定义以 `docs/openapi.yaml` 为准；任何接口 / 模型变更先改它，再同步 `docs/API.md` 与实现。
- 不要提交密钥、凭据、`.env`、个人域名或内网地址；测试数据使用 `example.com` / `127.0.0.1` 等占位值。
- 提交信息简洁描述「做了什么、为什么」；一个 PR 聚焦一件事。

## Pull Request

1. 从 `main` 切出分支。
2. 完成改动并通过 `pnpm run verify`。
3. 更新相关文档（接口定义 / API / 部署）。
4. 填写 PR 模板，说明动机与验证方式。

## 报告问题

- 功能缺陷 / 需求：使用 Issue 模板。
- 安全漏洞：请走 [SECURITY.md](SECURITY.md) 的私密报告渠道，不要公开 Issue。
