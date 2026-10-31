<script>
  // First-run setup. The site sends everyone here until it is done (hooks.server.js). Whoever finishes it
  // becomes the first admin; the setup token from the server's environment proves they own this deployment.
  import { onMount } from 'svelte';
  import { CircleAlert, LoaderCircle, Rocket } from 'lucide-svelte';
  import TeamSettingsForm from '$lib/components/settings/TeamSettingsForm.svelte';
  import { DEFAULT_BRAND_COLOR, DEFAULT_THEME } from '$lib/app/teamSettings.js';
  import { applyBrand } from '$lib/app/brand.js';
  import { setTheme, theme } from '$lib/stores/theme.js';
  import { supabase } from '$lib/app/supabase.js';

  let status = null;
  let busy = false;
  let error = '';
  let setupToken = '';
  const admin = { fullName: '', email: '', password: '' };

  const browserTimeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();

  let team = {
    teamNumber: '',
    teamName: '',
    otherTeamNumbers: '',
    appName: '',
    appShortName: '',
    brandColor: DEFAULT_BRAND_COLOR,
    defaultTheme: DEFAULT_THEME,
    timeZone: browserTimeZone,
    // Ask the data needs an AI API key, so it starts switched off.
    hiddenFeatures: ['assistant'],
    allowSignUp: true
  };

  // Show the choices as they are made.
  $: setTheme(team.defaultTheme === 'light' ? 'modern' : 'modern-dark');
  $: applyBrand(team.brandColor, $theme);

  onMount(async () => {
    status = await fetch('/api/setup')
      .then((response) => response.json())
      .catch(() => ({ databaseError: 'The server did not answer.' }));
    if (status?.configured) window.location.replace('/');
  });

  async function submit() {
    error = '';
    busy = true;
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken, team, admin })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Setup did not finish.');
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: admin.email.trim().toLowerCase(),
        password: admin.password
      });
      // A full load picks up the saved settings everywhere (title, colors, menu).
      window.location.replace(signInError ? '/login' : '/');
    } catch (cause) {
      error = cause?.message || 'Setup did not finish.';
      busy = false;
    }
  }
</script>

<svelte:head><title>Set up your scouting app</title></svelte:head>

<main class="setup">
  <section class="panel" aria-labelledby="setup-title">
    <header class="head">
      <span class="badge" aria-hidden="true"><Rocket size={22} /></span>
      <div>
        <span class="eyebrow">First-run setup</span>
        <h1 id="setup-title">Make it your team's</h1>
      </div>
    </header>
    <p class="hint">
      This runs once. You become the site's first admin, and everything here can be changed later in Scouting Admin &gt;
      Team settings.
    </p>

    {#if status === null}
      <p class="hint" role="status">Checking the server...</p>
    {:else if status.databaseError}
      <p class="msg err" role="alert">
        <CircleAlert size={17} aria-hidden="true" />
        <span
          >{status.databaseError} Check PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in the server's environment, and apply
          the schema in supabase/migrations (see the README).</span
        >
      </p>
    {:else if !status.tokenConfigured}
      <p class="msg err" role="alert">
        <CircleAlert size={17} aria-hidden="true" />
        <span
          >Set <code>SETUP_TOKEN</code> in the server's environment to a long random secret, restart the server, and reload
          this page. Only someone who knows it can finish setup.</span
        >
      </p>
    {:else}
      <form on:submit|preventDefault={submit}>
        <TeamSettingsForm bind:value={team} disabled={busy} />

        <fieldset class="group" disabled={busy}>
          <legend class="legend">Your admin account</legend>
          <div class="row">
            <div class="field grow">
              <label for="setup-name">Your name</label>
              <input id="setup-name" class="form-input" autocomplete="name" bind:value={admin.fullName} required />
            </div>
            <div class="field grow">
              <label for="setup-email">Email</label>
              <input
                id="setup-email"
                class="form-input"
                type="email"
                autocomplete="email"
                bind:value={admin.email}
                required
              />
            </div>
          </div>
          <div class="field">
            <label for="setup-password">Password</label>
            <input
              id="setup-password"
              class="form-input"
              type="password"
              autocomplete="new-password"
              minlength="8"
              bind:value={admin.password}
              required
            />
          </div>
          <div class="field">
            <label for="setup-token">Setup token</label>
            <input
              id="setup-token"
              class="form-input"
              type="password"
              autocomplete="off"
              bind:value={setupToken}
              required
            />
            <small>The <code>SETUP_TOKEN</code> value from the server's environment (your .env file).</small>
          </div>
        </fieldset>

        {#if error}
          <p class="msg err" role="alert"><CircleAlert size={17} aria-hidden="true" /> <span>{error}</span></p>
        {/if}

        <button class="btn btn-primary submit" type="submit" disabled={busy} aria-busy={busy}>
          {#if busy}<LoaderCircle size={18} class="spin" aria-hidden="true" /> Setting up{:else}Finish setup{/if}
        </button>
      </form>
    {/if}
  </section>
</main>

<style>
  .setup {
    min-height: calc(100 * var(--vh));
    display: grid;
    place-items: start center;
    padding: var(--space-6) var(--space-4);
    background: radial-gradient(70rem 34rem at 50% -12%, var(--accent-subtle), transparent), var(--background);
  }
  .panel {
    width: min(44rem, 100%);
    padding: clamp(var(--space-5), calc(4 * var(--vw)), 2.5rem);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: grid;
    gap: var(--space-4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .eyebrow,
  .legend {
    display: block;
    font-family: var(--font-display);
    font-size: 0.82rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-strong);
  }
  .legend {
    padding: 0;
    margin-bottom: var(--space-2);
  }
  h1 {
    margin: 0;
    font-size: 2rem;
    line-height: 1.1;
  }
  .hint {
    margin: 0;
    color: var(--text-secondary);
  }
  form {
    display: grid;
    gap: var(--space-5);
  }
  .group {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field.grow {
    flex: 1;
    min-width: 12rem;
  }
  .field label {
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  small {
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .msg {
    margin: 0;
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .msg :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .err {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .submit {
    min-height: 3.1rem;
    font-size: 1.02rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
  .submit :global(.spin) {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
