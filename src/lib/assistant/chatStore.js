// Saved AI analytics chats, kept in the browser (localStorage) per signed-in user, so each person sees only their
// own and nothing is sent anywhere. Storage is injected so this is testable and so a database-backed store can
// replace it later without touching the page. Every read tolerates missing, blocked or corrupt storage.

const VERSION = 1;
export const MAX_CHATS = 60;
export const MAX_MESSAGES = 60;
const TITLE_LENGTH = 60;

const keyFor = (userId) => `scouting-ai-chats:${userId}`;
const knownChatKeys = new Set();

/** A short title from the first thing the person asked. */
export function titleFor(messages) {
  const first = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
  const text = String(first?.content || 'New chat')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text;
}

export const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function readAll(storage, userId) {
  if (!storage || !userId) return [];
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(userId)) || 'null');
    if (!parsed || parsed.v !== VERSION || !Array.isArray(parsed.chats)) return [];
    return parsed.chats.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
  } catch {
    return [];
  }
}

function writeAll(storage, userId, chats) {
  if (!storage || !userId) return false;
  const k = keyFor(userId);
  knownChatKeys.add(k);
  const payload = JSON.stringify({ v: VERSION, chats });
  try {
    storage.setItem(k, payload);
    return true;
  } catch {
    // Storage full: drop the oldest chats until it fits, rather than losing the one being saved.
    for (let keep = chats.length - 1; keep >= 1; keep -= 1) {
      try {
        storage.setItem(k, JSON.stringify({ v: VERSION, chats: chats.slice(0, keep) }));
        return true;
      } catch {
        /* keep trimming */
      }
    }
    return false;
  }
}

export const MAX_SAVED_FILE_CHARS = 100_000; // bigger files are not kept in the browser's small storage

// Files keep their details; the content is kept only when small enough, otherwise the card shows it was not saved.
const cleanFile = (f) => ({
  filename: String(f.filename),
  rows: f.rows ?? null,
  mime: f.mime || 'text/csv;charset=utf-8',
  bytes: f.bytes ?? (f.content ? f.content.length : 0),
  content: typeof f.content === 'string' && f.content.length <= MAX_SAVED_FILE_CHARS ? f.content : null
});
// A proposal that was still running when saved is shown as waiting again rather than as stuck.
const cleanProposal = (p) => ({
  id: String(p.id),
  kind: p.kind,
  summary: String(p.summary),
  requests: p.requests,
  status: p.status === 'running' ? 'pending' : p.status || 'pending',
  message: p.message || null
});

const clean = (messages) =>
  (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tools?.length ? { tools: m.tools.map((t) => ({ name: t.name })) } : {}),
      ...(m.files?.length ? { files: m.files.map(cleanFile) } : {}),
      ...(m.proposals?.length ? { proposals: m.proposals.map(cleanProposal) } : {})
    }));

/** Chats newest first, without their messages: { id, title, updatedAt, count }. */
export function listChats(storage, userId) {
  return readAll(storage, userId)
    .map((c) => ({
      id: c.id,
      title: c.title || titleFor(c.messages),
      updatedAt: c.updatedAt || 0,
      count: c.messages.length,
      eventKey: c.eventKey || null
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadChat(storage, userId, id) {
  const chat = readAll(storage, userId).find((c) => c.id === id);
  return chat ? { ...chat, messages: chat.messages } : null;
}

/** Create or update a chat. Returns the saved summary, or null when there is nothing worth saving. */
export function saveChat(storage, userId, { id, messages, eventKey = null, now = Date.now() }) {
  const kept = clean(messages);
  if (!id || !kept.some((m) => m.role === 'user')) return null;
  const all = readAll(storage, userId);
  const existing = all.find((c) => c.id === id);
  const chats = all.filter((c) => c.id !== id);
  // A title the person chose is theirs: later messages must not replace it with the first question.
  const chat = {
    id,
    title: existing?.titleLocked ? existing.title : titleFor(kept),
    titleLocked: Boolean(existing?.titleLocked),
    updatedAt: now,
    eventKey,
    messages: kept
  };
  const next = [chat, ...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  return writeAll(storage, userId, next)
    ? { id, title: chat.title, updatedAt: now, count: kept.length, eventKey }
    : null;
}

export const MAX_TITLE = 80;

/** Give a chat a name of the person's choosing. Blank restores the automatic title. Returns the new title, or null if the chat is missing. */
export function renameChat(storage, userId, id, title) {
  const chats = readAll(storage, userId);
  const chat = chats.find((c) => c.id === id);
  if (!chat) return null;
  const clean = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
  if (clean) {
    chat.title = clean;
    chat.titleLocked = true;
  } else {
    chat.title = titleFor(chat.messages);
    chat.titleLocked = false;
  }
  return writeAll(storage, userId, chats) ? chat.title : null;
}

export function deleteChat(storage, userId, id) {
  const chats = readAll(storage, userId);
  const next = chats.filter((c) => c.id !== id);
  if (next.length === chats.length) return false;
  return writeAll(storage, userId, next);
}

/** Clear saved AI chats from storage (used on signOut so shared tablets do not leak strategy chats). */
export function clearAllChats(storage = globalThis.localStorage, userId = null) {
  if (!storage) return 0;
  try {
    const keys = new Set();
    if (userId) {
      keys.add(keyFor(userId));
    } else {
      for (const k of knownChatKeys) keys.add(k);
      if (typeof storage.length === 'number' && typeof storage.key === 'function') {
        for (let i = 0; i < storage.length; i += 1) {
          const k = storage.key(i);
          if (k && k.startsWith('scouting-ai-chats:')) keys.add(k);
        }
      }
      for (const k of Object.keys(storage)) {
        if (k.startsWith('scouting-ai-chats:')) keys.add(k);
      }
    }
    let cleared = 0;
    for (const k of keys) {
      if (typeof storage.removeItem === 'function') {
        storage.removeItem(k);
      } else if (typeof storage.setItem === 'function') {
        storage.setItem(k, JSON.stringify({ v: VERSION, chats: [] }));
      }
      knownChatKeys.delete(k);
      cleared += 1;
    }
    return cleared;
  } catch {
    return 0;
  }
}

/** Filter a chat list by a search box: every word must appear in the title (case-insensitive). */
export function searchChats(chats, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return chats;
  return chats.filter((c) => {
    const t = String(c.title).toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then a date. */
export function ago(timestamp, now = Date.now()) {
  const diff = now - timestamp;
  if (!Number.isFinite(diff) || diff < -60_000) return ''; // a clock more than a minute ahead is nonsense; a few seconds is just skew
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
