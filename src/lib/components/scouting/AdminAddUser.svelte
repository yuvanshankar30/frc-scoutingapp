<script>
  // Lets an admin create a login by hand (a shared scouting tablet, or someone without their own email): enter a
  // username (or full email) and a password, and the account is approved and ready to sign in immediately. The account is
  // created server-side with the service_role key (see the 'create-user'
  // action in /api/scouting-admin), so this panel only ever sends the typed
  // values up - it never touches the auth admin API from the browser.
  import { authFetch } from '$lib/app/supabase.js';
  import { toEmail, usernameEmailDomain } from '$lib/app/loginEmail.js';
  import { competitionTeamChoices } from '$lib/app/teamSettings.js';
  import { team } from '$lib/stores/team.js';
  import { UserPlus, Eye, EyeOff } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';

  let username = '';
  let fullName = '';
  let password = '';
  let frcTeam = '';
  let showPassword = false;
  let saving = false;
  let errorMsg = '';
  let successMsg = '';

  $: teamChoices = competitionTeamChoices($team);
  // Mirror the login screen: a bare username is shorthand for an address at the username domain,
  // so show the admin exactly what address the person will sign in with.
  $: previewEmail = username.trim() ? toEmail(username) : '';

  async function submit() {
    errorMsg = '';
    successMsg = '';
    if (!username.trim()) {
      errorMsg = 'Enter a username or email.';
      return;
    }
    if (password.length < 8) {
      errorMsg = 'Password must be at least 8 characters.';
      return;
    }
    saving = true;
    try {
      const response = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-user',
          username: username.trim(),
          full_name: fullName.trim(),
          password,
          frc_team: frcTeam
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        errorMsg = payload?.error || 'Could not create the account.';
        return;
      }
      successMsg = `Created ${payload?.data?.email || previewEmail}. They can sign in now with the password you set.`;
      // Clear the sensitive field and the identity, but keep nothing lingering.
      username = '';
      fullName = '';
      password = '';
      frcTeam = '';
      showPassword = false;
    } catch (cause) {
      errorMsg = cause?.message || 'Could not create the account.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="add-user" aria-label="Add a user">
  <p class="sp-lede">
    Create a login by hand, for a shared scouting device or someone without their own email. The account is approved
    straight away; they sign in with the username and password you set here.
  </p>

  {#if errorMsg}<div class="status-message status-error" role="alert">{errorMsg}</div>{/if}
  {#if successMsg}<div class="status-message status-success" role="status">{successMsg}</div>{/if}

  <form class="au-form" on:submit|preventDefault={submit}>
    <label class="au-field">
      <span>Username</span>
      <input
        type="text"
        bind:value={username}
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        placeholder="e.g. jdoe"
        aria-describedby="au-username-hint"
      />
      <small id="au-username-hint" class="au-hint">
        {#if previewEmail}Signs in as <span class="mono">{previewEmail}</span>{:else}A bare username becomes <span
            class="mono">name@{usernameEmailDomain()}</span
          >. Enter a full email to use a different address.{/if}
      </small>
    </label>

    <label class="au-field">
      <span>Full name <em class="au-opt">(optional)</em></span>
      <input type="text" bind:value={fullName} maxlength="120" placeholder="Jane Doe" />
    </label>

    <label class="au-field">
      <span>Password</span>
      <div class="au-password">
        {#if showPassword}
          <input
            type="text"
            bind:value={password}
            autocomplete="new-password"
            minlength="8"
            placeholder="At least 8 characters"
          />
        {:else}
          <input
            type="password"
            bind:value={password}
            autocomplete="new-password"
            minlength="8"
            placeholder="At least 8 characters"
          />
        {/if}
        <button
          type="button"
          class="au-reveal"
          on:click={() => (showPassword = !showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
        >
          <svelte:component this={showPassword ? EyeOff : Eye} size={17} />
        </button>
      </div>
    </label>

    <label class="au-field">
      <span>FRC team <em class="au-opt">(optional)</em></span>
      <Select class="form-select" bind:value={frcTeam}>
        <option value="">Not set</option>
        {#each teamChoices as choice (choice)}<option value={choice}>{choice}</option>{/each}
      </Select>
    </label>

    <div class="au-actions">
      <button class="btn btn-primary" type="submit" disabled={saving || !username.trim() || password.length < 8}>
        <UserPlus size={16} />
        {saving ? 'Creating...' : 'Create account'}
      </button>
    </div>
  </form>
</section>

<style>
  .add-user {
    display: grid;
    gap: 1rem;
    max-width: 34rem;
  }
  .au-form {
    display: grid;
    gap: 1rem;
  }
  .au-field {
    display: grid;
    gap: 0.35rem;
  }
  .au-field > span {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }
  .au-opt {
    font-style: normal;
    font-weight: 400;
    color: var(--text-secondary);
  }
  .au-field input {
    width: 100%;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
  }
  .au-field input:focus {
    outline: none;
    border-color: var(--accent, #4f8cff);
  }
  .au-hint {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }
  .au-password {
    position: relative;
  }
  .au-password input {
    padding-right: 2.8rem;
  }
  .au-reveal {
    position: absolute;
    right: 0.35rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .au-reveal:hover {
    color: var(--text);
  }
  .au-actions {
    display: flex;
    justify-content: flex-start;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }
</style>
