<script>
  // The team's mark: the logo from Team settings, or a badge with the team number in the brand color.
  import { team } from '$lib/stores/team.js';

  export let size = 34;
</script>

{#if $team?.logoUrl}
  <img class="team-mark" src={$team.logoUrl} alt="" width={size} height={size} />
{:else}
  <span class="team-mark badge" style:--mark-size={`${size}px`} aria-hidden="true">
    {$team?.teamNumber || '?'}
  </span>
{/if}

<style>
  .team-mark {
    flex-shrink: 0;
    object-fit: contain;
  }
  .badge {
    display: inline-grid;
    place-items: center;
    width: var(--mark-size);
    height: var(--mark-size);
    border-radius: 22%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: calc(var(--mark-size) * 0.32);
    letter-spacing: 0.02em;
    line-height: 1;
  }
</style>
