<script>
  import Dialog from '../common/Dialog.svelte';
  import {
    MATCH_RATING_FIELDS,
    MATCH_FORM_RATING_FIELDS,
    MATCH_OPTIONAL_RATING_FIELDS,
    ACCURACY_LABELS,
    BPS_LABELS,
    MATCH_SHIFTS
  } from '$lib/scouting/matchScouting.js';
  import { REPORT_KIND_LABELS } from '$lib/scouting/reportKinds.js';

  export let report;
  export let showTeam = false;
  // Scoping this to an explicit prop rather than just deleting the
  // display:none below - Strategy/Power Rankings deliberately hide the
  // scout name below 1050px to make room for quick-stats, and that's not
  // what was asked to change. Scouting Admin's whole point is knowing who
  // submitted a report, so it opts in to keeping that visible everywhere.
  export let showScout = false;
  // Optional - only Scouting Admin's review list passes this. A plain
  // callback rather than a dispatched event since the caller (which knows
  // how to actually delete a report) varies more than a fixed event
  // contract would buy us here.
  export let onRemove = null;
  // Shows only the detail panels, without the pill header, for lists that draw their own row.
  export let bodyOnly = false;
  // Tighter layout for showing several reports side by side: rows with nothing in them left out.
  export let compact = false;

  // Written answers longer than this show a preview and open in full separately.
  const LONG_ANSWER = 280;

  const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';
  const valueOrDash = (value) => (present(value) ? value : '-');
  const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : '-');
  const list = (value) => (Array.isArray(value) && value.length ? value.join(', ') : '-');
  const teamNumber = (value) => String(value || '').replace(/^frc/i, '') || '-';
  const matchLabel = (value) =>
    String(value || '')
      .split('_')
      .at(-1) || '-';
  const points = (average, band) => (present(band) ? band : present(average) ? average : '-');
  const outOfFive = (value) => (present(value) ? `${value}/5` : '-');
  const dateValue = (value, compact = false) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return compact
      ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : date.toLocaleString();
  };
  // "4/5" and its band (">75–85%") as one value; "Unknown" when the scout couldn't tell.
  const rating = (field) => {
    if (report?.ratings_unknown?.includes(field)) return 'Unknown';
    const value = report?.ratings?.[field];
    if (!present(value)) return '-';
    if (report?.form_version !== 2) return String(value);
    const band = (field === 'BPS' ? BPS_LABELS : ACCURACY_LABELS)[value - 1];
    return band ? `${value}/5 · ${band}` : `${value}/5`;
  };
  const powerRanking = (ranking) =>
    ranking && typeof ranking === 'object' && Object.keys(ranking).length
      ? Object.entries(ranking)
          .sort(([, a], [, b]) => Number(a) - Number(b))
          .map(([team, place]) => `${place}. ${teamNumber(team)}`)
          .join('  ')
      : '-';

  // Detail answers: defense details, the exact BPS slider reading and robot status per shift.
  const teams = (value) => (Array.isArray(value) && value.length ? value.map(teamNumber).join(', ') : '-');
  const shiftNames = (value) =>
    Array.isArray(value) && value.length
      ? MATCH_SHIFTS.filter((shift) => value.includes(shift.key))
          .map((shift) => shift.label)
          .join(', ')
      : '-';
  const hubPeriods = (value) =>
    Array.isArray(value) && value.length ? value.map((period) => `hub ${period}`).join(', ') : '-';
  $: shiftStatusRows = report?.robot_status_shifts
    ? MATCH_SHIFTS.map((shift) => [shift.label, valueOrDash(report.robot_status_shifts[shift.key])])
    : [];
  $: bpsValue = present(report?.bps) ? `${report.bps} BPS` : rating('BPS');

  $: kind = ['data', 'performance', 'robot'].includes(report?.report_kind) ? report.report_kind : 'legacy';
  $: matchTitle = matchLabel(report?.match_key).replace(/^(?:qm|q)?(\d+)$/i, 'Match $1');
  $: reportTime = report?.updated_at || report?.created_at;
  $: autoScore = points(report?.auto_points_average, report?.auto_points_band);
  $: ballsScore = points(report?.balls_scored_average, report?.balls_scored_band);
  $: robotStatus =
    report?.form_version === 2 ? valueOrDash(report?.teleop_robot_status) : valueOrDash(report?.robot_disabled);
  $: incidentLabels = [
    report?.auto_collision ? 'Collision' : '',
    report?.significant_crash || report?.crash_or_break ? 'Crash' : '',
    report?.mechanical_break ? 'Break' : '',
    report?.intake_jammed ? 'Jam' : '',
    report?.beached ? 'Beached' : '',
    present(report?.card) ? `${report.card} card` : ''
  ].filter(Boolean);
  $: fouls =
    present(report?.fouls_minor) || present(report?.fouls_major)
      ? `${report.fouls_minor ?? 0} minor · ${report.fouls_major ?? 0} major`
      : '-';

  // The headline numbers in the closed row, for what this kind of report is about.
  $: quickStats =
    kind === 'performance'
      ? [
          { label: 'Accuracy', value: rating('Shot accuracy') },
          { label: 'BPS', value: bpsValue },
          { label: 'Driver', value: outOfFive(report?.driver_skill) },
          { label: 'Intake', value: valueOrDash(report?.intake_speed) }
        ]
      : kind === 'robot'
        ? [
            { label: 'Status', value: robotStatus, warn: true },
            { label: 'Card', value: present(report?.card) ? report.card : 'None' },
            { label: 'Fouls', value: fouls },
            { label: 'Incidents', value: incidentLabels.length ? incidentLabels.join(', ') : 'Clear', alert: true }
          ]
        : kind === 'data'
          ? [
              { label: 'Auto', value: autoScore },
              { label: 'Balls', value: ballsScore },
              {
                label: 'Shuttled',
                value: report?.shuttled ? valueOrDash(report?.shuttle_band) || 'Yes' : yesNo(report?.shuttled)
              },
              { label: 'Roles', value: report?.teleop_roles_none ? 'None' : list(report?.teleop_roles) }
            ]
          : [
              { label: 'Auto', value: autoScore },
              { label: 'Balls', value: ballsScore },
              { label: 'Status', value: robotStatus, warn: true },
              { label: 'Incidents', value: incidentLabels.length ? incidentLabels.join(', ') : 'Clear', alert: true }
            ];

  const prematch = (r) => ({
    key: 'prematch',
    title: 'Pre-match',
    rows: [
      ['Alliance', valueOrDash(r?.alliance)],
      ['Starting position', valueOrDash(r?.starting_position)],
      ...(r?.form_version === 2 ? [['Preload', yesNo(r.preload)]] : [])
    ]
  });
  const autonomous = (r) => ({
    key: 'auto',
    title: 'Autonomous',
    rows: [
      ['Ran', r?.auto_moved === 'ran' ? 'Yes' : r?.auto_moved === 'did-not-run' ? 'No' : valueOrDash(r?.auto_moved)],
      ['Start zone', valueOrDash(r?.auto_start_zone)],
      ['Points', autoScore],
      ['Finish', valueOrDash(r?.auto_finish)],
      ['Fuel sources', list(r?.ball_sources)],
      ...(r?.form_version === 2 ? [['Auto cycles', valueOrDash(r.auto_cycles)]] : []),
      ...(present(r?.auto_path_name) ? [['Path', r.auto_path_name]] : [])
    ]
  });

  $: sections =
    kind === 'data'
      ? [
          prematch(report),
          autonomous(report),
          {
            key: 'teleop',
            title: 'Teleop',
            rows: [
              ['Balls scored', ballsScore],
              ['Roles', report?.teleop_roles_none ? 'None observed' : list(report?.teleop_roles)]
            ]
          },
          ...(report?.defense
            ? [
                {
                  key: 'defense',
                  title: 'Defense',
                  rows: [
                    ['Defended', teams(report.defense.targets)],
                    ['When', hubPeriods(report.defense.periods)],
                    ['Shifts', shiftNames(report.defense.shifts)],
                    [
                      'Effectiveness',
                      present(report.defense.effectiveness) ? `${report.defense.effectiveness}/10` : '-'
                    ]
                  ]
                }
              ]
            : []),
          {
            key: 'shuttling',
            title: 'Shuttling',
            rows: [
              ['Shuttled', yesNo(report?.shuttled)],
              ...(report?.shuttled
                ? [
                    ['Amount', valueOrDash(report?.shuttle_band)],
                    ['Rating', outOfFive(report?.shuttle_rating)]
                  ]
                : [])
            ]
          }
        ]
      : kind === 'performance'
        ? [
            {
              key: 'ratings',
              title: 'Ratings',
              rows: [...MATCH_FORM_RATING_FIELDS, ...MATCH_OPTIONAL_RATING_FIELDS]
                .map((field) => [field, field === 'BPS' ? bpsValue : rating(field)])
                .filter(([field, value]) => MATCH_FORM_RATING_FIELDS.includes(field) || value !== '-')
            },
            {
              key: 'play',
              title: 'Play',
              rows: [
                ...(present(report?.offense_rating) ? [['Offense', outOfFive(report.offense_rating)]] : []),
                ...(present(report?.defense_rating) ? [['Defense', outOfFive(report.defense_rating)]] : []),
                ['Driver skill', outOfFive(report?.driver_skill)],
                ['Intake speed', valueOrDash(report?.intake_speed)]
              ]
            },
            { key: 'power', title: 'Power ranking', rows: [['Order', powerRanking(report?.power_ranking)]] }
          ]
        : kind === 'robot'
          ? [
              {
                key: 'condition',
                title: 'Condition',
                rows: [
                  ['Robot status', robotStatus],
                  ...shiftStatusRows,
                  ['Significant crash', yesNo(report?.significant_crash)],
                  ...(report?.significant_crash ? [['Crash target', valueOrDash(report?.crash_target)]] : []),
                  ['Auto collision', yesNo(report?.auto_collision)],
                  ['Intake jammed', yesNo(report?.intake_jammed)],
                  ['Mechanical break', yesNo(report?.mechanical_break)],
                  ['Beached', yesNo(report?.beached)]
                ]
              },
              {
                key: 'discipline',
                title: 'Cards and fouls',
                rows: [
                  ['Card', present(report?.card) ? report.card : 'None'],
                  ['Minor fouls', valueOrDash(report?.fouls_minor)],
                  ['Major fouls', valueOrDash(report?.fouls_major)],
                  ...(present(report?.foul_nature) ? [['Foul nature', report.foul_nature]] : []),
                  ...(present(report?.foul_details) ? [['Foul details', report.foul_details]] : [])
                ]
              }
            ]
          : [
              prematch(report),
              autonomous(report),
              {
                key: 'teleop',
                title: 'Teleop',
                rows: [
                  ['Balls scored', ballsScore],
                  ['Roles', report?.teleop_roles_none ? 'None observed' : list(report?.teleop_roles)],
                  ...(report?.form_version === 2
                    ? [
                        ['Significant crash', yesNo(report.significant_crash)],
                        ...(report.significant_crash ? [['Crash target', valueOrDash(report.crash_target)]] : []),
                        ['Teleop status', valueOrDash(report.teleop_robot_status)]
                      ]
                    : [
                        ['Intake speed', valueOrDash(report?.intake_speed)],
                        ['Intake jammed', yesNo(report?.intake_jammed)],
                        ['Crash or break', yesNo(report?.crash_or_break)]
                      ]),
                  ...(report?.form_version === 2 ? MATCH_FORM_RATING_FIELDS : MATCH_RATING_FIELDS).map((field) => [
                    field,
                    rating(field)
                  ])
                ]
              },
              {
                key: 'post-match',
                title: 'Post-match',
                rows: [
                  ['Robot status', valueOrDash(report?.robot_disabled)],
                  ['Card', present(report?.card) ? report.card : 'None'],
                  ['Driver skill', valueOrDash(report?.driver_skill)],
                  ...(report?.form_version === 2 ? [['Mechanical break', yesNo(report.mechanical_break)]] : [])
                ]
              }
            ];

  // The scout's own words, by question. Each kind has its own; legacy reports carry the old four.
  const ANSWERS = {
    data: [
      ['teleop_notes', 'Teleop notes'],
      ['shuttle_notes', 'Shuttling notes'],
      ['post_notes', 'Post-match notes']
    ],
    performance: [
      ['performance_notes', 'Performance notes'],
      ['post_notes', 'Post-match notes']
    ],
    robot: [
      ['auto_collision_notes', 'Auto collision'],
      ['crash_details', 'Crash'],
      ['break_details', 'What broke'],
      ['break_impact', 'Effect on the match'],
      ['break_response', 'What the team did'],
      ['post_notes', 'Post-match notes']
    ],
    legacy: [
      ['auto_collision_notes', 'Auto'],
      ['teleop_notes', 'Teleop'],
      ['crash_details', 'Crash'],
      ['post_notes', 'Post-match']
    ]
  };
  $: answers = (ANSWERS[kind] || [])
    .filter(([field]) => present(report?.[field]))
    .map(([field, question]) => ({ field, question, text: String(report[field]).trim() }))
    .map((answer) => ({ ...answer, long: answer.text.length > LONG_ANSWER }));

  let openAnswer = null;
