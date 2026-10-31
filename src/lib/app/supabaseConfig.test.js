import { describe, expect, it, vi } from 'vitest';

describe('Supabase config', () => {
  it('falls back to a non-resolving stand-in instead of crashing when .env is missing', async () => {
    vi.resetModules();
    vi.doMock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: '', PUBLIC_SUPABASE_ANON_KEY: '' }));
    const config = await import('./supabaseConfig.js');
    expect(config.supabaseConfigured).toBe(false);
    expect(config.supabaseUrl).toBe(config.NOT_CONFIGURED_URL);
    expect(new URL(config.supabaseUrl).hostname.endsWith('.invalid')).toBe(true);
    vi.doUnmock('$env/static/public');
  });

  it('uses the real values when they are set', async () => {
    vi.resetModules();
    vi.doMock('$env/static/public', () => ({
      PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      PUBLIC_SUPABASE_ANON_KEY: 'anon'
    }));
    const config = await import('./supabaseConfig.js');
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseUrl).toBe('https://abc.supabase.co');
    vi.doUnmock('$env/static/public');
  });
});
