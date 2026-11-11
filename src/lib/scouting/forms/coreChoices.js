// The answers a scout picks from on each built-in question, so the form designer can reword, hide and reorder them.
// A choice's `value` is what is saved in the report and read by analysis and exports; only its wording, whether it
// is shown and its place change, so old reports, rankings and exports keep working. `fixed` lists (yes/no answers,
// the steps of a rating scale) can be reworded but not hidden or reordered, because every answer is needed.
import {
  ACCURACY_LABELS,
  AUTO_FUEL_SOURCES,
  FOUL_NATURES,
  MATCH_FORM_ROLES
} from '$lib/scouting/matchScouting.js';

const pairs = (values) => values.map((value) => [value, value]);
const yesNo = (yes = 'Yes', no = 'No') => [{ id: 'answer', title: 'Answers', fixed: true, options: [['yes', yes], ['no', no]] }];
const scale = (labels) => labels.map((label, index) => [String(index + 1), label]);

export const CORE_CHOICES = Object.freeze({
  match: {
    'prematch.present': yesNo(),
    'prematch.preload': yesNo('Has preload', 'No preload'),
    'auto.ran': yesNo(),
    'auto.sources': [{ id: 'sources', title: 'Places', options: pairs(AUTO_FUEL_SOURCES) }],
    'teleop.roles': [
      { id: 'roles', title: 'Roles', options: [...pairs(MATCH_FORM_ROLES), ['none', 'None observed']] }
    ],
    'shuttling.shuttled': yesNo(),
    'teleop.ratings': [{ id: 'scale', title: 'Scale', fixed: true, options: scale(ACCURACY_LABELS) }],
    'teleop.status': [
      {
        id: 'status',
        title: 'Statuses',
        options: [
          ['active', 'Active'],
          ['dead', 'Dead'],
          ['stopped', 'Stopped']
        ]
      }
    ],
    'teleop.crash': [
      ...yesNo(),
      {
        id: 'target',
        title: 'What it hit',
        options: [
          ['robot', 'Robot'],
          ['wall', 'Wall'],
          ['field element', 'Field element'],
          ['other', 'Other']
        ]
      }
    ],
    'auto.collision': yesNo(),
    'postmatch.cards': [
      {
        id: 'cards',
        title: 'Cards',
        options: [
          ['none', 'None'],
          ['yellow', 'Yellow'],
          ['red', 'Red']
        ]
      }
    ],
    'robot.fouls': [
      {
        id: 'kinds',
        title: 'Counters',
        fixed: true,
        options: [
          ['minor', 'Minor fouls'],
          ['major', 'Major fouls']
        ]
      },
      { id: 'natures', title: 'What the foul was for', options: pairs(FOUL_NATURES) }
    ],
    'postmatch.break': yesNo()
  },
  pit: {}
});

/** The choice lists of one built-in block (empty when it has none). */
export const coreChoiceLists = (formType, key) => CORE_CHOICES[formType]?.[key] || [];

const LABEL_MAX = 60;

/**
 * The stored choice overrides of a block, checked against its lists: new wording by value, hidden values (never a
 * whole list, never a fixed one) and an order (values of movable lists). Returns null when nothing is changed.
 */
export function sanitizeChoices(raw, lists) {
  if (!lists.length || !raw || typeof raw !== 'object') return null;
  const out = {};
  const labels = {};
  for (const list of lists)
    for (const [value, label] of list.options) {
      const next = typeof raw.choices?.[value] === 'string' ? raw.choices[value].trim().slice(0, LABEL_MAX) : '';
      if (next && next !== label) labels[value] = next;
    }
  if (Object.keys(labels).length) out.choices = labels;
  const hidden = new Set(Array.isArray(raw.hiddenChoices) ? raw.hiddenChoices : []);
  const kept = [];
  for (const list of lists) {
    if (list.fixed) continue;
    const values = list.options.map(([value]) => value).filter((value) => hidden.has(value));
    if (values.length < list.options.length) kept.push(...values);
  }
  if (kept.length) out.hiddenChoices = kept;
  const movable = new Set(lists.filter((list) => !list.fixed).flatMap((list) => list.options.map(([value]) => value)));
  const seen = new Set();
  const order = (Array.isArray(raw.choiceOrder) ? raw.choiceOrder : []).filter(
    (value) => movable.has(value) && !seen.has(value) && seen.add(value)
  );
  const defaultOrder = lists.filter((list) => !list.fixed).flatMap((list) => list.options.map(([value]) => value));
  const placed = [...order, ...defaultOrder.filter((value) => !seen.has(value))];
  if (order.length && placed.join('\u0000') !== defaultOrder.join('\u0000')) out.choiceOrder = order;
  return Object.keys(out).length ? out : null;
}

const valueOf = (item) => (Array.isArray(item) ? String(item[0]) : String(item?.value ?? item));

/** `items` (values, [value, label] pairs or {value}) without the hidden ones, in the admin's order. */
export function arrangeChoices(override, items) {
  const hidden = new Set(override?.hiddenChoices || []);
  const order = override?.choiceOrder || [];
  const rank = new Map(order.map((value, index) => [value, index]));
  return items
    .filter((item) => !hidden.has(valueOf(item)))
    .map((item, index) => ({ item, index, at: rank.has(valueOf(item)) ? rank.get(valueOf(item)) : order.length + index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ item }) => item);
}

/** A built-in answer's wording before any change (falls back to the value itself). */
export function defaultChoiceLabel(formType, key, value) {
  for (const list of coreChoiceLists(formType, key))
    for (const [option, label] of list.options) if (option === String(value)) return label;
  return String(value);
}
