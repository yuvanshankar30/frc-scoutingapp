import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { clientFromRequest } from '$lib/server/scouting/scoutingAccess.js';
import { loadEventSnapshot } from '$lib/server/assistant/eventData.js';
import { runAssistant } from '$lib/server/assistant/agent.js';
import { assistantConfig, makeCallModel } from '$lib/server/assistant/llmClient.js';
import { loadTeamSettings } from '$lib/server/teamSettings.js';
import { allowRequest } from '$lib/server/assistant/rateLimit.js';

// Ask the scouting assistant a question. Read-only: the data is loaded with the CALLER'S database client, so
// row-level security applies exactly as it does on every other page, and the model can only call the read
// tools in tools.js. 503 when no model key is configured, like the other optional AI features.

export async function GET() {
  return json({ configured: Boolean(assistantConfig(env)) });
}

export async function POST({ request }) {
  const config = assistantConfig(env);
  if (!config)
    return json({ success: false, error: 'The assistant is not configured yet (no model API key).' }, { status: 503 });

  const db = clientFromRequest(request);
  const { data } = await db.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return json({ success: false, error: 'Sign in to use the assistant.' }, { status: 401 });
  if (!allowRequest(userId))
    return json({ success: false, error: 'Slow down: too many questions in a minute.' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Send JSON.' }, { status: 400 });
  }
  const eventKey = String(body?.event_key || '').trim();
  if (!/^\d{4}[a-z0-9]+$/i.test(eventKey))
    return json({ success: false, error: 'event_key is required.' }, { status: 400 });

  try {
    const snapshot = await loadEventSnapshot(db, eventKey, env);
    const { settings: team } = await loadTeamSettings();
    const result = await runAssistant({ messages: body?.messages, snapshot, callModel: makeCallModel(config), team });
    return json({ success: true, ...result });
  } catch (error) {
    console.error('scouting assistant failed:', error.message);
    return json({ success: false, error: 'The assistant could not answer that. Try again.' }, { status: 502 });
  }
}
