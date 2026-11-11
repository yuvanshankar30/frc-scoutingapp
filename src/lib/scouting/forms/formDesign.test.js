import { describe, expect, it } from 'vitest';
import {
  createLayout,
  createQuestion,
  firstMissing,
  formProblems,
  sanitizeAnswers,
  sanitizeForm,
  shownOnKind,
  styleOf
} from './formSchema.js';

describe('form designer schema', () => {
  it('keeps valid card styles, option images and colors, and kinds; drops the rest', () => {
    const form = sanitizeForm(
      {
        questions: [
          {
            id: 'q1',
            section: 'teleop',
            type: 'picture',
            label: 'Where did it start?',
            style: { size: 'full', textSize: 'lg', accent: '#AA2200', image: 'javascript:alert(1)', junk: 1 },
            kinds: ['robot', 'nope'],
            options: [
              { id: 'a', label: 'Left', image: 'https://example.org/left.png', color: '#00ff00' },
              { id: 'b', label: 'Right', image: 'http://insecure/x.png', color: 'red' }
            ]
          }
        ]
      },
      'match'
    );
    const [q] = form.questions;
    expect(q.style).toEqual({ size: 'full', textSize: 'lg', accent: '#aa2200' });
    expect(q.kinds).toEqual(['robot']);
    expect(q.options[0]).toEqual({ id: 'a', label: 'Left', image: 'https://example.org/left.png', color: '#00ff00' });
    expect(q.options[1]).toEqual({ id: 'b', label: 'Right' });
    expect(styleOf(q)).toMatchObject({ size: 'full', textSize: 'lg', image: '' });
    expect(shownOnKind(q, 'robot')).toBe(true);
    expect(shownOnKind(q, 'data')).toBe(false);
  });

  it('styles built-in blocks too', () => {
    const form = sanitizeForm({ core: { 'teleop.balls': { style: { size: 'half', accent: '#123456' } } } }, 'match');
    expect(createLayout(form, 'match').style('teleop.balls')).toMatchObject({ size: 'half', accent: '#123456' });
  });

  it('checks and answers sliders and grids', () => {
    const slider = { ...createQuestion('slider', 'teleop'), id: 's', label: 'BPS', min: 0, max: 40, step: 0.5 };
    const grid = {
      ...createQuestion('grid', 'teleop'),
      id: 'g',
      label: 'Status',
      required: true,
      rows: [
        { id: 'r1', label: 'Shift 1' },
        { id: 'r2', label: 'Shift 2' }
      ],
      options: [
        { id: 'on', label: 'Active' },
        { id: 'off', label: 'Dead' }
      ]
    };
    const form = sanitizeForm({ questions: [slider, grid] }, 'match');
    expect(form.questions[0]).toMatchObject({ min: 0, max: 40, step: 0.5 });
    const answers = sanitizeAnswers(form, { s: 12.5, g: { r1: 'on', r2: 'bogus', r9: 'on' } });
    expect(answers).toEqual({ s: 12.5, g: { r1: 'on' } });
    expect(firstMissing(form.questions, answers)?.id).toBe('g');
    expect(firstMissing(form.questions, { ...answers, g: { r1: 'on', r2: 'off' } })).toBeNull();
    expect(sanitizeAnswers(form, { s: 99 })).toEqual({});
  });

  it('reports a grid with no rows and a backwards slider', () => {
    const problems = formProblems({
      questions: [
        { id: 'g', type: 'grid', label: 'G', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], rows: [] },
        { id: 's', type: 'slider', label: 'S', min: 5, max: 5 }
      ]
    });
    expect(problems.g).toContain('Give the grid at least one row.');
    expect(problems.s).toContain('The slider needs a minimum below its maximum.');
  });
});
