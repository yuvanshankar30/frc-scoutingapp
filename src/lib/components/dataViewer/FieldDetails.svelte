<script>
  // A field's full text view: every answer's distribution, a per-team summary and every report that answered it.
  // Desktop shows tables; phones get lists of cards (they open this inside a BottomSheet).
  import { slide } from 'svelte/transition';
  import CountBars from '$lib/components/charts/CountBars.svelte';
  import TeamBars from '$lib/components/charts/TeamBars.svelte';
  import {
    KIND_LABELS,
    barScale,
    chartKind,
    formatNumber,
    formatShare,
    teamBarRows
  } from '$lib/scouting/dataViewer.js';

  /** summarizeField() of one field. */
  export let summary;
  export let phone = false;
  /** Taller tables, for a page of its own rather than a card. */
  export let tall = false;
  /** answer -> the scout entry's page, or null when reports have none (pit scouting). */
  export let entryHref = null;

  const PAGE = 40;
  let view = 'teams'; // 'teams' | 'reports'
  let shownReports = PAGE;

  $: field = summary.field;
  $: numeric = field.type === 'number' || field.type === 'rating';
  $: listed = field.type === 'choice' || field.type === 'multi';
  // Newest first, so the latest matches are on top.
  $: reports = [...summary.answers].reverse();
  $: if (summary) shownReports = PAGE;

  const topAnswers = (row) => row.top.map((entry) => `${entry.label} (${entry.count})`).join(', ');
</script>

