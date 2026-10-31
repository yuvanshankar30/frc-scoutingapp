<script>
  // Two box plots on one scale: this team's per-match spread against every team's average at the
  // event. Shows consistency (a narrow box) versus one big match (a long whisker).
  /** boxStats() of the team's per-match values. */
  export let team = null;
  /** boxStats() of each team's event average. */
  export let event = null;
  export let teamLabel = 'This team';
  export let eventLabel = 'Event teams';
  export let unit = '';

  let width = 320;
  const ROW = 30;
  $: W = Math.max(200, Math.round(width || 320));
  const PAD = { left: 8, right: 8 };
  $: hi = Math.max(1, team?.max ?? 0, event?.max ?? 0);
  $: sx = (value) => PAD.left + (value / hi) * (W - PAD.left - PAD.right);
  $: rows = [
    { key: 'team', label: teamLabel, stats: team, color: 'var(--chart-blue, var(--accent))' },
    { key: 'event', label: eventLabel, stats: event, color: 'var(--chart-secondary, var(--text-muted))' }
  ].filter((row) => row.stats);
  const fmt = (value) => (Number.isFinite(value) ? Number(value).toFixed(1).replace(/\.0$/, '') : '—');
</script>

{#if !team}
  <p class="chart-empty">No scouted matches yet.</p>
{:else}
  <div class="box-compare" bind:clientWidth={width}>
    {#each rows as row (row.key)}
      <div class="row">
        <span class="label">{row.label}</span>
        <svg
          viewBox={`0 0 ${W} ${ROW}`}
          role="img"
          aria-label={`${row.label}: median ${fmt(row.stats.median)}${unit}, middle half ${fmt(row.stats.q1)} to ${fmt(row.stats.q3)}`}
        >
          <line class="whisker" x1={sx(row.stats.min)} x2={sx(row.stats.max)} y1={ROW / 2} y2={ROW / 2} />
          <line class="whisker" x1={sx(row.stats.min)} x2={sx(row.stats.min)} y1={ROW / 2 - 6} y2={ROW / 2 + 6} />
          <line class="whisker" x1={sx(row.stats.max)} x2={sx(row.stats.max)} y1={ROW / 2 - 6} y2={ROW / 2 + 6} />
          <rect
            x={sx(row.stats.q1)}
            y="6"
            width={Math.max(2, sx(row.stats.q3) - sx(row.stats.q1))}
            height={ROW - 12}
            rx="3"
            fill={row.color}
            fill-opacity=".25"
            stroke={row.color}
          />
          <line
            x1={sx(row.stats.median)}
            x2={sx(row.stats.median)}
            y1="4"
            y2={ROW - 4}
            stroke={row.color}
            stroke-width="3"
          />
        </svg>
        <span class="nums"
          >median <b>{fmt(row.stats.median)}{unit}</b> · {fmt(row.stats.min)}–{fmt(row.stats.max)} · {row.stats.count}
          {row.key === 'team' ? 'matches' : 'teams'}</span
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .box-compare {
    display: grid;
    gap: var(--space-3);
  }
  .row {
    display: grid;
    gap: 4px;
  }
  .label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  svg {
    width: 100%;
    height: 30px;
    display: block;
  }
  .whisker {
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
  .nums {
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .nums b {
    color: var(--text);
    font-family: var(--font-mono);
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
</style>
