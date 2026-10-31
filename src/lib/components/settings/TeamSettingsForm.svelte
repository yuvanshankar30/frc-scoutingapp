<script>
  // The team's settings form, shared by first-run setup (/setup) and Scouting Admin > Team settings. It edits a
  // plain object (`value`) in the shape validateTeamSettingsInput() expects; the page decides what to do with it.
  import Select from '$lib/components/common/Select.svelte';
  import { OPTIONAL_FEATURES, PRESET_BRAND_COLORS, normalizeHexColor } from '$lib/app/teamSettings.js';

  export let value;
  export let disabled = false;

  function supportedTimeZones() {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
    }
  }
  const timeZones = supportedTimeZones();

  // The hex box accepts anything while typing; the color only changes once it is a real color.
  let hexText = value.brandColor;
  $: if (normalizeHexColor(hexText, null)) value.brandColor = normalizeHexColor(hexText);
  const pickColor = (color) => {
    value.brandColor = color;
    hexText = color;
  };

  function toggleFeature(key, shown) {
    const hidden = new Set(value.hiddenFeatures || []);
    if (shown) hidden.delete(key);
    else hidden.add(key);
    value.hiddenFeatures = [...hidden];
  }
</script>

<fieldset class="tsf" {disabled}>
  <legend class="tsf-legend">Team</legend>
  <div class="tsf-row">
    <div class="tsf-field">
      <label for="tsf-number">Team number</label>
      <input
        id="tsf-number"
        class="form-input"
        inputmode="numeric"
        autocomplete="off"
        placeholder="1234"
        bind:value={value.teamNumber}
        required
      />
    </div>
    <div class="tsf-field grow">
      <label for="tsf-name">Team name</label>
      <input
        id="tsf-name"
        class="form-input"
        maxlength="80"
        placeholder="The Robo Raptors"
        bind:value={value.teamName}
        required
      />
    </div>
  </div>
  <div class="tsf-field">
    <label for="tsf-others">Other teams your members compete for <span class="opt">(optional)</span></label>
    <input
      id="tsf-others"
      class="form-input"
      placeholder="Sister or rookie teams, e.g. 5678, 9012"
      bind:value={value.otherTeamNumbers}
    />
    <small>People can be put on any of these (or Mentor) for an event in Scouting Admin &gt; People.</small>
  </div>
</fieldset>

<fieldset class="tsf" {disabled}>
  <legend class="tsf-legend">Look</legend>
  <div class="tsf-row">
    <div class="tsf-field grow">
      <label for="tsf-app">App name</label>
      <input
        id="tsf-app"
        class="form-input"
        maxlength="40"
        placeholder={value.teamNumber ? `${value.teamNumber} Scouting` : 'Team Scouting'}
        bind:value={value.appName}
      />
    </div>
    <div class="tsf-field">
      <label for="tsf-short">Short name</label>
      <input id="tsf-short" class="form-input" maxlength="16" placeholder="Scouting" bind:value={value.appShortName} />
    </div>
  </div>
  <div class="tsf-field">
    <span class="tsf-label" id="tsf-color-label">Brand color</span>
    <div class="tsf-colors" role="group" aria-labelledby="tsf-color-label">
      {#each PRESET_BRAND_COLORS as color (color)}
        <button
          type="button"
          class="swatch"
          class:on={value.brandColor === color}
          style:background={color}
          aria-label={`Use the color ${color}`}
          aria-pressed={value.brandColor === color}
          on:click={() => pickColor(color)}
        ></button>
      {/each}
      <input
        class="tsf-picker"
        type="color"
        aria-label="Pick any color"
        value={value.brandColor}
        on:input={(event) => pickColor(event.currentTarget.value)}
      />
      <input class="form-input tsf-hex" aria-label="Hex color" maxlength="7" bind:value={hexText} />
    </div>
    <small>Buttons, highlights and the active menu item use it. The page shows it as you pick.</small>
  </div>
  <div class="tsf-field">
    <span class="tsf-label" id="tsf-theme-label">Default theme</span>
    <div class="tsf-seg" role="group" aria-labelledby="tsf-theme-label">
      <button type="button" class:on={value.defaultTheme === 'dark'} on:click={() => (value.defaultTheme = 'dark')}
        >Dark</button
      >
      <button type="button" class:on={value.defaultTheme === 'light'} on:click={() => (value.defaultTheme = 'light')}
        >Light</button
      >
    </div>
    <small>Each person can still switch for themselves.</small>
  </div>
</fieldset>

<fieldset class="tsf" {disabled}>
  <legend class="tsf-legend">Event days</legend>
  <div class="tsf-field">
    <label for="tsf-tz">Timezone</label>
    <Select id="tsf-tz" class="form-select" bind:value={value.timeZone}>
      {#each timeZones as zone (zone)}<option value={zone}>{zone.replace(/_/g, ' ')}</option>{/each}
    </Select>
    <small>Match times, deadlines and exports use it, whatever each phone is set to.</small>
  </div>
  <div class="tsf-field">
    <span class="tsf-label">Pages in the menu</span>
    <div class="tsf-features">
      {#each OPTIONAL_FEATURES as feature (feature.key)}
        <label class="tsf-check">
          <input
            type="checkbox"
            checked={!(value.hiddenFeatures || []).includes(feature.key)}
            on:change={(event) => toggleFeature(feature.key, event.currentTarget.checked)}
          />
          <span><b>{feature.label}</b><small>{feature.blurb}</small></span>
        </label>
      {/each}
    </div>
  </div>
  <label class="tsf-check">
    <input type="checkbox" bind:checked={value.allowSignUp} />
    <span
      ><b>Let people create their own accounts</b><small
        >New accounts wait until an admin approves them. Turn this off to add every account yourself.</small
      ></span
    >
  </label>
</fieldset>

<style>
  .tsf {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .tsf-legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-family: var(--font-display);
    font-size: 0.82rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-strong);
  }
  .tsf-row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .tsf-field {
    display: grid;
    gap: var(--space-1);
    min-width: 8rem;
  }
  .tsf-field.grow {
    flex: 1;
    min-width: 12rem;
  }
  .tsf-field label,
  .tsf-label {
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .opt {
    font-weight: 400;
    color: var(--text-muted);
  }
  small {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .tsf-colors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .swatch {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    border: 2px solid var(--surface-1);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }
  .swatch.on {
    box-shadow: 0 0 0 3px var(--text);
  }
  .tsf-picker {
    width: 2.4rem;
    height: 2.2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
  }
  .tsf-hex {
    width: 7.5rem;
    font-family: var(--font-mono-stack);
  }
  .tsf-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    justify-self: start;
  }
  .tsf-seg button {
    padding: 0.5rem 1.2rem;
    border: 0;
    background: var(--surface-1);
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .tsf-seg button.on {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .tsf-features {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-2);
  }
  .tsf-check {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    cursor: pointer;
  }
  .tsf-check input {
    margin-top: 0.2rem;
    accent-color: var(--accent);
  }
  .tsf-check span {
    display: grid;
    gap: 2px;
  }
  .tsf-check b {
    font-weight: 500;
  }
</style>
