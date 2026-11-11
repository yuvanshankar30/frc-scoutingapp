// Validation and normalization for match scouting and the pit-problem
// handoff. Kept pure and separate from the route so the rules are directly
// testable, and because this is the only thing standing between a scout's
// phone and the database - the client is a form anyone can edit.
//
// The vocabularies below mirror what the match scouting workspace collects.
// Anything outside them is dropped rather than stored, so a renamed option in
// the UI shows up as missing data instead of quietly widening the schema.

import {
  BALL_COUNT_RANGES as SHARED_BALL_COUNT_RANGES,
  MATCH_RATING_FIELDS,
  TELEOP_ROLES as SHARED_TELEOP_ROLES,
  parseAutoPointsEstimate,
  AUTO_FUEL_SOURCES,
  MATCH_FORM_ROLES,
  MATCH_FORM_RATING_FIELDS,
  MATCH_OPTIONAL_RATING_FIELDS,
  ALL_REQUIRED,
  validateMatchScoutForm,
  validatePerformanceRatings,
  validateRobotCondition,
  robotNoShow,
  BPS_SLIDER_MAX,
  bpsBucket,
  FOUL_NATURES,
  MATCH_SHIFT_KEYS,
  ROBOT_SHIFT_STATUSES,
  normalizeDefense,
  normalizeRankedTeamKey,
  overallRobotStatus
} from '$lib/scouting/matchScouting.js';
import { REPORT_KINDS, withoutOtherKindFields } from '$lib/scouting/reportKinds.js';
import { canonicalMatchKey } from '$lib/matches/matchKeys.js';

// Rankings (matchRankingSchema.js) import it from here; it lives with the defense targets that share it.
export { normalizeRankedTeamKey };

export const START_POSITIONS = ['left trench', 'left mound', 'center', 'right mound', 'right trench'];
export const AUTO_ZONES = ['source', 'wing', 'neutral', 'opponent wing'];
export const RATING_FIELDS = MATCH_RATING_FIELDS;
export const TELEOP_ROLES = SHARED_TELEOP_ROLES;
export const BALL_SOURCES = ['source', 'wing', 'neutral', 'opponent wing', 'human player', 'floor'];
export const BALL_COUNT_RANGES = SHARED_BALL_COUNT_RANGES;
export const CARDS = ['', 'yellow', 'red'];
export const DISABLED_STATES = ['', 'no', 'tipped', 'died', 'disabled'];
export const SEVERITIES = ['urgent', 'watch'];

const MAX_NOTE_LENGTH = 4000;
const MAX_SUMMARY_LENGTH = 300;

function trimmed(value, max = MAX_NOTE_LENGTH) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function oneOf(value, allowed) {
  if (value == null) return null;
  const text = String(value).trim();
  return allowed.includes(text) ? text : null;
}

export function requiresPitProblemReport(robotDisabled) {
  return ['disabled', 'died'].includes(String(robotDisabled || '').trim());
}

export function validatePitProblemHandoff(body) {
  const requested =
    body?.teleop_robot_status === 'dead' ||
    body?.mechanical_break === true ||
    body?.report_pit_problem === true ||
    requiresPitProblemReport(body?.robot_disabled);
  if (!requested) return null;
  return trimmed(body?.pit_problem_summary, MAX_SUMMARY_LENGTH)
    ? null
    : 'Describe the problem for the pit crew when the robot breaks, is disabled, or died';
}

/** Team keys arrive as "254", "frc254" or " frc254 " depending on the caller. */
export function normalizeTeamKey(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  const digits = text.replace(/^frc/, '');
  return /^\d{1,5}$/.test(digits) ? `frc${digits}` : null;
}

export function normalizeRatings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ratings = {};
  for (const field of [...RATING_FIELDS, 'BPS']) {
    const raw = Number(value[field]);
    if (!Number.isFinite(raw)) continue;
    const clamped = Math.min(5, Math.max(0, Math.round(raw)));
    // 0 means "not rated" in the UI, so there is nothing to record.
    if (clamped > 0) ratings[field] = clamped;
  }
  return ratings;
}

function normalizeStringList(value, allowed) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const match = oneOf(entry, allowed);
    if (match) seen.add(match);
  }
  return [...seen];
}

// A 1-5 rating, or null when the scout left it blank (0, missing or out of range).
function ratingOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

