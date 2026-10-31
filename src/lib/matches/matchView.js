// What the Match View page shows: one match, both alliances, and the scouting behind each robot.
import { summarizeMatchScoutEntries } from '../scouting/scoutingStats.js';
import { compareTbaMatches } from './matchKeys.js';

const LEVEL_NAMES = {
  qm: 'Qualification',
  ef: 'Eighth-final',
  qf: 'Quarterfinal',
  sf: 'Semifinal',
  f: 'Final',
  pm: 'Practice'
};
const LEVEL_SHORT = { qm: 'QM', ef: 'EF', qf: 'QF', sf: 'SF', f: 'F', pm: 'PM' };

export const teamNumber = (key) => String(key || '').replace(/^frc/i, '');

// "QM12", "SF2-1", "F1-2": the short label seen on the field schedule.
export function shortLabel(match) {
  const level = String(match?.comp_level || 'qm').toLowerCase();
  const prefix = LEVEL_SHORT[level] || level.toUpperCase();
  return level === 'qm' || level === 'pm'
    ? `${prefix}${match.match_number}`
    : `${prefix}${match.set_number}-${match.match_number}`;
}

export function longLabel(match) {
  const level = String(match?.comp_level || 'qm').toLowerCase();
  const name = LEVEL_NAMES[level] || level.toUpperCase();
  return level === 'qm' || level === 'pm'
    ? `${name} ${match.match_number}`
    : `${name} ${match.set_number} · Match ${match.match_number}`;
}

// TBA reports -1 as the score of a match that has not been played.
export const isPlayed = (match) =>
  Number(match?.alliances?.red?.score) >= 0 && Number(match?.alliances?.blue?.score) >= 0;

export const sortMatches = (matches) => [...matches].sort(compareTbaMatches);

export const startTime = (match) => {
  const seconds = match?.actual_time || match?.predicted_time || match?.time;
  return seconds ? new Date(seconds * 1000) : null;
};

export const reportsFor = (entries, matchKey, teamKey) =>
  (entries || [])
    .filter((entry) => entry.match_key === matchKey && entry.team_key === teamKey)
    .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));

// Every team's season summary from all the reports we hold.
export function briefsByTeam(entries) {
  const byTeam = new Map();
  for (const entry of entries || []) {
    if (!entry.team_key) continue;
    if (!byTeam.has(entry.team_key)) byTeam.set(entry.team_key, []);
    byTeam.get(entry.team_key).push(entry);
  }
  return new Map([...byTeam].map(([teamKey, list]) => [teamKey, summarizeMatchScoutEntries(list)]));
}

// What an alliance should score, from each robot's season average. Robots we know nothing
// about add nothing, and `known` says how many were counted so the total is not oversold.
export function allianceOutlook(teamKeys, briefs) {
  let balls = 0;
  let auto = 0;
  let known = 0;
  for (const key of teamKeys || []) {
    const brief = briefs.get(key);
    if (!brief || brief.avgBallsScored === null || brief.avgBallsScored === undefined) continue;
    known += 1;
    balls += brief.avgBallsScored;
    auto += brief.avgAutoPoints || 0;
  }
  return { balls: Math.round(balls), auto: Math.round(auto), known, size: (teamKeys || []).length };
}

// How many of a match's six robots have at least one report for it.
export const coverage = (match, entries) => {
  const keys = [...(match.alliances?.red?.team_keys || []), ...(match.alliances?.blue?.team_keys || [])];
  const reported = new Set(
    (entries || []).filter((entry) => entry.match_key === match.key).map((entry) => entry.team_key)
  );
  return { reported: keys.filter((key) => reported.has(key)).length, total: keys.length };
};

// ---- Blue Alliance data for one match ----

export const tbaMatchUrl = (matchKey) => `https://www.thebluealliance.com/match/${encodeURIComponent(matchKey)}`;

export const youtubeLinks = (match) =>
  (match?.videos || [])
    .filter((video) => video?.type === 'youtube' && video.key)
    .map((video) => `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`);

