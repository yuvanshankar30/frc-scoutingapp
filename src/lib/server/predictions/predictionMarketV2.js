import { dbClient } from '$lib/server/supabaseClients.js';
import { calibratedScale, computeEventEpa, predictAllianceScore, winProbability } from '$lib/matches/epaModel.js';
import { isApprovedProfile } from '$lib/server/scouting/scoutingAccess.js';
import { TbaError, tbaGet } from '$lib/server/integrations/tba.js';

export const ELO_K = 32;

export async function requireActor(client) {
  const { data } = await client.auth.getUser();
  const user = data?.user || null;
  if (!user?.id) return null;
  const db = typeof client?.from === 'function' ? client : dbClient(client);
  if (typeof db?.from === 'function') {
    const { data: profileRow } = await db
      .from('user_profiles')
      .select('id, role, permissions, general_role, banned')
      .eq('id', user.id)
      .maybeSingle();
    const profile = Array.isArray(profileRow) ? profileRow[0] : profileRow;
    if (!isApprovedProfile(profile)) return null;
  }
  return user;
}

function eventYear(eventKey) {
  const value = String(eventKey || '').trim();
  return /^20\d{2}/.test(value) ? value.slice(0, 4) : null;
}

// Any FRC event is fair game, not just the ones your team attends; this only confirms The Blue Alliance knows it.
export async function assertScopedEvent(eventKey) {
  const key = String(eventKey || '').trim();
  if (!eventYear(key)) throw new Error('event_key must begin with a four-digit FRC year');
  await tbaGet(`/event/${encodeURIComponent(key)}/simple`, {
    notFound: new TbaError('Event not found on The Blue Alliance', 404)
  });
  return key;
}

export async function fetchScopedEventMatches(eventKey) {
  const key = await assertScopedEvent(eventKey);
  const matches = await tbaGet(`/event/${encodeURIComponent(key)}/matches`);
  return { eventKey: key, matches: Array.isArray(matches) ? matches : [] };
}

export async function fetchScopedAlliances(eventKey) {
  const key = await assertScopedEvent(eventKey);
  const alliances = await tbaGet(`/event/${encodeURIComponent(key)}/alliances`, { notFound: [] });
  return { eventKey: key, alliances: Array.isArray(alliances) ? alliances : [] };
}

export function isCompletedMatch(match) {
  return Boolean(match?.actual_time) && ['red', 'blue', ''].includes(match?.winning_alliance);
}

export function matchLockTime(match) {
  const time = Number(match?.predicted_time ?? match?.time ?? 0);
  return Number.isFinite(time) && time > 0 ? time : null;
}

export function matchStatus(match, now = Date.now() / 1000) {
  if (isCompletedMatch(match)) return 'completed';
  const lockTime = matchLockTime(match);
  return lockTime && now >= lockTime ? 'locked' : 'upcoming';
}

// Only the columns the EPA model reads from match scouting (#171).
const EPA_SCOUT_COLUMNS =
  'id,match_key,team_key,report_kind,created_by,scout_name,balls_scored_average,auto_points_average,ratings,teleop_roles,defense_rating,power_ranking,teleop_robot_status,mechanical_break,significant_crash,beached,post_notes';
// robot_present only exists once its migration has run; reads fall back to the columns above without it.
const EPA_SCOUT_COLUMNS_WITH_PRESENT = `${EPA_SCOUT_COLUMNS},robot_present`;
const SCOUT_PAGE_SIZE = 1000;

// Scouting sharpens the model but never blocks it: a failed read (no table
// on a local database, RLS) just means the model runs on scores alone.
export async function fetchEpaScoutEntries(db, eventKey) {
  if (typeof db?.from !== 'function' || !eventKey) return [];
  const rows = [];
  let columns = EPA_SCOUT_COLUMNS_WITH_PRESENT;
  try {
    for (let from = 0; ; from += SCOUT_PAGE_SIZE) {
      const { data, error } = await db
        .from('match_scout_entries')
        .select(columns)
        .eq('event_key', eventKey)
        .order('id')
        .range(from, from + SCOUT_PAGE_SIZE - 1);
      if (error && columns !== EPA_SCOUT_COLUMNS && /robot_present/.test(error.message || '')) {
        columns = EPA_SCOUT_COLUMNS;
        from -= SCOUT_PAGE_SIZE;
        continue;
      }
      if (error) return rows;
      rows.push(...(data || []));
      if (!data || data.length < SCOUT_PAGE_SIZE) return rows;
    }
  } catch {
    return rows;
  }
}

