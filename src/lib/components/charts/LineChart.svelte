<script>
  // A per-match line chart. Each series is [{ matchKey, label, value }]; null values leave a gap
  // instead of dropping to zero. An optional reference line (e.g. the event average) is drawn dashed.
  // Tapping or hovering a match shows every series' value for it, so nothing depends on a tooltip.
  import { compareMatchKeys } from '$lib/matches/matchKeys.js';

  /** [{ name, color, points: [{ matchKey, label, value }] }] */
  export let series = [];
  /** { value, label } drawn as a dashed line, or null. */
  export let reference = null;
  export let unit = '';
  /** Fixed top of the y axis (e.g. 5 for ratings); otherwise the data's max. */
  export let max = null;
  export let digits = 1;
  export let ariaLabel = 'Per-match chart';

  // Drawn at the measured width with a fixed height, so axis text stays the same size in a narrow
  // phone card and a full-width desktop tile.
  let width = 320;
  const H = 190;
  const PAD = { left: 36, right: 12, top: 12, bottom: 24 };
  $: W = Math.max(240, Math.round(width || 320));

  let active = null;

  $: matchKeys = [
    ...new Map(series.flatMap((line) => line.points.map((point) => [point.matchKey, point.label]))).entries()
  ].sort((a, b) => compareMatchKeys(a[0], b[0]));
  $: values = series
    .flatMap((line) => line.points.map((point) => point.value))
    .filter((value) => Number.isFinite(value));
  $: top = max ?? Math.max(1, ...values, reference?.value ?? 0) * 1.1;
  $: x = (index) =>
    matchKeys.length <= 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (index / (matchKeys.length - 1)) * (W - PAD.left - PAD.right);
  $: y = (value) => H - PAD.bottom - (value / top) * (H - PAD.top - PAD.bottom);
  $: indexOf = new Map(matchKeys.map(([key], index) => [key, index]));
  // Consecutive non-null points become one segment, so a missed match is a visible gap.
  $: paths = series.map((line) => {
    const segments = [];
    let current = [];
    const byKey = new Map(line.points.map((point) => [point.matchKey, point.value]));
    for (const [key] of matchKeys) {
      const value = byKey.get(key);
      if (Number.isFinite(value)) current.push(`${x(indexOf.get(key)).toFixed(1)},${y(value).toFixed(1)}`);
      else if (current.length) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length) segments.push(current);
    return { ...line, byKey, segments };
  });
  $: labelEvery = Math.max(1, Math.ceil(matchKeys.length / Math.max(3, Math.floor(W / 56))));
  $: activeIndex = active == null ? null : active;
  const fmt = (value) => (Number.isFinite(value) ? Number(value).toFixed(digits).replace(/\.0+$/, '') : '—');

  function pick(event) {
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = null;
    matchKeys.forEach((_, index) => {
      if (best == null || Math.abs(x(index) - px) < Math.abs(x(best) - px)) best = index;
    });
    active = best;
  }
</script>

{#if !matchKeys.length || !values.length}
  <p class="chart-empty">No scouting data for this yet.</p>
{:else}
  <figure class="chart" bind:clientWidth={width}>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      on:pointermove={pick}
      on:pointerdown={pick}
      on:pointerleave={() => (active = null)}
    >
      {#each [0, 0.5, 1] as fraction}
        <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(top * fraction)} y2={y(top * fraction)} />
        <text class="tick" x={PAD.left - 4} y={y(top * fraction) + 3} text-anchor="end">{fmt(top * fraction)}</text>
      {/each}
      {#each matchKeys as [key, label], index (key)}
        {#if index % labelEvery === 0 || index === matchKeys.length - 1}
          <text class="tick" x={x(index)} y={H - 6} text-anchor="middle">{label}</text>
        {/if}
      {/each}
      {#if reference && Number.isFinite(reference.value)}
        <line class="reference" x1={PAD.left} x2={W - PAD.right} y1={y(reference.value)} y2={y(reference.value)} />
      {/if}
      {#if activeIndex != null}
        <line class="cursor" x1={x(activeIndex)} x2={x(activeIndex)} y1={PAD.top} y2={H - PAD.bottom} />
      {/if}
      {#each paths as line}
        {#each line.segments as segment}
          {#if segment.length > 1}<polyline
              points={segment.join(' ')}
              fill="none"
              stroke={line.color}
              stroke-width="2.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />{/if}
        {/each}
        {#each matchKeys as [key], index (key)}
          {#if Number.isFinite(line.byKey.get(key))}
            <circle cx={x(index)} cy={y(line.byKey.get(key))} r={activeIndex === index ? 5 : 3} fill={line.color} />
          {/if}
        {/each}
      {/each}
    </svg>
    <figcaption class="readout" aria-live="polite">
      {#if activeIndex != null}
        <b>{matchKeys[activeIndex][1]}</b>
        {#each paths as line}<span
            ><i style={`background:${line.color}`}></i>{line.name}: {fmt(
              line.byKey.get(matchKeys[activeIndex][0])
            )}{unit}</span
          >{/each}
      {:else}
        {#each paths as line}<span><i style={`background:${line.color}`}></i>{line.name}</span>{/each}
        {#if reference && Number.isFinite(reference.value)}<span
            ><i class="dash"></i>{reference.label}: {fmt(reference.value)}{unit}</span
          >{/if}
      {/if}
    </figcaption>
  </figure>
{/if}

<style>
  .chart {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  svg {
    width: 100%;
    height: 190px;
    touch-action: pan-y;
    display: block;
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .reference {
    stroke: var(--text-muted);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .cursor {
    stroke: var(--text-muted);
    stroke-width: 1;
    opacity: 0.5;
  }
  .tick {
    fill: var(--text-muted);
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .readout {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.9rem;
    min-height: 1.4rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .readout b {
    color: var(--text);
    font-family: var(--font-mono);
  }
  .readout span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .readout i {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    display: inline-block;
  }
  .readout i.dash {
    height: 0;
    border-top: 2px dashed var(--text-muted);
    border-radius: 0;
  }
  .chart-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
</style>
