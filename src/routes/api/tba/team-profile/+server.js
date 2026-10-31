// One team's full profile (location, rookie year, website) for the Blue Alliance tab's header.
// GET /api/tba/team-profile?team_key=frc254
import { safeUrl } from '$lib/app/safeUrl.js';
import { TbaError, tbaGet, tbaProxy, teamKeyParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const teamKey = teamKeyParam(url);
  const row = await tbaGet(`/team/${encodeURIComponent(teamKey)}`, { notFound: new TbaError('Team not found', 404) });
  return {
    key: row?.key,
    team_number: row?.team_number,
    nickname: row?.nickname || '',
    name: row?.name || '',
    city: row?.city || '',
    state_prov: row?.state_prov || '',
    country: row?.country || '',
    rookie_year: row?.rookie_year ?? null,
    website: safeUrl(row?.website),
    motto: row?.motto || ''
  };
});
