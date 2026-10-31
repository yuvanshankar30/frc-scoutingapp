// Optional Slack bot. Everything that posts to Slack goes through here, and all of it is skipped when
// SLACK_BOT_TOKEN is not set.
import { WebClient } from '@slack/web-api';
import { env } from '$env/dynamic/private';

let slackClient = null;

export const slackConfigured = () => Boolean(env.SLACK_BOT_TOKEN);

export function getSlackClient() {
  if (slackClient) return slackClient;
  if (!env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN in the environment');
  slackClient = new WebClient(env.SLACK_BOT_TOKEN);
  return slackClient;
}

/** The Slack user id for an email address (needs the users:read.email scope), or null. */
export async function slackUserIdForEmail(email) {
  if (!email || !slackConfigured()) return null;
  try {
    const response = await getSlackClient().users.lookupByEmail({ email });
    if (response.ok) return response.user?.id || null;
  } catch (error) {
    console.error('Slack lookup by email failed:', error?.data?.error || error?.message || error);
  }
  return null;
}
