import { describe, expect, it } from 'vitest';
import {
  convertQuestion,
  coreBlocksIn,
  coreId,
  coreView,
  createLayout,
  createQuestion,
  emptyForm,
  sectionItems,
  describeDiff,
  diffForms,
  firstMissing,
  formProblems,
  sanitizeAnswers,
  sanitizeForm
} from './formSchema.js';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from './history.js';

const q = (type, section = 'teleop', extra = {}) => ({ ...createQuestion(type, section), label: 'Question', ...extra });

describe('sanitizeForm', () => {
  it('keeps valid questions and drops unknown types, sections and duplicate ids', () => {
    const good = q('buttons');
    const form = sanitizeForm(
      { questions: [good, { ...good }, { ...q('mcq'), type: 'bogus' }, { ...q('mcq'), section: 'nope' }] },
      'match'
    );
    expect(form.questions.map((item) => item.id)).toEqual([good.id]);
  });
  it('clamps rating scales and orders counter bounds', () => {
    const form = sanitizeForm(
      {
        questions: [
          { ...q('rating'), max: 99 },
          { ...q('counter'), min: 9, max: 2 }
        ]
      },
      'match'
    );
    expect(form.questions[0].max).toBe(10);
    expect([form.questions[1].min, form.questions[1].max]).toEqual([2, 9]);
  });
  it('only accepts sections of the form type', () => {
    expect(sanitizeForm({ questions: [q('text', 'teleop')] }, 'pit').questions).toEqual([]);
    expect(sanitizeForm({ questions: [q('text', 'main')] }, 'pit').questions).toHaveLength(1);
  });
});

describe('formProblems', () => {
  it('flags empty text, too few options and duplicate options', () => {
    const empty = { ...q('text'), label: ' ' };
    const one = { ...q('mcq'), options: [{ id: 'a', label: 'A' }] };
    const dup = {
      ...q('buttons'),
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'a' }
      ]
    };
    const problems = formProblems({ questions: [empty, one, dup, q('text')] });
    expect(Object.keys(problems)).toEqual([empty.id, one.id, dup.id]);
  });
});

describe('diffForms', () => {
  it('reports added, removed and edited questions', () => {
    const a = q('text'),
      b = q('frq'),
      c = q('yesno');
    const diff = diffForms({ questions: [a, b] }, { questions: [{ ...a, label: 'New' }, c] });
    expect(diff.added.map((x) => x.id)).toEqual([c.id]);
    expect(diff.removed.map((x) => x.id)).toEqual([b.id]);
    expect(diff.edited.map((x) => x.id)).toEqual([a.id]);
    expect(describeDiff(diff)).toBe('1 added, 1 removed, 1 edited');
  });
  it('does not call a question moved just because others were removed', () => {
    const a = q('text'),
      b = q('text'),
      c = q('text');
    const diff = diffForms({ questions: [a, b, c] }, { questions: [a, c] });
    expect(diff.moved).toEqual([]);
  });
  it('notices a real reorder', () => {
    const a = q('text'),
      b = q('text');
    const diff = diffForms({ questions: [a, b] }, { questions: [b, a], order: { teleop: [b.id, a.id] } });
    expect(diff.changed).toBe(true);
    expect(diff.reordered).toBe(true);
  });
  it('sees a moved question, a reworded built-in and a hidden one', () => {
    const a = q('text', 'teleop');
    const moved = diffForms({ questions: [a] }, { questions: [{ ...a, section: 'auto' }] });
    expect(moved.moved).toHaveLength(1);
    const core = diffForms(emptyForm(), {
      ...emptyForm(),
      core: { 'teleop.notes': { label: 'Anything to add?' }, 'auto.cycles': { hidden: true } }
    });
    expect(core.core).toEqual(['teleop.notes', 'auto.cycles']);
    expect(describeDiff(core)).toBe('2 built-in questions changed');
  });
  it('is unchanged for identical forms', () => {
    const a = q('text');
    expect(diffForms({ questions: [a] }, { questions: [{ ...a }] }).changed).toBe(false);
  });
});

describe('sanitizeAnswers and firstMissing', () => {
  const choice = q('buttons', 'teleop', { required: true });
  const form = {
    questions: [choice, q('rating'), q('checkboxes'), q('counter'), q('number', 'teleop', { min: 0, max: 10 })]
  };
  it('keeps valid answers and drops out-of-range or unknown ones', () => {
    const [, rating, boxes, counter, number] = form.questions;
    const answers = sanitizeAnswers(form, {
      [choice.id]: choice.options[1].id,
      [rating.id]: 9,
      [boxes.id]: [boxes.options[0].id, 'zzz'],
      [counter.id]: 3.7,
      [number.id]: 11,
      ghost: 'x'
    });
    expect(answers).toEqual({ [choice.id]: choice.options[1].id, [boxes.id]: [boxes.options[0].id], [counter.id]: 3 });
  });
  it('finds the first unanswered required question', () => {
    expect(firstMissing(form.questions, {})?.id).toBe(choice.id);
    expect(firstMissing(form.questions, { [choice.id]: choice.options[0].id })).toBeNull();
  });
});

