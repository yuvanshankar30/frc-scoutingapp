// The Pit Scout form: its choices, limits and the rules for reading an answer back. Shared by the
// page, its API (which validates with the same lists) and Scouting Admin's coverage counts, so a
// choice added here shows up, saves and counts everywhere at once.

export const DRIVEBASE_OPTIONS = ['Mechanum', 'Swerve', 'Tank', 'Other'];
export const SHOOTER_OPTIONS = ['Single Fixed', 'Multi Fixed', 'Wide', 'Turret', 'Double Turret', 'Other'];
export const HOPPER_OPTIONS = ['Spindexer', 'Dye Rotor', 'Belted', 'Floor roller', 'Passive roller', 'Other'];
export const NO_CLIMB_OPTION = 'No Climb';
export const CLIMB_OPTIONS = [NO_CLIMB_OPTION, 'L1 Auto', 'L1', 'L2', 'L3'];

export const MAX_AUTO_OPTIONS = 8;
export const MAX_AUTO_NAME_LENGTH = 60;
export const MAX_AUTO_DESCRIPTION_LENGTH = 220;
export const MAX_AUTO_PATH_POINTS = 500;
export const MAX_BREAKING_COMPONENT_LENGTH = 240;

export const YES_NO_OPTIONS = ['Yes', 'No'];
export const TRENCH_OR_BUMP_OPTIONS = ['Trench', 'Bump', 'Both', 'Neither'];
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
  encoder_types: ENCODER_TYPE_OPTIONS
};
// Free text, with its longest allowed length.
export const TECHNICAL_TEXT_FIELDS = {
  mostly_used_wire_gauge: 80,
  drivebase_tube_thickness: 80,
  roller_hub_material: 80,
  software_other: 240,
  pit_contact_phone: 80,
  intake_style: 80
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
  can_bus_count: { integer: true },
  hopper_capacity: {},
  electrical_rating: RATING,
  drivebase_rating: RATING,
  overall_reliability_rating: RATING
};

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
