// Editable scouting forms. A form is an ordered list of questions an admin added on top of the
// built-in ("core") questions, each placed in one of the form's sections. The built-in questions
// feed analytics and the saved-report columns, so they stay fixed and are only listed in the editor.
// Answers are stored by question id; the form version they were answered against is stored with them,
// so an old report can always be read against the questions it was answered with.

// The built-in questions are grouped into blocks that the editor can reword, reorder and (when nothing
// depends on them) hide. `optional: false` means the saved report or its analytics need the answer, so the block
// can be moved and reworded but not hidden. `help: null` means the block has no help text to edit.
const block = (key, label, { help = null, optional = true, rename = true, note = '' } = {}) => ({
  key,
  label,
  help,
  optional,
  rename,
  note
});

export const FORM_TYPES = Object.freeze({
  match: {
    label: 'Match scouting',
    sections: [
      {
        id: 'prematch',
        label: 'Pre-match',
        blocks: [
          block('prematch.assignment', 'Match, robot and alliance', {
            optional: false,
            rename: false,
            note: 'Scout name, match number, robot number and alliance. Every report needs these.'
          }),
          block('prematch.preload', 'Preload', { optional: false, note: 'Whether the robot started with a preload.' }),
          block('prematch.start', 'Starting position', {
            optional: false,
            help: 'Your alliance wall is on the left. Highlights indicate starting lanes, not exact robot locations.',
            note: 'Which of the five starting lanes the robot used.'
          })
        ]
      },
      {
        id: 'auto',
        label: 'Auto',
        blocks: [
          block('auto.ran', 'Did autonomous run?'),
          block('auto.points', 'Estimated points scored', {
            help: 'Drag to estimate, or type an exact number, a range such as 40-60, or a lower bound such as 100+. Optional.'
          }),
          block('auto.sources', 'Where did the robot collect fuel?', {
            help: 'Select every location observed during autonomous.'
          }),
          block('auto.cycles', 'Autonomous cycles')
        ]
      },
      {
        id: 'teleop',
        label: 'Teleop',
        blocks: [
          block('teleop.roles', 'Observed roles', {
            optional: false,
            help: 'Select every role this robot meaningfully performed.',
            note: 'Scorer, Defense or Shuttler. Used by Power Rankings.'
          }),
          block('teleop.balls', 'Balls scored', {
            optional: false,
            help: 'Pick a suggested range from the list or type a number, a range or a lower bound, like 137, 100-150 or 500+.',
            note: 'The scoring estimate every analytics page uses.'
          }),
          block('teleop.notes', 'Real-scout observations')
        ]
      },
      {
        id: 'shuttling',
        label: 'Shuttling',
        blocks: [
          block('shuttling.shuttled', 'Did the robot shuttle fuel?', {
            help: 'Shuttling is moving fuel toward your alliance zone without scoring it, by driving it, pushing it or launching it.',
            note: 'Yes or no; the other shuttling questions appear only for yes.'
          }),
          block('shuttling.amount', 'Fuel shuttled', {
            help: 'Pick a suggested range or type a number, a range or a lower bound, like 30, 25-50 or 100+.'
          }),
          block('shuttling.rating', 'Shuttling effectiveness', {
            help: '1 is poor and 5 is excellent. Leave blank when you could not judge it.'
          }),
          block('shuttling.notes', 'Shuttling notes')
        ]
      },
      {
        id: 'performance',
        label: 'Performance',
        blocks: [
          block('teleop.ratings', 'Performance ratings', {
            optional: false,
            help: 'Each number shows the band it stands for. Boundary values belong to the lower band. Clear a rating if you could not judge it.',
            note: 'Shot accuracy and balls per second.'
          }),
          block('teleop.extraRatings', 'Additional ratings', {
            help: '1 is poor and 5 is excellent. Leave blank when you did not see it.',
            note: 'Driver awareness, defense and reliability.'
          }),
          block('teleop.intake', 'Intake speed', { help: '1 is slow and 3 is fast. Leave blank when not observed.' }),
          block('performance.driver', 'Driver skill', {
            help: '1 is poor and 5 is excellent: field awareness, control and decision making.'
          }),
          block('performance.offense', 'Offense rating', {
            help: 'How much the robot helped its alliance score. Leave blank when you did not see it.'
          }),
          block('performance.defense', 'Defense rating', {
            help: 'How well it played defense, or held up against it. Leave blank when it did not happen.'
          }),
          block('performance.ranking', 'Power ranking', {
            help: 'Tap the robots from best to worst in this match. Mark a robot "Didn\'t watch" to leave it out; every scout\'s rankings are averaged per match.',
            note: 'Averaged across scouts on Power Rankings.'
          }),
          block('performance.notes', 'Notes about performance')
        ]
      },
      {
        id: 'robot',
        label: 'Robot',
        blocks: [
          block('teleop.status', 'Robot status', { optional: false, note: 'Active, dead or stopped.' }),
          block('teleop.crash', 'Significant crash', {
            optional: false,
            note: 'Whether the robot crashed, and into what.'
          }),
          block('auto.collision', 'Any collision during auto?'),
          block('robot.intakeJammed', 'Intake jammed during the match'),
          block('postmatch.cards', 'Cards'),
          block('robot.fouls', 'Fouls', {
            help: 'Count the fouls called on this robot. Leave at — if you could not tell.'
          }),
          block('postmatch.break', 'Mechanical break', {
            optional: false,
            note: 'Needed to decide whether the pit crew must be told.'
          }),
          block('robot.breaks', 'What broke and how the team handled it', {
            help: "What broke, how it changed the robot's play, and how the team played around it or fixed it."
          }),
          block('postmatch.beached', 'Robot became beached'),
          block('postmatch.problem', 'Send a problem to the pit crew', {
            note: 'Hides only the optional checkbox. When a robot dies or breaks, the required pit problem report still appears.'
          })
        ]
      },
      { id: 'postmatch', label: 'Post-match', blocks: [block('postmatch.notes', 'Post-match scout notes')] }
    ]
  },
  pit: {
    label: 'Pit scouting',
    sections: [
      {
        id: 'main',
        label: 'Main',
        blocks: [
          block('main.shooter', 'Shooter Type'),
          block('main.hopper', 'Indexer Type'),
          block('main.archetype', 'Robot Role'),
          block('main.bps', 'Estimated BPS'),
          block('main.technical', 'Main technical questions', {
            rename: false,
            note: 'Main breaker, CANivore, CAN buses, trench or bump, hopper capacity and similar.'
          }),
          block('main.breaking', "What's most likely to break?"),
          block('main.autopoints', 'How many points do you usually score in auto?'),
          block('main.notes', 'Anything else?')
        ]
      },
      {
        id: 'extra',
        label: 'Extra',
        blocks: [
          block('extra.setup', 'Contact & Setup', { note: 'A whole page of questions in the Extra tab.' }),
          block('extra.mechanisms', 'Mechanisms', { note: 'A whole page of questions in the Extra tab.' }),
          block('extra.electrical', 'Electrical', { note: 'A whole page of questions in the Extra tab.' }),
          block('extra.controls', 'Controls', { note: 'A whole page of questions in the Extra tab.' }),
          block('extra.structure', 'Structure', { note: 'A whole page of questions in the Extra tab.' }),
          block('extra.ratings', 'Ratings', { note: 'A whole page of questions in the Extra tab.' })
        ]
      }
    ]
  }
});

