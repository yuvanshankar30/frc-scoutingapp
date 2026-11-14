<script>
  // Data Viewer > Rankings:
  // every scouted team ranked on one metric, and who is improving over the event, with per-match lines for the top
  // improvers and any team added. The event and its scouting come from the Data Viewer layout; the match type and
  // qualification range filters apply here too. Anything about one team links to Team View.
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { X } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import TeamPicker from '$lib/components/common/TeamPicker.svelte';
  import RankedBars from '$lib/components/charts/RankedBars.svelte';
  import LineChart from '$lib/components/charts/LineChart.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { userProfile } from '$lib/stores/auth.js';
  import { canAdministerScouting } from '$lib/app/navigation.js';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import { filterRecords } from '$lib/scouting/dataViewer.js';
  import { MATCH_METRICS, ownMatchSeries, teamKeyOf } from '$lib/scouting/teamCharts.js';
  import {
    DEFAULT_METRIC,
    MIN_MATCHES,
    TREND_MATCHES,
    chartMax,
    isMetric,
    readoutUnit,
    teamRows,
    topScorerRows,
    trendLines,
    trendRows
  } from '$lib/scouting/dataPage.js';

  const { eventKey, records, eventTeams, filters } = useDataViewer();
  const LINE_COLORS = [
    'var(--chart-primary, var(--accent))',
    'var(--chart-orange)',
    'var(--chart-teal)',
    'var(--chart-purple)',
    'var(--chart-pink)'
  ];

  let addTeamKey = '';
  let extraTeams = [];
  let trendHeading;

  $: wanted = $page.url.searchParams.get('metric');
  $: metric = isMetric(wanted) ? wanted : DEFAULT_METRIC;
  $: metricInfo = MATCH_METRICS[metric];
  // Rankings cover every team, so the team filter is left out; the match filters still narrow the matches.
  $: entries = filterRecords($records.match, 'match', { ...$filters, teams: [], kind: '' });
  // Team View's "Back to Rankings" returns to this exact view.
  $: from = `/dataviewer/rankings${$page.url.search}`;
  $: top = topScorerRows({ entries, metric, teams: $eventTeams, eventKey: $eventKey, from });
  $: trend = trendRows({ entries, metric, eventKey: $eventKey, from });
  $: lines = trendLines({
    improvers: trend.improvers,
    picked: extraTeams,
    max: LINE_COLORS.length,
    available: top.rows.map((row) => row.teamKey)
  });
  $: lineSeries = lines.drawn.map((teamKey, i) => ({
    name: teamKey.replace(/^frc/i, ''),
    color: LINE_COLORS[i],
    points: ownMatchSeries(teamRows(entries, teamKey), metric)
  }));
  // Only teams with a value for this metric can be drawn, so only they are offered.
  $: teamOptions = top.rows
    .map((row) => row.teamKey)
    .filter((key) => !lines.drawn.includes(key))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((key) => ({
      value: key,
      number: key.replace(/^frc/i, ''),
      name: $eventTeams.find((entry) => teamKeyOf(entry.key) === key)?.nickname || ''
    }));
  $: canAdmin = canAdministerScouting($userProfile);
  $: if (addTeamKey) addLine(addTeamKey);

  function setMetric(next) {
    const url = new URL($page.url);
    if (!isMetric(next) || next === DEFAULT_METRIC) url.searchParams.delete('metric');
    else url.searchParams.set('metric', next);
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Adding the last allowed line hides the picker, and removing a chip removes the focused button, so focus moves to
  // the trend heading instead of falling back to the page.
  async function addLine(key) {
    addTeamKey = '';
    const picked = teamKeyOf(key);
    if (!picked || extraTeams.includes(picked)) return;
    extraTeams = [...extraTeams, picked];
    await tick();
    if (!(teamOptions.length && lines.canAdd)) trendHeading?.focus();
  }

  async function removeLine(key) {
    extraTeams = extraTeams.filter((entry) => entry !== key);
    await tick();
    trendHeading?.focus();
  }
</script>

<svelte:head><title>Rankings · Data Viewer</title></svelte:head>

<div class="rankings" class:phone={$isPhone}>
  <div class="metric-row">
    <label class="metric">
      <span class="cap">Metric</span>
      <Select value={metric} on:change={(event) => setMetric(event.target.value)} id="rankings-metric">
        {#each Object.entries(MATCH_METRICS) as [key, info] (key)}
          <option value={key}>{info.label}</option>
        {/each}
      </Select>
    </label>
    <p class="hint">Every scouted team at the event, ranked. Tap a team to open it in Team View.</p>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Top teams: {metricInfo.label}{metricInfo.unit ? ` (${metricInfo.unit})` : ''}, per match</h2>
      <p class="hint">
        Average across every report{top.lowerIsBetter ? ', fewest first' : ''}. Faded: fewer than {MIN_MATCHES} scouted matches.
      </p>
      <RankedBars
        rows={top.rows}
        lowerIsBetter={top.lowerIsBetter}
        unit={metricInfo.unit}
        ariaLabel={`Teams ranked by ${metricInfo.label}`}
        emptyText="No scouting data for this metric yet."
      />
      {#if top.notScouted.length}
        <p class="hint">Not scouted: {top.notScouted.join(', ')}</p>
      {/if}
      {#if top.noData.length}
        <p class="hint">Scouted, but no {metricInfo.label} answers: {top.noData.join(', ')}</p>
      {/if}
    </section>

    <section class="card">
      <h2 bind:this={trendHeading} tabindex="-1">Who is improving: {metricInfo.label}</h2>
      <p class="hint">Mean of each team's last {TREND_MATCHES} scouted matches minus its first {TREND_MATCHES}.</p>
      <RankedBars
        rows={trend.rows}
        lowerIsBetter={trend.lowerIsBetter}
        unit={metricInfo.unit}
        signed
        ariaLabel={`Change in ${metricInfo.label} over the event`}
        emptyText={`No team has ${TREND_MATCHES * 2} scouted matches yet.`}
      />
      {#if trend.notEnough.length}
        <p class="hint">Not enough matches yet: {trend.notEnough.join(', ')}</p>
      {/if}
    </section>
  </div>

  <section class="card">
    <h2>Per match, by each team's own match number</h2>
    <p class="hint">The top 3 improvers, plus any team you add (up to {LINE_COLORS.length} lines).</p>
    {#if lineSeries.length}
      <LineChart
        series={lineSeries}
        max={chartMax(metric)}
        unit={readoutUnit(metricInfo.unit)}
        ariaLabel={`${metricInfo.label} per match for ${lineSeries.map((line) => line.name).join(', ')}`}
      />
    {:else}
      <p class="hint">
        No improving team yet.{#if teamOptions.length && lines.canAdd}
          Add a team to see its line.{/if}
      </p>
    {/if}
    <div class="lines">
      {#each lines.chips as chip (chip.key)}
        <button
          type="button"
          class="chip"
          class:muted={!chip.drawn}
          on:click={() => removeLine(chip.key)}
          aria-label={`Remove ${chip.key.replace(/^frc/i, '')}${chip.drawn ? '' : ', not drawn'}`}
          >{chip.key.replace(/^frc/i, '')}{#if !chip.drawn}<small>
              (not drawn: no data or {LINE_COLORS.length} lines max)</small
            >{/if}<X size={14} aria-hidden="true" /></button
        >
      {/each}
      {#if teamOptions.length && lines.canAdd}
        <TeamPicker
          options={teamOptions}
          bind:value={addTeamKey}
          ariaLabel="Add a team line"
          placeholder="Add a team"
        />
      {/if}
    </div>
  </section>

  {#if canAdmin}
    <section class="card links">
      <h2>Coverage</h2>
      <p class="hint">
        How much of the event is scouted lives in <a href="/scouting-admin">Scouting Admin › Overview</a>.
      </p>
    </section>
  {/if}
</div>

<style>
  .rankings {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .metric-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .metric {
    display: grid;
    gap: 4px;
    min-width: 14rem;
  }
  .metric :global(.form-group) {
    margin: 0;
  }
  .cap {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .card {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .card h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }
  .card h2:focus {
    outline: none;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .lines {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 2rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.88rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .chip:hover {
    background: var(--surface-3);
  }
  .chip small {
    font-family: var(--font-body, inherit);
    color: var(--text-muted);
  }
  .chip.muted {
    opacity: 0.7;
  }
  .links a {
    color: var(--accent-text, var(--accent));
  }

  /* Phones: one column, the metric picker full width, 44px tap targets. */
  .phone .grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .phone .metric {
    width: 100%;
    min-width: 0;
  }
  .phone .card {
    padding: var(--space-3);
  }
  .phone .chip {
    min-height: var(--tap-min);
  }
  .phone .links a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min);
  }
  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
</style>
