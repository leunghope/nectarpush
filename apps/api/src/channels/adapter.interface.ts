/** Channel adapter contract (shared-context §4). */

export interface PushMessage {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  renderMode?: 'markdown' | 'code' | 'raw';
}

export type ChannelConfig = Record<string, string>;

export interface SendResult {
  success: boolean;
  message?: string;
  /** Upstream latency in milliseconds (surfaced by the channel test endpoint). */
  latencyMs?: number;
  /** Raw upstream response body for debugging (test endpoint echo). */
  raw?: string;
}

export interface AdapterCtx {
  /** Sending user (for permission checks, e.g. email to others). */
  userId: number;
  username: string;
  allowSendEmailToOthers: boolean;
  /** Channel name (needed by the WebSocket client channel to address the socket). */
  channelName?: string;
  /** test endpoint override target */
  overrideTo?: string;
}

export type ToMode = 'recipient' | '@mention' | 'chat' | 'none';

export interface Capabilities {
  title: boolean;
  description: boolean;
  content: boolean;
  url: boolean;
  to: boolean;
  markdown: boolean;
  to_mode: ToMode;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect' | 'textarea';
  required: boolean;
  secret: boolean;
  placeholder?: string | null;
  help?: string | null;
  default?: string | null;
  options?: string[] | null;
  /**
   * Dynamic option source. `channels` = the requesting user's own channels
   * (value = channel id as string, label rendered by the frontend, e.g. group
   * children). When set, `options` is ignored.
   */
  options_source?: 'channels' | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export interface ChannelAdapter {
  readonly type: string;
  readonly displayName: string;
  /** core = fully implemented; draft = skeleton. */
  readonly status: 'core' | 'draft';
  /**
   * true = internal/deprecated type: kept working for existing channels but no
   * longer offered in the "new channel" type list (e.g. `none`).
   */
  readonly hidden?: boolean;
  readonly capabilities: Capabilities;
  readonly configSchema: ConfigField[];
  validateConfig(cfg: ChannelConfig): ValidationResult;
  send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult>;
}
