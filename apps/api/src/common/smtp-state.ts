import { createHmac } from 'node:crypto';

/** Holder for SMTP options loaded from Option table (set by OptionsService). */
export interface SmtpOptions {
  host: string;
  port: number;
  account: string;
  token: string;
}

let smtpOptions: SmtpOptions | null = null;

export function setSmtpOptions(opts: SmtpOptions | null): void {
  smtpOptions = opts;
}

export function getSmtpOptions(): SmtpOptions | null {
  return smtpOptions;
}
