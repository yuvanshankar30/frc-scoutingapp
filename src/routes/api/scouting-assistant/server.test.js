import { beforeEach, describe, expect, it, vi } from 'vitest';

let access;
const runAssistant = vi.fn(async () => ({ answer: 'ok' }));
vi.mock('$env/dynamic/private', () => ({ env: { GEMINI_API_KEY: 'test-key' } }));
vi.mock('$lib/server/scouting/scoutingAccess.js', () => ({ actorFor: async () => access }));
vi.mock('$lib/server/assistant/eventData.js', () => ({ loadEventSnapshot: async () => ({}) }));
vi.mock('$lib/server/assistant/agent.js', () => ({ runAssistant: (...args) => runAssistant(...args) }));

const { GET, POST } = await import('./+server.js');
const request = (body) => ({ json: async () => body, headers: new Headers() });

describe('/api/scouting-assistant ', () => {
  beforeEach(() => runAssistant.mockClear());

  it('refuses signed-out and unapproved callers before any model call', async () => {
    access = { authenticatedUserId: null, approved: false };
    expect((await GET({ request: request() })).status).toBe(401);
    expect((await POST({ request: request({ event_key: '2026cc', messages: [] }) })).status).toBe(401);
    access = { authenticatedUserId: 'u1', approved: false, client: {} };
    expect((await GET({ request: request() })).status).toBe(403);
    expect((await POST({ request: request({ event_key: '2026cc', messages: [] }) })).status).toBe(403);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it('answers approved callers using their own database client', async () => {
    const client = { from: vi.fn() };
    access = { authenticatedUserId: 'u2', approved: true, client };
    expect(await (await GET({ request: request() })).json()).toEqual({ configured: true });
    const response = await POST({
      request: request({ event_key: '2026cc', messages: [{ role: 'user', content: 'hi' }] })
    });
    expect(response.status).toBe(200);
    expect(runAssistant).toHaveBeenCalledTimes(1);
  });
});
