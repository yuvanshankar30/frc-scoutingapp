import { describe, expect, it } from 'vitest';
import {
  computeEventEpa,
  winProbability,
  calibratedScale,
  evaluateEpaModel,
  fitEpaParameters,
  scoutedRobotMatches,
  scoutingEstimates,
  scoutRankEvents,
  predictAllianceScore
} from './epaModel.js';

// A synthetic event where every team has a fixed true strength and each
// alliance's score is the sum of its three - so a model that has learned
// the strengths should predict nearly everything right, and one that has
// not should hover near a coin flip.
function syntheticEvent({ matchCount = 60, noise = 0 } = {}) {
  const strength = {};
  for (let team = 1; team <= 24; team += 1) strength[`frc${team}`] = 40 + (team % 12) * 8;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const scoreOf = (keys) => keys.reduce((sum, key) => sum + strength[key], 0);
  const matches = [];
  for (let number = 1; number <= matchCount; number += 1) {
    const pool = Object.keys(strength)
      .slice()
      .sort(() => rand() - 0.5);
    const red = pool.slice(0, 3);
    const blue = pool.slice(3, 6);
    const jitter = () => Math.round((rand() - 0.5) * noise);
    matches.push({
      comp_level: 'qm',
      match_number: number,
      alliances: {
        red: { team_keys: red, score: scoreOf(red) + jitter() },
        blue: { team_keys: blue, score: scoreOf(blue) + jitter() }
      }
    });
  }
  return matches;
}

function match({ red, blue, redScore, blueScore, matchNumber, compLevel = 'qm' }) {
  return {
    comp_level: compLevel,
    match_number: matchNumber,
    alliances: {
      red: { team_keys: red, score: redScore },
      blue: { team_keys: blue, score: blueScore }
    }
  };
}

