import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, isNewerVersion, versionParts } from '../src/modules/update/update.service';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('version comparison', () => {
  it('strips v prefixes and prerelease suffixes', () => {
    expect(versionParts('v1.2.3')).toEqual([1, 2, 3]);
    expect(versionParts('0.2.0-beta.1')).toEqual([0, 2, 0]);
    expect(versionParts('')).toEqual([]);
  });

  it('compares numerically, not lexically', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('nonsense', '0.1.0')).toBe(false);
  });
});

describe('UpdateService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.APP_VERSION = '0.1.0';
    delete process.env.UPDATE_CHECK_URL;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it('reports an available update from the latest release', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        tag_name: 'v0.2.0',
        name: 'NectarPush 0.2.0',
        html_url: 'https://github.com/leunghope/nectarpush/releases/tag/v0.2.0',
        published_at: '2026-11-01T00:00:00Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const data = await new UpdateService().check();
    expect(data).toMatchObject({
      current_version: '0.1.0',
      latest_version: '0.2.0',
      update_available: true,
      release_name: 'NectarPush 0.2.0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports no update when the release equals the current version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ tag_name: '0.1.0' })));
    const data = await new UpdateService().check();
    expect(data.update_available).toBe(false);
  });

  it('caches for 10 minutes but force bypasses the cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ tag_name: 'v0.3.0' }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new UpdateService();
    await svc.check();
    await svc.check();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await svc.check(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the tags endpoint when there is no release yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([{ name: 'v0.4.0' }]));
    vi.stubGlobal('fetch', fetchMock);
    const data = await new UpdateService().check();
    expect(data.latest_version).toBe('0.4.0');
    expect(data.release_url).toContain('/releases/tag/v0.4.0');
  });

  it('uses UPDATE_CHECK_URL as the upstream and does not guess tags', async () => {
    process.env.UPDATE_CHECK_URL = 'https://mirror.example.com/latest.json';
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://mirror.example.com/latest.json');
      return jsonResponse({ version: 'v1.0.0', url: 'https://mirror.example.com/1.0.0' });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const data = await new UpdateService().check();
    expect(data.latest_version).toBe('1.0.0');
    expect(data.release_url).toBe('https://mirror.example.com/1.0.0');
  });

  it('raises UPDATE_CHECK_FAILED on upstream errors and empty payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, { status: 500 })));
    await expect(new UpdateService().check()).rejects.toMatchObject({ code: 'UPDATE_CHECK_FAILED' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    await expect(new UpdateService().check()).rejects.toMatchObject({ code: 'UPDATE_CHECK_FAILED' });
  });
});
