<script>
  // The team's settings form, used by Scouting Admin > Team settings. It edits a
  // plain object (`value`) in the shape validateTeamSettingsInput() expects; the page decides what to do with it.
  import Select from '$lib/components/common/Select.svelte';
  import TeamMark from '$lib/components/common/TeamMark.svelte';
  import { OPTIONAL_FEATURES, PRESET_BRAND_COLORS, normalizeHexColor } from '$lib/app/teamSettings.js';
  import { CORNERS, FONTS, MARK_SHAPES, MARK_STYLES, PALETTES } from '$lib/app/appearance.js';

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

  // The second color works like the brand color, and can be left empty to follow the brand color.
  let secondText = value.appearance.secondaryColor;
  $: if (normalizeHexColor(secondText, null)) value.appearance.secondaryColor = normalizeHexColor(secondText);
  const pickSecond = (color) => {
    value.appearance.secondaryColor = color;
    secondText = color;
  };
  $: previewName = String(
    value.appName || (value.teamNumber ? `${value.teamNumber} Scouting` : 'Team Scouting')
  ).trim();
  $: previewWords = previewName.split(/\s+/);

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
  <legend class="tsf-legend">Appearance</legend>
  <div class="tsf-preview" aria-label="Preview">
    <div class="pv-brand">
      <TeamMark size={40} preview={value.appearance} badgeOnly />
      <div>
        <b class="pv-name"
          >{#if value.appearance.serifAccent && previewWords.length > 1}{previewWords.slice(0, -1).join(' ')}
            <span class="serif-accent">{previewWords.at(-1)}</span>{:else}{previewName}{/if}</b
        >
        <small>{value.appearance.tagline || 'Your tagline shows on the sign-in page.'}</small>
      </div>
    </div>
    <div class="pv-row">
      <span class="btn btn-primary btn-sm">Primary</span>
      <span class="btn btn-outline btn-sm">Outline</span>
      <span class="pv-chip">Chip</span>
      <span class="pv-card">Card</span>
    </div>
  </div>

  <div class="tsf-field">
    <span class="tsf-label" id="tsf-palette-label">Palette</span>
    <div class="tsf-palettes" role="group" aria-labelledby="tsf-palette-label">
      {#each PALETTES as palette (palette.key)}
        <button
          type="button"
          class="palette"
          class:on={value.appearance.palette === palette.key}
          aria-pressed={value.appearance.palette === palette.key}
          on:click={() => (value.appearance.palette = palette.key)}
        >
          <span class="palette-swatches" aria-hidden="true">
            <i style:background={palette.dark[0]}></i><i style:background={palette.dark[2]}></i><i
              style:background={palette.light[0]}
            ></i><i style:background={value.brandColor}></i>
          </span>
          <span>{palette.label}</span>
        </button>
      {/each}
    </div>
    <small>The page and card colors, for both dark and light. The brand color stays the accent.</small>
  </div>

  <div class="tsf-field">
    <span class="tsf-label" id="tsf-second-label">Second color</span>
    <div class="tsf-colors" role="group" aria-labelledby="tsf-second-label">
      <button
        type="button"
        class="tsf-same"
        class:on={!value.appearance.secondaryColor}
        aria-pressed={!value.appearance.secondaryColor}
        on:click={() => pickSecond('')}>Same as brand</button
      >
      {#each PRESET_BRAND_COLORS as color (color)}
        <button
          type="button"
          class="swatch"
          class:on={value.appearance.secondaryColor === color}
          style:background={color}
          aria-label={`Use the second color ${color}`}
          aria-pressed={value.appearance.secondaryColor === color}
          on:click={() => pickSecond(color)}
        ></button>
      {/each}
      <input
        class="tsf-picker"
        type="color"
        aria-label="Pick any second color"
        value={value.appearance.secondaryColor || value.brandColor}
        on:input={(event) => pickSecond(event.currentTarget.value)}
      />
      <input class="form-input tsf-hex" aria-label="Second hex color" maxlength="7" bind:value={secondText} />
    </div>
    <small>The serif word in the app name and the soft glow behind the page.</small>
  </div>

  <div class="tsf-row">
    <div class="tsf-field grow">
      <span class="tsf-label" id="tsf-font-label">Font</span>
      <div class="tsf-fonts" role="group" aria-labelledby="tsf-font-label">
        {#each FONTS as font (font.key)}
          <button
            type="button"
            class="font"
            class:on={value.appearance.font === font.key}
            aria-pressed={value.appearance.font === font.key}
            on:click={() => (value.appearance.font = font.key)}
            ><b style:font-family={font.display}>Aa</b><span>{font.label}</span></button
          >
        {/each}
      </div>
    </div>
  </div>

  <div class="tsf-row">
    <div class="tsf-field">
      <span class="tsf-label" id="tsf-corners-label">Corners</span>
      <div class="tsf-seg" role="group" aria-labelledby="tsf-corners-label">
        {#each CORNERS as corner (corner.key)}
          <button
            type="button"
            class:on={value.appearance.corners === corner.key}
            on:click={() => (value.appearance.corners = corner.key)}>{corner.label}</button
          >
        {/each}
      </div>
    </div>
  </div>

  <div class="tsf-row">
    <div class="tsf-field">
      <span class="tsf-label" id="tsf-mark-shape">Badge shape</span>
      <div class="tsf-seg" role="group" aria-labelledby="tsf-mark-shape">
        {#each MARK_SHAPES as shape (shape.key)}
          <button
            type="button"
            class:on={value.appearance.markShape === shape.key}
            on:click={() => (value.appearance.markShape = shape.key)}>{shape.label}</button
          >
        {/each}
      </div>
    </div>
    <div class="tsf-field">
      <span class="tsf-label" id="tsf-mark-style">Badge style</span>
      <div class="tsf-seg" role="group" aria-labelledby="tsf-mark-style">
        {#each MARK_STYLES as style (style.key)}
          <button
            type="button"
            class:on={value.appearance.markStyle === style.key}
            on:click={() => (value.appearance.markStyle = style.key)}>{style.label}</button
          >
        {/each}
      </div>
    </div>
    <div class="tsf-field">
      <label for="tsf-mark-text">Badge text</label>
      <input
        id="tsf-mark-text"
        class="form-input"
        maxlength="4"
        placeholder={value.teamNumber || 'Team number'}
        bind:value={value.appearance.markText}
      />
    </div>
  </div>
  <small>The badge shows in the menu when there is no logo.</small>

  <div class="tsf-field">
    <label for="tsf-tagline">Tagline <span class="opt">(optional)</span></label>
    <input
      id="tsf-tagline"
      class="form-input"
      maxlength="80"
      placeholder="Scouting for the Robo Raptors"
      bind:value={value.appearance.tagline}
    />
    <small>Shown under the app name on the sign-in page.</small>
  </div>

  <label class="tsf-check">
    <input type="checkbox" bind:checked={value.appearance.serifAccent} />
    <span><b>Serif accent in the app name</b><small>Sets the last word of the app name in italic serif.</small></span>
  </label>
  <label class="tsf-check">
    <input type="checkbox" bind:checked={value.appearance.glow} />
    <span><b>Background glow</b><small>A soft glow of the second color in the top corner of every page.</small></span>
  </label>
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
  .tsf-preview {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--background);
    background-image: var(--app-glow, none);
  }
  .pv-brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .pv-brand > div {
    display: grid;
    gap: 2px;
  }
  .pv-name {
    font-family: var(--font-body, var(--font-display));
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }
  .pv-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .pv-row .btn {
    pointer-events: none;
  }
  .pv-chip {
    padding: 0.2rem 0.7rem;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--accent-strong);
    font-size: 0.8rem;
  }
  .pv-card {
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    font-size: 0.85rem;
  }
  .tsf-palettes,
  .tsf-fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: var(--space-2);
  }
  .palette,
  .font {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.86rem;
    text-align: left;
    cursor: pointer;
  }
  .palette.on,
  .font.on {
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-1));
  }
  .palette-swatches {
    display: flex;
    gap: 3px;
  }
  .palette-swatches i {
    flex: 1;
    height: 1.4rem;
    border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 25%, transparent);
  }
  .font b {
    font-size: 1.5rem;
    font-weight: 500;
    line-height: 1;
  }
  .tsf-same {
    min-height: 2rem;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .tsf-same.on {
    border-color: var(--accent);
    color: var(--text);
  }
  /* Each group is a card, and everything inside runs top to bottom in one column. */
  .tsf {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    margin: 0;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .tsf-legend {
    float: left;
    width: 100%;
    padding: 0;
    margin: 0 0 var(--space-1);
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text-strong, var(--text));
  }
  .tsf-legend + * {
    clear: both;
  }
  .tsf-row {
    display: grid;
    gap: var(--space-4);
  }
  .tsf-field {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .tsf-field.grow {
    min-width: 0;
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
    box-shadow:
      0 0 0 2px var(--surface-1),
      0 0 0 4px var(--text-secondary);
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
    border-radius: var(--radius-full);
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
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-1));
    color: var(--text-strong, var(--text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
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
