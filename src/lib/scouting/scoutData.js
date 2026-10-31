// Turns the pile of match scouting reports into things a strategy lead can act on:
// a row per team, a row per scout, a list of reports that need a second look, and
// pairs of reports about the same robot in the same match that disagree.
import { mean } from '$lib/stats.js';

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';

export const teamNumber = (key) => String(key || '').replace(/^frc/i, '') || '-';

// "2026cc_qm64" and the free-typed "Quals 64" both mean match 64.
export function matchNumber(report) {
  const label =
    String(report?.match_key || '')
      .split('_')
      .at(-1) || '';
  const found = label.match(/(\d+)\s*$/);
  return found ? Number(found[1]) : null;
}

export const reportTime = (report) => report?.updated_at || report?.created_at || null;
const timeValue = (report) => {
  const stamp = Date.parse(reportTime(report) || '');
  return Number.isNaN(stamp) ? 0 : stamp;
};

export const scoutOf = (report) => report?.scout_name || report?.created_by || 'Unknown scout';
export const autoPoints = (report) => num(report?.auto_points_average);
export const ballsScored = (report) => num(report?.balls_scored_average);

function rating(report, field) {
  if (report?.ratings_unknown?.includes(field)) return null;
  return num(report?.ratings?.[field]);
}

const DEAD_STATUSES = new Set(['dead', 'stopped', 'brownout']);

// What went wrong in a match, in the words a scout would use.
export function reportFlags(report) {
  const flags = [];
  if (report?.auto_collision) flags.push('Auto collision');
  if (report?.significant_crash || report?.crash_or_break) flags.push('Crash');
  if (report?.mechanical_break) flags.push('Broke');
  if (DEAD_STATUSES.has(String(report?.teleop_robot_status || '').toLowerCase())) flags.push('Went dead');
  else if (/^(yes|true|disabled)/i.test(String(report?.robot_disabled ?? ''))) flags.push('Disabled');
  if (present(report?.card) && !/^(none|no)$/i.test(String(report.card))) flags.push(`${report.card} card`);
  return flags;
}

export const hasNotes = (report) =>
  [report?.auto_collision_notes, report?.teleop_notes, report?.crash_details, report?.post_notes].some(present);

// Two scouts watching the same robot in the same match should land close to each
// other. When they do not, one of them is probably wrong and someone should look.
export function findDisputes(reports) {
  const groups = new Map();
  for (const report of reports) {
    const balls = ballsScored(report);
    if (balls === null || !report.match_key || !report.team_key) continue;
    const key = `${report.match_key}|${report.team_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  }
  const disputes = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const values = group.map(ballsScored);
    const high = Math.max(...values);
    const low = Math.min(...values);
    if (high - low < Math.max(40, high * 0.5)) continue;
    for (const report of group) {
      const others = group.filter((other) => other.id !== report.id).map(ballsScored);
      disputes.set(
        report.id,
        `Another scout logged ${others.map((value) => Math.round(value)).join(' and ')}, this one ${Math.round(ballsScored(report))}`
      );
    }
  }
  return disputes;
}

export function aggregateTeams(reports, disputes = new Map()) {
  const byTeam = new Map();
  for (const report of reports) {
    if (!report.team_key) continue;
    if (!byTeam.has(report.team_key)) byTeam.set(report.team_key, []);
    byTeam.get(report.team_key).push(report);
  }
  return [...byTeam.entries()].map(([teamKey, list]) => {
    const ordered = [...list].sort(
      (a, b) => (matchNumber(a) ?? 0) - (matchNumber(b) ?? 0) || timeValue(a) - timeValue(b)
    );
    const balls = ordered.map(ballsScored);
    const flagged = ordered.filter((report) => reportFlags(report).length);
    return {
      teamKey,
      number: Number(teamNumber(teamKey)) || 0,
      count: list.length,
      scouts: new Set(list.map(scoutOf)).size,
      auto: mean(ordered.map(autoPoints)),
      balls: mean(balls),
      ballsLow: Math.min(...balls.filter((value) => value !== null)),
      ballsHigh: Math.max(...balls.filter((value) => value !== null)),
      accuracy: mean(ordered.map((report) => rating(report, 'Shot accuracy'))),
      bps: mean(ordered.map((report) => rating(report, 'BPS'))),
      series: ordered.map((report) => ({ match: matchNumber(report), balls: ballsScored(report) })),
      flagged: flagged.length,
      disputed: list.filter((report) => disputes.has(report.id)).length,
      last: Math.max(...list.map(timeValue)),
      reports: [...list].sort((a, b) => (matchNumber(b) ?? 0) - (matchNumber(a) ?? 0) || timeValue(b) - timeValue(a))
    };
  });
}

export function scoutStats(reports, disputes = new Map()) {
  const byScout = new Map();
  for (const report of reports) {
    const name = scoutOf(report);
    if (!byScout.has(name)) byScout.set(name, []);
    byScout.get(name).push(report);
  }
  return [...byScout.entries()].map(([name, list]) => ({
    name,
    count: list.length,
    teams: new Set(list.map((report) => report.team_key)).size,
    noted: list.filter(hasNotes).length,
    disputed: list.filter((report) => disputes.has(report.id)).length,
    last: Math.max(...list.map(timeValue)),
    reports: [...list].sort((a, b) => timeValue(b) - timeValue(a))
  }));
}

export function groupByMatch(reports) {
  const byMatch = new Map();
  for (const report of reports) {
    const number = matchNumber(report);
    const key = number === null ? 'other' : String(number);
    if (!byMatch.has(key)) byMatch.set(key, { number, reports: [] });
    byMatch.get(key).reports.push(report);
  }
  return [...byMatch.values()]
    .map((group) => ({
      ...group,
      reports: group.reports.sort(
        (a, b) => Number(teamNumber(a.team_key)) - Number(teamNumber(b.team_key)) || timeValue(a) - timeValue(b)
      )
    }))
    .sort((a, b) => (b.number ?? -1) - (a.number ?? -1));
}

// One search box for everything: team number, match number or scout name.
// Every word has to match something on the report.
export function matchesQuery(report, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  const team = teamNumber(report.team_key);
  const match = matchNumber(report);
  const scout = scoutOf(report).toLowerCase();
  return words.every(
    (word) =>
      team.startsWith(word) ||
      (match !== null && String(match) === word.replace(/^(quals|qual|qm|q)/, '')) ||
      scout.includes(word)
  );
}

export const TEAM_SORTS = Object.freeze({
  number: { label: 'Team number', get: (row) => row.number, dir: 1 },
  balls: { label: 'Balls scored', get: (row) => row.balls ?? -1, dir: -1 },
  auto: { label: 'Auto points', get: (row) => row.auto ?? -1, dir: -1 },
  accuracy: { label: 'Shot accuracy', get: (row) => row.accuracy ?? -1, dir: -1 },
  bps: { label: 'Balls per second', get: (row) => row.bps ?? -1, dir: -1 },
  reports: { label: 'Reports', get: (row) => row.count, dir: -1 },
  incidents: { label: 'Incidents', get: (row) => row.flagged, dir: -1 },
  disputed: { label: 'Scouts disagree', get: (row) => row.disputed, dir: -1 },
  recent: { label: 'Latest report', get: (row) => row.last, dir: -1 }
});

export function sortTeams(rows, key, reverse = false) {
  const sort = TEAM_SORTS[key] || TEAM_SORTS.number;
  const sign = sort.dir * (reverse ? -1 : 1);
  return [...rows].sort((a, b) => sign * (sort.get(a) - sort.get(b)) || a.number - b.number);
}