function countOrNull(value, max = 50) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
}

/**
 * One scout's ranking of the robots in a match, { frc254: 1, frc1678: 2 }. Robots the scout did not watch are
 * simply absent. Ranks must be distinct whole numbers from 1 to 6; anything else drops the ranking rather than
 * storing a half-valid one, because averaging a duplicated rank would silently skew every robot in the match.
 */
export function normalizePowerRanking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ranking = {};
  const used = new Set();
  for (const [rawKey, rawRank] of Object.entries(value)) {
    const teamKey = normalizeRankedTeamKey(rawKey);
    const rank = Number(rawRank);
    if (!teamKey || !Number.isInteger(rank) || rank < 1 || rank > 6 || used.has(rank) || ranking[teamKey]) return {};
    used.add(rank);
    ranking[teamKey] = rank;
  }
  return Object.keys(ranking).length > 6 ? {} : ranking;
}

/**
 * @returns {{ value: object|null, error: string|null }}
 */
export function normalizeMatchScoutEntry(body, actorId = null, rules = ALL_REQUIRED) {
  const event_key = trimmed(body?.event_key, 60);
  const match_label = trimmed(body?.match_key, 120);
  const team_key = normalizeTeamKey(body?.team_key);
  if (!event_key) return { value: null, error: 'event_key is required' };
  if (!match_label) return { value: null, error: 'match_key is required' };
  // Reports are stored under the real match key ("2026cc_qm12"), whatever the scout typed.
  const match_key = canonicalMatchKey(match_label, event_key);
  if (!match_key)
    return {
      value: null,
      error: `"${match_label}" isn't a match number. Use 12 for Qual 12, or sf2m1 / f1m2 for playoffs.`
    };
  if (!team_key) return { value: null, error: 'A valid team_key is required (e.g. frc254)' };

  const rawAutoPoints = body?.auto_points_estimate ?? body?.auto_points_band;
  const autoPoints = parseAutoPointsEstimate(rawAutoPoints);
  if (String(rawAutoPoints ?? '').trim() && !autoPoints) {
    return {
      value: null,
      error: 'Auto points must be a number, a range like 40-60, or a lower bound like 100+'
    };
  }

  // Balls are picked from a fixed bucket list, so an unrecognized value is a
  // client that has drifted from the vocabulary rather than a scout typo -
  // dropped like every other out-of-vocabulary field instead of stored.
  const currentForm = body?.form_version === 2;
  // Data, Performance and Robot scouting are separate tabs, each saving its own report. Only a data report has
  // to answer the auto/teleop questions, and only a robot report has to say whether something broke.
  const report_kind = REPORT_KINDS.includes(body?.report_kind) ? body.report_kind : 'data';
  if (currentForm) {
    if (report_kind === 'data') {
      const invalid = validateMatchScoutForm(body, rules);
      if (invalid) return { value: null, error: invalid };
      if (!robotNoShow(body) && rules.need('prematch.start') && !START_POSITIONS.includes(body.starting_position))
        return { value: null, error: 'Select a starting position.' };
    } else if (!String(body.scout_name || '').trim()) {
      return { value: null, error: 'Enter the scout name.' };
    }
    // section_fields 3 moved the shot accuracy/BPS ratings to Performance and the crash and robot status questions
    // to Robot. Reports from a page still open on the older layout, or queued offline before the change, do not
    // have those answers in that tab and must still save.
    if (body.section_fields >= 3) {
      const invalid =
        report_kind === 'performance'
          ? validatePerformanceRatings(body, rules)
          : report_kind === 'robot'
            ? validateRobotCondition(body, rules)
            : null;
      if (invalid) return { value: null, error: invalid };
    }
    if (
      report_kind === 'robot' &&
      !robotNoShow(body) &&
      rules.need('postmatch.break') &&
      typeof body.mechanical_break !== 'boolean'
    )
      return { value: null, error: 'Select whether a mechanical break occurred.' };
    if (body.mechanical_break != null && typeof body.mechanical_break !== 'boolean')
      return { value: null, error: 'Select whether a mechanical break occurred.' };
    if (
      body.auto_cycles != null &&
      (!Number.isInteger(body.auto_cycles) || body.auto_cycles < 0 || body.auto_cycles > 100)
    )
      return { value: null, error: 'Auto cycles must be a whole number from 0 to 100.' };
  }
  const ballsBand = currentForm ? body.balls_scored_band : oneOf(body?.balls_scored_band, BALL_COUNT_RANGES);
  const balls = ballsBand ? parseAutoPointsEstimate(ballsBand) : null;

  const driverSkillRaw = Number(body?.driver_skill);
  const value = {
    event_key,
    match_key,
    match_label,
    team_key,
    ...(currentForm
      ? {
          form_version: 2,
          report_kind,
          // A robot nobody said was missing showed up; only an explicit No is a no-show.
          robot_present: body.robot_present !== false,
          scout_name: trimmed(body.scout_name, 120),
          preload: typeof body.preload === 'boolean' ? body.preload : null,
          auto_cycles:
            Number.isInteger(body.auto_cycles) && body.auto_cycles >= 0 && body.auto_cycles <= 100
              ? body.auto_cycles
              : null,
          teleop_roles_none: body.teleop_roles_none === true && !(body.teleop_roles || []).length,
          ratings_unknown: normalizeStringList(body.ratings_unknown, [
            ...MATCH_FORM_RATING_FIELDS,
            ...MATCH_OPTIONAL_RATING_FIELDS
          ]),
          significant_crash: typeof body.significant_crash === 'boolean' ? body.significant_crash : null,
          crash_target: body.significant_crash === true ? body.crash_target : null,
          crash_details: body.significant_crash === true ? trimmed(body.crash_details, 500) : null,
          // Robot status per shift (section_fields 4) also keeps its worst status as the single match status.
          teleop_robot_status: overallRobotStatus(body.robot_status_shifts) || body.teleop_robot_status || null,
          mechanical_break: typeof body.mechanical_break === 'boolean' ? body.mechanical_break : null
        }
      : {}),
    alliance: oneOf(body?.alliance, ['red', 'blue']),
    starting_position: oneOf(body?.starting_position, START_POSITIONS),
    auto_start_zone: oneOf(body?.auto_start_zone, AUTO_ZONES),
    // Keep the readable estimate for old consumers and store its parsed
    // values separately so analytics do not need to reverse-engineer text.
    auto_points_band: autoPoints?.input ?? null,
    auto_points_min: autoPoints?.min ?? null,
    auto_points_max: autoPoints?.max ?? null,
    auto_points_average: autoPoints?.average ?? null,
    auto_finish: trimmed(body?.auto_finish, 120),
    auto_moved: trimmed(body?.auto_moved, 40),
    ball_sources: normalizeStringList(body?.ball_sources, currentForm ? AUTO_FUEL_SOURCES : BALL_SOURCES),
    // Same shape as auto points: the readable bucket plus its parsed bounds,
    // so analytics never has to re-parse text. "500+" has no max, and its
    // average is the lower bound rather than an invented midpoint.
    balls_scored_band: balls?.input ?? null,
    balls_scored_min: balls?.min ?? null,
    balls_scored_max: balls?.max ?? null,
    balls_scored_average: balls?.average ?? null,
    auto_collision: body?.auto_collision === true,
    auto_collision_notes: trimmed(body?.auto_collision_notes, 500),
    // The BPS slider's exact reading also fills the older 1-5 BPS bucket that analytics read.
    ratings: normalizeRatings(
      bpsOrNull(body?.bps) == null ? body?.ratings : { ...body?.ratings, BPS: bpsBucket(bpsOrNull(body.bps)) }
    ),
    teleop_roles: normalizeStringList(body?.teleop_roles, currentForm ? MATCH_FORM_ROLES : TELEOP_ROLES),
    teleop_notes: trimmed(body?.teleop_notes),
    // Unrated arrives as null, and Number(null) is 0, which would clamp to a real (slowest) rating of 1.
    intake_speed:
      body?.intake_speed != null && body.intake_speed !== '' && Number.isFinite(Number(body.intake_speed))
        ? Math.min(3, Math.max(1, Math.round(Number(body.intake_speed))))
        : null,
    intake_jammed: body?.intake_jammed === true,
    crash_or_break: currentForm
      ? body.mechanical_break === true || body.significant_crash === true
      : body?.crash_or_break === true,
    robot_disabled:
      currentForm && (body.teleop_robot_status === 'dead' || overallRobotStatus(body.robot_status_shifts) === 'dead')
        ? 'died'
        : oneOf(body?.robot_disabled, DISABLED_STATES),
    card: oneOf(body?.card, CARDS),
    beached: body?.beached === true,
    // Unanswered stays empty: Number(null) is 0, which would read as a real (worst) rating.
    driver_skill:
      body?.driver_skill != null && body.driver_skill !== '' && Number.isFinite(driverSkillRaw)
        ? Math.min(5, Math.max(0, Math.round(driverSkillRaw)))
        : null,
    post_notes: trimmed(body?.post_notes),
    // Shuttling, Performance and Robot sections. Only sent by the current form; all optional.
    ...(currentForm && body.section_fields >= 2 ? sectionFields(body) : {}),
    created_by: actorId,
    updated_at: new Date().toISOString()
  };
  return { value: currentForm ? withoutOtherKindFields(value) : value, error: null };
}

