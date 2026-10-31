// Display names for a list of teams. Teams TBA doesn't know are left out.
// GET /api/tba/teams-simple?team_keys=frc254,frc1678
import { json } from '@sveltejs/kit';
import { MISSING_TBA_KEY, tbaAuthKey, tbaJson, tbaProxy, TbaError } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const teamKeys = [
    ...new Set(
      String(url.searchParams.get('team_keys') || '')
        .split(',')
        .map((key) => key.trim().toLowerCase())
        .filter((key) => /^frc\d+$/.test(key))
    )
  ];
  if (!teamKeys.length) return json({ success: true, data: [] });
  if (!tbaAuthKey()) throw new TbaError(MISSING_TBA_KEY, 500);

  const rows = await Promise.all(teamKeys.map((teamKey) => tbaJson(`/team/${encodeURIComponent(teamKey)}/simple`)));
  return rows
    .filter((row) => row?.key)
    .map((row) => ({ key: row.key, team_number: row.team_number, nickname: row.nickname || '', name: row.name || '' }));
});
