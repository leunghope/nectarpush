/**
 * Q-08: session cookie flags.
 *
 * `Secure` must be on for HTTPS deployments, but forcing it would break local
 * HTTP development and the Playwright suite (browsers drop Secure cookies over
 * plain HTTP). So it is explicit and off by default:
 *   - COOKIE_SECURE=true|false  → authoritative
 *   - otherwise, PUBLIC_BASE_URL=https://… implies a TLS deployment
 */
export function sessionCookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit !== undefined && explicit !== '') return explicit === 'true';
  return (process.env.PUBLIC_BASE_URL ?? '').trim().toLowerCase().startsWith('https://');
}