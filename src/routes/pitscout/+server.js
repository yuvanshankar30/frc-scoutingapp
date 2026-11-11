import { json } from '@sveltejs/kit';
import { querySingle } from '$lib/server/supabaseClients.js';
import { requireScoutingActor, resolveEventKey } from '$lib/server/scouting/scoutingAccess.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { selectPitScoutEntries, upsertPitScoutEntry } from '$lib/server/scouting/pitScoutingSchema.js';
import { normalizeTeamKey } from '$lib/server/scouting/matchScoutingSchema.js';
import { customAnswersFor } from '$lib/server/scouting/customAnswers.js';
import {
  MAX_AUTO_DESCRIPTION_LENGTH,
  MAX_AUTO_NAME_LENGTH,
  MAX_AUTO_OPTIONS,
  MAX_DRIVEBASE_LENGTH,
  normalizeAutoPath,
  normalizeClimbOptions,
  normalizeTechnicalDetails
} from '$lib/scouting/pitForm.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_PIT_RECENT = 250;
function sanitizePhotoPaths(input) {
  if (!Array.isArray(input)) return [];
  const clean = input
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(
      (value) =>
        value.length > 0 &&
        value.length <= 250 &&
        !value.includes('..') &&
        !value.includes('\\') &&
        !value.startsWith('/') &&
        !value.toLowerCase().startsWith('match-starts/') &&
        !/[\u0000-\u001f]/.test(value)
    )
    .slice(0, 3);
  return [...new Set(clean)];
}

