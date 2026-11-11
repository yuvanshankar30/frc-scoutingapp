// Which TBA event a competition code tracks, and the search used to pick one.
// GET  ?event_key=2026code               the code's link: { event_key, tba_event_key, tba_name }
// GET  ?q=madtown&event_key=2026code     up to five suggested TBA events for what the admin typed
// POST { event_key, tba_event_key|null } set or clear the link (creates the code's row if needed)
//
// The search asks Gemini to pick from The Blue Alliance's real event list for the season, so it understands
// nicknames and abbreviations ("madtown", "chezy", "SVR") but can only ever suggest an event TBA has. When Gemini
// is not configured or fails, plain text matching on the same list is used instead.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { actorFor } from '$lib/server/scouting/scoutingAccess.js';
import { forgetTbaEventLink } from '$lib/server/scouting/tbaEventLink.js';
import { tbaGet } from '$lib/server/integrations/tba.js';
import { assistantConfig, makeCallModel } from '$lib/server/assistant/llmClient.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { normalizeTbaEventKey, pickSuggestedKeys, rankEventsByText, searchYear } from '$lib/scouting/tbaEventLink.js';

// A 404 means TBA has no such event: null, not an error.
const tba = (path) => tbaGet(path, { notFound: null });

const shape = (event) => ({
  key: event.key,
  name: event.name,
  short_name: event.short_name || '',
  city: event.city || '',
  state_prov: event.state_prov || '',
  country: event.country || '',
  start_date: event.start_date,
  end_date: event.end_date,
  year: event.year
});
const isMissingColumn = (error) =>
  error?.code === '42703' || error?.code === 'PGRST204' || /tba_event_key/.test(error?.message || '');

async function suggest(query, code) {
  const year = searchYear(query, code);
  const events = ((await tba(`/events/${year}/simple`)) || []).map(shape);
  const typedKey = normalizeTbaEventKey(String(query).replace(/\s+/g, ''));
  const exact = typedKey ? events.find((event) => event.key === typedKey) : null;
  const byText = rankEventsByText(events, query, 8);

  const config = assistantConfig({
    ...env,
    ASSISTANT_PROVIDER: env.GEMINI_API_KEY ? 'gemini' : env.ASSISTANT_PROVIDER
  });
  let keys = [];
  let source = 'search';
  if (config && events.length) {
    try {
      const callModel = makeCallModel(config);
      const cleanLine = (value) =>
        String(value ?? '')
          .replace(/[\r\n\t|]+/g, ' ')
          .trim();
      const list = events
        .map(
          (event) =>
            `${cleanLine(event.key)} | ${cleanLine(event.name)} | ${cleanLine(event.city)}${event.state_prov ? `, ${cleanLine(event.state_prov)}` : ''} | ${cleanLine(event.start_date)}`
        )
        .join('\n');
      const reply = await callModel({
        system:
          'You match an FRC event name a scouting admin typed to events from The Blue Alliance. Teams use nicknames, abbreviations and partial names ("madtown" is MadTown Throwdown, "chezy" is Chezy Champs, "SVR" is Silicon Valley Regional). Answer with JSON only: {"matches":[{"key":"<event key>"}]}, best first, at most 5, using only keys from the list. Return an empty list when nothing fits.',
        messages: [
          {
            role: 'user',
            content: `Typed: ${cleanLine(query)}\nCompetition code being set up: ${cleanLine(code) || 'none'}\nEvents in ${year}:\n${list}`
          }
        ]
      });
      keys = pickSuggestedKeys(
        reply.text,
        events.map((event) => event.key)
      );
      if (keys.length) source = 'gemini';
    } catch {
      keys = [];
    }
  }
  const byKey = new Map(events.map((event) => [event.key, event]));
  const ordered = [...(exact ? [exact.key] : []), ...keys, ...byText.map((event) => event.key)];
  const suggestions = [...new Set(ordered)]
    .slice(0, 5)
    .map((key) => byKey.get(key))
    .filter(Boolean);
  return { year, source, suggestions };
}

export async function GET({ request, url }) {
  const { actorId, can, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!can('MANAGE_EVENT')) return json({ error: 'Only scouting admins can link events.' }, { status: 403 });
  const code = normalizeEventCode(url.searchParams.get('event_key') || '') || '';
  const query = String(url.searchParams.get('q') || '')
    .trim()
    .slice(0, 120);
  try {
    if (query) return json({ success: true, data: await suggest(query, code) });
    if (!code) return json({ error: 'event_key or q is required' }, { status: 400 });
    const { data, error } = await db
      .from('scouting_events')
      .select('event_key, name, tba_event_key')
      .eq('event_key', code)
      .maybeSingle();
    if (error && !isMissingColumn(error)) throw error;
    const linked = normalizeTbaEventKey(data?.tba_event_key);
    const event = linked ? await tba(`/event/${encodeURIComponent(linked)}/simple`).catch(() => null) : null;
    return json({
      success: true,
      data: {
        event_key: code,
        tba_event_key: linked,
        tba_name: event ? `${event.year} ${event.name}` : null,
        unavailable: Boolean(error)
      }
    });
  } catch (error) {
    return json({ error: error.message || 'Request failed' }, { status: error.status || 500 });
  }
}

export async function POST({ request }) {
  const { actorId, can, db } = await actorFor(request);
  if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!can('MANAGE_EVENT')) return json({ error: 'Only scouting admins can link events.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const code = normalizeEventCode(body?.event_key || '');
  if (!code) return json({ error: 'Enter a competition code like 2026mttd.' }, { status: 400 });
  const raw = body?.tba_event_key;
  const linked = raw == null || raw === '' ? null : normalizeTbaEventKey(raw);
  if (raw != null && raw !== '' && !linked) return json({ error: 'That is not a TBA event key.' }, { status: 400 });
  try {
    let tbaName = null;
    if (linked) {
      const event = await tba(`/event/${encodeURIComponent(linked)}/simple`);
      if (!event) return json({ error: `The Blue Alliance has no event ${linked}.` }, { status: 404 });
      tbaName = `${event.year} ${event.name}`;
    }
    const { data: existing, error: readError } = await db
      .from('scouting_events')
      .select('event_key, name')
      .eq('event_key', code)
      .maybeSingle();
    if (readError) throw readError;
    // Linking an event names a code that has no name of its own yet, so pickers show something readable.
    const row = {
      event_key: code,
      tba_event_key: linked,
      ...(!existing ? { created_by: actorId } : {}),
      ...(!existing?.name && tbaName ? { name: tbaName } : {})
    };
    const { data, error } = await db
      .from('scouting_events')
      .upsert(row, { onConflict: 'event_key' })
      .select('event_key, name, tba_event_key')
      .single();
    if (error && isMissingColumn(error))
      return json(
        { error: 'Linking TBA events needs the current database schema (supabase/migrations) applied.' },
        { status: 503 }
      );
    if (error) throw error;
    forgetTbaEventLink(code);
    return json({ success: true, data: { ...data, tba_name: tbaName } });
  } catch (error) {
    return json({ error: error.message || 'Request failed' }, { status: error.status || 500 });
  }
}
