// Training mode: a competition code (for example 2026training) whose "matches" are real past matches picked from
// The Blue Alliance. Each picked match gets the next qualification number under the training code, so a scout's
// assignment and report look exactly like a normal one (2026training_qm3, frc254) and nothing downstream needs to
// know about training. These helpers are shared by the admin Training tab, the API and the match scouting page.

import { compareTbaMatches, tbaMatchLabel } from '$lib/matches/matchKeys.js';

export function youtubeUrl(videoKey) {
  return videoKey ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoKey)}` : '';
}

/** The trimmed shape the Training tab works with. */
export function simplifyTbaMatch(match) {
  const video = (match?.videos || []).find((entry) => entry?.type === 'youtube' && entry?.key);
  return {
    key: match.key,
    comp_level: match.comp_level,
    set_number: match.set_number,
    match_number: match.match_number,
    label: tbaMatchLabel(match),
    red: match?.alliances?.red?.team_keys || [],
    blue: match?.alliances?.blue?.team_keys || [],
    red_score: match?.alliances?.red?.score ?? null,
    blue_score: match?.alliances?.blue?.score ?? null,
    video_key: video?.key || null,
    time: match.actual_time || match.time || null
  };
}

export function sortTbaMatches(matches) {
  return [...matches].sort(compareTbaMatches);
}

/** The next unused qualification key under a training code: 2026training_qm1, _qm2, ... */
export function nextTrainingMatchKey(eventKey, existingMatchKeys) {
  const used = new Set(
    (existingMatchKeys || []).map((key) => Number(String(key).match(/_qm(\d+)$/)?.[1])).filter(Boolean)
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return `${eventKey}_qm${number}`;
}

/** A match key from what a scout or a link supplies ("3", "qm3", "Qual 3" or the full key) under an event. */
export function matchKeyFor(eventKey, raw) {
  const text = String(raw || '').trim();
  if (!text || !eventKey) return '';
  if (text.includes('_')) return text;
  if (/^(qm|qf|sf|f)\d/i.test(text)) return `${eventKey}_${text.toLowerCase()}`;
  const digits = text.match(/\d+/)?.[0];
  return digits ? `${eventKey}_qm${digits}` : '';
}

/** Events that have finished, newest first, filtered by a free-text search over name, code, city and week. */
export function searchPastEvents(events, query, today = new Date().toISOString().slice(0, 10)) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return (events || [])
    .filter((event) => event?.end_date && event.end_date < today)
    .filter((event) => {
      const haystack =
        `${event.key} ${event.name} ${event.short_name || ''} ${event.city || ''} ${event.state_prov || ''} ${event.country || ''} ${event.week != null ? `week ${event.week + 1}` : ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (left, right) =>
        String(right.end_date).localeCompare(String(left.end_date)) ||
        String(left.name).localeCompare(String(right.name))
    );
}

/** A random element, or null. `random` is injectable for tests. */
export function pickRandom(list, random = Math.random) {
  return list?.length ? list[Math.floor(random() * list.length)] : null;
}

/**
 * Spreads a pool of scouts over the empty robot slots, one scout per slot, keeping whoever is already assigned.
 * Scouts with the fewest training assignments go first, so practice is shared out evenly.
 * @param {Array<{ match_key: string, team_key: string, user_id: string|null }>} slots
 * @param {string[]} pool user ids
 * @returns {Array<{ match_key: string, team_key: string, user_id: string }>} the new assignments only
 */
export function autoFillSlots(slots, pool) {
  if (!pool?.length) return [];
  const load = new Map(pool.map((id) => [id, 0]));
  const busy = new Map();
  for (const slot of slots) {
    if (!slot.user_id) continue;
    if (load.has(slot.user_id)) load.set(slot.user_id, load.get(slot.user_id) + 1);
    if (!busy.has(slot.match_key)) busy.set(slot.match_key, new Set());
    busy.get(slot.match_key).add(slot.user_id);
  }
  const added = [];
  for (const slot of slots) {
    if (slot.user_id) continue;
    const inMatch = busy.get(slot.match_key) || new Set();
    // One scout watches one robot per match.
    const candidates = pool
      .filter((id) => !inMatch.has(id))
      .sort((left, right) => load.get(left) - load.get(right) || pool.indexOf(left) - pool.indexOf(right));
    const scout = candidates[0];
    if (!scout) continue;
    added.push({ match_key: slot.match_key, team_key: slot.team_key, user_id: scout });
    load.set(scout, load.get(scout) + 1);
    inMatch.add(scout);
    busy.set(slot.match_key, inMatch);
  }
  return added;
}
