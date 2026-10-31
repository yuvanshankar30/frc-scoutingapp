import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let mockAuthHeader = { Authorization: 'Bearer fresh-token' };
vi.mock('$lib/app/supabase.js', () => ({
  getAuthHeader: async () => mockAuthHeader
}));

const {
  addJob,
  buildJob,
  clearOfflineQueue,
  exportQueuedJobsJson,
  failedSyncCount,
  flushQueue,
  isQueueableFailure,
  lastSyncError,
  markFailed,
  pendingSyncCount,
  queuedJobs,
  removeJobs,
  sendJob,
  stripAuthHeaders
} = await import('./offlineQueue.js');

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

function makeJwt(sub) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, iat: Math.floor(Date.now() / 1000) }));
  return `${header}.${payload}.sig`;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  mockAuthHeader = { Authorization: `Bearer ${makeJwt('user-1')}` };
  clearOfflineQueue();
});

describe('buildJob & stripAuthHeaders (COMP-04 / COMP-06)', () => {
  it('strips Authorization headers while preserving non-auth headers, body, label, and extracting userId', () => {
    const token = makeJwt('scout-5940');
    const job = buildJob({
      url: '/api/matchscout',
      headers: { Authorization: `Bearer ${token}`, 'X-Custom': 'yes' },
      body: { a: 1 },
      label: 'Match 12 / Team 254'
    });
    expect(job.url).toBe('/api/matchscout');
    expect(job.headers).toEqual({ 'X-Custom': 'yes' });
    expect(job.headers.Authorization).toBeUndefined();
    expect(job.userId).toBe('scout-5940');
    expect(job.body).toEqual({ a: 1 });
    expect(job.label).toBe('Match 12 / Team 254');
    expect(job.attempts).toBe(0);
    expect(typeof job.id).toBe('string');
    expect(job.id.length).toBeGreaterThan(0);
    expect(typeof job.clientSubmittedAt).toBe('string');
  });

  it('defaults headers to an empty object and label to an empty string', () => {
    const job = buildJob({ url: '/api/matchscout', body: {} });
    expect(job.headers).toEqual({});
    expect(job.label).toBe('');
  });

  it('strips lowercase authorization headers too', () => {
    expect(stripAuthHeaders({ authorization: 'Bearer secret', Accept: 'application/json' })).toEqual({
      Accept: 'application/json'
    });
  });

  it('gives two jobs distinct ids', () => {
    const a = buildJob({ url: '/x', body: {} });
    const b = buildJob({ url: '/x', body: {} });
    expect(a.id).not.toBe(b.id);
  });
});

describe('addJob / removeJobs & COMP-07 deduplication', () => {
  it('appends without mutating the original array', () => {
    const original = [buildJob({ url: '/x', body: {} })];
    const next = addJob(original, buildJob({ url: '/y', body: {} }));
    expect(original.length).toBe(1);
    expect(next.length).toBe(2);
  });

  it('supersedes an earlier queued picklist reorder for the same event_key', () => {
    const first = buildJob({
      url: '/api/scouting-picklist',
      body: { action: 'reorder', event_key: '2026caav', ordered_ids: ['1', '2'] }
    });
    const second = buildJob({
      url: '/api/scouting-picklist',
      body: { action: 'reorder', event_key: '2026caav', ordered_ids: ['2', '1'] }
    });
    const next = addJob([first], second);
    expect(next).toHaveLength(1);
    expect(next[0].body.ordered_ids).toEqual(['2', '1']);
  });

  it('supersedes an earlier queued pit scout entry for the same team and preserves earlier non-empty photo_paths', () => {
    const first = buildJob({
      url: '/pitscout',
      body: {
        action: 'save-entry',
        event_key: '2026caav',
        team_key: 'frc254',
        photo_paths: ['2026caav/frc254/a.jpg'],
        additional_notes: 'old'
      }
    });
    const second = buildJob({
      url: '/pitscout',
      body: {
        action: 'save-entry',
        event_key: '2026caav',
        team_key: 'frc254',
        photo_paths: [],
        additional_notes: 'updated offline'
      }
    });
    const next = addJob([first], second);
    expect(next).toHaveLength(1);
    expect(next[0].body.additional_notes).toBe('updated offline');
    expect(next[0].body.photo_paths).toEqual(['2026caav/frc254/a.jpg']);
  });

  it('removes only the named ids, preserving order of the rest', () => {
    const a = buildJob({ url: '/a', body: {} });
    const b = buildJob({ url: '/b', body: {} });
    const c = buildJob({ url: '/c', body: {} });
    const next = removeJobs([a, b, c], [b.id]);
    expect(next.map((j) => j.url)).toEqual(['/a', '/c']);
  });

  it('is a no-op when the id is not present', () => {
    const a = buildJob({ url: '/a', body: {} });
    expect(removeJobs([a], ['does-not-exist'])).toEqual([a]);
  });
});