// The scouting group's best-to-worst ranking of each match (Strategy > match rankings); empty when unavailable.
export async function fetchEpaMatchRankings(db, eventKey) {
  if (typeof db?.from !== 'function' || !eventKey) return [];
  try {
    const { data, error } = await db
      .from('scouting_match_rankings')
      .select('match_key,ranked_team_keys')
      .eq('event_key', eventKey);
    return error ? [] : data || [];
  } catch {
    return [];
  }
}

/** Everything the EPA model reads for an event: match scouting reports and the scouts' match rankings. */
export async function fetchEpaScouting(db, eventKey) {
  const [scoutEntries, matchRankings] = await Promise.all([
    fetchEpaScoutEntries(db, eventKey),
    fetchEpaMatchRankings(db, eventKey)
  ]);
  return { scoutEntries, matchRankings };
}

export function eventModel(matches, scouting = {}) {
  const epa = computeEventEpa(matches, {
    scoutEntries: Array.isArray(scouting) ? scouting : scouting.scoutEntries || [],
    matchRankings: Array.isArray(scouting) ? [] : scouting.matchRankings || []
  });
  const scale = calibratedScale(epa.residualStd);
  const probabilities = new Map();
  for (const match of matches || []) {
    const redKeys = match?.alliances?.red?.team_keys || [];
    const blueKeys = match?.alliances?.blue?.team_keys || [];
    const red = predictAllianceScore(epa, redKeys, blueKeys);
    const blue = predictAllianceScore(epa, blueKeys, redKeys);
    probabilities.set(match.key, winProbability(red, blue, scale));
  }
  return probabilities;
}

export async function lockStartedPicks(db, eventKey, matches) {
  const now = Date.now() / 1000;
  for (const match of matches || []) {
    const lockTime = matchLockTime(match);
    if (!lockTime || lockTime > now) continue;
    await db
      .from('pm_match_picks')
      .update({ locked: true })
      .eq('event_key', eventKey)
      .eq('match_key', match.key)
      .eq('locked', false);
  }
}

export function communityBreakdown(picks) {
  const red = (picks || []).filter((pick) => pick.side === 'red').length;
  const blue = (picks || []).filter((pick) => pick.side === 'blue').length;
  const total = red + blue;
  return { red, blue, total };
}

export function publicMatch(match, modelProbabilityRed, picks, actorId) {
  const breakdown = communityBreakdown(picks);
  const myPick = (picks || []).find((pick) => pick.user_id === actorId)?.side || null;
  return {
    match_key: match.key,
    red_teams: match?.alliances?.red?.team_keys || [],
    blue_teams: match?.alliances?.blue?.team_keys || [],
    model_probability_red: modelProbabilityRed,
    my_pick: myPick,
    community_red_pct: breakdown.total ? breakdown.red / breakdown.total : 0,
    community_blue_pct: breakdown.total ? breakdown.blue / breakdown.total : 0,
    status: matchStatus(match)
  };
}

function historyKey(row) {
  return `${row.user_id}:${row.event_key}:${row.match_key}`;
}

function isDuplicate(error) {
  return error?.code === '23505' || /duplicate key/i.test(error?.message || '');
}

export function eloDelta(pickedSide, winningSide, modelProbabilityRed) {
  const probability = pickedSide === 'red' ? modelProbabilityRed : 1 - modelProbabilityRed;
  const actual = pickedSide === winningSide ? 1 : 0;
  return { probability, delta: ELO_K * (actual - probability) };
}

