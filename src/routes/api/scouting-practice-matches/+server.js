import { json } from '@sveltejs/kit';
import { clientFromRequest, userFor, isMissingTable } from '$lib/server/supabaseClients.js';
import { buildPracticeMatch } from '$lib/server/scouting/practiceMatches.js';

export async function GET({ request, url }) {
  const db = clientFromRequest(request);
  if (!(await userFor(db))) return json({ error: 'Unauthorized' }, { status: 401 });
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });
  const { data, error } = await db
    .from('scouting_practice_matches')
    .select('id,event_key,match_key,label,created_by,created_at')
    .eq('event_key', eventKey)
    .order('created_at', { ascending: true });
  if (error && isMissingTable(error, 'scouting_practice_matches'))
    return json({ success: true, data: [], unavailable: true });
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data: data || [] });
}

// Every practice match is just the next number for the event - "Add
// practice match" needs no form, so there's nothing else for the caller to
// supply beyond which event it belongs to.
export async function POST({ request }) {
  const db = clientFromRequest(request);
  const actor = await userFor(db);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.action !== 'add') return json({ error: 'Invalid action' }, { status: 400 });
  const eventKey = String(body?.event_key || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });

  const { count, error: countError } = await db
    .from('scouting_practice_matches')
    .select('id', { count: 'exact', head: true })
    .eq('event_key', eventKey);
  if (countError && isMissingTable(countError, 'scouting_practice_matches')) {
    return json(
      {
        error: 'Practice matches are unavailable until the migration is applied.',
        code: 'SCOUTING_PRACTICE_MATCHES_UNAVAILABLE'
      },
      { status: 503 }
    );
  }
  if (countError) return json({ error: countError.message }, { status: 500 });

  const { match_key, label } = buildPracticeMatch(eventKey, count);
  const { data, error } = await db
    .from('scouting_practice_matches')
    .insert({ event_key: eventKey, match_key, label, created_by: actor.id })
    .select('id,event_key,match_key,label,created_by,created_at')
    .single();
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data });
}
