import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields } from '../adapter.base';
import { clientKey, isClientConnected, pushToClient } from '../../realtime/client-hub';

/** WebSocket client channel — delivers to the connected desktop/mobile client. */
export class ClientAdapter implements ChannelAdapter {
  readonly type = 'client';
  readonly displayName = 'WebSocket 客户端';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('secret', '连接密钥', 'password', { required: true, secret: true, help: '客户端连接 /ws/client 时使用该密钥鉴权' }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const key = clientKey(ctx.userId, ctx.channelName ?? '');
    if (!isClientConnected(key)) {
      return { success: false, message: '客户端未连接' };
    }
    const ok = pushToClient(key, msg, '');
    return ok ? { success: true } : { success: false, message: '客户端未连接' };
  }
}
