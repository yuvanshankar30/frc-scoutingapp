import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { getAuthHeader } from '$lib/app/supabase.js';

// A localStorage-backed retry queue for POST submissions that must never be
// lost to a bad connection - built for scouting at competitions, where
// scouts are on cell hotspots in a stadium and a dropped connection mid-
// submit is routine, not exceptional.
//
// Only wire this into an endpoint whose write is a genuine upsert on a
// stable key (event_key/match_key/team_key/created_by, or similar) - see
// each call site's own comment. A retried job here can legitimately arrive
// at the server twice (the first response can be lost after the server
// already committed the write), so a plain insert()-based endpoint would
// get duplicate rows on retry. Match Scouting and Pit Scouting's own APIs
// are upserts for exactly this reason; Note Scout and Quick Scout are not,
// and must not be queued through this module until they are.

const STORAGE_KEY = 'scouting_offline_queue_v1';
const SEND_TIMEOUT_MS = 8000;
const RETRY_INTERVAL_MS = 20000;

export const pendingSyncCount = writable(0);
export const failedSyncCount = writable(0);
export const lastSyncError = writable(null);

function randomId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Pure: removes Authorization/authorization headers so raw Bearer JWTs are
 * never persisted to localStorage (COMP-04, COMP-06). */
export function stripAuthHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const clean = { ...headers };
  for (const key of Object.keys(clean)) {
    if (key.toLowerCase() === 'authorization') {
      delete clean[key];
    }
  }
  return clean;
}

function extractUserIdFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const raw = headers.Authorization || headers.authorization || '';
  const token = String(raw)
    .replace(/^Bearer\s+/i, '')
    .trim();
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    return typeof claims?.sub === 'string' && claims.sub.trim() ? claims.sub.trim() : null;
  } catch {
    return null;
  }
}

/** Pure: builds the queued job record for one submission. Exported so
 * tests can check its shape without touching localStorage. */
export function buildJob({ url, headers, body, label, userId, clientSubmittedAt }) {
  const queuedAt = Date.now();
  const resolvedUserId = userId ?? extractUserIdFromHeaders(headers) ?? null;
  const resolvedSubmittedAt = clientSubmittedAt || new Date(queuedAt).toISOString();
  return {
    id: randomId(),
    url,
    headers: stripAuthHeaders(headers),
    body,
    label: label || '',
    userId: resolvedUserId,
    clientSubmittedAt: resolvedSubmittedAt,
    queuedAt,
    attempts: 0
  };
}

function isSameLogicalTarget(a, b) {
  if (!a || !b || a.url !== b.url) return false;
  if ((a.userId || null) !== (b.userId || null)) return false;
  const ab = a.body;
  const bb = b.body;
  if (!ab || !bb || typeof ab !== 'object' || typeof bb !== 'object') return false;
  if (a.url === '/api/scouting-picklist' && ab.action === 'reorder' && bb.action === 'reorder') {
    return Boolean(ab.event_key && ab.event_key === bb.event_key);
  }
  if (a.url === '/pitscout' && ab.action === 'save-entry' && bb.action === 'save-entry') {
    return Boolean(ab.event_key && ab.team_key && ab.event_key === bb.event_key && ab.team_key === bb.team_key);
  }
  return false;
}

/** Pure: appends a job, returning a new array (caller persists it).
 * Supersedes older queued jobs for the same shared picklist reorder or pit
 * entry so an earlier offline snapshot does not replay before a newer one (COMP-07). */
export function addJob(queue, job) {
  const list = Array.isArray(queue) ? queue : [];
  let mergedJob = job;
  const filtered = [];
  for (const existing of list) {
    if (isSameLogicalTarget(existing, job)) {
      if (
        job.url === '/pitscout' &&
        Array.isArray(existing.body?.photo_paths) &&
        existing.body.photo_paths.length > 0 &&
        (!Array.isArray(job.body?.photo_paths) || job.body.photo_paths.length === 0)
      ) {
        mergedJob = {
          ...job,
          body: { ...job.body, photo_paths: [...existing.body.photo_paths] }
        };
      }
      continue;
    }
    filtered.push(existing);
  }
  return [...filtered, mergedJob];
}

/** Pure: removes jobs by id, returning a new array. */
export function removeJobs(queue, ids) {
  const idSet = new Set(ids);
  return queue.filter((job) => !idSet.has(job.id));
}

/** Pure: bumps attempts/lastError on one job, returning a new array. */
export function markFailed(queue, id, errorMessage) {
  return queue.map((job) => (job.id === id ? { ...job, attempts: job.attempts + 1, lastError: errorMessage } : job));
}

/** Pure: only a network-level failure is safe to queue for silent retry -
 * a timeout, an offline browser, or fetch's own connection-level rejection
 * (TypeError - DNS, refused, mixed content, CORS preflight failure). A real
 * HTTP response the server sent back (a 400 validation error, a 401) means
 * the server already judged the request - queuing that would hide a real
 * problem from the scout behind silent, endlessly-repeated failures instead
 * of surfacing it once, now, so they can fix the form. */
export function isQueueableFailure(error) {
  return error?.name === 'AbortError' || error instanceof TypeError;
}

function syncStoresFromQueue(queue) {
  const list = Array.isArray(queue) ? queue : [];
  pendingSyncCount.set(list.length);
  const failed = list.filter((job) => (job?.attempts || 0) > 0 && job?.lastError);
  failedSyncCount.set(failed.length);
  lastSyncError.set(failed.length ? failed[failed.length - 1].lastError : null);
}

