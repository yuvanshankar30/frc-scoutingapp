// The arithmetic behind the alliance_matchup tool: what each alliance is expected to score, how sure that is, and a
// rough chance of winning. Kept pure so it can be tested. It is an estimate from scouted ball counts and (when
// available) official OPR, not a prediction of the match: it ignores climbing, defence and how robots interact.
import { isNum, round } from '$lib/stats.js';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Abramowitz and Stegun 7.1.26
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** P(alliance A outscores B) when each total is roughly normal. */
export function winProbability(meanA, sdA, meanB, sdB) {
  const sd = Math.hypot(sdA, sdB);
  if (!(sd > 0)) return meanA === meanB ? 0.5 : meanA > meanB ? 1 : 0;
  return normalCdf((meanA - meanB) / sd);
}

/** How much a team's per-match score swings: its own spread when there are 3+ matches, else a cautious share of its average. */
export function spreadOf(series, mean) {
  const values = series.filter(isNum);
  const fallback = 0.35 * mean;
  let sd = fallback;
  if (values.length >= 3) {
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
  }
  return Math.max(sd, 0.1 * mean);
}

/** @param {Array<{ balls: number|null, ballSeries: number[], auto: number|null, incidentRate: number|null, opr: number|null }>} profiles */
export function allianceTotals(profiles) {
  const scored = profiles.filter((p) => isNum(p.balls));
  const mean = scored.reduce((s, p) => s + p.balls, 0);
  const variance = scored.reduce((s, p) => s + spreadOf(p.ballSeries || [], p.balls) ** 2, 0);
  const oprs = profiles.map((p) => p.opr).filter(isNum);
  return {
    teams: profiles.length,
    teamsWithData: scored.length,
    mean,
    sd: Math.sqrt(variance),
    auto: profiles.reduce((s, p) => s + (isNum(p.auto) ? p.auto : 0), 0),
    // Balls with each robot's breakdown rate taken off, because a robot that breaks is not scoring.
    riskAdjusted: scored.reduce((s, p) => s + p.balls * (1 - clamp(p.incidentRate || 0, 0, 0.6)), 0),
    opr: oprs.reduce((a, b) => a + b, 0),
    oprKnown: oprs.length
  };
}

/** Our win chance from scouting, scouting with breakdowns, and OPR, with how much to trust it. */
export function matchupOdds(ours, theirs) {
  const a = allianceTotals(ours);
  const b = allianceTotals(theirs);
  const usable = a.teamsWithData > 0 && b.teamsWithData > 0;
  const estimates = {};
  if (usable) {
    estimates.scouting = winProbability(a.mean, a.sd, b.mean, b.sd);
    estimates.scouting_with_breakdowns = winProbability(a.riskAdjusted, a.sd, b.riskAdjusted, b.sd);
  }
  if (a.oprKnown === ours.length && b.oprKnown === theirs.length && a.opr + b.opr > 0) {
    const sd = 0.22 * ((a.opr + b.opr) / 2);
    estimates.opr = winProbability(a.opr, sd, b.opr, sd);
  }
  const values = Object.values(estimates);
  const matches = [...ours, ...theirs].map((p) => p.matches ?? 0);
  const fewest = matches.length ? Math.min(...matches) : 0;
  const missing = a.teamsWithData < ours.length || b.teamsWithData < theirs.length;
  const confidence = !values.length ? 'none' : missing || fewest < 3 ? 'low' : fewest < 6 ? 'medium' : 'high';
  // A single match is never a sure thing, so a very lopsided estimate is shown as 97% (or 3%), not 100%.
  const pct = (v) => clamp(Math.round(v * 100), 3, 97);
  return {
    totals: {
      ours: {
        expected_balls: round(a.mean, 1),
        swing: round(a.sd, 1),
        with_breakdowns: round(a.riskAdjusted, 1),
        expected_auto_points: round(a.auto, 1),
        opr_sum: a.oprKnown ? round(a.opr, 1) : null
      },
      theirs: {
        expected_balls: round(b.mean, 1),
        swing: round(b.sd, 1),
        with_breakdowns: round(b.riskAdjusted, 1),
        expected_auto_points: round(b.auto, 1),
        opr_sum: b.oprKnown ? round(b.opr, 1) : null
      }
    },
    win_chance_percent: values.length
      ? {
          low: pct(Math.min(...values)),
          high: pct(Math.max(...values)),
          central: pct(values.reduce((x, y) => x + y, 0) / values.length),
          by_method: Object.fromEntries(Object.entries(estimates).map(([k, v]) => [k, pct(v)]))
        }
      : null,
    confidence,
    fewest_matches_scouted: fewest,
    caveats: [
      'Counts are scout estimates of balls scored, not official points.',
      'Chances are kept between 3% and 97% because no match is certain.',
      'Ignores climbing and end-game points, defence, and how the robots interact.',
      'Scouting samples are small, so treat the range as a rough guide, not a prediction.'
    ]
  };
}

/** Plain, data-based role suggestions for our alliance; the model explains and adapts them. */
export function roleHints(ours) {
  const list = ours.filter((p) => isNum(p.balls)).sort((x, y) => y.balls - x.balls);
  const hints = [];
  list.forEach((p, i) => {
    if (i === 0)
      hints.push({
        team: p.team,
        role: 'main scorer',
        why: `highest scouted scoring on the alliance (${round(p.balls, 1)} balls per match)`
      });
    else if ((p.shuttlingRate ?? 0) >= 0.4)
      hints.push({
        team: p.team,
        role: 'shuttler',
        why: `scouts saw it shuttling in ${Math.round(p.shuttlingRate * 100)}% of its matches`
      });
    else if (isNum(p.defense) && p.defense >= 3.5)
      hints.push({ team: p.team, role: 'defender', why: `defense rated ${round(p.defense, 1)} out of 5` });
    else hints.push({ team: p.team, role: 'second scorer', why: `scores ${round(p.balls, 1)} balls per match` });
  });
  for (const p of ours.filter((p) => !isNum(p.balls)))
    hints.push({ team: p.team, role: 'unknown', why: 'no scouting data for this team' });
  return hints;
}

/** Which opposing robots to plan around. */
export function watchList(theirs) {
  const list = theirs.filter((p) => isNum(p.balls));
  const best = (pick, label, dir = 1) => {
    const rows = list.filter((p) => isNum(pick(p)));
    if (!rows.length) return null;
    const top = rows.sort((x, y) => dir * (pick(y) - pick(x)))[0];
    return { team: top.team, why: label };
  };
  return [
    best((p) => p.balls, 'biggest scorer'),
    best((p) => p.auto, 'strongest auto'),
    best((p) => p.incidentRate, 'breaks down most often')
  ].filter(Boolean);
}
