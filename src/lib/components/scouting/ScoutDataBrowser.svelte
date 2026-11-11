<script>
  import Select from '$lib/components/common/Select.svelte';
  import ScoutReportRow from './ScoutReportRow.svelte';
  import {
    aggregateTeams,
    findDisputes,
    groupByMatch,
    matchesQuery,
    reportFlags,
    reportTime,
    scoutStats,
    sortTeams,
    TEAM_SORTS
  } from '$lib/scouting/scoutData.js';

  export let reports = [];
  export let onRemove = null;

  const PAGE = 60;
  const FEW_REPORTS = 3;

  let view = 'teams';
  let query = '';
  let teamFilter = 'all';
  let sortKey = 'number';
  let reverse = false;
  let expandedTeam = '';
  let expandedScout = '';
  let limit = PAGE;

  $: disputes = findDisputes(reports);
  $: searched = reports.filter((report) => matchesQuery(report, query));
  $: teams = aggregateTeams(searched, disputes);
  $: allTeamCount = new Set(reports.map((report) => report.team_key)).size;
  $: scoutCount = new Set(reports.map((report) => report.scout_name || report.created_by)).size;
  $: needsLook = searched
    .filter((report) => reportFlags(report).length || disputes.has(report.id))
    .sort((a, b) => Date.parse(reportTime(b) || 0) - Date.parse(reportTime(a) || 0));
  $: needsLookTotal = reports.filter((report) => reportFlags(report).length || disputes.has(report.id)).length;
  $: maxBalls = Math.max(1, ...reports.map((report) => Number(report.balls_scored_average) || 0));

  $: teamRows = sortTeams(
    teams.filter((team) => {
      if (teamFilter === 'few') return team.count < FEW_REPORTS;
      if (teamFilter === 'incidents') return team.flagged > 0;
      if (teamFilter === 'disputed') return team.disputed > 0;
      return true;
    }),
    sortKey,
    reverse
  );
  $: matchGroups = groupByMatch(searched);
  $: scoutRows = scoutStats(searched, disputes).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const VIEWS = [
    { key: 'teams', label: 'Teams' },
    { key: 'matches', label: 'Matches' },
    { key: 'scouts', label: 'Scouts' },
    { key: 'look', label: 'Needs a look' }
  ];

  function setView(next) {
    view = next;
    limit = PAGE;
    expandedTeam = '';
    expandedScout = '';
  }

  function sortBy(key) {
    if (sortKey === key) reverse = !reverse;
    else {
      sortKey = key;
      reverse = false;
    }
  }

  const one = (value) => (value === null || value === undefined ? '–' : Number(value).toFixed(1).replace(/\.0$/, ''));
  const whole = (value) => (value === null || value === undefined ? '–' : Math.round(value));
  const day = (stamp) => (stamp ? new Date(stamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–');
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const barHeight = (value) => Math.max(2, Math.round(((value || 0) / maxBalls) * 20));

  const COLUMNS = [
    { key: 'number', label: 'Team' },
    { key: 'reports', label: 'Reports' },
    { key: 'auto', label: 'Auto' },
    { key: 'balls', label: 'Balls per match' },
    { key: 'accuracy', label: 'Accuracy' },
    { key: 'bps', label: 'Speed' },
    { key: 'incidents', label: 'Incidents' },
    { key: 'disputed', label: 'Scouts disagree' },
    { key: 'recent', label: 'Latest' }
  ];
</script>

<div class="browser">
  <p class="summary">
    {plural(reports.length, 'report')} · {plural(allTeamCount, 'team')} · {plural(scoutCount, 'scout')}
    {#if needsLookTotal}
      · <button class="link" type="button" on:click={() => setView('look')}>{needsLookTotal} need a look</button>{/if}
  </p>

  <div class="tabs" role="tablist" aria-label="Ways to browse the data">
    {#each VIEWS as item}
      <button
        class="tab"
        class:active={view === item.key}
        role="tab"
        aria-selected={view === item.key}
        type="button"
        on:click={() => setView(item.key)}
      >
        {item.label}{#if item.key === 'look' && needsLookTotal}<span class="count">{needsLookTotal}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="controls">
    <input
      class="search"
      type="search"
      placeholder="Team, match or scout"
      aria-label="Search reports"
      bind:value={query}
      on:input={() => (limit = PAGE)}
    />
    {#if view === 'teams'}
      <label class="field"
        >Show
        <Select bind:value={teamFilter}>
          <option value="all">All teams</option>
          <option value="few">Fewer than {FEW_REPORTS} reports</option>
          <option value="incidents">With incidents</option>
          <option value="disputed">Scouts disagree</option>
        </Select>
      </label>
      <label class="field"
        >Sort
        <Select
          value={sortKey}
          on:change={(event) => {
            sortKey = event.currentTarget.value;
            reverse = false;
          }}
        >
          {#each Object.entries(TEAM_SORTS) as [key, sort]}<option value={key}>{sort.label}</option>{/each}
        </Select>
      </label>
    {/if}
  </div>

  {#if !reports.length}
    <p class="empty">No match scouting reports have been submitted for this event yet.</p>
  {:else if view === 'teams'}
    {#if !teamRows.length}
      <p class="empty">No teams match.</p>
    {:else}
      <div class="table" role="table" aria-label="Teams">
        <div class="head" role="row">
          {#each COLUMNS as column}
            <button class="th" class:sorted={sortKey === column.key} type="button" on:click={() => sortBy(column.key)}>
              {column.label}{#if sortKey === column.key}<span aria-hidden="true">{reverse ? ' ↑' : ' ↓'}</span>{/if}
            </button>
          {/each}
        </div>
        {#each teamRows.slice(0, limit) as team (team.teamKey)}
          <div class="group" class:open={expandedTeam === team.teamKey}>
            <button
              class="trow"
              type="button"
              aria-expanded={expandedTeam === team.teamKey}
              on:click={() => (expandedTeam = expandedTeam === team.teamKey ? '' : team.teamKey)}
            >
              <span class="team">{team.number}</span>
              <span class="num" class:thin={team.count < FEW_REPORTS}>{team.count}</span>
              <span class="num">{whole(team.auto)}</span>
              <span class="balls">
                <b>{whole(team.balls)}</b>
                <svg class="bars" viewBox="0 0 {Math.max(1, team.series.slice(-12).length) * 7} 22" aria-hidden="true">
                  {#each team.series.slice(-12) as point, index}
                    <rect x={index * 7} y={22 - barHeight(point.balls)} width="5" height={barHeight(point.balls)} />
                  {/each}
                </svg>
              </span>
              <span class="num">{one(team.accuracy)}</span>
              <span class="num">{one(team.bps)}</span>
              <span class="num">
                {#if team.flagged}<span class="bad">{team.flagged} of {team.count}</span>{:else}–{/if}
              </span>
              <span class="num"
                >{#if team.disputed}<span class="warn">{team.disputed} of {team.count}</span>{:else}–{/if}</span
              >
              <span class="num muted">{day(team.last)}</span>
            </button>
            {#if expandedTeam === team.teamKey}
              <div class="rows">
                {#each team.reports as report (report.id)}
                  <ScoutReportRow {report} {onRemove} showTeam={false} reason={disputes.get(report.id) || ''} />
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if teamRows.length > limit}<button class="more" type="button" on:click={() => (limit += PAGE)}
          >Show {Math.min(PAGE, teamRows.length - limit)} more teams</button
        >{/if}
      <p class="legend">
        Accuracy and speed are the scouts’ 1–5 ratings, averaged. Bars show balls per match, oldest to newest. A faded
        report count means there isn't much data yet.
      </p>
    {/if}
  {:else if view === 'matches'}
    {#if !matchGroups.length}
      <p class="empty">No matches match.</p>
    {:else}
      {#each matchGroups.slice(0, limit) as group (group.number ?? 'other')}
        <section class="match">
          <h4>
            {group.number === null ? 'Other reports' : `Qualification ${group.number}`}<span
              >{plural(group.reports.length, 'report')} · {plural(
                new Set(group.reports.map((report) => report.team_key)).size,
                'team'
              )}</span
            >
          </h4>
          <div class="rows">
            {#each group.reports as report (report.id)}
              <ScoutReportRow {report} {onRemove} showMatch={false} reason={disputes.get(report.id) || ''} />
            {/each}
          </div>
        </section>
      {/each}
      {#if matchGroups.length > limit}<button class="more" type="button" on:click={() => (limit += PAGE)}
          >Show more matches</button
        >{/if}
    {/if}
  {:else if view === 'scouts'}
    {#if !scoutRows.length}
      <p class="empty">No scouts match.</p>
    {:else}
      <div class="table" role="table" aria-label="Scouts">
        <div class="head scout-grid" role="row">
          <span class="th">Scout</span><span class="th">Reports</span><span class="th">Teams</span><span class="th"
            >With notes</span
          ><span class="th">Disagreed</span><span class="th">Latest</span>
        </div>
        {#each scoutRows as scout (scout.name)}
          <div class="group" class:open={expandedScout === scout.name}>
            <button
              class="trow scout-grid"
              type="button"
              aria-expanded={expandedScout === scout.name}
              on:click={() => (expandedScout = expandedScout === scout.name ? '' : scout.name)}
            >
              <span class="team name">{scout.name}</span>
              <span class="num">{scout.count}</span>
              <span class="num">{scout.teams}</span>
              <span class="num">{Math.round((scout.noted / scout.count) * 100)}%</span>
              <span class="num"><span class:warn={scout.disputed}>{scout.disputed || '–'}</span></span>
              <span class="num muted">{day(scout.last)}</span>
            </button>
            {#if expandedScout === scout.name}
              <div class="rows">
                {#each scout.reports.slice(0, 40) as report (report.id)}
                  <ScoutReportRow {report} {onRemove} reason={disputes.get(report.id) || ''} />
                {/each}
                {#if scout.reports.length > 40}<p class="legend">
                    Showing the latest 40 of {scout.reports.length}. Search for a team or match to narrow it down.
                  </p>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <p class="legend">
        “With notes” is the share of a scout’s reports that include written notes. “Disagreed” counts reports where
        another scout watching the same robot in the same match logged a very different ball count.
      </p>
    {/if}
  {:else if !needsLook.length}
    <p class="empty">
      {needsLookTotal
        ? 'No flagged reports match the search.'
        : 'Nothing flagged. No crashes, breaks, cards, dead robots or disagreeing scouts.'}
    </p>
  {:else}
    <div class="rows listed">
      {#each needsLook.slice(0, limit) as report (report.id)}
        <ScoutReportRow {report} {onRemove} reason={disputes.get(report.id) || ''} />
      {/each}
    </div>
    {#if needsLook.length > limit}<button class="more" type="button" on:click={() => (limit += PAGE)}>Show more</button
      >{/if}
  {/if}
</div>

<style>
  .browser {
    display: grid;
    gap: var(--space-4);
  }
  .summary {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .tab {
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--accent-strong);
    border-bottom-color: var(--accent);
  }
  .count {
    margin-left: 0.4rem;
    color: var(--danger);
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .search {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
  }
  .search {
    flex: 0 1 18rem;
    font-size: 0.9rem;
  }
  .search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .empty {
    margin: 0;
    padding: var(--space-6);
    text-align: center;
    color: var(--text-muted);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .legend {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: var(--space-2) var(--space-4);
  }

  .table {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .head,
  .trow {
    display: grid;
    grid-template-columns: 4.5rem 4.5rem 4rem minmax(9rem, 1.3fr) 5rem 4.5rem minmax(4rem, 1fr) 9.5rem 5rem;
    gap: var(--space-3);
    align-items: center;
    padding: 0 var(--space-4);
  }
  .scout-grid {
    grid-template-columns: minmax(10rem, 2fr) 5rem 5rem 6rem 6rem 5rem;
  }
  .head {
    height: 2.4rem;
    border-bottom: 1px solid var(--border);
  }
  .th {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  span.th {
    cursor: default;
  }
  .th:hover,
  .th.sorted {
    color: var(--text);
  }
  .group {
    border-bottom: 1px solid var(--border);
  }
  .group:last-child {
    border-bottom: 0;
  }
  .group.open {
    background: var(--surface-2);
  }
  .trow {
    width: 100%;
    min-height: 3.2rem;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .trow:hover {
    background: var(--surface-2);
  }
  .trow:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .team {
    font-weight: 650;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .team.name {
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num {
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .num.thin {
    color: var(--warning);
  }
  .muted {
    color: var(--text-muted);
  }
  .balls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .balls b {
    min-width: 2.2rem;
    font-weight: 650;
    font-size: 0.92rem;
  }
  .bars {
    height: 22px;
    max-width: 5.5rem;
    fill: var(--text-muted);
    opacity: 0.75;
  }
  .bad {
    color: var(--danger);
  }
  .warn {
    color: var(--warning);
  }
  .rows {
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  /* Reports under a team or scout sit inside it: indented, with a rule down the side, so
     they read as that team's matches and not as more rows of the table. */
  .group .rows {
    margin: 0 var(--space-4) var(--space-3) var(--space-5);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
  }
  .rows.listed {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .match {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .match + .match {
    margin-top: calc(var(--space-3) * -1 + var(--space-1));
  }
  .match h4 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-size: 0.95rem;
    font-weight: 650;
  }
  .match h4 span {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 400;
  }
  .more {
    justify-self: start;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .more:hover {
    background: var(--surface-2);
  }

  @media (max-width: 860px) {
    .head {
      display: none;
    }
    .trow {
      grid-template-columns: 4rem 3.5rem 1fr 1fr;
      row-gap: var(--space-1);
      padding: var(--space-2) var(--space-3);
    }
    .trow.scout-grid {
      grid-template-columns: 1fr 3.5rem 3.5rem;
    }
    .trow > :nth-child(n + 5) {
      display: none;
    }
    .trow.scout-grid > :nth-child(n + 4) {
      display: none;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .team.name {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
