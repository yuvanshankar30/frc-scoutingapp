import { json } from '@sveltejs/kit';
import { clientFromRequest, dbClient } from '$lib/server/supabaseClients.js';
import {
  eventModel,
  fetchEpaScouting,
  fetchScopedEventMatches,
  publicMatch,
  requireActor,
  resolveOutstandingElo
} from '$lib/server/predictions/predictionMarketV2.js';

export async function GET({ request, url }) {
  const auth = clientFromRequest(request);
  const actor = await requireActor(auth);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });
  try {
    const { matches } = await fetchScopedEventMatches(eventKey);
    await resolveOutstandingElo(dbClient(auth), eventKey, matches);
    const { data: picks, error } = await auth
      .from('pm_match_picks')
      .select('user_id,match_key,side,locked,picked_at')
      .eq('event_key', eventKey);
    if (error) throw error;
    const model = eventModel(matches, await fetchEpaScouting(dbClient(auth), eventKey));
    return json(
      matches.map((match) =>
        publicMatch(
          match,
          model.get(match.key) ?? 0.5,
          (picks || []).filter((pick) => pick.match_key === match.key),
          actor.id
        )
      )
    );
  } catch (error) {
    return json({ error: error.message || 'Unable to load matches' }, { status: 500 });
  }
}
