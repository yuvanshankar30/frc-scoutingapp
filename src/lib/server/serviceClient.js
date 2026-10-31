// The server's service-role Supabase client. It bypasses row-level security, so only server code may
// use it, and every route that does must check who the caller is first (see scouting/scoutingAccess.js).
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

let client = null;

export function getSupabase() {
  if (client) return client;
  const url = env.SUPABASE_URL || publicEnv.PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL (or PUBLIC_SUPABASE_URL) in the environment');
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_KEY in the environment');
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
