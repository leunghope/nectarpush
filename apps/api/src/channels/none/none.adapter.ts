import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field } from '../adapter.base';

/** None channel — persists the message, never sends anywhere. */
export class NoneAdapter implements ChannelAdapter {
  readonly type = 'none';
  readonly displayName = '不推送';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, url: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [];

  validateConfig(_cfg: ChannelConfig) { return { valid: true, errors: {} }; }

  async send(): Promise<SendResult> {
    return { success: true, message: '已入库（不推送）' };
  }
}
