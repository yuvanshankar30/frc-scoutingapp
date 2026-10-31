// A competition code can track a TBA event: a practice code (2026mttdpractice) or a renamed code can use a real
// event's schedule, teams, rankings and OPRs. Every TBA call is made with the tracked event's key, and match keys
// in the answer are renamed back to the code, so scouting reports (keyed by the code) still line up with the
// schedule. These are the pure parts; the lookup lives in $lib/server/scouting/tbaEventLink.js.

export const TBA_EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]{2,28}$/;

export function normalizeTbaEventKey(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return TBA_EVENT_KEY_PATTERN.test(key) ? key : null;
}

/** "2026mttdpractice_qm3" -> "2026mttd_qm3" when the code tracks 2026mttd; anything else unchanged. */
export function swapEventPrefix(key, fromEvent, toEvent) {
  const text = String(key ?? '');
  if (!fromEvent || !toEvent || fromEvent === toEvent) return text;
  if (text === fromEvent) return toEvent;
  return text.startsWith(`${fromEvent}_`) ? `${toEvent}${text.slice(fromEvent.length)}` : text;
}

/**
 * Renames the tracked TBA event's keys in a TBA answer back to the competition code: match keys
 * ("2026mttd_qm3" -> "2026code_qm3") and event keys ("2026mttd" -> "2026code"). Team keys are untouched.
 */
export function relabelTbaPayload(value, tbaKey, code) {
  if (!tbaKey || !code || tbaKey === code) return value;
  if (typeof value === 'string') return swapEventPrefix(value, tbaKey, code);
  if (Array.isArray(value)) return value.map((entry) => relabelTbaPayload(entry, tbaKey, code));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [field, relabelTbaPayload(entry, tbaKey, code)])
    );
  return value;
}

const words = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Plain text ranking of TBA events against what an admin typed, used on its own when Gemini is unavailable and to
 * order the fallback list. Matches on the key, name, short name, city and state; a whole-word hit counts more than
 * a partial one.
 */
export function rankEventsByText(events, query, limit = 8) {
  const terms = words(query).filter((term) => !/^\d{4}$/.test(term));
  if (!terms.length) return [];
  const scored = [];
  for (const event of events || []) {
    const haystack = words(
      `${event.key} ${event.key?.slice(4)} ${event.name} ${event.short_name || ''} ${event.city || ''} ${event.state_prov || ''}`
    );
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += 3;
      else if (haystack.some((word) => word.startsWith(term) || (term.length >= 4 && word.includes(term)))) score += 1;
    }
    if (score) scored.push({ event, score });
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score || String(left.event.start_date).localeCompare(String(right.event.start_date))
    )
    .slice(0, limit)
    .map((entry) => entry.event);
}

/** The season to search: a four-digit year in the query, else the code's year, else this year. */
export function searchYear(query, code, now = new Date()) {
  const fromQuery = String(query ?? '').match(/\b(19|20)\d{2}\b/)?.[0];
  const fromCode = String(code ?? '').match(/^(\d{4})/)?.[1];
  return Number(fromQuery || fromCode || now.getFullYear());
}

/** Keeps only keys from the candidate list, in the model's order, without duplicates. */
export function pickSuggestedKeys(modelText, candidateKeys, limit = 5) {
  const allowed = new Set(candidateKeys);
  let parsed = null;
  const json = String(modelText ?? '').match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
  try {
    parsed = json ? JSON.parse(json) : null;
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.matches) ? parsed.matches : [];
  const keys = [];
  for (const item of list) {
    const key = normalizeTbaEventKey(typeof item === 'string' ? item : item?.key);
    if (key && allowed.has(key) && !keys.includes(key)) keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}
