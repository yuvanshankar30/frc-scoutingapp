// The Scouting Admin dashboard's models: how far each scout's fuel counts are off (smart scout
// adjustment) and the Quick Scout regression that turns quick counts into points. Pure maths, no I/O.

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseTimestampMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

export function toRound(value, digits = 4) {
  const n = safeNumber(value, 0);
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function avg(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  return list.reduce((sum, v) => sum + safeNumber(v, 0), 0) / list.length;
}

export function solveLinearSystem(a, b) {
  const n = a.length;
  if (!n || b.length !== n) return [];

  const mat = a.map((row) => row.slice());
  const rhs = b.slice();
  const EPS = 1e-9;

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(mat[row][col]) > Math.abs(mat[pivot][col])) pivot = row;
    }

    if (Math.abs(mat[pivot][col]) < EPS) {
      mat[col][col] = mat[col][col] + EPS;
      continue;
    }

    if (pivot !== col) {
      [mat[col], mat[pivot]] = [mat[pivot], mat[col]];
      [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    }

    const div = mat[col][col];
    for (let j = col; j < n; j += 1) mat[col][j] /= div;
    rhs[col] /= div;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = mat[row][col];
      if (Math.abs(factor) < EPS) continue;
      for (let j = col; j < n; j += 1) {
        mat[row][j] -= factor * mat[col][j];
      }
      rhs[row] -= factor * rhs[col];
    }
  }

  return rhs.map((v) => safeNumber(v, 1));
}

export function extractBlueFuelCount(match) {
  const blue = match?.score_breakdown?.blue;
  if (!blue || typeof blue !== 'object') return null;

  const countKeys = ['autoFuelLow', 'autoFuelHigh', 'teleopFuelLow', 'teleopFuelHigh'];
  const hasAllCountKeys = countKeys.every((k) => Number.isFinite(Number(blue[k])));
  if (hasAllCountKeys) {
    return countKeys.reduce((sum, key) => sum + safeNumber(blue[key], 0), 0);
  }

  const pointKeys = ['totalFuelPoints', 'fuelPoints', 'teleopFuelPoints', 'autoFuelPoints'];
  for (const key of pointKeys) {
    if (Number.isFinite(Number(blue[key]))) return safeNumber(blue[key], 0);
  }

  return null;
}

export function buildTeamScoutFuelEstimates(rows) {
  const byTeamScoutMatch = new Map();
  for (const row of rows || []) {
    const matchKey = String(row?.match_key || '');
    const teamKey = String(row?.team_key || '');
    const scoutId = String(row?.created_by || '');
    if (!matchKey || !teamKey || !scoutId) continue;

    const key = `${matchKey}::${teamKey}::${scoutId}`;
    if (!byTeamScoutMatch.has(key)) {
      byTeamScoutMatch.set(key, {
        match_key: matchKey,
        team_key: teamKey,
        scout_id: scoutId,
        speed_values: [],
        accuracy_values: [],
        open_shoot_starts: [],
        shooting_seconds: 0
      });
    }
    const agg = byTeamScoutMatch.get(key);
    const eventType = String(row?.event_type || '').trim();
    const eventValue = safeNumber(row?.event_value, 0);

    if (eventType === 'rank_speed') {
      if (eventValue > 0) agg.speed_values.push(eventValue);
      continue;
    }

    if (eventType === 'rank_accuracy') {
      if (eventValue > 0) agg.accuracy_values.push(eventValue);
      continue;
    }

    const ts = parseTimestampMs(row?.created_at);
    if (eventType === 'shooting_start') {
      if (ts !== null) agg.open_shoot_starts.push(ts);
      continue;
    }

    if (eventType === 'shooting_end') {
      if (ts === null || agg.open_shoot_starts.length === 0) continue;
      const start = agg.open_shoot_starts.shift();
      const deltaSec = Math.max(0, (ts - start) / 1000);
      if (deltaSec > 0) agg.shooting_seconds += deltaSec;
    }
  }

  const estimates = [];
  for (const agg of byTeamScoutMatch.values()) {
    const avgSpeed = avg(agg.speed_values);
    const avgAccuracy = avg(agg.accuracy_values);
    const shootTime = safeNumber(agg.shooting_seconds, 0);
    const baseEstimate = avgSpeed * shootTime * avgAccuracy;
    if (!Number.isFinite(baseEstimate) || baseEstimate <= 0) continue;
    estimates.push({
      match_key: agg.match_key,
      team_key: agg.team_key,
      scout_id: agg.scout_id,
      base_estimate: baseEstimate,
      shooting_seconds: shootTime
    });
  }
  return estimates;
}

