import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireScoutingActor } from '$lib/server/scouting/scoutingAccess.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

// Temporary: no working OpenAI key yet. Explicit rather than relying only on
// env.OPENAI_API_KEY being unset, so this stays off even if some placeholder
// value gets set before a real key is ready. Flip back to false (or delete
// this check) once a real OPENAI_API_KEY is configured.
const AI_FLAGGING_TEMPORARILY_DISABLED = true;

function responseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text || '')
    .join('');
}

function summarizeTeam(team) {
  if (!team) return null;
  const parts = [`Team ${team.teamNumber}`];
  if (Number.isFinite(team.scoutPower)) parts.push(`Scout Power ${team.scoutPower.toFixed(1)}`);
  if (Number.isFinite(team.avgFuel)) parts.push(`avg fuel ${team.avgFuel.toFixed(1)}`);
  if (Number.isFinite(team.avgBallsScored)) parts.push(`avg teleop balls ${team.avgBallsScored.toFixed(1)}`);
  if (team.openProblems) parts.push(`${team.openProblems} open Pit problem(s)`);
  return parts.join(', ');
}

export async function POST({ request }) {
  const auth = await requireScoutingActor(request);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
  }

  if (AI_FLAGGING_TEMPORARILY_DISABLED || !env.OPENAI_API_KEY) {
    return json(
      { success: false, error: 'AI flagging is not configured yet.' },
      { status: 503, headers: PRIVATE_HEADERS }
    );
  }

  const body = await request.json().catch(() => null);
  const movedTeam = body?.movedTeam;
  const neighbors = Array.isArray(body?.neighbors) ? body.neighbors.slice(0, 4) : [];
  if (!movedTeam?.teamNumber) {
    return json({ success: false, error: 'movedTeam required' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const prompt = [
    'A scout just moved a team on an FRC alliance-selection pick list.',
    `Moved: ${summarizeTeam(movedTeam)} (from position ${body?.fromIndex ?? '?'} to ${body?.toIndex ?? '?'}, 1 = first pick).`,
    `Now adjacent to: ${neighbors.map(summarizeTeam).filter(Boolean).join('; ') || 'no other teams nearby'}.`,
    'Based only on the numbers given, does this placement look questionable - e.g. a team with clearly weaker scouted numbers placed above one with clearly stronger numbers, with no other reason implied? Minor differences or roughly similar numbers are NOT worth flagging.',
    'Return JSON only: {"flagged": boolean, "reason": string|null}. reason should be one short sentence naming the specific numbers that look off, or null if not flagged.'
  ].join('\n');

  try {
    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        store: false,
        max_output_tokens: 200,
        text: { format: { type: 'json_object' } },
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]
      })
    });
    if (!aiResponse.ok) {
      console.error('Picklist flag-move request failed', aiResponse.status, await aiResponse.text());
      return json(
        { success: false, error: 'Flagging unavailable right now.' },
        { status: 502, headers: PRIVATE_HEADERS }
      );
    }
    let result;
    try {
      result = JSON.parse(responseText(await aiResponse.json()));
    } catch {
      return json(
        { success: false, error: 'Flagging response was unreadable.' },
        { status: 502, headers: PRIVATE_HEADERS }
      );
    }
    return json(
      {
        success: true,
        flagged: Boolean(result?.flagged),
        reason: result?.flagged && typeof result?.reason === 'string' ? result.reason.trim().slice(0, 300) : null
      },
      { headers: PRIVATE_HEADERS }
    );
  } catch (e) {
    return json({ success: false, error: e?.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
