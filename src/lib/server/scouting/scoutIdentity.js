// Who actually scouted a match report (#123 step 3). created_by is the account that submitted it, but
// scouts share phones and some profiles still carry an email as their name, so the typed scout_name
// isn't a copy of the profile name. scouted_by links the report to the person who scouted when that
// can be known for sure; scout_name stays as the typed fallback.

const normalName = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const isRealName = (value) => Boolean(normalName(value)) && !String(value).includes('@');

/**
 * The account of the scout who filled in the report: the submitter when the typed name is theirs (or
 * their profile has no real name yet), another account when the typed name is exactly one other
 * profile's name, otherwise null.
 */
export async function resolveScoutedBy(db, { actorId, actorName, scoutName }) {
  const typed = normalName(scoutName);
  if (!typed || typed === normalName(actorName)) return actorId;
  const { data, error } = await db
    .from('user_profiles')
    .select('id, full_name')
    .ilike(
      'full_name',
      String(scoutName)
        .trim()
        .replace(/[\\%_]/g, '\\$&')
    );
  const matches = error ? [] : (data || []).filter((row) => normalName(row.full_name) === typed);
  if (matches.length === 1) return matches[0].id;
  // No account has this name: on the submitter's own phone that's the submitter, whose profile just
  // hasn't got a real name yet. Anyone else's typed name stays text only.
  if (!matches.length && !isRealName(actorName)) return actorId;
  return null;
}

/** The name to show for a report's scout, given profiles by id ({ full_name, email }). */
export function scoutDisplayName(entry, profilesById) {
  const linked = entry?.scouted_by ? profilesById.get(entry.scouted_by) : null;
  if (isRealName(linked?.full_name)) return linked.full_name.trim();
  if (String(entry?.scout_name || '').trim()) return entry.scout_name.trim();
  const submitter = profilesById.get(entry?.created_by);
  return submitter?.full_name || submitter?.email || null;
}

/** Profiles for every scout and submitter on these reports, by id. */
export async function scoutProfilesFor(db, entries) {
  const ids = [...new Set((entries || []).flatMap((entry) => [entry.created_by, entry.scouted_by]).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await db.from('user_profiles').select('id, full_name, email').in('id', ids);
  return new Map((data || []).map((row) => [row.id, row]));
}
