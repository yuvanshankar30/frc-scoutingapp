import { json } from '@sveltejs/kit';
import { querySingle } from '$lib/server/supabaseClients.js';
import { requireScoutingActor, resolveEventKey } from '$lib/server/scouting/scoutingAccess.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { normalizeTeamKey } from '$lib/server/scouting/matchScoutingSchema.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_PICKLIST_ROWS = 250;
const MAX_NOTE_LENGTH = 2000;
const MAX_NICKNAME_LENGTH = 120;

/*
  Scouting Pick List API
  GET  ?event_key=... => ordered list of picked teams for that event (approved users only)
  POST actions:
    - add:     { event_key, team_key, team_number, nickname }
    - remove:  { id, event_key }
    - reorder: { event_key, ordered_ids: [id, id, ...], base_updated_at?, client_submitted_at? }
    - note:    { id, event_key, note }
*/
export async function GET({ url, request }) {
  const rawEventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!rawEventKey) {
    return json({ success: false, error: 'event_key required' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const event_key = normalizeEventCode(rawEventKey);
  if (!event_key) {
    return json({ success: false, error: 'Invalid event_key' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ success: false, error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }

    let query = auth.db
      .from('scouting_picklist')
      .select('*')
      .eq('event_key', event_key)
      .order('position', { ascending: true });
    if (typeof query?.limit === 'function') {
      query = query.limit(MAX_PICKLIST_ROWS);
    }

    const { data, error } = await query;
    if (error) return json({ success: false, error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ success: false, error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = body?.action;

    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ success: false, error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db, actor } = auth;

    if (action === 'add') {
      const { team_number, nickname } = body;
      const rawEventKey = String(body?.event_key || '').trim();
      const rawTeamKey = String(body?.team_key || '').trim();
      if (!rawEventKey || !rawTeamKey) {
        return json(
          { success: false, error: 'event_key and team_key required' },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }
      const event_key = normalizeEventCode(rawEventKey);
      if (!event_key) {
        return json({ success: false, error: 'Invalid event_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const team_key = normalizeTeamKey(rawTeamKey);
      if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
        return json({ success: false, error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }

      const { data: existing } = await db
        .from('scouting_picklist')
        .select('position')
        .eq('event_key', event_key)
        .order('position', { ascending: false })
        .limit(1);
      const nextPosition = (existing?.[0]?.position ?? -1) + 1;
      if (nextPosition >= MAX_PICKLIST_ROWS) {
        return json(
          { success: false, error: 'Pick list limit reached for this event' },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }

      const cleanNickname =
        String(nickname || '')
          .trim()
          .slice(0, MAX_NICKNAME_LENGTH) || null;
      const { data, error } = await db
        .from('scouting_picklist')
        .insert([
          {
            event_key,
            team_key,
            team_number: Number(team_number) || Number(team_key.replace(/^frc/, '')) || null,
            nickname: cleanNickname,
            position: nextPosition,
            created_by: actor.id
          }
        ])
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') {
          return json({ success: false, error: 'Already on the pick list' }, { status: 409, headers: PRIVATE_HEADERS });
        }
        return json({ success: false, error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      }
      return json({ success: true, data }, { headers: PRIVATE_HEADERS });
    }

    if (action === 'remove') {
      const id = String(body?.id || '').trim();
      if (!id) return json({ success: false, error: 'id required' }, { status: 400, headers: PRIVATE_HEADERS });

      const resolved = await resolveEventKey(db, body?.event_key);
      if (!resolved.eventKey) {
        return json(
          { success: false, error: resolved.error || 'event_key required' },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }

      const deleteQuery = db.from('scouting_picklist').delete().eq('id', id).eq('event_key', resolved.eventKey);

      const result = typeof deleteQuery?.select === 'function' ? await deleteQuery.select('id') : await deleteQuery;

      if (result?.error) {
        return json({ success: false, error: result.error.message }, { status: 500, headers: PRIVATE_HEADERS });
      }
      if (Array.isArray(result?.data) && result.data.length === 0) {
        return json(
          { success: false, error: 'Pick list entry not found for this event' },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      }
      return json({ success: true }, { headers: PRIVATE_HEADERS });
    }

    if (action === 'reorder') {
      const rawEventKey = String(body?.event_key || '').trim();
      const ordered_ids = body?.ordered_ids;
      if (!rawEventKey || !Array.isArray(ordered_ids)) {
        return json(
          { success: false, error: 'event_key and ordered_ids required' },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }
      const event_key = normalizeEventCode(rawEventKey);
      if (!event_key) {
        return json({ success: false, error: 'Invalid event_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      if (ordered_ids.length > MAX_PICKLIST_ROWS) {
        return json(
          { success: false, error: `Cannot reorder more than ${MAX_PICKLIST_ROWS} teams` },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }

      const baseTimestamp = body?.base_updated_at || body?.client_submitted_at || null;
      if (baseTimestamp) {
        const thresholdMs = Date.parse(String(baseTimestamp));
        if (Number.isFinite(thresholdMs)) {
          const { data: currentRows } = await db
            .from('scouting_picklist')
            .select('updated_at')
            .eq('event_key', event_key);
          const hasNewer = (currentRows || []).some((row) => {
            const rowMs = Date.parse(String(row?.updated_at || ''));
            return Number.isFinite(rowMs) && rowMs > thresholdMs;
          });
          if (hasNewer) {
            return json(
              { success: false, error: 'Pick list was updated more recently; refresh before reordering.' },
              { status: 409, headers: PRIVATE_HEADERS }
            );
          }
        }
      }

      const nowIso = new Date().toISOString();
      for (let i = 0; i < ordered_ids.length; i += 1) {
        const itemId = String(ordered_ids[i] ?? '').trim();
        if (!itemId) continue;
        const { error } = await db
          .from('scouting_picklist')
          .update({ position: i, updated_at: nowIso })
          .eq('id', itemId)
          .eq('event_key', event_key);
        if (error) return json({ success: false, error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      }
      return json({ success: true }, { headers: PRIVATE_HEADERS });
    }

    if (action === 'note') {
      const id = String(body?.id || '').trim();
      const note = body?.note;
      if (!id) return json({ success: false, error: 'id required' }, { status: 400, headers: PRIVATE_HEADERS });

      const resolved = await resolveEventKey(db, body?.event_key);
      if (!resolved.eventKey) {
        return json(
          { success: false, error: resolved.error || 'event_key required' },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }

      const cleanNote =
        String(note ?? '')
          .trim()
          .slice(0, MAX_NOTE_LENGTH) || null;
      const updateBuilder = db
        .from('scouting_picklist')
        .update({ note: cleanNote, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('event_key', resolved.eventKey)
        .select('*');

      const { data, error } = await querySingle(updateBuilder);
      if (error) return json({ success: false, error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      if (!data) {
        return json(
          { success: false, error: 'Pick list entry not found for this event' },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      }
      return json({ success: true, data }, { headers: PRIVATE_HEADERS });
    }

    return json({ success: false, error: 'Invalid action' }, { status: 400, headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ success: false, error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
