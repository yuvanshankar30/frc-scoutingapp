// A team's matches across every event of a season (cross-event form for Strategy and Picklist).
// GET /api/tba/team-matches?team_key=frc254&year=2026
// Returns: { success:true, data:[ { key, event_key, match_number, comp_level, alliances:{...} } ] }
import { compareTbaMatches } from '$lib/matches/matchKeys.js';
import { tbaGet, tbaProxy, teamKeyParam, yearParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const teamKey = teamKeyParam(url);
  const data =
    (await tbaGet(`/team/${encodeURIComponent(teamKey)}/matches/${encodeURIComponent(yearParam(url))}`)) || [];
  return data.sort(
    (a, b) => String(a?.event_key || '').localeCompare(String(b?.event_key || '')) || compareTbaMatches(a, b)
  );
});