/**
 * A match scout flagging a mechanical problem for the pit crew. Severity is
 * derived from what was observed rather than trusted from the client: a robot
 * that died or was disabled is urgent regardless of what the form sent.
 */
export function normalizePitProblemReport(body, actorId = null) {
  const event_key = trimmed(body?.event_key, 60);
  const team_key = normalizeTeamKey(body?.team_key);
  if (!event_key) return { value: null, error: 'event_key is required' };
  if (!team_key) return { value: null, error: 'A valid team_key is required (e.g. frc254)' };

  const summary = trimmed(body?.summary, MAX_SUMMARY_LENGTH) || 'Mechanical issue flagged after match';
  const observedUrgent = ['died', 'disabled'].includes(String(body?.robot_disabled || '').trim());
  const requested = oneOf(body?.severity, SEVERITIES);

  return {
    value: {
      event_key,
      team_key,
      // Canonical when it can be read; a pit crew note about "practice field" keeps its text.
      match_key: canonicalMatchKey(body?.match_key, event_key) || trimmed(body?.match_key, 60),
      match_label: trimmed(body?.match_key, 120),
      source: trimmed(body?.source, 60) || 'Match scout',
      summary,
      detail: trimmed(body?.detail),
      severity: observedUrgent ? 'urgent' : requested || 'watch',
      resolved: false,
      created_by: actorId
    },
    error: null
  };
}