</script>

<details class="match-report" class:body-only={bodyOnly} open={bodyOnly}>
  <summary>
    <span class="identity">
      <strong class="match-badge">{matchTitle}</strong>
      {#if showTeam}<strong class="team-badge">Team {teamNumber(report?.team_key)}</strong>{/if}
      {#if kind !== 'legacy'}<span class="kind-badge">{REPORT_KIND_LABELS[kind]}</span
        >{/if}{#if report?.robot_present === false}<span class="kind-badge no-show">Did not show up</span>{/if}
    </span>
    <span class="quick-stats" aria-label="Report summary">
      {#each quickStats as stat (stat.label)}
        <span class:has-alerts={stat.alert && stat.value !== 'Clear'}
          ><small>{stat.label}</small><b
            class:status-warn={stat.warn &&
              ['dead', 'stopped', 'brownout', 'disabled'].includes(String(stat.value).toLowerCase())}>{stat.value}</b
          ></span
        >
      {/each}
    </span>
    <span class="report-meta" class:force-visible={showScout}>
      <span>{report?.scout_name || report?.created_by || 'Unknown scout'}</span>
      <time datetime={reportTime || undefined}>{dateValue(reportTime, true)}</time>
    </span>
    {#if onRemove}
      <button
        class="remove-btn"
        type="button"
        aria-label={`Remove the ${matchLabel(report?.match_key)} report for team ${teamNumber(report?.team_key)}`}
        on:click|stopPropagation|preventDefault={() => onRemove(report)}>&times;</button
      >
    {/if}
  </summary>

  <div class="report-body" class:compact>
    {#each sections as section (section.key)}
      {@const rows = compact ? section.rows.filter(([, value]) => value !== '-') : section.rows}
      {#if rows.length}
        <section class={section.key}>
          <h4>{section.title}</h4>
          <dl>
            {#each rows as [name, value]}<div>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>{/each}
          </dl>
        </section>
      {/if}
    {/each}
  </div>
  {#if answers.length}
    <div class="report-notes" aria-label="Written answers">
      {#each answers as answer (answer.field)}
        <div class="answer" class:long={answer.long}>
          <strong>{answer.question}</strong>
          <p class="answer-text">{answer.text}</p>
          {#if answer.long}
            <button type="button" class="read-more" on:click|stopPropagation={() => (openAnswer = answer)}
              >Read full answer</button
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</details>

<!-- A long written answer opens on its own, so the report stays easy to scan. -->
<Dialog
  open={Boolean(openAnswer)}
  title={openAnswer?.question || ''}
  subtitle={`${report?.scout_name || 'Scout'} · ${matchTitle}${showTeam ? ` · Team ${teamNumber(report?.team_key)}` : ''}`}
  width="44rem"
  on:close={() => (openAnswer = null)}
>
  <p class="full-answer">{openAnswer?.text || ''}</p>
</Dialog>

<style>
  .match-report {
    overflow: hidden;
    margin: 0 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1, #fff);
  }
  .match-report.body-only,
  .match-report.body-only[open] {
    margin: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .match-report.body-only > summary {
    display: none;
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    min-height: 3.25rem;
    padding: 0.55rem var(--space-3);
    cursor: pointer;
    list-style-position: outside;
  }
  summary:hover {
    background: var(--surface-2);
  }
  summary:focus-visible {
    outline: 2px solid var(--accent, #b98000);
    outline-offset: -2px;
  }
  .identity {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    min-width: 0;
  }
  /* Plain text, not a pill: the match and team read as labels next to the numbers. */
  .match-badge,
  .team-badge {
    font-size: 0.92rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .team-badge {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .quick-stats {
    flex: 1 1 16rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
    gap: var(--space-3);
    min-width: 0;
  }
  .quick-stats > span {
    min-width: 0;
  }
  .quick-stats small,
  .quick-stats b {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quick-stats small {
    color: var(--text-muted);
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .quick-stats b {
    margin-top: 1px;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .quick-stats .status-warn {
    color: var(--warning);
  }
  .quick-stats .has-alerts b {
    color: var(--danger);
  }
  .report-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    text-align: right;
    margin-left: auto;
  }
  .report-meta > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
  }
  .report-meta time {
    color: var(--text-muted);
    font-size: 0.68rem;
  }
  .remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 1.15rem;
    line-height: 1;
    cursor: pointer;
    justify-self: end;
  }
  .remove-btn:hover {
    background: var(--surface-3);
    color: var(--danger);
  }
  /* Panels size themselves to the room available, so a narrow side panel gets one or two
     columns instead of clipping a fixed four. */
  /* Each section is its own bordered card, so a row with fewer sections than columns leaves empty
     space, not a grey block. */
  .report-body {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--space-2);
    padding: var(--space-2);
    border-top: 1px solid var(--border);
  }
  section {
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  h4 {
    margin: 0 0 0.45rem;
    color: var(--text-muted);
    font-size: 0.7rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    gap: 0;
    margin: 0;
  }
  dl div {
    display: flex;
    gap: 0.6rem;
    justify-content: space-between;
    min-width: 0;
    padding: 0.27rem 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  dl div:first-child {
    border-top: 0;
  }
  dt {
    flex: 0 1 auto;
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  dd {
    flex: 1 1 auto;
    margin: 0;
    overflow-wrap: anywhere;
    text-align: right;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .report-body.compact {
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  }
  .kind-badge.no-show {
    color: var(--danger);
    border-color: var(--danger);
  }
  .kind-badge {
    color: var(--text-muted);
    font-size: max(0.72rem, var(--text-min));
    white-space: nowrap;
  }
  .report-notes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
  }
  .answer {
    min-width: 0;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  .answer-text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.82rem;
    line-height: 1.45;
  }
  /* A long answer shows its first lines here and opens in full on its own. */
  .answer.long .answer-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
  }
  .read-more {
    margin-top: var(--space-1);
    min-height: var(--tap-min);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .full-answer {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.95rem;
    line-height: 1.55;
  }
  .report-notes strong {
    display: block;
    margin-bottom: 0.2rem;
    color: var(--text-muted);
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  /* The scout name is hidden on narrow screens unless the caller says it matters. */
  @media (max-width: 680px) {
    .report-meta:not(.force-visible) {
      display: none;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .quick-stats small,
    .quick-stats b,
    .report-meta > span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
