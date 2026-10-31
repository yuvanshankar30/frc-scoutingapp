import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CustomQuestions from './CustomQuestions.svelte';
import CoreCard from './CoreCard.svelte';
import QuestionCard from './QuestionCard.svelte';
import { QUESTION_TYPES, coreView, coreBlocksIn, createQuestion, emptyForm } from '$lib/scouting/forms/formSchema.js';

const types = Object.keys(QUESTION_TYPES);
const sample = (type) => ({ ...createQuestion(type, 'teleop'), label: `Q ${type}`, required: true });

describe('CustomQuestions', () => {
  it('renders every question type with its label and required tag', () => {
    const questions = types.map(sample);
    const { body } = render(CustomQuestions, { props: { questions, answers: {} } });
    for (const type of types) expect(body).toContain(`Q ${type}`);
    expect(body).toContain('Required');
    expect(body).toContain('Option 1');
  });
  it('marks an unanswered required question once the scout tries to continue', () => {
    const { body } = render(CustomQuestions, {
      props: { questions: [sample('buttons')], answers: {}, showMissing: true }
    });
    expect(body).toContain('Answer this to continue.');
  });
  it('shows the chosen answer as pressed', () => {
    const question = sample('buttons');
    const { body } = render(CustomQuestions, {
      props: { questions: [question], answers: { [question.id]: question.options[1].id } }
    });
    expect(body).toContain('aria-pressed="true"');
  });
});

describe('QuestionCard', () => {
  it('renders collapsed and expanded for every type without error', () => {
    for (const type of types) {
      for (const expanded of [false, true]) {
        const { body } = render(QuestionCard, {
          props: {
            question: sample(type),
            expanded,
            sections: [
              { id: 'teleop', label: 'Teleop' },
              { id: 'auto', label: 'Auto' }
            ],
            problems: expanded ? ['Add the question text.'] : []
          }
        });
        expect(body).toContain(`Q ${type}`);
      }
    }
  });
});

describe('CoreCard', () => {
  const itemFor = (key, form = emptyForm()) => {
    const block = coreBlocksIn('match', key.split('.')[0]).find((entry) => entry.key === key);
    return { id: `core:${key}`, kind: 'core', block, view: coreView(form, block) };
  };
  it('lets an optional built-in question be reworded and hidden', () => {
    const { body } = render(CoreCard, { props: { item: itemFor('teleop.notes'), expanded: true } });
    for (const text of ['Real-scout observations', 'Built-in', 'Question wording', 'Shown to scouts'])
      expect(body).toContain(text);
  });
  it('keeps a required one visible and explains why', () => {
    const { body } = render(CoreCard, { props: { item: itemFor('teleop.roles'), expanded: true } });
    expect(body).toContain('Required');
    expect(body).toContain('Always shown');
    expect(body).not.toContain('Shown to scouts');
  });
  it('shows its override, hidden state and a reset', () => {
    const form = { ...emptyForm(), core: { 'teleop.notes': { label: 'Anything to add?', hidden: true } } };
    const { body } = render(CoreCard, { props: { item: itemFor('teleop.notes', form), expanded: true } });
    for (const text of ['Anything to add?', 'Hidden', 'Back to the default']) expect(body).toContain(text);
  });
  it('does not offer a rename for blocks that are several questions in one', () => {
    expect(render(CoreCard, { props: { item: itemFor('prematch.assignment'), expanded: true } }).body).toContain(
      'wording of this block is fixed'
    );
  });
});
