import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field } from '../adapter.base';

/** None channel — persists the message, never sends anywhere. */
export class NoneAdapter implements ChannelAdapter {
  readonly type = 'none';
  readonly displayName = '不推送';
  readonly status = 'core' as const;
  /**
   * Kept for existing channels and API compatibility, but no longer offered in
   * the "new channel" type list (用户要求去掉该类型入口).
   */
  readonly hidden = true;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, url: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [];

  validateConfig(_cfg: ChannelConfig) { return { valid: true, errors: {} }; }

  async send(): Promise<SendResult> {
    return { success: true, message: '已入库（不推送）' };
  }
}
