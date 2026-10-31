// An event's teams, trimmed to what scouting screens need for display names.
// GET /api/tba/event-teams?event_key=2025casj
import { tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(
  async ({ url }) => {
    const tbaKey = await tbaEventKeyFor(requiredParam(url, 'event_key'));
    const rows = (await tbaGet(`/event/${encodeURIComponent(tbaKey)}/teams/simple`)) || [];
    return rows.map((row) => ({
      key: row.key,
      team_number: row.team_number,
      nickname: row.nickname || '',
      name: row.name || ''
    }));
  },
  { cache: true }
);
