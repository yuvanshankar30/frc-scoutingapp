import { json } from '@sveltejs/kit';
import { actorFor } from '$lib/server/scouting/scoutingAccess.js';

/*
  Scouting deadlines: when the reports for each qualification match are due.
  GET /api/scouting-deadlines?event_key=2026cc       anyone signed in
  PUT /api/scouting-deadlines                        Scouting Admins only
      { event_key, deadlines: [{ match_key, due_at }] }   due_at null removes the deadline
*/

const MAX_BATCH = 300;
const validKey = (value) => typeof value === 'string' && /^[a-z0-9]+_[a-z]+\d+(m\d+)?$/i.test(value);

export async function GET({ url, request }) {
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });
  const { actorId, canAdminister, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await db
    .from('scout_match_deadlines')
    .select('match_key, due_at, updated_at')
    .eq('event_key', eventKey)
    .order('due_at', { ascending: true });
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data: data || [], can_edit: canAdminister, now: new Date().toISOString() });
}

export async function PUT({ request }) {
  const { actorId, canAdminister, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAdminister) return json({ error: 'Only Scouting Admins can set deadlines.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const eventKey = String(body?.event_key || '').trim();
  const items = Array.isArray(body?.deadlines) ? body.deadlines : null;
  if (!eventKey || !items) return json({ error: 'event_key and deadlines are required' }, { status: 400 });
  if (items.length > MAX_BATCH)
    return json({ error: `Send at most ${MAX_BATCH} deadlines at a time.` }, { status: 400 });

  const upserts = [];
  const removals = [];
  for (const item of items) {
    const matchKey = String(item?.match_key || '').trim();
    if (!validKey(matchKey) || !matchKey.startsWith(`${eventKey}_`))
      return json({ error: `Not a match of ${eventKey}: ${matchKey}` }, { status: 400 });
    if (item.due_at === null) {
      removals.push(matchKey);
      continue;
    }
    const due = new Date(item.due_at);
    if (Number.isNaN(due.getTime())) return json({ error: `Not a valid time for ${matchKey}` }, { status: 400 });
    upserts.push({
      event_key: eventKey,
      match_key: matchKey,
      due_at: due.toISOString(),
      set_by: actorId,
      updated_at: new Date().toISOString()
    });
  }

  if (upserts.length) {
    const { error } = await db.from('scout_match_deadlines').upsert(upserts, { onConflict: 'event_key,match_key' });
    if (error) return json({ error: error.message }, { status: 500 });
  }
  if (removals.length) {
    const { error } = await db
      .from('scout_match_deadlines')
      .delete()
      .eq('event_key', eventKey)
      .in('match_key', removals);
    if (error) return json({ error: error.message }, { status: 500 });
  }
  return json({ success: true, saved: upserts.length, removed: removals.length });
}
