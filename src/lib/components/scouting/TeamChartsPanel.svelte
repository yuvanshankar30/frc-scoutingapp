<script>
  // Team View's chart section: a team's Match Scouting reports drawn per match and against the rest
  // of the event, in tabs so a phone shows one group at a time. The maths is in teamCharts.js.
  import BoxCompare from '$lib/components/charts/BoxCompare.svelte';
  import CountBars from '$lib/components/charts/CountBars.svelte';
  import LineChart from '$lib/components/charts/LineChart.svelte';
  import PercentileBars from '$lib/components/charts/PercentileBars.svelte';
  import StatusStrip from '$lib/components/charts/StatusStrip.svelte';
  import {
    answerCounts,
    boxStats,
    officialScores,
    percentileProfile,
    perMatchSeries,
    playedMatchKeys,
    reliabilityTimeline,
    teamAverages
  } from '$lib/scouting/teamCharts.js';
  import { mean } from '$lib/stats.js';

  export let teamKey = '';
  /** Every match report at the event (all teams), for event comparisons. */
  export let allEntries = [];
  /** TBA matches at the event. */
  export let matches = [];

  const TABS = [
    { key: 'scoring', label: 'Scoring' },
    { key: 'ratings', label: 'Ratings' },
    { key: 'robot', label: 'Robot' },
    { key: 'tendencies', label: 'Tendencies' },
    { key: 'event', label: 'vs Event' }
  ];
  const BLUE = 'var(--chart-blue)';
  const ORANGE = 'var(--chart-orange)';
  const GREEN = 'var(--chart-success)';
  const PURPLE = 'var(--chart-purple)';
  const TEAL = 'var(--chart-teal)';
  const RED = 'var(--chart-danger)';

  let tab = 'scoring';

  const key = (value) => {
    const digits = String(value || '')
      .replace(/^frc/i, '')
      .replace(/\D/g, '');
    return digits ? `frc${Number(digits)}` : '';
  };
  $: mine = (allEntries || []).filter((row) => key(row?.team_key) === key(teamKey));
  $: played = playedMatchKeys(matches, teamKey);
  $: series = (metric) => perMatchSeries(mine, metric, played);
  $: balls = series('ballsScored');
  $: auto = series('autoPoints');
  $: ballsEvent = teamAverages(allEntries, 'ballsScored');
  $: autoEvent = teamAverages(allEntries, 'autoPoints');
  $: ballsBox = boxStats(balls.map((point) => point.value));
  $: ballsEventBox = boxStats([...ballsEvent.values()]);
  $: autoBox = boxStats(auto.map((point) => point.value));
  $: autoEventBox = boxStats([...autoEvent.values()]);
  $: official = officialScores(matches, teamKey);
  $: ratingSeries = [
    { name: 'Shot accuracy', color: BLUE, points: series('accuracy') },
    { name: 'BPS', color: ORANGE, points: series('bps') },
    { name: 'Driver skill', color: GREEN, points: series('driverSkill') },
    { name: 'Intake speed', color: PURPLE, points: series('intakeSpeed') }
  ];
  $: playSeries = [
    { name: 'Offense', color: TEAL, points: series('offense') },
    { name: 'Defense', color: RED, points: series('defense') }
  ];
  $: reliability = reliabilityTimeline(mine, played);
  $: fouls = series('fouls');
  $: profile = percentileProfile(teamKey, allEntries);
  $: reports = mine.length;
</script>

