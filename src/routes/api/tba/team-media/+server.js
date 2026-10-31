// A team's media for an event's season, with only safe links.
// GET /api/tba/team-media?team_key=frc254&event_key=2026cc
import { safeUrl } from '$lib/app/safeUrl.js';
import { TbaError, tbaGet, tbaProxy, teamKeyParam } from '$lib/server/integrations/tba.js';

export const GET = tbaProxy(async ({ url }) => {
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!/^\d{4}[a-z0-9]+$/i.test(eventKey)) throw new TbaError('valid event_key required', 400);
  const teamKey = teamKeyParam(url);
  const raw = (await tbaGet(`/team/${encodeURIComponent(teamKey)}/media/${eventKey.slice(0, 4)}`)) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) =>
    item && typeof item === 'object'
      ? {
          ...item,
          ...(item.view_url !== undefined ? { view_url: safeUrl(item.view_url) } : {}),
          ...(item.direct_url !== undefined ? { direct_url: safeUrl(item.direct_url) } : {})
        }
      : item
  );
});
