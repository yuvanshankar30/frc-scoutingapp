import { describe, expect, it } from 'vitest';
import { arrangeChoices, coreChoiceLists, defaultChoiceLabel, sanitizeChoices } from './coreChoices.js';
import { createLayout, sanitizeForm } from './formSchema.js';

const roles = coreChoiceLists('match', 'teleop.roles');
const crash = coreChoiceLists('match', 'teleop.crash');

describe('built-in choices', () => {
  it('keeps only changed wording for known answers', () => {
    expect(sanitizeChoices({ choices: { Scorer: 'Shooter', Defense: 'Defense', bogus: 'x' } }, roles)).toEqual({
      choices: { Scorer: 'Shooter' }
    });
  });

  it('never hides a whole list or a fixed one', () => {
    expect(sanitizeChoices({ hiddenChoices: ['Scorer', 'Defense', 'Shuttler', 'none'] }, roles)).toBeNull();
    expect(sanitizeChoices({ hiddenChoices: ['yes', 'wall'] }, crash)).toEqual({ hiddenChoices: ['wall'] });
  });

  it('drops an order that matches the built-in one', () => {
    expect(sanitizeChoices({ choiceOrder: ['Scorer', 'Defense'] }, roles)).toBeNull();
    expect(sanitizeChoices({ choiceOrder: ['none', 'Scorer'] }, roles)).toEqual({ choiceOrder: ['none', 'Scorer'] });
  });

  it('arranges answers: hidden ones out, ordered ones first', () => {
    const override = { hiddenChoices: ['Defense'], choiceOrder: ['none'] };
    expect(arrangeChoices(override, ['Scorer', 'Defense', 'Shuttler', 'none'])).toEqual(['none', 'Scorer', 'Shuttler']);
    expect(arrangeChoices(null, [['a', 'A'], ['b', 'B']])).toEqual([['a', 'A'], ['b', 'B']]);
  });

  it('flows through the form and the page layout', () => {
    const form = sanitizeForm(
      { questions: [], core: { 'teleop.roles': { choices: { Scorer: 'Shooter' }, hiddenChoices: ['Shuttler'] } } },
      'match'
    );
    const layout = createLayout(form, 'match');
    expect(layout.choice('teleop.roles', 'Scorer', 'Scorer')).toBe('Shooter');
    expect(layout.choice('teleop.roles', 'Defense', 'Defense')).toBe('Defense');
    expect(layout.choices('teleop.roles', ['Scorer', 'Defense', 'Shuttler'])).toEqual(['Scorer', 'Defense']);
    expect(defaultChoiceLabel('match', 'teleop.crash', 'field element')).toBe('Field element');
  });
});
