import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOURCES as FUNCTION_SOURCES,
  handle,
  pathProblem,
  resetState
} from '../../../../supabase/functions/frc-data/handler.ts';
import { SOURCES as AGENT_SOURCES } from './sources.js';

// The frc-data Supabase Edge Function: the only place the FIRST and Match13 credentials live.
const env = {
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  FRC_API_USERNAME: 'user',
  FRC_API_TOKEN: 'token',
  MATCH13_API_KEY: 'm13'
};
const post = (body, token = 'service-key') =>
  new Request('https://project.supabase.co/functions/v1/frc-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
const upstream = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe('frc-data Edge Function', () => {
  beforeEach(() => resetState());

  it("refuses anyone without the project's service-role key", async () => {
    const fetchImpl = vi.fn();
    for (const token of [null, 'anon-key', 'a-signed-in-users-jwt', 'service-ke'])
      expect(
        (await handle(post({ source: 'first', path: '/2026/rankings/CC' }, token), { env, fetchImpl })).status
      ).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says which services have their secret, without showing it', async () => {
    const response = await handle(post({ action: 'status' }), { env: { ...env, MATCH13_API_KEY: '' } });
    const body = await response.json();
    expect(body.sources).toEqual({
      first: { label: 'FIRST FRC Events', configured: true },
      match13: { label: 'Match13', configured: false }
    });
    expect(JSON.stringify(body)).not.toMatch(/token|m13|user/);
  });

  it('signs FIRST with basic auth and Match13 with its bearer key, from fixed hosts', async () => {
    const fetchImpl = vi.fn(async () => upstream({ ok: true }));
    const first = await (await handle(post({ source: 'first', path: '/2026/rankings/CC' }), { env, fetchImpl })).json();
    expect(first).toMatchObject({ source: 'first', url: 'https://frc-api.firstinspires.org/v3.0/2026/rankings/CC' });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Basic ${btoa('user:token')}`);
    await handle(post({ source: 'match13', path: '/teams/5940/years/2026' }), { env, fetchImpl });
    expect(fetchImpl.mock.calls[1][0]).toBe('https://actions.match13.com/v1/teams/5940/years/2026');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer m13');
  });

  it('refuses paths that could leave the service, and unknown sources', async () => {
    const fetchImpl = vi.fn();
    for (const path of ['//evil.example', '/2026/../../x', 'https://evil.example', '/admin', '/2026/rankings/CC@x'])
      expect((await handle(post({ source: 'first', path }), { env, fetchImpl })).status, path).toBe(400);
    expect((await handle(post({ source: 'tba', path: '/event/2026cc' }), { env, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches an answer and says when a secret is missing', async () => {
    const fetchImpl = vi.fn(async () => upstream({ xp: 1 }));
    await handle(post({ source: 'match13', path: '/years' }), { env, fetchImpl });
    const again = await (await handle(post({ source: 'match13', path: '/years' }), { env, fetchImpl })).json();
    expect(again.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const missing = await handle(post({ source: 'first', path: '/2026/rankings/CC' }), {
      env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' },
      fetchImpl
    });
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toMatch(/secret is missing/);
  });

  it("turns the service's failures into plain errors", async () => {
    const answer = async (status) =>
      (
        await handle(post({ source: 'first', path: '/2026/rankings/XX' }), {
          env,
          fetchImpl: async () => upstream({}, status)
        })
      ).json();
    expect((await answer(404)).error).toMatch(/nothing at that path/);
    resetState();
    expect((await answer(401)).error).toMatch(/refused our credentials/);
    resetState();
    expect((await answer(429)).error).toMatch(/rate limiting/);
  });

  it('allows exactly the paths the agent allows', () => {
    for (const key of ['first', 'match13'])
      expect(FUNCTION_SOURCES[key].paths.map(String)).toEqual(AGENT_SOURCES[key].paths.map(String));
    expect(pathProblem('match13', '/events/2026cc/sim')).toBe(null);
  });
});