export function computeSmartScoutAdjustment({ matches, dataEvents, userNameMap, enabled }) {
  const matchBlueTeams = new Map();
  for (const match of matches || []) {
    matchBlueTeams.set(match?.key, new Set(match?.alliances?.blue?.team_keys || []));
  }

  const teamScoutRows = buildTeamScoutFuelEstimates(dataEvents);
  const rowsByMatch = new Map();
  const scoutIds = new Set();

  for (const row of teamScoutRows) {
    if (!matchBlueTeams.get(row.match_key)?.has(row.team_key)) continue;
    if (!rowsByMatch.has(row.match_key)) rowsByMatch.set(row.match_key, new Map());
    const scoutMap = rowsByMatch.get(row.match_key);
    const prev = scoutMap.get(row.scout_id) || { base_estimate: 0, shooting_seconds: 0 };
    scoutMap.set(row.scout_id, {
      base_estimate: prev.base_estimate + safeNumber(row.base_estimate, 0),
      shooting_seconds: prev.shooting_seconds + safeNumber(row.shooting_seconds, 0)
    });
    scoutIds.add(row.scout_id);
  }

  const matchRows = [];
  for (const match of matches || []) {
    const y = extractBlueFuelCount(match);
    const scoutMap = rowsByMatch.get(match?.key) || new Map();
    if (!Number.isFinite(y) || y === null || scoutMap.size === 0) continue;
    matchRows.push({
      match_key: match.key,
      target_fuel: safeNumber(y, 0),
      scout_inputs: scoutMap
    });
  }

  const scoutList = [...scoutIds].sort((a, b) => a.localeCompare(b));
  const scoutIndex = new Map(scoutList.map((id, idx) => [id, idx]));
  const n = scoutList.length;
  const factors = Array(n).fill(1);

  if (enabled && n > 0 && matchRows.length > 0) {
    const lambda = 0.25;
    const gram = Array.from({ length: n }, () => Array(n).fill(0));
    const rhs = Array(n).fill(0);

    for (const row of matchRows) {
      const entries = [...row.scout_inputs.entries()];
      for (const [scoutI, payloadI] of entries) {
        const xi = safeNumber(payloadI?.base_estimate, 0);
        const i = scoutIndex.get(scoutI);
        if (i === undefined) continue;
        rhs[i] += xi * row.target_fuel;
        for (const [scoutJ, payloadJ] of entries) {
          const xj = safeNumber(payloadJ?.base_estimate, 0);
          const j = scoutIndex.get(scoutJ);
          if (j === undefined) continue;
          gram[i][j] += xi * xj;
        }
      }
    }

    for (let i = 0; i < n; i += 1) {
      gram[i][i] += lambda;
      rhs[i] += lambda;
    }

    const solved = solveLinearSystem(gram, rhs);
    for (let i = 0; i < n; i += 1) {
      factors[i] = Math.max(0, safeNumber(solved[i], 1));
    }
  }

  const residuals = [];
  const scoutResidualMap = new Map();
  const scoutBalancedBallCount = new Map();
  const scoutShootingSeconds = new Map();

  for (const row of matchRows) {
    let predicted = 0;
    for (const [scoutId, payload] of row.scout_inputs.entries()) {
      const x = safeNumber(payload?.base_estimate, 0);
      const shootingSeconds = safeNumber(payload?.shooting_seconds, 0);
      const idx = scoutIndex.get(scoutId);
      const balancedCount = x * safeNumber(factors[idx], 1);
      predicted += balancedCount;
      scoutBalancedBallCount.set(scoutId, (scoutBalancedBallCount.get(scoutId) || 0) + balancedCount);
      scoutShootingSeconds.set(scoutId, (scoutShootingSeconds.get(scoutId) || 0) + shootingSeconds);
    }
    const residual = row.target_fuel - predicted;
    residuals.push(residual);

    for (const [scoutId] of row.scout_inputs.entries()) {
      if (!scoutResidualMap.has(scoutId)) scoutResidualMap.set(scoutId, []);
      scoutResidualMap.get(scoutId).push(residual);
    }
  }

  const rmse = residuals.length > 0 ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length) : 0;
  const mae = residuals.length > 0 ? residuals.reduce((sum, r) => sum + Math.abs(r), 0) / residuals.length : 0;

  const byScout = scoutList
    .map((scoutId, idx) => {
      const rs = scoutResidualMap.get(scoutId) || [];
      const rMae = rs.length ? rs.reduce((sum, r) => sum + Math.abs(r), 0) / rs.length : 0;
      const rBias = rs.length ? rs.reduce((sum, r) => sum + r, 0) / rs.length : 0;
      const rRmse = rs.length ? Math.sqrt(rs.reduce((sum, r) => sum + r * r, 0) / rs.length) : 0;
      const balancedBallCount = safeNumber(scoutBalancedBallCount.get(scoutId), 0);
      const shootingSeconds = safeNumber(scoutShootingSeconds.get(scoutId), 0);
      const estimatedBps = shootingSeconds > 0 ? balancedBallCount / shootingSeconds : 0;
      return {
        scout_id: scoutId,
        scout_name: userNameMap.get(scoutId) || scoutId,
        adjustment_factor: toRound(factors[idx], 4),
        balanced_ball_count: toRound(balancedBallCount, 3),
        shooting_seconds: toRound(shootingSeconds, 3),
        estimated_bps: toRound(estimatedBps, 4),
        residual_mae: toRound(rMae, 3),
        residual_bias: toRound(rBias, 3),
        residual_rmse: toRound(rRmse, 3),
        sample_matches: rs.length
      };
    })
    .sort((a, b) => a.scout_name.localeCompare(b.scout_name));

  const warning =
    matchRows.length === 0 ? 'No qualification matches had both blue alliance fuel data and scout input data.' : null;

  return {
    enabled: !!enabled,
    match_count: matchRows.length,
    residual_rmse: toRound(rmse, 3),
    residual_mae: toRound(mae, 3),
    warning,
    by_scout: byScout
  };
}

