// Pure helpers behind the Home screen. The page fetches The Blue
// Alliance and scouting data; everything that turns that data into the numbers
// shown on screen lives here so it can be tested without a browser.

import { compareTbaMatches, tbaMatchLabel } from '$lib/matches/matchKeys.js';

/** Epoch milliseconds a match is expected to start, preferring TBA's live estimate. */
export function matchStartMs(match) {
  const epoch = Number.isFinite(match?.predicted_time) ? match.predicted_time : match?.time;
  return Number.isFinite(epoch) ? epoch * 1000 : null;
}

const hasBeenPlayed = (match) =>
  Number.isFinite(match?.actual_time) ||
  (Number.isFinite(match?.alliances?.red?.score) &&
    match.alliances.red.score >= 0 &&
    Number.isFinite(match?.alliances?.blue?.score) &&
    match.alliances.blue.score >= 0);

/**
 * The next match our team has not played yet, with who we are partnered and
 * facing. Returns null when there is no upcoming match for us.
 */
export function findNextMatch(matches, ourTeamKey) {
  const upcoming = (matches || [])
    .filter((match) => !hasBeenPlayed(match))
    .filter((match) =>
      ['red', 'blue'].some((color) => (match?.alliances?.[color]?.team_keys || []).includes(ourTeamKey))
    )
    .sort(compareTbaMatches);
  const match = upcoming[0];
  if (!match) return null;
  const ourColor = match.alliances.red.team_keys.includes(ourTeamKey) ? 'red' : 'blue';
  const otherColor = ourColor === 'red' ? 'blue' : 'red';
  return {
    match,
    label: tbaMatchLabel(match),
    ourColor,
    partners: match.alliances[ourColor].team_keys.filter((key) => key !== ourTeamKey),
    opponents: match.alliances[otherColor].team_keys,
    startsAtMs: matchStartMs(match),
    matchesAway: upcoming.indexOf(match)
  };
}

/** Matches our team has played that already have a final score, newest last. */
export function ourResults(matches, ourTeamKey) {
  return (matches || [])
    .filter(hasBeenPlayed)
    .filter((match) =>
      ['red', 'blue'].some((color) => (match?.alliances?.[color]?.team_keys || []).includes(ourTeamKey))
    )
    .sort(compareTbaMatches)
    .map((match) => {
      const ourColor = match.alliances.red.team_keys.includes(ourTeamKey) ? 'red' : 'blue';
      const ours = match.alliances[ourColor].score;
      const theirs = match.alliances[ourColor === 'red' ? 'blue' : 'red'].score;
      return { label: tbaMatchLabel(match), ours, theirs, result: ours > theirs ? 'W' : ours < theirs ? 'L' : 'T' };
    });
}

/** Our row from TBA's qualification rankings, or null when we are not listed yet. */
export function standingFrom(rankings, ourTeamKey) {
  const list = Array.isArray(rankings) ? rankings : [];
  const row = list.find((entry) => entry?.team_key === ourTeamKey);
  if (!row) return null;
  const record = row.record || {};
  return {
    rank: row.rank,
    totalTeams: list.length,
    wins: record.wins ?? 0,
    losses: record.losses ?? 0,
    ties: record.ties ?? 0,
    matchesPlayed: row.matches_played ?? null
  };
}

/** Teams ranked ahead of ours, best first - who we will be chasing or picking against. */
export function teamsAheadOf(rankings, ourTeamKey, limit = 5) {
  const list = Array.isArray(rankings) ? rankings : [];
  const ours = list.find((entry) => entry?.team_key === ourTeamKey);
  if (!ours) return [];
  return list
    .filter((entry) => Number.isFinite(entry?.rank) && entry.rank < ours.rank)
    .sort((first, second) => first.rank - second.rank)
    .slice(-limit)
    .map((entry) => ({ teamKey: entry.team_key, rank: entry.rank }));
}

/** How much of the field our scouts have covered so far. */
export function scoutingCoverage({ teams = [], matchEntries = [], pitEntries = [], problems = [] } = {}) {
  const teamKeys = new Set((teams || []).map((team) => team?.key).filter(Boolean));
  const scoutedTeams = new Set(
    (matchEntries || []).map((entry) => entry?.team_key).filter((key) => key && (!teamKeys.size || teamKeys.has(key)))
  );
  const pitTeams = new Set((pitEntries || []).map((entry) => entry?.team_key).filter(Boolean));
  const total = teamKeys.size;
  return {
    teamsTotal: total,
    teamsScouted: scoutedTeams.size,
    matchReports: (matchEntries || []).length,
    pitProfiles: pitTeams.size,
    openProblems: (problems || []).filter((problem) => !problem?.resolved).length,
    percentScouted: total ? Math.round((scoutedTeams.size / total) * 100) : null
  };
}

/** "12 min", "1 h 5 min", "now" - the time until a match, or null when unknown. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return null;
  if (ms <= 60 * 1000) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
