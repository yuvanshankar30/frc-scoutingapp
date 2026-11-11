<script>
  // Scouting Admin > Team settings: the team, its look and its pages (scripts can set them with `npm run admin`). Admins and the Competition Lead can save;
  // the server checks that again (/api/team-settings).
  import { onDestroy } from 'svelte';
  import { ImagePlus, Trash2 } from 'lucide-svelte';
  import TeamSettingsForm from '$lib/components/settings/TeamSettingsForm.svelte';
  import TeamMark from '$lib/components/common/TeamMark.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { applyBrand, clearBrand } from '$lib/app/brand.js';
  import { TAB_ICONS, normalizeAppearance, tabIconHref } from '$lib/app/appearance.js';
  import { setTabIcon, showTeamTabIcon } from '$lib/app/tabIcon.js';
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
  // The browser tab previews the icon choice too.
  $: tabPreview = tabIconHref(form.appearance, { ...$team, ...form }, form.brandColor);
  $: setTabIcon(tabPreview);
  onDestroy(() => {
    clearBrand();
    showTeamTabIcon($team);
  });
  let tabIconInput;

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

  const uploadLogo = (event) => uploadImage(event, 'upload-logo', 'The logo', 'Logo updated.');
  const uploadTabIcon = (event) => uploadImage(event, 'upload-tab-icon', 'The icon', 'Tab icon updated.');

  async function uploadImage(event, action, what, done) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    errorMsg = '';
    successMsg = '';
    if (file.size > 256 * 1024) {
      errorMsg = `${what} must be 256 KB or smaller.`;
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
      const saved = await post({ action, dataUrl });
      if (action === 'upload-tab-icon') form.appearance = { ...form.appearance, ...pickTabIcon(saved) };
      successMsg = done;
    } catch (cause) {
      errorMsg = cause.message;
    } finally {
      saving = false;
    }
  }

  const pickTabIcon = (settings) => {
    const look = normalizeAppearance(settings?.appearance);
    return { tabIcon: look.tabIcon, tabIconUrl: look.tabIconUrl };
  };

  async function removeTabIcon() {
    saving = true;
    errorMsg = '';
    try {
      form.appearance = { ...form.appearance, ...pickTabIcon(await post({ action: 'remove-tab-icon' })) };
      successMsg = 'Tab icon removed.';
    } catch (cause) {
      errorMsg = cause.message;
    } finally {
      saving = false;
    }
  }

  function chooseTabIcon(key) {
    if (key === 'custom' && !form.appearance.tabIconUrl) {
      tabIconInput.click();
      return;
    }
    form.appearance = { ...form.appearance, tabIcon: key };
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

  <div class="brand-cards">
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

  <div class="logo-row tab-icon-row">
    <div class="tab-mock" aria-label="Preview of the browser tab">
      <img src={tabPreview} alt="" width="16" height="16" />
      <span>{form.appName || $team?.appName || 'Scouting'}</span>
      <i aria-hidden="true">×</i>
    </div>
    <div class="logo-actions">
      <b>Browser tab icon</b>
      <small>The little picture in the browser tab and bookmarks. Saved with the settings below; an uploaded image is
        saved right away.</small>
      <div class="tab-seg" role="group" aria-label="Browser tab icon">
        {#each TAB_ICONS as option (option.key)}
          <button
            type="button"
            class:on={form.appearance.tabIcon === option.key}
            aria-pressed={form.appearance.tabIcon === option.key}
            disabled={!canEdit || saving || (option.key === 'logo' && !$team?.logoUrl)}
            title={option.key === 'logo' && !$team?.logoUrl ? 'Upload a logo first' : ''}
            on:click={() => chooseTabIcon(option.key)}>{option.label}</button
          >
        {/each}
      </div>
      <div class="logo-buttons">
        <input
          bind:this={tabIconInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          on:change={uploadTabIcon}
        />
        <button
          class="btn btn-outline btn-sm"
          type="button"
          disabled={!canEdit || saving}
          on:click={() => tabIconInput.click()}><ImagePlus size={15} /> Upload image</button
        >
        {#if form.appearance.tabIconUrl}
          <button class="btn btn-outline btn-sm" type="button" disabled={!canEdit || saving} on:click={removeTabIcon}
            ><Trash2 size={15} /> Remove image</button
          >
        {/if}
      </div>
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
    max-width: 96rem;
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
  .brand-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: var(--space-4);
  }
  .tab-mock {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    width: 11rem;
    padding: 0.55rem 0.7rem;
    border-radius: 10px 10px 0 0;
    background: var(--surface-3, var(--surface-2));
    box-shadow: inset 0 -2px 0 var(--accent);
    font-size: var(--text-sm);
  }
  .tab-mock img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
  .tab-mock span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-mock i {
    font-style: normal;
    color: var(--text-muted);
  }
  .tab-seg {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    width: fit-content;
    margin-top: var(--space-1);
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-button, 999px);
    background: var(--surface-2);
  }
  .tab-seg button {
    padding: 0.3rem 0.75rem;
    border: 0;
    border-radius: var(--radius-button, 999px);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .tab-seg button.on {
    background: var(--accent-subtle);
    color: var(--text-primary);
  }
  .tab-seg button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* Phone: wrap, never cut text. The mock tab's title wraps instead of ending in "...". */
  @media (max-width: 900px) {
    .tab-mock span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
  @media (max-width: 40rem) {
    .tab-icon-row {
      flex-direction: column;
      align-items: flex-start;
    }
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
