import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '$lib/app/supabaseConfig.js';
import { withTimeout } from '$lib/app/withTimeout.js';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SESSION_READ_TIMEOUT_MS = 3000;
const TOKEN_REFRESH_TIMEOUT_MS = 5000;

export async function getAuthHeader() {
  // getSession() waits on supabase-js's auth lock, which another tab's refresh can hold for a long time.
  const { data } = await withTimeout(supabase.auth.getSession(), SESSION_READ_TIMEOUT_MS, { data: null });
  let session = data?.session;
  // getSession() reads whatever is in local storage without forcing a
  // freshness check — if this tab sat backgrounded long enough for the
  // browser to throttle Supabase's proactive refresh timer, the stored
  // token can already be expired. Sending it as-is gets a hard 401
  // ("Unauthorized") from every API route even though the user is very
  // much still logged in. Force a refresh whenever the token is expired
  // or about to expire.
  //
  // On a stalled connection the refresh can hang forever, and so would every save waiting on this header. Give up
  // after a few seconds and send the stored token: the API answers 401 (shown to the user) or the request is queued.
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 10000) {
    const refreshed = await withTimeout(
      supabase.auth.refreshSession().catch(() => null),
      TOKEN_REFRESH_TIMEOUT_MS,
      null
    );
    session = refreshed?.data?.session || session;
  }
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** fetch() with the signed-in user's bearer token added, for the app's own API routes. */
export async function authFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), ...(await getAuthHeader()) } });
}
