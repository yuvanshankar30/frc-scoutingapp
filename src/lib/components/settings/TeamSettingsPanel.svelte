<script>
  // Scouting Admin > Team settings: the team, its look and its pages (scripts can set them with `npm run admin`). Admins and the Competition Lead can save;
  // the server checks that again (/api/team-settings).
  import { onDestroy } from 'svelte';
  import { ImagePlus, Trash2 } from 'lucide-svelte';
  import TeamSettingsForm from '$lib/components/settings/TeamSettingsForm.svelte';
  import TeamMark from '$lib/components/common/TeamMark.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { applyBrand, clearBrand } from '$lib/app/brand.js';
  import { normalizeAppearance } from '$lib/app/appearance.js';
  import { DEFAULT_BRAND_COLOR } from '$lib/app/teamSettings.js';
  import { setTeam, team } from '$lib/stores/team.js';
  import { theme } from '$lib/stores/theme.js';
  import { userProfile } from '$lib/stores/auth.js';
  import { isCompetitionLead } from '$lib/scouting/competitionRoles.js';

  $: canEdit = $userProfile?.role === 'admin' || isCompetitionLead($userProfile);

  const formFrom = (settings) => ({
    teamNumber: String(settings?.teamNumber || ''),
    teamName: settings?.teamName || '',
    otherTeamNumbers: (settings?.otherTeamNumbers || []).join(', '),
    appName: settings?.appName || '',
    appShortName: settings?.appShortName || '',
    brandColor: settings?.brandColor || DEFAULT_BRAND_COLOR,
    defaultTheme: settings?.defaultTheme || 'dark',
    timeZone: settings?.timeZone || 'UTC',
    hiddenFeatures: [...(settings?.hiddenFeatures || [])],
    allowSignUp: settings?.allowSignUp !== false,
    appearance: { ...normalizeAppearance(settings?.appearance) }
  });

  let form = formFrom($team);
  let saving = false;
  let errorMsg = '';
  let successMsg = '';
  let logoInput;

  // Preview the color and look while editing; leaving the page puts the saved ones back.
  $: applyBrand(form.brandColor, $theme, form.appearance);
  onDestroy(clearBrand);

  async function post(body) {
    const response = await authFetch('/api/team-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save.');
    setTeam(result.settings);
    return result.settings;
  }

  async function save() {
    errorMsg = '';
    successMsg = '';
    saving = true;
    try {
      form = formFrom(await post({ settings: form }));
      successMsg = 'Saved. Everyone sees the change the next time they load the site.';
    } catch (cause) {
      errorMsg = cause.message;
    } finally {
      saving = false;
    }
  }

  async function uploadLogo(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    errorMsg = '';
    successMsg = '';
    if (file.size > 256 * 1024) {
      errorMsg = 'The logo must be 256 KB or smaller.';
      return;
    }
    saving = true;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
      });
      await post({ action: 'upload-logo', dataUrl });
      successMsg = 'Logo updated.';
    } catch (cause) {
      errorMsg = cause.message;
    } finally {
      saving = false;
    }
  }

  async function removeLogo() {
    saving = true;
    errorMsg = '';
    try {
      await post({ action: 'remove-logo' });
      successMsg = 'Logo removed.';
    } catch (cause) {
      errorMsg = cause.message;
    } finally {
      saving = false;
    }
  }
</script>

<section class="team-settings" aria-label="Team settings">
  <p class="sp-lede">
    Your team, how the app looks and which pages are in the menu. Scripts can set the same things with
    <code>npm run admin -- set-team</code>.
  </p>
  {#if !canEdit}
    <div class="status-message status-error" role="alert">Only an admin or the Competition Lead can change these.</div>
  {/if}
  {#if errorMsg}<div class="status-message status-error" role="alert">{errorMsg}</div>{/if}
  {#if successMsg}<div class="status-message status-success" role="status">{successMsg}</div>{/if}

  <div class="logo-row">
    <TeamMark size={56} preview={form.appearance} />
    <div class="logo-actions">
      <b>Logo</b>
      <small
        >PNG, JPEG or WebP, up to 256 KB. Square images look best. Without one, the badge from Appearance below is
        shown.</small
      >
      <div class="logo-buttons">
        <input
          bind:this={logoInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          on:change={uploadLogo}
        />
        <button
          class="btn btn-outline btn-sm"
          type="button"
          disabled={!canEdit || saving}
          on:click={() => logoInput.click()}><ImagePlus size={15} /> Upload</button
        >
        {#if $team?.logoUrl}
          <button class="btn btn-outline btn-sm" type="button" disabled={!canEdit || saving} on:click={removeLogo}
            ><Trash2 size={15} /> Remove</button
          >
        {/if}
      </div>
    </div>
  </div>

  <form class="ts-form" on:submit|preventDefault={save}>
    <TeamSettingsForm bind:value={form} disabled={!canEdit || saving} />
    <div>
      <button class="btn btn-primary" type="submit" disabled={!canEdit || saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </button>
    </div>
  </form>
</section>

<style>
  .team-settings {
    display: grid;
    gap: var(--space-4);
    max-width: 44rem;
  }
  .ts-form {
    display: grid;
    gap: var(--space-4);
  }
  .logo-row {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .logo-actions {
    display: grid;
    gap: var(--space-1);
  }
  .logo-actions small {
    color: var(--text-muted);
  }
  .logo-buttons {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: var(--space-1);
  }
</style>
