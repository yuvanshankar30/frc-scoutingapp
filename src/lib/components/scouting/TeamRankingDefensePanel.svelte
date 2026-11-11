<script>
  // Scouting Admin > Data: every robot's average power-ranking place from Performance scouting next to how
  // it plays and resists defense from Data scouting, in one compact sortable list. See defenseStats.js for the math.
  import Select from '$lib/components/common/Select.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { averagePowerRankings } from '$lib/scouting/powerRankingAverages.js';
  import { defenseSummary } from '$lib/scouting/defenseStats.js';
  import { reportKindOf } from '$lib/scouting/reportKinds.js';

  export let reports = [];

  const SORTS = [
    { key: 'rank', label: 'Power rank', better: 'low' },
    { key: 'playedRating', label: 'Defense', better: 'high' },
    { key: 'impact', label: 'Impact', better: 'high' },
    { key: 'resistance', label: 'Resists', better: 'high' },
    { key: 'keptShare', label: 'Kept', better: 'high' }
  ];
  let sortKey = 'rank';

  $: power = averagePowerRankings(reports.filter((row) => reportKindOf(row) === 'performance')).teams;
  $: defense = defenseSummary(reports);
  $: rows = (() => {
    const byTeam = new Map();
    const row = (team_key) => {
      if (!byTeam.has(team_key)) byTeam.set(team_key, { team_key });
      return byTeam.get(team_key);
    };
    for (const team of power) Object.assign(row(team.team_key), { rank: team.average, rankMatches: team.matches });
    for (const team of defense) Object.assign(row(team.team_key), team);
    const sort = SORTS.find((entry) => entry.key === sortKey);
    const value = (entry) => entry[sortKey] ?? null;
    return [...byTeam.values()].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      if (a === null && b === null) return Number(team(left.team_key)) - Number(team(right.team_key));
      if (a === null) return 1;
      if (b === null) return -1;
      return sort.better === 'low' ? a - b : b - a;
    });
  })();

  const team = (key) => String(key || '').replace(/^frc/, '');
  const show = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);
</script>

<section class="trd">
  <header class="trd-head">
    <div>
      <h3>Power rankings and defense</h3>
      <p>
        Average power-rank place from Performance scouting (1 = best), and defense from Data scouting: the 1-10
        effectiveness, how much less its targets scored (impact), how well it resists defense (10 minus the rating
        against it) and the share of its usual scoring it kept when defended.
      </p>
    </div>
    {#if $isPhone}
      <label class="trd-ph-sort"
        >Sort by
        <Select class="form-select" bind:value={sortKey}>
          {#each SORTS as sort (sort.key)}<option value={sort.key}>{sort.label}</option>{/each}
        </Select>
      </label>
    {:else}
      <div class="trd-sort" role="group" aria-label="Sort by">
        {#each SORTS as sort (sort.key)}
          <button
            class="btn btn-sm"
            class:btn-primary={sortKey === sort.key}
            aria-pressed={sortKey === sort.key}
            on:click={() => (sortKey = sort.key)}>{sort.label}</button
          >
        {/each}
      </div>
    {/if}
  </header>
  {#if !rows.length}
    <p class="trd-empty">No power rankings or defense reports for this event yet.</p>
  {:else if $isPhone}
    <ul class="trd-cards">
      {#each rows as row (row.team_key)}
        <li>
          <b class="trd-team">{team(row.team_key)}</b>
          <dl>
            <div>
              <dt>Power rank</dt>
              <dd>{show(row.rank)}<small>{row.rankMatches || 0} m</small></dd>
            </div>
            <div>
              <dt>Defense</dt>
              <dd>{show(row.playedRating, '/10')}<small>{row.played || 0} m</small></dd>
            </div>
            <div>
              <dt>Impact</dt>
              <dd>{show(row.impact, '%')}</dd>
            </div>
            <div>
              <dt>Resists</dt>
              <dd>{show(row.resistance, '/10')}<small>{row.faced || 0} m</small></dd>
            </div>
            <div>
              <dt>Kept</dt>
              <dd>{show(row.keptShare, '%')}</dd>
            </div>
          </dl>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="trd-table-wrap">
      <table class="trd-table">
        <thead>
          <tr>
            <th>Team</th>
            <th>Avg power rank</th>
            <th>Matches ranked</th>
            <th>Defense played (1-10)</th>
            <th>Defense impact</th>
            <th>Matches defending</th>
            <th>Defense resistance</th>
            <th>Scoring kept when defended</th>
            <th>Matches defended</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.team_key)}
            <tr>
              <td class="trd-team">{team(row.team_key)}</td>
              <td>{show(row.rank)}</td>
              <td>{row.rankMatches || 0}</td>
              <td>{show(row.playedRating)}</td>
              <td>{show(row.impact, '%')}</td>
              <td>{row.played || 0}</td>
              <td>{show(row.resistance)}</td>
              <td
                >{show(row.keptShare, '%')}{#if row.ballsDefended !== null && row.ballsDefended !== undefined}<small>
                    {row.ballsDefended} vs {show(row.ballsUndefended)} balls</small
                  >{/if}</td
              >
              <td>{row.faced || 0}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .trd {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .trd-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .trd-head h3 {
    margin: 0 0 0.25rem;
  }
  .trd-head p {
    margin: 0;
    max-width: 52rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .trd-sort {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: flex-start;
  }
  .trd-ph-sort {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--gap-2);
    align-items: center;
    width: 100%;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .trd-empty {
    margin: 0;
    color: var(--text-muted);
  }
  .trd-table-wrap {
    max-height: 26rem;
    overflow: auto;
  }
  .trd-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .trd-table th,
  .trd-table td {
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
    text-align: right;
    white-space: nowrap;
  }
  .trd-table th {
    position: sticky;
    top: 0;
    background: var(--surface-1);
    color: var(--text-muted);
    font-weight: 600;
  }
  .trd-table th:first-child,
  .trd-table td:first-child {
    text-align: left;
  }
  .trd-table small {
    display: block;
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .trd-team {
    font-weight: 700;
  }
  .trd-cards {
    display: grid;
    gap: var(--gap-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .trd-cards li {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: var(--gap-2);
    align-items: center;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .trd-cards dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.25rem;
    margin: 0;
  }
  .trd-cards dt {
    color: var(--text-muted);
    font-size: 0.65rem;
  }
  .trd-cards dd {
    margin: 0;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .trd-cards small {
    display: block;
    color: var(--text-muted);
    font-size: 0.65rem;
    font-weight: 400;
  }
</style>