export function buildQuickScoutFeatureMap(rows) {
  const byTeamMatch = new Map();
  const openShootStarts = new Map(); // `${match}::${team}` -> [start ms, ...]

  for (const row of rows || []) {
    const matchKey = String(row?.match_key || '');
    const teamKey = String(row?.team_key || '');
    const eventType = String(row?.event_type || '').trim();
    if (!matchKey || !teamKey || !eventType.startsWith('quick_')) continue;

    const key = `${matchKey}::${teamKey}`;
    if (!byTeamMatch.has(key)) {
      byTeamMatch.set(key, {
        match_key: matchKey,
        team_key: teamKey,
        shooting_seconds: 0,
        climbed: false,
        defense: false,
        broken: false
      });
    }
    const agg = byTeamMatch.get(key);
    const ts = parseTimestampMs(row?.created_at);

    if (eventType === 'quick_shooting_start') {
      if (ts !== null) {
        if (!openShootStarts.has(key)) openShootStarts.set(key, []);
        openShootStarts.get(key).push(ts);
      }
      continue;
    }
    if (eventType === 'quick_shooting_end') {
      const stack = openShootStarts.get(key);
      if (ts === null || !stack || stack.length === 0) continue;
      const start = stack.shift();
      const deltaSec = Math.max(0, (ts - start) / 1000);
      if (deltaSec > 0) agg.shooting_seconds += deltaSec;
      continue;
    }
    if (eventType === 'quick_climbed_start') {
      agg.climbed = true;
      continue;
    }
    if (eventType === 'quick_defense_start') {
      agg.defense = true;
      continue;
    }
    if (eventType === 'quick_broken_start') {
      agg.broken = true;
      continue;
    }
    // quick_auto_start_position and the _end events of climbed/defense/broken
    // (already captured by their _start above) intentionally don't affect
    // the feature map further.
  }

  return byTeamMatch;
}

