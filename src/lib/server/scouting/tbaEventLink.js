// Which TBA event a competition code tracks (scouting_events.tba_event_key), for every server call to TBA.
// A code with no link, or no row, tracks the TBA event with its own key, which is how every code worked before.
// Cached briefly per server instance; setting a link clears the entry so the change shows at once here.
import { getSupabase } from '$lib/server/serviceClient.js';
import { normalizeTbaEventKey, relabelTbaPayload, swapEventPrefix } from '$lib/scouting/tbaEventLink.js';

const TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 256;
const VALID_EVENT_CODE = /^\d{4}[a-z0-9]{2,28}$/i;
const cache = new Map();

export function forgetTbaEventLink(code) {
  cache.delete(
    String(code || '')
      .trim()
      .toLowerCase()
  );
}

/** The TBA event key to use for a competition code. Never throws: on any problem it falls back to the code. */
export async function tbaEventKeyFor(code, db = null) {
  const key = String(code || '')
    .trim()
    .toLowerCase();
  if (!key || !VALID_EVENT_CODE.test(key)) return key;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tbaKey;
  let tbaKey = key;
  try {
    const client = db || getSupabase();
    const { data, error } = await client
      .from('scouting_events')
      .select('tba_event_key')
      .eq('event_key', key)
      .maybeSingle();
    if (!error) tbaKey = normalizeTbaEventKey(data?.tba_event_key) || key;
  } catch {
    // No database access (or the column is not there yet): use the code itself, as before.
  }
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { tbaKey, at: Date.now() });
  return tbaKey;
}

/** A match key under the code, as TBA knows it: 2026practice_qm3 -> 2026mttd_qm3. */
export async function tbaMatchKeyFor(matchKey, db = null) {
  const code = String(matchKey || '').split('_')[0];
  if (!code || !String(matchKey).includes('_')) return String(matchKey || '');
  return swapEventPrefix(matchKey, code, await tbaEventKeyFor(code, db));
}

export { relabelTbaPayload };
