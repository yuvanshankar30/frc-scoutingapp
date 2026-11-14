// The Data Viewer's analysis agent (Gemini). Configuration, the event snapshot it reads, and the tool-calling loop.
// Off while ANALYSIS_AGENT_ENABLED is false ($lib/scouting/analysisAgent.js): agentConfig() is then always null and
// the API answers 503, whatever keys the server has.
import { ANALYSIS_AGENT_ENABLED, conversationForApi } from '$lib/scouting/analysisAgent.js';
import { DEFAULT_MAX_TOKENS } from '$lib/server/assistant/llmClient.js';
import { loadEventSnapshot } from '$lib/server/assistant/eventData.js';
import { sanitizeForm } from '$lib/scouting/forms/formSchema.js';
import { AGENT_TOOLS, resultText, runAgentTool, withDataViewer } from './tools.js';
import { sourceStatus } from './sources.js';

export const MAX_STEPS = 8;
export const MAX_CALLS_PER_STEP = 6;
const GEMINI_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-3.8-flash';

/**
 * The model to call, or null when the agent may not run: switched off in code, or no key. Its own key
 * (DATA_VIEWER_AGENT_GEMINI_API_KEY), so turning the agent on never spends the assistant's credit.
 */
export function agentConfig(env = {}, { enabled = ANALYSIS_AGENT_ENABLED } = {}) {
  if (!enabled) return null;
  const apiKey = String(env.DATA_VIEWER_AGENT_GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  const maxTokens = Number.parseInt(env.DATA_VIEWER_AGENT_MAX_TOKENS, 10);
  return {
    provider: 'gemini',
    apiKey,
    baseUrl: GEMINI_OPENAI_BASE,
    model: String(env.DATA_VIEWER_AGENT_MODEL || '').trim() || DEFAULT_MODEL,
    maxTokens: Number.isFinite(maxTokens) ? Math.min(65536, Math.max(1024, maxTokens)) : DEFAULT_MAX_TOKENS
  };
}

/** What the page may know: whether the agent is on and which outside sources the server can reach. No secrets. */
export function agentStatus(env = {}, options = {}) {
  const enabled = options.enabled ?? ANALYSIS_AGENT_ENABLED;
  return {
    enabled,
    configured: Boolean(agentConfig(env, { enabled })),
    sources: sourceStatus(env)
  };
}

/** The form versions the event's reports used, newest first, plus the live one, so added questions become fields. */
async function loadSchemas(db, snapshot) {
  const schemas = { match: [], pit: [] };
  for (const [form, rows] of [
    ['match', snapshot.matchEntries || []],
    ['pit', snapshot.pitEntries || []]
  ]) {
    const versions = [...new Set(rows.map((row) => Number(row.custom_form_version)).filter((v) => v > 0))];
    const { data, error } = await db
      .from('scouting_form_versions')
      .select('version, schema')
      .eq('form_type', form)
      .order('version', { ascending: false })
      .limit(100);
    if (error || !data) continue;
    const newest = data[0]?.version;
    schemas[form] = data
      .filter((row) => row.version === newest || versions.includes(row.version))
      .map((row) => sanitizeForm(row.schema, form));
  }
  return schemas;
}

/** The event as the agent's tools see it: the assistant's snapshot plus the Data Viewer's fields and records. */
export async function loadAgentSnapshot(db, eventKey, env = {}) {
  const snapshot = await loadEventSnapshot(db, eventKey, env);
  return withDataViewer(snapshot, await loadSchemas(db, snapshot));
}

export function systemPrompt(snapshot) {
  const sources = Object.entries(sourceStatus(snapshot.ctx?.env || {}))
    .map(([key, source]) => `${source.label} (${key}_get): ${source.configured ? 'available' : 'not set up'}`)
    .join('; ');
  return `You are the Data Viewer's analysis agent for this FRC team at event ${snapshot.eventKey}. You answer questions about the robots, matches and teams at this event.

Data you can read, only through the tools:
- Our own scouting: every match scouting report (Data, Performance and Robot kinds) and pit scouting report, every field including questions admins added, plus notes, problems, the picklist and rankings. Start with list_fields, field_summary, team_fields, field_trend, metric_rankings and scout_entries.
- Outside sources: ${sources}. Use them for official results, schedules, rankings, OPRs and awards (TBA, FIRST), xP ratings and match forecasts (Match13), and EPA (Statbotics). Our event key is ${snapshot.eventKey}; a FIRST FRC Events path uses the season and the event code without the year (2026cc -> /2026/.../CC).

Rules:
- Use only numbers you got from a tool in this conversation. Never invent a value, team, match or source.
- A blank answer means not scouted, never 0. Say how many reports a number rests on when it is small (under 3).
- Say where each number came from: our scouting, TBA, FIRST, Match13 or Statbotics. When our scouting and an official source disagree, give both.
- If a source is not set up or fails, say so and answer from what you have.
- Be brief: lead with the answer, then the evidence as a short list or small table. Team numbers, not keys.`;
}

const NOTE = (content) => ({ role: 'user', content: `[note from the app] ${content}` });

/**
 * One question, answered with tools.
 * @returns {Promise<{ answer: string, toolsUsed: Array<{name, args}>, sources: Array<{source, url?, ok?}>, steps: number }>}
 */
export async function runAnalysisAgent({ messages, snapshot, callModel, fetchImpl = fetch }) {
  // The same trimming the page applies, so a client that skips it gets the same limits.
  const history = conversationForApi(messages);
  if (!history.length || history.at(-1).role !== 'user') throw new Error('The last message must be a question.');
  const convo = [...history];
  const toolsUsed = [];
  const sources = [];
  const system = systemPrompt(snapshot);
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const last = step === MAX_STEPS;
    if (last) convo.push(NOTE('No tools are left. Answer now from the results above, and say what is missing.'));
    const reply = await callModel({ system, messages: convo, tools: last ? [] : AGENT_TOOLS });
    if (!reply.toolCalls?.length || last) {
      const answer = (reply.text || '').trim() || 'I could not produce an answer.';
      return { answer, toolsUsed, sources: uniqueSources(sources), steps: step };
    }
    convo.push({ role: 'assistant', content: reply.text || '', toolCalls: reply.toolCalls });
    const results = await Promise.all(
      reply.toolCalls.map((call, index) =>
        index < MAX_CALLS_PER_STEP
          ? runAgentTool(call.name, call.args, snapshot, { fetchImpl })
          : Promise.resolve({
              result: { error: `Only ${MAX_CALLS_PER_STEP} tool calls fit in one round. Ask for the rest next round.` }
            })
      )
    );
    reply.toolCalls.forEach((call, index) => {
      const { result, source } = results[index];
      toolsUsed.push({ name: call.name, args: call.args });
      if (source) sources.push(source);
      convo.push({ role: 'tool', toolCallId: call.id, content: resultText(result) });
    });
  }
  return { answer: 'I could not produce an answer.', toolsUsed, sources: uniqueSources(sources), steps: MAX_STEPS };
}

function uniqueSources(list) {
  const seen = new Set();
  return list.filter((entry) => {
    const key = `${entry.source}:${entry.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
