import { describe, expect, it, vi } from 'vitest';

let access;
// A key is present, but the agent ships switched off, so it must still refuse.
vi.mock('$env/dynamic/private', () => ({ env: { DATA_VIEWER_AGENT_GEMINI_API_KEY: 'test-key' } }));
vi.mock('$lib/server/scouting/scoutingAccess.js', () => ({ actorFor: async () => access }));

const { GET, POST } = await import('./+server.js');
const request = (body) => ({ json: async () => body, headers: new Headers() });

describe('/api/dataviewer-agent while switched off', () => {
  it('refuses every question with 503 before reading the caller or the body', async () => {
    access = { authenticatedUserId: 'u1', approved: true, client: {} };
    const response = await POST({
      request: request({ event_key: '2026cc', messages: [{ role: 'user', content: 'hi' }] })
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/not turned on/);
  });

  it('tells approved callers it is off, and nobody else anything', async () => {
    access = { authenticatedUserId: 'u1', approved: true, client: {} };
    const body = await (await GET({ request: request() })).json();
    expect(body.data).toMatchObject({ enabled: false, configured: false });
    access = { authenticatedUserId: null, approved: false };
    expect((await GET({ request: request() })).status).toBe(401);
    access = { authenticatedUserId: 'u2', approved: false };
    expect((await GET({ request: request() })).status).toBe(403);
  });
});
