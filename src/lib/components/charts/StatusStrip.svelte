<script>
  // One square per match: robot fine, broke (crash, jam, disabled, died), or not reported.
  /** [{ matchKey, label, status: 'ok' | 'broke' | null, card }] from reliabilityTimeline(). */
  export let rows = [];
  $: broke = rows.filter((row) => row.status === 'broke').length;
  $: known = rows.filter((row) => row.status).length;
</script>

{#if !rows.length}
  <p class="chart-empty">No matches yet.</p>
{:else}
  <ol class="strip" aria-label={`Robot condition by match: broke in ${broke} of ${known} reported matches`}>
    {#each rows as row (row.matchKey)}
      <li class={row.status || 'unknown'}>
        <span class="cell" aria-hidden="true">{row.status === 'broke' ? '!' : row.status === 'ok' ? '' : '?'}</span>
        <small>{row.label}</small>
        {#if row.card}<span class={`card-flag ${row.card}`}>{row.card}</span>{/if}
      </li>
    {/each}
  </ol>
  <p class="summary">
    {known
      ? `Broke in ${broke} of ${known} reported match${known === 1 ? '' : 'es'}.`
      : 'No robot-condition reports yet.'}
    <span class="key"><i class="ok"></i>Fine <i class="broke"></i>Broke <i class="unknown"></i>Not reported</span>
  </p>
{/if}

<style>
  .strip {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  li {
    display: grid;
    justify-items: center;
    gap: 2px;
  }
  .cell {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--radius-sm);
    font-weight: 700;
    color: var(--text-inverse, #fff);
  }
  .ok .cell,
  i.ok {
    background: var(--chart-success, var(--success));
  }
  .broke .cell,
  i.broke {
    background: var(--chart-danger, var(--danger));
  }
  .unknown .cell,
  i.unknown {
    background: var(--surface-3);
    color: var(--text-muted);
  }
  small {
    font-size: 0.72rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .card-flag {
    font-size: 0.7rem;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--warning);
  }
  .card-flag.red {
    color: var(--danger);
  }
  .summary {
    margin: var(--space-2) 0 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
  }
  .key i {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    margin-left: 0.4rem;
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
</style>
