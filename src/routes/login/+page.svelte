<script>
  import { onMount } from 'svelte';
  import { slide, fade, fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ChevronDown, CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle } from 'lucide-svelte';
  import { supabase } from '$lib/app/supabase.js';
  import { safeInternalPath } from '$lib/app/safeUrl.js';
  import { toEmail } from '$lib/app/loginEmail.js';
  import { initAuth, user, userProfile, authReady } from '$lib/stores/auth.js';
  import { team } from '$lib/stores/team.js';
  import TeamMark from '$lib/components/common/TeamMark.svelte';

  // mode: 'signin' or 'signup'. Sign-up is offered only when Team settings allow it; new accounts wait for an
  // admin to approve them (Scouting Admin > People) before they see anything.
  let mode = 'signin';
  let fullName = '';
  let email = '';
  let password = '';
  let showPassword = false;
  let showHelp = false;
  let busy = false;
  let error = '';
  let notice = '';
  let shakeKey = 0;

  // Animations are skipped for people who ask their system for less motion.
  const reduceMotion = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = (value) => (reduceMotion ? 0 : value);

  $: appName = $team?.appName || 'Scouting';
  $: teamLine = $team?.teamNumber ? ['Team ' + $team.teamNumber, $team.teamName].filter(Boolean).join(' · ') : '';
  $: canSignUp = $team?.allowSignUp !== false;
  $: if (!canSignUp && mode === 'signup') mode = 'signin';
  $: isSignUp = mode === 'signup';

  // Only ever return to a path inside this app.
  $: next = safeInternalPath($page.url.searchParams.get('next'), '/');
  $: if (browser && !busy && $authReady && $user && !$userProfile?.banned) void goto(next, { replaceState: true });

  onMount(() => initAuth());

  function fail(message) {
    error = message;
    shakeKey += 1;
  }

  function switchMode(nextMode) {
    mode = nextMode;
    error = '';
    notice = '';
  }

  async function signIn() {
    const { data, error: failure } = await supabase.auth.signInWithPassword({ email: toEmail(email), password });
    if (failure) throw failure;
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('banned')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profile?.banned === true) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('This account has been disabled.');
    }
  }

  async function signUp() {
    if (!fullName.trim()) throw new Error('Enter your name.');
    if (!email.includes('@')) throw new Error('Enter your email address.');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const { data, error: failure } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/login` }
    });
    if (failure) throw failure;
    // With email confirmation on (the Supabase default) there is no session until the link is clicked.
    if (!data.session) {
      switchMode('signin');
      notice =
        'Check your email for a link to confirm your address, then sign in. An admin then approves your account.';
    }
  }

  async function submit() {
    error = '';
    notice = '';
    busy = true;
    try {
      if (isSignUp) await signUp();
      else await signIn();
    } catch (cause) {
      const message = cause?.message || '';
      fail(
        message === 'Invalid login credentials'
          ? 'That username or password is not right.'
          : /signups? not allowed/i.test(message)
            ? 'New accounts are turned off. Ask an admin to make one for you.'
            : message || 'Could not sign in.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in - {appName}</title></svelte:head>

<main class="login">
  <section class="panel" aria-labelledby="login-title" in:fly={{ y: 16, duration: ms(380) }}>
    <div class="mark">
      <TeamMark size={52} />
      <div>
        {#if teamLine}<span class="eyebrow">{teamLine}</span>{/if}
        <h1 id="login-title">{appName}</h1>
        {#if $team?.appearance?.tagline}<p class="tagline">{$team.appearance.tagline}</p>{/if}
      </div>
    </div>

    <p class="hint">
      {isSignUp
        ? 'Create an account. An admin approves it before you can see the scouting data.'
        : 'Sign in with your username or email and password.'}
    </p>

    <form on:submit|preventDefault={submit} novalidate>
      {#if isSignUp}
        <div class="field" transition:slide={{ duration: ms(200) }}>
          <label for="login-name">Your name</label>
          <input id="login-name" class="form-input" type="text" bind:value={fullName} autocomplete="name" required />
        </div>
      {/if}
      <div class="field">
        <label for="login-id">{isSignUp ? 'Email' : 'Username or email'}</label>
        <input
          id="login-id"
          class="form-input"
          type="text"
          bind:value={email}
          autocomplete={isSignUp ? 'email' : 'username'}
          autocapitalize="none"
          spellcheck="false"
          required
        />
      </div>

      <div class="field">
        <label for="login-password">Password</label>
        <div class="password-wrap">
          {#if showPassword}
            <input
              id="login-password"
              class="form-input"
              type="text"
              bind:value={password}
              autocomplete={isSignUp ? 'new-password' : 'current-password'}
              minlength="8"
              required
            />
          {:else}
            <input
              id="login-password"
              class="form-input"
              type="password"
              bind:value={password}
              autocomplete={isSignUp ? 'new-password' : 'current-password'}
              minlength="8"
              required
            />
          {/if}
          <button
            type="button"
            class="reveal"
            on:click={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {#if showPassword}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
          </button>
        </div>
      </div>

      {#if notice}
        <p class="msg ok" role="status" in:fade={{ duration: ms(160) }}>
          <CircleCheck size={17} aria-hidden="true" /> <span>{notice}</span>
        </p>
      {/if}
      {#if error}
        {#key shakeKey}
          <p class="msg err" role="alert" in:fade={{ duration: ms(160) }} class:shake={!reduceMotion}>
            <CircleAlert size={17} aria-hidden="true" /> <span>{error}</span>
          </p>
        {/key}
      {/if}

      <button class="btn btn-primary submit" type="submit" disabled={busy} aria-busy={busy}>
        {#if busy}<LoaderCircle size={18} class="spin" aria-hidden="true" />
          {isSignUp ? 'Creating account' : 'Signing in'}{:else}{isSignUp ? 'Create account' : 'Sign in'}{/if}
      </button>
    </form>

    <div class="links">
      {#if canSignUp}
        <button type="button" class="switch" on:click={() => switchMode(isSignUp ? 'signin' : 'signup')}>
          {isSignUp ? 'I already have an account' : 'Create an account'}
        </button>
      {/if}
      <button
        type="button"
        class="switch help-toggle"
        aria-expanded={showHelp}
        aria-controls="forgot-panel"
        on:click={() => (showHelp = !showHelp)}
      >
        Forgot password?
        <span class="chev" class:open={showHelp}><ChevronDown size={15} aria-hidden="true" /></span>
      </button>
    </div>

    {#if showHelp}
      <p id="forgot-panel" class="help" transition:slide={{ duration: ms(260) }}>
        Ask an admin to set a new password for you in Scouting Admin &gt; People.
      </p>
    {/if}
  </section>
</main>

<style>
  .tagline {
    margin: 2px 0 0;
    color: var(--text-secondary);
    font-size: 0.92rem;
  }
  .login {
    min-height: calc(100 * var(--vh));
    display: grid;
    place-items: center;
    padding: var(--space-5);
    background: radial-gradient(70rem 34rem at 50% -12%, var(--accent-subtle), transparent), var(--background);
  }
  .panel {
    width: min(34rem, 100%);
    padding: clamp(var(--space-5), calc(5 * var(--vw)), 2.75rem);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: grid;
    gap: var(--space-4);
  }
  .mark {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .eyebrow {
    display: block;
    font-family: var(--font-display);
    font-size: 0.82rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-strong);
  }
  h1 {
    margin: 0;
    font-size: 2.1rem;
    line-height: 1.1;
  }

  .hint {
    margin: calc(var(--space-2) * -1) 0 0;
    color: var(--text-secondary);
    font-size: 0.97rem;
  }

  form {
    display: grid;
    gap: var(--space-4);
  }
  .field {
    display: grid;
    gap: var(--space-2);
  }
  .field label {
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .field :global(.form-input) {
    min-height: 3rem;
    font-size: 1rem;
    width: 100%;
    box-sizing: border-box;
    transition:
      border-color 0.16s ease,
      box-shadow 0.16s ease;
  }
  .field :global(.form-input:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--btn-focus-ring);
  }
  .links {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .password-wrap {
    position: relative;
  }
  .password-wrap :global(.form-input) {
    padding-right: 3rem;
  }
  .reveal {
    position: absolute;
    top: 50%;
    right: 0.4rem;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .reveal:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .help-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .help-toggle:hover {
    text-decoration: underline;
  }
  .chev {
    display: inline-grid;
    transition: transform 0.22s ease;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .help {
    margin: 0;
    padding-left: var(--space-3);
    border-left: 2px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .msg {
    margin: 0;
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: 0.92rem;
    line-height: 1.4;
  }
  .msg :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
  }
  .err {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .shake {
    animation: shake 0.36s ease;
  }
  @keyframes shake {
    20% {
      transform: translateX(-5px);
    }
    40% {
      transform: translateX(5px);
    }
    60% {
      transform: translateX(-3px);
    }
    80% {
      transform: translateX(3px);
    }
  }

  .submit {
    min-height: 3.1rem;
    font-size: 1.02rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    transition:
      transform 0.12s ease,
      filter 0.15s ease;
  }
  .submit:not(:disabled):active {
    transform: translateY(1px);
  }
  .submit:disabled {
    cursor: progress;
    opacity: 0.85;
  }
  .submit :global(.spin) {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .switch {
    background: none;
    border: 0;
    color: var(--accent-strong);
    cursor: pointer;
    font: inherit;
    padding: 0;
    justify-self: start;
  }
  .switch:hover {
    text-decoration: underline;
  }

  @media (prefers-reduced-motion: reduce) {
    .chev,
    .field :global(.form-input),
    .submit {
      transition: none;
    }
    .submit :global(.spin) {
      animation-duration: 2s;
    }
  }
  @media (max-width: 520px) {
    .login {
      padding: var(--space-3);
    }
    h1 {
      font-size: 1.75rem;
    }
  }
</style>
