// Editable scouting forms. A form is an ordered list of questions an admin added on top of the
// built-in ("core") questions, each placed in one of the form's sections. The built-in questions
// feed analytics and the saved-report columns, so they stay fixed and are only listed in the editor.
// Answers are stored by question id; the form version they were answered against is stored with them,
// so an old report can always be read against the questions it was answered with.

// The built-in questions are grouped into blocks. Every block can be reworded, restyled, moved, hidden and made
// required or optional: games change from year to year, so nothing is locked. `optional: false` here only sets the
// starting point, required; an admin can change it. The one exception is the match, robot and alliance a report is
// for, which every report needs. Every block's help text can be edited (empty means none is shown).
const block = (key, label, { help = null, optional = true, note = '' } = {}) => ({
  key,
  label,
  help,
  required: optional === false,
  optional: key !== 'prematch.assignment',
  rename: true,
  note
});

// The built-in forms for this season come from JSON files in the repo's scouting-forms/ folder (one folder per
// game), so a new game is a new folder, not a code change. Each file lists the form's sections and their built-in
// questions; the designer (Scouting Admin > Edit) changes everything else and can export and import the same format.
import { arrangeChoices, coreChoiceLists, sanitizeChoices } from './coreChoices.js';
import matchForm from '$forms/2026-rebuilt/match.json';
import pitForm from '$forms/2026-rebuilt/pit.json';

/** A form file's definition, in the shape the rest of the app uses. */
export function formDefinition(file) {
  return {
    label: file.label,
    ...(file.movedSections ? { movedSections: file.movedSections } : {}),
    sections: file.sections.map((section) => ({
      id: section.id,
      label: section.label,
      blocks: section.blocks.map((entry) =>
        block(entry.key, entry.label, {
          help: entry.help ?? '',
          optional: entry.required ? false : true,
          note: entry.note || ''
        })
      )
    }))
  };
}

export const FORM_FILES = Object.freeze({ match: matchForm, pit: pitForm });
export const FORM_TYPES = Object.freeze({ match: formDefinition(matchForm), pit: formDefinition(pitForm) });

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
  frq: { label: 'Free response', blurb: 'A longer written answer', icon: 'AlignLeft', options: false },
  slider: { label: 'Slider', blurb: 'A number picked on a slider', icon: 'SlidersHorizontal', options: false },
  picture: { label: 'Picture choice', blurb: 'One answer from picture tiles', icon: 'Image', options: true },
  grid: {
    label: 'Grid',
    blurb: 'One answer per row, like robot status in each shift',
    icon: 'Grid3x3',
    options: true
  }
});

// How a question's card looks. Every question and every built-in block can carry a style; anything left out uses
// the defaults, so an old form looks exactly as it did.
export const CARD_SIZES = Object.freeze([
  { key: 'auto', label: 'Auto', span: null },
  { key: 'third', label: 'Third', span: 4 },
  { key: 'half', label: 'Half', span: 6 },
  { key: 'two-thirds', label: 'Two thirds', span: 8 },
  { key: 'full', label: 'Full width', span: 12 }
]);
export const TEXT_SIZES = Object.freeze([
  { key: 'sm', label: 'Small', scale: 0.9 },
  { key: 'md', label: 'Medium', scale: 1 },
  { key: 'lg', label: 'Large', scale: 1.15 },
  { key: 'xl', label: 'Extra large', scale: 1.3 }
]);
/** The kinds of match scouting a question can appear on (match form only; an empty list means all of them). */
export const REPORT_KIND_KEYS = Object.freeze(['data', 'performance', 'robot']);
export const DEFAULT_STYLE = Object.freeze({ size: 'auto', textSize: 'md', accent: '', image: '' });

export const LIMITS = Object.freeze({
  questions: 60,
  label: 160,
  help: 300,
  options: 20,
  optionLabel: 60,
  text: 200,
  frq: 2000,
  rows: 12,
  sliderMax: 100000
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
  if (type === 'slider') Object.assign(question, { min: 0, max: 40, step: 1 });
  if (type === 'grid')
    question.rows = [
      { id: randomId('r'), label: 'Row 1' },
      { id: randomId('r'), label: 'Row 2' }
    ];
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
  if (question.style) converted.style = question.style;
  if (question.kinds) converted.kinds = question.kinds;
  return converted;
}

export const emptyForm = () => ({ questions: [], core: {}, order: {} });

const text = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const intOrNull = (value) =>
  value === '' || value == null || !Number.isFinite(Number(value)) ? null : Math.trunc(Number(value));
const numOrNull = (value) => (value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value));
const HEX = /^#[0-9a-f]{6}$/i;
// Images come from the app's own storage (uploaded in the editor) or another https address.
const imageUrl = (value) => {
  const url = String(value ?? '').trim();
  // https anywhere, or plain http from this computer (a local Supabase while developing).
  const ok = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)[^\s"'<>]+$/i.test(url);
  return url.length <= 500 && ok ? url : '';
};

