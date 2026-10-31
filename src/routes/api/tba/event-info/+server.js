// TBA's own record for an event (name, dates, location, week), as opposed to its roster, schedule or stats.
// GET /api/tba/event-info?event_key=2026cc
import { tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requiredParam, TbaError, tbaGet, tbaProxy } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(
  async ({ url }) => {
    const tbaKey = await tbaEventKeyFor(requiredParam(url, 'event_key'));
    const row = await tbaGet(`/event/${encodeURIComponent(tbaKey)}`, {
      notFound: new TbaError('Event not found', 404)
    });
    return {
      key: row?.key,
      name: row?.name || '',
      short_name: row?.short_name || '',
      event_type_string: row?.event_type_string || '',
      start_date: row?.start_date || '',
      end_date: row?.end_date || '',
      week: row?.week ?? null,
      year: row?.year ?? null,
      city: row?.city || '',
      state_prov: row?.state_prov || '',
      country: row?.country || '',
      website: row?.website || '',
      webcasts: Array.isArray(row?.webcasts) ? row.webcasts : []
    };
  },
  { cache: true }
);
