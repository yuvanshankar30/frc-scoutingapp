<script>
  // One field's page: its numbers across the event, every team's bar, the answers' distribution, the per-team table
  // and every report that answered it. With one to five teams picked, numbers also get a match-by-match line. Previous
  // and next step through the form's fields in order.
  import { page } from '$app/stores';
  import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import LineChart from '$lib/components/charts/LineChart.svelte';
  import RankedBars from '$lib/components/charts/RankedBars.svelte';
  import { teamHref } from '$lib/scouting/dataPage.js';
  import FieldDetails from '$lib/components/dataViewer/FieldDetails.svelte';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import {
    KIND_LABELS,
    TREND_MATCHES,
    fieldTrend,
    filterFields,
    filterRecords,
    formatNumber,
    formatShare,
    neighbors,
    summarizeField
  } from '$lib/scouting/dataViewer.js';
  import { shortMatchLabel } from '$lib/matches/matchKeys.js';

  const { form, sections, filters, records, fields, eventKey } = useDataViewer();
  const FORM_LABELS = { match: 'Match scouting', pit: 'Pit scouting' };
  const LINE_COLORS = [
    'var(--chart-blue)',
    'var(--chart-orange)',
    'var(--chart-teal)',
    'var(--chart-pink)',
    'var(--chart-purple)'
  ];

  $: formKey = $page.params.form === 'pit' ? 'pit' : 'match';
  $: fieldId = decodeURIComponent($page.params.id || '');
  // Opening a pit field makes Pit the current tab, so Back returns to it.
  $: if ($form !== formKey) form.set(formKey);
  $: formFields = filterFields($fields[formKey], { ...$filters, section: '' });
  $: field = $fields[formKey].find((entry) => entry.id === fieldId) || null;
  $: summary = field ? summarizeField(field, filterRecords($records[formKey], formKey, $filters)) : null;
  $: around = neighbors(formFields, fieldId);
  // Who is improving on this field: match scouting numbers and ratings only (pit scouting has one report per team).
  $: improving =
    summary && formKey === 'match'
      ? (() => {
          const result = fieldTrend(summary);
          const from = `/dataviewer/field/${formKey}/${encodeURIComponent(fieldId)}`;
          return {
            ...result,
            rows: result.rows.map((row) => ({ ...row, href: teamHref(row.teamKey, $eventKey, from) }))
          };
        })()
      : null;
  $: kindLabel = field?.kinds ? field.kinds.map((key) => KIND_LABELS[key]).join(', ') : KIND_LABELS[field?.kind];
  $: numeric = field && (field.type === 'number' || field.type === 'rating');
  $: href = (entry) => `/dataviewer/field/${formKey}/${encodeURIComponent(entry.id)}`;

  // A line per picked team, one point per match it was scouted in (averaged when several scouts answered).
  $: trend =
    numeric && formKey === 'match' && $filters.teams.length >= 1 && $filters.teams.length <= 5
      ? $filters.teams.map((teamKey, index) => {
          const byMatch = new Map();
          for (const answer of summary.answers.filter((entry) => entry.teamKey === teamKey)) {
            if (!byMatch.has(answer.matchKey)) byMatch.set(answer.matchKey, []);
            byMatch.get(answer.matchKey).push(Number(answer.value));
          }
          return {
            name: teamKey.replace(/^frc/, ''),
            color: LINE_COLORS[index],
            points: [...byMatch].map(([matchKey, values]) => ({
              matchKey,
              label: shortMatchLabel(matchKey),
              value: values.reduce((sum, value) => sum + value, 0) / values.length
            }))
          };
        })
      : [];

  const backToSection = () => sections.update((value) => ({ ...value, [formKey]: field?.section || value[formKey] }));
</script>

<svelte:head><title>{field ? `${field.label} · Data Viewer` : 'Data Viewer'}</title></svelte:head>

