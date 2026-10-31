// The logic behind Quick Scout's match picker, kept out of the page so it can be
// tested: which kind of match something is, which matches to show around the
// current one, and where a scout most likely wants to start.

export const STAGES = [
  { key: 'qm', label: 'Qualifications', levels: ['qm'] },
  { key: 'playoff', label: 'Playoffs', levels: ['ef', 'qf', 'sf', 'f'] },
  { key: 'pm', label: 'Practice', levels: ['pm'] }
];

export const levelOf = (match) => String(match?.comp_level || '').toLowerCase();
export const stageOf = (match) => STAGES.find((stage) => stage.levels.includes(levelOf(match)))?.key || 'qm';

export function teamsOf(match) {
  return [...(match?.alliances?.red?.team_keys || []), ...(match?.alliances?.blue?.team_keys || [])];
}

export function isPlayed(match) {
  const red = match?.alliances?.red?.score;
  const blue = match?.alliances?.blue?.score;
  return (
    Number.isFinite(match?.actual_time) || (Number.isFinite(red) && red >= 0 && Number.isFinite(blue) && blue >= 0)
  );
}

/** Playoffs are few enough to show whole; a long list shows a window centred on the current match. */
export function nearbyMatches(list, currentIndex, stage, size = 9) {
  if (stage === 'playoff' || list.length <= size) return list;
  const centred = (currentIndex < 0 ? 0 : currentIndex) - Math.floor(size / 2);
  const start = Math.max(0, Math.min(centred, list.length - size));
  return list.slice(start, start + size);
}

/**
 * Where to start: the scout's next assigned match, else the next qualification
 * not yet played, else the next match of any kind, else an assigned one, else the first.
 */
export function startingMatch(matches, isMine = () => false) {
  const mine = (match) => teamsOf(match).some((team) => isMine(match.key, team));
  const upcoming = matches.filter((match) => !isPlayed(match));
  return (
    upcoming.find(mine) ||
    upcoming.find((match) => levelOf(match) === 'qm') ||
    upcoming[0] ||
    matches.find(mine) ||
    matches[0] ||
    null
  );
}
