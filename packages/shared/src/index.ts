// Shared OpenAPI-typed client for the NectarPush front-end (S6).
// Types are generated 1:1 from docs/openapi.yaml (openapi-typescript) — never
// hand-written duplicates. The client is openapi-fetch, pointed at the same
// origin so the np_session HttpOnly cookie flows automatically.
import createClient, { type Client } from 'openapi-fetch';
import type { paths, components } from './schema';

export type { paths, components };
export type ApiClient = Client<paths>;

/** Typed convenience aliases for the most-used component schemas. */
export type User = components['schemas']['User'];
export type Channel = components['schemas']['Channel'];
export type MessageSummary = components['schemas']['MessageSummary'];
export type MessageDetail = components['schemas']['MessageDetail'];
export type MessageDelivery = components['schemas']['MessageDelivery'];
export type PublicMessageDetail = components['schemas']['PublicMessageDetail'];
export type Webhook = components['schemas']['Webhook'];
export type Option = components['schemas']['Option'];
export type ChannelTypeDescriptor = components['schemas']['ChannelTypeDescriptor'];
export type ChannelConfigSchema = components['schemas']['ChannelConfigSchema'];
export type ConfigField = components['schemas']['ConfigField'];
export type ChannelCapabilities = components['schemas']['ChannelCapabilities'];
export type ChannelGuide = components['schemas']['ChannelGuide'];
export type ChannelGuideLink = components['schemas']['ChannelGuideLink'];
export type PageMeta = components['schemas']['PageMeta'];
export type ErrorCode = components['schemas']['ErrorCode'];
export type MessageStatus = components['schemas']['MessageStatus'];
export type RenderMode = components['schemas']['RenderMode'];
export type UserRole = components['schemas']['UserRole'];
export type UserStatus = components['schemas']['UserStatus'];
export type ChannelType = components['schemas']['ChannelType'];
export type PushSettingsData = components['schemas']['PushSettingsData'];
export type ChannelTestResultData = components['schemas']['ChannelTestResultData'];
export type ChannelCreated = components['schemas']['ChannelCreated'];
export type ChannelTokenData = components['schemas']['ChannelTokenData'];
export type ChannelTokenRequest = components['schemas']['ChannelTokenRequest'];
export type TextContentData = components['schemas']['TextContentData'];
export type TurnstileSiteKeyData = components['schemas']['TurnstileSiteKeyData'];
export type MeSecurityData = components['schemas']['MeSecurityData'];
export type OAuthProviderSummary = components['schemas']['OAuthProviderSummary'];
export type OAuthProviderListData = components['schemas']['OAuthProviderListData'];
export type OAuthDiscoveryData = components['schemas']['OAuthDiscoveryData'];
export type EmailChangeData = components['schemas']['EmailChangeData'];
export type ChannelListData = components['schemas']['ChannelListData'];
export type ChannelTypeListData = components['schemas']['ChannelTypeListData'];
export type MessagePageData = components['schemas']['MessagePageData'];
export type MessageStatusData = components['schemas']['MessageStatusData'];
export type WebhookListData = components['schemas']['WebhookListData'];
export type UserPageData = components['schemas']['UserPageData'];
export type OptionListData = components['schemas']['OptionListData'];
export type OAuth2CallbackBaseData = components['schemas']['OAuth2CallbackBaseData'];
export type LoginResultData = components['schemas']['LoginResultData'];
export type TokenResultData = components['schemas']['TokenResultData'];
export type SendResultData = components['schemas']['SendResultData'];
export type PushResultData = components['schemas']['PushResultData'];
export type HealthData = components['schemas']['HealthData'];
export type VersionData = components['schemas']['VersionData'];
export type BrandingData = components['schemas']['BrandingData'];
export type UpdateCheckData = components['schemas']['UpdateCheckData'];
export type UserOAuthBinding = components['schemas']['UserOAuthBinding'];
export type UserOAuthListData = components['schemas']['UserOAuthListData'];
export type WebhookConstructRule = components['schemas']['WebhookConstructRule'];
export type WebhookExtractRule = components['schemas']['WebhookExtractRule'];
export type ChannelUpsertRequest = components['schemas']['ChannelUpsertRequest'];
export type ChannelUpdateRequest = components['schemas']['ChannelUpdateRequest'];
export type WebhookUpsertRequest = components['schemas']['WebhookUpsertRequest'];
export type WebhookUpdateRequest = components['schemas']['WebhookUpdateRequest'];
export type UserManageRequest = components['schemas']['UserManageRequest'];

/**
 * Uniform API error surfaced from the `{success:false,message,code}` envelope.
 * The UI redirects to the forced password-change screen when
 * code === 'PASSWORD_CHANGE_REQUIRED', and shows `message` otherwise.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  constructor(message: string, code: string | undefined, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function createApiClient(baseUrl = ''): ApiClient {
  return createClient<paths>({
    baseUrl,
    credentials: 'include',
    // Deferred lookup so tests can swap the global fetch implementation
    // without re-creating the client. In production this is a pass-through.
    fetch: (input: Request) => globalThis.fetch(input),
  });
}
