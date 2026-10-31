// A team's events in one season, earliest first.
// GET /api/tba/team-events?team_key=frc254&year=2026
import { tbaGet, tbaProxy, teamKeyParam, yearParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const teamKey = teamKeyParam(url);
  const data =
    (await tbaGet(`/team/${encodeURIComponent(teamKey)}/events/${encodeURIComponent(yearParam(url))}/simple`)) || [];
  return data.sort((a, b) => String(a?.start_date || '').localeCompare(String(b?.start_date || '')));
});
