// An event's qualification rankings, in TBA's own shape: sort_order_info names what each
// extra_stats/sort_orders column means, since that varies by game.
// GET /api/tba/event-rankings?event_key=2026cc
// Returns: { success:true, data:{ rankings:[...], sort_order_info:[...] } }
import { tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(
  async ({ url }) => {
    const tbaKey = await tbaEventKeyFor(requiredParam(url, 'event_key'));
    const data = await tbaGet(`/event/${encodeURIComponent(tbaKey)}/rankings`);
    return {
      rankings: Array.isArray(data?.rankings) ? data.rankings : [],
      sort_order_info: Array.isArray(data?.sort_order_info) ? data.sort_order_info : []
    };
  },
  { cache: true }
);
