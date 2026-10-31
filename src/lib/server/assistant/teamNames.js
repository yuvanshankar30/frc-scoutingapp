import { tbaGet } from './eventData.js';

// People ask about robots by name ("Citrus", "Cheesy Poofs"), but the data is keyed by team number. This turns a
// name into a number: first against the teams at this event (and any names already known), then, only if that
// finds nothing, against every FRC team on The Blue Alliance (fetched once and remembered for hours).

export const normalizeName = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bteam\b/g, '')
    .replace(/[^a-z0-9]/g, '');

const NUMBER_FORM = /^(?:frc|team)?\s*#?\s*(\d{1,5})$/i;
export const isNumberLike = (value) => NUMBER_FORM.test(String(value ?? '').trim());
export const teamNumberOf = (key) => String(key || '').replace(/^frc/i, '');

const entryOf = (key, nickname, inEvent) => ({
  key,
  number: Number(teamNumberOf(key)) || 0,
  nickname: String(nickname),
  inEvent,
  norm: normalizeName(nickname)
});

/**
 * Best matches for a name, best first: an exact name, then one that starts the other, then one that contains it.
 * `prefer` (a Set of team keys) breaks ties towards teams that matter here, then teams at this event.
 */
export function findByName(directory, query, prefer = new Set()) {
  const q = normalizeName(query);
  if (q.length < 3) return [];
  const scored = [];
  for (const entry of directory) {
    if (entry.norm.length < 2) continue;
    let score = 0;
    if (entry.norm === q) score = 3;
    else if (entry.norm.length >= 3 && (entry.norm.startsWith(q) || q.startsWith(entry.norm))) score = 2;
    else if (q.length >= 4 && entry.norm.includes(q)) score = 1;
    if (score) scored.push({ ...entry, score, preferred: prefer.has(entry.key) || entry.inEvent });
  }
  return scored.sort((a, b) => b.score - a.score || Number(b.preferred) - Number(a.preferred) || a.number - b.number);
}

/** The one clear winner among matches, or null when it is ambiguous. */
export function pickTeam(matches) {
  if (!matches.length) return null;
  const top = matches.filter((m) => m.score === matches[0].score);
  if (top.length === 1) return top[0];
  const preferred = top.filter((m) => m.preferred);
  return preferred.length === 1 ? preferred[0] : null;
}

function pairsOf(names) {
  if (!names) return [];
  return names instanceof Map ? [...names] : Object.entries(names);
}

/** Teams at this event with their names (from The Blue Alliance and anything already loaded). Remembered per snapshot. */
export function eventDirectory(snapshot) {
  if (snapshot._directory) return snapshot._directory;
  snapshot._directory = (async () => {
    const found = new Map();
    const add = (key, nickname) => {
      if (key && nickname) found.set(key, entryOf(key, nickname, true));
    };
    for (const [key, nickname] of pairsOf(snapshot.teamNames)) add(key, nickname);
    for (const row of snapshot.picklist || []) add(row.team_key, row.nickname);
    if (snapshot.ctx)
      for (const team of (await tbaGet(snapshot.ctx, `/event/${snapshot.eventKey}/teams/simple`)) || [])
        add(team.key, team.nickname);
    return [...found.values()];
  })();
  return snapshot._directory;
}

const WORLD_TTL_MS = 12 * 60 * 60 * 1000;
const WORLD_PAGES = 18;
let world = null;
let worldAt = 0;

/** Every FRC team on The Blue Alliance, fetched once. Empty (and not remembered) when TBA cannot be reached. */
export function worldDirectory(ctx, now = Date.now()) {
  if (world && now - worldAt < WORLD_TTL_MS) return world;
  worldAt = now;
  const mine = (async () => {
    const pages = await Promise.all(
      Array.from({ length: WORLD_PAGES }, (_, page) => tbaGet(ctx, `/teams/${page}/simple`))
    );
    const list = pages
      .flat()
      .filter((team) => team?.key && team.nickname)
      .map((team) => entryOf(team.key, team.nickname, false));
    if (!list.length && world === mine) world = null;
    return list;
  })();
  world = mine;
  return mine;
}

export const resetWorldDirectory = () => {
  world = null;
  worldAt = 0;
};

/**
 * @returns {Promise<{ key: string|null, nickname: string|null, how: 'number'|'name'|null, candidates: Array }>}
 * `candidates` is filled when a name matched several teams or none clearly.
 */
export async function resolveTeam(snapshot, value, prefer = new Set()) {
  const text = String(value ?? '').trim();
  const digits = text.match(NUMBER_FORM);
  if (digits) return { key: `frc${Number(digits[1])}`, nickname: null, how: 'number', candidates: [] };
  if (!text) return { key: null, nickname: null, how: null, candidates: [] };
  let matches = findByName(await eventDirectory(snapshot), text, prefer);
  let picked = pickTeam(matches);
  if (!matches.length && snapshot.ctx) {
    matches = findByName(await worldDirectory(snapshot.ctx), text, prefer);
    picked = pickTeam(matches);
  }
  const candidates = matches
    .slice(0, 5)
    .map((m) => ({ team: teamNumberOf(m.key), nickname: m.nickname, at_this_event: m.inEvent }));
  return picked
    ? { key: picked.key, nickname: picked.nickname, how: 'name', candidates }
    : { key: null, nickname: null, how: null, candidates };
}
