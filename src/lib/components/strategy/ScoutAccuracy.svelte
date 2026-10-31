<script>
  // Strategy > Scout accuracy: our match scouting added up per alliance and checked against TBA's official
  // breakdown (see src/lib/scouting/scoutAccuracy.js). Phones get cards and a Alliances/Scouts switch instead
  // of the two tables.
  import Select from '$lib/components/common/Select.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { matchLabel } from '$lib/matches/matchKeys.js';
  import { buildScoutAccuracy } from '$lib/scouting/scoutAccuracy.js';

  export let matches = [];
  export let entries = [];

  let sort = 'miss';
  let show = 'complete';
  let phoneList = 'alliances';

  $: accuracy = buildScoutAccuracy(matches, entries);
  $: summary = accuracy.summary;
  $: rows = accuracy.alliances
    .filter((row) => show === 'all' || row.fuel.complete)
    .slice()
    .sort((a, b) => (sort === 'miss' ? Math.abs(b.fuel.error ?? -Infinity) - Math.abs(a.fuel.error ?? -Infinity) : 0));

  const team = (key) => String(key || '').replace(/^frc/i, '');
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
  const whole = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '—');
  const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${Math.round(value)}` : '—');
  const r = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
  // How close a ratio is to 100%: within 15% is good, within 30% fair, anything further is off.
  const band = (ratio) =>
    !Number.isFinite(ratio) ? '' : Math.abs(ratio - 1) <= 0.15 ? 'good' : Math.abs(ratio - 1) <= 0.3 ? 'fair' : 'off';
</script>

<section class="accuracy" aria-labelledby="scout-accuracy-title">
  <header class="intro">
    <h2 id="scout-accuracy-title">Scout accuracy</h2>
    <p>
      Each played match, the three robots' scouted numbers are added up per alliance and checked against The Blue
      Alliance's official breakdown. Only alliances with all three robots scouted count toward the totals.
    </p>
  </header>

  {#if !summary.alliances}
    <div class="empty-state">No played matches with official results yet.</div>
  {:else}
    <div class="tiles">
      <div class="tile">
        <span class="k">Fuel counted</span>
        <strong class={band(summary.fuel.captured)}>{pct(summary.fuel.captured)}</strong>
        <small
          >of TBA's fuel · off by {whole(summary.fuel.meanAbsError)} per alliance · r {r(summary.fuel.correlation)} ·
          {summary.fuel.checked} alliances</small
        >
      </div>
      <div class="tile">
        <span class="k">Auto points</span>
        <strong class={band(summary.auto.captured)}>{pct(summary.auto.captured)}</strong>
        <small
          >of TBA's auto points · off by {whole(summary.auto.meanAbsError)} per alliance · {summary.auto.checked} alliances</small
        >
      </div>
      <div class="tile">
        <span class="k">Winner from scouting</span>
        <strong>{pct(summary.winner.rate)}</strong>
        <small
          >{summary.winner.checked
            ? `${summary.winner.agreed} of ${summary.winner.checked} fully scouted matches: more scouted fuel = the winner`
            : 'Needs both alliances fully scouted'}</small
        >
      </div>
      <div class="tile">
        <span class="k">Fouls</span>
        {#if summary.fouls.checked}
          <strong>{signed(summary.fouls.meanError)}</strong>
          <small>fouls per alliance vs TBA · {summary.fouls.checked} alliances</small>
        {:else}
          <strong class="muted">—</strong>
          <small>Needs Robot reports on all three robots of an alliance</small>
        {/if}
      </div>
    </div>

    {#if $isPhone}
      <div class="ph-seg" role="tablist" aria-label="Scout accuracy">
        <button
          role="tab"
          aria-selected={phoneList === 'alliances'}
          class:on={phoneList === 'alliances'}
          on:click={() => (phoneList = 'alliances')}>Alliances</button
        >
        <button
          role="tab"
          aria-selected={phoneList === 'scouts'}
          class:on={phoneList === 'scouts'}
          on:click={() => (phoneList = 'scouts')}>Scouts</button
        >
      </div>
    {/if}

    {#if !$isPhone || phoneList === 'alliances'}
      <div class="section-head">
        <h3>By alliance</h3>
        <div class="controls">
          <Select bind:value={show} compact aria-label="Which alliances">
            <option value="complete">All three robots scouted</option>
            <option value="all">Every alliance</option>
          </Select>
          <Select bind:value={sort} compact aria-label="Sort alliances">
            <option value="miss">Biggest miss first</option>
            <option value="order">Match order</option>
          </Select>
        </div>
      </div>
      {#if !rows.length}
        <p class="muted">No alliance has all three robots scouted yet. Switch to every alliance to see partial ones.</p>
      {:else if $isPhone}
        <ul class="ph-cards">
          {#each rows as row (row.matchKey + row.side)}
            <li class={row.side}>
              <div class="ph-top">
                <b>{matchLabel(row.matchKey)}</b><span class="teams">{row.teams.map(team).join(' · ')}</span>
              </div>
              <div class="ph-nums">
                <span
                  ><small>Scouted fuel</small><b
                    >{row.fuel.complete ? whole(row.fuel.scouted) : `${whole(row.fuel.partial)}*`}</b
                  ></span
                >
                <span><small>TBA fuel</small><b>{whole(row.fuel.tba)}</b></span>
                <span><small>Counted</small><b class={band(row.fuel.ratio)}>{pct(row.fuel.ratio)}</b></span>
                <span><small>Auto</small><b>{whole(row.auto.scouted)} / {whole(row.auto.tba)}</b></span>
              </div>
              {#if row.missing.fuel.length}<small class="missing"
                  >* Not scouted: {row.missing.fuel.map(team).join(', ')}</small
                >{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Alliance</th>
                <th class="num">Scouted fuel</th>
                <th class="num">TBA fuel</th>
                <th class="num">Miss</th>
                <th>Counted</th>
                <th class="num">Auto (scouted / TBA)</th>
                <th class="num">Fouls (scouted / TBA)</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.matchKey + row.side)}
                <tr>
                  <td>{matchLabel(row.matchKey)}</td>
                  <td
                    ><span class="alliance {row.side}">{row.teams.map(team).join(' · ')}</span
                    >{#if row.missing.fuel.length}<small class="missing"
                        >Not scouted: {row.missing.fuel.map(team).join(', ')}</small
                      >{/if}</td
                  >
                  <td class="num">{row.fuel.complete ? whole(row.fuel.scouted) : `${whole(row.fuel.partial)}*`}</td>
                  <td class="num">{whole(row.fuel.tba)}</td>
                  <td class="num">{signed(row.fuel.error)}</td>
                  <td>
                    {#if Number.isFinite(row.fuel.ratio)}
                      <span class="bar" aria-hidden="true"
                        ><span class={band(row.fuel.ratio)} style={`width:${Math.min(100, row.fuel.ratio * 100)}%`}
                        ></span></span
                      ><span class={band(row.fuel.ratio)}>{pct(row.fuel.ratio)}</span>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                  <td class="num">{whole(row.auto.scouted)} / {whole(row.auto.tba)}</td>
                  <td class="num">{whole(row.fouls.scouted)} / {whole(row.fouls.tba)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="note">* Robots nobody scouted are missing from the sum, so partial alliances read low.</p>
      {/if}
    {/if}

    {#if !$isPhone || phoneList === 'scouts'}
      <div class="section-head">
        <h3>By scout</h3>
      </div>
      <p class="muted explain">
        <b>Alliance fuel counted</b>: the median share of TBA's fuel the alliances this scout worked on added up to.
        <b>Vs other scouts</b>: on robots someone else also scouted, how many more (+) or fewer (−) balls this scout
        counted, on average.
      </p>
      {#if $isPhone}
        <ul class="ph-cards">
          {#each accuracy.scouts as scout (scout.name)}
            <li>
              <div class="ph-top"><b>{scout.name}</b><span class="teams">{scout.reports} reports</span></div>
              <div class="ph-nums">
                <span
                  ><small>Alliance fuel counted</small><b class={band(scout.captured)}>{pct(scout.captured)}</b></span
                >
                <span
                  ><small>Vs other scouts</small><b
                    >{scout.comparisons ? `${signed(scout.bias)} (${scout.comparisons})` : '—'}</b
                  ></span
                >
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scout</th>
                <th class="num">Reports</th>
                <th class="num">Alliances checked</th>
                <th class="num">Alliance fuel counted</th>
                <th class="num">Vs other scouts</th>
                <th class="num">Typical gap</th>
              </tr>
            </thead>
            <tbody>
              {#each accuracy.scouts as scout (scout.name)}
                <tr>
                  <td>{scout.name}</td>
                  <td class="num">{scout.reports}</td>
                  <td class="num">{scout.checked || '—'}</td>
                  <td class="num"><span class={band(scout.captured)}>{pct(scout.captured)}</span></td>
                  <td class="num"
                    >{scout.comparisons ? `${signed(scout.bias)} balls (${scout.comparisons} robots)` : '—'}</td
                  >
                  <td class="num">{scout.comparisons ? `±${whole(scout.spread)}` : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .accuracy {
    display: grid;
    gap: var(--space-4);
  }
  .intro h2 {
    margin: 0 0 var(--space-1);
  }
  .intro p,
  .note,
  .explain {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }
  .tile {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .tile .k {
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tile strong {
    font-size: 1.8rem;
    font-variant-numeric: tabular-nums;
  }
  .tile small {
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.8rem);
  }
  .good {
    color: var(--success);
  }
  .fair {
    color: var(--warning);
  }
  .off {
    color: var(--danger);
  }
  .muted {
    color: var(--text-muted);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .section-head h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .controls {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: middle;
  }
  th {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .alliance {
    display: block;
    padding-left: var(--space-2);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .alliance.red {
    border-left: 3px solid var(--red-base);
  }
  .alliance.blue {
    border-left: 3px solid var(--blue-base);
  }
  .missing {
    display: block;
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.75rem);
  }
  .bar {
    display: inline-block;
    width: 5rem;
    height: 0.5rem;
    margin-right: var(--space-2);
    background: var(--surface-3);
    vertical-align: middle;
  }
  .bar > span {
    display: block;
    height: 100%;
  }
  .bar > .good {
    background: var(--success);
  }
  .bar > .fair {
    background: var(--warning);
  }
  .bar > .off {
    background: var(--danger);
  }

  /* Phone: cards, two numbers per row, and one list at a time. */
  .ph-seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--border);
  }
  .ph-seg button {
    min-height: var(--tap-min);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
  }
  .ph-seg button.on {
    background: var(--surface-2);
    color: var(--text);
  }
  .ph-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .ph-cards li {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .ph-cards li.red {
    border-left: 3px solid var(--red-base);
  }
  .ph-cards li.blue {
    border-left: 3px solid var(--blue-base);
  }
  .ph-top {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .ph-top .teams {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .ph-nums {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .ph-nums span {
    display: grid;
  }
  .ph-nums small {
    color: var(--text-muted);
    font-size: var(--text-min);
  }
  .ph-nums b {
    font-variant-numeric: tabular-nums;
  }
</style>
