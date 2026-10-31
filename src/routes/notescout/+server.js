import { json } from '@sveltejs/kit';
import { requireScoutingActor, resolveEventKey } from '$lib/server/scouting/scoutingAccess.js';
import { escapeMatchKeyPrefix, normalizeEventCode } from '$lib/scouting/eventCode.js';
import { normalizeTeamKey } from '$lib/server/scouting/matchScoutingSchema.js';
import notescoutConfig from '$lib/scouting/notescout.json';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_NOTE_LENGTH = 4000;
const MAX_RECENT_NOTES = 1000;
const MAX_TEAM_NOTES = 500;
const MATCH_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/i;

function sanitizeRankingImpact(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -2 && parsed <= 2 ? parsed : 0;
}

async function insertScoutNote(db, payload) {
  let result = await db.from('scout_notes').insert([payload]).select('*').single();
  if (!result.error) return { ...result, rankingImpactSaved: true };

  const message = String(result.error.message || '').toLowerCase();
  if (!message.includes('ranking_impact') || (!message.includes('column') && !message.includes('schema cache'))) {
    return { ...result, rankingImpactSaved: false };
  }

  const { ranking_impact: _rankingImpact, ...legacyPayload } = payload;
  result = await db.from('scout_notes').insert([legacyPayload]).select('*').single();
  return { ...result, rankingImpactSaved: false };
}

// POST to save notes: expects { action: 'save-note', match_key, match_number,
// team_key, notes, ranking_impact }
export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (action !== 'save-note') {
      return json({ error: 'Invalid action' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db, actor } = auth;

    const rawMatchKey = String(body?.match_key || '').trim();
    const match_number = body?.match_number || null;
    const rawTeamKey = String(body?.team_key || '').trim();
    const notes = String(body?.notes ?? '').slice(0, MAX_NOTE_LENGTH);

    if (!rawMatchKey || !rawTeamKey) {
      return json({ error: 'match_key and team_key required' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    if (!MATCH_KEY_RE.test(rawMatchKey) || !normalizeEventCode(rawMatchKey.split('_')[0])) {
      return json({ error: 'Invalid match_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const team_key = normalizeTeamKey(rawTeamKey);
    if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
      return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const payload = {
      match_key: rawMatchKey,
      match_number: Number(match_number) || null,
      team_key,
      notes,
      ranking_impact: sanitizeRankingImpact(body.ranking_impact),
      created_by: actor.id,
      created_at: new Date().toISOString()
    };

    const { data, error, rankingImpactSaved } = await insertScoutNote(db, payload);
    if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json(
      {
        success: true,
        data,
        warning: rankingImpactSaved ? null : 'Note saved, but ranking impact requires the latest database migration.'
      },
      { headers: PRIVATE_HEADERS }
    );
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function GET({ url, request }) {
  try {
    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db } = auth;

    const rawTeamKey = String(url.searchParams.get('team_key') || '').trim();
    const rawEventKey = String(url.searchParams.get('event_key') || '').trim();
    const resolved = await resolveEventKey(db, rawEventKey, { fallbackEventKey: notescoutConfig?.event_key });
    if (resolved.error) {
      return json({ error: resolved.error }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const escapedPrefix = escapeMatchKeyPrefix(resolved.eventKey);
    const applyEventFilter = (query) => (escapedPrefix ? query.ilike('match_key', escapedPrefix) : query);

    if (rawTeamKey) {
      const team_key = normalizeTeamKey(rawTeamKey);
      if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
        return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      let query = db.from('scout_notes').select('*').eq('team_key', team_key);
      query = applyEventFilter(query).order('created_at', { ascending: false });
      if (typeof query?.limit === 'function') {
        query = query.limit(MAX_TEAM_NOTES);
      }
      const { data, error } = await query;

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
    }

    if (url.searchParams.get('list_teams')) {
      const requestedRecent = Number(url.searchParams.get('recent') || '1000');
      const recent = Number.isFinite(requestedRecent)
        ? Math.min(Math.max(Math.trunc(requestedRecent), 1), MAX_RECENT_NOTES)
        : MAX_RECENT_NOTES;
      let query = db.from('scout_notes').select('team_key');
      query = applyEventFilter(query);
      const { data, error } = await query.order('team_key', { ascending: true }).limit(recent);

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });

      const seen = new Set();
      const teams = [];
      for (const row of data || []) {
        const t = row?.team_key;
        if (t && !seen.has(t)) {
          seen.add(t);
          teams.push(t);
        }
      }
      return json({ success: true, data: teams }, { headers: PRIVATE_HEADERS });
    }

    const requestedRecent = Number(url.searchParams.get('recent') || '50');
    const recent = Number.isFinite(requestedRecent)
      ? Math.min(Math.max(Math.trunc(requestedRecent), 1), MAX_RECENT_NOTES)
      : 50;
    let query = db.from('scout_notes').select('*');
    query = applyEventFilter(query);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(recent);

    if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
