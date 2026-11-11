export const MATCH_RATING_FIELDS = Object.freeze([
  'Shot accuracy',
  'Driver awareness',
  'Cycle speed',
  'Defense',
  'Reliability'
]);

export const TELEOP_ROLES = Object.freeze(['Scoring', 'Shuttling', 'Fuel collection', 'Defense']);

// New reports use these labels; legacy vocabularies above remain readable.
export const MATCH_FORM_RATING_FIELDS = Object.freeze(['Shot accuracy', 'BPS']);
export const MATCH_OPTIONAL_RATING_FIELDS = Object.freeze(['Driver awareness', 'Defense', 'Reliability']);
export const MATCH_FORM_ROLES = Object.freeze(['Scorer', 'Defense', 'Shuttler']);
export const AUTO_FUEL_SOURCES = Object.freeze(['Neutral Zone', 'Outpost', 'Depot', 'Ground', 'Preload']);
export const ACCURACY_LABELS = Object.freeze(['0–20%', '>20–50%', '>50–75%', '>75–85%', '>85–100%']);
export const BPS_LABELS = Object.freeze(['0–5 BPS', '>5–10 BPS', '>10–20 BPS', '>20–30 BPS', '>30 BPS']);

// section_fields 4: defense details on Data, the BPS slider and every Performance answer required, and
// robot status per shift, break details and foul nature on Robot. Older pages and offline queues still save.
export const SECTION_FIELDS = 4;
const currentSections = (body) => Number(body?.section_fields) >= SECTION_FIELDS;

/** The five stretches of teleop a status or defense answer can name. */
export const MATCH_SHIFTS = Object.freeze([
  Object.freeze({ key: 'shift1', label: 'Shift 1' }),
  Object.freeze({ key: 'shift2', label: 'Shift 2' }),
  Object.freeze({ key: 'shift3', label: 'Shift 3' }),
  Object.freeze({ key: 'shift4', label: 'Shift 4' }),
  Object.freeze({ key: 'endgame', label: 'Endgame' })
]);
export const MATCH_SHIFT_KEYS = Object.freeze(MATCH_SHIFTS.map((shift) => shift.key));
// Whether the defending robot's own hub was active or inactive while it played defense.
export const DEFENSE_PERIODS = Object.freeze(['active', 'inactive']);
export const DEFENSE_EFFECTIVENESS_MAX = 10;
export const ROBOT_SHIFT_STATUSES = Object.freeze(['active', 'dead', 'stopped']);
export const FOUL_NATURES = Object.freeze([
  'Contact / pinning',
  'Contact inside frame perimeter',
  'Too much fuel held',
  'Protected zone violation',
  'Extension beyond limits',
  'Field damage',
  'Endgame / tower interference',
  'Other'
]);

// BPS is now an exact slider reading; the 1-5 bucket it falls in still goes into ratings.BPS for older analytics.
export const BPS_SLIDER_MAX = 40;
export function bpsBucket(bps) {
  const value = Number(bps);
  if (bps === null || bps === '' || !Number.isFinite(value) || value < 0) return 0;
  if (value <= 5) return 1;
  if (value <= 10) return 2;
  if (value <= 20) return 3;
  if (value <= 30) return 4;
  return 5;
}

/** The worst status across the shifts, for everything that still reads a single teleop_robot_status. */
export function overallRobotStatus(shifts) {
  const values = MATCH_SHIFT_KEYS.map((key) => shifts?.[key]).filter(Boolean);
  if (!values.length) return '';
  if (values.includes('dead')) return 'dead';
  if (values.includes('stopped')) return 'stopped';
  return 'active';
}

/**
 * A team key inside a ranking, where offseason B teams can appear: TBA names them with a one-letter suffix
 * (`frc4414B`). Returns the TBA form (number plus an upper-case letter) so it matches the match's own team keys.
 * For rankings and defense targets: the scouting tables' team_key columns still accept plain numbers only (is_frc_team_key).
 */
export function normalizeRankedTeamKey(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^frc/, '');
  const match = /^(\d{1,5})([a-z]?)$/.exec(text);
  return match ? `frc${match[1]}${match[2].toUpperCase()}` : null;
}

