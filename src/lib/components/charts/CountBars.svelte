<script>
  // Horizontal bars for how often each answer was given (roles, starting positions, auto sources).
  /** [{ label, count }] from answerCounts(). */
  export let rows = [];
  export let color = 'var(--chart-blue, var(--accent))';
  export let emptyText = 'No answers yet.';
  $: total = rows.reduce((sum, row) => sum + row.count, 0);
  $: top = Math.max(1, ...rows.map((row) => row.count));
</script>

{#if !rows.length}
  <p class="chart-empty">{emptyText}</p>
{:else}
  <ul class="counts">
    {#each rows as row (row.label)}
      <li>
        <span class="label">{row.label}</span>
        <span class="track"
          ><span class="fill" style={`width:${(row.count / top) * 100}%;background:${color}`}></span></span
        >
        <span class="value">{row.count}<small> · {Math.round((row.count / total) * 100)}%</small></span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .counts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
    grid-template-columns: minmax(5rem, 9rem) minmax(0, 1fr) 4.5rem;
    align-items: center;
    gap: var(--space-3);
  }
  .label {
    font-size: 0.88rem;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    height: 0.65rem;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
  }
  .value {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 0.88rem;
  }
  .value small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .label {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
