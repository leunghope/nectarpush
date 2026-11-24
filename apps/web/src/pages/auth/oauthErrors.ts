/** Human-readable text for the `oauth_error` query slugs used by the callback. */
export const OAUTH_ERROR_TEXT: Record<string, string> = {
  state_mismatch: '授权状态已过期，请重新发起',
  access_denied: '你已取消授权',
  already_bound: '该第三方账号已绑定其他用户，请先解绑',
  register_disabled: '管理员已关闭注册，无法自动创建账号',
  user_disabled: '账号已被停用',
  user_not_found: '账号不存在',
  provider_not_configured: '该提供方尚未配置',
  missing_code: '授权回调不完整，请重试',
  unauthorized: '第三方授权失败，请重试',
  oauth_failed: '第三方登录失败，请重试',
};

export function oauthErrorText(slug: string): string {
  return OAUTH_ERROR_TEXT[slug] ?? '第三方登录失败，请重试';
}