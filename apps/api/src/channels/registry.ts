import { ChannelAdapter } from './adapter.interface';
import { EmailAdapter } from './email/email.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { DiscordAdapter } from './discord/discord.adapter';
import { DingAdapter } from './ding/ding.adapter';
import { LarkAdapter } from './lark/lark.adapter';
import { BarkAdapter } from './bark/bark.adapter';
import { WebhookAdapter } from './webhook/webhook.adapter';
import { ClientAdapter } from './client/client.adapter';
import { GroupAdapter } from './group/group.adapter';
import { NoneAdapter } from './none/none.adapter';
import {
  CorpAdapter,
  CorpAppAdapter,
  LarkAppAdapter,
  OneBotAdapter,
  TencentAlarmAdapter,
  TestWechatAdapter,
} from './drafts/draft.adapters';

/**
 * ChannelRegistry — the only place that knows every adapter. Adding a channel
 * = adding a file + one line here.
 */
const ADAPTERS: ChannelAdapter[] = [
  new EmailAdapter(),
  new TelegramAdapter(),
  new DiscordAdapter(),
  new DingAdapter(),
  new LarkAdapter(),
  new BarkAdapter(),
  new WebhookAdapter(),
  new ClientAdapter(),
  new GroupAdapter(),
  new NoneAdapter(),
  new TestWechatAdapter(),
  new CorpAppAdapter(),
  new CorpAdapter(),
  new LarkAppAdapter(),
  new OneBotAdapter(),
  new TencentAlarmAdapter(),
];

const BY_TYPE = new Map(ADAPTERS.map((a) => [a.type, a]));

export function listAdapters(): ChannelAdapter[] {
  return ADAPTERS;
}

export function getAdapter(type: string): ChannelAdapter | undefined {
  return BY_TYPE.get(type);
}

export const RESERVED_CHANNEL_NAMES = new Set(['email']);
