import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockAuthHeader = {};
vi.mock('$lib/app/supabase.js', () => ({
  getAuthHeader: async () => mockAuthHeader
}));

const {
  clearStoredEventKey,
  fetchActiveScoutingEventKey,
  fetchAvailableScoutingEvents,
  forgetSharedConfig,
  lastKnownEventKey,
  rememberEventKey
} = await import('./scoutingEvent.js');

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

describe('scoutingEvent', () => {
  beforeEach(() => {
    mockAuthHeader = {};
    forgetSharedConfig();
    vi.stubGlobal('localStorage', fakeStorage());
  });

  it('attaches Authorization header from getAuthHeader when fetching /api/scouting-config', async () => {
    mockAuthHeader = { Authorization: 'Bearer fresh-jwt' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { event_key: '2026caav', available_events: [{ value: '2026caav', label: '2026CAAV' }] }
      })
    });

    const eventKey = await fetchActiveScoutingEventKey(fetchMock);
    expect(eventKey).toBe('2026caav');
    expect(fetchMock).toHaveBeenCalledWith('/api/scouting-config', {
      headers: { Authorization: 'Bearer fresh-jwt' }
    });
    expect(lastKnownEventKey()).toBe('2026caav');

    const events = await fetchAvailableScoutingEvents(fetchMock);
    expect(events).toEqual([{ value: '2026caav', label: '2026CAAV' }]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/scouting-config?events=1', {
      headers: { Authorization: 'Bearer fresh-jwt' }
    });
  });

  it('clears stored event keys and in-memory config on clearStoredEventKey', () => {
    rememberEventKey('2026caav');
    expect(lastKnownEventKey()).toBe('2026caav');

    clearStoredEventKey();
    expect(lastKnownEventKey()).toBe('');
  });
});
