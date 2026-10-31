// Optional: posts each pit problem a match scout flags to one Slack channel, so the pit crew sees it
// straight away. Set SLACK_BOT_TOKEN and SLACK_PIT_PROBLEMS_CHANNEL (a channel id the bot is in) to turn
// it on. An edit or resolution updates the same Slack message instead of posting a new one.
import { env } from '$env/dynamic/private';
import { getSlackClient, slackConfigured } from '$lib/server/integrations/slack.js';

const cleanSlackText = (value, fallback = '') => {
  const text = String(value ?? '')
    .replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character])
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
};

function displayMatch(matchKey) {
  const key = cleanSlackText(matchKey, 'Unknown match').replace(/^\d{4}[a-z0-9]+_/i, '');
  const qual = /^qm(\d+)$/i.exec(key);
  if (qual) return `Qualification ${qual[1]}`;
  const playoff = /^(ef|qf|sf|f)(\d+)m(\d+)$/i.exec(key);
  if (playoff) {
    const level = { ef: 'Octofinal', qf: 'Quarterfinal', sf: 'Semifinal', f: 'Final' }[playoff[1].toLowerCase()];
    return `${level} ${playoff[2]} Match ${playoff[3]}`;
  }
  return key;
}

const teamNumber = (problem) => cleanSlackText(problem?.team_key, 'unknown').replace(/^frc/i, '');

export function pitProblemMessage(problem, scoutName = null) {
  const resolved = problem?.resolved === true;
  const urgent = problem?.severity === 'urgent';
  const observations = Array.isArray(problem?.scout_observations) ? problem.scout_observations : [];
  const lines = [
    `${resolved ? ':white_check_mark:' : urgent ? ':rotating_light:' : ':warning:'} *Team ${teamNumber(problem)} — ${resolved ? 'issue resolved' : urgent ? 'URGENT pit update' : 'pit update'}*`,
    `*Match:* ${displayMatch(problem?.match_key)}`,
    `*Competition:* ${cleanSlackText(problem?.event_key, 'Unknown event')}`
  ];
  if (observations.length) {
    lines.push(`*Scout reports (${observations.length}):*`);
    for (const observation of observations) {
      const name = cleanSlackText(observation?.scout_name, 'Match Scout');
      const summary = cleanSlackText(observation?.summary, 'Mechanical issue flagged after match');
      const detail = cleanSlackText(observation?.detail);
      lines.push(`• *${name}:* ${summary}${detail ? ` — ${detail}` : ''}`);
    }
  } else {
    lines.push(`*Issue:* ${cleanSlackText(problem?.summary, 'Mechanical issue flagged after match')}`);
    const detail = cleanSlackText(problem?.detail);
    if (detail) lines.push(`*Details:* ${detail}`);
    lines.push(`*Reported by:* ${cleanSlackText(scoutName, 'Match Scout')}`);
  }
  return lines.join('\n');
}

/** Returns { ok, channel, ts, payload } on success, { ok: false, reason } otherwise. Never throws. */
export async function notifyPitProblem(problem, scoutName = null, dependencies = {}) {
  const channel = dependencies.channel ?? env.SLACK_PIT_PROBLEMS_CHANNEL;
  if (!problem?.id) return { ok: false, reason: 'missing-problem-id' };
  if (!dependencies.client && (!slackConfigured() || !channel)) return { ok: false, reason: 'not-configured' };
  try {
    const client = dependencies.client || getSlackClient();
    const text = pitProblemMessage(problem, scoutName);
    if (problem.slack_channel && problem.slack_ts) {
      const updated = await client.chat.update({ channel: problem.slack_channel, ts: problem.slack_ts, text });
      if (!updated?.ok) throw new Error(updated?.error || 'slack-rejected-update');
      return {
        ok: true,
        channel: updated.channel || problem.slack_channel,
        ts: updated.ts || problem.slack_ts,
        payload: text
      };
    }
    const posted = await client.chat.postMessage({ channel, text });
    if (!posted?.ok) throw new Error(posted?.error || 'slack-rejected-post');
    return { ok: true, channel: posted.channel, ts: posted.ts, payload: text };
  } catch (error) {
    console.error('Failed to post the pit problem to Slack', error?.data?.error || error?.message || error);
    return { ok: false, reason: error?.data?.error || error?.message || 'slack-error' };
  }
}
