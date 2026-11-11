import { json } from '@sveltejs/kit';
import { decodeLogo } from '$lib/server/teamSettings.js';
import { actorFor } from '$lib/server/scouting/scoutingAccess.js';
import { FORM_TYPES, emptyForm, formProblems, sanitizeForm } from '$lib/scouting/forms/formSchema.js';

// The editable match and pit forms. Everyone signed in reads the live version; only scouting admins read
// drafts and history or change anything. Versions are immutable: restoring an old one publishes a new
// version with the old content, so the history only ever grows.

const MAX_NOTE = 300;
const formOf = (value) => (FORM_TYPES[value] ? value : null);

async function latest(db, form) {
  const { data, error } = await db
    .from('scouting_form_versions')
    .select('*')
    .eq('form_type', form)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { row: data || null, error };
}

const publicVersion = (row) =>
  row
    ? { version: row.version, schema: sanitizeForm(row.schema, row.form_type), published_at: row.published_at }
    : { version: 0, schema: emptyForm(), published_at: null };

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function GET({ url, request }) {
  const form = formOf(url.searchParams.get('form'));
  if (!form) return json({ error: 'form must be match or pit' }, { status: 400 });
  const { actorId, can, db } = await actorFor(request);
  const canAdminister = can('EDIT_FORMS');
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });

  if (url.searchParams.get('admin') !== '1') {
    const version = Number(url.searchParams.get('version'));
    if (Number.isInteger(version) && version > 0) {
      const { data } = await db
        .from('scouting_form_versions')
        .select('*')
        .eq('form_type', form)
        .eq('version', version)
        .maybeSingle();
      return json({ success: true, data: publicVersion(data) });
    }
    const { row, error } = await latest(db, form);
    // The tables arrive with a migration; until then the form is simply the built-in one.
    if (error && !/relation|does not exist|schema cache/i.test(error.message || ''))
      return json({ error: error.message }, { status: 500 });
    return json(
      { success: true, data: publicVersion(row) },
      { headers: { 'cache-control': 'private, max-age=0, must-revalidate' } }
    );
  }

  if (!canAdminister) return json({ error: 'Forbidden' }, { status: 403 });
  const [versionsRes, draftRes] = await Promise.all([
    db
      .from('scouting_form_versions')
      .select('*')
      .eq('form_type', form)
      .order('version', { ascending: false })
      .limit(100),
    db.from('scouting_form_drafts').select('*').eq('form_type', form).maybeSingle()
  ]);
  const error = versionsRes.error || draftRes.error;
  if (error)
    return json(
      { error: error.message, setup_needed: /relation|does not exist|schema cache/i.test(error.message || '') },
      { status: 500 }
    );
  const rows = versionsRes.data || [];
  const authorIds = [...new Set(rows.map((row) => row.published_by).filter(Boolean))];
  const { data: people } = authorIds.length
    ? await db.from('user_profiles').select('id, full_name, email').in('id', authorIds)
    : { data: [] };
  const names = new Map((people || []).map((person) => [person.id, person.full_name || person.email]));
  return json({
    success: true,
    data: {
      live_version: rows[0]?.version || 0,
      versions: rows.map((row) => ({
        version: row.version,
        schema: sanitizeForm(row.schema, form),
        note: row.note,
        restored_from: row.restored_from,
        published_at: row.published_at,
        published_by: names.get(row.published_by) || null
      })),
      draft: draftRes.data
        ? {
            schema: sanitizeForm(draftRes.data.schema, form),
            base_version: draftRes.data.base_version,
            updated_at: draftRes.data.updated_at
          }
        : null
    }
  });
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const form = formOf(body?.form);
    if (!form) return json({ error: 'form must be match or pit' }, { status: 400 });
    const { actorId, can, db } = await actorFor(request);
    const canAdminister = can('EDIT_FORMS');
    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAdminister) return json({ error: 'Forbidden' }, { status: 403 });
    const action = String(body?.action || '');

    // A picture for a question or an option (Edit > the designer). Stored with the team's other uploaded images; the
    // form only keeps its public address.
    if (action === 'upload-image') {
      const image = decodeLogo(body?.dataUrl);
      if (image.error) return json({ error: image.error.replace('logo', 'picture') }, { status: 400 });
      const path = `forms/${form}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${IMAGE_TYPES[image.type]}`;
      const uploaded = await db.storage.from('branding').upload(path, image.bytes, { contentType: image.type });
      if (uploaded.error) return json({ error: uploaded.error.message }, { status: 500 });
      return json({ success: true, data: { url: db.storage.from('branding').getPublicUrl(path).data.publicUrl } });
    }

    if (action === 'discard-draft') {
      const { error } = await db.from('scouting_form_drafts').delete().eq('form_type', form);
      return error ? json({ error: error.message }, { status: 500 }) : json({ success: true });
    }

    if (action !== 'save-draft' && action !== 'publish') return json({ error: 'Unknown action' }, { status: 400 });
    const schema = sanitizeForm(body?.schema, form);
    const baseVersion = Number.isInteger(body?.base_version) ? body.base_version : 0;

    if (action === 'save-draft') {
      const { error } = await db.from('scouting_form_drafts').upsert(
        {
          form_type: form,
          schema,
          base_version: baseVersion,
          updated_by: actorId,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'form_type' }
      );
      return error
        ? json({ error: error.message }, { status: 500 })
        : json({ success: true, data: { saved_at: new Date().toISOString() } });
    }

    const problems = formProblems(schema);
    if (Object.keys(problems).length)
      return json({ error: 'Fix the highlighted questions before publishing.', problems }, { status: 400 });
    const { row, error: readError } = await latest(db, form);
    if (readError) return json({ error: readError.message }, { status: 500 });
    const current = row?.version || 0;
    if (baseVersion !== current)
      return json(
        {
          error: `Version ${current} was published while you were editing. Reload to build on it.`,
          live_version: current
        },
        { status: 409 }
      );
    const restoredFrom = Number.isInteger(body?.restored_from) && body.restored_from > 0 ? body.restored_from : null;
    const note =
      String(body?.note || '')
        .trim()
        .slice(0, MAX_NOTE) || null;
    const { data, error } = await db
      .from('scouting_form_versions')
      .insert({
        form_type: form,
        version: current + 1,
        schema,
        note,
        restored_from: restoredFrom,
        published_by: actorId
      })
      .select('*')
      .single();
    if (error)
      return json(
        { error: error.code === '23505' ? 'Someone else just published. Reload to build on it.' : error.message },
        { status: error.code === '23505' ? 409 : 500 }
      );
    await db.from('scouting_form_drafts').delete().eq('form_type', form);
    return json({ success: true, data: { version: data.version, published_at: data.published_at } });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
