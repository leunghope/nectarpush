import { Capabilities, ChannelAdapter, ConfigField } from '../adapter.interface';
import { caps, field, DraftAdapterBase } from '../adapter.base';

/** Draft (skeleton) channel adapters: config forms work, send is unimplemented. */
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
