<script>
  import { visibleInterval } from '$lib/ui/visibility.js';
  import { onMount } from 'svelte';
  import { ArrowRight, ClipboardCheck, ClipboardList, Target, Wrench } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey, lastKnownEventKey } from '$lib/scouting/scoutingEvent.js';
  import { getAuthHeader, supabase } from '$lib/app/supabase.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { userProfile } from '$lib/stores/auth.js';
  import { isPhone } from '$lib/stores/device.js';
  import {
    findNextMatch,
    formatCountdown,
    ourResults,
    scoutingCoverage,
    standingFrom,
    teamsAheadOf
  } from '$lib/matches/dashboard.js';
  import { ourTeamKey } from '$lib/stores/team.js';
  import MyAssignments from '$lib/components/scouting/MyAssignments.svelte';

  // The team this app belongs to, from Team settings.
  $: OUR_TEAM = $ourTeamKey;

  let eventKey = '';
  let configReady = false;
  let error = '';
  let matches = [];
  let rankings = [];
  let teams = [];
  let matchEntries = [];
  let pitEntries = [];
  let problems = [];
  let now = Date.now();
  let assignmentCount = 0;
  let myAssignments;
  // Each tile fills in as its own data arrives instead of waiting on the slowest request.
  let ready = { schedule: false, standing: false, coverage: false };

  $: approved =
    !$userProfile || $userProfile.role === 'admin' || ($userProfile.permissions || []).includes('CAN_SEE_ROUTES');
  $: next = findNextMatch(matches, OUR_TEAM);
  $: standing = standingFrom(rankings, OUR_TEAM);
  $: ahead = teamsAheadOf(rankings, OUR_TEAM);
  $: results = ourResults(matches, OUR_TEAM).slice(-5).reverse();
  $: coverage = scoutingCoverage({ teams, matchEntries, pitEntries, problems });
  $: countdown = next?.startsAtMs ? formatCountdown(next.startsAtMs - now) : null;

  const quick = [
    { href: '/matchscout', label: 'Scout a match', icon: ClipboardCheck },
    { href: '/pitscout', label: 'Pitscout', icon: Wrench },
    { href: '/strategy', label: 'Strategy board', icon: Target },
    { href: '/picklist', label: 'Picklist', icon: ClipboardList }
  ];

  async function startData(key) {
    ready = { schedule: false, standing: false, coverage: false };
    const q = encodeURIComponent(key);
    const current = (apply) => (value) => {
      if (key === eventKey) apply(value);
    };
    // Cached data paints at once; the fresh copy replaces it when it lands.
    const cached = (url, cacheKey, apply) =>
      fetchWithCache(url, { cacheKey, onUpdate: current(apply) })
        .then(current(apply))
        .catch(() => null);
    const headers = await getAuthHeader();
    const live = (url, apply) =>
      fetch(url, { headers })
        .then((response) => response.json())
        .then(current(apply))
        .catch(() => null);

    const schedule = cached(
      `/api/tba/event-matches?event_key=${q}&comp_level=all`,
      `event-matches:${key}:all`,
      (result) => {
        error = result?.success ? '' : result?.error || 'Could not load the match schedule from The Blue Alliance.';
        if (result?.success) matches = result.data || [];
      }
    ).then(() => {
      if (key === eventKey) ready = { ...ready, schedule: true };
    });
    const standing = cached(`/api/tba/event-rankings?event_key=${q}`, `event-rankings:${key}`, (result) => {
      if (result?.success) rankings = result.data?.rankings || [];
    }).then(() => {
      if (key === eventKey) ready = { ...ready, standing: true };
    });
    const coverage = Promise.all([
      cached(`/api/tba/event-teams?event_key=${q}`, `event-teams:${key}`, (result) => {
        if (result?.success) teams = result.data || [];
      }),
      live(`/api/matchscout?event_key=${q}&fields=coverage`, (result) => {
        if (result?.success) matchEntries = result.data || [];
      }),
      live(`/api/matchscout?resource=pit-problems&event_key=${q}`, (result) => {
        if (result?.success) problems = result.data || [];
      }),
      supabase
        .from('pit_scout_entries')
        .select('team_key')
        .eq('event_key', key)
        .then(
          current((result) => {
            pitEntries = result?.data || [];
          })
        )
    ]).then(() => {
      if (key === eventKey) ready = { ...ready, coverage: true };
    });
    await Promise.all([schedule, standing, coverage]);
  }

  async function load() {
    // Start from the event this browser last saw, in parallel with confirming it.
    const remembered = lastKnownEventKey();
    const confirmed = fetchActiveScoutingEventKey();
    if (remembered && !eventKey) {
      eventKey = remembered;
      configReady = true;
      void startData(remembered);
    }
    const fresh = (await confirmed) || '';
    configReady = true;
    if (fresh === eventKey) return;
    eventKey = fresh;
    if (fresh) await startData(fresh);
  }

  async function refresh() {
    myAssignments?.refresh();
    if (eventKey) await startData(eventKey);
  }

  onMount(() => {
    void load();
    const tick = setInterval(() => {
      now = Date.now();
    }, 30000);
    const stopPoll = visibleInterval(() => void refresh(), 120000); // paused while the tab is hidden
    return () => {
      clearInterval(tick);
      stopPoll();
    };
  });

  const teamNumber = (key) => String(key).replace(/^frc/, '');
