<script>
  import { goto } from '$app/navigation';
  import { Moon, Sun } from 'lucide-svelte';
  import { signOut, user, userProfile, toggleAccountTheme } from '$lib/stores/auth.js';
  import { theme } from '$lib/stores/theme.js';
  import { canAdministerScouting } from '$lib/app/navigation.js';

  const title = (value) =>
    String(value || '')
      .replace(/[-_]/g, ' ')
      .replace(/^./, (letter) => letter.toUpperCase());

  $: profile = $userProfile;
  $: name = profile?.full_name || $user?.email || '';
  $: rosterKeys = profile?.roster_keys || [];
  $: isAdmin = profile?.role === 'admin';
  $: scoutingAdmin = canAdministerScouting(profile);
  $: approved = isAdmin || (profile?.permissions || []).includes('CAN_SEE_ROUTES');
  $: joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  async function handleSignOut() {
    await signOut();
    await goto('/login');
  }
</script>

<svelte:head><title>Account</title></svelte:head>

<div class="account">
  <section class="card identity" aria-label="Profile">
    <span class="avatar" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</span>
    <div>
      <h1>{name || 'Account'}</h1>
      <p class="muted">{$user?.email || ''}</p>
    </div>
  </section>

  {#if profile && !approved}
    <p class="notice" role="status">
      Your account is waiting for an admin to approve it. Scouting data will appear once you are approved.
    </p>
  {/if}

  <section class="card" aria-label="Access">
    <h2>Access</h2>
    <dl>
      <div>
        <dt>Role</dt>
        <dd>{isAdmin ? 'Admin' : title(profile?.general_role || profile?.role || 'member')}</dd>
      </div>
      <div>
        <dt>Team</dt>
        <dd>
          {profile?.competition_team
            ? profile.competition_team === 'Mentor'
              ? 'Mentor'
              : `Team ${profile.competition_team}`
            : 'Not set'}
        </dd>
      </div>
      <div>
        <dt>Scouting admin</dt>
        <dd>{scoutingAdmin ? 'Yes' : 'No'}</dd>
      </div>
      <div>
        <dt>Roster keys</dt>
        <dd>{rosterKeys.length ? rosterKeys.join(', ') : 'None'}</dd>
      </div>
      {#if joined}<div>
          <dt>Joined</dt>
          <dd>{joined}</dd>
        </div>{/if}
    </dl>
  </section>

  <section class="card" aria-label="Preferences">
    <h2>Preferences</h2>
    <div class="row">
      <div>
        <b>Appearance</b>
        <p class="muted">{$theme === 'modern-dark' ? 'Dark' : 'Light'} mode. Dark is easier to read in a dim venue.</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" on:click={toggleAccountTheme}>
        {#if $theme === 'modern-dark'}<Sun size={15} /> Light mode{:else}<Moon size={15} /> Dark mode{/if}
      </button>
    </div>
  </section>

  <section class="card" aria-label="Session">
    <div class="row">
      <div>
        <b>Sign out</b>
        <p class="muted">End your session on this device.</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" on:click={handleSignOut}>Sign out</button>
    </div>
  </section>
</div>

<style>
  .account {
    display: grid;
    gap: var(--space-4);
    width: 100%;
    max-width: 44rem;
    margin-inline: auto;
  }
  .card {
    padding: var(--space-5);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    display: grid;
    gap: var(--space-3);
  }
  .identity {
    grid-auto-flow: column;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-4);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-size: 1.7rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .notice {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--accent-subtle);
    color: var(--accent-strong);
    border: 1px solid var(--accent);
  }
  dl {
    margin: 0;
    display: grid;
  }
  dl > div {
    display: grid;
    grid-template-columns: 9rem 1fr;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  dl > div:last-child {
    border-bottom: 0;
  }
  dt {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  dd {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .row .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  @media (max-width: 600px) {
    dl > div {
      grid-template-columns: 1fr;
      gap: 2px;
    }
    .row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