/** The defense answers a Data scout gives once Defense is picked as a role, cleaned; null when there are none. */
export function normalizeDefense(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const list = (raw, allowed) => [...new Set((Array.isArray(raw) ? raw : []).filter((entry) => allowed(entry)))];
  const targets = list((Array.isArray(value.targets) ? value.targets : []).map(normalizeRankedTeamKey), Boolean).slice(
    0,
    3
  );
  const periods = list(value.periods, (entry) => DEFENSE_PERIODS.includes(entry));
  const shifts = list(value.shifts, (entry) => MATCH_SHIFT_KEYS.includes(entry));
  const effectiveness = Number(value.effectiveness);
  const cleaned = {
    targets,
    periods,
    shifts,
    effectiveness:
      Number.isInteger(effectiveness) && effectiveness >= 1 && effectiveness <= DEFENSE_EFFECTIVENESS_MAX
        ? effectiveness
        : null
  };
  return targets.length || periods.length || shifts.length || cleaned.effectiveness ? cleaned : null;
}

/** The required Data scouting answers: preload, teleop roles and balls scored. */
// A robot that never showed up has nothing else to report: "No" on robot_present makes every other answer optional.
export const robotNoShow = (body) => body?.robot_present === false;

export function validateMatchScoutForm(body) {
  if (!String(body.scout_name || '').trim()) return 'Enter the scout name.';
  if (robotNoShow(body)) return null;
  if (typeof body.preload !== 'boolean') return 'Select whether the robot has a preload.';
  if (!Array.isArray(body.teleop_roles) || (!body.teleop_roles.length && body.teleop_roles_none !== true))
    return 'Select teleop roles or None observed.';
  if ((body.teleop_roles || []).some((role) => !MATCH_FORM_ROLES.includes(role))) return 'Select valid teleop roles.';
  const balls = parseAutoPointsEstimate(body.balls_scored_band);
  if (!balls || !Number.isInteger(balls.min) || (balls.max !== null && !Number.isInteger(balls.max)))
    return 'Enter balls scored as a whole number, range, or lower bound.';
  if (currentSections(body) && body.teleop_roles.includes('Defense')) return validateDefense(body);
  return null;
}

/** A robot that played defense: who it defended, when, how well, and the scout's description of it. */
export function validateDefense(body) {
  const defense = normalizeDefense(body.defense);
  if (!defense?.targets.length) return 'Select the robots it defended against.';
  if (!defense.periods.length) return 'Select whether it defended while its hub was active or inactive.';
  if (!defense.shifts.length) return 'Select the shifts it played defense in.';
  if (!defense.effectiveness) return `Rate how effective the defense was from 1 to ${DEFENSE_EFFECTIVENESS_MAX}.`;
  if (!String(body.teleop_notes || '').trim()) return 'Describe the defense in Real-scout observations.';
  return null;
}

/**
 * The required Performance scouting answers. Since section_fields 4 every answer is required: shot accuracy, the
 * BPS slider, intake speed, driver skill, the power ranking and the notes. Older reports rate shot accuracy and BPS,
 * each rated or deliberately left unjudged.
 */
export function validatePerformanceRatings(body) {
  if (robotNoShow(body)) return null;
  if (currentSections(body)) {
    const accuracy = body.ratings?.['Shot accuracy'];
    if (!Number.isInteger(accuracy) || accuracy < 1 || accuracy > 5) return 'Rate Shot accuracy.';
    const bps = Number(body.bps);
    if (body.bps === null || body.bps === '' || body.bps === undefined || !Number.isFinite(bps) || bps < 0)
      return 'Set balls per second with the slider.';
    if (![1, 2, 3].includes(Number(body.intake_speed))) return 'Rate intake speed.';
    if (![1, 2, 3, 4, 5].includes(Number(body.driver_skill))) return 'Rate driver skill.';
    if (!body.power_ranking || !Object.keys(body.power_ranking).length) return 'Rank the robots you watched.';
    if (!String(body.performance_notes || '').trim()) return 'Write your notes about performance.';
    return null;
  }
  for (const field of MATCH_FORM_RATING_FIELDS) {
    const rating = body.ratings?.[field];
    const unknown = body.ratings_unknown?.includes(field);
    if (!unknown && (!Number.isInteger(rating) || rating < 1 || rating > 5))
      return `Rate ${field}; click a selected rating again to leave it unjudged.`;
    if (unknown && rating > 0) return `Choose a rating or leave ${field} unjudged, not both.`;
  }
  return null;
}

