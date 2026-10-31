import { describe, expect, it } from 'vitest';
import { createQuestion } from '$lib/scouting/forms/formSchema.js';
import { customAnswersFor } from './customAnswers.js';

const dbWith = (row, error = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) })
});
const question = { ...createQuestion('buttons', 'teleop'), label: 'Climbed?', required: true };

describe('customAnswersFor', () => {
  it('attaches nothing when the report has no form version', async () => {
    expect(await customAnswersFor(dbWith(null), 'match', {})).toEqual({ answers: {}, version: null, error: null });
  });
  it('keeps valid answers against the version they were answered with', async () => {
    const db = dbWith({ schema: { questions: [question] } });
    const body = { custom_form_version: 3, custom_answers: { [question.id]: question.options[0].id, ghost: 'x' } };
    expect(await customAnswersFor(db, 'match', body)).toEqual({
      answers: { [question.id]: question.options[0].id },
      version: 3,
      error: null
    });
  });
  it('rejects a report that skips a required added question', async () => {
    const db = dbWith({ schema: { questions: [question] } });
    const result = await customAnswersFor(db, 'match', { custom_form_version: 3, custom_answers: {} });
    expect(result.error).toContain('Climbed?');
  });
  it('tolerates the tables not existing yet', async () => {
    const result = await customAnswersFor(dbWith(null, { message: 'relation does not exist' }), 'match', {
      custom_form_version: 3,
      custom_answers: { a: 1 }
    });
    expect(result).toEqual({ answers: {}, version: null, error: null });
  });
});
