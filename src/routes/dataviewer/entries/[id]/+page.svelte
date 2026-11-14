<script>
  // One scout entry: who scouted which robot in which match, and every question that kind of report asked, section by
  // section, with the answer or "—" when it was left blank. Previous and next follow the entries list's order.
  import { page } from '$app/stores';
  import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import { formatPacificDateTimeWithZone } from '$lib/app/timezone.js';
  import { KIND_LABELS, entryList, entrySections, filterRecords, neighbors } from '$lib/scouting/dataViewer.js';

  const { filters, search, records, fields, teamNames } = useDataViewer();

  $: id = decodeURIComponent($page.params.id || '');
  // Previous and next walk the list as filtered; an entry the filters hide can still be opened by its link.
  $: list = entryList(filterRecords($records.match, 'match', $filters), $search);
  $: entry = list.find((item) => item.id === id) || entryList($records.match).find((item) => item.id === id) || null;
  $: around = neighbors(list, id);
  $: sections = entry ? entrySections($fields.match, entry.record) : [];
  $: answered = sections.reduce((total, section) => total + section.answers.filter((a) => a.text !== null).length, 0);
  $: asked = sections.reduce((total, section) => total + section.answers.length, 0);
  const entryHref = (item) => `/dataviewer/entries/${encodeURIComponent(item.id)}`;
  const fieldHref = (field) => `/dataviewer/field/match/${encodeURIComponent(field.id)}`;
</script>

<svelte:head
  ><title>{entry ? `${entry.team} · ${entry.match} · Data Viewer` : 'Scout entry · Data Viewer'}</title></svelte:head
>

<div class="entry-page" class:phone={$isPhone}>
  <nav class="crumbs" aria-label="Back">
    <a href="/dataviewer/entries" class="back"><ArrowLeft size={16} />Scout entries</a>
    {#if entry && around.index !== -1 && !$isPhone}
      <span class="position">{around.index + 1} of {around.total}</span>
    {/if}
  </nav>

  {#if !entry}
    <div class="empty-state">This entry isn't in the event's match scouting.</div>
  {:else}
    <header class="entry-head">
      <h2>
        Team {entry.team}{#if $teamNames.get(entry.record.team_key)}<span class="nick">
            {$teamNames.get(entry.record.team_key)}</span
          >{/if}
      </h2>
      <div class="facts">
        <span>{entry.match}</span>
        <span class={`kind kind-${entry.kind}`}>{KIND_LABELS[entry.kind]} report</span>
        {#if entry.record.alliance}<span class="alliance">{entry.record.alliance} alliance</span>{/if}
        <span>{entry.scout ?? 'Scout not recorded'}</span>
        {#if entry.at}<span class="muted">{formatPacificDateTimeWithZone(entry.at)}</span>{/if}
      </div>
      <p class="muted small">{answered} of {asked} questions answered</p>
    </header>

    <div class="sections">
      {#each sections as section (section.id)}
        <section class="section" aria-label={section.label}>
          <h3>{section.label}</h3>
          <dl>
            {#each section.answers as answer (answer.field.id)}
              <div class="row" class:blank={answer.text === null}>
                <dt><a href={fieldHref(answer.field)}>{answer.field.label}</a></dt>
                <dd>{answer.text ?? '—'}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>

    {#if around.previous || around.next}
      <nav class="pager" aria-label="Other entries">
        {#if around.previous}
          <a class="btn btn-outline" href={entryHref(around.previous)}
            ><ChevronLeft size={16} />{around.previous.team} · {around.previous.match}</a
          >
        {:else}<span></span>{/if}
        {#if around.next}
          <a class="btn btn-outline next" href={entryHref(around.next)}
            >{around.next.team} · {around.next.match}<ChevronRight size={16} /></a
          >
        {/if}
      </nav>
    {/if}
  {/if}
</div>

<style>
  .entry-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .crumbs {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.25rem;
    color: var(--text-secondary);
    font-weight: 500;
    text-decoration: none;
  }
  .back:hover {
    color: var(--text-strong, var(--text));
  }
  .position,
  .muted {
    color: var(--text-muted);
  }
  .position {
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .small {
    margin: 0;
    font-size: 0.85rem;
  }
  .entry-head {
    display: grid;
    gap: var(--space-2);
  }
  .entry-head h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-strong, var(--text));
  }
  .nick {
    margin-left: var(--space-2);
    font-weight: 400;
    color: var(--text-secondary);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    color: var(--text-secondary);
  }
  .alliance {
    text-transform: capitalize;
  }
  .kind {
    padding: 1px 10px;
    border-radius: var(--radius-full);
    font-size: max(var(--text-min), 0.8rem);
    font-weight: 500;
    background: var(--surface-3);
    color: var(--text-strong, var(--text));
  }
  .kind-data {
    background: color-mix(in srgb, var(--chart-orange) 18%, transparent);
  }
  .kind-performance {
    background: color-mix(in srgb, var(--chart-blue) 18%, transparent);
  }
  .kind-robot {
    background: color-mix(in srgb, var(--chart-danger) 18%, transparent);
  }

  /* Desktop: sections side by side in two columns; each is a list of question and answer. */
  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 26rem), 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .section {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .section h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  dl {
    margin: 0;
    display: grid;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .row:first-child {
    border-top: 0;
  }
  dt {
    min-width: 0;
    font-size: 0.88rem;
  }
  dt a {
    color: var(--text-secondary);
    text-decoration: none;
  }
  dt a:hover {
    color: var(--text-strong, var(--text));
    text-decoration: underline;
  }
  dd {
    margin: 0;
    min-width: 0;
    color: var(--text-strong, var(--text));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .blank dd {
    color: var(--text-muted);
  }
  .pager {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .pager .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
  }

  /* Phones: one column, question above its answer, bigger tap targets. */
  .phone .sections {
    grid-template-columns: minmax(0, 1fr);
  }
  .phone .section {
    padding: var(--space-3);
  }
  .phone .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .phone dt a {
    display: inline-block;
    min-height: 1.5rem;
  }
  .phone .back,
  .phone .pager .btn {
    min-height: var(--tap-min);
  }
  .phone .pager .btn {
    flex: 1 1 0;
    justify-content: center;
  }
</style>
