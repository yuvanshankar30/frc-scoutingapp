// An event's awards.
// GET /api/tba/event-awards?event_key=2026cc
// Returns: { success:true, data:[ { name, award_type, recipient_list:[{team_key, awardee}] } ] }
import { relabelTbaPayload, tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const eventKey = requiredParam(url, 'event_key');
  const tbaKey = await tbaEventKeyFor(eventKey);
  const data = await tbaGet(`/event/${encodeURIComponent(tbaKey)}/awards`);
  return relabelTbaPayload(Array.isArray(data) ? data : [], tbaKey, eventKey);
});
