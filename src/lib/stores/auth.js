import { followProfileTheme, setTheme, theme } from '$lib/stores/theme.js';
import { team } from '$lib/stores/team.js';
import { get, writable } from 'svelte/store';
import { supabase } from '$lib/app/supabase.js';
import { clearOfflineQueue, flushQueue, queuedJobs } from '$lib/app/offlineQueue.js';
import { clearOfflineCache } from '$lib/app/offlineCache.js';
import { clearAllChats } from '$lib/assistant/chatStore.js';
import { clearStoredEventKey, forgetSharedConfig } from '$lib/scouting/scoutingEvent.js';
import { clearAllScoutingDrafts } from '$lib/scouting/draftStore.js';
import { hasConfirmationSubscriber, requestConfirmation } from '$lib/app/confirmation.js';

/**
 * Minimal auth stores:
 * - user: Supabase auth user (null when signed out)
 * - userProfile: row from user_profiles (null when signed out or missing)
 *
 * IMPORTANT: We never await inside the Supabase auth callback to avoid deadlocks.
 */
export const user = writable(null);
export const userProfile = writable(null);
export const authReady = writable(false);

let subscription = null;
let initialized = false;
let initCount = 0;
const INITIAL_SESSION_TIMEOUT_MS = 2500;

export async function fetchUserProfile(userId, attempt = 0) {
  if (!userId) {
    userProfile.set(null);
    return null;
  }
  try {
    const [profileResult, rosterResult, competitionTeamResult] = await Promise.all([
      supabase
        .from('user_profiles')
        // Select the profile row as a whole so a newly deployed client stays
        // able to sign in while an additive migration is still propagating.
        // The profile mapper below remains the allow-list for UI data.
        .select('*')
        .eq('id', userId)
        .single(),
      supabase.from('roster_entries').select('key:key_id(key_name)').eq('user_id', userId),
      // Team for this competition only; a missing row falls back to the profile's team.
      (async () =>
        supabase.from('competition_team_members').select('frc_team').eq('user_id', userId).maybeSingle())().catch(
        () => ({ data: null })
      )
    ]);
    const { data, error } = profileResult;

    if (error) {
      console.warn('user_profiles fetch error:', error.message || error);
      userProfile.set(null);
      if (attempt < 2) setTimeout(() => void fetchUserProfile(userId, attempt + 1), 750 * (attempt + 1));
      return null;
    }
    const profile = {
      id: data.id,
      email: data.email || '',
      full_name: data.full_name || '',
      role: data.role || 'member',
      permissions: Array.isArray(data.permissions)
        ? data.permissions.map(String)
        : data.permissions
          ? [String(data.permissions)]
          : [],
      general_role: data.general_role || 'none',
      team_role: data.team_role || 'other',
      frc_team: data.frc_team || null,
      competition_team: competitionTeamResult?.data?.frc_team || data.frc_team || null,
      roster_keys: (rosterResult.data || []).map((entry) => entry?.key?.key_name).filter(Boolean),
      is_dev: !!data.is_dev,
      theme_preference: data.theme_preference || null,
      created_at: data.created_at || '',
      updated_at: data.updated_at || '',
      banned: !!data.banned,
      notification_settings: data.notification_settings || null,
      slack_user_id: data.slack_user_id || null,
      slack_dm_channel: data.slack_dm_channel || null
    };

    userProfile.set(profile);
    followProfileTheme(profile.theme_preference, get(team)?.defaultTheme);
    return profile;
  } catch (e) {
    console.warn('user_profiles fetch exception:', e?.message || e);
    userProfile.set(null);
    if (attempt < 2) setTimeout(() => void fetchUserProfile(userId, attempt + 1), 750 * (attempt + 1));
    return null;
  }
}

/**
 * Initialize auth once per app load.
 * - Sets current auth user on load
 * - Loads user_profiles row when signed in
 * - Clears userProfile when signed out
 *
 * No awaits inside the auth callback; async work is scheduled.
 */