export const coreId = (key) => `core:${key}`;
export const coreBlocksIn = (formType, sectionId) =>
  FORM_TYPES[formType]?.sections.find((section) => section.id === sectionId)?.blocks || [];

export const QUESTION_TYPES = Object.freeze({
  buttons: {
    label: 'Tap buttons',
    blurb: 'One answer, chosen from big buttons',
    icon: 'MousePointerClick',
    options: true
  },
  mcq: { label: 'Multiple choice', blurb: 'One answer from a list', icon: 'CircleDot', options: true },
  checkboxes: { label: 'Checkboxes', blurb: 'Any number of answers', icon: 'SquareCheck', options: true },
  dropdown: { label: 'Dropdown', blurb: 'One answer from a long list', icon: 'ChevronsUpDown', options: true },
  yesno: { label: 'Yes or no', blurb: 'A single yes/no answer', icon: 'ToggleLeft', options: false },
  rating: { label: 'Rating scale', blurb: 'A number from 1 up to a maximum', icon: 'Star', options: false },
  counter: { label: 'Counter', blurb: 'Tap to count up or down', icon: 'Plus', options: false },
  number: { label: 'Number', blurb: 'Type a number', icon: 'Hash', options: false },
  text: { label: 'Short text', blurb: 'One line of text', icon: 'Type', options: false },
  frq: { label: 'Free response', blurb: 'A longer written answer', icon: 'AlignLeft', options: false }
});

