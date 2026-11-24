#!/usr/bin/env bash
# NectarPush curl 示例片段 —— 逐段复制执行。
# 变量按需替换。jq 仅用于美化输出，可选。

HOST="https://push.example.com"
USERNAME="hope"
TOKEN="e5f60718293a4b5c6d7e8f9a0b1c2d34"

# ---------- 1. 登录（会话 Cookie 存 cookies.txt） ----------
curl -sS -X POST "$HOST/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"hope","password":"h0pe!pass42"}' \
  -c cookies.txt | jq .

# ---------- 2. 新建通道（Telegram） ----------
curl -sS -X POST "$HOST/api/channels" \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{
        "name": "my-tg",
        "type": "telegram",
        "config": {"secret": "123456:ABC-DEF...", "account_id": "-1001234567890"}
      }' | jq .

# ---------- 3. 测试通道发送 ----------
curl -sS -X POST "$HOST/api/channels/42/test" \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{}' | jq .

# ---------- 4. 同步推送（query token + 广播 @all） ----------
curl -sS "$HOST/push/$USERNAME?title=部署完成&description=服务已重启&to=@all&token=$TOKEN" | jq .

# ---------- 5. 异步推送 + 轮询状态 ----------
UUID=$(curl -sS -X POST "$HOST/push/$USERNAME?async=true&token=$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"备份","description":"db dump ok","async":"true"}' \
  | jq -r '.data.uuid')
echo "uuid=$UUID"
curl -sS "$HOST/api/messages/$UUID/status" | jq .

# ---------- 6. Webhook 触发（免令牌） ----------
curl -sS -X POST "$HOST/webhook/7c9f1d2e3b4a5f60718293a4b5c6d7e8" \
  -H 'Content-Type: application/json' \
  -d '{"action":"starred",
       "repository":{"full_name":"hope/nectarpush","stargazers_count":128},
       "sender":{"login":"someone"}}' | jq .

# ---------- 7. 消息列表（筛选失败） ----------
curl -sS -b cookies.txt \
  "$HOST/api/messages?page=1&page_size=10&status=failed&channel=my-tg" | jq .

# ---------- 8. SSE 订阅（Ctrl-C 退出） ----------
curl -N -b cookies.txt "$HOST/api/events"