describe('computeEventEpa', () => {
  it('returns an empty map for no matches', () => {
    expect(computeEventEpa([]).size).toBe(0);
  });

  it('ignores unplayed matches (missing or negative scores)', () => {
    const matches = [
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: -1,
        blueScore: -1,
        matchNumber: 1
      })
    ];
    const result = computeEventEpa(matches);
    expect(result.size).toBe(0);
  });

  it("moves a team's rating up after it outscores its baseline prediction", () => {
    const matches = [
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 300,
        blueScore: 90,
        matchNumber: 1
      })
    ];
    const result = computeEventEpa(matches);
    const red1 = result.get('frc1').epa;
    const blue4 = result.get('frc4').epa;
    // The baseline (event average / 3) is identical for every team before
    // any match is processed, so the side that blew the baseline prediction
    // away should end up rated higher than the side that fell far short of it.
    expect(red1).toBeGreaterThan(blue4);
  });

  it('tracks matches played, win/loss/tie record, and average score per team', () => {
    const matches = [
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 100,
        blueScore: 80,
        matchNumber: 1
      }),
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc7', 'frc8', 'frc9'],
        redScore: 60,
        blueScore: 60,
        matchNumber: 2
      }),
      match({
        red: ['frc4', 'frc5', 'frc6'],
        blue: ['frc1', 'frc2', 'frc3'],
        redScore: 120,
        blueScore: 90,
        matchNumber: 3
      })
    ];
    const result = computeEventEpa(matches);
    const frc1 = result.get('frc1');
    expect(frc1.matchesPlayed).toBe(3);
    expect(frc1.wins).toBe(1);
    expect(frc1.losses).toBe(1);
    expect(frc1.ties).toBe(1);
    expect(frc1.totalScore).toBe(100 + 60 + 90);
    expect(frc1.avgScore).toBeCloseTo((100 + 60 + 90) / 3, 6);
  });

  it('processes matches in time order, not array order, when actual_time is present', () => {
    const early = {
      ...match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 50,
        blueScore: 50,
        matchNumber: 2
      }),
      actual_time: 200
    };
    const later = {
      ...match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 300,
        blueScore: 10,
        matchNumber: 1
      }),
      actual_time: 100
    };
    // Array order is [early, later] but actual_time says later happened
    // first - a team's final rating should reflect that real ordering.
    const inOrder = computeEventEpa([later, early]);
    const outOfOrder = computeEventEpa([early, later]);
    expect(outOfOrder.get('frc1').epa).toBeCloseTo(inOrder.get('frc1').epa, 9);
  });

  describe('whole-event fit', () => {
    // A deterministic round-robin where every match's score is EXACTLY the
    // sum of each participating team's true rating - the system OPR solves
    // with linear algebra. The ridge fit should land close to it; the light
    // pull toward the average robot keeps it from matching exactly.
    const trueEpa = { frc1: 100, frc2: 90, frc3: 80, frc4: 70, frc5: 60, frc6: 50 };
    const scoreOf = (teamKeys) => teamKeys.reduce((sum, key) => sum + trueEpa[key], 0);
    const roundRobin = [
      { red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] },
      { red: ['frc1', 'frc4', 'frc5'], blue: ['frc2', 'frc3', 'frc6'] },
      { red: ['frc2', 'frc5', 'frc6'], blue: ['frc1', 'frc3', 'frc4'] },
      { red: ['frc3', 'frc4', 'frc6'], blue: ['frc1', 'frc2', 'frc5'] },
      { red: ['frc1', 'frc3', 'frc5'], blue: ['frc2', 'frc4', 'frc6'] },
      { red: ['frc1', 'frc2', 'frc6'], blue: ['frc3', 'frc4', 'frc5'] }
    ].map((sides, index) =>
      match({
        red: sides.red,
        blue: sides.blue,
        redScore: scoreOf(sides.red),
        blueScore: scoreOf(sides.blue),
        matchNumber: index + 1
      })
    );

    it("recovers each team's true contribution from alliance scores", () => {
      const result = computeEventEpa(roundRobin);
      for (const [team, value] of Object.entries(trueEpa)) expect(result.get(team).epa).toBeCloseTo(value, -1);
      const order = Object.keys(trueEpa).sort((a, b) => result.get(b).epa - result.get(a).epa);
      expect(order).toEqual(Object.keys(trueEpa));
    });

    it('marks teams without scouting as anchored to the event baseline', () => {
      const result = computeEventEpa(roundRobin);
      expect(result.get('frc1').priorSource).toBe('baseline');
      expect(result.get('frc1').prior).toBeCloseTo(75, 6);
      expect(result.scoutedTeams).toBe(0);
    });
  });

  it('attaches residualStd measuring how well ratings predicted actual scores', () => {
    // Every match ties the baseline exactly, so once ratings settle near
    // that baseline the prediction error should be small and stable.
    const matches = [
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 90,
        blueScore: 90,
        matchNumber: 1
      }),
      match({
        red: ['frc1', 'frc2', 'frc3'],
        blue: ['frc4', 'frc5', 'frc6'],
        redScore: 90,
        blueScore: 90,
        matchNumber: 2
      })
    ];
    const result = computeEventEpa(matches);
    expect(Number.isFinite(result.residualStd)).toBe(true);
    expect(result.residualStd).toBeGreaterThanOrEqual(0);
  });

  it('residualStd is 0 for an event with no played matches', () => {
    expect(computeEventEpa([]).residualStd).toBe(0);
  });
});

