import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { TBA_PROXY_LIMIT_PER_MINUTE, tbaProxy } = await import('./tba.js');
const { resetRateLimit } = await import('$lib/server/assistant/rateLimit.js');

const event = (ip) => ({ getClientAddress: () => ip, setHeaders: () => {} });

describe('tbaProxy rate limit ', () => {
  beforeEach(() => resetRateLimit());

  it('serves normal traffic and refuses an address once it passes the per-minute cap', async () => {
    const handler = tbaProxy(async () => ({ ok: true }));
    for (let i = 0; i < TBA_PROXY_LIMIT_PER_MINUTE; i++) expect((await handler(event('1.2.3.4'))).status).toBe(200);
    expect((await handler(event('1.2.3.4'))).status).toBe(429);
    // Another address is unaffected.
    expect((await handler(event('5.6.7.8'))).status).toBe(200);
  });

  it('is high enough for a whole scouting team behind one venue IP', () => {
    expect(TBA_PROXY_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(1000);
  });
});
