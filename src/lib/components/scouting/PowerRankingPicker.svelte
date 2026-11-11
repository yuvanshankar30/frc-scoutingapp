<script>
  // One scout's ranking of the robots in a match. Tap robots from best to worst; tap a ranked robot again to
  // take it out (the ones below move up). "Didn't watch" leaves a robot out of this scout's ranking, so the
  // match average only uses scouts who actually saw it.
  import { EyeOff, Plus, RotateCcw, X } from 'lucide-svelte';

  export let red = [];
  export let blue = [];
  /** { frc254: 1, ... } */
  export let ranking = {};
  /** team keys this scout did not watch */
  export let skipped = [];
  export let ownTeamKey = '';
  /** team_number -> nickname, when known */
  export let names = {};
  export let loading = false;

  let typedTeam = '';
  let addedTeams = [];
  let ownAddedFor = '';

  const teamNumber = (key) => String(key || '').replace(/^frc/, '');
  $: known = red.length + blue.length > 0;
  $: robots = known
    ? [...red.map((key) => ({ key, alliance: 'red' })), ...blue.map((key) => ({ key, alliance: 'blue' }))]
    : addedTeams.map((key) => ({ key, alliance: '' }));
  $: rankedCount = Object.keys(ranking).length;
  $: ordered = Object.entries(ranking).sort((left, right) => left[1] - right[1]);

  function toggle(key) {
    if (skipped.includes(key)) skipped = skipped.filter((entry) => entry !== key);
    if (ranking[key]) {
      const removed = ranking[key];
      ranking = Object.fromEntries(
        Object.entries(ranking)
          .filter(([team]) => team !== key)
          .map(([team, rank]) => [team, rank > removed ? rank - 1 : rank])
      );
    } else {
      ranking = { ...ranking, [key]: rankedCount + 1 };
    }
  }

  function skip(key) {
    if (ranking[key]) toggle(key);
    skipped = skipped.includes(key) ? skipped.filter((entry) => entry !== key) : [...skipped, key];
  }

  function clear() {
    ranking = {};
    skipped = [];
  }

  function addTeam() {
    const digits = typedTeam.replace(/\D/g, '').slice(0, 5);
    const key = digits ? `frc${digits}` : '';
    if (key && !addedTeams.includes(key) && addedTeams.length < 6) addedTeams = [...addedTeams, key];
    typedTeam = '';
  }

  function removeTeam(key) {
    if (ranking[key]) toggle(key);
    skipped = skipped.filter((entry) => entry !== key);
    addedTeams = addedTeams.filter((entry) => entry !== key);
  }

  // Added once per robot, so a scout who removes their own robot does not get it straight back.
  $: if (!known && ownTeamKey && ownAddedFor !== ownTeamKey) {
    ownAddedFor = ownTeamKey;
    if (!addedTeams.includes(ownTeamKey)) addedTeams = [ownTeamKey, ...addedTeams].slice(0, 6);
  }
</script>

<div class="ranker">
  {#if loading}
    <p class="hint">Loading the robots in this match…</p>
  {:else if !known}
    <p class="hint">This match's robots aren't on The Blue Alliance, so add the ones you watched.</p>
    <form class="add-team" on:submit|preventDefault={addTeam}>
      <input
        class="form-input"
        inputmode="numeric"
        placeholder="Team number"
        bind:value={typedTeam}
        aria-label="Add a robot by team number"
      />
      <button class="btn btn-secondary" type="submit" disabled={!typedTeam.trim() || addedTeams.length >= 6}
        ><Plus size={15} /> Add</button
      >
    </form>
  {/if}

  {#if robots.length}
    <ol class="robots" aria-label="Robots in this match">
      {#each robots as robot (robot.key)}
        {@const rank = ranking[robot.key]}
        {@const notWatched = skipped.includes(robot.key)}
        <li class="robot {robot.alliance}" class:ranked={rank} class:skipped={notWatched} class:removable={!known}>
          <button
            type="button"
            class="pick"
            aria-pressed={Boolean(rank)}
            on:click={() => toggle(robot.key)}
            aria-label={rank
              ? `Team ${teamNumber(robot.key)}, ranked ${rank}. Tap to remove.`
              : `Rank team ${teamNumber(robot.key)} next`}
          >
            <span class="rank" aria-hidden="true">{rank || (notWatched ? '–' : '+')}</span>
            <span class="team"
              ><b>{teamNumber(robot.key)}</b>{#if names[teamNumber(robot.key)]}<small
                  >{names[teamNumber(robot.key)]}</small
                >{/if}</span
            >
            {#if robot.key === ownTeamKey}<span class="yours">Your robot</span>{/if}
          </button>
          <button type="button" class="skip" aria-pressed={notWatched} on:click={() => skip(robot.key)}
            ><EyeOff size={14} /> {notWatched ? 'Not watched' : "Didn't watch"}</button
          >
          {#if !known}<button
              type="button"
              class="remove"
              aria-label={`Remove team ${teamNumber(robot.key)}`}
              title="Remove"
              on:click={() => removeTeam(robot.key)}><X size={15} /></button
            >{/if}
        </li>
      {/each}
    </ol>
    <div class="summary">
      <span
        >{rankedCount
          ? ordered.map(([key, rank]) => `${rank}. ${teamNumber(key)}`).join('   ')
          : 'Tap the best robot first.'}</span
      >
      {#if rankedCount || skipped.length}<button type="button" class="btn btn-secondary clear" on:click={clear}
          ><RotateCcw size={14} /> Start over</button
        >{/if}
    </div>
  {/if}
</div>

<style>
  .ranker {
    display: grid;
    gap: var(--space-3);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .add-team {
    display: flex;
    gap: var(--gap-2);
    max-width: 22rem;
  }
  .add-team .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .robots {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-2);
  }
  .robot {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    border: 1px solid var(--border);
    border-left-width: 3px;
    background: var(--surface-1);
  }
  .robot.red {
    border-left-color: var(--red-base);
  }
  .robot.blue {
    border-left-color: var(--blue-base);
  }
  .robot.ranked {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .robot.red.ranked {
    border-left-color: var(--red-base);
  }
  .robot.blue.ranked {
    border-left-color: var(--blue-base);
  }
  .robot.skipped {
    opacity: 0.6;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    min-height: 3.4rem;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .rank {
    display: grid;
    place-items: center;
    flex: none;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--border);
    border-radius: 50%;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .ranked .rank {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-strong);
    color: var(--surface-1);
  }
  .team {
    display: grid;
    min-width: 0;
  }
  .team b {
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .team small {
    color: var(--text-muted);
    font-size: 0.72rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .yours {
    margin-left: auto;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .skip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 var(--space-3);
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .skip[aria-pressed='true'] {
    color: var(--text);
    font-weight: 600;
  }
  .robot.removable {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .remove {
    display: grid;
    place-items: center;
    width: 2.75rem;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .remove:hover {
    color: var(--red-base);
    background: var(--red-soft);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-2);
    color: var(--text-muted);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    white-space: pre-wrap;
  }
  .clear {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  @media (max-width: 640px) {
    .robots {
      grid-template-columns: 1fr;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .team small {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
