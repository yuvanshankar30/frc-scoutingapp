<script>
  // One bar per team on a shared scale: the bar is the team's average (or share), and a thin line behind it spans
  // the team's lowest to highest answer when there is a range. Best team first.
  /** [{ key, label, value, min?, max?, text }] */
  export let rows = [];
  /** The value at the right edge; defaults to the largest value or max shown. */
  export let scaleMax = null;
  /** Show only this many rows (null = all). */
  export let limit = null;
  export let color = 'var(--chart-blue, var(--accent))';
  export let emptyText = 'No answers yet.';

  $: top = Math.max(
    Number.EPSILON,
    scaleMax ?? Math.max(0, ...rows.map((row) => Math.max(row.value ?? 0, row.max ?? 0)))
  );
  $: shown = limit ? rows.slice(0, limit) : rows;
  const pct = (value, max) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
</script>

{#if !rows.length}
  <p class="chart-empty">{emptyText}</p>
{:else}
  <ul class="team-bars">
    {#each shown as row (row.key)}
      <li>
        <span class="label">{row.label}</span>
        <span class="track">
          {#if Number.isFinite(row.min) && Number.isFinite(row.max) && row.max > row.min}
            <span class="range" style={`left:${pct(row.min, top)};right:calc(100% - ${pct(row.max, top)})`}></span>
          {/if}
          <span class="fill" style={`width:${pct(row.value ?? 0, top)};background:${color}`}></span>
        </span>
        <span class="value">{row.text}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .team-bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) minmax(4.5rem, auto);
    align-items: center;
    gap: var(--space-3);
  }
  .label {
    font-family: var(--font-mono);
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }
  .track {
    position: relative;
    height: 0.75rem;
    border-radius: 999px;
    background: var(--surface-3);
  }
  .range {
    position: absolute;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    background: var(--text-muted);
    opacity: 0.55;
  }
  .fill {
    position: relative;
    display: block;
    height: 100%;
    min-width: 2px;
    border-radius: 999px;
    opacity: 0.9;
    transition: width 0.25s ease;
  }
  .value {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
