import { beforeEach, describe, expect, it, vi } from 'vitest';

let result = { settings: null, error: null };
vi.mock('$lib/server/teamSettings.js', () => ({ loadTeamSettings: async () => result }));

const { setupGate } = await import('../../hooks.server.js');

const run = async (pathname, method = 'GET') => {
  const resolve = vi.fn(async () => new Response('page'));
  const event = {
    url: new URL(`https://scouting.example.org${pathname}`),
    request: new Request(`https://x${pathname}`, { method })
  };
  try {
    const response = await setupGate({ event, resolve });
    return { response, resolved: resolve.mock.calls.length > 0 };
  } catch (thrown) {
    return { redirect: thrown?.location, status: thrown?.status };
  }
};

describe('first-run setup redirect', () => {
  beforeEach(() => {
    result = { settings: null, error: null };
  });

  it('sends every page to /setup until setup is done, but leaves the API and /setup alone', async () => {
    expect(await run('/')).toMatchObject({ redirect: '/setup', status: 303 });
    expect(await run('/strategy')).toMatchObject({ redirect: '/setup' });
    expect((await run('/setup')).resolved).toBe(true);
    expect((await run('/api/setup')).resolved).toBe(true);
    expect((await run('/api/team-settings', 'POST')).resolved).toBe(true);
  });

  it('sends /setup home once the site is set up', async () => {
    result = { settings: { configured: true }, error: null };
    expect(await run('/setup')).toMatchObject({ redirect: '/' });
    expect((await run('/strategy')).resolved).toBe(true);
  });

  it('does not redirect when the settings cannot be read, so the real error shows', async () => {
    result = { settings: null, error: 'no database' };
    expect((await run('/')).resolved).toBe(true);
  });
});