describe('markFailed', () => {
  it('increments attempts and records the error on only the matching job', () => {
    const a = buildJob({ url: '/a', body: {} });
    const b = buildJob({ url: '/b', body: {} });
    const next = markFailed([a, b], a.id, 'timed out');
    const updatedA = next.find((j) => j.id === a.id);
    const updatedB = next.find((j) => j.id === b.id);
    expect(updatedA.attempts).toBe(1);
    expect(updatedA.lastError).toBe('timed out');
    expect(updatedB.attempts).toBe(0);
    expect(updatedB.lastError).toBeUndefined();
  });

  it('accumulates across repeated failures of the same job', () => {
    const a = buildJob({ url: '/a', body: {} });
    let queue = markFailed([a], a.id, 'first');
    queue = markFailed(queue, a.id, 'second');
    expect(queue[0].attempts).toBe(2);
    expect(queue[0].lastError).toBe('second');
  });
});

describe('isQueueableFailure', () => {
  it('queues a timeout (AbortError)', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(isQueueableFailure(error)).toBe(true);
  });

  it('queues a connection-level failure (fetch throws TypeError)', () => {
    expect(isQueueableFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('does not queue a real server error response (a plain Error from a non-ok response)', () => {
    expect(isQueueableFailure(new Error('match_key and team_key required'))).toBe(false);
  });

  it('does not queue when there is no error object at all', () => {
    expect(isQueueableFailure(undefined)).toBe(false);
  });
});

describe('sendJob & flushQueue (COMP-04, COMP-06, COMP-07)', () => {
  it('attaches a fresh Authorization token at send time and includes client_submitted_at', async () => {
    const job = buildJob({
      url: '/api/matchscout',
      headers: { Authorization: `Bearer ${makeJwt('user-1')}` },
      body: { event_key: '2026caav', match_key: '2026caav_qm1', team_key: 'frc5940' },
      clientSubmittedAt: '2026-10-16T10:00:00.000Z'
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    });
    const freshJwt = makeJwt('user-1');

    await sendJob(job, {
      getAuthHeaderImpl: async () => ({ Authorization: `Bearer ${freshJwt}` }),
      fetchImpl: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/api/matchscout');
    expect(calledInit.headers.Authorization).toBe(`Bearer ${freshJwt}`);
    expect(JSON.parse(calledInit.body)).toMatchObject({
      event_key: '2026caav',
      match_key: '2026caav_qm1',
      team_key: 'frc5940',
      client_submitted_at: '2026-10-16T10:00:00.000Z'
    });
  });

  it('refuses to send and surfaces 401 when no active session token is available', async () => {
    const job = buildJob({ url: '/api/matchscout', body: { a: 1 } });
    localStorage.setItem('scouting_offline_queue_v1', JSON.stringify([job]));

    await flushQueue({
      getAuthHeaderImpl: async () => ({}),
      fetchImpl: vi.fn()
    });

    expect(get(pendingSyncCount)).toBe(1);
    expect(get(failedSyncCount)).toBe(1);
    expect(get(lastSyncError)).toContain('401');
  });

  it('refuses to send a job queued by a different user on a shared device (COMP-06)', async () => {
    const job = buildJob({
      url: '/api/matchscout',
      userId: 'user-a',
      body: { a: 1 }
    });
    await expect(
      sendJob(job, {
        getAuthHeaderImpl: async () => ({ Authorization: `Bearer ${makeJwt('user-b')}` }),
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow(/different user account/);
  });

  it('blocks a delayed picklist reorder from clobbering newer server picklist state (COMP-07)', async () => {
    const job = buildJob({
      url: '/api/scouting-picklist',
      userId: 'user-1',
      clientSubmittedAt: '2026-10-16T10:00:00.000Z',
      body: { action: 'reorder', event_key: '2026caav', ordered_ids: ['a', 'b'] }
    });
    const fetchMock = vi.fn().mockImplementation(async (url, init) => {
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [{ id: 'a', updated_at: '2026-10-16T11:30:00.000Z' }]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });

    await expect(
      sendJob(job, {
        getAuthHeaderImpl: async () => ({ Authorization: `Bearer ${makeJwt('user-1')}` }),
        fetchImpl: fetchMock
      })
    ).rejects.toThrow(/Picklist was updated more recently/);
    // Ensure POST was never sent after detecting newer server state
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the queue and exports queued jobs without bearer tokens', () => {
    const job = buildJob({
      url: '/api/matchscout',
      headers: { Authorization: 'Bearer secret-token' },
      body: { team_key: 'frc5940' }
    });
    localStorage.setItem('scouting_offline_queue_v1', JSON.stringify([job]));
    const exported = exportQueuedJobsJson();
    expect(exported).toContain('frc5940');
    expect(exported).not.toContain('secret-token');

    clearOfflineQueue();
    expect(queuedJobs()).toEqual([]);
    expect(get(pendingSyncCount)).toBe(0);
    expect(get(failedSyncCount)).toBe(0);
    expect(get(lastSyncError)).toBeNull();
  });
});
