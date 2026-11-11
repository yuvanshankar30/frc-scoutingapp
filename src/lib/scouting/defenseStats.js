// Defense, from both sides. A Data scout whose robot played defense names the robots it defended against,
// when, and rates the defense 1-10. That one answer says two things:
//   played:  how well this robot defends (the scouts' 1-10 rating, and how much the robots it defended scored less)
//   faced:   how well a defended robot resists defense (10 minus the rating against it, and how much of its usual
//            scoring it kept in matches where it was defended)
// The scoring numbers are what make ineffective defense measurable: a defender rated 3/10 whose targets still
// scored 95% of their usual balls shows up as a 5% impact, not just a low rating.
//
// Balls scored come from Data reports (balls_scored_average), averaged per robot per match first so a robot two
// scouts watched counts once. A robot with no undefended matches has no baseline, so its impact/kept share is null.
import { round } from '$lib/stats.js';
import { isDataReport } from '$lib/scouting/reportKinds.js';

const finite = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
const mean = (values) => {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
};

/**
 * @returns {Array<{ team_key: string, played: number, playedRating: number|null, impact: number|null,
 *   faced: number, facedRating: number|null, resistance: number|null, keptShare: number|null,
 *   ballsDefended: number|null, ballsUndefended: number|null }>} one row per robot that defended or was defended
 */
export function defenseSummary(entries) {
  const data = (entries || []).filter((entry) => isDataReport(entry) && entry.robot_present !== false);
  // Balls per robot per match, averaged across scouts.
  const ballsByMatch = new Map();
  for (const entry of data) {
    const balls = finite(entry.balls_scored_average);
    if (!entry.match_key || !entry.team_key || !Number.isFinite(balls)) continue;
    const key = `${entry.match_key}|${entry.team_key}`;
    ballsByMatch.set(key, [...(ballsByMatch.get(key) || []), balls]);
  }
  const balls = (matchKey, teamKey) => mean(ballsByMatch.get(`${matchKey}|${teamKey}`) || []);

  // Who defended whom in each match: Map<"match|target", Array<{ defender, rating }>>.
  const defended = new Map();
  const played = new Map();
  for (const entry of data) {
    const defense = entry.defense;
    if (!defense || !Array.isArray(defense.targets) || !defense.targets.length) continue;
    const rating = finite(defense.effectiveness);
    const row = played.get(entry.team_key) || { matches: new Set(), ratings: [], pairs: [] };
    row.matches.add(entry.match_key);
    if (Number.isFinite(rating)) row.ratings.push(rating);
    for (const target of defense.targets) {
      row.pairs.push({ match_key: entry.match_key, target });
      const key = `${entry.match_key}|${target}`;
      defended.set(key, [...(defended.get(key) || []), { defender: entry.team_key, rating }]);
    }
    played.set(entry.team_key, row);
  }

  // Each robot's scoring in matches where nobody defended it is its baseline.
  const baseline = new Map();
  const defendedBalls = new Map();
  for (const key of ballsByMatch.keys()) {
    const [matchKey, teamKey] = key.split('|');
    const target = defended.has(key) ? defendedBalls : baseline;
    target.set(teamKey, [...(target.get(teamKey) || []), balls(matchKey, teamKey)]);
  }
  const baselineOf = (teamKey) => mean(baseline.get(teamKey) || []);

  const faced = new Map();
  for (const [key, defenders] of defended) {
    const teamKey = key.split('|')[1];
    const row = faced.get(teamKey) || { matches: new Set(), ratings: [] };
    row.matches.add(key.split('|')[0]);
    for (const { rating } of defenders) if (Number.isFinite(rating)) row.ratings.push(rating);
    faced.set(teamKey, row);
  }

  const teams = new Set([...played.keys(), ...faced.keys()]);
  return [...teams]
    .map((team_key) => {
      const give = played.get(team_key);
      const take = faced.get(team_key);
      // Impact: how much less the defended robots scored than their own baseline, averaged over every pairing.
      const drops = (give?.pairs || []).map(({ match_key, target }) => {
        const usual = baselineOf(target);
        const scored = balls(match_key, target);
        return Number.isFinite(usual) && usual > 0 && Number.isFinite(scored) ? 1 - scored / usual : null;
      });
      const ballsUndefended = baselineOf(team_key);
      const ballsDefended = mean(defendedBalls.get(team_key) || []);
      const facedRating = mean(take?.ratings || []);
      const impact = mean(drops);
      return {
        team_key,
        played: give?.matches.size || 0,
        playedRating: give ? round(mean(give.ratings)) : null,
        impact: impact === null ? null : round(impact * 100),
        faced: take?.matches.size || 0,
        facedRating: facedRating === null ? null : round(facedRating),
        resistance: facedRating === null ? null : round(10 - facedRating),
        keptShare:
          Number.isFinite(ballsDefended) && Number.isFinite(ballsUndefended) && ballsUndefended > 0
            ? round((ballsDefended / ballsUndefended) * 100)
            : null,
        ballsDefended: ballsDefended === null ? null : round(ballsDefended),
        ballsUndefended: ballsUndefended === null ? null : round(ballsUndefended)
      };
    })
    .sort(
      (left, right) =>
        (right.playedRating ?? -1) - (left.playedRating ?? -1) ||
        (right.resistance ?? -1) - (left.resistance ?? -1) ||
        left.team_key.localeCompare(right.team_key)
    );
}