/** The required Robot scouting answers about the robot's condition: significant crash and robot status. */
export function validateRobotCondition(body) {
  if (robotNoShow(body)) return null;
  if (typeof body.significant_crash !== 'boolean') return 'Select whether a significant crash occurred.';
  if (body.significant_crash && !['robot', 'wall', 'field element', 'other'].includes(body.crash_target))
    return 'Select what the robot crashed into.';
  if (body.significant_crash && body.crash_target === 'other' && !String(body.crash_details || '').trim())
    return 'Describe the other crash target.';
  if (currentSections(body)) {
    const missing = MATCH_SHIFTS.find((shift) => !ROBOT_SHIFT_STATUSES.includes(body.robot_status_shifts?.[shift.key]));
    if (missing) return `Select the robot status for ${missing.label}.`;
  } else if (!['active', 'dead', 'stopped', 'brownout', 'unknown'].includes(body.teleop_robot_status))
    return 'Select the robot status.';
  if (currentSections(body)) {
    if (body.mechanical_break === true && !String(body.break_details || '').trim())
      return 'Record what broke on the robot.';
    if ((Number(body.fouls_minor) || 0) + (Number(body.fouls_major) || 0) > 0) {
      if (!FOUL_NATURES.includes(body.foul_nature)) return 'Select the nature of the foul.';
      if (body.foul_nature === 'Other' && !String(body.foul_details || '').trim()) return 'Describe the foul.';
    }
  }
  return null;
}

const MAX_AUTO_POINTS = 1000;

function finitePoints(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= MAX_AUTO_POINTS ? value : null;
}

function cleanNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

// Scouts often know a useful range, not a fake exact count. Keep the original
// meaning and derive one numeric estimate for aggregation. Open-ended values
// such as "100+" use 100 as a conservative lower-bound estimate; there is no
// mathematically honest midpoint when the upper bound is unknown.
// Ball-count buckets a scout picks from when estimating how many balls a robot
// handled in a match. Deliberately a fixed vocabulary rather than the free-text
// box used for auto points: counting balls at a glance is a rough judgement, and
// offering exact entry would imply a precision nobody watching a match actually
// has.
//
// Generated rather than written out so the steps cannot drift or contain a
// typo. 0-25 through 475-500 in steps of 25, then an open-ended top bucket -
// the ranges parse with parseAutoPointsEstimate() below, so "500+" yields a
// conservative lower bound instead of a midpoint.
export const BALL_COUNT_STEP = 25;
export const BALL_COUNT_MAX = 500;
export const BALL_COUNT_RANGES = Object.freeze([
  ...Array.from(
    { length: BALL_COUNT_MAX / BALL_COUNT_STEP },
    (_, index) => `${index * BALL_COUNT_STEP}-${(index + 1) * BALL_COUNT_STEP}`
  ),
  `${BALL_COUNT_MAX}+`
]);

export function parseAutoPointsEstimate(raw) {
  const text = String(raw ?? '')
    .trim()
    .replaceAll(',', '');
  if (!text) return null;

  const lowerBound = text.match(/^~?\s*(\d+(?:\.\d+)?)\s*\+$/);
  if (lowerBound) {
    const min = finitePoints(lowerBound[1]);
    if (min == null) return null;
    return {
      input: `${cleanNumber(min)}+`,
      min,
      max: null,
      average: min,
      kind: 'lower-bound'
    };
  }

  const range = text.match(/^~?\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)$/i);
  if (range) {
    const min = finitePoints(range[1]);
    const max = finitePoints(range[2]);
    if (min == null || max == null || min > max) return null;
    return {
      input: `${cleanNumber(min)}-${cleanNumber(max)}`,
      min,
      max,
      average: (min + max) / 2,
      kind: min === max ? 'exact' : 'range'
    };
  }

  const exact = text.match(/^~?\s*(\d+(?:\.\d+)?)$/);
  if (!exact) return null;
  const value = finitePoints(exact[1]);
  if (value == null) return null;
  return {
    input: cleanNumber(value),
    min: value,
    max: value,
    average: value,
    kind: 'exact'
  };
}

// Releasing the pointer ends one drawing gesture, not the robot's route.
// Preserve previously captured points when the scout resumes drawing.
export function continueAutoPath(path, point) {
  const existingPath = Array.isArray(path) ? path : [];
  return [...existingPath, point];
}

// The field map uses a 1000 by 487 viewBox scaled from the official 2026
// field dimensions. Keeping the footprint math here lets the drawing surface,
// saved-path validation, and later route analysis agree on what "clear" means.
export const AUTO_FIELD = Object.freeze({
  width: 1000,
  height: 487,
  wallInset: 8,
  robotSizeInches: 29,
  fieldWidthInches: 651.25,
  fieldHeightInches: 317.0
});