export const LIMITS = Object.freeze({
  questions: 60,
  label: 160,
  help: 300,
  options: 20,
  optionLabel: 60,
  text: 200,
  frq: 2000
});

const randomId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export function newQuestionId() {
  return randomId('q');
}

export function createQuestion(type, section) {
  const meta = QUESTION_TYPES[type];
  if (!meta) throw new Error(`Unknown question type: ${type}`);
  const question = { id: newQuestionId(), section, type, label: '', help: '', required: false };
  if (meta.options)
    question.options = [
      { id: randomId('o'), label: 'Option 1' },
      { id: randomId('o'), label: 'Option 2' }
    ];
  if (type === 'rating') question.max = 5;
  if (type === 'counter') Object.assign(question, { min: 0, max: 50 });
  if (type === 'number') Object.assign(question, { min: null, max: null });
  return question;
}

/** Changes a question's type, keeping its text and whatever settings still make sense for the new type. */
export function convertQuestion(question, type) {
  if (question.type === type) return question;
  const fresh = createQuestion(type, question.section);
  const converted = {
    ...fresh,
    id: question.id,
    label: question.label,
    help: question.help,
    required: question.required
  };
  if (QUESTION_TYPES[type].options && question.options?.length) converted.options = question.options;
  return converted;
}

export const emptyForm = () => ({ questions: [], core: {}, order: {} });

const text = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const intOrNull = (value) =>
  value === '' || value == null || !Number.isFinite(Number(value)) ? null : Math.trunc(Number(value));

/** Cleans anything an editor or a client sent into a well-formed form, dropping what is not valid. */
export function sanitizeForm(raw, formType) {
  const sections = new Set((FORM_TYPES[formType]?.sections || []).map((section) => section.id));
  const seen = new Set();
  const questions = [];
  for (const item of Array.isArray(raw?.questions) ? raw.questions : []) {
    if (questions.length >= LIMITS.questions) break;
    const meta = QUESTION_TYPES[item?.type];
    const id = text(item?.id, 40);
    if (!meta || !id || seen.has(id) || !sections.has(item?.section)) continue;
    seen.add(id);
    const question = {
      id,
      section: item.section,
      type: item.type,
      label: text(item.label, LIMITS.label),
      help: text(item.help, LIMITS.help),
      required: item.required === true
    };
    if (meta.options) {
      const optionIds = new Set();
      question.options = (Array.isArray(item.options) ? item.options : [])
        .slice(0, LIMITS.options)
        .map((option, index) => {
          let optionId = text(option?.id, 40) || randomId('o');
          if (optionIds.has(optionId)) optionId = randomId('o');
          optionIds.add(optionId);
          return { id: optionId, label: text(option?.label, LIMITS.optionLabel) || `Option ${index + 1}` };
        });
    }
    if (item.type === 'rating') question.max = Math.min(10, Math.max(3, intOrNull(item.max) ?? 5));
    if (item.type === 'counter' || item.type === 'number') {
      question.min = intOrNull(item.min);
      question.max = intOrNull(item.max);
      if (question.min != null && question.max != null && question.min > question.max)
        [question.min, question.max] = [question.max, question.min];
    }
    questions.push(question);
  }
  return { questions, core: sanitizeCore(raw?.core, formType), order: sanitizeOrder(raw?.order, formType, questions) };
}