describe('winProbability', () => {
  it('is 0.5 when both sides have equal EPA', () => {
    expect(winProbability(50, 50)).toBeCloseTo(0.5, 9);
  });

  it('favors the higher-EPA side', () => {
    expect(winProbability(60, 50)).toBeGreaterThan(0.5);
    expect(winProbability(40, 50)).toBeLessThan(0.5);
  });

  it('is symmetric', () => {
    const a = winProbability(70, 50);
    const b = winProbability(50, 70);
    expect(a + b).toBeCloseTo(1, 9);
  });

  // Regression test for the reported bug: every real caller (the Predict
  // tab) passes ALLIANCE TOTALS - the sum of 3 robots' EPA each, not one
  // robot's own rating - and the old default scale (8, sized for a single
  // robot) pushed any normal alliance-level gap past the point where the
  // logistic curve is already effectively 0%/100%, so every match looked
  // like a lock regardless of how close the alliances actually were.
  it('does not saturate to 0%/100% for a normal alliance-level EPA gap', () => {
    // Three teams around 100 EPA each vs three teams around 110 each - a
    // real, meaningfully-favored-but-not-lopsided alliance gap.
    const redTotal = 100 + 95 + 105;
    const blueTotal = 110 + 108 + 112;
    const prob = winProbability(redTotal, blueTotal);
    expect(prob).toBeGreaterThan(0.05);
    expect(prob).toBeLessThan(0.5);
  });

  it('clamps away from the literal extremes even for a huge gap', () => {
    expect(winProbability(1000, 0)).toBeLessThanOrEqual(0.95);
    expect(winProbability(0, 1000)).toBeGreaterThanOrEqual(0.05);
  });

  // Regression test for a real reported case: a 246.6-point alliance-total
  // gap (697.9 vs 944.5, QM40 - 9032/4414/972 vs 3256/254/581) hit the OLD
  // 3% floor under every plausible calibrated scale for that event, which
  // read as the model being stuck/broken rather than a genuinely lopsided
  // matchup. The floor itself is now 5%, not a fix for "is this gap really
  // that large" (it isn't wrong here - an alliance anchored by a
  // historically dominant program can legitimately be this favored), but a
  // little more honest that some real uncertainty remains either way.
  it('never reports below the 5% floor even for the specific gap that prompted this widening', () => {
    const prob = winProbability(697.9, 944.5, 35);
    expect(prob).toBeGreaterThanOrEqual(0.05);
  });
});

describe('evaluateEpaModel', () => {
  it('beats a coin flip on an event where strength is actually learnable', () => {
    const result = evaluateEpaModel(syntheticEvent({ noise: 20 }), { scale: 50 });
    expect(result.samples).toBeGreaterThan(20);
    // A coin flip scores exactly 0.25; anything above that is worse than guessing.
    expect(result.brier).toBeLessThan(0.25);
    expect(result.accuracy).toBeGreaterThan(0.6);
  });

  it('scores no better than a coin flip when results are pure noise', () => {
    // Every score independent of who is playing - there is nothing to learn,
    // so an honest evaluation must NOT report a good score here.
    let seed = 3;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const matches = Array.from({ length: 60 }, (unused, index) => ({
      comp_level: 'qm',
      match_number: index + 1,
      alliances: {
        red: { team_keys: ['frc1', 'frc2', 'frc3'], score: Math.round(rand() * 200) },
        blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: Math.round(rand() * 200) }
      }
    }));
    expect(evaluateEpaModel(matches, { scale: 50 }).brier).toBeGreaterThan(0.2);
  });

  it('never lets a match inform its own prediction (no lookahead)', () => {
    // Truncating the event must not change the scores of the matches that
    // remain - if it did, later results were leaking into earlier ones.
    const matches = syntheticEvent({ matchCount: 40, noise: 20 });
    const full = evaluateEpaModel(matches, { scale: 50, warmupMatches: 8 });
    const truncated = evaluateEpaModel(matches.slice(0, 30), { scale: 50, warmupMatches: 8 });
    expect(truncated.samples).toBe(30 - 8);
    // The first 22 scored matches are shared, so the truncated run's total
    // squared error must be a strict prefix of the full run's.
    expect(truncated.brier * truncated.samples).toBeLessThanOrEqual(full.brier * full.samples + 1e-9);
  });

  it('reports a standard error so grid noise can be told from a real gain', () => {
    const result = evaluateEpaModel(syntheticEvent({ noise: 20 }), { scale: 50 });
    expect(result.brierStdErr).toBeGreaterThan(0);
    expect(result.brierStdErr).toBeLessThan(result.brier);
  });
});

