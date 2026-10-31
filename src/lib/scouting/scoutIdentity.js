// Who the signed-in scout is, for the personal phone screens (My Reports, Scout): first name, a
// greeting for the time of day, and the scout roles they hold on Scouting Admin > People.
import { defaultReportKind, REPORT_KIND_ROLES } from '$lib/scouting/reportKinds.js';

export const KIND_ROLE_LABELS = Object.freeze({
  data: 'Data scout',
  performance: 'Performance scout',
  robot: 'Robot scout'
});

export function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(profile) {
  const name = String(profile?.full_name || '').trim();
  if (name) return name.split(/\s+/)[0];
  const email = String(profile?.email || '').split('@')[0];
  return email ? email.charAt(0).toUpperCase() + email.slice(1) : 'Scout';
}

/** { firstName, greeting, kind, roles: ['Performance scout', ...], isLead } for a user_profiles row with roster_keys. */
export function scoutIdentity(profile, date = new Date()) {
  const keys = new Set(
    (profile?.roster_keys || []).map((key) =>
      String(key || '')
        .trim()
        .toLowerCase()
    )
  );
  const roles = Object.entries(REPORT_KIND_ROLES)
    .filter(([role]) => keys.has(role.toLowerCase()))
    .map(([, kind]) => KIND_ROLE_LABELS[kind]);
  return {
    firstName: firstName(profile),
    greeting: greetingFor(date),
    kind: defaultReportKind(profile?.roster_keys),
    roles,
    isLead: keys.has('scouting lead')
  };
}
