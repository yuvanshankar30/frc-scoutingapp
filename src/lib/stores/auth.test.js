import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let mockProfileRow = { id: 'u1', email: 'scout@example.com', full_name: 'Scout One', role: 'member' };
let mockRosterRows = [];
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('$lib/app/supabase.js', () => ({
  getAuthHeader: async () => ({}),
  supabase: {
    auth: {
      signOut: (...args) => signOutMock(...args),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    from: (table) => {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockProfileRow, error: null })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: async () => ({ data: mockRosterRows, error: null })
        })
      };
    }
  }
}));

const { fetchUserProfile, signOut, user, userProfile } = await import('./auth.js');
const { fetchWithCache } = await import('$lib/app/offlineCache.js');
const { saveChat, listChats } = await import('$lib/assistant/chatStore.js');
const { rememberEventKey, lastKnownEventKey } = await import('$lib/scouting/scoutingEvent.js');
const { buildJob, queuedJobs } = await import('$lib/app/offlineQueue.js');

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

describe('auth store (COMP-06, COMP-10)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    signOutMock.mockClear();
    mockProfileRow = { id: 'u1', email: 'scout@example.com', full_name: 'Scout One', role: 'member' };
    mockRosterRows = [];
    user.set({ id: 'u1', email: 'scout@example.com' });
  });

  it('defaults missing general_role to "none" rather than "member" (COMP-10)', async () => {
    mockProfileRow = { id: 'u1', email: 'pending@example.com', role: 'member', general_role: null };
    const profile = await fetchUserProfile('u1');
    expect(profile.general_role).toBe('none');
  });

  it('warns when unsynced offline jobs exist and cancels signOut if user declines confirmation (COMP-06)', async () => {
    const job = buildJob({ url: '/api/matchscout', body: { team_key: 'frc5940' } });
    localStorage.setItem('scouting_offline_queue_v1', JSON.stringify([job]));

    const confirmImpl = vi.fn().mockResolvedValue(false);
    const result = await signOut({ confirmImpl });

    expect(confirmImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cancelled: true, unsyncedCount: 1 });
    expect(signOutMock).not.toHaveBeenCalled();
    expect(queuedJobs()).toHaveLength(1);
    expect(get(user)).toEqual({ id: 'u1', email: 'scout@example.com' });
  });

  it('clears offlineQueue, offlineCache, AI chats, and stored event keys on signOut (COMP-06)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [1] }) }));
    await fetchWithCache('/api/x', { cacheKey: 'x' });
    saveChat(localStorage, 'u1', { id: 'c1', messages: [{ role: 'user', content: 'picklist strategy' }] });
    rememberEventKey('2026caav');
    const job = buildJob({ url: '/api/matchscout', body: { team_key: 'frc5940' } });
    localStorage.setItem('scouting_offline_queue_v1', JSON.stringify([job]));

    const confirmImpl = vi.fn().mockResolvedValue(true);
    const result = await signOut({ confirmImpl });

    expect(result).toEqual({ cancelled: false, unsyncedCount: 0 });
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(queuedJobs()).toEqual([]);
    expect(localStorage.getItem('scouting_cache_v1:x')).toBeNull();
    expect(listChats(localStorage, 'u1')).toEqual([]);
    expect(lastKnownEventKey()).toBe('');
    expect(get(user)).toBeNull();
    expect(get(userProfile)).toBeNull();
  });
});