export function buildAllianceRegressionRows({ matches, featureMap }) {
  const rows = [];
  for (const match of matches || []) {
    for (const color of ['blue', 'red']) {
      const teamKeys = match?.alliances?.[color]?.team_keys || [];
      if (teamKeys.length !== 3) continue;
      const totalPoints = match?.score_breakdown?.[color]?.totalPoints;
      if (!Number.isFinite(Number(totalPoints))) continue;

      const perTeamFeatures = {};
      let anyCoverage = false;
      let shootSum = 0;
      let climbedCount = 0;
      let defenseCount = 0;
      let brokenCount = 0;
      for (const teamKey of teamKeys) {
        const feat = featureMap.get(`${match.key}::${teamKey}`);
        const resolved = feat || { shooting_seconds: 0, climbed: false, defense: false, broken: false };
        if (feat) anyCoverage = true;
        perTeamFeatures[teamKey] = resolved;
        shootSum += safeNumber(resolved.shooting_seconds, 0);
        if (resolved.climbed) climbedCount += 1;
        if (resolved.defense) defenseCount += 1;
        if (resolved.broken) brokenCount += 1;
      }
      if (!anyCoverage) continue;

      rows.push({
        match_key: match.key,
        alliance_color: color,
        team_keys: teamKeys,
        features: [1, shootSum, climbedCount, defenseCount, brokenCount],
        per_team_features: perTeamFeatures,
        target: safeNumber(totalPoints, 0)
      });
    }
  }
  return rows;
}

