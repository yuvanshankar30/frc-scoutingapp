// Scouting Admin > Training. A training competition's matches are real past matches from The Blue Alliance; each
// one is stored under the next qualification number of the training code (see $lib/scouting/training.js), and
// scouts are assigned to its robots with ordinary data-scout assignments.
//
// GET  ?resource=overview&event_key=     competition codes (with their training flag), the chosen code's matches,
//                                         its assignments and the people who can be assigned
// GET  ?resource=events&year=            finished TBA events for a season (the search happens in the browser)
// GET  ?resource=matches&tba_event_key=  one TBA event's matches with teams, scores and video
// POST { action: 'set-training', event_key, enabled, name? }
// POST { action: 'add-match', event_key, source_match_key }
// POST { action: 'remove-match', event_key, match_key }
// POST { action: 'assign', event_key, items: [{ match_key, team_key, user_id|null }] }
import { json } from '@sveltejs/kit';
import { actorFor } from '$lib/server/scouting/scoutingAccess.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { nextTrainingMatchKey, simplifyTbaMatch, sortTbaMatches } from '$lib/scouting/training.js';
import { TbaError, tbaGet } from '$lib/server/integrations/tba.js';

const tba = (path) => tbaGet(path, { notFound: new TbaError('The Blue Alliance has no record of that.', 404) });

const isMissing = (error) =>
  ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(error?.code) ||
  /does not exist|schema cache/i.test(error?.message || '');
const UNAVAILABLE = 'Training mode needs the 20261013000000_scouting_tabs_and_training migration.';
const fail = (error, fallback = 500) =>
  json(
    { error: isMissing(error) ? UNAVAILABLE : error?.message || 'Request failed' },
    { status: isMissing(error) ? 503 : error?.status || fallback }
  );

function isApproved(profile) {
  if (profile?.banned) return false;
  const permissions = Array.isArray(profile?.permissions) ? profile.permissions : [];
  return profile?.role === 'admin' || permissions.includes('CAN_SEE_ROUTES');
}

