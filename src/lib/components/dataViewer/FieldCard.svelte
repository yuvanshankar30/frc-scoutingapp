<script>
  // One field of a scouting form as a card that links to the field's own page: its name, the kind of report that
  // asks it, a one-line headline and a small chart of its top three answers. Every card in a section is the same size.
  import { ChevronRight } from 'lucide-svelte';
  import CountBars from '$lib/components/charts/CountBars.svelte';
  import TeamBars from '$lib/components/charts/TeamBars.svelte';
  import { KIND_LABELS, barScale, chartKind, headline, teamBarRows } from '$lib/scouting/dataViewer.js';

  export let summary;
  export let href;

  const LIMIT = 3;
  $: field = summary.field;
  $: kind = chartKind(field);
  $: latest = kind === 'text' ? summary.answers[summary.answers.length - 1] : null;
  $: kindLabel = field.kinds ? field.kinds.map((key) => KIND_LABELS[key]).join(', ') : KIND_LABELS[field.kind];
</script>

<a class="field-card" class:empty={!summary.count} {href}>
  <span class="head">
    <span class="title">{field.label}</span>
    <ChevronRight size={18} class="go" aria-hidden="true" />
  </span>
  {#if kindLabel || field.custom}
    <span class="tags">
      {#if kindLabel}<span class="tag">{kindLabel}</span>{/if}
      {#if field.custom}<span class="tag added">Added question</span>{/if}
    </span>
  {/if}
  <span class="headline">{headline(summary)}</span>

  <span class="chart">
    {#if !summary.count}
      <span class="none">No answers with these filters.</span>
    {:else if kind === 'teams'}
      <TeamBars rows={teamBarRows(summary)} scaleMax={barScale(field)} limit={LIMIT} />
    {:else if kind === 'counts'}
      <CountBars rows={summary.distribution.slice(0, LIMIT)} />
    {:else if latest}
      <span class="quote">“{latest.text}”</span>
      <span class="who">{latest.team}{latest.match ? ` · ${latest.match}` : ''}</span>
    {/if}
  </span>

  <span class="foot"
    >{summary.count}
    {summary.count === 1 ? 'report' : 'reports'} · {summary.teamCount}
    {summary.teamCount === 1 ? 'team' : 'teams'}</span
  >
</a>

<style>
  .field-card {
    /* A column: the chart takes the spare height, so every card's footer lines up along the row. */
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    color: inherit;
    text-decoration: none;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      transform 0.15s ease;
  }
  .field-card:hover,
  .field-card:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 4%, var(--surface-1));
  }
  .field-card:active {
    transform: scale(0.99);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .title {
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-strong, var(--text));
    overflow-wrap: anywhere;
  }
  .head :global(.go) {
    flex: none;
    color: var(--text-muted);
    transition: transform 0.15s ease;
  }
  .field-card:hover .head :global(.go) {
    transform: translateX(2px);
    color: var(--text-strong, var(--text));
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .tag {
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.72rem);
    font-weight: 500;
  }
  .tag.added {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  .headline {
    color: var(--text-secondary);
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
  }
  .empty .headline,
  .none {
    color: var(--text-muted);
  }
  .chart {
    flex: 1;
    display: grid;
    align-content: start;
    gap: var(--space-1);
    min-width: 0;
    padding-top: var(--space-1);
  }
  .none {
    font-size: 0.85rem;
  }
  .quote {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .who {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.78rem);
  }
  .foot {
    padding-top: var(--space-2);
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.8rem);
  }
  /* Phone: wrap, never cut text. */
  @media (max-width: 900px) {
    .field-card {
      min-height: var(--tap-min);
    }
    .quote {
      display: block;
      -webkit-line-clamp: unset;
      line-clamp: unset;
      overflow: visible;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .field-card,
    .head :global(.go) {
      transition: none;
    }
  }
</style>