export async function resolveOutstandingElo(db, eventKey, matches) {
  await lockStartedPicks(db, eventKey, matches);
  const { data: picks, error: picksError } = await db
    .from('pm_match_picks')
    .select('id,user_id,event_key,match_key,side,picked_at,locked')
    .eq('event_key', eventKey);
  if (picksError) throw picksError;

  const { data: history, error: historyError } = await db
    .from('pm_elo_history')
    .select('user_id,event_key,match_key')
    .eq('event_key', eventKey);
  if (historyError) throw historyError;

  const resolved = new Set((history || []).map(historyKey));
  const byMatch = new Map();
  for (const pick of picks || []) {
    if (!byMatch.has(pick.match_key)) byMatch.set(pick.match_key, []);
    byMatch.get(pick.match_key).push(pick);
  }

  const probabilities = eventModel(matches, await fetchEpaScouting(db, eventKey));
  for (const match of matches || []) {
    if (!isCompletedMatch(match)) continue;
    const matchPicks = byMatch.get(match.key) || [];
    if (!matchPicks.length) continue;
    await db
      .from('pm_match_picks')
      .update({ locked: true })
      .eq('event_key', eventKey)
      .eq('match_key', match.key)
      .eq('locked', false);
    const modelProbabilityRed = probabilities.get(match.key) ?? 0.5;

    for (const pick of matchPicks) {
      if (resolved.has(historyKey(pick))) continue;
      const { probability, delta } = eloDelta(pick.side, match.winning_alliance, modelProbabilityRed);
      const { data: rating, error: ratingError } = await db
        .from('pm_elo_ratings')
        .select('elo,events_participated')
        .eq('user_id', pick.user_id)
        .maybeSingle();
      if (ratingError) throw ratingError;
      const currentElo = Number(rating?.elo ?? 1000);
      const eloAfter = currentElo + delta;
      const { error: insertError } = await db.from('pm_elo_history').insert({
        user_id: pick.user_id,
        event_key: eventKey,
        match_key: match.key,
        picked_side: pick.side,
        model_probability: probability,
        elo_delta: delta,
        elo_after: eloAfter
      });
      if (insertError) {
        if (isDuplicate(insertError)) continue;
        throw insertError;
      }
      const { data: userHistory, error: userHistoryError } = await db
        .from('pm_elo_history')
        .select('event_key')
        .eq('user_id', pick.user_id);
      if (userHistoryError) throw userHistoryError;
      const eventsParticipated = new Set((userHistory || []).map((row) => row.event_key)).size;
      const { error: ratingWriteError } = await db.from('pm_elo_ratings').upsert(
        {
          user_id: pick.user_id,
          elo: eloAfter,
          events_participated: eventsParticipated,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
      if (ratingWriteError) throw ratingWriteError;
      resolved.add(historyKey(pick));
    }
  }
}

export async function resolveAllianceDraft(db, eventKey) {
  const { alliances } = await fetchScopedAlliances(eventKey);
  if (!alliances.length) return;
  const { data: pending, error } = await db
    .from('pm_alliance_draft_picks')
    .select('id,predicted_captain,predicted_pick,pick_round')
    .eq('event_key', eventKey)
    .is('resolved_at', null);
  if (error) throw error;
  const resolvedAt = new Date().toISOString();
  for (const prediction of pending || []) {
    const correct = alliances.some((alliance) => {
      const picks = alliance?.picks || [];
      return picks[0] === prediction.predicted_captain && picks[prediction.pick_round] === prediction.predicted_pick;
    });
    await db
      .from('pm_alliance_draft_picks')
      .update({ resolved_at: resolvedAt, correct })
      .eq('id', prediction.id)
      .is('resolved_at', null);
  }
}

export function eventKeyFromMatchKey(matchKey) {
  const value = String(matchKey || '').trim();
  const separator = value.lastIndexOf('_');
  return separator > 4 ? value.slice(0, separator) : null;
}

export async function profileNames(db, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await db.from('user_profiles').select('id,full_name').in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((profile) => [profile.id, profile.full_name || 'Scout']));
}