function sanitizeCore(raw, formType) {
  const blocks = new Map(
    (FORM_TYPES[formType]?.sections || []).flatMap((section) => section.blocks).map((entry) => [entry.key, entry])
  );
  const core = {};
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const entry = blocks.get(key);
    if (!entry || !value || typeof value !== 'object') continue;
    const kept = {};
    if (entry.rename) {
      const label = text(value.label, LIMITS.label);
      if (label && label !== entry.label) kept.label = label;
    }
    if (entry.help !== null && typeof value.help === 'string') {
      const help = text(value.help, LIMITS.help);
      if (help !== entry.help) kept.help = help;
    }
    if (entry.optional && value.hidden === true) kept.hidden = true;
    if (Object.keys(kept).length) core[key] = kept;
  }
  return core;
}

function sanitizeOrder(raw, formType, questions) {
  const order = {};
  for (const section of FORM_TYPES[formType]?.sections || []) {
    const list = raw?.[section.id];
    if (!Array.isArray(list)) continue;
    const valid = new Set([
      ...section.blocks.map((entry) => coreId(entry.key)),
      ...questions.filter((question) => question.section === section.id).map((question) => question.id)
    ]);
    const seen = new Set();
    const ids = list.filter((id) => typeof id === 'string' && valid.has(id) && !seen.has(id) && seen.add(id));
    if (ids.length) order[section.id] = ids;
  }
  return order;
}

/** Problems that stop a form from being published (the editor shows them next to the question). */
export function formProblems(form) {
  const problems = {};
  const add = (id, message) => {
    (problems[id] ||= []).push(message);
  };
  for (const question of form.questions) {
    if (!question.label.trim()) add(question.id, 'Add the question text.');
    if (QUESTION_TYPES[question.type]?.options) {
      if (question.options.length < 2) add(question.id, 'Give at least two options.');
      const labels = question.options.map((option) => option.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) add(question.id, 'Two options have the same text.');
    }
    if (
      (question.type === 'counter' || question.type === 'number') &&
      question.min != null &&
      question.max != null &&
      question.min >= question.max
    )
      add(question.id, 'The minimum must be below the maximum.');
  }
  return problems;
}

/** The built-in block's text and visibility once the form's own wording is applied. */
export function coreView(form, entry) {
  const override = form?.core?.[entry.key] || {};
  return {
    key: entry.key,
    label: override.label ?? entry.label,
    help: override.help ?? entry.help,
    hidden: override.hidden === true,
    renamed: override.label !== undefined,
    helpChanged: override.help !== undefined
  };
}

/** Everything shown in one section, built-in blocks and added questions, in the order a scout sees it. */
export function sectionItems(form, formType, sectionId) {
  const base = [
    ...coreBlocksIn(formType, sectionId).map((entry) => ({
      id: coreId(entry.key),
      kind: 'core',
      block: entry,
      view: coreView(form, entry)
    })),
    ...questionsIn(form, sectionId).map((question) => ({ id: question.id, kind: 'custom', question }))
  ];
  const order = form?.order?.[sectionId];
  if (!order?.length) return base;
  const byId = new Map(base.map((item) => [item.id, item]));
  const listed = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const placed = new Set(listed.map((item) => item.id));
  return [...listed, ...base.filter((item) => !placed.has(item.id))];
}

/** What a scouting page needs to lay out a form: each item's position, and the wording/visibility of built-ins. */
export function createLayout(form, formType) {
  const position = new Map();
  for (const section of FORM_TYPES[formType]?.sections || [])
    sectionItems(form, formType, section.id).forEach((item, index) => position.set(item.id, index));
  const blocks = new Map(
    (FORM_TYPES[formType]?.sections || []).flatMap((section) => section.blocks).map((entry) => [entry.key, entry])
  );
  const view = (key) => (blocks.has(key) ? coreView(form, blocks.get(key)) : { label: '', help: null, hidden: false });
  return {
    order: (id) => position.get(id) ?? 0,
    label: (key, fallback = '') => view(key).label || fallback,
    help: (key, fallback = null) => {
      const { help } = view(key);
      return help === undefined || help === null ? fallback : help;
    },
    hidden: (key) => view(key).hidden,
    orders: position
  };
}