export const rankingPoints = (match, side) => {
  const rp = match?.score_breakdown?.[side]?.rp;
  return Number.isFinite(Number(rp)) && rp !== null && rp !== undefined ? Number(rp) : null;
};

export function winnerOf(match) {
  if (!isPlayed(match)) return null;
  const winner = match.winning_alliance;
  if (winner === 'red' || winner === 'blue') return winner;
  const red = Number(match.alliances.red.score);
  const blue = Number(match.alliances.blue.score);
  return red === blue ? 'tie' : red > blue ? 'red' : 'blue';
}

// "autoPoints" -> "Auto Points", "teleopFuelCount" -> "Teleop Fuel Count"
export const humanizeKey = (key) =>
  String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bRp\b/g, 'RP');

// The parts of the official score worth reading at a glance: points by phase, and which bonus
// objectives each alliance earned. Games name their fields differently, so each part is found
// by pattern; a part the game does not have simply does not appear.
const PARTS = [
  { label: 'Auto', pattern: /^(total)?auto(nomous)?points$/i },
  { label: 'Teleop', pattern: /^(total)?teleop(points|score)$/i },
  { label: 'Endgame', pattern: /^(total)?(tower|endgame|endgame_?tower|stage|barge|hang)points$|^endgamepoints$/i },
  { label: 'Fouls', pattern: /^foulpoints$/i }
];

export function keyFigures(match) {
  const red = match?.score_breakdown?.red;
  const blue = match?.score_breakdown?.blue;
  if (!red || !blue) return { rows: [], bonuses: { red: [], blue: [] } };
  const keys = [...new Set([...Object.keys(red), ...Object.keys(blue)])];
  const rows = [];
  for (const part of PARTS) {
    const key = keys.find(
      (candidate) =>
        part.pattern.test(candidate) &&
        Number.isFinite(Number(red[candidate])) &&
        Number.isFinite(Number(blue[candidate]))
    );
    if (key) rows.push({ label: part.label, red: Number(red[key]), blue: Number(blue[key]) });
  }
  const earned = (side) =>
    keys
      .filter((key) => /achieved$/i.test(key) && side[key] === true)
      .map((key) => humanizeKey(key).replace(/ Achieved$/, ''));
  return { rows, bonuses: { red: earned(red), blue: earned(blue) } };
}

// ---- Extra scouting detail for one robot ----

export const notesFor = (notes, matchKey, teamKey) =>
  (notes || []).filter(
    (note) => note.match_key === matchKey && note.team_key === teamKey && String(note.notes || '').trim()
  );

export function eventCountsFor(events, matchKey, teamKey) {
  const counts = new Map();
  for (const event of events || []) {
    if (event.match_key !== matchKey || event.team_key !== teamKey) continue;
    counts.set(event.event_type, (counts.get(event.event_type) || 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export const openProblemsFor = (problems, teamKey) =>
  (problems || []).filter((problem) => problem.team_key === teamKey && !problem.resolved);

// Balls reported per qualification match, oldest first, averaging scouts who covered the same one.
export function ballSeries(entries, teamKey) {
  const byMatch = new Map();
  for (const entry of entries || []) {
    if (entry.team_key !== teamKey) continue;
    const number = Number(String(entry.match_key).split('_').at(-1).replace(/^qm/i, ''));
    const balls = Number(entry.balls_scored_average);
    if (!Number.isFinite(number) || !Number.isFinite(balls)) continue;
    if (!byMatch.has(number)) byMatch.set(number, []);
    byMatch.get(number).push(balls);
  }
  return [...byMatch]
    .map(([number, values]) => ({ number, balls: values.reduce((sum, value) => sum + value, 0) / values.length }))
    .sort((a, b) => a.number - b.number);
}

// TBA rankings and OPR keyed by team key, from the /api/tba/event-oprs rows.
export const officialByTeam = (rows) =>
  new Map(
    (rows || []).map((row) => [
      `frc${row.team}`,
      {
        rank: row.rank ?? null,
        opr: row.epa ?? null,
        record: row.wins || row.losses || row.ties ? `${row.wins}-${row.losses}-${row.ties}` : null
      }
    ])
  );
