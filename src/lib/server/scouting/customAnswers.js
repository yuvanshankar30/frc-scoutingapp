import { createLayout, firstMissing, sanitizeAnswers, sanitizeForm, shownOnKind } from '$lib/scouting/forms/formSchema.js';
import { ALL_REQUIRED } from '$lib/scouting/matchScouting.js';

// A report carries the answers to the questions an admin added, plus the form version they were
// answered against. They are checked against that version rather than the live one, so a report
// started before a new version went live (or queued while offline) is still judged by what the scout saw.
export async function customAnswersFor(db, form, body) {
  const version =
    Number.isInteger(body?.custom_form_version) && body.custom_form_version > 0 ? body.custom_form_version : 0;
  if (!version) return { answers: {}, version: null, error: null };
  const { data, error } = await db
    .from('scouting_form_versions')
    .select('schema')
    .eq('form_type', form)
    .eq('version', version)
    .maybeSingle();
  // Until the forms tables exist, or if the version is gone, there is nothing to attach.
  if (error || !data) return { answers: {}, version: null, error: null };
  const schema = sanitizeForm(data.schema, form);
  const answers = sanitizeAnswers(schema, body.custom_answers);
  // A match report only has to answer the questions shown on its kind (data, performance or robot).
  const kind = form === 'match' ? String(body?.report_kind || 'data') : '';
  const missing = firstMissing(
    schema.questions.filter((question) => shownOnKind(question, kind)),
    answers
  );
  return {
    answers,
    version,
    error: missing ? `Answer “${missing.label || 'the added question'}” before submitting.` : null
  };
}

/**
 * Which built-in questions a report has to answer, from the form version it was answered against: a question the
 * admin hid or made optional is not demanded. Without a version (an older page, or no form published) everything
 * the built-in form requires is required.
 */
export async function formRulesFor(db, form, body) {
  const version =
    Number.isInteger(body?.custom_form_version) && body.custom_form_version > 0 ? body.custom_form_version : 0;
  if (!version) return ALL_REQUIRED;
  const { data, error } = await db
    .from('scouting_form_versions')
    .select('schema')
    .eq('form_type', form)
    .eq('version', version)
    .maybeSingle();
  if (error || !data) return ALL_REQUIRED;
  return createLayout(sanitizeForm(data.schema, form), form);
}