describe('history', () => {
  it('undoes and redoes whole snapshots', () => {
    let h = createHistory({ n: 0 });
    h = pushHistory(h, { n: 1 });
    h = pushHistory(h, { n: 2 });
    expect(h.present.n).toBe(2);
    h = undo(h);
    expect(h.present.n).toBe(1);
    h = undo(h);
    expect(h.present.n).toBe(0);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present.n).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, { n: 9 });
    expect(canRedo(h)).toBe(false);
  });
  it('folds edits that share a group into one step', () => {
    let h = createHistory({ t: '' });
    for (const t of ['a', 'ab', 'abc']) h = pushHistory(h, { t }, 'label:q1');
    expect(h.past).toHaveLength(1);
    expect(undo(h).present.t).toBe('');
  });
  it('ignores a push that changes nothing', () => {
    const h = createHistory({ n: 1 });
    expect(pushHistory(h, { n: 1 })).toBe(h);
  });
});

describe('convertQuestion', () => {
  it('keeps text and options between option types', () => {
    const original = { ...q('buttons'), label: 'Climb?', help: 'Hint', required: true };
    const converted = convertQuestion(original, 'mcq');
    expect(converted).toMatchObject({ id: original.id, type: 'mcq', label: 'Climb?', help: 'Hint', required: true });
    expect(converted.options).toEqual(original.options);
  });
  it('drops options for types without them and adds the new type defaults', () => {
    const converted = convertQuestion(q('mcq'), 'rating');
    expect(converted.options).toBeUndefined();
    expect(converted.max).toBe(5);
  });
});

describe('built-in blocks', () => {
  it('puts ratings and intake speed on Performance, and the robot condition questions on Robot', () => {
    const keys = (section) => coreBlocksIn('match', section).map((entry) => entry.key);
    expect(keys('teleop')).toEqual(['teleop.roles', 'teleop.balls', 'teleop.notes']);
    expect(keys('auto')).not.toContain('auto.collision');
    expect(keys('performance')).toEqual(
      expect.arrayContaining(['teleop.ratings', 'teleop.extraRatings', 'teleop.intake'])
    );
    expect(keys('robot')).toEqual(
      expect.arrayContaining([
        'teleop.status',
        'teleop.crash',
        'auto.collision',
        'robot.intakeJammed',
        'postmatch.problem'
      ])
    );
  });

  it('keeps only known blocks, wording that differs from the default, and hides only optional blocks', () => {
    const form = sanitizeForm(
      {
        questions: [],
        core: {
          'teleop.notes': { label: 'Anything to add?', hidden: true },
          'teleop.roles': { label: 'Roles', hidden: true, help: 'Pick all' },
          'teleop.balls': { label: 'Balls scored' },
          'prematch.assignment': { label: 'Nope' },
          'bogus.key': { label: 'x' }
        }
      },
      'match'
    );
    expect(form.core).toEqual({
      'teleop.notes': { label: 'Anything to add?', hidden: true },
      'teleop.roles': { label: 'Roles', help: 'Pick all' }
    });
  });
  it('lists built-ins before added questions, then follows a saved order and ignores unknown ids', () => {
    const added = { ...createQuestion('text', 'teleop'), label: 'Climb?' };
    const plain = sectionItems({ ...emptyForm(), questions: [added] }, 'match', 'teleop');
    expect(plain.at(-1).id).toBe(added.id);
    expect(plain[0].id).toBe(coreId('teleop.roles'));
    const form = sanitizeForm(
      { questions: [added], order: { teleop: [added.id, 'ghost', coreId('teleop.balls')] } },
      'match'
    );
    const ids = sectionItems(form, 'match', 'teleop').map((item) => item.id);
    expect(ids.slice(0, 2)).toEqual([added.id, coreId('teleop.balls')]);
    expect(ids).toHaveLength(plain.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('gives a scouting page positions, wording and visibility', () => {
    const form = sanitizeForm(
      {
        questions: [],
        core: { 'teleop.notes': { label: 'Anything to add?', hidden: true, help: '' } },
        order: { teleop: [coreId('teleop.balls')] }
      },
      'match'
    );
    const layout = createLayout(form, 'match');
    expect(layout.order(coreId('teleop.balls'))).toBe(0);
    expect(layout.order(coreId('teleop.roles'))).toBe(1);
    expect(layout.label('teleop.notes', 'x')).toBe('Anything to add?');
    expect(layout.label('teleop.roles', 'fallback')).toBe('Observed roles');
    expect(layout.hidden('teleop.notes')).toBe(true);
    expect(layout.hidden('teleop.roles')).toBe(false);
    expect(layout.help('teleop.balls')).toContain('suggested range');
    expect(coreView(form, { key: 'teleop.notes', label: 'Real-scout observations', help: null }).renamed).toBe(true);
  });
  it('treats the pit sections as their own set of blocks', () => {
    const items = sectionItems(emptyForm(), 'pit', 'extra').map((item) => item.id);
    expect(items).toContain(coreId('extra.electrical'));
    expect(sectionItems(emptyForm(), 'pit', 'teleop')).toEqual([]);
  });
});