export const AUTO_ROBOT_SIZE = Object.freeze({
  width: AUTO_FIELD.robotSizeInches * (AUTO_FIELD.width / AUTO_FIELD.fieldWidthInches),
  height: AUTO_FIELD.robotSizeInches * (AUTO_FIELD.height / AUTO_FIELD.fieldHeightInches)
});

// These are the simplified map's solid hubs - the only field elements a
// robot's 29-inch footprint can't occupy. Trenches (like bumps) are terrain
// a robot drives under/through, not a wall - they render on the map but
// were wrongly listed here as a total no-go zone, blocking a perfectly
// legal drawn path through either alliance's trench.
export const AUTO_NO_GO_AREAS = Object.freeze([
  { id: 'own-hub', label: 'alliance hub', x: 246, y: 198, width: 92, height: 92 },
  { id: 'opponent-hub', label: 'opponent hub', x: 662, y: 198, width: 92, height: 92 }
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function autoPointToField(point) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  return {
    x: clamp(Number.isFinite(x) ? x : 0, 0, 100) * (AUTO_FIELD.width / 100),
    y: clamp(Number.isFinite(y) ? y : 0, 0, 100) * (AUTO_FIELD.height / 100)
  };
}

export function robotBoundsAtAutoPoint(point) {
  const center = autoPointToField(point);
  return {
    x: center.x - AUTO_ROBOT_SIZE.width / 2,
    y: center.y - AUTO_ROBOT_SIZE.height / 2,
    width: AUTO_ROBOT_SIZE.width,
    height: AUTO_ROBOT_SIZE.height
  };
}

function rectanglesIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function autoRobotCollision(point) {
  const robot = robotBoundsAtAutoPoint(point);
  const minX = AUTO_FIELD.wallInset;
  const minY = AUTO_FIELD.wallInset;
  const maxX = AUTO_FIELD.width - AUTO_FIELD.wallInset;
  const maxY = AUTO_FIELD.height - AUTO_FIELD.wallInset;
  if (robot.x < minX || robot.y < minY || robot.x + robot.width > maxX || robot.y + robot.height > maxY) {
    return { id: 'field-wall', label: 'field boundary' };
  }
  return AUTO_NO_GO_AREAS.find((area) => rectanglesIntersect(robot, area)) || null;
}

// Sample an extension finely enough that a fast pointer movement cannot jump
// through a hub or trench between two otherwise clear recorded points.
export function canExtendAutoPath(path, point) {
  const existingPath = Array.isArray(path) ? path : [];
  const previous = existingPath.at(-1);
  if (!previous) {
    const collision = autoRobotCollision(point);
    return { allowed: !collision, collision };
  }

  const start = autoPointToField(previous);
  const end = autoPointToField(point);
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3));
  let lastSafePoint = previous;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const candidate = [
      (start.x + (end.x - start.x) * t) / (AUTO_FIELD.width / 100),
      (start.y + (end.y - start.y) * t) / (AUTO_FIELD.height / 100)
    ];
    const collision = autoRobotCollision(candidate);
    if (collision) return { allowed: false, collision, lastSafePoint };
    lastSafePoint = candidate;
  }
  return { allowed: true, collision: null, lastSafePoint };
}

function intervalWithinBand(start, end, min, max) {
  const delta = end - start;
  if (Math.abs(delta) < 0.0001) return start >= min && start <= max ? [0, 1] : null;
  const first = (min - start) / delta;
  const second = (max - start) / delta;
  const low = Math.max(0, Math.min(first, second));
  const high = Math.min(1, Math.max(first, second));
  return low <= high ? [low, high] : null;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals.filter(Boolean).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

// Returns just the portion(s) of a segment where the 29-inch footprint
// overlaps either centerline. Rendering only these intervals red leaves the
// rest of the hand-drawn route in its normal color.
export function autoCenterlineIntervals(startPoint, endPoint) {
  const start = autoPointToField(startPoint);
  const end = autoPointToField(endPoint);
  const halfWidth = AUTO_ROBOT_SIZE.width / 2;
  const halfHeight = AUTO_ROBOT_SIZE.height / 2;
  return mergeIntervals([
    intervalWithinBand(start.x, end.x, AUTO_FIELD.width / 2 - halfWidth, AUTO_FIELD.width / 2 + halfWidth),
    intervalWithinBand(start.y, end.y, AUTO_FIELD.height / 2 - halfHeight, AUTO_FIELD.height / 2 + halfHeight)
  ]);
}