/** A card style with only known keys and valid values; defaults are left out so stored forms stay small. */
export function sanitizeStyle(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const style = {};
  if (CARD_SIZES.some((size) => size.key === raw.size) && raw.size !== 'auto') style.size = raw.size;
  if (TEXT_SIZES.some((size) => size.key === raw.textSize) && raw.textSize !== 'md') style.textSize = raw.textSize;
  if (HEX.test(String(raw.accent || ''))) style.accent = String(raw.accent).toLowerCase();
  const image = imageUrl(raw.image);
  if (image) style.image = image;
  return Object.keys(style).length ? style : undefined;
}

/** A question's (or block's) style with every key filled in. */
export const styleOf = (item) => ({ ...DEFAULT_STYLE, ...(item?.style || {}) });

/** Cleans anything an editor or a client sent into a well-formed form, dropping what is not valid. */
export function sanitizeForm(raw, formType) {
  const sections = new Set((FORM_TYPES[formType]?.sections || []).map((section) => section.id));
  const moved = FORM_TYPES[formType]?.movedSections || {};
  const seen = new Set();
  const questions = [];
  for (const item of Array.isArray(raw?.questions) ? raw.questions : []) {
    if (questions.length >= LIMITS.questions) break;
    const meta = QUESTION_TYPES[item?.type];
    const id = text(item?.id, 40);
    const section = moved[item?.section] || item?.section;
    if (!meta || !id || seen.has(id) || !sections.has(section)) continue;
    seen.add(id);
    const question = {
      id,
      section,
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
          const kept = { id: optionId, label: text(option?.label, LIMITS.optionLabel) || `Option ${index + 1}` };
          const image = imageUrl(option?.image);
          if (image) kept.image = image;
          if (HEX.test(String(option?.color || ''))) kept.color = String(option.color).toLowerCase();
          return kept;
        });
    }
    if (item.type === 'grid') {
      const rowIds = new Set();
      question.rows = (Array.isArray(item.rows) ? item.rows : []).slice(0, LIMITS.rows).map((row, index) => {
        let rowId = text(row?.id, 40) || randomId('r');
        if (rowIds.has(rowId)) rowId = randomId('r');
        rowIds.add(rowId);
        return { id: rowId, label: text(row?.label, LIMITS.optionLabel) || `Row ${index + 1}` };
      });
    }
    if (item.type === 'slider') {
      const min = numOrNull(item.min) ?? 0;
      const max = numOrNull(item.max) ?? 10;
      question.min = Math.max(-LIMITS.sliderMax, Math.min(min, max));
      question.max = Math.min(LIMITS.sliderMax, Math.max(min, max));
      const step = numOrNull(item.step);
      question.step = step && step > 0 ? Math.min(step, question.max - question.min || 1) : 1;
    }
    const style = sanitizeStyle(item.style);
    if (style) question.style = style;
    if (Array.isArray(item.kinds)) {
      const kinds = REPORT_KIND_KEYS.filter((kind) => item.kinds.includes(kind));
      if (kinds.length && kinds.length < REPORT_KIND_KEYS.length) question.kinds = kinds;
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
    if (typeof value.required === 'boolean' && value.required !== entry.required) kept.required = value.required;
    const style = sanitizeStyle(value.style);
    if (style) kept.style = style;
    Object.assign(kept, sanitizeChoices(value, coreChoiceLists(formType, key)) || {});
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
    if (question.type === 'grid' && !question.rows?.length) add(question.id, 'Give the grid at least one row.');
    if (question.type === 'slider' && question.min >= question.max)
      add(question.id, 'The slider needs a minimum below its maximum.');
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
    required: override.required ?? entry.required,
    style: override.style || null,
    choices: override.choices || {},
    hiddenChoices: override.hiddenChoices || [],
    choiceOrder: override.choiceOrder || [],
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
  const view = (key) =>
    blocks.has(key) ? coreView(form, blocks.get(key)) : { label: '', help: null, hidden: false, required: true };
  return {
    order: (id) => position.get(id) ?? 0,
    label: (key, fallback = '') => view(key).label || fallback,
    help: (key, fallback = null) => {
      const { help } = view(key);
      return help === undefined || help === null ? fallback : help;
    },
    hidden: (key) => view(key).hidden,
    // Whether the scout must answer this block: shown, and required in the form (built-in default or the admin's).
    need: (key) => (blocks.has(key) ? !view(key).hidden && view(key).required !== false : true),
    shown: (key) => !view(key).hidden,
    // A built-in block's card style, with defaults filled in.
    style: (key) => ({ ...DEFAULT_STYLE, ...(view(key).style || {}) }),
    // The wording of one of a built-in block's answers, and a list of its answers without hidden ones, in order.
    choice: (key, value, fallback = '') => form?.core?.[key]?.choices?.[value] || fallback,
    choices: (key, items) => arrangeChoices(form?.core?.[key], items),
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

/** Whether a question shows on this kind of match scouting (questions with no kinds show on all of them). */
export const shownOnKind = (question, kind) => !kind || !question.kinds?.length || question.kinds.includes(kind);

/** Cleans a scout's answers to a form's questions: unknown ids and wrong shapes are dropped. */
export function sanitizeAnswers(form, raw) {
  const answers = {};
  for (const question of form?.questions || []) {
    const value = raw?.[question.id];
    if (value === undefined || value === null || value === '') continue;
    const optionIds = new Set((question.options || []).map((option) => option.id));
    if (['buttons', 'mcq', 'dropdown', 'picture'].includes(question.type)) {
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
    } else if (question.type === 'slider') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= question.min && n <= question.max) answers[question.id] = n;
    } else if (question.type === 'grid') {
      const rowIds = new Set((question.rows || []).map((row) => row.id));
      const picked = {};
      for (const [rowId, optionId] of Object.entries(value && typeof value === 'object' ? value : {}))
        if (rowIds.has(rowId) && optionIds.has(optionId)) picked[rowId] = optionId;
      if (Object.keys(picked).length) answers[question.id] = picked;
    } else if (question.type === 'text') answers[question.id] = text(value, LIMITS.text);
    else if (question.type === 'frq') answers[question.id] = text(value, LIMITS.frq);
  }
  return answers;
}

