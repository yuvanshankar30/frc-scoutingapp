// The Pit Scout form: its choices, limits and the rules for reading an answer back. Shared by the
// page, its API (which validates with the same lists) and Scouting Admin's coverage counts, so a
// choice added here shows up, saves and counts everywhere at once.

export const DRIVEBASE_OPTIONS = ['Mechanum', 'Swerve', 'Tank', 'Other'];
// "No Shooter" / "No Indexer" for robots without one (e.g. a pure defense or shuttle bot), so a blank still means
// "not asked yet".
export const SHOOTER_OPTIONS = [
  'No Shooter',
  'Single Fixed',
  'Multi Fixed',
  'Wide',
  'Turret',
  'Double Turret',
  'Other'
];
export const HOPPER_OPTIONS = [
  'No Indexer',
  'Spindexer',
  'Dye Rotor',
  'Belted',
  'Floor roller',
  'Passive roller',
  'Other'
];
export const NO_CLIMB_OPTION = 'No Climb';
export const CLIMB_OPTIONS = [NO_CLIMB_OPTION, 'L1 Auto', 'L1', 'L2', 'L3'];

export const MAX_AUTO_OPTIONS = 8;
export const MAX_AUTO_NAME_LENGTH = 60;
export const MAX_AUTO_DESCRIPTION_LENGTH = 220;
export const MAX_AUTO_PATH_POINTS = 500;
export const MAX_BREAKING_COMPONENT_LENGTH = 240;
// The drivebase is one described answer now (e.g. "Swerve, MK5n modules"), not a fixed list.
export const MAX_DRIVEBASE_LENGTH = 120;

export const YES_NO_OPTIONS = ['Yes', 'No'];
export const MAX_ROBOT_WEIGHT_LENGTH = 40;
// No "Neither": every robot has to get between the zones one way or the other.
export const TRENCH_OR_BUMP_OPTIONS = ['Trench', 'Bump', 'Both'];
export const MAIN_BREAKER_OPTIONS = ['Bussmann', 'OptiFuse', 'Other'];
export const SB_CONNECTOR_OPTIONS = ['SB60', 'SB40', 'Other'];
export const WIRE_INSULATION_OPTIONS = ['Silicone', 'Other'];
export const ELECTRICAL_CONNECTOR_OPTIONS = [
  'Molex SL CAN',
  'WAGO CAN',
  'WAGO Power',
  'Anderson Power',
  'Ring Terminal Power',
  'Ring Terminal CAN',
  'Non-locking CAN',
  'WCP Powerpole Board',
  'Custom Powerpole Board',
  'Custom PCBs',
  'Other'
];
export const BATTERY_OPTIONS = ['Energizer', 'Duracell', 'MK Battery', 'Other'];
export const MOTOR_CONTROLLER_OPTIONS = ['Talon FX', 'Victor SPX', 'Spark MAX', 'Redux', 'Thrifty'];
export const MOTOR_TYPE_OPTIONS = ['X60', 'X44', '550', 'Vortex', 'Thrifty', 'CIM'];
export const AUTO_TOOL_OPTIONS = ['Bline', 'PathPlanner', 'Choreo', 'Custom'];
export const VISION_OPTIONS = ['PhotonVision', 'Limelight', 'Custom'];
export const COPROCESSOR_OPTIONS = ['Orin', 'Limelight', 'Orange Pi', 'Raspberry Pi', 'Mac Mini', 'Other'];
export const PROGRAMMING_LANGUAGE_OPTIONS = ['Java', 'C++', 'Python'];
export const GRIP_TAPE_OPTIONS = ['Cat Tongue', 'Silicone', 'Other'];
export const SWERVE_MODULE_OPTIONS = [
  'MK5n',
  'MK5i',
  'MK4i',
  'MK4n',
  'MK4',
  'WCP X2i',
  'X2t',
  'X2c',
  'X2',
  'ThriftySwerve',
  'Other'
];
export const HOPPER_WALL_OPTIONS = ['Reinforced Corners', 'Polycarbonate Flanges', 'Other'];
export const BUMPER_FOAM_OPTIONS = ['Pool Noodle', 'EVA', 'XPE', 'Other'];
export const HARDWARE_STANDARD_OPTIONS = ['E-clip', 'Metric Fasteners', 'Metric Bearings'];
export const ENCODER_TYPE_OPTIONS = ['PWM', 'CAN Through Bore', 'Other'];
// The jobs a team would rather do in a match, as they describe it in the pit.
export const PREFERRED_ROLE_OPTIONS = ['Shooter', 'Shuttler', 'Defense', 'Collector', 'Climber', 'Flexible'];
export const MAX_STRENGTHS_LENGTH = 500;
export const MAX_WEAKNESSES_LENGTH = 500;

