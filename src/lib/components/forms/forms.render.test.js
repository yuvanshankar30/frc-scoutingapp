import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CustomQuestions from './CustomQuestions.svelte';
import { QUESTION_TYPES, createQuestion } from '$lib/scouting/forms/formSchema.js';

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