<div class="details" class:phone class:tall>
  {#if summary.count && chartKind(field) !== 'text'}
    <section class="block" aria-label="Distribution">
      <h4>{field.type === 'number' ? 'By team' : 'All answers'}</h4>
      {#if field.type === 'number'}
        <TeamBars rows={teamBarRows(summary)} />
      {:else}
        <CountBars rows={summary.distribution} />
      {/if}
      {#if field.type === 'rating' || field.type === 'yesno'}
        <h4 class="spaced">By team</h4>
        <TeamBars rows={teamBarRows(summary)} scaleMax={barScale(field)} />
      {/if}
    </section>
  {/if}

  <div class="switch" role="tablist" aria-label="Text view">
    <button role="tab" aria-selected={view === 'teams'} class:on={view === 'teams'} on:click={() => (view = 'teams')}
      >Teams <span>{summary.teamCount}</span></button
    >
    <button
      role="tab"
      aria-selected={view === 'reports'}
      class:on={view === 'reports'}
      on:click={() => (view = 'reports')}>Reports <span>{summary.count}</span></button
    >
  </div>

  {#if !summary.count}
    <p class="empty">No report has answered this yet.</p>
  {:else if view === 'teams'}
    {#if phone}
      <ul class="cards">
        {#each summary.teams as row (row.teamKey)}
          <li>
            <b class="team">{row.team}</b>
            <span class="facts">
              {#if numeric}avg <b>{formatNumber(row.average)}</b> · {formatNumber(row.min)}–{formatNumber(row.max)}
              {:else if field.type === 'yesno'}<b>{formatShare(row.share)}</b> yes · {row.yes} of {row.count}
              {:else if listed}{topAnswers(row)}
              {:else}{row.count} {row.count === 1 ? 'answer' : 'answers'}{/if}
            </span>
            {#if numeric || field.type === 'yesno'}<span class="count">{row.count} reports</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="table-wrap">
        <table class="table" data-keep-table>
          <thead>
            <tr>
              <th>Team</th>
              <th class="n">Reports</th>
              {#if numeric}
                <th class="n">Average</th>
                <th class="n">Min</th>
                <th class="n">Max</th>
              {:else if field.type === 'yesno'}
                <th class="n">Yes</th>
                <th class="n">Share</th>
              {:else if listed}
                <th>Most common</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each summary.teams as row (row.teamKey)}
              <tr>
                <td class="team">{row.team}</td>
                <td class="n">{row.count}</td>
                {#if numeric}
                  <td class="n strong">{formatNumber(row.average)}</td>
                  <td class="n">{formatNumber(row.min)}</td>
                  <td class="n">{formatNumber(row.max)}</td>
                {:else if field.type === 'yesno'}
                  <td class="n">{row.yes}</td>
                  <td class="n strong">{formatShare(row.share)}</td>
                {:else if listed}
                  <td>{topAnswers(row)}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    {#if phone}
      <ul class="cards">
        {#each reports.slice(0, shownReports) as answer (answer.id)}
          <li class="report">
            <svelte:element this={entryHref ? 'a' : 'div'} class="report-body" href={entryHref?.(answer)}>
              <span class="meta">
                <b class="team">{answer.team}</b>
                {#if answer.match}<span>{answer.match}</span>{/if}
                {#if answer.kind}<span class="kind">{KIND_LABELS[answer.kind]}</span>{/if}
              </span>
              <span class="answer">{answer.text}</span>
              {#if answer.scout}<span class="scout">{answer.scout}</span>{/if}
            </svelte:element>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="table-wrap">
        <table class="table" data-keep-table>
          <thead>
            <tr>
              {#if field.form === 'match'}<th>Match</th>{/if}
              <th>Team</th>
              {#if field.form === 'match'}<th>Report</th>{/if}
              <th>Scout</th>
              <th>Answer</th>
            </tr>
          </thead>
          <tbody>
            {#each reports.slice(0, shownReports) as answer (answer.id)}
              <tr>
                {#if field.form === 'match'}<td class="nowrap"
                    >{#if entryHref && answer.match}<a href={entryHref(answer)}>{answer.match}</a
                      >{:else}{answer.match ?? '—'}{/if}</td
                  >{/if}
                <td class="team">{answer.team}</td>
                {#if field.form === 'match'}<td>{KIND_LABELS[answer.kind]}</td>{/if}
                <td>{answer.scout ?? '—'}</td>
                <td class="answer"><span>{answer.text}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if reports.length > shownReports}
      <button class="btn btn-outline more" transition:slide={{ duration: 150 }} on:click={() => (shownReports += PAGE)}
        >Show {Math.min(PAGE, reports.length - shownReports)} more of {reports.length - shownReports}</button
      >
    {/if}
  {/if}
</div>

<style>
  .details {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .block {
    display: grid;
    gap: var(--space-2);
  }
  h4 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  h4.spaced {
    margin-top: var(--space-2);
  }
  .switch {
    display: inline-flex;
    justify-self: start;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
  }
  .switch button {
    min-height: 2rem;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .switch button span {
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .switch button.on {
    background: var(--surface-1);
    color: var(--text-strong, var(--text));
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 12%, transparent);
  }
  .table-wrap {
    max-height: 22rem;
  }
  .tall .table-wrap {
    max-height: 36rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .table {
    margin: 0;
    width: 100%;
    font-size: 0.88rem;
  }
  .table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-2);
  }
  .n {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .strong {
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }
  .team {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .nowrap {
    white-space: nowrap;
  }
  .nowrap a {
    color: var(--accent-text, var(--accent));
    font-weight: 500;
    text-decoration: none;
  }
  .nowrap a:hover {
    text-decoration: underline;
  }
  .answer span {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .more {
    justify-self: start;
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  /* Phones: lists of cards, never a table wider than the sheet. */
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .cards li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px var(--space-3);
    align-items: baseline;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    font-size: max(var(--text-min), 0.9rem);
  }
  .cards .facts {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text-secondary);
  }
  .cards .count {
    grid-column: 2;
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.8rem);
  }
  .cards .report {
    display: block;
    padding: 0;
  }
  .report-body {
    display: grid;
    gap: 2px;
    padding: var(--space-3);
    min-height: var(--tap-min);
    color: inherit;
    text-decoration: none;
  }
  a.report-body:active {
    background: var(--surface-2);
  }
  .cards .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    color: var(--text-secondary);
  }
  .cards .kind {
    color: var(--text-muted);
  }
  .cards .answer {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-strong, var(--text));
  }
  .cards .scout {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.8rem);
  }
  .phone .switch {
    justify-self: stretch;
  }
  .phone .switch button {
    flex: 1;
    min-height: var(--tap-min);
  }
  .phone .more {
    justify-self: stretch;
    min-height: var(--tap-min);
  }
</style>
