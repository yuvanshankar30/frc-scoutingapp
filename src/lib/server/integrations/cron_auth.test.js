import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCronSecrets, isAuthorizedCronRequest } from './cron_auth.js';

const mockEnv = {};
const mockSync = vi.fn(async () => ({ ok: true, synced: 5 }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/integrations/google_sheets_sync.js', () => ({
  syncScoutingDataToSheet: (...args) => mockSync(...args)
}));

const { GET, POST } = await import('../../../routes/api/scouting-admin/sync-sheet-cron/+server.js');

describe('cron auth helpers (AUTHZ-05 / CSRF-05 / SEC-02 / HIGH-06)', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    mockSync.mockClear();
  });

  it('fails closed (rejects requests) when no cron secret is configured', () => {
    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications'),
        headers: new Headers()
      })
    ).toBe(false);

    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications'),
        headers: new Headers({ authorization: 'Bearer anything' }),
        env: {}
      })
    ).toBe(false);
  });

  it('rejects query-string tokens and requires Authorization: Bearer header', () => {
    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications?token=legacy-secret'),
        headers: new Headers(),
        env: { NOTIFICATION_CRON_TOKEN: 'legacy-secret' }
      })
    ).toBe(false);
  });

  it('accepts bearer auth for hosted cron jobs', () => {
    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications'),
        headers: new Headers({ authorization: 'Bearer vercel-secret' }),
        env: { CRON_SECRET: 'vercel-secret' }
      })
    ).toBe(true);
  });

  it('rejects requests with the wrong token or mismatched token length', () => {
    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications?token=wrong'),
        headers: new Headers({ authorization: 'Bearer nope' }),
        env: { CRON_SECRET: 'expected-secret' }
      })
    ).toBe(false);

    expect(
      isAuthorizedCronRequest({
        url: new URL('https://example.com/api/planner/notifications'),
        headers: new Headers({ authorization: 'Bearer expected-secreX' }),
        env: { CRON_SECRET: 'expected-secret' }
      })
    ).toBe(false);
  });

  it('collects unique secrets from all supported env names', () => {
    expect(
      getCronSecrets({
        NOTIFICATION_CRON_TOKEN: 'shared',
        CRON_NOTIFICATION_TOKEN: 'shared',
        CRON_SECRET: 'hosted'
      })
    ).toEqual(['shared', 'hosted']);
  });

  it('sync-sheet-cron route rejects when CRON_SECRET is unset or passed via query param, and allows Bearer GET/POST', async () => {
    const url = new URL('https://comp.local/api/scouting-admin/sync-sheet-cron?token=secret-1');
    const unconfigured = await GET({ url, request: new Request(url) });
    expect(unconfigured.status).toBe(401);
    expect(unconfigured.headers.get('Cache-Control')).toBe('no-store');
    expect(mockSync).not.toHaveBeenCalled();

    mockEnv.CRON_SECRET = 'secret-1';
    const queryOnly = await GET({ url, request: new Request(url) });
    expect(queryOnly.status).toBe(401);
    expect(mockSync).not.toHaveBeenCalled();

    const authedPost = await POST({
      url: new URL('https://comp.local/api/scouting-admin/sync-sheet-cron'),
      request: new Request('https://comp.local/api/scouting-admin/sync-sheet-cron', {
        method: 'POST',
        headers: { authorization: 'Bearer secret-1' }
      })
    });
    expect(authedPost.status).toBe(200);
    expect(authedPost.headers.get('Cache-Control')).toBe('no-store');
    expect(mockSync).toHaveBeenCalledTimes(1);
  });
});
