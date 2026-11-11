// Scouting Admin > Assignments > Shifts: the saved shift plan for an event. Anyone approved can read it (a scout can
// see their own shifts); saving needs the same access as publishing match assignments ("Manage match assignments").
// Publishing the plan as per-match assignments goes through /api/scout-assignments (bulk-assign), which checks again.
import { json } from '@sveltejs/kit';
import { requireApprovedUser } from '$lib/server/scouting/scoutingAccess.js';
import { computeAssignmentAccess } from '$lib/server/scouting/assignmentAccess.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { normalizeShift, validateShifts } from '$lib/scouting/shiftPlan.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const EVENT = /^[0-9a-z_-]{3,40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHIFTS = 400;
const fail = (error, status = 400) => json({ error }, { status, headers: NO_STORE });
const missing = (error) => /scout_shifts/.test(error?.message || '');
const MISSING = 'Shifts need the scout_shifts table; apply the database migrations.';

export async function GET({ request, url }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return fail(access.error, access.status);
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!EVENT.test(eventKey)) return fail('event_key required');
  const { data, error } = await getSupabase()
    .from('scout_shifts')
    .select('id, slot, start_match, end_match, assigned_user, updated_at')
    .eq('event_key', eventKey)
    .order('slot')
    .order('start_match');
  if (error) return fail(missing(error) ? MISSING : error.message, 500);
  return json(
    {
      success: true,
      shifts: (data || []).map((row) => normalizeShift(row)),
      canEdit: computeAssignmentAccess(access.profile, access.rosterKeys).canEditData
    },
    { headers: NO_STORE }
  );
}

export async function POST({ request }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return fail(access.error, access.status);
  if (!computeAssignmentAccess(access.profile, access.rosterKeys).canEditData)
    return fail('You need the "Manage match assignments" permission.', 403);
  const body = await request.json().catch(() => null);
  const eventKey = String(body?.event_key || '').trim();
  if (!EVENT.test(eventKey)) return fail('event_key required');
  const shifts = (Array.isArray(body?.shifts) ? body.shifts : []).slice(0, MAX_SHIFTS + 1).map(normalizeShift);
  if (shifts.length > MAX_SHIFTS) return fail(`A plan holds at most ${MAX_SHIFTS} shifts.`);
  if (shifts.some((shift) => shift.userId && !UUID.test(String(shift.userId)))) return fail('Invalid scout');
  const problems = validateShifts(shifts, { firstMatch: 1, lastMatch: 400 });
  if (problems.length) return fail(problems[0]);

  // The plan is replaced as a whole: what the admin sees is exactly what is stored.
  const db = getSupabase();
  const removed = await db.from('scout_shifts').delete().eq('event_key', eventKey);
  if (removed.error) return fail(missing(removed.error) ? MISSING : removed.error.message, 500);
  if (shifts.length) {
    const { error } = await db.from('scout_shifts').insert(
      shifts.map((shift) => ({
        event_key: eventKey,
        slot: shift.slot,
        start_match: shift.start,
        end_match: shift.end,
        assigned_user: shift.userId,
        created_by: access.actorId
      }))
    );
    if (error) return fail(error.message, 500);
  }
  return json({ success: true, saved: shifts.length }, { headers: NO_STORE });
}
