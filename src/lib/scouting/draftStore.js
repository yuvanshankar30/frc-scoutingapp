// Client-side form draft persistence for match/pit scouting forms (COMP-13),
// with automatic cleanup on submission or sign-out on shared devices (COMP-06).

const DRAFT_PREFIX = 'scouting_draft_v1:';
const knownDraftKeys = new Set();

function fullKey(kind, scopeKey = 'default') {
  return `${DRAFT_PREFIX}${String(kind || 'form').trim()}:${String(scopeKey || 'default').trim()}`;
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // ignore
  }
  return null;
}

export function saveScoutingDraft(kind, scopeKey, draftState, storage) {
  const target = getStorage(storage);
  if (!target || !draftState || typeof draftState !== 'object') return false;
  const k = fullKey(kind, scopeKey);
  try {
    target.setItem(k, JSON.stringify({ v: 1, savedAt: Date.now(), state: draftState }));
    knownDraftKeys.add(k);
    return true;
  } catch {
    return false;
  }
}

export function loadScoutingDraft(kind, scopeKey, storage) {
  const target = getStorage(storage);
  if (!target) return null;
  const k = fullKey(kind, scopeKey);
  try {
    const raw = target.getItem(k);
    if (!raw) return null;
    knownDraftKeys.add(k);
    const parsed = JSON.parse(raw);
    return parsed?.v === 1 && parsed?.state && typeof parsed.state === 'object' ? parsed.state : null;
  } catch {
    return null;
  }
}

export function clearScoutingDraft(kind, scopeKey, storage) {
  const target = getStorage(storage);
  if (!target) return false;
  const k = fullKey(kind, scopeKey);
  try {
    target.removeItem?.(k);
    knownDraftKeys.delete(k);
    return true;
  } catch {
    return false;
  }
}

export function clearAllScoutingDrafts(storage) {
  const targets = [];
  if (storage) {
    targets.push(storage);
  } else {
    try {
      if (typeof sessionStorage !== 'undefined') targets.push(sessionStorage);
    } catch {
      /* ignore */
    }
    try {
      if (typeof localStorage !== 'undefined') targets.push(localStorage);
    } catch {
      /* ignore */
    }
  }
  let removed = 0;
  for (const target of targets) {
    if (!target) continue;
    try {
      const keys = new Set(knownDraftKeys);
      if (typeof target.length === 'number' && typeof target.key === 'function') {
        for (let i = 0; i < target.length; i += 1) {
          const k = target.key(i);
          if (k && k.startsWith(DRAFT_PREFIX)) keys.add(k);
        }
      }
      for (const k of Object.keys(target)) {
        if (k.startsWith(DRAFT_PREFIX)) keys.add(k);
      }
      for (const k of keys) {
        target.removeItem?.(k);
        removed += 1;
      }
    } catch {
      // ignore storage errors
    }
  }
  knownDraftKeys.clear();
  return removed;
}
