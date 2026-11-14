import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { actorFor } from '$lib/server/scouting/scoutingAccess.js';
import { makeCallModel } from '$lib/server/assistant/llmClient.js';
import { allowRequest } from '$lib/server/assistant/rateLimit.js';
import { agentConfig, agentStatus, loadAgentSnapshot, runAnalysisAgent } from '$lib/server/dataViewerAgent/agent.js';

// The Data Viewer's analysis agent. Switched off: until ANALYSIS_AGENT_ENABLED is true and the server has
// DATA_VIEWER_AGENT_GEMINI_API_KEY, POST answers 503 before reading anything. When on, it is read-only: scouting is
// loaded with the CALLER'S database client (row-level security applies as on every page), and outside sources are
// read from fixed hosts only (src/lib/server/dataViewerAgent/sources.js).

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const reply = (body, status = 200) => json(body, { status, headers: NO_STORE });

// Only approved accounts may ask, or learn whether the agent is set up: a pending or banned account must not be able
// to spend model credit.
async function approvedCaller(request) {
  const access = await actorFor(request);
  if (!access.authenticatedUserId) return { error: reply({ success: false, error: 'Sign in to use the agent.' }, 401) };
  if (!access.approved)
    return { error: reply({ success: false, error: 'Your account is waiting for approval.' }, 403) };
  return { access };
}

export async function GET({ request }) {
  const { error } = await approvedCaller(request);
  if (error) return error;
  return reply({ success: true, data: agentStatus(env) });
}

export async function POST({ request }) {
  const config = agentConfig(env);
  if (!config) return reply({ success: false, error: 'The analysis agent is not turned on yet.' }, 503);

  const { access, error: denied } = await approvedCaller(request);
  if (denied) return denied;
  const userId = access.authenticatedUserId;
  if (!allowRequest(`dataviewer-agent:${userId}`, { limit: 8 }))
    return reply({ success: false, error: 'Slow down: too many questions in a minute.' }, 429);

  const body = await request.json().catch(() => null);
  if (!body) return reply({ success: false, error: 'Send JSON.' }, 400);
  const eventKey = String(body.event_key || '').trim();
  if (!/^\d{4}[a-z0-9]+$/i.test(eventKey)) return reply({ success: false, error: 'event_key is required.' }, 400);

  try {
    const snapshot = await loadAgentSnapshot(access.client, eventKey, env);
    const result = await runAnalysisAgent({ messages: body.messages, snapshot, callModel: makeCallModel(config) });
    return reply({ success: true, data: result });
  } catch (error) {
    console.error('data viewer agent failed:', error?.message);
    return reply({ success: false, error: 'The agent could not answer that. Try again.' }, 502);
  }
}