// The abilities a pit scout used to rate 1-10 (V4.41.0 to V4.45.0), and how much each counted toward the weighted
// pit score. The form no longer asks for them; Team View still shows the ratings older reports saved.
// Shooting decides most matches, so it weighs the most; reliability and auto come next because a
// robot that dies or skips auto costs the alliance more than one that is a weak defender.
export const PIT_ABILITIES = Object.freeze([
  { key: 'ability_shooting', label: 'Shooting', weight: 3 },
  { key: 'ability_auto', label: 'Auto', weight: 2 },
  // Same key as the old Extra > Ratings question, so Power Rankings and the picklist keep reading one reliability answer.
  { key: 'overall_reliability_rating', label: 'Reliability', weight: 2 },
  { key: 'ability_climbing', label: 'Climbing', weight: 1.5 },
  { key: 'ability_intake', label: 'Intake', weight: 1.5 },
  { key: 'ability_driving', label: 'Driving', weight: 1.5 },
  { key: 'ability_shuttling', label: 'Shuttling', weight: 1 },
  { key: 'ability_defense', label: 'Defense', weight: 1 }
]);

// Technical details, by kind of answer.
export const TECHNICAL_SINGLE_OPTIONS = {
  use_net: YES_NO_OPTIONS,
  main_breaker_brand: MAIN_BREAKER_OPTIONS,
  sb_connector: SB_CONNECTOR_OPTIONS,
  main_breaker_shroud: YES_NO_OPTIONS,
  wire_insulation: WIRE_INSULATION_OPTIONS,
  battery_type: BATTERY_OPTIONS,
  ground_intake_kicker: YES_NO_OPTIONS,
  uses_canivore: YES_NO_OPTIONS,
  coprocessor: COPROCESSOR_OPTIONS,
  uses_wpilib: YES_NO_OPTIONS,
  grip_tape: GRIP_TAPE_OPTIONS,
  swerve_module: SWERVE_MODULE_OPTIONS,
  hopper_wall_reinforcement: HOPPER_WALL_OPTIONS,
  fits_under_trench: YES_NO_OPTIONS,
  drives_over_mound: YES_NO_OPTIONS,
  trench_or_bump: TRENCH_OR_BUMP_OPTIONS,
  bumper_foam: BUMPER_FOAM_OPTIONS,
  printed_roller_hubs: YES_NO_OPTIONS
};
export const TECHNICAL_MULTI_OPTIONS = {
  electrical_connectors: ELECTRICAL_CONNECTOR_OPTIONS,
  motor_controllers: MOTOR_CONTROLLER_OPTIONS,
  motor_types: MOTOR_TYPE_OPTIONS,
  auto_tools: AUTO_TOOL_OPTIONS,
  vision: VISION_OPTIONS,
  programming_language: PROGRAMMING_LANGUAGE_OPTIONS,
  hardware_standards: HARDWARE_STANDARD_OPTIONS,
  encoder_types: ENCODER_TYPE_OPTIONS,
  preferred_roles: PREFERRED_ROLE_OPTIONS
};
// Free text, with its longest allowed length.
export const TECHNICAL_TEXT_FIELDS = {
  mostly_used_wire_gauge: 80,
  drivebase_tube_thickness: 80,
  roller_hub_material: 80,
  software_other: 240,
  pit_contact_phone: 80,
  // Kept apart from pit_contact_phone (the pit crew's number, asked since V4.8.0) so older answers never pose as a strat contact.
  strat_phone: 80,
  intake_style: 80,
  // Free response, without bumpers and battery, e.g. "112 lb".
  robot_weight: MAX_ROBOT_WEIGHT_LENGTH,
  // Free response. canivore_count replaces the old yes/no "Uses CANivore?" (kept for older reports); can_bus_count
  // was a number before V4.46.0, and older numbers read back as text.
  canivore_count: 40,
  can_bus_count: 40,
  strengths: MAX_STRENGTHS_LENGTH,
  weaknesses: MAX_WEAKNESSES_LENGTH
};
// Numbers, with their allowed range.
const RATING = { min: 1, max: 10, integer: true };
export const TECHNICAL_NUMBER_FIELDS = {
  ground_roller_motor_count: { integer: true },
  bumper_length: {},
  bumper_width: {},
  bumper_height: {},
  drivetrain_length: {},
  drivetrain_width: {},
  drivetrain_height: {},
  hopper_capacity: {},
  electrical_rating: RATING,
  drivebase_rating: RATING,
  overall_reliability_rating: RATING,
  ...Object.fromEntries(PIT_ABILITIES.map((ability) => [ability.key, RATING]))
};

