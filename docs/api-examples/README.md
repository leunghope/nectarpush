# NectarPush API 示例集

配合 [`API.md`](../API.md) 阅读。示例里的域名统一用 `https://push.example.com`，令牌都是假值，替换成自己的即可直接运行。

- `push.http` — REST Client（VS Code REST Client / JetBrains HTTP Client）可直接执行的认证、推送、通道、消息、Webhook、管理全流程请求。
- `push.flows.sh` — 可复制粘贴的 curl 脚本片段（登录拿 Cookie → 建通道 → 测试 → 推送 → 异步轮询 → Webhook 触发）。
