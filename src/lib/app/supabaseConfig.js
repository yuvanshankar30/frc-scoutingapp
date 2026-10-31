// The Supabase address and public key, with a safe stand-in when they are missing. createClient() throws without
// a URL, and it runs when supabase.js is first imported, so a fresh clone with no .env used to crash every page with
// "supabaseUrl is required". With the stand-in the app loads and says what is missing instead (root layout).
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

// `.invalid` is reserved and never resolves, so nothing is ever sent anywhere.
export const NOT_CONFIGURED_URL = 'https://supabase-not-configured.invalid';

export const supabaseConfigured = Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY);
export const supabaseUrl = PUBLIC_SUPABASE_URL || NOT_CONFIGURED_URL;
export const supabaseAnonKey = PUBLIC_SUPABASE_ANON_KEY || 'not-configured';