function readQueue() {
  if (!browser && typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((job) =>
      job && typeof job === 'object' ? { ...job, headers: stripAuthHeaders(job.headers) } : job
    );
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  const sanitized = (Array.isArray(queue) ? queue : []).map((job) =>
    job && typeof job === 'object' ? { ...job, headers: stripAuthHeaders(job.headers) } : job
  );
  syncStoresFromQueue(sanitized);
  if (!browser && typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // localStorage can throw (private browsing, quota) - the job already
    // queued in memory for this page load's flush attempts; only a reload
    // loses it, not this submission.
  }
}

export function clearOfflineQueue() {
  syncStoresFromQueue([]);
  if (!browser && typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function exportQueuedJobsJson() {
  return JSON.stringify(readQueue(), null, 2);
}

async function checkStaleSharedReplay(job, authHeaders, signal, fetchImpl) {
  const jobTimestampMs =
    Date.parse(job.body?.client_submitted_at || job.clientSubmittedAt || '') || Number(job.queuedAt) || 0;
  if (!jobTimestampMs) return;

  if (job.url === '/api/scouting-picklist' && job.body?.action === 'reorder' && job.body?.event_key) {
    let response;
    try {
      response = await fetchImpl(`/api/scouting-picklist?event_key=${encodeURIComponent(job.body.event_key)}`, {
        method: 'GET',
        headers: { ...authHeaders },
        signal
      });
    } catch {
      return;
    }
    if (!response?.ok) return;
    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const newestServerMs = rows.reduce((max, row) => {
      const ms = Date.parse(row?.updated_at || row?.created_at || '');
      return Number.isFinite(ms) && ms > max ? ms : max;
    }, 0);
    if (newestServerMs > jobTimestampMs) {
      throw new Error('Picklist was updated more recently on the server; skipped stale offline reorder (409)');
    }
  }
}

export async function sendJob(job, { getAuthHeaderImpl = getAuthHeader, fetchImpl = fetch } = {}) {
  const authHeaders = (await getAuthHeaderImpl()) || {};
  const hasAuth = Boolean(authHeaders.Authorization || authHeaders.authorization);
  if (!hasAuth) {
    throw new Error('Session expired — sign in again to sync queued scouting reports (401)');
  }

  const activeUserId = extractUserIdFromHeaders(authHeaders);
  if (job.userId && activeUserId && activeUserId !== job.userId) {
    throw new Error('Queued by a different user account — sign in as that scout or export queued reports (403)');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await checkStaleSharedReplay(job, authHeaders, controller.signal, fetchImpl);

    const submittedIso =
      job.body?.client_submitted_at ||
      job.clientSubmittedAt ||
      (job.queuedAt ? new Date(job.queuedAt).toISOString() : new Date().toISOString());
    const bodyToSend =
      job.body && typeof job.body === 'object' && !Array.isArray(job.body)
        ? { ...job.body, client_submitted_at: submittedIso }
        : job.body;

    const response = await fetchImpl(job.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...stripAuthHeaders(job.headers),
        ...authHeaders
      },
      body: JSON.stringify(bodyToSend),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const baseError = payload?.error || `Request failed (${response.status})`;
      const withStatus = baseError.includes(`(${response.status})`) ? baseError : `${baseError} (${response.status})`;
      throw new Error(withStatus);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

let flushing = false;

/** Attempts every queued job once. Safe to call opportunistically (online
 * event, focus regain, a timer) - a no-op while offline or already
 * flushing, and each job's own failure only affects that job. */
export async function flushQueue(options = {}) {
  if ((!browser && typeof localStorage === 'undefined') || flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  flushing = true;
  try {
    let queue = readQueue();
    if (!queue.length) return;
    const succeeded = [];
    for (const job of queue) {
      try {
        await sendJob(job, options);
        succeeded.push(job.id);
      } catch (error) {
        queue = markFailed(queue, job.id, error?.message || String(error));
      }
    }
    writeQueue(removeJobs(queue, succeeded));
  } finally {
    flushing = false;
  }
}

/** Persists a submission before ever touching the network - the
 * localStorage write below is what actually protects it from a dropped
 * connection, not the flush attempt that follows. Call this once you've
 * already decided the direct attempt failed for a network reason (see
 * submitOrQueue, the normal entry point) - or directly, if a caller wants
 * to always queue rather than try inline first. */
export function queueSubmission({ url, headers, body, label, userId, clientSubmittedAt }) {
  const job = buildJob({ url, headers, body, label, userId, clientSubmittedAt });
  writeQueue(addJob(readQueue(), job));
  void flushQueue();
  return job.id;
}

export function queuedJobs() {
  return readQueue();
}

/** The normal entry point for a submission that must survive a bad
 * connection: try it directly with a short timeout, and only fall back to
 * the local queue for a network-level failure (see isQueueableFailure). A
 * real error response from the server is thrown immediately instead - see
 * this module's own docstring for why. */
export async function submitOrQueue({
  url,
  headers,
  body,
  label,
  userId,
  clientSubmittedAt,
  timeoutMs = SEND_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const submittedIso = clientSubmittedAt || new Date().toISOString();
  const bodyWithTimestamp =
    body && typeof body === 'object' && !Array.isArray(body) && !body.client_submitted_at
      ? { ...body, client_submitted_at: submittedIso }
      : body;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(bodyWithTimestamp),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }
    return { queued: false, data: payload };
  } catch (error) {
    if (isQueueableFailure(error)) {
      queueSubmission({ url, headers, body, label, userId, clientSubmittedAt: submittedIso });
      return { queued: true, data: null };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

if (browser) {
  writeQueue(readQueue());
  window.addEventListener('online', () => void flushQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
  });
  setInterval(() => void flushQueue(), RETRY_INTERVAL_MS);
}