describe('fitEpaParameters', () => {
  it('falls back, untuned, before an event has enough history', () => {
    const fit = fitEpaParameters(syntheticEvent({ matchCount: 10, noise: 20 }));
    expect(fit.tuned).toBe(false);
    expect(fit.scale).toBeGreaterThanOrEqual(12);
  });

  it('fits a scale that predicts at least as well as the fallback', () => {
    const matches = syntheticEvent({ noise: 40 });
    const fit = fitEpaParameters(matches);
    expect(fit.tuned).toBe(true);
    const fitted = evaluateEpaModel(matches, { scale: fit.scale });
    const fallback = evaluateEpaModel(matches, { scale: 35 });
    expect(fitted.brier).toBeLessThanOrEqual(fallback.brier);
  });

  it('stays statistically tied with the best scale instead of chasing the raw argmin', () => {
    const fit = fitEpaParameters(syntheticEvent({ noise: 40 }));
    expect(fit.brier).toBeLessThanOrEqual(fit.bestBrier + fit.brierStdErr + 1e-9);
    expect(fit.tiedCandidates).toBeGreaterThan(0);
  });
});

// Data reports whose balls scored track each team's true strength (with
// scout noise), the way 2026cacg's do (r = 0.94 against TBA hub points).
function scoutingFor(matches, { noise = 10, undercount = 0.8, teams = null } = {}) {
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const strength = {};
  for (let team = 1; team <= 24; team += 1) strength[`frc${team}`] = 40 + (team % 12) * 8;
  const entries = [];
  for (const played of matches) {
    const key = `2026tst_qm${played.match_number}`;
    for (const side of ['red', 'blue'])
      for (const team of played.alliances[side].team_keys) {
        if (teams && !teams.includes(team)) continue;
        entries.push({
          match_key: key,
          team_key: team,
          report_kind: 'data',
          balls_scored_average: Math.max(0, strength[team] * undercount + (rand() - 0.5) * noise)
        });
      }
  }
  return entries;
}
const keyed = (matches) => matches.map((played) => ({ ...played, key: `2026tst_qm${played.match_number}` }));

