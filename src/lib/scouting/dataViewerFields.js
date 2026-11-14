// Data Viewer's field catalog: every answer a match or pit scouting report can hold, as one list of fields. Each
// field knows its form, the kind of match report that asks it, its section, what type of answer it is (which picks
// its chart) and how to read it from a saved report. Custom questions from the form designer are added from the
// form versions the reports were answered against, so a new question shows up without a code change.

import { FORM_TYPES, coreView } from './forms/formSchema.js';
import { MATCH_SHIFTS } from './matchScouting.js';
import {
  PIT_ABILITIES,
  TECHNICAL_MULTI_OPTIONS,
  TECHNICAL_NUMBER_FIELDS,
  TECHNICAL_SINGLE_OPTIONS,
  TECHNICAL_TEXT_FIELDS
} from './pitForm.js';

/** Answer types. Each one has its own chart and summary. */
export const FIELD_TYPES = Object.freeze(['number', 'rating', 'yesno', 'choice', 'multi', 'text']);

const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const number = (value) => {
  if (!present(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const rating = (value) => {
  const parsed = number(value);
  return parsed && parsed > 0 ? parsed : null;
};
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : null);
const text = (value) => (present(value) ? String(value).trim() : null);
/** "right trench" -> "Right trench", "did-not-run" -> "Did not run". */
export const words = (value) => {
  if (!present(value)) return null;
  const spaced = String(value).trim().replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const list = (value) => {
  const items = Array.isArray(value) ? [...new Set(value.map(words).filter(Boolean))] : [];
  return items.length ? items : null;
};
const team = (key) => String(key || '').replace(/^frc/i, '');
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const STATUS = { active: 'Active', dead: 'Dead', stopped: 'Stopped', brownout: 'Brownout', unknown: 'Unknown' };
const AUTO_RAN = { ran: 'Ran', 'did-not-run': "Didn't run", true: 'Ran', false: "Didn't run" };
const CARD = { '': 'None', none: 'None', yellow: 'Yellow', red: 'Red' };
const DEFENSE_PERIODS = { active: 'Hub active', inactive: 'Hub inactive' };
const SHIFT_NAMES = Object.fromEntries(MATCH_SHIFTS.map((shift) => [shift.key, shift.label]));

/** The kind a match report belongs to; reports from before the three-way split count as Data. */
export const reportKind = (record) =>
  ['performance', 'robot'].includes(record?.report_kind) ? record.report_kind : 'data';
// Reports from before the split (no kind, or an older form version) asked every question on one form.
const combinedForm = (record) => !record?.report_kind || record?.form_version !== 2;

const sectionLabel = (form, id) => FORM_TYPES[form]?.sections.find((section) => section.id === id)?.label || words(id);

/** Every built-in match scouting field, in the order a scout answers them. */
const MATCH_FIELDS = [
  // Asked on every kind of report.
  {
    id: 'robot_present',
    section: 'prematch',
    label: 'Robot showed up',
    type: 'yesno',
    read: (r) => yesNo(r.robot_present !== false)
  },
  { id: 'preload', kind: 'data', section: 'prematch', label: 'Preload', type: 'yesno', read: (r) => yesNo(r.preload) },
  {
    id: 'starting_position',
    kind: 'data',
    section: 'prematch',
    label: 'Starting position',
    type: 'choice',
    read: (r) => words(r.starting_position)
  },

  {
    id: 'auto_moved',
    kind: 'data',
    section: 'auto',
    label: 'Autonomous',
    type: 'choice',
    read: (r) => AUTO_RAN[String(r.auto_moved)] ?? words(r.auto_moved)
  },
  {
    id: 'auto_points',
    kind: 'data',
    section: 'auto',
    label: 'Auto points (estimate)',
    type: 'number',
    read: (r) => number(r.auto_points_average),
    shown: (r) => text(r.auto_points_band)
  },
  {
    id: 'ball_sources',
    kind: 'data',
    section: 'auto',
    label: 'Fuel picked up from',
    type: 'multi',
    read: (r) => list(r.ball_sources)
  },
  {
    id: 'auto_cycles',
    kind: 'data',
    section: 'auto',
    label: 'Auto cycles',
    type: 'number',
    read: (r) => number(r.auto_cycles)
  },

  {
    id: 'teleop_roles',
    kind: 'data',
    section: 'teleop',
    label: 'Teleop roles',
    type: 'multi',
    read: (r) => list(r.teleop_roles) ?? (r.teleop_roles_none ? ['None seen'] : null)
  },
  {
    id: 'balls_scored',
    kind: 'data',
    section: 'teleop',
    label: 'Balls scored (estimate)',
    type: 'number',
    read: (r) => number(r.balls_scored_average),
    shown: (r) => text(r.balls_scored_band)
  },
  {
    id: 'defense_targets',
    kind: 'data',
    section: 'teleop',
    label: 'Defended against',
    type: 'multi',
    read: (r) => (r.defense?.targets?.length ? r.defense.targets.map(team) : null)
  },
  {
    id: 'defense_periods',
    kind: 'data',
    section: 'teleop',
    label: 'Defended while',
    type: 'multi',
    read: (r) => (r.defense?.periods?.length ? r.defense.periods.map((p) => DEFENSE_PERIODS[p] ?? words(p)) : null)
  },
  {
    id: 'defense_shifts',
    kind: 'data',
    section: 'teleop',
    label: 'Defense shifts',
    type: 'multi',
    read: (r) => (r.defense?.shifts?.length ? r.defense.shifts.map((key) => SHIFT_NAMES[key] ?? words(key)) : null)
  },
  {
    id: 'defense_effectiveness',
    kind: 'data',
    section: 'teleop',
    label: 'Defense effectiveness',
    type: 'rating',
    max: 10,
    read: (r) => rating(r.defense?.effectiveness)
  },
  {
    id: 'teleop_notes',
    kind: 'data',
    section: 'teleop',
    label: 'Teleop notes',
    type: 'text',
    read: (r) => text(r.teleop_notes)
  },

  {
    id: 'shuttled',
    kind: 'data',
    section: 'shuttling',
    label: 'Shuttled',
    type: 'yesno',
    read: (r) => yesNo(r.shuttled)
  },
  {
    id: 'shuttle_amount',
    kind: 'data',
    section: 'shuttling',
    label: 'Balls shuttled (estimate)',
    type: 'number',
    read: (r) => number(r.shuttle_average),
    shown: (r) => text(r.shuttle_band)
  },
  {
    id: 'shuttle_rating',
    kind: 'data',
    section: 'shuttling',
    label: 'Shuttling rating',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.shuttle_rating)
  },
  {
    id: 'shuttle_notes',
    kind: 'data',
    section: 'shuttling',
    label: 'Shuttling notes',
    type: 'text',
    read: (r) => text(r.shuttle_notes)
  },

  {
    id: 'shot_accuracy',
    kind: 'performance',
    section: 'performance',
    label: 'Shot accuracy',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.ratings?.['Shot accuracy'])
  },
  {
    id: 'bps_slider',
    kind: 'performance',
    section: 'performance',
    label: 'Balls per second',
    type: 'number',
    read: (r) => number(r.bps)
  },
  {
    id: 'bps_rating',
    kind: 'performance',
    section: 'performance',
    label: 'BPS rating',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.ratings?.BPS)
  },
  {
    id: 'driver_awareness',
    kind: 'performance',
    section: 'performance',
    label: 'Driver awareness',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.ratings?.['Driver awareness'])
  },
  {
    id: 'reliability',
    kind: 'performance',
    section: 'performance',
    label: 'Reliability',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.ratings?.Reliability)
  },
  {
    id: 'offense_rating',
    kind: 'performance',
    section: 'performance',
    label: 'Offense',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.offense_rating)
  },
  {
    id: 'defense_rating',
    kind: 'performance',
    section: 'performance',
    label: 'Defense',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.defense_rating ?? r.ratings?.Defense)
  },
  {
    id: 'driver_skill',
    kind: 'performance',
    section: 'performance',
    label: 'Driver skill',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.driver_skill)
  },
  {
    id: 'intake_speed',
    kind: 'performance',
    section: 'performance',
    label: 'Intake speed',
    type: 'rating',
    max: 5,
    read: (r) => rating(r.intake_speed)
  },
  {
    id: 'power_ranking',
    kind: 'performance',
    section: 'performance',
    label: 'Power ranking (best first)',
    type: 'text',
    read: (r) => powerRanking(r.power_ranking)
  },
  {
    id: 'performance_notes',
    kind: 'performance',
    section: 'performance',
    label: 'Performance notes',
    type: 'text',
    read: (r) => text(r.performance_notes)
  },

  {
    id: 'robot_status',
    kind: 'robot',
    section: 'robot',
    label: 'Robot status',
    type: 'choice',
    read: (r) => STATUS[r.teleop_robot_status] ?? words(r.teleop_robot_status)
  },
  {
    id: 'robot_status_shifts',
    kind: 'robot',
    section: 'robot',
    label: 'Robot status by shift',
    type: 'multi',
    read: (r) => shiftStatuses(r.robot_status_shifts)
  },
  {
    id: 'significant_crash',
    kind: 'robot',
    section: 'robot',
    label: 'Big crash',
    type: 'yesno',
    read: (r) => yesNo(r.significant_crash)
  },
  {
    id: 'crash_target',
    kind: 'robot',
    section: 'robot',
    label: 'Crashed into',
    type: 'choice',
    read: (r) => words(r.crash_target)
  },
  {
    id: 'crash_details',
    kind: 'robot',
    section: 'robot',
    label: 'Crash details',
    type: 'text',
    read: (r) => text(r.crash_details)
  },
  {
    id: 'auto_collision',
    kind: 'robot',
    section: 'robot',
    label: 'Auto collision',
    type: 'yesno',
    read: (r) => yesNo(r.auto_collision)
  },
  {
    id: 'auto_collision_notes',
    kind: 'robot',
    section: 'robot',
    label: 'Collision notes',
    type: 'text',
    read: (r) => text(r.auto_collision_notes)
  },
  {
    id: 'intake_jammed',
    kind: 'robot',
    section: 'robot',
    label: 'Intake jammed',
    type: 'yesno',
    read: (r) => yesNo(r.intake_jammed)
  },
  {
    id: 'mechanical_break',
    kind: 'robot',
    section: 'robot',
    label: 'Mechanical break',
    type: 'yesno',
    read: (r) => yesNo(r.mechanical_break)
  },
  { id: 'beached', kind: 'robot', section: 'robot', label: 'Beached', type: 'yesno', read: (r) => yesNo(r.beached) },
  {
    id: 'card',
    kind: 'robot',
    section: 'robot',
    label: 'Card',
    type: 'choice',
    read: (r) => CARD[String(r.card ?? '')] ?? words(r.card)
  },
  {
    id: 'fouls_minor',
    kind: 'robot',
    section: 'robot',
    label: 'Minor fouls',
    type: 'number',
    read: (r) => number(r.fouls_minor)
  },
  {
    id: 'fouls_major',
    kind: 'robot',
    section: 'robot',
    label: 'Major fouls',
    type: 'number',
    read: (r) => number(r.fouls_major)
  },
  {
    id: 'foul_nature',
    kind: 'robot',
    section: 'robot',
    label: 'Foul nature',
    type: 'choice',
    read: (r) => words(r.foul_nature)
  },
  {
    id: 'foul_details',
    kind: 'robot',
    section: 'robot',
    label: 'Foul details',
    type: 'text',
    read: (r) => text(r.foul_details)
  },
  {
    id: 'break_details',
    kind: 'robot',
    section: 'robot',
    label: 'What broke',
    type: 'text',
    read: (r) => text(r.break_details)
  },
  {
    id: 'break_impact',
    kind: 'robot',
    section: 'robot',
    label: 'Effect on the match',
    type: 'text',
    read: (r) => text(r.break_impact)
  },
  {
    id: 'break_response',
    kind: 'robot',
    section: 'robot',
    label: 'What the team did',
    type: 'text',
    read: (r) => text(r.break_response)
  },

  {
    id: 'post_notes',
    section: 'postmatch',
    label: 'Notes',
    type: 'text',
    read: (r) => text(r.post_notes) ?? text(r.notes)
  }
];

