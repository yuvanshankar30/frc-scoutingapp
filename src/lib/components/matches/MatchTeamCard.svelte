<script>
  import { ChevronRight, FileText, Wrench } from 'lucide-svelte';
  import Dialog from '../common/Dialog.svelte';
  import MatchScoutReport from '../scouting/MatchScoutReport.svelte';
  import { teamNumber } from '$lib/matches/matchView.js';
  import { autoPoints, reportFlags, reportTime, scoutOf } from '$lib/scouting/scoutData.js';
  import { reportKindOf } from '$lib/scouting/reportKinds.js';
  import {
    MATCH_FORM_RATING_FIELDS,
    MATCH_OPTIONAL_RATING_FIELDS,
    MATCH_RATING_FIELDS,
    ACCURACY_LABELS,
    BPS_LABELS
  } from '$lib/scouting/matchScouting.js';

  export let teamKey;
  export let nickname = '';
  export let brief = null; // season summary from summarizeMatchScoutEntries, or null
  export let reports = []; // reports for this robot in this match
  export let assignedScout = ''; // who is scouting this robot in this match, if anyone
  export let official = null; // { rank, opr, record } from Blue Alliance
  export let series = []; // balls per qualification match: [{ number, balls }]
  export let currentNumber = null; // this match's qualification number, to mark it in the series
  export let notes = []; // written scout notes for this robot in this match
  export let eventCounts = []; // recorded in-match events: [{ type, count }]
  export let problems = []; // open pit problems for this robot

  let showReports = false;
  let showPit = false;

  const whole = (value) => (value === null || value === undefined ? '–' : Math.round(value));
  const one = (value) => (value === null || value === undefined ? '–' : Number(value).toFixed(1).replace(/\.0$/, ''));
  const percent = (value) => (value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`);
  const label = (text) => String(text || '').replace(/_/g, ' ');
  const when = (stamp) =>
    stamp
      ? new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
  const WARN_STATUS = ['dead', 'stopped', 'brownout', 'disabled'];

  // Pit problems often store the same sentence as summary and detail, the detail prefixed
  // with the author ("Name: ..."). Show the words once, with the author in the footer.
  function shape(problem) {
    const summary = String(problem.summary || '').trim();
    let detail = String(problem.detail || '').trim();
    let author = '';
    const prefixed = /^([^:\n]{2,40}):\s+/.exec(detail);
    if (prefixed) {
      author = prefixed[1];
      detail = detail.slice(prefixed[0].length);
    }
    const repeats = detail && summary && detail.toLowerCase().includes(summary.toLowerCase().slice(0, 60));
    return {
      title: repeats ? '' : summary,
      body: detail || summary,
      author,
      severity: problem.severity,
      at: problem.created_at
    };
  }
  $: shaped = problems.map(shape);

  $: recent = series.slice(-14);
  $: tallest = Math.max(1, ...recent.map((point) => point.balls));
  $: officialLine = official
    ? [
        official.rank ? `Rank ${official.rank}` : '',
        official.record,
        official.opr !== null && official.opr !== undefined ? `OPR ${Number(official.opr).toFixed(1)}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  $: stats = brief
    ? [
        { label: 'Balls', value: whole(brief.avgBallsScored) },
        { label: 'Auto', value: whole(brief.avgAutoPoints) },
        { label: 'Accuracy', value: one(brief.ratingAverages?.['Shot accuracy']) },
        { label: 'Incidents', value: percent(brief.incidentRate), bad: brief.incidentRate > 0 }
      ]
    : [];

  // Each robot can have one report of each kind per scout: Data (auto, balls), Performance (ratings) and
  // Robot (status, incidents). Reports from before the split count as Data and may carry all three.
  // The newest report of each kind stands in for it on the card; its button opens all of that kind.
  const isLegacy = (report) => !report?.report_kind;
  $: byKind = {
    data: reports.filter((report) => reportKindOf(report) === 'data'),
    performance: reports.filter((report) => reportKindOf(report) === 'performance'),
    robot: reports.filter((report) => reportKindOf(report) === 'robot')
  };
  $: dataReport = byKind.data[0] || null;
  $: perfReport = byKind.performance[0] || byKind.data.find(isLegacy) || null;
  $: robotReport = byKind.robot[0] || byKind.data.find(isLegacy) || null;
  $: latest = dataReport || perfReport || robotReport;
  $: statusSource = robotReport || dataReport;
  $: status = statusSource
    ? statusSource.form_version === 2
      ? statusSource.teleop_robot_status
      : statusSource.robot_disabled
    : '';
  $: flags = robotReport ? reportFlags(robotReport) : [];

  const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  $: perfFields = perfReport
    ? perfReport.form_version === 2
      ? [...MATCH_FORM_RATING_FIELDS, ...MATCH_OPTIONAL_RATING_FIELDS]
      : MATCH_RATING_FIELDS
    : [];
  $: perfRows = perfReport
    ? [
        ...perfFields.map((field) => {
          const unknown = perfReport.ratings_unknown?.includes(field);
          const rating = perfReport.ratings?.[field];
          if (!unknown && !present(rating)) return null;
          // The score and what it means ("4/5", ">75–85%") are kept apart so the score never wraps.
          const band =
            perfReport.form_version === 2 && rating ? (field === 'BPS' ? BPS_LABELS : ACCURACY_LABELS)[rating - 1] : '';
          return { label: field, value: unknown ? 'Unknown' : `${rating}/5`, band: unknown ? '' : band || '' };
        }),
        present(perfReport.driver_skill)
          ? { label: 'Driver skill', value: `${perfReport.driver_skill}/5`, band: '' }
          : null,
        present(perfReport.intake_speed)
          ? { label: 'Intake speed', value: String(perfReport.intake_speed), band: '' }
          : null
      ].filter(Boolean)
    : [];
  $: robotRows = robotReport
    ? [
        // Status is already in the line above, so only incidents are listed here.
        present(robotReport.card) ? ['Card', robotReport.card] : null,
        (robotReport.form_version === 2 ? robotReport.significant_crash : robotReport.crash_or_break)
          ? ['Significant crash', present(robotReport.crash_target) ? `Yes · ${robotReport.crash_target}` : 'Yes']
          : null,
        robotReport.auto_collision ? ['Auto collision', 'Yes'] : null,
        robotReport.intake_jammed ? ['Intake jammed', 'Yes'] : null,
        robotReport.mechanical_break
          ? ['Mechanical break', present(robotReport.crash_details) ? robotReport.crash_details : 'Yes']
          : null,
        robotReport.beached ? ['Beached', 'Yes'] : null
      ].filter((row) => row && present(row[1]))
    : [];

  // One button per kind of report filed for this robot, each opening just that kind.
  const KIND_TITLES = { data: 'data', performance: 'performance', robot: 'robot' };
  $: reportButtons = ['data', 'performance', 'robot']
    .filter((kind) => byKind[kind].length)
    .map((kind) => ({
      kind,
      label:
        byKind[kind].length === 1
          ? `View ${KIND_TITLES[kind]} scouting report`
          : `View ${KIND_TITLES[kind]} scouting reports (${byKind[kind].length})`
    }));
  let dialogKind = 'data';
  $: dialogReports = byKind[dialogKind] || [];
  const openReports = (kind) => {
    dialogKind = kind;
    showReports = true;
  };
</script>

<article class="card">
  <header>
    <a class="num" href={`/teamview?team=${teamNumber(teamKey)}`}>{teamNumber(teamKey)}</a>
    <span class="name">{nickname}</span>
    {#if officialLine}<span class="meta official">{officialLine}</span>{/if}
    <span class="meta"
      >{#if brief}{brief.reportCount} report{brief.reportCount === 1 ? '' : 's'} · {brief.matchesScouted} match{brief.matchesScouted ===
        1
          ? ''
          : 'es'}{:else}not scouted yet{/if}</span
    >
  </header>

  {#if brief}
    <dl class="stats">
      {#each stats as stat}
        <div>
          <dt>{stat.label}</dt>
          <dd class:bad={stat.bad}>{stat.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if recent.length > 1}
    <div class="series">
      <svg
        viewBox={`0 0 ${recent.length * 9} 28`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Balls per match, oldest to newest"
      >
        {#each recent as point, index}
          {@const height = Math.max(2, Math.round((point.balls / tallest) * 26))}
          <rect class:now={point.number === currentNumber} x={index * 9} y={28 - height} width="6" {height}
            ><title>QM{point.number}: {Math.round(point.balls)}</title></rect
          >
        {/each}
      </svg>
      <small>Balls by match</small>
    </div>
  {/if}

  <div class="here">
    <h5>This match</h5>
    {#if latest}
      <div class="line">
        <span><small>Auto</small>{(dataReport && autoPoints(dataReport)) ?? '–'}</span>
        <span><small>Balls</small>{dataReport?.balls_scored_band || dataReport?.balls_scored_average || '–'}</span>
        <span class:warn={WARN_STATUS.includes(String(status).toLowerCase())}><small>Status</small>{status || '–'}</span
        >
        <span class="by"
          ><small>{byKind.data.length > 1 ? `${byKind.data.length} data scouts` : 'Data scout'}</small>{dataReport
            ? scoutOf(dataReport)
            : '–'}</span
        >
      </div>
      {#if flags.length}<p class="flags">{flags.join(' · ')}</p>{/if}
      {#if perfRows.length}
        <div class="rep-block">
          <h6>Performance ratings <span class="src">· {scoutOf(perfReport)}</span></h6>
          <dl>
            {#each perfRows as row (row.label)}<div>
                <dt>{row.label}</dt>
                <dd>
                  <b>{row.value}</b>{#if row.band}<span class="band">{row.band}</span>{/if}
                </dd>
              </div>{/each}
          </dl>
        </div>
      {/if}
      {#if robotReport && !robotRows.length}
        <div class="rep-block">
          <h6>Robot incidents <span class="src">· {scoutOf(robotReport)}</span></h6>
          <p class="none-inline">None reported.</p>
        </div>
      {:else if robotRows.length}
        <div class="rep-block">
          <h6>Robot incidents <span class="src">· {scoutOf(robotReport)}</span></h6>
          <dl>
            {#each robotRows as [k, v]}<div>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>{/each}
          </dl>
        </div>
      {/if}
    {:else}
      <p class="none">
        No report yet{#if assignedScout}
          · {assignedScout} is scouting this robot{/if}
      </p>
    {/if}
  </div>

  {#if reports.length || problems.length}
    <div class="actions">
      {#each reportButtons as button (button.kind)}
        <button type="button" class="open" on:click={() => openReports(button.kind)}>
          <FileText size={15} />
          <span class="open-label">{button.label}</span>
          <ChevronRight size={15} />
        </button>
      {/each}
      {#if problems.length}
        <button type="button" class="open warn" on:click={() => (showPit = true)}>
          <Wrench size={15} /> <span class="open-label">Pit problems ({problems.length})</span>
          <ChevronRight size={15} />
        </button>
      {/if}
    </div>
  {/if}
</article>

<Dialog
  bind:open={showReports}
  width={dialogReports.length > 1 ? `${Math.min(dialogReports.length, 3) * 32 + 4}rem` : '64rem'}
  title={`${teamNumber(teamKey)} ${nickname}`.trim()}
  subtitle={dialogReports.length === 1
    ? `${KIND_TITLES[dialogKind][0].toUpperCase()}${KIND_TITLES[dialogKind].slice(1)} scouting report`
    : `${dialogReports.length} ${KIND_TITLES[dialogKind]} scouting reports, side by side`}
>
  <div class="reports" class:many={dialogReports.length > 1}>
    {#each dialogReports as report (report.id)}
      <section class="report">
        <div class="who"><b>{scoutOf(report)}</b><small>{when(reportTime(report))}</small></div>
        <div class="detail"><MatchScoutReport {report} bodyOnly compact={dialogReports.length > 1} /></div>
      </section>
    {/each}
  </div>
  {#if notes.length}
    <section class="extra">
      <h4>Scout notes</h4>
      <ul>
        {#each notes as note}<li>{note.notes}</li>{/each}
      </ul>
    </section>
  {/if}
  {#if eventCounts.length}
    <section class="extra">
      <h4>Recorded in the match</h4>
      <p>{eventCounts.map((event) => `${label(event.type)} ×${event.count}`).join(' · ')}</p>
    </section>
  {/if}
</Dialog>

<Dialog
  bind:open={showPit}
  title={`${teamNumber(teamKey)} ${nickname}`.trim()}
  subtitle={`${problems.length} open pit problem${problems.length === 1 ? '' : 's'}`}
  width="40rem"
>
  <ul class="pit">
    {#each shaped as problem, index (index)}
      <li>
        {#if problem.title}<b>{problem.title}</b>{/if}
        <p>{problem.body}</p>
        <div class="foot">
          <small>{[problem.author, when(problem.at)].filter(Boolean).join(' · ')}</small>
          {#if problem.severity}<em class:urgent={problem.severity === 'urgent'}>{problem.severity}</em>{/if}
        </div>
      </li>
    {/each}
  </ul>
</Dialog>

<style>
  .card {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    overflow: hidden;
  }
  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    column-gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-2);
  }
  .num {
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    color: var(--text);
  }
  .num:hover {
    color: var(--accent-strong);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .meta {
    grid-column: 1 / -1;
    color: var(--text-muted);
    font-size: 0.76rem;
  }
  .meta.official {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .stats div {
    min-width: 0;
  }
  dt {
    color: var(--text-muted);
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  dd {
    margin: 1px 0 0;
    font-size: 1rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  dd.bad {
    color: var(--danger);
  }
  .series {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .series svg {
    width: 100%;
    height: 1.6rem;
    fill: var(--text-muted);
    opacity: 0.7;
  }
  .series svg rect.now {
    fill: var(--accent);
    opacity: 1;
  }
  .series small {
    color: var(--text-muted);
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h5 {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-1);
    color: var(--text-muted);
    font-size: 0.64rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .line {
    display: grid;
    grid-template-columns: repeat(3, max-content) minmax(0, 1fr);
    column-gap: var(--space-5);
    padding: var(--space-1) var(--space-4) var(--space-2);
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
  }
  .line small {
    display: block;
    color: var(--text-muted);
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .line .warn {
    color: var(--warning);
  }
  .line .by {
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flags {
    margin: 0;
    padding: 0 var(--space-4) var(--space-2);
    color: var(--danger);
    font-size: 0.84rem;
  }
  .rep-block {
    padding: 0 var(--space-4) var(--space-2);
  }
  .rep-block h6 {
    margin: var(--space-2) 0 var(--space-1);
    color: var(--text-muted);
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  /* One rating per row, label left and value right, in up to two columns on a wide card. */
  .rep-block dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0 var(--space-6);
  }
  .rep-block dl > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--divider, var(--border));
    font-size: 0.88rem;
    min-width: 0;
  }
  .rep-block dt {
    color: var(--text-secondary);
  }
  .rep-block dd {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    text-align: right;
    white-space: nowrap;
  }
  .rep-block dd b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .rep-block h6 .src {
    text-transform: none;
    letter-spacing: 0;
  }
  .none-inline {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .band {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .none {
    margin: 0;
    padding: var(--space-1) var(--space-4) var(--space-3);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* Pinned to the bottom, two equal slots, so the buttons line up across every card. */
  /* Every button in the grid is the same size, however its label wraps (desktop and phone). */
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 1fr;
    gap: var(--space-2);
    margin-top: auto;
    padding: var(--space-2) var(--space-4) var(--space-4);
  }
  .open {
    min-width: 0;
    min-height: var(--tap-min);
    height: 100%;
    display: flex;
    align-items: center;
    text-align: left;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .open-label {
    flex: 1;
    min-width: 0;
  }
  .open:hover {
    border-color: var(--accent);
    background: var(--surface-3);
  }
  .open :global(svg:last-child) {
    margin-left: auto;
    color: var(--text-muted);
  }
  .open.warn {
    color: var(--warning);
  }

  /* Popup content */
  .reports {
    display: grid;
    gap: var(--space-4);
  }
  .reports.many {
    grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
    align-items: start;
  }
  .report {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .who {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .who small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .extra {
    margin-top: var(--space-4);
  }
  .extra h4 {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .extra ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .extra li {
    padding-left: var(--space-3);
    border-left: 2px solid var(--border);
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .extra p {
    margin: 0;
    color: var(--text-secondary);
  }
  .pit {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-4);
  }
  .pit li {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .pit b {
    font-size: 0.95rem;
  }
  .pit p {
    margin: 0;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .foot small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .foot em {
    font-style: normal;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .foot em.urgent {
    color: var(--danger);
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .name,
    .line .by,
    .rep-block dd {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