<div class="field-page" class:phone={$isPhone}>
  <nav class="crumbs" aria-label="Back">
    <a href="/dataviewer" class="back" on:click={backToSection}
      ><ArrowLeft size={16} />{FORM_LABELS[formKey]}{field ? ` · ${field.sectionLabel}` : ''}</a
    >
    {#if field && !$isPhone && around.total > 1}
      <span class="position">{around.index + 1} of {around.total}</span>
    {/if}
  </nav>

  {#if !field}
    <div class="empty-state">This field isn't on the {FORM_LABELS[formKey].toLowerCase()} form.</div>
  {:else}
    <header class="field-head">
      <h2>{field.label}</h2>
      <div class="tags">
        <span class="tag">{field.sectionLabel}</span>
        {#if kindLabel}<span class="tag">{kindLabel} report</span>{/if}
        {#if field.custom}<span class="tag added">Added question</span>{/if}
      </div>
    </header>

    <div class="stat-strip">
      <span><b>{summary.count}</b>{summary.count === 1 ? 'report' : 'reports'}</span>
      <span><b>{summary.teamCount}</b>{summary.teamCount === 1 ? 'team' : 'teams'}</span>
      {#if numeric}
        <span><b>{formatNumber(summary.average)}</b>average{field.type === 'rating' ? ` of ${field.max}` : ''}</span>
        <span><b>{formatNumber(summary.min)}–{formatNumber(summary.max)}</b>range</span>
      {:else if field.type === 'yesno'}
        <span><b>{formatShare(summary.share)}</b>yes</span>
      {:else if summary.distribution?.length}
        <span class="wide"><b>{summary.distribution[0].label}</b>most common</span>
      {/if}
    </div>

    {#if trend.length}
      <section class="panel-box" aria-label="Match by match">
        <h3>Match by match</h3>
        <LineChart
          series={trend}
          max={field.type === 'rating' ? field.max : null}
          ariaLabel={`${field.label} by match`}
        />
      </section>
    {/if}

    <section class="panel-box">
      <FieldDetails
        {summary}
        phone={$isPhone}
        tall
        entryHref={formKey === 'match' ? (answer) => `/dataviewer/entries/${encodeURIComponent(answer.id)}` : null}
      />
    </section>

    {#if improving && (improving.rows.length || improving.notEnough.length)}
      <section class="panel-box" aria-label="Who is improving">
        <h3>Who is improving</h3>
        <p class="hint">Mean of each team's last {TREND_MATCHES} scouted matches minus its first {TREND_MATCHES}.</p>
        <RankedBars
          rows={improving.rows}
          signed
          ariaLabel={`Change in ${field.label} over the event`}
          emptyText={`No team has ${TREND_MATCHES * 2} scouted matches yet.`}
        />
        {#if improving.notEnough.length}
          <p class="hint">Not enough matches yet: {improving.notEnough.join(', ')}</p>
        {/if}
      </section>
    {/if}

    {#if around.previous || around.next}
      <nav class="pager" aria-label="Other fields">
        {#if around.previous}
          <a class="btn btn-outline" href={href(around.previous)}
            ><ChevronLeft size={16} /><span>{around.previous.label}</span></a
          >
        {:else}<span></span>{/if}
        {#if around.next}
          <a class="btn btn-outline next" href={href(around.next)}
            ><span>{around.next.label}</span><ChevronRight size={16} /></a
          >
        {/if}
      </nav>
    {/if}
  {/if}
</div>

<style>
  .field-page {
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
  .position {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .field-head {
    display: grid;
    gap: var(--space-2);
  }
  .field-head h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-strong, var(--text));
    overflow-wrap: anywhere;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .tag {
    padding: 2px 10px;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.78rem);
    font-weight: 500;
  }
  .tag.added {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  .stat-strip {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .stat-strip span {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stat-strip span:first-child {
    border-left: 0;
  }
  .stat-strip b {
    order: -1;
    color: var(--text-strong, var(--text));
    font-size: 1.4rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    text-transform: none;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .panel-box {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .panel-box h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .pager {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .pager .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-self: start;
    max-width: 100%;
    min-height: 2.5rem;
  }
  .pager .next {
    justify-self: end;
    text-align: right;
  }
  .pager .btn span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Phones: stats two to a row, bigger tap targets, labels wrap. */
  .phone .stat-strip {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .phone .stat-strip span {
    padding: var(--space-2) var(--space-3);
    letter-spacing: 0.04em;
  }
  .phone .stat-strip span:nth-child(odd) {
    border-left: 0;
  }
  .phone .stat-strip span:nth-child(n + 3) {
    border-top: 1px solid var(--border);
  }
  .phone .stat-strip .wide {
    grid-column: 1 / -1;
  }
  .phone .back,
  .phone .pager .btn {
    min-height: var(--tap-min);
  }
  .phone .panel-box {
    padding: var(--space-3);
  }
  /* Phone: wrap, never cut text. */
  @media (max-width: 900px) {
    .pager .btn span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
    }
  }
</style>