/** What changed from one form to another: questions by id, built-in wording and visibility, and order. */
export function diffForms(from, to, formType = 'match') {
  const before = new Map((from?.questions || []).map((question) => [question.id, question]));
  const after = new Map((to?.questions || []).map((question) => [question.id, question]));
  const added = [],
    removed = [],
    edited = [],
    moved = [];
  for (const [id, question] of after) {
    const old = before.get(id);
    if (!old) {
      added.push(question);
      continue;
    }
    if (old.section !== question.section) {
      moved.push(question);
      continue;
    }
    if (JSON.stringify(old) !== JSON.stringify(question)) edited.push(question);
  }
  for (const [id, question] of before) if (!after.has(id)) removed.push(question);
  const keys = new Set([...Object.keys(from?.core || {}), ...Object.keys(to?.core || {})]);
  const core = [...keys].filter(
    (key) => JSON.stringify(from?.core?.[key] || null) !== JSON.stringify(to?.core?.[key] || null)
  );
  // Order is compared on the items both forms share, so adding or removing a question is not also a "reorder".
  let reordered = false;
  for (const section of FORM_TYPES[formType]?.sections || []) {
    const a = sectionItems(from, formType, section.id).map((item) => item.id);
    const b = sectionItems(to, formType, section.id).map((item) => item.id);
    const common = new Set(a.filter((id) => b.includes(id)));
    if (a.filter((id) => common.has(id)).join() !== b.filter((id) => common.has(id)).join()) reordered = true;
  }
  return {
    added,
    removed,
    edited,
    moved,
    core,
    reordered,
    changed: Boolean(added.length || removed.length || edited.length || moved.length || core.length || reordered)
  };
}

export function describeDiff(diff) {
  const parts = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (diff.edited.length) parts.push(`${diff.edited.length} edited`);
  if (diff.moved.length) parts.push(`${diff.moved.length} moved`);
  if (diff.core?.length)
    parts.push(`${diff.core.length} built-in ${diff.core.length === 1 ? 'question' : 'questions'} changed`);
  if (diff.reordered) parts.push('reordered');
  return parts.join(', ') || 'No changes';
}

export const questionsIn = (form, section) =>
  (form?.questions || []).filter((question) => question.section === section);

/** Cleans a scout's answers to a form's questions: unknown ids and wrong shapes are dropped. */
export function sanitizeAnswers(form, raw) {
  const answers = {};
  for (const question of form?.questions || []) {
    const value = raw?.[question.id];
    if (value === undefined || value === null || value === '') continue;
    const optionIds = new Set((question.options || []).map((option) => option.id));
    if (['buttons', 'mcq', 'dropdown'].includes(question.type)) {
      if (optionIds.has(value)) answers[question.id] = value;
    } else if (question.type === 'checkboxes') {
      const picked = (Array.isArray(value) ? value : []).filter((id) => optionIds.has(id));
      if (picked.length) answers[question.id] = [...new Set(picked)];
    } else if (question.type === 'yesno') {
      if (typeof value === 'boolean') answers[question.id] = value;
    } else if (question.type === 'rating') {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= (question.max || 5)) answers[question.id] = n;
    } else if (question.type === 'counter' || question.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (question.min != null && n < question.min) continue;
      if (question.max != null && n > question.max) continue;
      answers[question.id] = question.type === 'counter' ? Math.trunc(n) : n;
    } else if (question.type === 'text') answers[question.id] = text(value, LIMITS.text);
    else if (question.type === 'frq') answers[question.id] = text(value, LIMITS.frq);
  }
  return answers;
}

export const isAnswered = (question, answers) => {
  const value = answers?.[question.id];
  if (question.type === 'counter') return value !== undefined;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
};

/** The first unanswered required question among these, or null. */
export function firstMissing(questions, answers) {
  return (questions || []).find((question) => question.required && !isAnswered(question, answers)) || null;
}
