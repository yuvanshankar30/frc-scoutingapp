// Playoff alliance selections. Empty before alliance selection at a live event - not an error.
// GET /api/tba/event-alliances?event_key=2026cc
// Returns: { success:true, data:[ { name, picks:[team_key,...], status:{...} } ] }
import { relabelTbaPayload, tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(
  async ({ url }) => {
    const eventKey = requiredParam(url, 'event_key');
    const tbaKey = await tbaEventKeyFor(eventKey);
    const data = await tbaGet(`/event/${encodeURIComponent(tbaKey)}/alliances`, { notFound: [] });
    return relabelTbaPayload(Array.isArray(data) ? data : [], tbaKey, eventKey);
  },
  { cache: true }
);
