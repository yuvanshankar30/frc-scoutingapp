// An event's matches, in play order.
// GET /api/tba/event-matches?event_key=2025casj[&comp_level=qm|all]
//   comp_level defaults to qm; "all" returns every match.
// Returns: { success:true, data:[ { key, match_number, alliances:{ red:{team_keys:[]}, blue:{team_keys:[]} } } ] }
import { relabelTbaPayload, tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { compareTbaMatches } from '$lib/matches/matchKeys.js';
import { requiredParam, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(
  async ({ url }) => {
    const eventKey = requiredParam(url, 'event_key');
    const tbaKey = await tbaEventKeyFor(eventKey);
    const rawCompLevel = url.searchParams.get('comp_level');
    const compLevel = rawCompLevel === null ? 'qm' : String(rawCompLevel).trim().toLowerCase();

    let data = (await tbaGet(`/event/${encodeURIComponent(tbaKey)}/matches`)) || [];
    if (compLevel && compLevel !== 'all')
      data = data.filter((match) => String(match.comp_level || '').toLowerCase() === compLevel);
    return relabelTbaPayload(data.sort(compareTbaMatches), tbaKey, eventKey);
  },
  { cache: true }
);