export const isAnswered = (question, answers) => {
  const value = answers?.[question.id];
  if (question.type === 'counter') return value !== undefined;
  if (question.type === 'grid')
    return (question.rows || []).every((row) => value && typeof value === 'object' && value[row.id] !== undefined);
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
};

/** The first unanswered required question among these, or null. */
export function firstMissing(questions, answers) {
  return (questions || []).find((question) => question.required && !isAnswered(question, answers)) || null;
}

export const FORM_FILE_FORMAT = 'frc-scouting-form';

/**
 * A form as a file, in the same format as the files in scouting-forms/: the season's built-in sections and questions,
 * plus `design`, everything the designer changed (added questions, wording, visibility, order, looks). Exported from
 * Scouting Admin > Edit, and the file can be imported back, shared with another team, or committed to the repo.
 */
export function formToFile(formType, schema, extra = {}) {
  const { design: _baseline, ...file } = FORM_FILES[formType];
  return { ...file, ...extra, design: sanitizeForm(schema, formType) };
}

/**
 * Reads an imported form file. Returns { schema, warnings } or { error }. The design is checked against this
 * app's built-in form: questions in sections it doesn't have, and changes to built-in questions it doesn't know,
 * are left out and listed in the warnings.
 */
export function formFromFile(raw, formType) {
  let file = raw;
  if (typeof raw === 'string') {
    try {
      file = JSON.parse(raw);
    } catch {
      return { error: 'That file is not valid JSON.' };
    }
  }
  if (!file || typeof file !== 'object' || file.format !== FORM_FILE_FORMAT)
    return { error: 'That is not a scouting form file.' };
  if (file.form !== formType)
    return { error: `That file is a ${FORM_TYPES[file.form]?.label.toLowerCase() || file.form} form, not ${FORM_TYPES[formType].label.toLowerCase()}.` };
  const design = file.design && typeof file.design === 'object' ? file.design : {};
  const schema = sanitizeForm(design, formType);
  const warnings = [];
  const dropped = (design.questions?.length || 0) - schema.questions.length;
  if (dropped > 0) warnings.push(`${dropped} question${dropped === 1 ? '' : 's'} could not be read and were left out.`);
  const unknown = Object.keys(design.core || {}).filter((key) => !schema.core[key] && design.core[key]);
  const known = new Set(FORM_TYPES[formType].sections.flatMap((section) => section.blocks.map((entry) => entry.key)));
  const missing = unknown.filter((key) => !known.has(key));
  if (missing.length) warnings.push(`Changes to ${missing.length} built-in question${missing.length === 1 ? '' : 's'} this app doesn't have were left out.`);
  if (file.game && file.game !== FORM_FILES[formType].game)
    warnings.push(`The file is for ${file.game}; this app's built-in form is ${FORM_FILES[formType].game}.`);
  return { schema, warnings };
}
