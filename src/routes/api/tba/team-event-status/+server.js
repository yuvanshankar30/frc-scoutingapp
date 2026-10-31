// One team's status at one event: rank, qual record and playoff status in a single call.
// GET /api/tba/team-event-status?team_key=frc254&event_key=2026cc
import { tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, tbaGet, tbaProxy, teamKeyParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const teamKey = teamKeyParam(url);
  const tbaKey = await tbaEventKeyFor(requiredParam(url, 'event_key'));
  const data = await tbaGet(`/team/${encodeURIComponent(teamKey)}/event/${encodeURIComponent(tbaKey)}/status`, {
    notFound: null
  });
  return data || null;
});
