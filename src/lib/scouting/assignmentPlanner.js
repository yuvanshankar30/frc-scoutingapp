// The planning rules behind the scout assignment board, kept out of the component so they
// can be tested. A "robot assignment" gives one team to one scout for every qualification
// match that team plays; these helpers work out who owns what, where a scout would be asked
// to watch two robots at once, and how to spread unassigned teams across scouts.

export const teamKeyOf = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `frc${Number(digits)}` : null;
};

/** "254, 1678  118" -> ['frc254', 'frc1678', 'frc118'] (unique, in order). */
export function parseTeamInput(text) {
  const seen = new Set();
  const keys = [];
  for (const part of String(text ?? '').split(/[\s,;]+/)) {
    const key = teamKeyOf(part);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** team key -> the match keys it plays. */
export function teamMatchMap(matches) {
  const map = new Map();
  for (const match of matches || []) {
    for (const team of [...(match.red || []), ...(match.blue || [])]) {
      if (!map.has(team)) map.set(team, []);
      map.get(team).push(match.key);
    }
  }
  return map;
}

/**
 * team key -> { userId, partial }. userId is the single scout who owns every match the team
 * plays, '' when nobody does. partial means some, but not all, of its matches are assigned
 * (or they are split between scouts), which a robot-level view cannot show as one owner.
 */
export function ownership(assignments, matches) {
  const result = new Map();
  for (const [team, matchKeys] of teamMatchMap(matches)) {
    const owners = matchKeys.map((key) => assignments?.[key]?.[team]?.user_id || '');
    const assigned = owners.filter(Boolean);
    const unique = new Set(assigned);
    const full = assigned.length === owners.length && unique.size === 1;
    result.set(team, { userId: full ? assigned[0] : '', partial: !full && assigned.length > 0 });
  }
  return result;
}

/** Pairs among teamKeys that play in the same match, so one scout could not watch both. */
export function conflictsFor(teamKeys, matchMap) {
  const out = [];
  const list = [...new Set(teamKeys)];
  for (let i = 0; i < list.length; i += 1) {
    const first = new Set(matchMap.get(list[i]) || []);
    for (let j = i + 1; j < list.length; j += 1) {
      const shared = (matchMap.get(list[j]) || []).filter((key) => first.has(key));
      if (shared.length) out.push({ a: list[i], b: list[j], matches: shared });
    }
  }
  return out;
}

/** How many matches a scout would cover for these teams. */
export const matchLoad = (teamKeys, matchMap) =>
  (teamKeys || []).reduce((sum, team) => sum + (matchMap.get(team)?.length || 0), 0);

/**
 * Spread unassigned teams over scouts: each team goes to the scout with the least work whose
 * existing teams never play in the same match as it. When every scout would clash, the least
 * loaded one is used and the clash is reported. Existing assignments are never moved.
 *
 * scouts: [{ id }]; held: Map scoutId -> [teamKey] already assigned.
 * Returns { plan: Map teamKey -> scoutId, clashes: number }.
 */
export function autoFill({ teams, scouts, held, matchMap }) {
  const teamsByScout = new Map(scouts.map((scout) => [scout.id, [...(held.get(scout.id) || [])]]));
  const plan = new Map();
  let clashes = 0;
  const ordered = [...teams].sort(
    (a, b) =>
      (matchMap.get(b)?.length || 0) - (matchMap.get(a)?.length || 0) ||
      Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))
  );
  for (const team of ordered) {
    const candidates = scouts.map((scout) => {
      const mine = teamsByScout.get(scout.id);
      return {
        id: scout.id,
        load: matchLoad(mine, matchMap),
        count: mine.length,
        clash: conflictsFor([...mine, team], matchMap).some((c) => c.a === team || c.b === team)
      };
    });
    const free = candidates.filter((candidate) => !candidate.clash);
    const pool = free.length ? free : candidates;
    if (!pool.length) continue;
    pool.sort((a, b) => a.load - b.load || a.count - b.count);
    const chosen = pool[0];
    if (!free.length) clashes += 1;
    teamsByScout.get(chosen.id).push(team);
    plan.set(team, chosen.id);
  }
  return { plan, clashes };
}
