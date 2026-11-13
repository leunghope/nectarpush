import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { setSmtpOptions } from '../../common/smtp-state';
import { ApiError } from '../../common/errors';
import {
  mergeProviders,
  redactProviders,
  parseProvidersJson,
  validateProviders,
} from '../oauth/providers';

export const DEFAULT_OPTIONS: Record<string, string> = {
  SystemName: '蜂鸟推送',
  ServerAddress: '',
  RegisterEnabled: 'true',
  PasswordLoginEnabled: 'true',
  EmailVerificationEnabled: 'false',
  MessagePersistenceEnabled: 'true',
  MessageRenderEnabled: 'true',
  SMTPServer: '',
  SMTPAccount: '',
  SMTPPort: '465',
  SMTPToken: '',
  OAuth2Providers: '[]',
  TurnstileCheckEnabled: 'false',
  TurnstileSiteKey: '',
  TurnstileSecretKey: '',
  Notice: '',
  About: '',
  Footer: '',
  HomePageLink: '',
};

/**
 * `…Enabled` keys are boolean switches: their value is never a secret and must
 * be echoed verbatim so the settings page can render on/off correctly (Q-05).
 */
export function isBooleanKey(key: string): boolean {
  return key.endsWith('Enabled');
}

export function isSensitiveKey(key: string): boolean {
  if (isBooleanKey(key)) return false;
  return /token|secret|password/i.test(key);
}

@Injectable()
export class OptionsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    const rows = await this.prisma.option.findMany();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
    this.applySmtp();
  }

  get(key: string): string {
    return this.cache.get(key) ?? DEFAULT_OPTIONS[key] ?? '';
  }

  getBool(key: string): boolean {
    return this.get(key) === 'true';
  }

  async set(key: string, value: string): Promise<void> {
    if (key === 'OAuth2Providers') {
      // O-2/O-3 (design §4.2/§4.4): validate structure (422 on failure, never
      // clearing the existing value), then merge so an empty client_secret
      // keeps the stored secret for that provider id.
      const incoming = parseProvidersJson(value);
      validateProviders(incoming);
      const merged = mergeProviders(parseProvidersJson(this.get(key)), incoming);
      value = JSON.stringify(merged);
    }
    await this.prisma.option.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.cache.set(key, value);
    this.applySmtp();
  }

  all(): { key: string; value: string; sensitive: boolean; configured: boolean }[] {
    const keys = new Set([...Object.keys(DEFAULT_OPTIONS), ...this.cache.keys()]);
    return [...keys].sort().map((key) => {
      // O-2 (AC-068 spirit): never echo provider client_secret; expose only a
      // has_secret boolean. Stored value remains plaintext JSON (DB encryption
      // is out of scope — see design §9 risk table).
      if (key === 'OAuth2Providers') {
        const rawValue = this.cache.get(key) ?? DEFAULT_OPTIONS[key] ?? '[]';
        return {
          key,
          value: JSON.stringify(redactProviders(parseProvidersJson(rawValue))),
          sensitive: false,
          configured: true,
        };
      }
      const sensitive = isSensitiveKey(key);
      const value = this.cache.get(key) ?? DEFAULT_OPTIONS[key] ?? '';
      return {
        key,
        value: sensitive ? '' : value,
        sensitive,
        configured: sensitive ? Boolean(value) : true,
      };
    });
  }

  smtpReady(): boolean {
    return Boolean(this.get('SMTPServer') && this.get('SMTPAccount'));
  }

  private applySmtp(): void {
    const host = this.get('SMTPServer');
    const account = this.get('SMTPAccount');
    if (host && account) {
      setSmtpOptions({
        host,
        port: Number(this.get('SMTPPort')) || 465,
        account,
        token: this.get('SMTPToken'),
      });
    } else {
      setSmtpOptions(null);
    }
  }

  /** Validate dependencies before enabling a switch (DEPENDENCY_MISSING). */
  assertDependencies(key: string, value: string): void {
    if (value !== 'true') return;
    switch (key) {
      case 'EmailVerificationEnabled':
        if (!this.smtpReady()) {
          throw new ApiError('DEPENDENCY_MISSING', '开启邮箱验证前需先配置 SMTP 发信服务');
        }
        break;
      case 'TurnstileCheckEnabled':
        if (!this.get('TurnstileSiteKey') || !this.get('TurnstileSecretKey')) {
          throw new ApiError('DEPENDENCY_MISSING', '开启 Turnstile 前需先填写 SiteKey 与 SecretKey');
        }
        break;
      default:
        break;
    }
  }
}
