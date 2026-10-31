// Every season a team has competed in, newest first (the Blue Alliance tab's year picker).
// GET /api/tba/team-years?team_key=frc254
import { tbaGet, tbaProxy, teamKeyParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const years = (await tbaGet(`/team/${encodeURIComponent(teamKeyParam(url))}/years_participated`)) || [];
  return [...years].sort((a, b) => b - a);
});