</script>

<svelte:head><title>Home</title></svelte:head>

{#if !approved}
  <p class="banner" role="status">
    Your account is waiting for an admin to approve it. Scouting data will appear once you are approved.
  </p>
{/if}

{#if !configReady}
  <div class="grid" aria-busy="true" aria-label="Loading the event">
    <div class="tile next">
      <span class="sk sk-label"></span><span class="sk sk-big"></span><span class="sk sk-line"></span>
    </div>
    <div class="tile">
      <span class="sk sk-label"></span><span class="sk sk-big"></span><span class="sk sk-line"></span>
    </div>
    <div class="tile">
      <span class="sk sk-label"></span><span class="sk sk-big"></span><span class="sk sk-line"></span>
    </div>
    <div class="tile">
      <span class="sk sk-label"></span><span class="sk sk-big"></span><span class="sk sk-line"></span>
    </div>
  </div>
{:else if !eventKey}
  <div class="empty">
    <h2>No active event</h2>
    <p>An admin picks the event the team is scouting in <a href="/scouting-admin">Scouting Admin</a>.</p>
  </div>
{:else if $isPhone}
  <!-- Phone (#124): one screen, no scrolling. Every block shares the visible height, and sizes
       follow the phone's own height and width. -->
  <div class="ph-home">
    <a class={`ph-hero ${next?.ourColor || ''}`} href={next ? '/driveteam' : '/strategy'} aria-label="Next match">
      <span class="ph-label">Next match<span class="mono">{eventKey}</span></span>
      {#if error}
        <span class="ph-sub">{error}</span>
      {:else if !ready.schedule}
        <span class="sk sk-big"></span><span class="sk sk-line"></span>
      {:else if next}
        <b class="ph-big">{next.label}</b>
        <span class="ph-count"
          >{countdown ? (countdown === 'now' ? 'Starting now' : `in ${countdown}`) : 'Time not posted yet'}</span
        >
        <span class="ph-vs">
          <span class={`ph-side ${next.ourColor}`}
            ><small>We are {next.ourColor} with</small><b>{next.partners.map(teamNumber).join(' · ') || '—'}</b></span
          >
          <span class={`ph-side ${next.ourColor === 'red' ? 'blue' : 'red'}`}
            ><small>Against</small><b>{next.opponents.map(teamNumber).join(' · ')}</b></span
          >
        </span>
      {:else}
        <b class="ph-big">No upcoming match</b>
        <span class="ph-sub">Nothing left on our schedule, or it is not posted yet.</span>
      {/if}
    </a>

    <div class="ph-assign" aria-label="Your next assignment">
      <MyAssignments bind:count={assignmentCount} {eventKey} limit={1} moreHref="/myscout" />
    </div>

    <div class="ph-pair">
      <a class="ph-tile" href="/bluealliance">
        <span class="ph-label">Standing</span>
        {#if !ready.standing}<span class="sk sk-big"></span>
        {:else if standing}
          <b class="ph-mid">#{standing.rank}<small>/{standing.totalTeams}</small></b>
          <span class="ph-sub mono">{standing.wins}-{standing.losses}-{standing.ties}</span>
        {:else}<b class="ph-mid">—</b><span class="ph-sub">Not ranked yet</span>{/if}
      </a>
      <a class="ph-tile" href="/strategy">
        <span class="ph-label">Scouted</span>
        {#if !ready.coverage}<span class="sk sk-big"></span>
        {:else}
          <b class="ph-mid">{coverage.percentScouted ?? 0}%</b>
          <span
            class="bar"
            role="progressbar"
            aria-valuenow={coverage.percentScouted ?? 0}
            aria-valuemin="0"
            aria-valuemax="100"><span style={`width:${coverage.percentScouted ?? 0}%`}></span></span
          >
          <span class="ph-sub mono"
            >{coverage.teamsScouted}/{coverage.teamsTotal} teams{coverage.openProblems
              ? ` · ${coverage.openProblems} pit issue${coverage.openProblems === 1 ? '' : 's'}`
              : ''}</span
          >
        {/if}
      </a>
    </div>

    <div class="ph-results" aria-label="Our recent matches">
      <span class="ph-label">Recent</span>
      {#if !ready.schedule}<span class="sk sk-line"></span>
      {:else if results.length}
        <ul>
          {#each results as result}<li class={`r-${result.result}`}>
              <b>{result.result}</b><span>{result.label}</span><span class="mono">{result.ours}-{result.theirs}</span>
            </li>{/each}
        </ul>
      {:else}<span class="ph-sub">No results yet</span>{/if}
    </div>

    <nav class="ph-quick" aria-label="Quick actions">
      {#each quick as action}
        <a href={action.href}
          ><svelte:component this={action.icon} size={22} /><span
            >{action.label.replace('Scout a match', 'Scout').replace(' board', '')}</span
          ></a
        >
      {/each}
    </nav>
  </div>
{:else}
  {#if error}<p class="banner warn" role="alert">{error}</p>{/if}

  <div class="grid">
    <section class="tile next" aria-label="Next match">
      <header><span class="label">Next match</span><span class="tag mono">{eventKey}</span></header>
      {#if !ready.schedule}
        <span class="sk sk-big"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>
      {:else if next}
        <p class="big">{next.label}</p>
        <p class="sub">
          {countdown
            ? countdown === 'now'
              ? 'Starting now'
              : `in ${countdown}`
            : 'Time not posted yet'}{next.matchesAway
            ? ` · ${next.matchesAway} match${next.matchesAway === 1 ? '' : 'es'} after the one before it`
            : ''}
        </p>
        <div class="alliances">
          <div class="alliance {next.ourColor}">
            <span>We are {next.ourColor}</span><b>{next.partners.map(teamNumber).join(' · ') || 'no partners listed'}</b
            >
          </div>
          <div class="alliance {next.ourColor === 'red' ? 'blue' : 'red'}">
            <span>Against</span><b>{next.opponents.map(teamNumber).join(' · ')}</b>
          </div>
        </div>
      {:else}
        <p class="big">No upcoming match</p>
        <p class="sub">Nothing left on our schedule, or it is not posted yet.</p>
      {/if}
    </section>

    <section class="tile assignments" aria-label="Your assignments">
      <header>
        <span class="label">Your assignments</span>{#if assignmentCount}<span class="tag mono"
            >{assignmentCount} open</span
          >{/if}
      </header>
      <MyAssignments bind:this={myAssignments} bind:count={assignmentCount} {eventKey} limit={20} moreHref="/myscout" />
    </section>

    <section class="tile half" aria-label="Standing">
      <header><span class="label">Standing</span></header>
      {#if !ready.standing}
        <span class="sk sk-big"></span><span class="sk sk-line"></span>
      {:else if standing}
        <p class="big">#{standing.rank}<small> of {standing.totalTeams}</small></p>
        <p class="sub mono">
          {standing.wins}-{standing.losses}-{standing.ties}{standing.matchesPlayed != null
            ? ` · ${standing.matchesPlayed} played`
            : ''}
        </p>
        {#if ahead.length}<p class="ahead">
            Chasing {ahead.map((team) => `${teamNumber(team.teamKey)} (#${team.rank})`).join(', ')}
          </p>{/if}
      {:else}<p class="sub">We are not ranked yet.</p>{/if}
    </section>

    <section class="tile half" aria-label="Scouting coverage">
      <header><span class="label">Scouting coverage</span></header>
      {#if !ready.coverage}
        <span class="sk sk-big"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>
      {:else}
        <p class="big">{coverage.percentScouted ?? 0}%<small> of teams</small></p>
        <div
          class="bar"
          role="progressbar"
          aria-valuenow={coverage.percentScouted ?? 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span style={`width:${coverage.percentScouted ?? 0}%`}></span>
        </div>
        <p class="sub mono">
          {coverage.teamsScouted}/{coverage.teamsTotal} teams · {coverage.matchReports} match reports · {coverage.pitProfiles}
          pits
        </p>
        {#if coverage.openProblems}<p class="ahead">
            <a href="/pitscout">{coverage.openProblems} open pit problem{coverage.openProblems === 1 ? '' : 's'}</a>
          </p>{/if}
      {/if}
    </section>

    <section class="tile results" aria-label="Our results">
      <header><span class="label">Our recent matches</span></header>
      {#if !ready.schedule}
        <span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>
      {:else if results.length}
        <ul>
          {#each results as result}<li>
              <span>{result.label}</span><b class={`r-${result.result}`}>{result.result}</b><span class="mono"
                >{result.ours} - {result.theirs}</span
              >
            </li>{/each}
        </ul>
      {:else}<p class="sub">No results yet.</p>{/if}
    </section>
  </div>

  <nav class="quick" aria-label="Quick actions">
    {#each quick as action}
      <a href={action.href}
        ><svelte:component this={action.icon} size={20} /><span>{action.label}</span><ArrowRight size={16} /></a
      >
    {/each}
  </nav>
{/if}

<style>
  .sk {
    display: block;
    border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
  }
  .sk-label {
    height: 0.8rem;
    width: 35%;
  }
  .sk-big {
    height: 2.4rem;
    width: 55%;
  }
  .sk-line {
    height: 0.9rem;
    width: 85%;
  }
  .sk-line.short {
    width: 55%;
  }
  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk {
      animation: none;
    }
  }
  .banner {
    margin: 0 0 var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--accent-subtle);
    color: var(--accent-strong);
    border: 1px solid var(--accent);
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warning) 15%, transparent);
    color: var(--text);
    border-color: var(--warning);
  }
  .empty {
    padding: var(--space-6);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    text-align: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: var(--space-4);
  }
  .tile {
    grid-column: span 6;
    padding: var(--space-5);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  .tile.next {
    grid-column: span 12;
    border-top: 3px solid var(--accent);
  }
  .tile.results,
  .tile.assignments {
    grid-column: span 12;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: var(--space-1);
  }
  .label {
    font-family: var(--font-display);
    font-size: 0.85rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tag {
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .big {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
    font-family: var(--font-display);
    font-size: 2.8rem;
    line-height: 1.05;
    font-weight: 600;
  }
  .big small {
    font-family: var(--font-body);
    font-size: 1rem;
    line-height: 1;
    color: var(--text-muted);
    font-weight: 500;
    letter-spacing: 0;
  }
  .sub {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .ahead {
    margin: 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .alliances {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }
  .alliance {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    display: grid;
    gap: 4px;
    font-size: 0.95rem;
  }
  .alliance span {
    color: var(--text-secondary);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .alliance b {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .alliance.red {
    background: var(--red-soft);
    color: var(--red-strong);
  }
  .alliance.blue {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }
  .alliance.red span,
  .alliance.blue span {
    color: inherit;
    opacity: 0.8;
  }
  .bar {
    height: 0.5rem;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  li {
    display: grid;
    grid-template-columns: 1fr 2rem auto;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  li:last-child {
    border-bottom: 0;
  }
  .r-W {
    color: var(--success);
  }
  .r-L {
    color: var(--danger);
  }
  .r-T {
    color: var(--text-muted);
  }
  .quick {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .quick a {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    text-decoration: none;
    font-family: var(--font-display);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .quick a span {
    flex: 1;
  }
  .quick a:hover {
    border-color: var(--accent);
    color: var(--accent-strong);
  }
  @media (max-width: 900px) {
    .tile {
      grid-column: span 12;
      padding: var(--space-4);
    }
    .quick {
      grid-template-columns: repeat(2, 1fr);
    }
    .alliances {
      grid-template-columns: 1fr;
    }
    .big {
      font-size: 2.1rem;
    }
  }

  /* Phone Home (#124): fills exactly the visible screen. */
  .ph-home {
    --gap: clamp(8px, 1.4 * var(--vh), 14px);
    height: var(--screen-avail);
    min-height: 26rem;
    display: grid;
    grid-template-rows: minmax(0, 1.55fr) auto minmax(0, 1fr) auto auto;
    gap: var(--gap);
  }
  .ph-home a {
    color: var(--text);
    text-decoration: none;
  }
  .ph-label {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ph-label .mono {
    letter-spacing: 0.04em;
  }
  .ph-sub {
    color: var(--text-secondary);
    font-size: 0.85rem;
    line-height: 1.35;
  }
  .ph-hero {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--gap);
    min-height: 0;
    padding: clamp(12px, 2 * var(--vh), 20px);
    border: 1px solid var(--border);
    border-top: 3px solid var(--accent);
    border-radius: 16px;
    background: var(--surface-1);
    overflow: hidden;
  }
  .ph-hero.red {
    border-top-color: var(--red-base);
  }
  .ph-hero.blue {
    border-top-color: var(--blue-base);
  }
  .ph-big {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1;
    font-size: clamp(1.7rem, min(5.4 * var(--vh), 10vw), 2.8rem);
  }
  .ph-count {
    font-family: var(--font-mono);
    font-size: clamp(1rem, 2.4 * var(--vh), 1.35rem);
    color: var(--accent-strong);
  }
  .ph-vs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .ph-side {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: clamp(6px, 1.2 * var(--vh), 12px) 10px;
    border-radius: 10px;
  }
  .ph-side small {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.85;
  }
  .ph-side b {
    font-family: var(--font-mono);
    font-size: clamp(0.95rem, 2.2 * var(--vh), 1.2rem);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ph-side.red {
    background: var(--red-soft);
    color: var(--red-strong);
  }
  .ph-side.blue {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }
  .ph-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap);
    min-height: 0;
  }
  .ph-tile {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 4px;
    min-height: 0;
    padding: clamp(10px, 1.6 * var(--vh), 16px);
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface-1);
    overflow: hidden;
  }
  .ph-mid {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1;
    font-size: clamp(1.6rem, min(4.6 * var(--vh), 9vw), 2.5rem);
  }
  .ph-mid small {
    font-size: 0.5em;
    color: var(--text-muted);
    font-weight: 500;
  }
  .ph-results {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
  }
  .ph-results ul {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ph-results li {
    flex: none;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 6px;
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 0.8rem;
    border-bottom: 0;
  }
  .ph-results li b {
    grid-row: span 2;
    align-self: center;
    font-size: 1.1rem;
  }
  .ph-results li.r-W b {
    color: var(--success);
  }
  .ph-results li.r-L b {
    color: var(--danger);
  }
  .ph-quick {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }
  .ph-quick a {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 4px;
    min-height: clamp(56px, 8 * var(--vh), 72px);
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .ph-quick a :global(svg) {
    color: var(--accent-strong);
  }
  .ph-home a:active {
    transform: scale(0.985);
  }
  /* Very short screens (landscape, small phones): drop the least important line. */
  .ph-assign :global(.more) {
    margin-top: 4px;
  }
  @media (max-height: 600px) {
    .ph-results {
      display: none;
    }
    .ph-home {
      grid-template-rows: minmax(0, 1.55fr) auto minmax(0, 1fr) auto;
    }
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .ph-side b {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
