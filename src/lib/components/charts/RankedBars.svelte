<script context="module">
  /** A row's each-block key: its own key, else position + label, so repeated labels never collide. */
  export function rowKey(row, i) {
    return row?.key ?? `${i}:${row?.label}`;
  }
</script>

<script>
  // Teams ranked on one number, highest first (the Data page's top scorers and trend). Each row writes out its value
  // and n, the matches behind it, so a team with two scouted matches can't pass for a sure thing. Rows with too few
  // matches come in `faded`. `signed` grows bars both ways from a centre line, for a change that can be negative.
  /** [{ label, key?, href?, value, n, faded? }]; key defaults to position + label, so repeated labels are safe. */
  export let rows = [];
  export let unit = '';
  export let digits = 1;
  export let signed = false;
  /** Fewer is better (fouls): rank lowest first, and a fall is drawn in the good colour. */
  export let lowerIsBetter = false;
  export let color = 'var(--chart-blue, var(--accent))';
  export let negativeColor = 'var(--chart-danger, var(--danger))';
  export let emptyText = 'No scouting data for this yet.';
  export let ariaLabel = 'Ranked chart';

  $: ranked = [...rows]
    .filter((row) => Number.isFinite(row?.value))
    .sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  $: isBad = (value) => (lowerIsBetter ? value > 0 && signed : value < 0);
  $: top = Math.max(1e-9, ...ranked.map((row) => Math.abs(row.value)));

  function format(value) {
    const text = Math.abs(value).toFixed(digits);
    // A value that rounds to zero at this precision is written without a sign ("0.0", not "+0.0" or "−0.0").
    const zero = Number(text) === 0;
    const sign = zero ? '' : value < 0 ? '−' : signed && value > 0 ? '+' : '';
    // "3.5/5" but "12.5 balls", the same as PercentileBars and the LineChart readout.
    const suffix = unit && !unit.startsWith('/') ? ` ${unit}` : unit || '';
    return `${sign}${text}${suffix}`;
  }
  function width(value) {
    return `${(Math.abs(value) / top) * (signed ? 50 : 100)}%`;
  }
</script>

{#if !ranked.length}
  <p class="chart-empty">{emptyText}</p>
{:else}
  <ol class="ranked" aria-label={ariaLabel}>
    {#each ranked as row, i (rowKey(row, i))}
      <li class:faded={row.faded}>
        <span class="rank">{i + 1}</span>
        <span class="label">
          {#if row.href}<a href={row.href}>{row.label}</a>{:else}{row.label}{/if}
        </span>
        <span class="track" class:signed>
          {#if signed}<span class="axis"></span>{/if}
          <span
            class="fill"
            class:negative={isBad(row.value)}
            style={`width:${width(row.value)};background:${isBad(row.value) ? negativeColor : color};${
              signed ? (row.value < 0 ? 'right:50%;' : 'left:50%;') : 'left:0;'
            }`}
          ></span>
        </span>
        <span class="value">{format(row.value)}<small> · n = {row.n}</small></span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .ranked {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
    grid-template-columns: 1.75rem minmax(4rem, 8rem) minmax(0, 1fr) 7rem;
    align-items: center;
    gap: var(--space-3);
  }
  li.faded {
    opacity: 0.5;
  }
  .rank {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    text-align: right;
  }
  .label {
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 0.65rem;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .axis {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--text-muted);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
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

  /* Phone: wrap, never cut text (#124). */
  @media (max-width: 900px) {
    li {
      grid-template-columns: 1.5rem minmax(3rem, 5rem) minmax(0, 1fr) 6rem;
      gap: var(--space-2);
    }
    .label {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
    /* Tapping a team opens Team View, so the link gets a full tap target. */
    .label a {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap-min);
    }
  }
</style>
