import { env } from '$env/dynamic/private';
import { getSupabase } from '$lib/server/serviceClient.js';
import { getSlackClient, slackConfigured, slackUserIdForEmail } from '$lib/server/integrations/slack.js';
import { NOTIFICATION_KEYS } from '$lib/notifications/constants.js';
import { mergeNotificationSettings } from '$lib/notifications/settings.js';
import { formatLocalTimeWithZone } from '$lib/app/timezone.js';

function formatMatchLabel(matchKey = '') {
  if (!matchKey) return 'match';
  const parts = matchKey.split('_');
  const last = parts[parts.length - 1] || matchKey;
  if (/^qm\d+/i.test(last)) {
    return `Qualification ${last.replace(/^qm/i, '')}`;
  }
  if (/^sf\d+/i.test(last)) {
    return `Semi ${last.replace(/^sf/i, '')}`;
  }
  if (/^f\d+/i.test(last)) {
    return `Final ${last.replace(/^f/i, '')}`;
  }
  return last.toUpperCase();
}

async function fetchNotificationUser(userId, supa) {
  if (!userId) return null;
  const { data } = await supa
    .from('user_profiles')
    .select('id, email, full_name, notification_settings, slack_user_id, slack_dm_channel')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

async function ensureSlackUserId(user, supa) {
  if (user.slack_user_id) return user.slack_user_id;
  if (!user.email) return null;
  const slackId = await slackUserIdForEmail(user.email);
  if (slackId) {
    await supa.from('user_profiles').update({ slack_user_id: slackId }).eq('id', user.id);
    user.slack_user_id = slackId;
  }
  return slackId;
}

async function ensureSlackDmChannel(user, supa) {
  if (user.slack_dm_channel) return user.slack_dm_channel;
  const slackUserId = await ensureSlackUserId(user, supa);
  if (!slackUserId) return null;
  const client = getSlackClient();
  const response = await client.conversations.open({ users: slackUserId });
  if (response?.ok && response.channel?.id) {
    const channel = response.channel.id;
    await supa.from('user_profiles').update({ slack_dm_channel: channel }).eq('id', user.id);
    user.slack_dm_channel = channel;
    return channel;
  }
  return null;
}

async function recordNotificationLog(supa, userId, notificationKey, entityKey) {
  if (!entityKey) return;
  const { data: existing } = await supa
    .from('user_notification_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', notificationKey)
    .eq('entity_key', entityKey)
    .maybeSingle();
  if (existing) {
    throw new Error('duplicate_notification');
  }
  await supa
    .from('user_notification_logs')
    .insert({ user_id: userId, event_type: notificationKey, entity_key: entityKey });
}

async function releaseNotificationLog(supa, userId, notificationKey, entityKey) {
  if (!entityKey) return;
  await supa
    .from('user_notification_logs')
    .delete()
    .eq('user_id', userId)
    .eq('event_type', notificationKey)
    .eq('entity_key', entityKey);
}

// releaseOnFailure: scheduled reminders claim their dedupe key before sending,
// so a failed send (no Slack link yet, Slack outage) must give the key back or
// that reminder would never be retried on the next sweep.
export async function dispatchNotification({
  userId,
  notificationKey,
  entityKey = null,
  text,
  blocks = null,
  releaseOnFailure = false
}) {
  if (!slackConfigured()) return { ok: false, reason: 'slack-not-configured' };
  const supa = getSupabase();
  const user = await fetchNotificationUser(userId, supa);
  if (!user) return { ok: false, reason: 'missing-user' };

  const settings = mergeNotificationSettings(user.notification_settings);
  if (settings[notificationKey] === false) {
    return { ok: false, reason: 'disabled' };
  }

  try {
    await recordNotificationLog(supa, user.id, notificationKey, entityKey);
  } catch (err) {
    if (err?.message === 'duplicate_notification') {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }

  let result;
  try {
    result = await sendNotificationMessage(supa, user, { notificationKey, text, blocks });
  } catch (err) {
    if (releaseOnFailure) await releaseNotificationLog(supa, user.id, notificationKey, entityKey);
    throw err;
  }
  if (!result.ok && releaseOnFailure) {
    await releaseNotificationLog(supa, user.id, notificationKey, entityKey);
  }
  return result;
}

async function sendNotificationMessage(supa, user, { text, blocks }) {
  const channel = await ensureSlackDmChannel(user, supa);
  if (!channel) {
    return { ok: false, reason: 'missing-channel' };
  }

  const client = getSlackClient();
  const response = await client.chat.postMessage({ channel, text, blocks });
  return {
    ok: !!response?.ok,
    channel: response?.channel || channel,
    ts: response?.ts || null
  };
}

// Match scouting assignments are all scouting_type 'data'; which report a
// scout files (Data, Performance or Robot) comes from their roster role, so
// the message names that instead of always saying "data".
const REPORT_KIND_WORDS = { data: 'data', performance: 'performance', robot: 'robot' };
export function scoutingTypeLabel(scoutingType, reportKind = null) {
  if (scoutingType === 'note') return 'note';
  if (scoutingType === 'quick') return 'quick';
  return REPORT_KIND_WORDS[reportKind] || 'data';
}

export async function notifyScoutAssignment({ assignmentId, userId, matchKey, teamKey, scoutingType, reportKind }) {
  if (!userId || !assignmentId) return { ok: false, reason: 'invalid-input' };
  const teamDisplay = teamKey ? teamKey.replace(/^frc/i, '') : 'team';
  const label = formatMatchLabel(matchKey);
  const typeLabel = scoutingTypeLabel(scoutingType, reportKind);
  const text = `You were assigned to ${typeLabel} scouting for ${label} (Team ${teamDisplay}).`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    text
  });
}

