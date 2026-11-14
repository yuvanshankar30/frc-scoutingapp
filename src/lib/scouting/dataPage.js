// Data Viewer > Rankings' rows: every team ranked on one metric, and who is improving. Pure, so the page only
// loads data and draws. Team numbers are the labels; names stay in Team View, one tap away.
import { MATCH_METRICS, teamKeyOf, teamMetricStats, teamTrend } from '$lib/scouting/teamCharts.js';

/** Teams with fewer scouted matches than this are drawn faded: one or two matches are not a ranking. */
export const MIN_MATCHES = 3;
/** Matches at each end of the trend (early = first k, late = last k), so a trend needs 2k matches. */
export const TREND_MATCHES = 3;
const MAX_IMPROVERS = 3;

const numberOf = (teamKey) => String(teamKey || '').replace(/^frc/i, '');
const byNumber = (a, b) => a.localeCompare(b, undefined, { numeric: true });
/** Fouls: fewer is better, so the chart ranks lowest first and a falling value counts as improving. */
const lowerIsBetterFor = (metric) => isMetric(metric) && Boolean(MATCH_METRICS[metric].lowerIsBetter);

/** A real metric name: own keys only, so `toString` or `__proto__` from a URL is never mistaken for one. */
export function isMetric(name) {
  return typeof name === 'string' && Object.hasOwn(MATCH_METRICS, name);
}

/** Team View for one team; `from` is the exact Rankings view (path + query) its "Back to Rankings" link returns to. */
export function teamHref(teamKey, eventKey, from = '/dataviewer/rankings') {
  const params = new URLSearchParams({ event_key: eventKey || '', team: teamKey, from, fromLabel: 'Rankings' });
  return `/teamview?${params}`;
}

function eventTeamKeys(teams) {
  return (teams || []).map((team) => teamKeyOf(team?.key || team?.team_number)).filter(Boolean);
}

/**
 * { rows: [{ label, teamKey, href, value, n, faded }], notScouted, noData, lowerIsBetter } for one metric.
 * notScouted: event teams with no reports at all. noData: teams with reports, but none that answer this metric
 * (for example a ratings metric nobody filled in), so they are not mistaken for teams nobody watched.
 */
export function topScorerRows({ entries, metric, teams, eventKey, from }) {
  const stats = teamMetricStats(entries, metric);
  const rows = [...stats].map(([teamKey, { mean, n }]) => ({
    key: teamKey,
    label: numberOf(teamKey),
    teamKey,
    href: teamHref(teamKey, eventKey, from),
    value: mean,
    n,
    faded: n < MIN_MATCHES
  }));
  const reported = new Set((entries || []).map((row) => teamKeyOf(row?.team_key)).filter(Boolean));
  const notScouted = eventTeamKeys(teams)
    .filter((key) => !reported.has(key))
    .map(numberOf)
    .sort(byNumber);
  const noData = [...reported]
    .filter((key) => !stats.has(key))
    .map(numberOf)
    .sort(byNumber);
  return { rows, notScouted, noData, lowerIsBetter: lowerIsBetterFor(metric) };
}

/**
 * { rows: [{ label, teamKey, href, value: late - early, n }], notEnough: [team numbers], improvers: [team keys] }.
 * Improvers are the teams that got better the most (delta > 0, or < 0 for fewer-is-better metrics), at most three.
 */
export function trendRows({ entries, metric, eventKey, from }) {
  const rows = [];
  const notEnough = [];
  for (const [teamKey, trend] of teamTrend(entries, metric, TREND_MATCHES)) {
    if (!trend) {
      notEnough.push(numberOf(teamKey));
      continue;
    }
    rows.push({
      key: teamKey,
      label: numberOf(teamKey),
      teamKey,
      href: teamHref(teamKey, eventKey, from),
      value: trend.delta,
      n: trend.n
    });
  }
  const lowerIsBetter = lowerIsBetterFor(metric);
  const gain = (row) => (lowerIsBetter ? -row.value : row.value);
  const improvers = rows
    .filter((row) => gain(row) > 0)
    .sort((a, b) => gain(b) - gain(a))
    .slice(0, MAX_IMPROVERS)
    .map((row) => row.teamKey);
  return { rows, notEnough: notEnough.sort(byNumber), improvers, lowerIsBetter };
}

export const DEFAULT_METRIC = 'ballsScored';

/**
 * Which trend lines to draw: improvers first, then teams the person picked, no repeats, at most `max`.
 * chips: every picked team that isn't an improver, so each can be removed; `drawn: false` marks one pushed past the
 * cap or with no value for the current metric (`available`: teams that have one), which the page labels instead of hiding.
 */
export function trendLines({ improvers = [], picked = [], max, available = null }) {
  // A picked team with no value for the current metric would draw an empty line, so it doesn't get a slot.
  const usable = available ? picked.filter((key) => available.includes(key)) : picked;
  const drawn = [...new Set([...improvers, ...usable])].slice(0, max);
  const chips = picked.filter((key) => !improvers.includes(key)).map((key) => ({ key, drawn: drawn.includes(key) }));
  return { drawn, chips, canAdd: drawn.length < max };
}

/** One team's reports, matching keys however they are spelled. */
export function teamRows(entries, teamKey) {
  const wanted = teamKeyOf(teamKey);
  return (entries || []).filter((row) => teamKeyOf(row?.team_key) === wanted);
}

/** Ratings (/5) are drawn on a fixed 0-5 scale, as in Team View; other metrics scale to their data. */
export function chartMax(metric) {
  return isMetric(metric) && MATCH_METRICS[metric].unit === '/5' ? 5 : null;
}

/** The unit as LineChart's readout should append it: a space before words ("12.5 balls"), none before "/5". */
export function readoutUnit(unit) {
  return unit && !unit.startsWith('/') ? ` ${unit}` : unit || '';
}