function sanitizeAutoOptions(input) {
  if (!Array.isArray(input)) return [];

  const clean = [];
  const seen = new Set();

  for (const value of input) {
    const name = String(value?.name || '')
      .trim()
      .slice(0, MAX_AUTO_NAME_LENGTH);
    const description = String(value?.description || '')
      .trim()
      .slice(0, MAX_AUTO_DESCRIPTION_LENGTH);
    if (!name || !description) continue;

    const path = normalizeAutoPath(value?.path);

    const key = `${name.toLowerCase()}::${description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ name, description, path });

    if (clean.length >= MAX_AUTO_OPTIONS) break;
  }

  return clean;
}

function sanitizeLongText(input, maxLength = 240) {
  return (
    String(input || '')
      .trim()
      .slice(0, maxLength) || null
  );
}

function sanitizeEstimatedBps(input) {
  if (input === null || input === undefined) return null;
  const raw = typeof input === 'string' ? input.trim() : input;
  if (raw === '') return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.round(parsed * 100) / 100;
}

function mergeWithExistingPitRow(
  existing,
  incoming,
  { clientSubmittedAt = null, removedPhotoPaths = null, photoUploadFailed = false } = {}
) {
  if (!existing || typeof existing !== 'object') return incoming;
  const merged = { ...incoming };
  const existingPhotos = sanitizePhotoPaths(existing.photo_paths);
  const incomingPhotos = sanitizePhotoPaths(merged.photo_paths);
  const removedSet = Array.isArray(removedPhotoPaths) ? new Set(removedPhotoPaths.map(String)) : null;

  const clientMs = Date.parse(String(clientSubmittedAt || ''));
  const existingMs = Date.parse(String(existing.updated_at || existing.created_at || ''));
  const isStaleReplay = Number.isFinite(clientMs) && Number.isFinite(existingMs) && existingMs > clientMs;

  if (existingPhotos.length > 0) {
    if (removedSet) {
      const kept = existingPhotos.filter((p) => !removedSet.has(p));
      merged.photo_paths = [...new Set([...kept, ...incomingPhotos])].slice(0, 3);
    } else if (photoUploadFailed || isStaleReplay || !incomingPhotos.length) {
      merged.photo_paths = [...new Set([...existingPhotos, ...incomingPhotos])].slice(0, 3);
    }
  }

  if (isStaleReplay) {
    const scalarFields = [
      'drivebase_type',
      'shooter_type',
      'hopper_type',
      'human_player_balls_in_auto',
      'scout_name',
      'robot_archetype',
      'additional_notes',
      'likely_breaking_component',
      'estimated_bps',
      'auto_points_estimate',
      'custom_form_version'
    ];
    for (const field of scalarFields) {
      const val = existing[field];
      if (val !== null && val !== undefined && val !== '') {
        merged[field] = val;
      }
    }
    for (const arrField of ['climb_options', 'auto_options']) {
      if (Array.isArray(existing[arrField]) && existing[arrField].length > 0) {
        merged[arrField] = [...existing[arrField]];
      }
    }
    for (const objField of ['technical_details', 'custom_answers']) {
      const existingObj = existing[objField] && typeof existing[objField] === 'object' ? existing[objField] : {};
      const incomingObj = merged[objField] && typeof merged[objField] === 'object' ? merged[objField] : {};
      const combined = { ...incomingObj };
      for (const [k, v] of Object.entries(existingObj)) {
        if (v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)) {
          combined[k] = v;
        }
      }
      merged[objField] = combined;
    }
    if (existing.updated_at) {
      merged.updated_at = existing.updated_at;
    }
  }

  return merged;
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    if (body?.action !== 'save-entry') {
      return json({ error: 'Invalid action' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db, actor } = auth;

    const rawEventKey = String(body?.event_key || '').trim();
    const team_key = normalizeTeamKey(body?.team_key);
    if (!rawEventKey || !team_key) {
      return json({ error: 'event_key and team_key are required' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const event_key = normalizeEventCode(rawEventKey);
    if (!event_key) {
      return json({ error: 'Invalid event_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    if (!/^frc\d{1,5}$/.test(team_key)) {
      return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const drivebase_type = sanitizeLongText(body?.drivebase_type, MAX_DRIVEBASE_LENGTH) || null;
    const shooter_type = body?.shooter_type || null;
    const hopper_type = body?.hopper_type || null;
    const human_player_balls_in_auto = body?.human_player_balls_in_auto || null;
    const scout_name = sanitizeLongText(body?.scout_name, 120);
    const robot_archetype = sanitizeLongText(body?.robot_archetype, 80);
    const additional_notes = sanitizeLongText(body?.additional_notes, 4000);
    const likely_breaking_component = sanitizeLongText(body?.likely_breaking_component);
    const estimated_bps = sanitizeEstimatedBps(body?.estimated_bps);
    const auto_points_estimate = sanitizeLongText(body?.auto_points_estimate, 40);
    const climb_options = normalizeClimbOptions(body?.climb_options);
    const photo_paths = sanitizePhotoPaths(body?.photo_paths);
    const auto_options = sanitizeAutoOptions(body?.auto_options);
    const technical_details = normalizeTechnicalDetails(body?.technical_details, { emptyNumber: null });

    const custom = await customAnswersFor(db, 'pit', body);
    if (custom.error) return json({ error: custom.error }, { status: 400, headers: PRIVATE_HEADERS });

    let payload = {
      event_key,
      team_key,
      drivebase_type,
      shooter_type,
      hopper_type,
      human_player_balls_in_auto,
      scout_name,
      robot_archetype,
      additional_notes,
      likely_breaking_component,
      estimated_bps,
      auto_points_estimate,
      climb_options,
      auto_options,
      technical_details,
      custom_answers: custom.answers,
      custom_form_version: custom.version,
      photo_paths,
      created_by: actor.id,
      updated_at: new Date().toISOString()
    };

    try {
      const existingRes = await selectPitScoutEntries(db, (query) =>
        querySingle(query.eq('event_key', event_key).eq('team_key', team_key))
      );
      if (existingRes?.data) {
        payload = mergeWithExistingPitRow(existingRes.data, payload, {
          clientSubmittedAt: body?.client_submitted_at || null,
          removedPhotoPaths: body?.removed_photo_paths || null,
          photoUploadFailed: body?.photo_upload_failed === true
        });
      }
    } catch {
      // ignore if mock db does not implement select before upsert
    }

    const result = await upsertPitScoutEntry(db, payload);
    if (result.error) return json({ error: result.error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json(
      {
        success: true,
        data: result.data,
        meta: {
          schema: result.schema,
          warning: result.warning
        }
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

    const rawEventKey = String(url.searchParams.get('event_key') || '').trim();
    const resolved = await resolveEventKey(db, rawEventKey);
    if (resolved.error) {
      return json({ error: resolved.error }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const event_key = resolved.eventKey;

    if (url.searchParams.get('resource') === 'pit-contacts') {
      let query = db
        .from('pit_scout_entries')
        .select('scout_name')
        .eq('event_key', event_key)
        .not('scout_name', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(MAX_PIT_RECENT);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json(
        {
          success: true,
          data: [...new Set((data || []).map((row) => String(row.scout_name || '').trim()).filter(Boolean))]
        },
        { headers: PRIVATE_HEADERS }
      );
    }

    const rawTeamKey = String(url.searchParams.get('team_key') || '').trim();
    if (rawTeamKey) {
      const team_key = normalizeTeamKey(rawTeamKey);
      if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
        return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const result = await selectPitScoutEntries(db, (query) =>
        querySingle(query.eq('event_key', event_key).eq('team_key', team_key))
      );

      if (result.error) return json({ error: result.error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json(
        {
          success: true,
          data: result.data || null,
          meta: {
            schema: result.schema,
            warning: result.warning
          }
        },
        { headers: PRIVATE_HEADERS }
      );
    }

    if (rawEventKey) {
      const result = await selectPitScoutEntries(db, (query) => {
        const ordered = query.eq('event_key', event_key).order('team_key', { ascending: true });
        return typeof ordered?.limit === 'function' ? ordered.limit(MAX_PIT_RECENT) : ordered;
      });

      if (result.error) return json({ error: result.error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json(
        {
          success: true,
          data: result.data || [],
          meta: {
            schema: result.schema,
            warning: result.warning
          }
        },
        { headers: PRIVATE_HEADERS }
      );
    }

    const requestedRecent = Number(url.searchParams.get('recent') || '100');
    const recent = Number.isFinite(requestedRecent)
      ? Math.min(Math.max(Math.trunc(requestedRecent), 1), MAX_PIT_RECENT)
      : 100;
    const result = await selectPitScoutEntries(db, (query) =>
      query.eq('event_key', event_key).order('updated_at', { ascending: false }).limit(recent)
    );

    if (result.error) return json({ error: result.error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json(
      {
        success: true,
        data: result.data || [],
        meta: {
          schema: result.schema,
          warning: result.warning
        }
      },
      { headers: PRIVATE_HEADERS }
    );
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
