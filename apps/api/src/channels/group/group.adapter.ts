import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, Capabilities, ConfigField, ValidationResult } from '../adapter.interface';
import { caps, field } from '../adapter.base';

/**
 * Group channel — fans out to child channels; dispatch is handled by the
 * send pipeline (DeliveryService), the adapter only declares config/shape.
 * config.other holds comma-separated child channel ids, picked in the UI from
 * the user's own channels (options_source: channels).
 */
export class GroupAdapter implements ChannelAdapter {
  readonly type = 'group';
  readonly displayName = '群组';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({ to_mode: 'none' });
  readonly configSchema: ConfigField[] = [
    field('other', '子通道', 'multiselect', {
      required: true,
      secret: false,
      options_source: 'channels',
      help: '从你已有的通道中勾选；一次发送会同时扇出到全部子通道',
    }),
  ];

  validateConfig(cfg: ChannelConfig): ValidationResult {
    const valid = Boolean(cfg.other?.trim()) && cfg.other.split(',').every((s) => /^\d+$/.test(s.trim()));
    return valid
      ? { valid: true, errors: {} }
      : { valid: false, errors: { other: '子通道 ID 列表必须为逗号分隔的数字 id' } };
  }

  async send(): Promise<SendResult> {
    // Group sending is orchestrated by DeliveryService (fan-out + aggregate).
    return { success: false, message: '群组通道由发送管道直接扇出，不应调用 adapter.send' };
  }
}