/**
 * The weighted pit score: the weighted average of the abilities that were rated, out of 10 (one
 * decimal), or null when none were. Unrated abilities are left out rather than counted as zero, so a
 * half-finished report isn't dragged down by questions nobody asked yet.
 */
export function weightedAbilityScore(details) {
  let total = 0;
  let weights = 0;
  let rated = 0;
  for (const ability of PIT_ABILITIES) {
    const value = normalizeTechnicalNumber(details?.[ability.key], RATING, null);
    if (value === null) continue;
    total += value * ability.weight;
    weights += ability.weight;
    rated += 1;
  }
  return {
    score: weights ? Math.round((total / weights) * 10) / 10 : null,
    rated,
    total: PIT_ABILITIES.length
  };
}

/** A phone answer as a tel:/sms: target: digits and a leading + only. */
export function dialablePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

export const PIT_STATUS = Object.freeze({
  pending: { label: 'Pending', className: 'status-pending', sort: 0 },
  needs_photo: { label: 'Needs photo', className: 'status-needs-photo', sort: 1 },
  completed: { label: 'Completed', className: 'status-complete', sort: 2 }
});

/** An empty answer for every technical detail ('' for choices and text, [] for lists, `emptyNumber` for numbers). */
export function emptyTechnicalDetails({ emptyNumber = undefined } = {}) {
  return {
    ...Object.fromEntries(Object.keys(TECHNICAL_SINGLE_OPTIONS).map((field) => [field, ''])),
    ...Object.fromEntries(Object.keys(TECHNICAL_MULTI_OPTIONS).map((field) => [field, []])),
    ...Object.fromEntries(Object.keys(TECHNICAL_TEXT_FIELDS).map((field) => [field, ''])),
    ...Object.fromEntries(Object.keys(TECHNICAL_NUMBER_FIELDS).map((field) => [field, emptyNumber]))
  };
}

/** A number in range, rounded (whole numbers when `integer`), or `empty`. */
export function normalizeTechnicalNumber(value, { min = 0, max = null, integer = false } = {}, empty = undefined) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) return empty;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || (max !== null && parsed > max)) return empty;
  return integer ? Math.round(parsed) : Math.round(parsed * 1000) / 1000;
}

