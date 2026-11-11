<script>
  // The team's mark: the logo from Team settings, or a badge with the team number (or the text chosen in Team
  // settings) in the shape and style chosen there. `preview` lets Team settings show unsaved choices.
  import { team } from '$lib/stores/team.js';
  import { markLabel, normalizeAppearance } from '$lib/app/appearance.js';

  export let size = 34;
  /** Unsaved appearance to show instead of the saved one (Team settings). */
  export let preview = null;
  /** Show the badge even when there is a logo (Team settings' badge preview). */
  export let badgeOnly = false;

  $: look = normalizeAppearance(preview || $team?.appearance);
  $: label = markLabel(look, $team);
  // Long labels shrink so four or five digits still fit inside the badge.
  $: scale = label.length <= 2 ? 0.46 : label.length === 3 ? 0.36 : label.length === 4 ? 0.29 : 0.24;
</script>

{#if $team?.logoUrl && !badgeOnly}
  <img
    class="team-mark"
    class:circle={look.markShape === 'circle'}
    src={$team.logoUrl}
    alt=""
    width={size}
    height={size}
  />
{:else}
  <span
    class="team-mark mark-badge {look.markShape} {look.markStyle}"
    style:--mark-size={`${size}px`}
    style:--mark-scale={scale}
    aria-hidden="true"><span>{label}</span></span
  >
{/if}

<style>
  .team-mark {
    flex-shrink: 0;
    object-fit: contain;
  }
  img.circle {
    border-radius: 50%;
  }
  .mark-badge {
    display: inline-grid;
    place-items: center;
    width: var(--mark-size);
    height: var(--mark-size);
    border-radius: 26%;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: calc(var(--mark-size) * var(--mark-scale));
    font-variant-numeric: tabular-nums;
    line-height: 1;
    user-select: none;
  }
  /* Centre the digits optically: trim the line box to the cap height and the baseline, so the font's extra space
     above and below doesn't push them off centre. Browsers without text-box get a small nudge instead. */
  .mark-badge > span {
    display: block;
    text-box: trim-both cap alphabetic;
  }
  @supports not (text-box: trim-both cap alphabetic) {
    .mark-badge > span {
      transform: translateY(0.06em);
    }
  }
  .mark-badge.circle {
    border-radius: 50%;
  }
  .mark-badge.square {
    border-radius: var(--radius-xs, 2px);
  }
  /* Ink: a dark tile with the number in the brand color, the same in light and dark themes. */
  .mark-badge.ink {
    background: linear-gradient(160deg, var(--ink-3), var(--ink));
    color: var(--accent);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent),
      0 1px 2px color-mix(in srgb, var(--ink) 35%, transparent);
  }
  .mark-badge.outline {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent-strong);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .mark-badge.filled {
    background: var(--accent);
    color: var(--accent-contrast);
  }
</style>