export function initAuth() {
  initCount += 1;

  if (!initialized) {
    initialized = true;
    authReady.set(false);

    // Initial session load (safe to await here; not inside callback)
    (async () => {
      const applyInitialSession = async ({ data, error } = {}) => {
        if (error) console.warn('getSession error:', error.message || error);
        const authUser = data?.session?.user ?? null;
        user.set(authUser);
        if (authUser) {
          void fetchUserProfile(authUser.id);
        } else {
          userProfile.set(null);
        }
      };

      try {
        const sessionRequest = supabase.auth.getSession();
        const result = await Promise.race([
          sessionRequest,
          new Promise((resolve) => setTimeout(() => resolve(null), INITIAL_SESSION_TIMEOUT_MS))
        ]);

        if (result === null) {
          console.warn('Initial auth session check timed out; continuing without blocking the app.');
          // Preserve a delayed but valid browser session instead of requiring
          // a reload once the local Supabase client becomes responsive.
          void sessionRequest.then(applyInitialSession).catch((e) => {
            console.warn('Late getSession error:', e?.message || e);
          });
        } else {
          await applyInitialSession(result);
        }
      } finally {
        authReady.set(true);
      }
    })();
  }

  if (!subscription) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const authUser = session?.user ?? null;
      user.set(authUser);

      if (event === 'SIGNED_IN' && authUser) {
        forgetSharedConfig();
        // Avoid await inside callback to prevent deadlocks
        queueMicrotask(() => {
          void fetchUserProfile(authUser.id);
          void flushQueue();
        });
      } else if (event === 'SIGNED_OUT') {
        userProfile.set(null);
        clearOfflineCache();
        clearAllChats();
        clearStoredEventKey();
        clearAllScoutingDrafts();
      }

      authReady.set(true);
    });

    subscription = data?.subscription ?? null;
  }

  // Return unsubscribe function
  return () => {
    initCount = Math.max(0, initCount - 1);
    if (initCount > 0) return;

    subscription?.unsubscribe?.();
    subscription = null;
    initialized = false;
    authReady.set(false);
  };
}

/**
 * Sign-out helper with shared-device storage cleanup and unsynced offline queue check (COMP-06).
 */
export async function signOut({ confirmUnsynced = true, force = false, confirmImpl } = {}) {
  const initialQueued = queuedJobs();
  if (initialQueued.length > 0) {
    try {
      await flushQueue();
    } catch {
      // ignore flush error before checking remaining queue
    }
    const remaining = queuedJobs();
    if (remaining.length > 0 && confirmUnsynced && !force) {
      const promptOptions = {
        title: 'Unsynced scouting reports',
        message: `You have ${remaining.length} unsynced scouting report${remaining.length === 1 ? '' : 's'} on this device. Signing out now will clear them from this shared device.`,
        confirmLabel: 'Sign out anyway',
        danger: true
      };
      let confirmed = true;
      if (typeof confirmImpl === 'function') {
        confirmed = await confirmImpl(promptOptions);
      } else if (hasConfirmationSubscriber()) {
        confirmed = await requestConfirmation(promptOptions);
      } else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        confirmed = window.confirm(promptOptions.message);
      }
      if (!confirmed) {
        return { cancelled: true, unsyncedCount: remaining.length };
      }
    }
  }

  const currentUserId = get(user)?.id || get(userProfile)?.id || null;
  clearOfflineQueue();
  clearOfflineCache();
  clearAllChats(globalThis.localStorage, null);
  if (currentUserId) clearAllChats(globalThis.localStorage, currentUserId);
  clearStoredEventKey();
  clearAllScoutingDrafts();

  // This device only: signing out here should not sign the person out on their other devices.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) console.error('Error logging out:', error);
  // Clear these synchronously rather than waiting on the SIGNED_OUT event
  // from onAuthStateChange above - that event is real but its timing isn't
  // guaranteed relative to whatever the caller does right after awaiting
  // this (typically goto('/')), so a caller that navigates immediately
  // could land on a page that still reads the old signed-in user for a
  // beat. Setting both here makes "signed out" true the instant this
  // resolves, no matter when the event actually arrives.
  user.set(null);
  userProfile.set(null);
  return { cancelled: false, unsyncedCount: 0 };
}

// Back-compat alias for existing code that reads from "userStore"
export const userStore = userProfile;

/** Switches between light and dark and saves it on the account, so the person's other devices follow. */
export async function toggleAccountTheme() {
  const next = get(theme) === 'modern-dark' ? 'modern' : 'modern-dark';
  setTheme(next);
  const id = get(userProfile)?.id;
  if (!id) return;
  const { error } = await supabase.from('user_profiles').update({ theme_preference: next }).eq('id', id);
  if (error) console.warn('theme preference not saved:', error.message || error);
}