async function overview(db, eventKey) {
  const [events, settings] = await Promise.all([
    db
      .from('scouting_events')
      .select('event_key, name, training, created_at')
      .order('created_at', { ascending: false }),
    db.from('scouting_settings').select('event_key').eq('id', 1).maybeSingle()
  ]);
  if (events.error) throw events.error;
  const result = {
    events: events.data || [],
    active_event_key: settings.data?.event_key || null,
    event_key: eventKey || null,
    matches: [],
    assignments: [],
    people: []
  };
  if (!eventKey) return result;

  const [matches, assignments, people] = await Promise.all([
    db.from('scouting_training_matches').select('*').eq('event_key', eventKey).order('created_at'),
    db
      .from('scout_match_assignments')
      .select('id, match_key, team_key, assigned_user, completed_at')
      .eq('scouting_type', 'data')
      .like('match_key', `${eventKey}\\_%`),
    db.from('user_profiles').select('id, full_name, email, role, permissions, banned')
  ]);
  if (matches.error) throw matches.error;
  if (assignments.error) throw assignments.error;
  result.matches = matches.data || [];
  result.assignments = assignments.data || [];
  result.people = (people.data || [])
    .filter(isApproved)
    .map((person) => ({ id: person.id, name: person.full_name || person.email || 'Unnamed' }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return result;
}

export async function GET({ request, url }) {
  const { actorId, canAdminister, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAdminister) return json({ error: 'Only scouting admins can manage training.' }, { status: 403 });
  const resource = url.searchParams.get('resource') || 'overview';
  try {
    if (resource === 'overview') {
      const eventKey = normalizeEventCode(url.searchParams.get('event_key') || '');
      return json({ success: true, data: await overview(db, eventKey) });
    }
    if (resource === 'events') {
      const year = Number(url.searchParams.get('year'));
      if (!Number.isInteger(year) || year < 1992 || year > 2100)
        return json({ error: 'Choose a season year.' }, { status: 400 });
      const events = await tba(`/events/${year}/simple`);
      return json({
        success: true,
        data: (events || []).map((event) => ({
          key: event.key,
          name: event.name,
          short_name: event.short_name || '',
          city: event.city || '',
          state_prov: event.state_prov || '',
          country: event.country || '',
          start_date: event.start_date,
          end_date: event.end_date,
          week: event.week ?? null,
          event_type: event.event_type
        }))
      });
    }
    if (resource === 'matches') {
      const tbaEventKey = String(url.searchParams.get('tba_event_key') || '')
        .trim()
        .toLowerCase();
      if (!/^\d{4}[a-z0-9]+$/.test(tbaEventKey)) return json({ error: 'Choose an event.' }, { status: 400 });
      const matches = await tba(`/event/${encodeURIComponent(tbaEventKey)}/matches`);
      return json({ success: true, data: sortTbaMatches((matches || []).map(simplifyTbaMatch)) });
    }
    return json({ error: 'Unknown resource' }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}

export async function POST({ request }) {
  const { actorId, canAdminister, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAdminister) return json({ error: 'Only scouting admins can manage training.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const eventKey = normalizeEventCode(body?.event_key || '');
  if (!eventKey) return json({ error: 'Enter a competition code like 2026training.' }, { status: 400 });

  try {
    if (body.action === 'set-training') {
      const { data: existing, error: readError } = await db
        .from('scouting_events')
        .select('event_key')
        .eq('event_key', eventKey)
        .maybeSingle();
      if (readError) throw readError;
      const row = { event_key: eventKey, training: body.enabled === true };
      if (!existing)
        Object.assign(row, {
          name:
            String(body.name || '')
              .trim()
              .slice(0, 120) || null,
          created_by: actorId
        });
      const { data, error } = await db
        .from('scouting_events')
        .upsert(row, { onConflict: 'event_key' })
        .select('event_key, name, training, created_at')
        .single();
      if (error) throw error;
      return json({ success: true, data });
    }

    const { data: event, error: eventError } = await db
      .from('scouting_events')
      .select('training')
      .eq('event_key', eventKey)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event?.training)
      return json({ error: `${eventKey} is not in training mode. Turn training on for it first.` }, { status: 409 });

    if (body.action === 'add-match') {
      const sourceKey = String(body.source_match_key || '')
        .trim()
        .toLowerCase();
      if (!/^\d{4}[a-z0-9]+_[a-z0-9]+$/.test(sourceKey)) return json({ error: 'Choose a match.' }, { status: 400 });
      const [match, sourceEvent, existing] = await Promise.all([
        tba(`/match/${encodeURIComponent(sourceKey)}`),
        tba(`/event/${encodeURIComponent(sourceKey.split('_')[0])}/simple`).catch(() => null),
        db.from('scouting_training_matches').select('match_key, source_match_key').eq('event_key', eventKey)
      ]);
      if (existing.error) throw existing.error;
      const already = (existing.data || []).find((row) => row.source_match_key === sourceKey);
      if (already)
        return json(
          { error: `That match is already training match ${already.match_key.split('_qm').pop()}.` },
          { status: 409 }
        );
      const simple = simplifyTbaMatch(match);
      if (simple.red.length + simple.blue.length === 0)
        return json({ error: 'TBA has no teams for that match yet.' }, { status: 422 });
      const row = {
        event_key: eventKey,
        match_key: nextTrainingMatchKey(
          eventKey,
          (existing.data || []).map((entry) => entry.match_key)
        ),
        source_event_key: sourceKey.split('_')[0],
        source_event_name: sourceEvent?.name || null,
        source_match_key: sourceKey,
        source_label: simple.label,
        red_team_keys: simple.red,
        blue_team_keys: simple.blue,
        video_key: simple.video_key,
        created_by: actorId
      };
      const { data, error } = await db.from('scouting_training_matches').insert(row).select('*').single();
      if (error) throw error;
      return json({ success: true, data });
    }

    if (body.action === 'remove-match') {
      const matchKey = String(body.match_key || '').trim();
      if (!matchKey.startsWith(`${eventKey}_`)) return json({ error: 'Choose a training match.' }, { status: 400 });
      // Reports already filed for the match stay; only the open assignments and the match itself go.
      const removed = await db
        .from('scout_match_assignments')
        .delete()
        .eq('scouting_type', 'data')
        .eq('match_key', matchKey)
        .is('completed_at', null);
      if (removed.error) throw removed.error;
      const { error } = await db
        .from('scouting_training_matches')
        .delete()
        .eq('event_key', eventKey)
        .eq('match_key', matchKey);
      if (error) throw error;
      return json({ success: true });
    }

    if (body.action === 'assign') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 600) : [];
      const { data: matches, error: matchError } = await db
        .from('scouting_training_matches')
        .select('match_key, red_team_keys, blue_team_keys')
        .eq('event_key', eventKey);
      if (matchError) throw matchError;
      const robots = new Map(
        (matches || []).map((match) => [match.match_key, new Set([...match.red_team_keys, ...match.blue_team_keys])])
      );
      for (const item of items) {
        if (!robots.get(item?.match_key)?.has(item?.team_key))
          return json(
            { error: `${item?.team_key || 'That robot'} is not in ${item?.match_key || 'that match'}.` },
            { status: 400 }
          );
      }
      // One scout per robot: clear whoever had the slot (unless they already finished it), then set the new scout.
      for (const item of items) {
        const cleared = await db
          .from('scout_match_assignments')
          .delete()
          .eq('scouting_type', 'data')
          .eq('match_key', item.match_key)
          .eq('team_key', item.team_key)
          .is('completed_at', null);
        if (cleared.error) throw cleared.error;
      }
      const rows = items
        .filter((item) => item.user_id)
        .map((item) => ({
          scouting_type: 'data',
          match_key: item.match_key,
          team_key: item.team_key,
          assigned_user: item.user_id
        }));
      if (rows.length) {
        const { error } = await db
          .from('scout_match_assignments')
          .upsert(rows, { onConflict: 'scouting_type,match_key,team_key,assigned_user' });
        if (error) throw error;
      }
      return json({ success: true, data: await overview(db, eventKey) });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