function powerRanking(value) {
  const places = Object.entries(object(value))
    .filter(([, place]) => number(place) !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  return places.length ? places.map(([key], index) => `${index + 1}. ${team(key)}`).join('   ') : null;
}

function shiftStatuses(value) {
  const shifts = MATCH_SHIFTS.filter((shift) => object(value)[shift.key]).map(
    (shift) => `${shift.label}: ${STATUS[value[shift.key]] ?? words(value[shift.key])}`
  );
  return shifts.length ? shifts : null;
}

// Pit scouting is one long form; the page groups its answers so a reader can find them.
const PIT_SECTIONS = Object.freeze([
  { id: 'robot', label: 'Robot' },
  { id: 'scoring', label: 'Scoring and auto' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'build', label: 'Build and electrical' },
  { id: 'software', label: 'Software' },
  { id: 'notes', label: 'Notes and contacts' }
]);

// Plainer names than the stored keys for the technical answers whose key doesn't read well on its own.
const TECHNICAL_LABELS = {
  use_net: 'Uses a net',
  sb_connector: 'SB connector',
  uses_canivore: 'Uses a CANivore',
  uses_wpilib: 'Uses WPILib',
  canivore_count: 'CANivores',
  can_bus_count: 'CAN buses',
  ground_roller_motor_count: 'Ground roller motors',
  strat_phone: 'Strategy contact phone',
  pit_contact_phone: 'Pit contact phone',
  overall_reliability_rating: 'Reliability rating',
  electrical_rating: 'Electrical rating',
  drivebase_rating: 'Drivebase rating',
  robot_weight: 'Robot weight',
  printed_roller_hubs: '3D-printed roller hubs'
};
const TECHNICAL_SECTIONS = {
  robot_weight: 'robot',
  fits_under_trench: 'robot',
  drives_over_mound: 'robot',
  trench_or_bump: 'robot',
  bumper_length: 'robot',
  bumper_width: 'robot',
  bumper_height: 'robot',
  drivetrain_length: 'robot',
  drivetrain_width: 'robot',
  drivetrain_height: 'robot',
  swerve_module: 'robot',
  hopper_capacity: 'scoring',
  ground_intake_kicker: 'scoring',
  intake_style: 'scoring',
  preferred_roles: 'scoring',
  auto_tools: 'software',
  vision: 'software',
  coprocessor: 'software',
  programming_language: 'software',
  uses_wpilib: 'software',
  software_other: 'software',
  encoder_types: 'software',
  strengths: 'notes',
  weaknesses: 'notes',
  strat_phone: 'notes',
  pit_contact_phone: 'notes'
};
const ABILITY_KEYS = new Set(PIT_ABILITIES.map((ability) => ability.key));
const technicalLabel = (key) =>
  TECHNICAL_LABELS[key] ?? PIT_ABILITIES.find((ability) => ability.key === key)?.label ?? words(key);
const technicalSection = (key) =>
  TECHNICAL_SECTIONS[key] ?? (ABILITY_KEYS.has(key) || /_rating$/.test(key) ? 'ratings' : 'build');
const detail = (key) => (r) => object(r.technical_details)[key];

function technicalFields() {
  const fields = [];
  for (const [key, options] of Object.entries(TECHNICAL_SINGLE_OPTIONS))
    fields.push({
      id: `tech_${key}`,
      label: technicalLabel(key),
      type: 'choice',
      options,
      read: (r) => text(detail(key)(r))
    });
  for (const [key, options] of Object.entries(TECHNICAL_MULTI_OPTIONS))
    fields.push({
      id: `tech_${key}`,
      label: technicalLabel(key),
      type: 'multi',
      options,
      read: (r) => list(detail(key)(r))
    });
  for (const key of Object.keys(TECHNICAL_TEXT_FIELDS))
    fields.push({ id: `tech_${key}`, label: technicalLabel(key), type: 'text', read: (r) => text(detail(key)(r)) });
  for (const [key, rule] of Object.entries(TECHNICAL_NUMBER_FIELDS))
    fields.push(
      rule.max
        ? {
            id: `tech_${key}`,
            label: technicalLabel(key),
            type: 'rating',
            max: rule.max,
            read: (r) => rating(detail(key)(r))
          }
        : { id: `tech_${key}`, label: technicalLabel(key), type: 'number', read: (r) => number(detail(key)(r)) }
    );
  return fields.map((field) => ({ ...field, section: technicalSection(field.id.slice(5)) }));
}

const autoNames = (value) => {
  const names = (Array.isArray(value) ? value : [])
    .map((item) => text(typeof item === 'object' ? item?.name || item?.label : item))
    .filter(Boolean);
  return names.length ? names : null;
};

/** Every built-in pit scouting field. */
const PIT_FIELDS = [
  { id: 'drivebase_type', section: 'robot', label: 'Drivetrain', type: 'choice', read: (r) => text(r.drivebase_type) },
  {
    id: 'robot_archetype',
    section: 'robot',
    label: 'Robot type',
    type: 'choice',
    read: (r) => text(r.robot_archetype)
  },
  {
    id: 'photos',
    section: 'robot',
    label: 'Photos taken',
    type: 'number',
    read: (r) => (Array.isArray(r.photo_paths) ? r.photo_paths.filter(Boolean).length : null)
  },
  { id: 'shooter_type', section: 'scoring', label: 'Shooter', type: 'choice', read: (r) => text(r.shooter_type) },
  { id: 'hopper_type', section: 'scoring', label: 'Hopper', type: 'choice', read: (r) => text(r.hopper_type) },
  {
    id: 'estimated_bps',
    section: 'scoring',
    label: 'Estimated balls per second',
    type: 'number',
    read: (r) => number(r.estimated_bps)
  },
  {
    id: 'auto_points_estimate',
    section: 'scoring',
    label: 'Auto points (pit)',
    type: 'text',
    read: (r) => text(r.auto_points_estimate)
  },
  {
    id: 'auto_options',
    section: 'scoring',
    label: 'Autos they can run',
    type: 'multi',
    read: (r) => autoNames(r.auto_options)
  },
  { id: 'climb_options', section: 'scoring', label: 'Climb', type: 'multi', read: (r) => list(r.climb_options) },
  {
    id: 'human_player_balls_in_auto',
    section: 'scoring',
    label: 'Human player balls in auto',
    type: 'choice',
    read: (r) => text(r.human_player_balls_in_auto)
  },
  {
    id: 'likely_breaking_component',
    section: 'notes',
    label: 'Most likely to break',
    type: 'text',
    read: (r) => text(r.likely_breaking_component)
  },
  ...technicalFields(),
  { id: 'additional_notes', section: 'notes', label: 'Notes', type: 'text', read: (r) => text(r.additional_notes) }
];

const withMeta = (form) => (field) => ({
  form,
  kind: null,
  custom: false,
  sectionLabel:
    form === 'pit'
      ? PIT_SECTIONS.find((section) => section.id === field.section)?.label
      : sectionLabel(form, field.section),
  ...field
});

export const BUILT_IN_FIELDS = Object.freeze({
  match: MATCH_FIELDS.map(withMeta('match')),
  pit: PIT_FIELDS.map(withMeta('pit'))
});

/** The sections of a form, in order, for the section filter. */
export function formSections(form) {
  if (form === 'pit') return PIT_SECTIONS.map((section) => ({ ...section }));
  return (FORM_TYPES.match?.sections || []).map((section) => ({ id: section.id, label: section.label }));
}

// How each designer question type reads as a Data Viewer field.
const CUSTOM_TYPES = {
  buttons: 'choice',
  mcq: 'choice',
  dropdown: 'choice',
  picture: 'choice',
  checkboxes: 'multi',
  yesno: 'yesno',
  rating: 'rating',
  counter: 'number',
  number: 'number',
  slider: 'number',
  text: 'text',
  frq: 'text',
  grid: 'multi'
};

/** A designer question as a field: option ids read back as their labels, grid answers as "Row: Option". */
export function customField(form, question) {
  const type = CUSTOM_TYPES[question?.type];
  if (!type || !question?.id) return null;
  const optionLabel = new Map((question.options || []).map((option) => [option.id, option.label || 'Option']));
  const rowLabel = new Map((question.rows || []).map((row) => [row.id, row.label || 'Row']));
  const answer = (r) => object(r.custom_answers)[question.id];
  const read = {
    choice: (r) => (present(answer(r)) ? (optionLabel.get(answer(r)) ?? null) : null),
    multi:
      question.type === 'grid'
        ? (r) => {
            const picked = Object.entries(object(answer(r)))
              .filter(([rowId, optionId]) => rowLabel.has(rowId) && optionLabel.has(optionId))
              .map(([rowId, optionId]) => `${rowLabel.get(rowId)}: ${optionLabel.get(optionId)}`);
            return picked.length ? picked : null;
          }
        : (r) => {
            const picked = (Array.isArray(answer(r)) ? answer(r) : []).map((id) => optionLabel.get(id)).filter(Boolean);
            return picked.length ? picked : null;
          },
    yesno: (r) => yesNo(answer(r)),
    rating: (r) => rating(answer(r)),
    number: (r) => number(answer(r)),
    text: (r) => text(answer(r))
  }[type];
  const sections = formSections(form);
  const section = form === 'pit' ? 'notes' : question.section;
  return {
    id: `custom_${question.id}`,
    form,
    custom: true,
    kinds: form === 'match' && question.kinds?.length ? [...question.kinds] : null,
    kind: null,
    section,
    sectionLabel: sections.find((entry) => entry.id === section)?.label || words(section),
    label: String(question.label || '').trim() || 'Added question',
    type,
    ...(type === 'rating' ? { max: question.max || 5 } : {}),
    ...(type === 'choice' && question.type !== 'grid'
      ? { options: (question.options || []).map((option) => option.label || 'Option') }
      : {}),
    read
  };
}

// The form block (Scouting Admin > Edit) each built-in field belongs to, so the Data Viewer follows the published form:
// a block an admin renamed gives its one field the new wording, and a hidden block's fields are marked hiddenOnForm.
export const BLOCK_FIELDS = {
  match: {
    'prematch.present': ['robot_present'],
    'prematch.preload': ['preload'],
    'prematch.start': ['starting_position'],
    'auto.ran': ['auto_moved'],
    'auto.points': ['auto_points'],
    'auto.sources': ['ball_sources'],
    'auto.cycles': ['auto_cycles'],
    'teleop.roles': ['teleop_roles'],
    'teleop.balls': ['balls_scored'],
    'teleop.defense': ['defense_targets', 'defense_periods', 'defense_shifts', 'defense_effectiveness'],
    'teleop.notes': ['teleop_notes'],
    'shuttling.shuttled': ['shuttled'],
    'shuttling.amount': ['shuttle_amount'],
    'shuttling.rating': ['shuttle_rating'],
    'shuttling.notes': ['shuttle_notes'],
    'teleop.ratings': [
      'shot_accuracy',
      'bps_rating',
      'driver_awareness',
      'reliability',
      'offense_rating',
      'defense_rating'
    ],
    'performance.bps': ['bps_slider'],
    'teleop.intake': ['intake_speed'],
    'performance.driver': ['driver_skill'],
    'performance.ranking': ['power_ranking'],
    'performance.notes': ['performance_notes'],
    'teleop.status': ['robot_status', 'robot_status_shifts'],
    'teleop.crash': ['significant_crash', 'crash_target', 'crash_details'],
    'auto.collision': ['auto_collision', 'auto_collision_notes'],
    'robot.intakeJammed': ['intake_jammed'],
    'postmatch.cards': ['card'],
    'robot.fouls': ['fouls_minor', 'fouls_major', 'foul_nature', 'foul_details'],
    'postmatch.break': ['mechanical_break'],
    'robot.breaks': ['break_details', 'break_impact', 'break_response'],
    'postmatch.beached': ['beached'],
    'postmatch.notes': ['post_notes']
  },
  pit: {
    'main.drivebase': ['drivebase_type'],
    'main.dimensions': [
      'tech_drivetrain_length',
      'tech_drivetrain_width',
      'tech_drivetrain_height',
      'tech_bumper_length',
      'tech_bumper_width',
      'tech_bumper_height'
    ],
    'main.weight': ['tech_robot_weight'],
    'main.trench': ['tech_trench_or_bump'],
    'main.shooter': ['shooter_type', 'hopper_type', 'tech_hopper_capacity'],
    'main.bps': ['estimated_bps'],
    'main.autos': ['auto_options'],
    'main.autoPoints': ['auto_points_estimate'],
    'main.roles': ['tech_preferred_roles'],
    'main.strengths': ['tech_strengths'],
    'main.weaknesses': ['tech_weaknesses', 'likely_breaking_component'],
    'main.breaker': [
      'tech_main_breaker_brand',
      'tech_main_breaker_shroud',
      'tech_canivore_count',
      'tech_can_bus_count'
    ],
    'main.controls': [
      'tech_coprocessor',
      'tech_uses_wpilib',
      'tech_auto_tools',
      'tech_vision',
      'tech_programming_language',
      'tech_software_other'
    ],
    'main.contact': ['tech_strat_phone'],
    'main.notes': ['additional_notes']
  }
};

/** Built-in fields as the published form words them: renamed one-field blocks, and hiddenOnForm for hidden blocks. */
export function followForm(form, fields, schema) {
  if (!schema) return fields;
  const blocks = new Map(
    (FORM_TYPES[form]?.sections || []).flatMap((section) => section.blocks.map((block) => [block.key, block]))
  );
  const byField = new Map();
  for (const [key, ids] of Object.entries(BLOCK_FIELDS[form] || {})) {
    const block = blocks.get(key);
    if (!block) continue;
    const view = coreView(schema, block);
    for (const id of ids) byField.set(id, { view, single: ids.length === 1 });
  }
  return fields.map((field) => {
    const entry = byField.get(field.id);
    if (!entry) return field;
    return {
      ...field,
      ...(entry.single && entry.view.renamed && entry.view.label ? { label: entry.view.label } : {}),
      ...(entry.view.hidden ? { hiddenOnForm: true } : {})
    };
  });
}

/**
 * Every field of a form: the built-in ones, then each added question once. `schemas` are the form versions the
 * reports used, newest first, so a question keeps its latest wording and a removed one still shows its old answers.
 */
export function fieldsFor(form, schemas = []) {
  const builtIn = followForm(form, BUILT_IN_FIELDS[form] || [], schemas[0]);
  const seen = new Set();
  const custom = [];
  for (const schema of schemas) {
    for (const question of schema?.questions || []) {
      if (seen.has(question.id)) continue;
      seen.add(question.id);
      const field = customField(form, question);
      if (field) custom.push(field);
    }
  }
  // Added questions sit at the end of their section, after the built-in ones.
  const order = formSections(form).map((section) => section.id);
  const at = (field) => {
    const index = order.indexOf(field.section);
    return index === -1 ? order.length : index;
  };
  return [...builtIn, ...custom]
    .map((field, index) => ({ field, index }))
    .sort((a, b) => at(a.field) - at(b.field) || a.index - b.index)
    .map(({ field }) => field);
}

/** Whether a report asked this field: robot-only questions are not answers on a Data report, and so on. */
export function fieldApplies(field, record) {
  if (field.form !== 'match') return true;
  const kind = reportKind(record);
  if (field.kinds) return field.kinds.includes(kind) || combinedForm(record);
  if (!field.kind) return true;
  return field.kind === kind || combinedForm(record);
}

/** The field's value on this report, or null when it wasn't asked or wasn't answered. */
export function readField(field, record) {
  if (!fieldApplies(field, record)) return null;
  const value = field.read(record);
  return Array.isArray(value) ? (value.length ? value : null) : present(value) ? value : null;
}

/** The value as a person reads it: lists joined, numbers as typed (or the range the scout entered). */
export function displayValue(field, record) {
  const value = readField(field, record);
  if (value === null) return null;
  if (field.shown) return field.shown(record) ?? String(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
