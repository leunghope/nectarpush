import { describe, expect, it } from 'vitest';
import { rateLimitClassOf, shouldRateLimit } from '../src/common/rate-limit';

describe('rate limit scope', () => {
  it('limits API, push and webhook trigger routes', () => {
    expect(shouldRateLimit('/api/me')).toBe(true);
    expect(shouldRateLimit('/api')).toBe(true);
    expect(shouldRateLimit('/api/auth/login')).toBe(true);
    expect(shouldRateLimit('/push/user')).toBe(true);
    expect(shouldRateLimit('/push')).toBe(true);
    expect(shouldRateLimit('/webhook/abc')).toBe(true);
  });

  it('does not limit static assets or SPA documents', () => {
    expect(shouldRateLimit('/')).toBe(false);
    expect(shouldRateLimit('/messages')).toBe(false);
    expect(shouldRateLimit('/settings/other')).toBe(false);
    expect(shouldRateLimit('/assets/index-abc123.js')).toBe(false);
    expect(shouldRateLimit('/favicon.ico')).toBe(false);
    expect(shouldRateLimit('/apiary')).toBe(false);
  });

  it('classifies routes by throttle bucket', () => {
    expect(rateLimitClassOf('/push/user')).toBe('push');
    expect(rateLimitClassOf('/webhook/abc')).toBe('push');
    expect(rateLimitClassOf('/api/auth/login')).toBe('critical');
    expect(rateLimitClassOf('/api/me')).toBe('default');
  });
});
