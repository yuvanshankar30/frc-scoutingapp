<script>
  // Where a team sits in the event on each metric: a bar to its percentile, with the team's value
  // and the event average written out (not hidden in a tooltip).
  /** [{ metric, label, unit, value, eventMean, percentile, teams }] from percentileProfile(). */
  export let rows = [];
  const fmt = (value) => (Number.isFinite(value) ? Number(value).toFixed(1).replace(/\.0$/, '') : '—');
  const withUnit = (value, unit) => `${fmt(value)}${unit && !unit.startsWith('/') ? ` ${unit}` : unit || ''}`;
  const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const tone = (percentile) => (percentile >= 75 ? 'high' : percentile >= 40 ? 'mid' : 'low');
</script>

{#if !rows.length}
  <p class="chart-empty">Not enough scouting data to compare with the event yet.</p>
{:else}
  <ul class="bars">
    {#each rows as row (row.metric)}
      <li>
        <span class="name">{row.label}</span>
        <span
          class="track"
          role="img"
          aria-label={`${row.label}: better than ${row.percentile}% of ${row.teams} teams`}
        >
          <span class={`fill ${tone(row.percentile)}`} style={`width:${Math.max(2, row.percentile)}%`}></span>
          <span class="mid-mark" aria-hidden="true"></span>
        </span>
        <span class="pct">{row.percentile}<small>{ordinal(row.percentile)}</small></span>
        <span class="detail"
          >{withUnit(row.value, row.unit)} · event avg {withUnit(row.eventMean, row.unit)} · {row.teams} teams</span
        >
      </li>
    {/each}
  </ul>
{/if}

<style>
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  li {
    display: grid;
    grid-template-columns: minmax(7rem, 11rem) minmax(0, 1fr) 3rem;
    grid-template-areas: 'name track pct' '. detail detail';
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 2px;
  }
  .name {
    grid-area: name;
    font-size: 0.9rem;
  }
  .track {
    grid-area: track;
    position: relative;
    height: 0.7rem;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
  }
  .fill.high {
    background: var(--chart-success, var(--success));
  }
  .fill.mid {
    background: var(--chart-blue, var(--accent));
  }
  .fill.low {
    background: var(--chart-orange, var(--warning));
  }
  .mid-mark {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--text-muted);
    opacity: 0.6;
  }
  .pct {
    grid-area: pct;
    text-align: right;
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .pct small {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .detail {
    grid-area: detail;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  @media (max-width: 640px) {
    li {
      grid-template-columns: minmax(0, 1fr) 3rem;
      grid-template-areas: 'name pct' 'track track' 'detail detail';
    }
  }
</style>
