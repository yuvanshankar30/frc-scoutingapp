// Supabase clients and small query helpers for server routes. Every API route builds its
// clients here, so the "act as the caller (RLS) vs act as the server (service role)" rule
// lives in one place.
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/serviceClient.js';

/** A client that acts as the caller: it sends their bearer token, so row-level security applies. */
export function clientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
}

/** The service client when the server has one, otherwise `fallback` (usually the caller's own client). */
export function dbClient(fallback) {
  try {
    return getSupabase();
  } catch {
    return fallback;
  }
}

/** The signed-in Supabase user behind a request-scoped client, or null. */
export async function userFor(client) {
  const { data } = await client.auth.getUser();
  return data?.user || null;
}

/** One row from a query that may return an array (mocks and older PostgREST) or a single object. */
export function unwrapSingle(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

/** `.maybeSingle()` when the builder has it, else `.single()`, else an empty result. */
export function querySingle(builder) {
  if (typeof builder?.maybeSingle === 'function') return builder.maybeSingle();
  if (typeof builder?.single === 'function') return builder.single();
  return Promise.resolve({ data: null, error: null });
}

/**
 * True when `error` says a table doesn't exist yet (an optional migration that hasn't been applied).
 * With `table`, only a message naming that table counts.
 */
export function isMissingTable(error, table = '') {
  if (error?.code === '42P01' || error?.code === 'PGRST205') return true;
  const pattern = table
    ? new RegExp(`${table}.*(does not exist|schema cache)`, 'i')
    : /does not exist|could not find the table/i;
  return pattern.test(error?.message || '');
}