/** Every technical detail cleaned: only listed choices, trimmed and capped text, numbers in range. */
export function normalizeTechnicalDetails(input, { emptyNumber = undefined } = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clean = emptyTechnicalDetails({ emptyNumber });
  for (const [field, options] of Object.entries(TECHNICAL_SINGLE_OPTIONS)) {
    const value = String(source[field] || '').trim();
    clean[field] = options.includes(value) ? value : '';
  }
  for (const [field, options] of Object.entries(TECHNICAL_MULTI_OPTIONS)) {
    const selected = new Set(
      Array.isArray(source[field]) ? source[field].map((value) => String(value || '').trim()) : []
    );
    clean[field] = options.filter((option) => selected.has(option));
  }
  for (const [field, max] of Object.entries(TECHNICAL_TEXT_FIELDS)) {
    clean[field] = String(source[field] || '')
      .trim()
      .slice(0, max);
  }
  for (const [field, range] of Object.entries(TECHNICAL_NUMBER_FIELDS)) {
    clean[field] = normalizeTechnicalNumber(source[field], range, emptyNumber);
  }
  return clean;
}

/** The climbs a robot can do, in list order; "No Climb" on its own when it was picked. */
export function normalizeClimbOptions(input) {
  if (!Array.isArray(input)) return [];
  const selected = new Set(
    input.map((option) => String(option || '').trim()).filter((option) => CLIMB_OPTIONS.includes(option))
  );
  if (selected.has(NO_CLIMB_OPTION)) return [NO_CLIMB_OPTION];
  return CLIMB_OPTIONS.filter((option) => option !== NO_CLIMB_OPTION && selected.has(option));
}

/** A drawn auto path: up to 500 points, each clamped to the 0-100 field box. */
export function normalizeAutoPath(path) {
  if (!Array.isArray(path)) return [];
  return path.slice(0, MAX_AUTO_PATH_POINTS).flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const x = Number(point[0]);
    const y = Number(point[1]);
    return Number.isFinite(x) && Number.isFinite(y)
      ? [[Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))]]
      : [];
  });
}

/** Up to eight autos with trimmed names and descriptions and clean paths (blank ones kept, for editing). */
export function normalizeAutoOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_AUTO_OPTIONS).map((option) => ({
    name: String(option?.name || '')
      .trim()
      .slice(0, MAX_AUTO_NAME_LENGTH),
    description: String(option?.description || '')
      .trim()
      .slice(0, MAX_AUTO_DESCRIPTION_LENGTH),
    path: normalizeAutoPath(option?.path)
  }));
}

export const filledAutoOptions = (input) =>
  normalizeAutoOptions(input).filter((option) => option.name || option.description);

export const normalizeLikelyBreakingComponent = (value) =>
  String(value || '')
    .trim()
    .slice(0, MAX_BREAKING_COMPONENT_LENGTH);

export const hasEstimatedBps = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));

/** True once a pit report has any answer at all. */
export function hasAnyPitData(entry) {
  if (!entry) return false;
  const technicalDetails =
    entry.technical_details && typeof entry.technical_details === 'object' && !Array.isArray(entry.technical_details)
      ? entry.technical_details
      : {};
  return Boolean(
    String(entry.drivebase_type || '').trim() ||
    String(entry.shooter_type || '').trim() ||
    String(entry.hopper_type || '').trim() ||
    String(entry.human_player_balls_in_auto || '').trim() ||
    String(entry.robot_archetype || '').trim() ||
    String(entry.additional_notes || '').trim() ||
    normalizeLikelyBreakingComponent(entry.likely_breaking_component) ||
    hasEstimatedBps(entry.estimated_bps) ||
    normalizeClimbOptions(entry.climb_options).length ||
    filledAutoOptions(entry.auto_options).length ||
    Object.values(technicalDetails).some((value) =>
      Array.isArray(value) ? value.filter(Boolean).length : value !== '' && value !== null && value !== undefined
    )
  );
}

/** 'pending' (nothing yet), 'needs_photo' (answers but no photo) or 'completed'. */
export function pitScoutStatus(entry) {
  if (!hasAnyPitData(entry)) return 'pending';
  const photoPaths = Array.isArray(entry?.photo_paths) ? entry.photo_paths.filter(Boolean) : [];
  return photoPaths.length ? 'completed' : 'needs_photo';
}
