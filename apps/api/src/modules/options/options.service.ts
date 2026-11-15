import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { setSmtpOptions } from '../../common/smtp-state';
import { ApiError } from '../../common/errors';
import { serverBase } from '../../common/http-base';
import {
  mergeProviders,
  normalizeProviders,
  redactProviders,
  parseProvidersJson,
  validateProviders,
  type OAuthProviderConfig,
} from '../oauth/providers';
import { discoverOidc } from '../oauth/discovery';

export const DEFAULT_OPTIONS: Record<string, string> = {
  SystemName: '蜂鸟推送',
  SiteEnglishName: 'NectarPush',
  SiteIcon: '',
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

/** Where the public base URL came from — surfaced in the settings UI. */
export type PublicBaseSource = 'server_address' | 'public_base_url' | 'fallback';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

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

  /**
   * 对外绝对地址（OAuth 回调、推送地址、邮件链接共用同一口径）：
   * 系统设置里的 `ServerAddress` 优先，其次 `PUBLIC_BASE_URL`，最后回退 127.0.0.1:PORT。
   * 与 webhooks.service / me.service 的取址顺序一致——此前 OAuth 只读环境变量，
   * 容器里 PUBLIC_BASE_URL 为空时会拼出 127.0.0.1:3000，第三方因此判定回调地址不匹配。
   * 非法值（缺 http(s)://、含空格）不参与拼接，避免把坏地址写进 redirect_uri。
   */
  publicBase(): { url: string; source: PublicBaseSource } {
    const normalize = (value: string) => value.trim().replace(/\/+$/, '');
    const address = normalize(this.get('ServerAddress'));
    if (isHttpUrl(address)) return { url: address, source: 'server_address' };

    const env = normalize(process.env.PUBLIC_BASE_URL || '');
    if (isHttpUrl(env)) return { url: env, source: 'public_base_url' };

    return { url: serverBase(), source: 'fallback' };
  }

  /** OAuth 回调地址：第三方提供方里登记的就是这个值，必须与实际访问地址一致。 */
  oauthCallbackUrl(providerId: string): string {
    return `${this.publicBase().url}/api/auth/oauth/${encodeURIComponent(providerId)}/callback`;
  }

  async set(key: string, value: string): Promise<void> {
    if (key === 'OAuth2Providers') {
      // O-2/O-3 (design §4.2/§4.4): validate structure (422 on failure, never
      // clearing the existing value), then merge so an empty client_secret
      // keeps the stored secret for that provider id.
      const incoming = normalizeProviders(parseProvidersJson(value));
      const hydrated = await this.hydrateDiscovery(incoming);
      validateProviders(hydrated);
      const merged = mergeProviders(
        normalizeProviders(parseProvidersJson(this.get(key))),
        hydrated,
      );
      validateProviders(merged);
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
        let providers: OAuthProviderConfig[] = [];
        try {
          providers = normalizeProviders(parseProvidersJson(rawValue));
        } catch {
          providers = parseProvidersJson(rawValue);
        }
        return {
          key,
          value: JSON.stringify(redactProviders(providers)),
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

  /**
   * 自定义提供方只填「发现端点」时，保存阶段自动拉取 OIDC 文档补齐三个端点；
   * 拉取失败直接 422，避免把无法登录的配置写入数据库。
   */
  private async hydrateDiscovery(list: OAuthProviderConfig[]): Promise<OAuthProviderConfig[]> {
    const out: OAuthProviderConfig[] = [];
    for (const p of list) {
      const complete = Boolean(p.authorize_url && p.token_url && p.userinfo_url);
      if (p.id === 'github' || !p.discovery_url || complete) {
        out.push(p);
        continue;
      }
      try {
        const doc = await discoverOidc(p.discovery_url);
        out.push({
          ...p,
          authorize_url: p.authorize_url || doc.authorize_url,
          token_url: p.token_url || doc.token_url,
          userinfo_url: p.userinfo_url || doc.userinfo_url,
          scope: p.scope || doc.scope,
          map_username: p.map_username || doc.map_username,
          map_email: p.map_email || doc.map_email,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new ApiError(
          'VALIDATION_FAILED',
          `无法从「${p.display_name || p.id}」的发现端点获取配置：${detail}`,
        );
      }
    }
    return out;
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