export async function notifyPitAssignment({ assignmentId, userId, teamKey }) {
  if (!userId || !assignmentId) return { ok: false, reason: 'invalid-input' };
  const teamDisplay = teamKey ? teamKey.replace(/^frc/i, '') : 'a team';
  const text = `You were assigned to pit scout Team ${teamDisplay}.`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    text
  });
}

export async function notifyPrescoutAssignment({ assignmentId, userId, teamKey }) {
  if (!userId || !assignmentId) return { ok: false, reason: 'invalid-input' };
  const teamDisplay = teamKey ? teamKey.replace(/^frc/i, '') : 'a team';
  const text = `You were assigned to pre-scout Team ${teamDisplay}.`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    text
  });
}

// Direct instruction: removing someone from a scouting assignment should
// actively tell them, not just silently drop the row - the whole point is
// that they'd otherwise show up expecting a shift that no longer exists.
// kind selects the message shape: 'match' (a specific match+team, data/note/
// quick scouting), 'pit', or 'prescout' (team-only, no match).
export async function notifyScoutUnassignment({
  userId,
  teamKey,
  matchKey = null,
  scoutingType = null,
  reportKind = null,
  kind = 'match'
}) {
  if (!userId) return { ok: false, reason: 'invalid-input' };
  const teamDisplay = teamKey ? teamKey.replace(/^frc/i, '') : 'a team';
  let text;
  if (kind === 'pit') {
    text = `You were unassigned from pit scouting Team ${teamDisplay}.`;
  } else if (kind === 'prescout') {
    text = `You were unassigned from pre-scouting Team ${teamDisplay}.`;
  } else {
    const typeLabel = scoutingTypeLabel(scoutingType, reportKind);
    const label = formatMatchLabel(matchKey);
    text = `You were unassigned from ${typeLabel} scouting for ${label} (Team ${teamDisplay}).`;
  }
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    text
  });
}

export async function notifyMatchReminder({ userId, matchKey, teams, matchTime }) {
  if (!userId || !matchKey) return { ok: false, reason: 'invalid-input' };
  const label = formatMatchLabel(matchKey);
  const teamList = teams && teams.length ? teams.map((t) => t.replace(/^frc/i, '')).join(', ') : 'your assigned teams';
  const whenLabel = matchTime ? formatLocalTimeWithZone(matchTime * 1000) : '';
  const when = whenLabel ? ` at ${whenLabel}` : '';
  const text = `${label}${when} is starting soon. You're scouting teams ${teamList}.`;
  const entityKey = `${matchKey}:${userId}`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.MATCH_REMINDERS,
    entityKey,
    text
  });
}

function formatMb(bytes) {
  return `${Math.round((Number(bytes) || 0) / (1024 * 1024))} MB`;
}

/** Data cleanup: DM each admin once per plan that a cleanup is waiting for approval. Never deletes anything. */
export async function notifyDataCleanupPlan(plan) {
  if (!plan?.planId || !plan.items?.length) return { ok: false, reason: 'no-plan' };
  const supa = getSupabase();
  const { data: admins, error } = await supa.from('user_profiles').select('id').eq('role', 'admin');
  if (error || !admins?.length) return { ok: false, reason: 'no-recipients' };
  const base = (env.PUBLIC_APP_ORIGIN || env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  const limits = [];
  if (plan.reasons.includes('database'))
    limits.push(`the database is at ${formatMb(plan.dbBytes)} (limit ${formatMb(plan.limits?.dbBytes)})`);
  if (plan.reasons.includes('storage'))
    limits.push(`file storage is at ${formatMb(plan.storageBytes)} (limit ${formatMb(plan.limits?.storageBytes)})`);
  const lines = plan.items
    .slice(0, 8)
    .map((i) => `• ${i.label}${i.eventKey ? ` from ${i.eventKey}` : ''}: ${i.count} ${i.unit}`);
  if (plan.items.length > 8) lines.push(`• and ${plan.items.length - 8} more`);
  const text = [
    `Data cleanup needs approval: ${limits.join(' and ')}.`,
    'These old competition items could be deleted:',
    ...lines,
    `Nothing is deleted until an admin approves it: <${base}/scouting-admin/data|Review in Scouting Admin, Data>.`
  ].join('\n');
  let sent = 0;
  for (const admin of admins) {
    const res = await dispatchNotification({
      userId: admin.id,
      notificationKey: NOTIFICATION_KEYS.DATA_CLEANUP,
      entityKey: `data-cleanup:${plan.planId}`,
      text
    });
    if (res?.ok) sent += 1;
  }
  return { ok: true, sent, recipients: admins.length };
}
