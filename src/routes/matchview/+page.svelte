<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import MatchTeamCard from '$lib/components/matches/MatchTeamCard.svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { canonicalReports } from '$lib/matches/matchKeys.js';
  import {
    allianceOutlook,
    ballSeries,
    briefsByTeam,
    coverage,
    eventCountsFor,
    isPlayed,
    keyFigures,
    longLabel,
    notesFor,
    officialByTeam,
    openProblemsFor,
    rankingPoints,
    reportsFor,
    shortLabel,
    sortMatches,
    startTime,
    tbaMatchUrl,
    winnerOf,
    youtubeLinks
  } from '$lib/matches/matchView.js';

  let eventKey = '';
  let matches = [];
  let entries = [];
  let nicknames = new Map();
  let assigned = new Map(); // "matchKey|teamKey" -> scout name
  let notes = [];
  let events = [];
  let problems = [];
  let official = new Map();
  let loading = true;
  let error = '';
  let query = '';
  let selectedKey = '';
  // Phones show the match list and one match as separate screens; the alliance picker shows one
  // alliance's robots at a time.
  let phoneScreen = 'list';
  let phoneSide = 'red';

  $: ordered = sortMatches(matches);
  $: briefs = briefsByTeam(entries);
  $: shown = ordered.filter((match) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text =
      `${shortLabel(match)} ${match.match_number} ${[...(match.alliances?.red?.team_keys || []), ...(match.alliances?.blue?.team_keys || [])].map((key) => key.replace(/^frc/, '')).join(' ')}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  $: selected = ordered.find((match) => match.key === selectedKey) || null;
  $: index = ordered.findIndex((match) => match.key === selectedKey);
  $: red = selected ? allianceOutlook(selected.alliances?.red?.team_keys, briefs) : null;
  $: blue = selected ? allianceOutlook(selected.alliances?.blue?.team_keys, briefs) : null;
  $: cover = selected ? coverage(selected, entries) : null;
  $: winner = selected ? winnerOf(selected) : null;
  $: videos = selected ? youtubeLinks(selected) : [];
  $: figures = selected && isPlayed(selected) ? keyFigures(selected) : { rows: [], bonuses: { red: [], blue: [] } };
  $: rpRed = selected ? rankingPoints(selected, 'red') : null;
  $: rpBlue = selected ? rankingPoints(selected, 'blue') : null;
  $: currentNumber = selected && /_qm\d+$/i.test(selected.key) ? Number(selected.key.split('_qm').at(-1)) : null;
  $: scoreRed = selected && isPlayed(selected) ? selected.alliances.red.score : null;
  $: scoreBlue = selected && isPlayed(selected) ? selected.alliances.blue.score : null;

  const when = (match) => {
    const time = startTime(match);
    return time ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  };
  const split = (a, b) => {
    const total = (a || 0) + (b || 0);
    return total > 0 ? Math.round((a / total) * 100) : 50;
  };

  function openOnPhone(key) {
    choose(key);
    phoneScreen = 'match';
    window.scrollTo({ top: 0 });
  }

  function choose(key) {
    selectedKey = key;
    const url = new URL($page.url);
    url.searchParams.set('match', key);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  function step(delta) {
    const next = ordered[index + delta];
    if (next) choose(next.key);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      eventKey = (await fetchActiveScoutingEventKey()) || '';
      if (!eventKey) throw new Error('No active scouting event. Set one in Scouting Admin.');
      const headers = await getAuthHeader();
      const [reportRes, , , assignRes, oprPayload] = await Promise.all([
        fetch(`/api/scouting-report?event_key=${encodeURIComponent(eventKey)}`, { headers }),
        fetchWithCache(`/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=all`, {
          cacheKey: `event-matches:${eventKey}:all`,
          onUpdate: (payload) => {
            if (payload?.success) matches = payload.data || [];
          }
        }).then((payload) => {
          if (payload?.success) matches = payload.data || [];
        }),
        fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`, {
          cacheKey: `event-teams:${eventKey}`,
          onUpdate: (payload) => {
            if (payload?.success) nicknames = new Map((payload.data || []).map((team) => [team.key, team.nickname]));
          }
        }).then((payload) => {
          if (payload?.success) nicknames = new Map((payload.data || []).map((team) => [team.key, team.nickname]));
        }),
        fetch('/api/scout-assignments?scouting_type=data', { headers }),
        fetchWithCache(`/api/tba/event-oprs?event_key=${encodeURIComponent(eventKey)}`, {
          cacheKey: `event-oprs:${eventKey}`
        }).catch(() => null)
      ]);
      if (oprPayload?.success) official = officialByTeam(oprPayload.data);
      const report = await reportRes.json().catch(() => null);
      if (!reportRes.ok || !report?.success) throw new Error(report?.error || 'Could not load the scouting reports.');
      entries = canonicalReports(report.data?.match_entries || [], eventKey);
      notes = canonicalReports(report.data?.notes || [], eventKey);
      events = canonicalReports(report.data?.data_events || [], eventKey);
      problems = report.data?.pit_problems || [];
      const assignData = await assignRes.json().catch(() => null);
      assigned = new Map(
        (assignData?.success ? assignData.data || [] : [])
          .filter((row) => row.user_name)
          .map((row) => [`${row.match_key}|${row.team_key}`, row.user_name])
      );

      const wanted = $page.url.searchParams.get('match');
      if (wanted) phoneScreen = 'match';
      const sorted = sortMatches(matches);
      selectedKey =
        sorted.find((match) => match.key === wanted)?.key ||
        sorted.find((match) => !isPlayed(match))?.key ||
        sorted.at(-1)?.key ||
        '';
    } catch (cause) {
      error = cause?.message || 'Could not load matches.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Match View</title></svelte:head>

<div class="page-header">
  <div>
    <h1>Match View</h1>
    <p>One match at a time: both alliances, and what scouts reported for each robot in it.</p>
  </div>
</div>

{#if loading}
  <p class="muted">Loading the schedule…</p>
{:else if error}
  <div class="empty-state"><p>{error}</p></div>
{:else if !ordered.length}
  <div class="empty-state"><p>No schedule published for {eventKey} yet.</p></div>
{:else if $isPhone}
  <!-- Phone (#124): a full-page match list, and each match on its own screen. -->
  {#if phoneScreen === 'list' || !selected}
    <div class="pm">
      <label class="pm-search"
        ><Search size={16} /><input
          type="search"
          placeholder="Match or team"
          aria-label="Find a match"
          bind:value={query}
        /></label
      >
      <ul class="pm-list">
        {#each shown as match (match.key)}
          {@const c = coverage(match, entries)}
          {@const played = isPlayed(match)}
          <li>
            <button
              type="button"
              class:next={!played && match.key === ordered.find((m) => !isPlayed(m))?.key}
              on:click={() => openOnPhone(match.key)}
            >
              <span class="pm-top"
                ><b>{shortLabel(match)}</b><span
                  >{played ? `${match.alliances.red.score} - ${match.alliances.blue.score}` : when(match)}</span
                ><span class="cov" class:full={c.reported === c.total && c.total > 0} class:empty={c.reported === 0}
                  >{c.reported}/{c.total}</span
                ></span
              >
              <span class="pm-teams red"
                >{(match.alliances?.red?.team_keys || []).map((key) => key.replace(/^frc/, '')).join('  ')}</span
              >
              <span class="pm-teams blue"
                >{(match.alliances?.blue?.team_keys || []).map((key) => key.replace(/^frc/, '')).join('  ')}</span
              >
            </button>
          </li>
        {:else}
          <li class="none">No match for “{query}”</li>
        {/each}
      </ul>
    </div>
  {:else}
    <section class="pd">
      <div class="pd-bar">
        <button type="button" class="pd-icon" aria-label="All matches" on:click={() => (phoneScreen = 'list')}
          ><ArrowLeft size={20} /></button
        >
        <div class="pd-title">
          <h2>{shortLabel(selected)}</h2>
          <small>{[when(selected), `${cover.reported}/${cover.total} reported`].filter(Boolean).join(' · ')}</small>
        </div>
        <button
          type="button"
          class="pd-icon"
          aria-label="Previous match"
          disabled={index <= 0}
          on:click={() => step(-1)}><ChevronLeft size={20} /></button
        >
        <button
          type="button"
          class="pd-icon"
          aria-label="Next match"
          disabled={index >= ordered.length - 1}
          on:click={() => step(1)}><ChevronRight size={20} /></button
        >
      </div>

      <div class="pd-score">
        <div class="red-t">
          <span>Red</span><b>{scoreRed ?? red.balls}</b><small
            >{scoreRed !== null ? `${rpRed ?? 0} RP` : 'expected balls'}</small
          >
        </div>
        <div class="pd-vs">
          {isPlayed(selected) ? (winner === 'tie' ? 'Tie' : `${winner === 'red' ? 'Red' : 'Blue'} won`) : 'vs'}
        </div>
        <div class="blue-t">
          <span>Blue</span><b>{scoreBlue ?? blue.balls}</b><small
            >{scoreBlue !== null ? `${rpBlue ?? 0} RP` : 'expected balls'}</small
          >
        </div>
      </div>

      <div class="pd-bars">
        {#each [['Expected balls', red.balls, blue.balls], ['Expected auto points', red.auto, blue.auto]] as [label, r, b]}
          <div class="pd-metric">
            <span class="r">{r}</span><span class="l">{label}</span><span class="b">{b}</span>
            <div class="bar" role="img" aria-label={`${label}: red ${r}, blue ${b}`}>
              <i class="r" style={`width:${split(r, b)}%`}></i><i class="b" style={`width:${100 - split(r, b)}%`}></i>
            </div>
          </div>
        {/each}
        {#each figures.rows as row (row.label)}
          <div class="pd-fig">
            <span class="r" class:lead={row.red > row.blue}>{row.red}</span><span class="l">{row.label}</span><span
              class="b"
              class:lead={row.blue > row.red}>{row.blue}</span
            >
          </div>
        {/each}
        {#if red.known < red.size || blue.known < blue.size}<p class="caveat">
            Counts {red.known}/{red.size} red and {blue.known}/{blue.size} blue robots with reports.
          </p>{/if}
      </div>

      <div class="pd-seg" role="tablist" aria-label="Alliance">
        <button
          role="tab"
          class="red"
          aria-selected={phoneSide === 'red'}
          class:on={phoneSide === 'red'}
          on:click={() => (phoneSide = 'red')}>Red alliance</button
        >
        <button
          role="tab"
          class="blue"
          aria-selected={phoneSide === 'blue'}
          class:on={phoneSide === 'blue'}
          on:click={() => (phoneSide = 'blue')}>Blue alliance</button
        >
      </div>
      <div class="pd-teams">
        {#each selected.alliances?.[phoneSide]?.team_keys || [] as teamKey (teamKey)}
          <MatchTeamCard
            {teamKey}
            nickname={nicknames.get(teamKey) || ''}
            brief={briefs.get(teamKey) || null}
            reports={reportsFor(entries, selected.key, teamKey)}
            assignedScout={assigned.get(`${selected.key}|${teamKey}`) || ''}
            official={official.get(teamKey) || null}
            series={ballSeries(entries, teamKey)}
            {currentNumber}
            notes={notesFor(notes, selected.key, teamKey)}
            eventCounts={eventCountsFor(events, selected.key, teamKey)}
            problems={openProblemsFor(problems, teamKey)}
          />
        {/each}
      </div>
      <p class="pd-links">
        <a href={tbaMatchUrl(selected.key)} target="_blank" rel="noreferrer">Blue Alliance</a
        >{#each videos as link, i}<a href={link} target="_blank" rel="noreferrer"
            >{videos.length > 1 ? `Video ${i + 1}` : 'Watch video'}</a
          >{/each}
      </p>
    </section>
  {/if}
{:else}
  <div class="mv">
    <aside class="list" aria-label="Matches">
      <input class="search" type="search" placeholder="Match or team" aria-label="Find a match" bind:value={query} />
      <ul>
        {#each shown as match (match.key)}
          {@const c = coverage(match, entries)}
          <li>
            <button type="button" class:active={match.key === selectedKey} on:click={() => choose(match.key)}>
              <b>{shortLabel(match)}</b>
              <span class="time">{when(match)}</span>
              <span class="cov" class:full={c.reported === c.total && c.total > 0} class:empty={c.reported === 0}
                >{c.reported}/{c.total}</span
              >
            </button>
          </li>
        {:else}
          <li class="none">No match for “{query}”</li>
        {/each}
      </ul>
    </aside>

    {#if selected}
      <section class="detail">
        <div class="match-head">
          <button type="button" class="nav" aria-label="Previous match" disabled={index <= 0} on:click={() => step(-1)}
            ><ChevronLeft size={18} /></button
          >
          <div class="title">
            <h2>{longLabel(selected)}</h2>
            <p>
              {[
                when(selected),
                isPlayed(selected)
                  ? winner === 'tie'
                    ? 'Played · tie'
                    : `Played · ${winner === 'red' ? 'Red' : 'Blue'} won`
                  : 'Not played yet',
                `${cover.reported} of ${cover.total} robots reported`
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p class="links">
              <a href={tbaMatchUrl(selected.key)} target="_blank" rel="noreferrer">Blue Alliance</a
              >{#each videos as link, i}<a href={link} target="_blank" rel="noreferrer"
                  >{videos.length > 1 ? `Video ${i + 1}` : 'Watch video'}</a
                >{/each}
            </p>
          </div>
          <button
            type="button"
            class="nav"
            aria-label="Next match"
            disabled={index >= ordered.length - 1}
            on:click={() => step(1)}><ChevronRight size={18} /></button
          >
        </div>

        <div class="compare" aria-label="Alliance comparison">
          <div class="side red-t">
            <span>Red</span>{#if scoreRed !== null}<b>{scoreRed}</b>{/if}{#if rpRed !== null}<small>{rpRed} RP</small
              >{/if}{#if figures.bonuses.red.length}<small class="bonus">{figures.bonuses.red.join(' · ')}</small>{/if}
          </div>
          <div class="bars">
            <p class="group">Expected from scouting</p>
            <div class="metric">
              <span class="v">{red.balls}</span>
              <div class="bar" role="img" aria-label={`Expected balls: red ${red.balls}, blue ${blue.balls}`}>
                <i class="r" style={`width:${split(red.balls, blue.balls)}%`}></i><i
                  class="b"
                  style={`width:${100 - split(red.balls, blue.balls)}%`}
                ></i>
              </div>
              <span class="v">{blue.balls}</span>
              <small>Expected balls</small>
            </div>
            <div class="metric">
              <span class="v">{red.auto}</span>
              <div class="bar" role="img" aria-label={`Expected auto points: red ${red.auto}, blue ${blue.auto}`}>
                <i class="r" style={`width:${split(red.auto, blue.auto)}%`}></i><i
                  class="b"
                  style={`width:${100 - split(red.auto, blue.auto)}%`}
                ></i>
              </div>
              <span class="v">{blue.auto}</span>
              <small>Expected auto points</small>
            </div>
            {#if figures.rows.length}
              <p class="group official">Official result</p>
              <div class="figs">
                {#each figures.rows as row (row.label)}
                  <div class="fig">
                    <span class="r" class:lead={row.red > row.blue}>{row.red}</span>
                    <span class="l">{row.label}</span>
                    <span class="b" class:lead={row.blue > row.red}>{row.blue}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          <div class="side blue-t">
            <span>Blue</span>{#if scoreBlue !== null}<b>{scoreBlue}</b>{/if}{#if rpBlue !== null}<small
                >{rpBlue} RP</small
              >{/if}{#if figures.bonuses.blue.length}<small class="bonus">{figures.bonuses.blue.join(' · ')}</small
              >{/if}
          </div>
        </div>
        {#if red.known < red.size || blue.known < blue.size}
          <p class="caveat">
            Expected numbers add each robot’s season average. They count {red.known} of {red.size} red and {blue.known} of
            {blue.size} blue robots; the rest have no reports yet.
          </p>
        {/if}

        <div class="alliances">
          <h3 class="red">Red alliance</h3>
          <h3 class="blue">Blue alliance</h3>
          {#each [0, 1, 2] as slot}
            {#each ['red', 'blue'] as side}
              {@const teamKey = selected.alliances?.[side]?.team_keys?.[slot]}
              {#if teamKey}
                <MatchTeamCard
                  {teamKey}
                  nickname={nicknames.get(teamKey) || ''}
                  brief={briefs.get(teamKey) || null}
                  reports={reportsFor(entries, selected.key, teamKey)}
                  assignedScout={assigned.get(`${selected.key}|${teamKey}`) || ''}
                  official={official.get(teamKey) || null}
                  series={ballSeries(entries, teamKey)}
                  {currentNumber}
                  notes={notesFor(notes, selected.key, teamKey)}
                  eventCounts={eventCountsFor(events, selected.key, teamKey)}
                  problems={openProblemsFor(problems, teamKey)}
                />
              {:else}<div></div>{/if}
            {/each}
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .muted {
    color: var(--text-muted);
  }
  .mv {
    display: grid;
    grid-template-columns: 15rem minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
    margin-top: var(--space-4);
  }
  .list {
    position: sticky;
    top: calc(var(--strip-height, 3.25rem) + var(--space-3));
    display: grid;
    gap: var(--space-2);
    max-height: calc(calc(100 * var(--vh)) - var(--strip-height, 3.25rem) - 2 * var(--space-3));
    grid-template-rows: auto minmax(0, 1fr);
  }
  .search {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
  }
  .search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  .list li button {
    width: 100%;
    min-height: 0;
    display: grid;
    grid-template-columns: 3.6rem 1fr auto;
    gap: var(--space-2);
    align-items: baseline;
    padding: 0.5rem var(--space-3);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .list li:last-child button {
    border-bottom: 0;
  }
  .list li button:hover {
    background: var(--surface-2);
  }
  .list li button.active {
    background: var(--accent-subtle);
    border-left-color: var(--accent);
  }
  .list b {
    font-variant-numeric: tabular-nums;
  }
  .time {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .cov {
    color: var(--text-muted);
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }
  .cov.empty {
    opacity: 0.6;
  }
  .cov.full {
    color: var(--text-secondary);
  }
  .none {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .detail {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .match-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  .title h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .title p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .title .links {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    margin-top: var(--space-1);
  }
  .nav {
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .nav:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .nav:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .compare {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) 5.5rem;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .side {
    display: grid;
    gap: 2px;
    justify-items: center;
  }
  .side span {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .side b {
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
  }
  .side small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .red-t b {
    color: var(--alliance-red-text);
  }
  .blue-t b {
    color: var(--alliance-blue-text);
  }
  .bars {
    display: grid;
    gap: var(--space-3);
  }
  .metric {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) 3rem;
    gap: var(--space-3);
    align-items: center;
  }
  .metric small {
    grid-column: 1 / -1;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.72rem;
    margin-top: -4px;
  }
  .metric .v {
    font-size: 1rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .metric .v:last-of-type {
    text-align: right;
  }
  .bar {
    display: flex;
    height: 0.55rem;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface-3);
    gap: 2px;
  }
  .bar i {
    display: block;
    height: 100%;
  }
  .bar .r {
    background: var(--alliance-red);
  }
  .bar .b {
    background: var(--alliance-blue);
  }
  .caveat {
    margin: calc(var(--space-2) * -1) 0 0;
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  .group {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
  }
  .group.official {
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .figs {
    display: grid;
    gap: 1px;
    width: min(30rem, 100%);
    margin: 0 auto;
  }
  .fig {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) 4.5rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
  }
  .fig:last-child {
    border-bottom: 0;
  }
  .fig .l {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .fig .r,
  .fig .b {
    color: var(--text-secondary);
  }
  .fig .b {
    text-align: right;
  }
  .fig .lead {
    color: var(--text);
    font-weight: 700;
  }
  .side .bonus {
    max-width: 6rem;
    text-align: center;
    line-height: 1.3;
  }
  .alliances {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    align-items: stretch;
  }
  .alliances h3 {
    margin: 0;
    padding-left: var(--space-3);
    border-left: 3px solid var(--border);
    font-size: 0.95rem;
  }
  .alliances h3.red {
    border-left-color: var(--alliance-red);
  }
  .alliances h3.blue {
    border-left-color: var(--alliance-blue);
  }

  @media (max-width: 1100px) {
    .alliances {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 800px) {
    .mv {
      grid-template-columns: 1fr;
    }
    .list {
      position: static;
      max-height: 16rem;
    }
    .compare {
      grid-template-columns: 1fr;
    }
    .side {
      grid-auto-flow: column;
      justify-content: center;
      gap: var(--space-3);
    }
  }

  /* Phone (#124) */
  @media (max-width: 900px) {
    .page-header {
      display: none;
    }
  }
  .pm {
    display: grid;
    gap: var(--space-3);
  }
  .pm-search {
    position: sticky;
    top: calc(3rem + var(--safe-top));
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    color: var(--text-muted);
  }
  .pm-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
  }
  .pm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .pm-list button {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .pm-list button.next {
    border-color: var(--accent);
  }
  .pm-top {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .pm-top b {
    font-family: var(--font-display);
    font-size: 1.05rem;
  }
  .pm-top span:nth-child(2) {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.88rem;
  }
  .pm-top .cov {
    margin-left: auto;
  }
  .pm-teams {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    white-space: pre;
    padding: 2px 8px;
    border-radius: 6px;
  }
  .pm-teams.red {
    background: var(--red-soft);
    color: var(--red-strong);
  }
  .pm-teams.blue {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }
  .pd {
    display: grid;
    gap: var(--space-3);
  }
  .pd-bar {
    position: sticky;
    top: calc(3rem + var(--safe-top));
    z-index: 3;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-1);
    padding: 4px 0;
    background: var(--background);
  }
  .pd-icon {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    color: var(--text);
  }
  .pd-icon:disabled {
    opacity: 0.4;
  }
  .pd-title h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  .pd-title small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .pd-score {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-2);
  }
  .pd-score > div:not(.pd-vs) {
    display: grid;
    justify-items: center;
    padding: var(--space-3);
    border-radius: 14px;
  }
  .pd-score span {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .pd-score b {
    font-family: var(--font-display);
    font-size: 2.2rem;
    line-height: 1.1;
  }
  .pd-score small {
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .pd-vs {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 600;
    text-align: center;
  }
  .red-t {
    background: var(--red-soft);
    color: var(--red-strong);
  }
  .blue-t {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }
  .pd-bars {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
  }
  .pd-metric {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 4px var(--space-2);
    align-items: center;
  }
  .pd-metric .bar {
    grid-column: 1 / -1;
  }
  .pd-metric .l,
  .pd-fig .l {
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.8rem;
  }
  .pd-metric .r,
  .pd-fig .r {
    color: var(--red-strong);
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .pd-metric .b,
  .pd-fig .b {
    color: var(--blue-strong);
    font-family: var(--font-mono);
    font-weight: 600;
    text-align: right;
  }
  .pd-fig {
    display: grid;
    grid-template-columns: 3rem 1fr 3rem;
    padding: 4px 0;
    border-top: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .pd-fig .lead {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .pd-seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .pd-seg button {
    min-height: var(--tap-min);
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
  }
  .pd-seg button.red.on {
    background: var(--red-soft);
    color: var(--red-strong);
  }
  .pd-seg button.blue.on {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }
  .pd-teams {
    display: grid;
    gap: var(--space-3);
  }
  .pd-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
  }
  .pd-links a {
    min-height: var(--tap-min);
    display: inline-flex;
    align-items: center;
  }
</style>
