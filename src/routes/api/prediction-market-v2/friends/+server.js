import { json } from '@sveltejs/kit';
import { clientFromRequest } from '$lib/server/supabaseClients.js';
import { requireActor } from '$lib/server/predictions/predictionMarketV2.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET({ request }) {
  const auth = clientFromRequest(request);
  const actor = await requireActor(auth);
  if (!actor || !UUID_RE.test(String(actor.id || ''))) return json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await auth
    .from('pm_friends')
    .select('user_id,friend_id,status,created_at')
    .or(`user_id.eq.${actor.id},friend_id.eq.${actor.id}`)
    .order('created_at', { ascending: false });
  if (error) return json({ error: error.message }, { status: 500 });
  return json(data || []);
}

export async function POST({ request }) {
  const auth = clientFromRequest(request);
  const actor = await requireActor(auth);
  if (!actor || !UUID_RE.test(String(actor.id || ''))) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const friendId = String(body?.friend_id || '').trim();
  if (!UUID_RE.test(friendId) || friendId === actor.id)
    return json({ error: 'A different friend_id is required' }, { status: 400 });
  const { data, error } = await auth
    .from('pm_friends')
    .upsert({ user_id: actor.id, friend_id: friendId, status: 'pending' }, { onConflict: 'user_id,friend_id' })
    .select('user_id,friend_id,status,created_at')
    .single();
  if (error) return json({ error: error.message }, { status: 500 });
  return json(data);
}