<section class="card charts-panel" aria-labelledby="charts-heading">
  <div class="head">
    <div>
      <h3 id="charts-heading">Charts</h3>
      <p>
        From {reports} match report{reports === 1 ? '' : 's'} on this team{played.length
          ? `, ${played.length} matches played`
          : ''}. Tap a chart to read a match.
      </p>
    </div>
  </div>
  <div class="tabs" role="tablist" aria-label="Chart groups">
    {#each TABS as item (item.key)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === item.key}
        class:active={tab === item.key}
        on:click={() => (tab = item.key)}>{item.label}</button
      >
    {/each}
  </div>

  {#if tab === 'scoring'}
    <div class="grid">
      <figure class="tile">
        <h4>Scoring per match</h4>
        <LineChart
          ariaLabel="Teleop balls scored and auto points per match"
          series={[
            { name: 'Teleop balls', color: BLUE, points: balls },
            { name: 'Auto points', color: ORANGE, points: auto }
          ]}
          reference={{ value: mean([...ballsEvent.values()]), label: 'Event avg balls' }}
        />
      </figure>
      <figure class="tile">
        <h4>Teleop balls: consistency</h4>
        <BoxCompare
          team={ballsBox}
          event={ballsEventBox}
          teamLabel="This team, per match"
          eventLabel="Every team's average"
        />
        <h4 class="sub">Auto points: consistency</h4>
        <BoxCompare
          team={autoBox}
          event={autoEventBox}
          teamLabel="This team, per match"
          eventLabel="Every team's average"
        />
      </figure>
      <figure class="tile wide">
        <h4>Alliance score (The Blue Alliance) next to what we scouted</h4>
        <LineChart
          ariaLabel="Official alliance score and scouted balls per match"
          digits={0}
          series={[
            { name: 'Alliance score', color: GREEN, points: official },
            { name: 'Scouted balls', color: BLUE, points: balls }
          ]}
        />
      </figure>
    </div>
  {:else if tab === 'ratings'}
    <div class="grid">
      <figure class="tile">
        <h4>Ratings per match (1–5)</h4>
        <LineChart ariaLabel="Performance ratings per match" max={5} series={ratingSeries} />
      </figure>
      <figure class="tile">
        <h4>Offense and defense (1–5)</h4>
        <LineChart ariaLabel="Offense and defense ratings per match" max={5} series={playSeries} />
      </figure>
    </div>
  {:else if tab === 'robot'}
    <div class="grid">
      <figure class="tile wide">
        <h4>Robot condition by match</h4>
        <StatusStrip rows={reliability} />
      </figure>
      <figure class="tile">
        <h4>Fouls per match</h4>
        <LineChart ariaLabel="Fouls per match" digits={0} series={[{ name: 'Fouls', color: RED, points: fouls }]} />
      </figure>
    </div>
  {:else if tab === 'tendencies'}
    <div class="grid">
      <figure class="tile">
        <h4>Teleop roles</h4>
        <CountBars rows={answerCounts(mine, 'teleop_roles')} color={BLUE} />
      </figure>
      <figure class="tile">
        <h4>Starting position</h4>
        <CountBars rows={answerCounts(mine, 'starting_position')} color={ORANGE} />
      </figure>
      <figure class="tile">
        <h4>Auto fuel sources</h4>
        <CountBars rows={answerCounts(mine, 'ball_sources')} color={GREEN} />
      </figure>
      <figure class="tile">
        <h4>Auto start zone</h4>
        <CountBars rows={answerCounts(mine, 'auto_start_zone')} color={PURPLE} />
      </figure>
    </div>
  {:else}
    <figure class="tile">
      <h4>Percentile among teams at this event</h4>
      <PercentileBars rows={profile} />
    </figure>
  {/if}
</section>

<style>
  .charts-panel {
    display: grid;
    gap: var(--space-3);
  }
  .head h3 {
    margin: 0;
  }
  .head p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    font-size: 0.88rem;
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    scroll-snap-type: x proximity;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    flex: none;
    scroll-snap-align: start;
    min-height: 2.75rem;
    padding: 0 var(--space-4);
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .tile {
    margin: 0;
    display: grid;
    gap: var(--space-2);
    align-content: start;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  .tile.wide {
    grid-column: 1 / -1;
  }
  h4 {
    margin: 0;
    font-size: 0.95rem;
  }
  h4.sub {
    margin-top: var(--space-3);
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
