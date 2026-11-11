import { describe, expect, it, vi } from 'vitest';
import { csrfCheck } from '../../hooks.server.js';
import svelteConfig from '../../../svelte.config.js';

function makeEvent({
  method = 'POST',
  contentType = null,
  origin = null,
  url = 'https://scouting.example.org/api/test'
} = {}) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (origin !== null) headers.set('origin', origin);
  return {
    request: new Request(url, { method, headers }),
    url: new URL(url)
  };
}

describe('svelte.config.js CSRF settings', () => {
  it('does not disable built-in SvelteKit CSRF origin checks', () => {
    expect(svelteConfig.kit?.csrf?.checkOrigin).not.toBe(false);
  });
});

describe('csrfCheck hook', () => {
  it('rejects cross-site form submissions and empty Content-Type POSTs', async () => {
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=---',
      'text/plain',
      '',
      null
    ]) {
      const resolve = vi.fn();
      const res = await csrfCheck({
        event: makeEvent({ method: 'POST', contentType, origin: 'https://evil.example' }),
        resolve
      });
      expect(res.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('rejects state-changing requests with missing Origin when Content-Type is empty or form-like', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const resolve = vi.fn();
      const res = await csrfCheck({
        event: makeEvent({ method, contentType: null, origin: null }),
        resolve
      });
      expect(res.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('allows same-origin POSTs and attaches anti-framing and hardening headers', async () => {
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));
    const res = await csrfCheck({
      event: makeEvent({
        method: 'POST',
        contentType: null,
        origin: 'https://scouting.example.org'
      }),
      resolve
    });
    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('allows non-browser application/json requests (e.g. vision runner) and attaches security headers', async () => {
    const resolve = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const res = await csrfCheck({
      event: makeEvent({
        method: 'POST',
        contentType: 'application/json',
        origin: null
      }),
      resolve
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('API cache headers', () => {
  it('marks API answers private and uncacheable unless the route set its own header', async () => {
    const plain = await csrfCheck({
      event: makeEvent({ method: 'GET', url: 'https://scouting.example.org/api/scout-assignments' }),
      resolve: async () => new Response('{}')
    });
    expect(plain.headers.get('cache-control')).toBe('private, no-store');

    const publicData = await csrfCheck({
      event: makeEvent({ method: 'GET', url: 'https://scouting.example.org/api/tba/event-info' }),
      resolve: async () => new Response('{}', { headers: { 'Cache-Control': 'public, max-age=60' } })
    });
    expect(publicData.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('lets only this site frame the form designer preview', async () => {
    const { framingHeaders } = await import('../../hooks.server.js');
    expect(framingHeaders(new URL('http://x/matchscout?design=1'))).toEqual({
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'"
    });
    expect(framingHeaders(new URL('http://x/matchscout'))).toEqual({});
    expect(framingHeaders(new URL('http://x/scouting-admin?design=1'))).toEqual({});
  });
});