// Ridge toward 0 (a sensible zero-prior for literal point-value weights,
// unlike computeSmartScoutAdjustment's shrink-toward-1 correction factors).
// Standardizes the 4 non-intercept features before fitting so one flat
// lambda regularizes evenly despite very different natural scales
// (shooting seconds can be 100+, climb/defense/broken counts are 0-3), then
// un-standardizes the fitted coefficients back to real point-value units.
export function fitQuickScoutRegression(rows, lambda = 0.05) {
  const P = QUICK_FEATURE_NAMES.length;
  if (!rows.length) return Array(P).fill(0);

  const scales = [1];
  for (let i = 1; i < P; i += 1) {
    const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.features[i])));
    scales.push(maxAbs > 0 ? maxAbs : 1);
  }

  const gram = Array.from({ length: P }, () => Array(P).fill(0));
  const rhs = Array(P).fill(0);
  for (const row of rows) {
    const x = row.features.map((v, i) => v / scales[i]);
    for (let i = 0; i < P; i += 1) {
      rhs[i] += x[i] * row.target;
      for (let j = 0; j < P; j += 1) gram[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < P; i += 1) gram[i][i] += lambda;

  const solvedStandardized = solveLinearSystem(gram, rhs);
  return solvedStandardized.map((v, i) => safeNumber(v, 0) / scales[i]);
}

export function computeQuickScoutModel({ matches, quickEvents }) {
  const featureMap = buildQuickScoutFeatureMap(quickEvents);
  const rows = buildAllianceRegressionRows({ matches, featureMap });

  if (rows.length === 0) {
    return {
      alliance_count: 0,
      coefficients: null,
      residual_rmse: 0,
      residual_mae: 0,
      warning: 'No matches yet have both Quick Scout data and a real alliance score to regress against.',
      by_team: []
    };
  }

  // lambda=0.05, not 0.5: verified against synthetic data with known ground
  // truth (see session notes) that 0.5 introduces real bias here - an
  // unregularized intercept trades off against low-variance regularized
  // features (climbed/defense/broken are small integer counts), and 0.5
  // was strong enough to shrink a true broken coefficient of -2 down to
  // -0.36. 0.05 recovers known coefficients within ~15% on 60 synthetic
  // alliance-matches while still preventing an unregularized blowup on
  // small/collinear real data.
  const [beta0, betaShoot, betaClimb, betaDefense, betaBroken] = fitQuickScoutRegression(rows, 0.05);

  const residuals = [];
  const teamAgg = new Map();

  for (const row of rows) {
    const contributions = {};
    let predictedTotal = beta0;
    for (const teamKey of row.team_keys) {
      const f = row.per_team_features[teamKey];
      const contribution =
        betaShoot * safeNumber(f?.shooting_seconds, 0) +
        betaClimb * (f?.climbed ? 1 : 0) +
        betaDefense * (f?.defense ? 1 : 0) +
        betaBroken * (f?.broken ? 1 : 0);
      contributions[teamKey] = contribution;
      predictedTotal += contribution;
    }
    residuals.push(row.target - predictedTotal);

    const sumContribution = Object.values(contributions).reduce((s, v) => s + v, 0);
    for (const teamKey of row.team_keys) {
      const contribution = contributions[teamKey];
      // Relative-share convention; split evenly if the whole alliance's
      // modeled contribution is ~0 (e.g. no Quick Scout coverage this match).
      const percent = sumContribution > 1e-6 ? (contribution / sumContribution) * 100 : 100 / 3;
      if (!teamAgg.has(teamKey)) teamAgg.set(teamKey, { sumPercent: 0, sumContribution: 0, matchCount: 0 });
      const agg = teamAgg.get(teamKey);
      agg.sumPercent += percent;
      agg.sumContribution += contribution;
      agg.matchCount += 1;
    }
  }

  const rmse = residuals.length ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length) : 0;
  const mae = residuals.length ? residuals.reduce((s, r) => s + Math.abs(r), 0) / residuals.length : 0;

  const byTeam = [...teamAgg.entries()]
    .map(([teamKey, agg]) => ({
      team_key: teamKey,
      matches_scored: agg.matchCount,
      avg_percent_of_alliance_score: toRound(agg.sumPercent / agg.matchCount, 1),
      avg_contribution_points: toRound(agg.sumContribution / agg.matchCount, 2)
    }))
    .sort((a, b) => b.avg_percent_of_alliance_score - a.avg_percent_of_alliance_score);

  return {
    alliance_count: rows.length,
    coefficients: {
      intercept: toRound(beta0, 3),
      shooting_seconds: toRound(betaShoot, 4),
      climbed: toRound(betaClimb, 3),
      defense: toRound(betaDefense, 3),
      broken: toRound(betaBroken, 3)
    },
    residual_rmse: toRound(rmse, 2),
    residual_mae: toRound(mae, 2),
    warning: rows.length < 5 ? 'Very few matches with Quick Scout coverage so far - estimates will be noisy.' : null,
    by_team: byTeam
  };
}

// ===== Quick Scout alliance-score attribution =====
// Team 604's method: a scout logs starting position + shooting/climbed/
// defense/broken toggles (see src/routes/quickscout/), and this regresses
// those coarse per-robot signals against each match's REAL alliance score
// (score_breakdown.<color>.totalPoints, confirmed live against real 2026arc
// data - unlike extractBlueFuelCount above, this field is season-agnostic
// and always present) to estimate what share of the alliance's score each
// robot was responsible for. Same solveLinearSystem solver as Smart Fuel
// Calibration above, but a genuinely different regression shape: that tool
// solves one correction FACTOR per scout (ridge shrinks toward 1) using
// alliance-total fuel counts; this solves shared point-VALUE coefficients
// (ridge shrinks toward 0) using alliance-total score, one row per
// match×alliance since TBA never gives us a single robot's own score.
//
// Known, accepted limitation: defense reduces the OPPONENT alliance's
// score, not this alliance's own total, so a same-alliance regression
// structurally can't credit it well - its coefficient will likely be near
// zero or noisy. That's expected, not a bug - matches what was actually
// asked for (604's simple method), not a fancier two-alliance model.

export const QUICK_FEATURE_NAMES = ['intercept', 'shooting_seconds', 'climbed_count', 'defense_count', 'broken_count'];
