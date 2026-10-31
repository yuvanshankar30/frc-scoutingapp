// The season's events that are relevant to bet on right now: not over yet, and starting within the
// next couple of weeks. The prediction market's event picker uses this.
// GET /api/tba/current-events?year=2026 (year defaults to the current calendar year)
// Returns: { success:true, data:[ { key, name, short_name, start_date, end_date, week, city,
//   state_prov, country, webcasts:[], live:boolean } ] }
import { tbaGet, tbaProxy, yearParam } from '$lib/server/integrations/tba.js';

// Wide enough to plan ahead for an event that hasn't started, narrow enough that the picker isn't
// cluttered with events months away.
const UPCOMING_WINDOW_DAYS = 14;

export const GET = tbaProxy(async ({ url }) => {
  const events = await tbaGet(`/events/${encodeURIComponent(yearParam(url))}`);
  const today = new Date().toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + UPCOMING_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return (events || [])
    .filter((event) => event?.start_date && event?.end_date)
    .filter((event) => event.end_date >= today && event.start_date <= windowEnd)
    .map((event) => ({
      key: event.key,
      name: event.name || '',
      short_name: event.short_name || '',
      start_date: event.start_date,
      end_date: event.end_date,
      week: event.week ?? null,
      city: event.city || '',
      state_prov: event.state_prov || '',
      country: event.country || '',
      webcasts: Array.isArray(event.webcasts) ? event.webcasts : [],
      live: event.start_date <= today && today <= event.end_date
    }))
    .sort((a, b) => (a.live === b.live ? a.start_date.localeCompare(b.start_date) : a.live ? -1 : 1));
});
