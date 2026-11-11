<script>
  // Strategy: a Team View-style brief for any team at the event, with the team list beside it (a bottom
  // sheet on phones), your team's next matches on top, and a Matches tab that plans each upcoming match with the
  // partners. Numbers come from the event's EPA model (official scores anchored to our scouting), match scouting, pit
  // scouting and TBA rankings.
  import { onMount } from 'svelte';
  import { AlertTriangle, RefreshCw, Search } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import BottomSheet from '$lib/components/common/BottomSheet.svelte';
  import Select from '$lib/components/common/Select.svelte';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import StrategyMeetings from '$lib/components/strategy/StrategyMeetings.svelte';
  import StrategyTeamBrief from '$lib/components/strategy/StrategyTeamBrief.svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { ourTeamKey, ourTeamNumber } from '$lib/stores/team.js';
  import { formatLocalTimeWithZone } from '$lib/app/timezone.js';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import { buildStrategyRows, strategyTotals } from '$lib/scouting/strategyScouting.js';
  import { buildStrategySchedule } from '$lib/scouting/strategySchedule.js';
  import { STRATEGY_SORTS, matchTimeline, sortTeams, teamStats } from '$lib/scouting/strategyBoard.js';
  import { projectMatch } from '$lib/matches/matchProjection.js';
  import { averagePowerRankings } from '$lib/scouting/powerRankingAverages.js';
  import { calibratedScale, computeEventEpa } from '$lib/matches/epaModel.js';
  import { shortMatchLabel } from '$lib/matches/matchKeys.js';

  // The team this app belongs to, from Team settings.
  $: OUR_TEAM_KEY = $ourTeamKey;
  const UPCOMING_SHOWN = 4;

  let eventKey = '';
  let selectedEventKey = null;
  let availableEvents = [];
  let report = null;
  let scheduledMatches = [];
  let eventTeams = [];
  let matchesWarning = '';
  let teamsWarning = '';
  let officialByTeam = new Map();
  let loadedEventKey = '';
  let loading = true;
  let error = '';
  let teamSearch = '';
  let sortKey = 'epa';
  let selectedTeamKey = '';
  let view = 'teams'; // 'teams' | 'meetings'
  // Phones open the brief in a sheet only when a team is tapped; desktop always shows one.
  let sheetOpen = false;

  $: resolvedEventKey = selectedEventKey || eventKey;
  $: activeEventLabel = availableEvents.find((option) => option.value === eventKey)?.label || eventKey || 'not set';
  $: browseEventOptions = availableEvents.filter((option) => option.value !== eventKey);

  $: rows = buildStrategyRows(report?.data || {}, eventTeams);
  $: totals = strategyTotals(rows);
  $: entries = report?.data?.match_entries || [];
  let matchRankings = [];
  $: strategyEpa = computeEventEpa(scheduledMatches, { scoutEntries: entries, matchRankings });
  $: epaModel = strategyEpa.size ? { byTeam: strategyEpa, scale: calibratedScale(strategyEpa.residualStd) } : null;
  $: epaRank = new Map([...strategyEpa].sort((a, b) => b[1].epa - a[1].epa).map(([key], index) => [key, index + 1]));
  // Performance scouts rank every robot they watched, so a team's power rank comes from all reports, not only its own.
  $: powerRankByTeam = new Map(averagePowerRankings(entries).teams.map((team) => [team.team_key, team]));
  $: nameByTeam = new Map(eventTeams.map((team) => [team.key, team.nickname || team.name || '']));
  // Each team's strat person's phone, from pit scouting, for the Matches tab.
  $: phoneByTeam = new Map(
    rows
      .map((row) => [row.teamKey, String(row.pitEntry?.technical_details?.strat_phone || '').trim()])
      .filter(([, phone]) => phone)
  );
  $: items = rows.map((row) => ({
    row,
    name: nameByTeam.get(row.teamKey) || '',
    stats: teamStats(row, {
      epaRow: strategyEpa.get(row.teamKey) || null,
      officialRow: officialByTeam.get(row.teamNumber) || null,
      epaRank: epaRank.get(row.teamKey) ?? null,
      powerRank: powerRankByTeam.get(row.teamKey) || null
    })
  }));
  $: search = teamSearch.trim().toLowerCase();
  $: sortedRows = sortTeams(
    items.filter(
      (item) =>
        !search ||
        item.row.teamNumber.includes(search) ||
        item.name.toLowerCase().includes(search) ||
        String(item.row.pitEntry?.robot_archetype || '')
          .toLowerCase()
          .includes(search)
    ),
    sortKey
  ).map((item) => item.row);
  $: itemByTeam = new Map(items.map((item) => [item.row.teamKey, item]));
  $: listItems = sortedRows.map((row) => itemByTeam.get(row.teamKey));
  // Desktop opens on your team when it is at the event (otherwise the top of the list), so the brief is never empty.
  $: defaultTeamKey = itemByTeam.has(OUR_TEAM_KEY) ? OUR_TEAM_KEY : listItems[0]?.row.teamKey || '';
  $: activeTeamKey = itemByTeam.has(selectedTeamKey) ? selectedTeamKey : defaultTeamKey;
  $: selected = itemByTeam.get(activeTeamKey) || null;

  const upcomingFor = (teamKey) =>
    buildStrategySchedule(scheduledMatches, teamKey)
      .upcoming.filter((entry) => !entry.match.is_test_market)
      .slice(0, UPCOMING_SHOWN)
      .map((entry) => ({ ...entry, projection: projectMatch(entry.match, new Map(), new Map(), epaModel) }));
  $: selectedTimeline = selected ? matchTimeline(selected.row.teamKey, scheduledMatches, entries) : [];
  $: selectedUpcoming = selected ? upcomingFor(selected.row.teamKey) : [];
  $: ours = itemByTeam.get(OUR_TEAM_KEY) || null;
  $: ourUpcoming = ours ? upcomingFor(OUR_TEAM_KEY) : [];

  const team = (key) => String(key || '').replace(/^frc/i, '');
  const one = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
  const whole = (value) => (Number.isFinite(value) ? Math.round(value).toString() : '—');
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
  const winFor = (entry) =>
    entry.projection?.redWinProbability == null
      ? null
      : entry.alliance === 'red'
        ? entry.projection.redWinProbability
        : 1 - entry.projection.redWinProbability;
  const matchTime = (seconds) =>
    Number.isFinite(Number(seconds)) && Number(seconds) > 0
      ? formatLocalTimeWithZone(new Date(Number(seconds) * 1000))
      : 'Time TBA';

  function selectTeam(teamKey) {
    if (!itemByTeam.has(teamKey)) return;
    selectedTeamKey = teamKey;
    if ($isPhone) sheetOpen = true;
  }

  const teamHref = (teamKey) =>
    `/teamview?event_key=${encodeURIComponent(resolvedEventKey)}&team=${encodeURIComponent(teamKey)}&from=${encodeURIComponent('/strategy')}&fromLabel=${encodeURIComponent('Strategy')}`;

  function applyTeamsPayload(payload) {
    if (payload?.success) {
      eventTeams = payload.data || [];
      teamsWarning = '';
    } else teamsWarning = payload?.error || 'Could not load the event roster from The Blue Alliance.';
  }

  function applyMatchesPayload(payload) {
    if (payload?.success) {
      scheduledMatches = payload.data || [];
      matchesWarning = '';
    } else matchesWarning = payload?.error || 'Could not load the match schedule from The Blue Alliance.';
  }

  // The event roster and match schedule barely change mid-event, so they go
  // through fetchWithCache: whatever was cached from the last visit paints
  // immediately via applyTeamsPayload/applyMatchesPayload, then gets
  // replaced once (if) the network request actually lands - a slow or
  // dropped connection leaves the last-known roster/schedule on screen
  // instead of a blank Teams/Matches board. OPR is reference-only and
  // fetched separately, deliberately not awaited before `loading` clears -
  // see loadOfficialRankings below.
  async function loadStrategy() {
    if (!resolvedEventKey) {
      report = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    matchesWarning = '';
    teamsWarning = '';
    try {
      const authHeaders = await getAuthHeader();
      const [response] = await Promise.all([
        fetch(`/api/scouting-report?event_key=${encodeURIComponent(resolvedEventKey)}`, { headers: authHeaders }),
        fetchWithCache(`/api/tba/event-matches?event_key=${encodeURIComponent(resolvedEventKey)}&comp_level=all`, {
          cacheKey: `event-matches:${resolvedEventKey}:all`,
          onUpdate: applyMatchesPayload
        }).catch((e) => applyMatchesPayload({ success: false, error: e?.message })),
        fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(resolvedEventKey)}`, {
          cacheKey: `event-teams:${resolvedEventKey}`,
          onUpdate: applyTeamsPayload
        }).catch((e) => applyTeamsPayload({ success: false, error: e?.message }))
      ]);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success)
        throw new Error(payload?.error || 'Could not load scouting strategy data.');
      report = payload;
      loadedEventKey = resolvedEventKey;
      loadOfficialRankings(resolvedEventKey);
      loadMatchRankings(resolvedEventKey, authHeaders);
    } catch (cause) {
      report = null;
      eventTeams = [];
      scheduledMatches = [];
      officialByTeam = new Map();
      error = cause?.message || 'Could not load scouting strategy data.';
    } finally {
      loadedEventKey = resolvedEventKey;
      loading = false;
    }
  }

  // Fire-and-forget, on purpose: OPR is reference data (see the "measure
  // key" copy elsewhere in this app), never something Teams/Matches needs
  // to render. Awaiting it inside loadStrategy would mean a slow or
  // unreachable OPR endpoint delays the page's actual content for no
  // reason - it fills in officialByTeam whenever it lands, or not at all.
  // The scouts' best-to-worst match rankings feed the EPA model; optional, like OPR.
  async function loadMatchRankings(forEventKey, headers) {
    try {
      const response = await fetch(`/api/scouting-match-rankings?event_key=${encodeURIComponent(forEventKey)}`, {
        headers
      });
      const payload = await response.json().catch(() => null);
      if (forEventKey === resolvedEventKey) matchRankings = payload?.success ? payload.data || [] : [];
    } catch {
      matchRankings = [];
    }
  }

  async function loadOfficialRankings(forEventKey) {
    try {
      // Same cache key Power Rankings uses for this same call - whichever
      // page a scout visited first warms it for the other.
      const payload = await fetchWithCache(`/api/tba/event-oprs?event_key=${encodeURIComponent(forEventKey)}`, {
        cacheKey: `event-oprs:${forEventKey}`
      });
      if (forEventKey !== resolvedEventKey) return; // event switched while this was in flight
      officialByTeam = new Map((payload?.success ? payload.data || [] : []).map((team) => [String(team.team), team]));
    } catch {
      // Reference-only - silently leave officialByTeam as whatever it was.
    }
  }

  onMount(async () => {
    [eventKey, availableEvents] = await Promise.all([fetchActiveScoutingEventKey(), fetchAvailableScoutingEvents()]);
    await loadStrategy();
  });

  $: if (resolvedEventKey && resolvedEventKey !== loadedEventKey && !loading) void loadStrategy();
</script>

<svelte:head><title>Strategy</title></svelte:head>

<div class="strategy">
  <header class="page-head">
    <div>
      <h1>Strategy Board</h1>
      <p>Every team at the event, with the numbers behind match and pick decisions.</p>
    </div>
    <div class="head-actions">
      <SeasonFilter
        hideLabel
        options={browseEventOptions}
        bind:value={selectedEventKey}
        allLabel={`Current Event (${activeEventLabel})`}
      />
      <button class="btn btn-outline" on:click={loadStrategy} disabled={loading || !resolvedEventKey}
        ><RefreshCw size={16} /> Refresh</button
      >
    </div>
  </header>

  {#if !resolvedEventKey}
    <div class="empty-state">Set an active scouting event in Scouting Admin to build the strategy board.</div>
  {:else if loading}
    <div class="empty-state">Loading strategy evidence...</div>
  {:else if error}
    <div class="notice notice-error">{error}</div>
  {:else}
    <section class="overview" aria-label="Event overview">
      <div class="stat-strip">
        <span><b>{totals.teams}</b>teams</span>
        <span><b>{entries.length}</b>match reports</span>
        <span><b>{totals.pitProfiles}</b>pit profiles</span>
        <span class:risky={totals.openProblems > 0}><b>{totals.openProblems}</b>open issues</span>
      </div>
      {#if ours && ourUpcoming.length}
        <div class="ours">
          <div class="ours-id">
            <span class="eyebrow">Us</span>
            <b>{$ourTeamNumber}</b>
            <span class="ours-nums"
              >Rank {ours.stats.rank ? `#${ours.stats.rank}` : '—'} · {ours.stats.record || '—'} · EPA {one(
                ours.stats.epa
              )}</span
            >
          </div>
          {#if ourUpcoming.length}
            <ul class="ours-next" aria-label="Our next matches">
              {#each ourUpcoming as entry (entry.match.key)}
                {@const win = winFor(entry)}
                <li class={entry.alliance}>
                  <div class="next-top">
                    <b>{shortMatchLabel(entry.match.key)}</b><span class="when">{matchTime(entry.estimatedTime)}</span>
                  </div>
                  <div class="next-teams">
                    <span
                      ><small>With</small
                      >{#each (entry.match.alliances?.[entry.alliance]?.team_keys || []).filter((key) => key !== OUR_TEAM_KEY) as key (key)}<button
                          type="button"
                          class="team-chip"
                          on:click={() => selectTeam(key)}>{team(key)}</button
                        >{/each}</span
                    >
                    <span
                      ><small>Against</small
                      >{#each entry.match.alliances?.[entry.alliance === 'red' ? 'blue' : 'red']?.team_keys || [] as key (key)}<button
                          type="button"
                          class="team-chip"
                          on:click={() => selectTeam(key)}>{team(key)}</button
                        >{/each}</span
                    >
                  </div>
                  <span class="next-win" class:fav={win != null && win >= 0.5}
                    >{win == null ? 'No prediction yet' : `${pct(win)} to win`}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>

    <div class="tabs" role="tablist" aria-label="Strategy">
      <button role="tab" aria-selected={view === 'teams'} class:on={view === 'teams'} on:click={() => (view = 'teams')}
        >Teams</button
      >
      <button
        role="tab"
        aria-selected={view === 'meetings'}
        class:on={view === 'meetings'}
        on:click={() => (view = 'meetings')}>Matches</button
      >
    </div>
    {#if matchesWarning}<p class="muted">{matchesWarning}</p>{/if}
    {#if teamsWarning}<p class="muted">{teamsWarning} Showing teams found in scouting data.</p>{/if}

    {#if view === 'meetings'}
      <StrategyMeetings
        matches={scheduledMatches}
        teamKey={OUR_TEAM_KEY}
        {phoneByTeam}
        {nameByTeam}
        onSelectTeam={(key) => {
          // Only leave Matches when the partner is on the board, or the tap would land on an empty brief.
          if (!itemByTeam.has(key)) return;
          view = 'teams';
          selectTeam(key);
        }}
      />
    {:else}
      <div class="board">
        <aside class="team-list" aria-label="Teams">
          <div class="list-tools">
            <label class="search"
              ><Search size={16} /><input
                type="search"
                bind:value={teamSearch}
                placeholder="Team, name or archetype"
                aria-label="Filter teams"
              /></label
            >
            <Select bind:value={sortKey} aria-label="Sort teams">
              {#each STRATEGY_SORTS as [key, label] (key)}<option value={key}>Sort: {label}</option>{/each}
            </Select>
          </div>
          {#if !listItems.length}
            <p class="muted pad">No team matches this filter.</p>
          {:else}
            <div class="list-head" aria-hidden="true">
              <span>#</span><span>Team</span><span class="n">EPA</span><span class="n">Fuel</span><span class="n"
                >Acc</span
              ><span class="n">Rank</span><span></span>
            </div>
            <ol class="teams">
              {#each listItems as item, index (item.row.teamKey)}
                <li>
                  <button
                    type="button"
                    class="team-row"
                    class:on={!$isPhone && item.row.teamKey === activeTeamKey}
                    class:us={item.row.teamKey === OUR_TEAM_KEY}
                    aria-current={!$isPhone && item.row.teamKey === activeTeamKey ? 'true' : undefined}
                    aria-label={`${item.row.teamNumber} ${item.name}: EPA ${one(item.stats.epa, 0)}, fuel ${whole(item.stats.fuel)}, accuracy ${one(item.stats.accuracy)}, rank ${item.stats.rank ?? 'none'}${item.stats.openIssues ? `, ${item.stats.openIssues} open issues` : ''}`}
                    on:click={() => selectTeam(item.row.teamKey)}
                  >
                    <span class="pos">{index + 1}</span>
                    <span class="who"
                      ><b>{item.row.teamNumber}</b><small
                        >{item.name || item.row.pitEntry?.robot_archetype || '—'}</small
                      ></span
                    >
                    <span class="n strong">{one(item.stats.epa, 0)}</span>
                    <span class="n">{whole(item.stats.fuel)}</span>
                    <span class="n">{one(item.stats.accuracy)}</span>
                    <span class="n">{item.stats.rank ?? '—'}</span>
                    <span class="flag"
                      >{#if item.stats.openIssues}<AlertTriangle size={14} />{/if}</span
                    >
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </aside>

        {#if !$isPhone}
          <div class="brief-pane">
            {#if selected}
              <StrategyTeamBrief
                row={selected.row}
                stats={selected.stats}
                name={selected.name}
                timeline={selectedTimeline}
                upcoming={selectedUpcoming}
                teamHref={teamHref(selected.row.teamKey)}
                teamCount={strategyEpa.size}
                onSelectTeam={selectTeam}
              />
            {:else}<div class="empty-state">No scouting evidence for this event yet.</div>{/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if $isPhone}
  <BottomSheet
    open={sheetOpen && Boolean(selected)}
    title={selected ? `${selected.row.teamNumber}${selected.name ? ` · ${selected.name}` : ''}` : ''}
    subtitle={selected
      ? `Rank ${selected.stats.rank ? `#${selected.stats.rank}` : '—'} · ${selected.stats.record || '—'} · EPA ${one(selected.stats.epa)}`
      : ''}
    on:close={() => (sheetOpen = false)}
  >
    {#if selected}
      <StrategyTeamBrief
        row={selected.row}
        stats={selected.stats}
        name={selected.name}
        timeline={selectedTimeline}
        upcoming={selectedUpcoming}
        teamCount={strategyEpa.size}
        onSelectTeam={selectTeam}
        showHeader={false}
      />
    {/if}
    <svelte:fragment slot="actions"
      >{#if selected}<a class="btn btn-primary" href={teamHref(selected.row.teamKey)}>Open team view</a
        >{/if}</svelte:fragment
    >
  </BottomSheet>
{/if}

<style>
  .strategy {
    display: grid;
    gap: var(--space-4);
    width: 100%;
    margin: 0;
  }
  .page-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .page-head h1 {
    margin: 0;
    font-size: clamp(1.75rem, 2.8vw, 2.3rem);
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--text-strong, var(--text));
  }
  .page-head p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }
  /* The event picker and Refresh sit on one line at the same height (the picker names the event itself). */
  .head-actions {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .head-actions :global(.form-group) {
    margin: 0;
  }
  .head-actions .btn {
    height: auto;
    min-height: 2.5rem;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
  .pad {
    padding: var(--space-3);
  }

  .overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
  /* One quiet bar of event totals, divided into equal cells. */
  .stat-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .stat-strip span {
    display: grid;
    gap: 2px;
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
  @media (max-width: 600px) {
    .stat-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .stat-strip span:nth-child(3) {
      border-left: 0;
    }
    .stat-strip span:nth-child(n + 3) {
      border-top: 1px solid var(--border);
    }
  }
  .stat-strip b {
    order: -1;
    color: var(--text-strong, var(--text));
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    text-transform: none;
    font-variant-numeric: tabular-nums;
  }
  .stat-strip .risky b {
    color: var(--danger);
  }
  .ours {
    display: grid;
    grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .ours-id {
    display: grid;
    gap: 2px;
  }
  .ours-id b {
    font-family: var(--font-display);
    font-size: 2rem;
    line-height: 1;
    font-weight: 500;
    color: var(--text-strong, var(--text));
  }
  .ours-nums {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .ours-next {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-2);
  }
  .ours-next li {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .ours-next li.red {
    box-shadow: inset 3px 0 0 var(--alliance-red-text);
  }
  .ours-next li.blue {
    box-shadow: inset 3px 0 0 var(--alliance-blue-text);
  }
  .next-top {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .when {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.8rem);
  }
  .next-teams {
    display: grid;
    gap: 2px;
  }
  .next-teams > span {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .next-teams small {
    min-width: 3.6rem;
    color: var(--text-muted);
    font-size: var(--text-min);
  }
  .team-chip {
    min-height: 1.75rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .team-chip:hover {
    border-color: var(--accent);
  }
  .next-win {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .next-win.fav {
    color: var(--success);
    font-weight: 700;
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .tabs button {
    min-height: 2.25rem;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .tabs button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
    color: var(--text-strong, var(--text));
  }
  .tabs button.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }

  /* Desktop: the team list on the left stays in view while the brief scrolls beside it. */
  .board {
    display: grid;
    grid-template-columns: minmax(22rem, 26rem) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  /* The list stays where it is on the page and scrolls inside its own box. */
  .team-list {
    position: sticky;
    top: calc(var(--strip-height, 3rem) + var(--space-3));
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    max-height: calc(100 * var(--vh) - var(--strip-height, 3rem) - var(--space-6));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .list-tools {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    min-height: 2.5rem;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: max(16px, 1rem);
  }
  .search input:focus {
    outline: none;
  }
  /* One header row and fixed columns, so numbers line up down the list and the issue icon has its own slot. */
  .list-head,
  .team-row {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr) 2.8rem 2.8rem 2.4rem 2.4rem 1.1rem;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
  }
  .list-head {
    min-height: 2rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.72rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .n {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .teams {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .team-row {
    width: 100%;
    min-height: 3.25rem;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .team-row:hover {
    background: var(--surface-2);
  }
  .team-row.on {
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  .team-row.us .who b {
    color: var(--accent-strong);
  }
  .team-row .strong {
    font-weight: 700;
  }
  .pos {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who b {
    font-variant-numeric: tabular-nums;
  }
  .who small {
    overflow: hidden;
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.78rem);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flag {
    display: inline-flex;
    justify-content: center;
    color: var(--danger);
  }
  .brief-pane {
    min-width: 0;
  }

  /* Phones: the overview stacks, the list is the screen, and a tapped team opens in a bottom sheet. */
  @media (max-width: 900px) {
    .strategy {
      gap: var(--space-3);
    }
    .head-actions {
      width: 100%;
    }
    .ours {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
      padding: var(--space-3);
    }
    .ours-next {
      grid-template-columns: minmax(0, 1fr);
    }
    .team-chip {
      min-height: var(--tap-min);
      min-width: 3rem;
    }
    .tabs button {
      flex: 1;
    }
    .board {
      grid-template-columns: minmax(0, 1fr);
    }
    .team-list {
      position: static;
      max-height: none;
    }
    .team-row {
      min-height: var(--tap-min);
    }
    .list-head,
    .team-row {
      grid-template-columns: 1.4rem minmax(0, 1fr) 2.6rem 2.6rem 2.2rem 2.2rem 1rem;
      gap: var(--space-1);
      padding: 0 var(--space-2);
    }
    /* Phone: wrap, never cut text - team names wrap under the number instead of ending in "...". */
    .who small {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
</style>
