import { Capabilities, ChannelAdapter, ConfigField } from '../adapter.interface';
import { caps, field, DraftAdapterBase } from '../adapter.base';

/** Draft (skeleton) channel adapters: config forms work, send is unimplemented. */

export class TestWechatAdapter extends DraftAdapterBase {
  readonly type = 'test';
  readonly displayName = '微信测试号';
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: 'recipient',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'AppID', 'string', { required: true, secret: false }),
    field('secret', 'AppSecret', 'password', { required: true, secret: true }),
    field('account_id', '接收者 OpenID', 'string', { required: true, secret: false }),
  ];
}

export class CorpAppAdapter extends DraftAdapterBase {
  readonly type = 'corp_app';
  readonly displayName = '企业微信应用号';
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'CorpID', 'string', { required: true, secret: false }),
    field('secret', 'CorpSecret', 'password', { required: true, secret: true }),
    field('account_id', 'AgentID', 'string', { required: true, secret: false }),
  ];
}

export class CorpAdapter extends DraftAdapterBase {
  readonly type = 'corp';
  readonly displayName = '企业微信群机器人';
  readonly capabilities: Capabilities = caps({
    description: true, content: true, url: true, to: true, markdown: true,
    to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Webhook 地址', 'string', { required: true, secret: false }),
  ];
}

export class LarkAppAdapter extends DraftAdapterBase {
  readonly type = 'lark_app';
  readonly displayName = '飞书自建应用';
  readonly capabilities: Capabilities = caps({
    description: true, content: true, to: true, markdown: true, to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'App ID', 'string', { required: true, secret: false }),
    field('secret', 'App Secret', 'password', { required: true, secret: true }),
  ];
}

export class OneBotAdapter extends DraftAdapterBase {
  readonly type = 'one_bot';
  readonly displayName = 'QQ（OneBot）';
  readonly capabilities: Capabilities = caps({
    content: true, to: true, to_mode: 'chat',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'OneBot 服务地址', 'string', { required: true, secret: false, placeholder: 'http://127.0.0.1:8080' }),
    field('secret', 'Access Token', 'password', { required: false, secret: true }),
    field('account_id', 'QQ 号 / 群号', 'string', { required: true, secret: false }),
  ];
}

export class TencentAlarmAdapter extends DraftAdapterBase {
  readonly type = 'tencent_alarm';
  readonly displayName = '腾讯云告警';
  readonly capabilities: Capabilities = caps({
    description: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('secret_id', 'SecretId', 'password', { required: true, secret: true }),
    field('secret', 'SecretKey', 'password', { required: true, secret: true }),
    field('other', '策略 ID', 'string', { required: false, secret: false, help: '告警策略 ID（可选）' }),
  ];
}