/** The Shuttling, Performance and Robot answers, cleaned. Every one is optional. */
export function sectionFields(body) {
  const shuttled = typeof body?.shuttled === 'boolean' ? body.shuttled : null;
  const shuttle = shuttled ? parseAutoPointsEstimate(body?.shuttle_band) : null;
  return {
    shuttled,
    shuttle_band: shuttle?.input ?? null,
    shuttle_min: shuttle?.min ?? null,
    shuttle_max: shuttle?.max ?? null,
    shuttle_average: shuttle?.average ?? null,
    shuttle_rating: shuttled ? ratingOrNull(body?.shuttle_rating) : null,
    shuttle_notes: shuttled ? trimmed(body?.shuttle_notes, 2000) : null,
    offense_rating: ratingOrNull(body?.offense_rating),
    defense_rating: ratingOrNull(body?.defense_rating),
    performance_notes: trimmed(body?.performance_notes),
    power_ranking: normalizePowerRanking(body?.power_ranking),
    fouls_minor: countOrNull(body?.fouls_minor),
    fouls_major: countOrNull(body?.fouls_major),
    break_details: trimmed(body?.break_details, 2000),
    break_impact: trimmed(body?.break_impact, 2000),
    break_response: trimmed(body?.break_response, 2000),
    // section_fields 4.
    defense: body?.teleop_roles?.includes?.('Defense') ? normalizeDefense(body?.defense) : null,
    bps: bpsOrNull(body?.bps),
    robot_status_shifts: shiftStatuses(body?.robot_status_shifts),
    foul_nature: oneOf(body?.foul_nature, FOUL_NATURES),
    foul_details: trimmed(body?.foul_details, 2000)
  };
}

function bpsOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= BPS_SLIDER_MAX ? Math.round(number * 10) / 10 : null;
}

/** { shift1: 'active', ..., endgame: 'dead' } with only known shifts and statuses; null when none were given. */
export function shiftStatuses(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const shifts = Object.fromEntries(
    MATCH_SHIFT_KEYS.filter((key) => ROBOT_SHIFT_STATUSES.includes(value[key])).map((key) => [key, value[key]])
  );
  return Object.keys(shifts).length ? shifts : null;
}