describe('scoutedRobotMatches', () => {
  it('averages scouts per robot per match and treats missing as not scouted, never 0', () => {
    const byTeam = scoutedRobotMatches([
      { match_key: 'm1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 40, auto_points_average: 10 },
      { match_key: 'm1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 60 },
      { match_key: 'm1', team_key: 'frc1', report_kind: 'performance', ratings: { BPS: 5 } },
      { match_key: 'm1', team_key: 'frc2', report_kind: 'performance', ratings: { BPS: 2 } }
    ]);
    expect(byTeam.get('frc1')).toEqual([
      {
        matchKey: 'm1',
        balls: 50,
        auto: 10,
        points: 60,
        performance: null,
        incident: null,
        defended: false,
        defenseRating: null
      }
    ]);
    expect(byTeam.has('frc2')).toBe(false);
  });

  it('flags an incident from any Robot report for that robot and match', () => {
    const byTeam = scoutedRobotMatches([
      { match_key: 'm1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 30 },
      {
        match_key: 'm1',
        team_key: 'frc1',
        report_kind: 'robot',
        teleop_robot_status: 'active',
        mechanical_break: true
      },
      { match_key: 'm2', team_key: 'frc1', report_kind: 'robot', teleop_robot_status: 'active' }
    ]);
    expect(byTeam.get('frc1').map((row) => row.incident)).toEqual([true, false]);
  });
});

describe('Performance reports in the scouting estimate', () => {
  // 12 robot-matches with both reports, where points rise with accuracy x BPS (points = 5 x rating).
  const both = Array.from({ length: 12 }, (unused, index) => {
    const rating = 4 + index;
    return [
      { match_key: `b${index}`, team_key: `frc${100 + index}`, report_kind: 'data', balls_scored_average: rating * 5 },
      {
        match_key: `b${index}`,
        team_key: `frc${100 + index}`,
        report_kind: 'performance',
        ratings: { 'Shot accuracy': 1, BPS: rating }
      }
    ];
  }).flat();

  it('reads points off accuracy x BPS for a robot-match only a Performance scout covered', () => {
    const entries = [
      ...both,
      { match_key: 'p1', team_key: 'frc1', report_kind: 'performance', ratings: { 'Shot accuracy': 4, BPS: 5 } }
    ];
    const estimate = scoutingEstimates(scoutedRobotMatches(entries)).get('frc1');
    expect(estimate.matches).toBe(1);
    expect(estimate.performance).toBe(20);
    expect(estimate.points).toBeGreaterThan(50);
  });

  it('rates a team its Performance scouts rate highly above one with the same Data points', () => {
    const entries = [
      ...both,
      { match_key: 'x1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 40 },
      { match_key: 'x1', team_key: 'frc1', report_kind: 'performance', ratings: { 'Shot accuracy': 5, BPS: 5 } },
      { match_key: 'x1', team_key: 'frc2', report_kind: 'data', balls_scored_average: 40 },
      { match_key: 'x1', team_key: 'frc2', report_kind: 'performance', ratings: { 'Shot accuracy': 1, BPS: 2 } }
    ];
    const estimates = scoutingEstimates(scoutedRobotMatches(entries));
    expect(estimates.get('frc1').points).toBeGreaterThan(estimates.get('frc2').points);
  });
});

describe('scoutingEstimates', () => {
  it('shrinks a one-match team toward the event average and discounts a robot that keeps breaking', () => {
    const observations = new Map([
      ['frc1', [{ matchKey: 'm1', points: 100, auto: null, incident: null }]],
      [
        'frc2',
        [
          { matchKey: 'm1', points: 20, auto: null, incident: true },
          { matchKey: 'm2', points: 20, auto: null, incident: true }
        ]
      ],
      ['frc3', [{ matchKey: 'm2', points: 20, auto: null, incident: false }]]
    ]);
    const estimates = scoutingEstimates(observations);
    const eventAverage = (100 + 20 + 20 + 20) / 4;
    expect(estimates.get('frc1').points).toBeCloseTo((100 + eventAverage) / 2, 6);
    expect(estimates.get('frc2').incidentRate).toBeGreaterThan(estimates.get('frc3').incidentRate);
    expect(estimates.get('frc2').points).toBeLessThan((40 + eventAverage) / 3);
  });

  it('only uses scouting from the matches it is given', () => {
    const observations = new Map([['frc1', [{ matchKey: 'm9', points: 50, auto: null, incident: null }]]]);
    expect(scoutingEstimates(observations, new Set(['m1'])).has('frc1')).toBe(false);
  });
});

describe('computeEventEpa with scouting', () => {
  it('anchors a team that has barely played to its scouting', () => {
    const matches = keyed(syntheticEvent({ matchCount: 40, noise: 30 }));
    const scoutEntries = scoutingFor(matches);
    const withScouting = computeEventEpa(matches, { scoutEntries });
    expect(withScouting.scoutedTeams).toBeGreaterThan(0);
    const row = withScouting.get('frc11');
    expect(row.priorSource).toBe('scouting');
    expect(row.scoutedMatches).toBeGreaterThan(0);
    expect(withScouting.calibration.fitted).toBe(true);
  });

  it('predicts held-out matches better than scores alone when scouting tracks real strength', () => {
    const matches = keyed(syntheticEvent({ matchCount: 40, noise: 60 }));
    const scoutEntries = scoutingFor(matches);
    const withScouting = evaluateEpaModel(matches, { scoutEntries, scale: 50 });
    const scoresOnly = evaluateEpaModel(matches, { scale: 50 });
    expect(withScouting.scoreMae).toBeLessThan(scoresOnly.scoreMae);
    // At a fixed scale, Brier on 40 synthetic matches moves by noise; score error is the real check.
    expect(withScouting.brier).toBeLessThanOrEqual(scoresOnly.brier + 0.005);
  });

  it('can be told to ignore scouting', () => {
    const matches = keyed(syntheticEvent({ matchCount: 20, noise: 30 }));
    const off = computeEventEpa(matches, { scoutEntries: scoutingFor(matches), useScouting: false });
    expect(off.scoutedTeams).toBe(0);
  });

  it('splits ratings into auto, teleop and endgame from the TBA score breakdown', () => {
    const matches = keyed(syntheticEvent({ matchCount: 30 })).map((played) => ({
      ...played,
      score_breakdown: Object.fromEntries(
        ['red', 'blue'].map((side) => {
          const score = played.alliances[side].score;
          return [
            side,
            { totalAutoPoints: score * 0.2, totalTeleopPoints: score * 0.7, endGameTowerPoints: score * 0.1 }
          ];
        })
      )
    }));
    const row = computeEventEpa(matches).get('frc11');
    expect(row.components.auto + row.components.teleop + row.components.endgame).toBeCloseTo(row.epa, -1);
    expect(row.components.teleop).toBeGreaterThan(row.components.auto);
  });
});

describe('calibratedScale', () => {
  it('falls back to the default scale when there is no measured variance yet', () => {
    expect(calibratedScale(0)).toBe(35);
    expect(calibratedScale(undefined)).toBe(35);
    expect(calibratedScale(NaN)).toBe(35);
  });

  it('widens for a noisier (higher residualStd) event and tightens for a calmer one', () => {
    const noisy = calibratedScale(40);
    const calm = calibratedScale(5);
    expect(noisy).toBeGreaterThan(calm);
  });

  it('never drops below the floor even for a near-zero but nonzero residualStd', () => {
    expect(calibratedScale(0.01)).toBeGreaterThanOrEqual(12);
  });
});

describe('robot no-shows', () => {
  it('counts a robot that did not show up as 0 points and an incident, whatever else was filed', () => {
    const byTeam = scoutedRobotMatches([
      { match_key: 'm1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 80, robot_present: false },
      { match_key: 'm2', team_key: 'frc1', report_kind: 'robot', post_notes: 'Robot did not show up. Pit said wiring.' }
    ]);
    expect(byTeam.get('frc1')).toEqual([
      {
        matchKey: 'm1',
        balls: 0,
        auto: 0,
        points: 0,
        performance: null,
        incident: true,
        defended: false,
        defenseRating: null
      },
      {
        matchKey: 'm2',
        balls: 0,
        auto: 0,
        points: 0,
        performance: null,
        incident: true,
        defended: false,
        defenseRating: null
      }
    ]);
  });
});

describe('scout rankings and defense', () => {
  it('turns match rankings and power rankings into best-first orders, one power ranking per scout per match', () => {
    const events = scoutRankEvents(
      [
        { match_key: 'm1', team_key: 'frc1', created_by: 'a', power_ranking: { frc1: 2, frc2: 1, frc3: 3 } },
        { match_key: 'm1', team_key: 'frc2', created_by: 'a', power_ranking: { frc1: 2, frc2: 1, frc3: 3 } }
      ],
      [{ match_key: 'm1', ranked_team_keys: ['frc3', 'frc1', 'frc2'] }]
    );
    expect(events).toEqual([
      { matchKey: 'm1', order: ['frc3', 'frc1', 'frc2'] },
      { matchKey: 'm1', order: ['frc2', 'frc1', 'frc3'] }
    ]);
  });

  it('takes a defender off the score of the alliance it plays against', () => {
    const byTeam = new Map([
      ['frc1', { epa: 50, defensePoints: 0 }],
      ['frc2', { epa: 40, defensePoints: 10 }]
    ]);
    expect(predictAllianceScore(byTeam, ['frc1'], ['frc2'])).toBe(40);
    expect(predictAllianceScore(byTeam, ['frc2'], ['frc1'])).toBe(40);
  });
});
