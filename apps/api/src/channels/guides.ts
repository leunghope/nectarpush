/**
 * 每种通道类型的中文配置指引（前端在「协议类型」下方渲染）。
 *
 * 这里是唯一的指引来源：新增通道类型时同步补一条，ChannelsService.types()
 * 会把 guide 合并进 descriptor，前端无需按 type 写分支。
 */
export interface ChannelGuide {
  summary: string;
  steps: string[];
  links: { label: string; url: string }[];
  note?: string;
}

export const CHANNEL_GUIDES: Record<string, ChannelGuide> = {
  email: {
    summary: '把消息发送到邮箱；绑定邮箱后系统会自动创建同名通道。',
    steps: [
      '在「个人设置」中绑定并验证邮箱。',
      '发送时目标填自己的邮箱；向他人邮箱发送需要管理员授权。',
      '通道名称固定为 email，删除后重新绑定会再次创建。',
    ],
    links: [{ label: '邮件通道说明', url: 'https://github.com/leunghope/nectarpush#readme' }],
  },
  telegram: {
    summary: '通过 Telegram 机器人把消息发到指定会话。',
    steps: [
      '在 @BotFather 创建机器人并复制 Bot Token。',
      '给机器人发送一条消息，再通过 @userinfobot 或 getUpdates 获取 Chat ID。',
      '把 Token 与 Chat ID 填入下方字段并保存。',
    ],
    links: [
      { label: '创建机器人', url: 'https://core.telegram.org/bots#how-do-i-create-a-bot' },
      { label: '获取 Chat ID', url: 'https://api.telegram.org/bots/api#getupdates' },
    ],
    note: 'Token 泄露等同于机器人被接管，请勿分享。',
  },
  discord: {
    summary: '向 Discord 频道发送消息，使用频道 Webhook 地址。',
    steps: [
      '打开频道设置 → 整合 → Webhook。',
      '新建 Webhook 并复制 Webhook URL。',
      '把 URL 填入下方字段并保存。',
    ],
    links: [{ label: 'Discord Webhook 文档', url: 'https://support.discord.com/hc/articles/228383668' }],
  },
  ding: {
    summary: '向钉钉群发送消息，支持加签校验。',
    steps: [
      '在钉钉群设置 → 机器人 → 添加自定义机器人。',
      '安全设置选择「加签」，复制 Webhook 地址与加签密钥。',
      '分别填入 url 与 secret 字段。',
    ],
    links: [{ label: '钉钉自定义机器人', url: 'https://open.dingtalk.com/document/robots/custom-robot-access' }],
  },
  lark: {
    summary: '向飞书群发送消息，使用自定义机器人 Webhook。',
    steps: [
      '在飞书群设置 → 群机器人 → 添加自定义机器人。',
      '复制 Webhook 地址；如开启签名校验，同时复制密钥。',
      '分别填入 url 与 secret 字段。',
    ],
    links: [{ label: '飞书自定义机器人', url: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot' }],
  },
  bark: {
    summary: '推送到 Bark iOS 客户端（APNs 通知）。',
    steps: [
      '在 Bark App 中复制带 Push Key 的推送地址。',
      '地址可直接作为 url；也可只填 Push Key 到 secret。',
      '保存后点击「测试发送」确认手机收到通知。',
    ],
    links: [{ label: 'Bark 项目主页', url: 'https://github.com/Finb/Bark' }],
  },
  webhook: {
    summary: '把消息 POST 到任意 HTTPS 地址，可自定义 JSON 模板。',
    steps: [
      '准备一个可接收 POST 的 HTTPS 接口。',
      '按需在 other 字段填写 JSON 模板，可用 $title / $description / $content / $url / $to 占位。',
      '保存后测试发送，确认对端返回 2xx。',
    ],
    links: [{ label: 'Webhook 模板说明', url: 'https://github.com/leunghope/nectarpush#readme' }],
    note: '出于安全考虑，目标地址不能指向本服务自身。',
  },
  client: {
    summary: '浏览器或脚本通过 WebSocket 实时接收消息。',
    steps: [
      '保存后复制通道连接密钥。',
      '连接 /ws/client 并在握手时携带该密钥。',
      '保持连接即可实时收到推送。',
    ],
    links: [{ label: 'WebSocket 协议', url: 'https://github.com/leunghope/nectarpush#readme' }],
  },
  group: {
    summary: '把消息转发到同账号下的多个子通道。',
    steps: [
      '先在下方选择要纳入的子通道。',
      '保存后用「测试发送」检查各子通道的投递结果。',
      '不支持选择自身或嵌套群组，避免循环转发。',
    ],
    links: [{ label: '群组通道说明', url: 'https://github.com/leunghope/nectarpush#readme' }],
  },
  none: {
    summary: '不实际推送，仅在工作台记录消息（存量兼容，新建列表已隐藏）。',
    steps: ['选择该类型后消息只会写入历史，不会发往任何外部服务。'],
    links: [],
  },
  test: {
    summary: '微信测试号（骨架占位，尚未联调）。',
    steps: ['该类型字段已登记，真实发送能力还在开发中。'],
    links: [{ label: '微信测试号', url: 'https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login' }],
    note: '可先保存配置，等联调完成后直接使用。',
  },
  corp_app: {
    summary: '企业微信应用号（骨架占位，尚未联调）。',
    steps: ['填写 CorpID / AgentID / Secret 等字段，真实发送能力待接入。'],
    links: [{ label: '企业微信应用', url: 'https://developer.work.weixin.qq.com/document/path/90664' }],
    note: '可先保存配置，等联调完成后直接使用。',
  },
  corp: {
    summary: '企业微信群机器人（骨架占位，尚未联调）。',
    steps: ['在企业微信群中添加群机器人并复制 Webhook 地址。'],
    links: [{ label: '企业微信群机器人', url: 'https://developer.work.weixin.qq.com/document/path/91770' }],
    note: '可先保存配置，等联调完成后直接使用。',
  },
  lark_app: {
    summary: '飞书自建应用（骨架占位，尚未联调）。',
    steps: ['在飞书开放平台创建应用并获取 App ID / App Secret。'],
    links: [{ label: '飞书开放平台', url: 'https://open.feishu.cn/document/home/index' }],
    note: '可先保存配置，等联调完成后直接使用。',
  },
  one_bot: {
    summary: 'QQ / OneBot 协议（骨架占位，尚未联调）。',
    steps: ['准备 OneBot 实现（如 NapCat/go-cqhttp）并暴露 HTTP 或 WS 接口。'],
    links: [{ label: 'OneBot 标准', url: 'https://github.com/botuniverse/onebot-11' }],
    note: '不使用 one_api 命名，类型固定为 one_bot。',
  },
  tencent_alarm: {
    summary: '腾讯云告警（骨架占位，尚未联调）。',
    steps: ['在腾讯云告警管理中创建通知渠道并获取 Webhook 地址。'],
    links: [{ label: '腾讯云告警通知', url: 'https://cloud.tencent.com/document/product/248/61707' }],
    note: '可先保存配置，等联调完成后直接使用。',
  },
};
