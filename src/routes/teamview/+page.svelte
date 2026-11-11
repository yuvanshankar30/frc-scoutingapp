<script>
  import Select from '$lib/components/common/Select.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { authFetch, supabase } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import { formatLocalDateTimeWithZone } from '$lib/app/timezone.js';
  import { buildPowerRankings } from '$lib/scouting/scoutingStats.js';
  import { bestTeamPhoto, mediaImageUrl } from '$lib/matches/tbaMedia.js';
  import { safeInternalPath, safeUrl } from '$lib/app/safeUrl.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import MatchScoutReport from '$lib/components/scouting/MatchScoutReport.svelte';
  import RobotStarPlot from '$lib/components/scouting/RobotStarPlot.svelte';
  import MatchVideoModal from '$lib/components/matches/MatchVideoModal.svelte';
  import TeamGrid from '$lib/components/scouting/TeamGrid.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import TeamChartsPanel from '$lib/components/scouting/TeamChartsPanel.svelte';
  import { teamGridRows } from '$lib/scouting/teamCharts.js';
  import {
    PIT_ABILITIES,
    dialablePhone,
    normalizeAutoOptions,
    normalizeClimbOptions,
    normalizeTechnicalDetails,
    weightedAbilityScore
  } from '$lib/scouting/pitForm.js';
  import { ChevronRight } from 'lucide-svelte';

  const SCOPE_OPTIONS = [
    { value: 'total', label: 'Total' },
    { value: 'auto', label: 'Auto' },
    { value: 'teleop', label: 'Teleop' },
    { value: 'active', label: 'Active Teleop' },
    { value: 'inactive', label: 'Inactive Teleop' }
  ];

  const BREAKDOWN_KEYS = {
    shooting: [
      { key: 'shuttling', label: 'Shuttling', color: 'var(--chart-orange)' },
      { key: 'scoring', label: 'Scoring', color: 'var(--chart-blue)' }
    ],
    pickup: [
      { key: 'ground', label: 'Ground', color: 'var(--chart-orange)' },
      { key: 'outpost', label: 'Outpost', color: 'var(--chart-blue)' },
      { key: 'depot', label: 'Depot', color: 'var(--chart-success)' }
    ],
    climb: [
      { key: 'none', label: 'None', color: 'var(--chart-secondary)' },
      { key: 'L1', label: 'L1', color: 'var(--chart-info)' },
      { key: 'L2', label: 'L2', color: 'var(--chart-teal)' },
      { key: 'L3', label: 'L3', color: 'var(--chart-blue)' },
      { key: 'failed', label: 'Failed', color: 'var(--chart-danger)' }
    ],
    role: [
      { key: 'Scoring', label: 'Scoring', color: 'var(--chart-blue)' },
      { key: 'Shuttling', label: 'Shuttling', color: 'var(--chart-orange)' },
      { key: 'Defense', label: 'Defense', color: 'var(--chart-purple)' },
      { key: 'Counter Defense', label: 'Counter Defense', color: 'var(--chart-teal)' },
      { key: 'Dead', label: 'Dead', color: 'var(--chart-danger)' }
    ]
  };
  const TREND_CHART_HEIGHT = 240;

  let eventKey = ''; // globally active scouting event
  let selectedEventKey = null; // event being browsed, if different from active
  let availableEvents = [];
  let lastLoadedEventKeyForTeams = null;
  let loading = false;
  let loadingTeamData = false;
  let apiNote = '';

  // Every downstream fetch should use this, not the raw active eventKey -
  // blank selectedEventKey means "track whatever event is currently active."
  $: resolvedEventKey = selectedEventKey || eventKey;

  let teams = [];
  let eventTeams = [];
  let eventMatches = [];
  let teamNames = {};
  let crossEventMatches = [];
  let crossEventMatchesNote = '';
  let selectedTeam = '';
  // Phones show the team page one section at a time.
  const PHONE_TABS = [
    ['overview', 'Overview'],
    ['charts', 'Charts'],
    ['matches', 'Matches'],
    ['pit', 'Pit'],
    ['notes', 'Notes']
  ];
  let phoneTab = 'overview';
  // The event's scouting report and TBA OPR/rank rows, loaded once per event for the team grid and
  // reused when a team is opened.
  let scoutingReport = null;
  let scoutingReportEventKey = '';
  let scoutingReportAt = 0;
  let officialRows = [];
  let allMatchEntries = [];

  let teamEvents = [];
  let pitEntry = null;
  let teamNotes = [];
  let matchEntries = [];
  let selectedProfile = null;
  let officialTeam = null;
  let tbaPhoto = null;
  let requestedTeamKey = '';
  let selectedVideoMatch = null;
  let viewFilterScope = 'total';
  // Where to send someone who wants OUT of Team View entirely, as opposed to
  // clearSelection() below (which only clears the picked team and drops them
  // back at this page's own search picker - not the same as leaving the
  // page). Team View is only ever reached via a link from elsewhere, never a
  // top-nav tab, so without this a visitor's only way out is the generic
  // hamburger/top nav - easy to miss and it forgets what they came from.
  let returnTo = '';
  let returnLabel = '';

  const displayTeam = (t) => String(t || '').replace(/^frc/i, '');
  const isTeleop = (p) => p === 'teleop' || p === 'endgame';
  const photoUrl = (path) =>
    path ? supabase.storage.from('pit-scout-photos').getPublicUrl(path)?.data?.publicUrl || '' : '';

  const outOfTen = (value) => (Number.isFinite(value) ? `${value}/10` : '');
  const dimensions = (...values) =>
    values.some((value) => Number.isFinite(value))
      ? values.map((value) => (Number.isFinite(value) ? value : '—')).join(' × ')
      : '';

  function formatEstimatedBps(value) {
    if (value === null || value === undefined || value === '') return '—';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '—';
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed);
  }

  function parseShift(v) {
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return null;
  }

  function normalizeTeamKey(teamKey) {
    const raw = String(teamKey || '').trim();
    const digits = displayTeam(raw).replace(/\D/g, '');
    return digits ? `frc${String(parseInt(digits, 10))}` : raw.toLowerCase();
  }

  function teamSort(a, b) {
    const an = Number(displayTeam(a));
    const bn = Number(displayTeam(b));
    return !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : String(a).localeCompare(String(b));
  }

  async function loadTeams() {
    if (!resolvedEventKey) {
      teams = [];
      eventTeams = [];
      eventMatches = [];
      teamNames = {};
      return;
    }

    eventTeams = [];
    eventMatches = [];
    officialRows = [];

    const [eventRes, eventTeamsRes, dataListRes, noteListRes, pitListRes] = await Promise.all([
      fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(resolvedEventKey)}&comp_level=all`).catch(
        () => null
      ),
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => null),
      authFetch(`/datascout?list_teams=1&event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => null),
      authFetch(`/notescout?list_teams=1&event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => null),
      authFetch(`/pitscout?event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => null),
      loadEventScouting(resolvedEventKey)
    ]);

    const unique = new Map();
    const addTeam = (teamKey) => {
      const normalized = normalizeTeamKey(teamKey);
      const number = displayTeam(normalized);
      if (normalized && number) unique.set(number, normalized);
    };

    if (eventRes?.ok) {
      const eventData = await eventRes.json().catch(() => null);
      eventMatches = eventData?.data || [];
      for (const m of eventData?.data || []) {
        for (const t of m?.alliances?.red?.team_keys || []) addTeam(t);
        for (const t of m?.alliances?.blue?.team_keys || []) addTeam(t);
      }
    }

    let nextNames = {};
    if (eventTeamsRes?.ok) {
      const teamData = await eventTeamsRes.json().catch(() => null);
      eventTeams = teamData?.data || [];
      for (const row of teamData?.data || []) {
        const key = normalizeTeamKey(row.key);
        const nickname = String(row.nickname || row.name || '').trim();
        if (key && nickname) nextNames[key] = nickname;
      }
    }

    for (const t of (await dataListRes?.json().catch(() => null))?.data || []) addTeam(t);
    for (const t of (await noteListRes?.json().catch(() => null))?.data || []) addTeam(t);
    for (const r of (await pitListRes?.json().catch(() => null))?.data || []) if (r?.team_key) addTeam(r.team_key);

    teams = [...unique.values()].sort(teamSort);

    const missingKeys = teams.filter((key) => !nextNames[key]);
    if (missingKeys.length) {
      const fallbackRes = await fetch(
        `/api/tba/teams-simple?team_keys=${encodeURIComponent(missingKeys.join(','))}`
      ).catch(() => null);
      const fallbackData = await fallbackRes?.json().catch(() => null);
      for (const row of fallbackData?.data || []) {
        const key = normalizeTeamKey(row.key);
        const nickname = String(row.nickname || row.name || '').trim();
        if (key && nickname) nextNames[key] = nickname;
      }
    }
    teamNames = nextNames;
  }

  // The grid's ranks, OPRs and scouting coverage. A failure leaves the grid with TBA data only.
  async function loadEventScouting(key) {
    const [reportRes, officialRes] = await Promise.all([
      authFetch(`/api/scouting-report?event_key=${encodeURIComponent(key)}`).catch(() => null),
      fetch(`/api/tba/event-oprs?event_key=${encodeURIComponent(key)}`).catch(() => null)
    ]);
    const [reportPayload, officialPayload] = await Promise.all([
      reportRes?.json().catch(() => null),
      officialRes?.json().catch(() => null)
    ]);
    if (key !== resolvedEventKey) return;
    officialRows = officialPayload?.success ? officialPayload.data || [] : [];
    if (reportRes?.ok && reportPayload?.success) {
      scoutingReport = reportPayload.data || {};
      scoutingReportEventKey = key;
      scoutingReportAt = Date.now();
      allMatchEntries = scoutingReport.match_entries || [];
    }
  }

  async function openTeam(teamKey) {
    if (!teamKey || loadingTeamData) return;
    selectedTeam = normalizeTeamKey(teamKey);
    loadingTeamData = true;
    apiNote = '';

    try {
      // Reuse the grid's report when it is under a minute old; otherwise fetch a fresh one so new
      // scouting shows without a full refresh.
      const reuse =
        scoutingReport && scoutingReportEventKey === resolvedEventKey && Date.now() - scoutingReportAt < 60000;
      const [reportRes, officialRes, mediaRes] = await Promise.all([
        reuse ? null : authFetch(`/api/scouting-report?event_key=${encodeURIComponent(resolvedEventKey)}`),
        fetch(`/api/tba/event-oprs?event_key=${encodeURIComponent(resolvedEventKey)}`),
        fetch(
          `/api/tba/team-media?event_key=${encodeURIComponent(resolvedEventKey)}&team_key=${encodeURIComponent(selectedTeam)}`
        )
      ]);

      const [reportPayload, officialPayload, mediaPayload] = await Promise.all([
        reuse ? { success: true, data: scoutingReport } : reportRes.json().catch(() => null),
        officialRes.json().catch(() => null),
        mediaRes.json().catch(() => null)
      ]);

      if ((!reuse && !reportRes.ok) || !reportPayload?.success)
        throw new Error(reportPayload?.error || 'Could not load the team scouting report.');
      const scouting = reportPayload.data || {};
      if (!reuse) {
        scoutingReport = scouting;
        scoutingReportEventKey = resolvedEventKey;
        scoutingReportAt = Date.now();
        allMatchEntries = scouting.match_entries || [];
      }
      teamEvents = (scouting.data_events || []).filter((row) => row.team_key === selectedTeam);
      pitEntry = (scouting.pit_entries || []).find((row) => row.team_key === selectedTeam) || null;
      teamNotes = (scouting.notes || []).filter((row) => row.team_key === selectedTeam);
      matchEntries = (scouting.match_entries || []).filter((row) => row.team_key === selectedTeam);

      if (officialPayload?.success) officialRows = officialPayload.data || [];
      const officialByNumber = new Map(officialRows.map((row) => [Number(row.team), { ...row, opr: row.epa ?? null }]));
      officialTeam = officialByNumber.get(Number(displayTeam(selectedTeam))) || null;
      const roster = eventTeams.length
        ? eventTeams
        : teams.map((key) => ({ key, team_number: Number(displayTeam(key)), nickname: teamNames[key] || '' }));
      const profiles = buildPowerRankings(roster, scouting.data_events || [], scouting.notes || [], {
        pitEntries: scouting.pit_entries || [],
        problemReports: scouting.pit_problems || [],
        matchEntries: scouting.match_entries || [],
        oprByTeamNumber: officialByNumber
      });
      selectedProfile = profiles.find((row) => row.key === selectedTeam) || null;
      tbaPhoto = bestTeamPhoto(mediaPayload?.success ? mediaPayload.data || [] : []);
      viewFilterScope = 'total';
    } catch (e) {
      apiNote = e.message || 'Failed to load team details.';
    } finally {
      loadingTeamData = false;
    }
    void loadCrossEventMatches(selectedTeam, resolvedEventKey);
  }

  // Cross-event match history - kept separate from the main openTeam load
  // so a TBA hiccup here never blocks the rest of the team view, and scoped
  // to the current event's season year so it's one fast TBA call rather
  // than a fetch per historical event.
  async function loadCrossEventMatches(teamKey, eventKey) {
    crossEventMatches = [];
    crossEventMatchesNote = '';
    if (!teamKey || !eventKey) return;
    try {
      const year = eventKey.slice(0, 4);
      const response = await fetch(
        `/api/tba/team-matches?team_key=${encodeURIComponent(teamKey)}&year=${encodeURIComponent(year)}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success)
        throw new Error(payload?.error || 'Could not load cross-event match history.');
      crossEventMatches = (payload.data || [])
        .filter((match) => match.event_key !== eventKey && match.actual_time)
        .slice()
        .reverse();
    } catch (e) {
      crossEventMatchesNote = e.message || 'Could not load cross-event match history.';
    }
  }

  // Opening a team from the grid adds a history entry, so the phone's back button returns to the grid.
  function teamHref(row) {
    const params = new URLSearchParams($page.url.searchParams);
    params.set('team', String(row.number));
    if (selectedEventKey) params.set('event_key', selectedEventKey);
    return `/teamview?${params}`;
  }

  function openFromGrid(row) {
    phoneTab = 'overview';
    history.pushState({ teamview: row.key }, '', teamHref(row));
    void openTeam(row.key);
  }

  function backToGrid() {
    const params = new URLSearchParams(window.location.search);
    params.delete('team');
    history.pushState({}, '', `/teamview${params.size ? `?${params}` : ''}`);
    clearSelection();
  }

  function onPopState() {
    const team = normalizeTeamKey(new URLSearchParams(window.location.search).get('team'));
    if (!team) clearSelection();
    else if (team !== selectedTeam) void openTeam(team);
  }

  function clearSelection() {
    selectedTeam = '';
    teamEvents = [];
    pitEntry = null;
    teamNotes = [];
    matchEntries = [];
    selectedProfile = null;
    officialTeam = null;
    tbaPhoto = null;
    viewFilterScope = 'total';
    crossEventMatches = [];
    crossEventMatchesNote = '';
  }

  async function loadEventOptions() {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    availableEvents = await fetchAvailableScoutingEvents();
  }

  async function loadPage() {
    loading = true;
    apiNote = '';
    try {
      if (!resolvedEventKey) {
        clearSelection();
        apiNote = 'No scouting event is configured.';
        return;
      }
      const nextTeam = requestedTeamKey || selectedTeam;
      requestedTeamKey = '';
      await loadTeams();
      if (nextTeam) await openTeam(nextTeam);
    } catch (e) {
      apiNote = e.message || 'Failed to load team view.';
    } finally {
      loading = false;
    }
  }

  function linePoints(values, width = 320, height = TREND_CHART_HEIGHT) {
    if (!values?.length) return '';
    const left = 34;
    const right = width - 8;
    const top = 10;
    const bottom = height - 34;
    const max = Math.max(...values, 1);
    const range = Math.max(max, 1);
    return values
      .map((v, i) => {
        const x = values.length === 1 ? (left + right) / 2 : left + (i / (values.length - 1)) * (right - left);
        const y = bottom - (v / range) * (bottom - top);
        return `${x},${y}`;
      })
      .join(' ');
  }

  function areaPoints(values, width = 320, height = TREND_CHART_HEIGHT) {
    const line = linePoints(values, width, height);
    if (!line) return '';
    const left = 34;
    const right = width - 8;
    const bottom = height - 34;
    return `${left},${bottom} ${line} ${right},${bottom}`;
  }

  function yForTick(value, max, height = TREND_CHART_HEIGHT) {
    const top = 10;
    const bottom = height - 34;
    const safeMax = Math.max(max, 1);
    return bottom - (value / safeMax) * (bottom - top);
  }

  function xForIndex(index, count, width = 320) {
    const left = 34;
    const right = width - 8;
    if (count <= 1) return (left + right) / 2;
    return left + (index / (count - 1)) * (right - left);
  }

  function pct(value, total) {
    if (!total) return 0;
    return (value / total) * 100;
  }

  function segmentTitle(label, value, total) {
    return `${label}: ${pct(value, total).toFixed(1)}% (${Number(value).toFixed(2)})`;
  }

  function closeParentDetails(e) {
    const details = e.currentTarget.closest('details');
    if (details) details.open = false;
  }

  function closeOnKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    closeParentDetails(e);
  }

  function teamDisplayName(teamKey) {
    return teamNames[normalizeTeamKey(teamKey)] || `Team ${displayTeam(teamKey)}`;
  }

  function allianceForTeam(match) {
    return (match?.alliances?.red?.team_keys || []).includes(selectedTeam) ? 'red' : 'blue';
  }

  function matchResult(match) {
    const alliance = allianceForTeam(match);
    const ours = match?.alliances?.[alliance]?.score;
    const theirs = match?.alliances?.[alliance === 'red' ? 'blue' : 'red']?.score;
    if (!Number.isFinite(ours) || ours < 0 || !Number.isFinite(theirs) || theirs < 0) return 'Score unavailable';
    return `${ours}-${theirs} · ${ours === theirs ? 'Tie' : ours > theirs ? 'Win' : 'Loss'}`;
  }

  $: gridRows = teamGridRows({
    eventTeams: eventTeams.length ? eventTeams : teams.map((key) => ({ key, nickname: teamNames[key] || '' })),
    officialRows,
    matchEntries: scoutingReportEventKey === resolvedEventKey ? allMatchEntries : [],
    pitEntries: scoutingReportEventKey === resolvedEventKey ? scoutingReport?.pit_entries || [] : [],
    matches: eventMatches
  });
  $: selectedTeamNumber = selectedTeam ? displayTeam(selectedTeam) : '';
  $: selectedTeamName = selectedTeam ? teamDisplayName(selectedTeam) : '';
  $: activeEventLabel = availableEvents.find((option) => option.value === eventKey)?.label || eventKey || 'none set';
  $: browseEventOptions = availableEvents.filter((option) => option.value !== eventKey);
  $: playedTeamMatches = eventMatches
    .filter(
      (match) =>
        match.actual_time &&
        [...(match.alliances?.red?.team_keys || []), ...(match.alliances?.blue?.team_keys || [])].includes(selectedTeam)
    )
    .slice()
    .reverse();
  $: tbaPhotoUrl = mediaImageUrl(tbaPhoto);
  $: viewMatchKeys = [...new Set(teamEvents.map((e) => e.match_key).filter(Boolean))].sort(
    (a, b) =>
      (parseInt(a.split('_').pop().replace(/\D/g, ''), 10) || 0) -
      (parseInt(b.split('_').pop().replace(/\D/g, ''), 10) || 0)
  );
  $: primaryPhoto = pitEntry?.photo_paths?.[0] || '';
  $: pitAutoOptions = normalizeAutoOptions(pitEntry?.auto_options || []).filter(
    (option) => option.name && option.description
  );
  $: pitClimbOptions = normalizeClimbOptions(pitEntry?.climb_options || []);
  $: pitDetails = normalizeTechnicalDetails(pitEntry?.technical_details);
  $: pitAbilityScore = weightedAbilityScore(pitDetails);
  // The pit answers shown on Team View, in the order a strategist reads them. Missing answers are "—".
  $: pitFieldRows = pitEntry
    ? [
        ['Drivebase', pitEntry.drivebase_type],
        ['Shooter', pitEntry.shooter_type],
        ['Indexer', pitEntry.hopper_type],
        ['Archetype', pitEntry.robot_archetype],
        // Reports saved before these questions existed would show a row of dashes, so they only appear once answered.
        ...(pitDetails.preferred_roles.length ? [['Preferred role', pitDetails.preferred_roles.join(', ')]] : []),
        ...(pitAbilityScore.rated
          ? [
              ['Pit ability score', `${pitAbilityScore.score.toFixed(1)}/10`],
              ...PIT_ABILITIES.map((ability) => [ability.label, outOfTen(pitDetails[ability.key])])
            ]
          : []),
        ['HP balls in auto', pitEntry.human_player_balls_in_auto],
        ['Estimated BPS', formatEstimatedBps(pitEntry.estimated_bps)],
        ['Climb options', pitClimbOptions.join(', ')],
        ['Trench or bump', pitDetails.trench_or_bump],
        ['Fits under trench', pitDetails.fits_under_trench],
        ['Drives over mound', pitDetails.drives_over_mound],
        ['Hopper capacity', pitDetails.hopper_capacity],
        ['Swerve module', pitDetails.swerve_module],
        [
          'Drivetrain (L × W × H)',
          dimensions(pitDetails.drivetrain_length, pitDetails.drivetrain_width, pitDetails.drivetrain_height)
        ],
        ...(pitDetails.robot_weight ? [['Weight (no bumpers or battery)', pitDetails.robot_weight]] : []),
        ...(pitDetails.canivore_count ? [['CANivores', pitDetails.canivore_count]] : []),
        ['Motors', pitDetails.motor_types.join(', ')],
        ['Motor controllers', pitDetails.motor_controllers.join(', ')],
        ['Language', pitDetails.programming_language.join(', ')],
        ['Auto tools', pitDetails.auto_tools.join(', ')],
        ['Vision', pitDetails.vision.join(', ')],
        ['Coprocessor', pitDetails.coprocessor],
        ['Drivebase rating', outOfTen(pitDetails.drivebase_rating)],
        ['Electrical rating', outOfTen(pitDetails.electrical_rating)],
        // Main's ability rows already show reliability once any ability is rated.
        ...(pitAbilityScore.rated ? [] : [['Reliability rating', outOfTen(pitDetails.overall_reliability_rating)]])
      ].map(([label, value]) => ({
        label,
        value: value === undefined || value === null || value === '' ? '—' : String(value)
      }))
    : [];
  // Answers Team View doesn't show (electrical, bumpers and the rest) or photos: only then link to the full report.
  const SHOWN_DETAILS = new Set([
    'trench_or_bump',
    'fits_under_trench',
    'drives_over_mound',
    'hopper_capacity',
    'swerve_module',
    'drivetrain_length',
    'drivetrain_width',
    'drivetrain_height',
    'robot_weight',
    'canivore_count',
    'motor_types',
    'motor_controllers',
    'programming_language',
    'auto_tools',
    'vision',
    'coprocessor',
    'drivebase_rating',
    'electrical_rating',
    'overall_reliability_rating',
    'pit_contact_phone',
    'strat_phone',
    'preferred_roles',
    'strengths',
    'weaknesses',
    ...PIT_ABILITIES.map((ability) => ability.key)
  ]);
  $: hasMorePitData = Boolean(
    pitEntry &&
    ((pitEntry.photo_paths || []).filter(Boolean).length ||
      Object.entries(pitDetails).some(
        ([field, value]) =>
          !SHOWN_DETAILS.has(field) && (Array.isArray(value) ? value.length : value !== '' && value !== undefined)
      ))
  );

  $: viewStats = (() => {
    const selectedMatches = viewMatchKeys;
    if (!selectedMatches.length) return null;

    const byMatch = Object.fromEntries(
      selectedMatches.map((mk) => [
        mk,
        teamEvents
          .filter((e) => e.match_key === mk)
          .slice()
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      ])
    );

    const inScope = (e) =>
      viewFilterScope === 'total' ||
      (viewFilterScope === 'auto' && e.phase === 'auto') ||
      (viewFilterScope === 'teleop' && isTeleop(e.phase)) ||
      (viewFilterScope === 'active' && isTeleop(e.phase) && parseShift(e.on_shift) === true) ||
      (viewFilterScope === 'inactive' && isTeleop(e.phase) && parseShift(e.on_shift) === false);

    const totals = {
      fuel: 0,
      shooting: { shuttling: 0, scoring: 0 },
      pickup: { ground: 0, outpost: 0, depot: 0 },
      role: { Scoring: 0, Shuttling: 0, Defense: 0, 'Counter Defense': 0, Dead: 0 },
      climb: { none: 0, L1: 0, L2: 0, L3: 0, failed: 0 },
      speedVals: [],
      accVals: [],
      drvVals: [],
      autoClimbRateMade: 0,
      autoClimbRateN: 0
    };

    const perMatch = [];

    for (const mk of selectedMatches) {
      const events = byMatch[mk];
      const scoped = events.filter(inScope);
      const label = mk.split('_').pop().toUpperCase();
      const speed =
        parseFloat(
          (scoped.find((e) => e.event_type === 'rank_speed') || events.find((e) => e.event_type === 'rank_speed'))
            ?.event_value
        ) || 5;

      let matchFuel = 0;
      let shuttlingFuel = 0;
      let scoringFuel = 0;
      const starts = [];
      for (const e of events) {
        if (e.event_type === 'shooting_start' && inScope(e)) starts.push(e);
        else if (e.event_type === 'shooting_end' && starts.length && inScope(e)) {
          const s = starts.shift();
          const dur = (new Date(e.created_at) - new Date(s.created_at)) / 1000;
          if (dur > 0 && dur < 300) {
            const fuel = dur * speed;
            matchFuel += fuel;
            if (s.event_value === 'shuttling') shuttlingFuel += fuel;
            else scoringFuel += fuel;
          }
        }
      }

      const pickup = { ground: 0, outpost: 0, depot: 0 };
      for (const e of scoped) {
        if (e.event_type === 'pickup') {
          const src = String(e.event_value || '').toLowerCase();
          if (pickup[src] !== undefined) pickup[src] += 1;
        }
      }

      const roleTimes = { Scoring: 0, Shuttling: 0, Defense: 0, 'Counter Defense': 0, Dead: 0 };
      const roleEvents = events.filter(
        (e) => e.event_type === 'role_update' || (e.event_type === 'phase' && e.event_value === 'finish_match')
      );
      let activeRole = null;
      let roleStart = null;
      for (const e of roleEvents) {
        if (e.event_type === 'role_update') {
          if (activeRole && roleStart && roleTimes[activeRole] !== undefined && inScope(roleStart)) {
            const d = (new Date(e.created_at) - new Date(roleStart.created_at)) / 1000;
            if (d > 0 && d < 600) roleTimes[activeRole] += d;
          }
          activeRole = e.event_value;
          roleStart = e;
        } else if (activeRole && roleStart && roleTimes[activeRole] !== undefined && inScope(roleStart)) {
          const d = (new Date(e.created_at) - new Date(roleStart.created_at)) / 1000;
          if (d > 0 && d < 600) roleTimes[activeRole] += d;
        }
      }

      let climbPos = 'N/A';
      let autoPos = 'N/A';
      for (const e of scoped) {
        if (e.event_type === 'climb_pos' && e.event_value) climbPos = e.event_value;
        if (e.event_type === 'auto_climb_pos' && e.event_value) autoPos = e.event_value;
      }
      const climbKey =
        viewFilterScope === 'auto'
          ? autoPos === 'N/A'
            ? 'none'
            : String(autoPos).toLowerCase() === 'failed'
              ? 'failed'
              : 'L1'
          : climbPos === 'N/A'
            ? 'none'
            : String(climbPos).toLowerCase() === 'failed'
              ? 'failed'
              : climbPos;

      const speedVals = scoped.filter((e) => e.event_type === 'rank_speed').map((e) => parseFloat(e.event_value) || 0);
      const accVals = scoped.filter((e) => e.event_type === 'rank_accuracy').map((e) => parseFloat(e.event_value) || 0);
      const drvVals = scoped.filter((e) => e.event_type === 'rank_driving').map((e) => parseFloat(e.event_value) || 0);

      totals.fuel += matchFuel;
      totals.shooting.shuttling += shuttlingFuel;
      totals.shooting.scoring += scoringFuel;
      totals.pickup.ground += pickup.ground;
      totals.pickup.outpost += pickup.outpost;
      totals.pickup.depot += pickup.depot;
      Object.keys(roleTimes).forEach((k) => (totals.role[k] += roleTimes[k]));
      if (totals.climb[climbKey] !== undefined) totals.climb[climbKey] += 1;
      totals.speedVals.push(...speedVals);
      totals.accVals.push(...accVals);
      totals.drvVals.push(...drvVals);
      if (autoPos !== 'N/A') {
        totals.autoClimbRateN += 1;
        if (String(autoPos).toLowerCase() !== 'failed') totals.autoClimbRateMade += 1;
      }

      perMatch.push({
        key: mk,
        label,
        fuel: matchFuel,
        speed: speedVals.length ? speedVals.reduce((a, b) => a + b, 0) / speedVals.length : 0,
        accuracy: accVals.length ? accVals.reduce((a, b) => a + b, 0) / accVals.length : 0,
        driving: drvVals.length ? drvVals.reduce((a, b) => a + b, 0) / drvVals.length : 0,
        shooting: { shuttling: shuttlingFuel, scoring: scoringFuel },
        pickup,
        role: roleTimes,
        climbKey
      });
    }

    const matchCount = Math.max(selectedMatches.length, 1);

    return {
      matchCount,
      avgFuel: totals.fuel / matchCount,
      avgSpeed: totals.speedVals.length ? totals.speedVals.reduce((a, b) => a + b, 0) / totals.speedVals.length : 0,
      avgAccuracy: totals.accVals.length ? totals.accVals.reduce((a, b) => a + b, 0) / totals.accVals.length : 0,
      avgDriving: totals.drvVals.length ? totals.drvVals.reduce((a, b) => a + b, 0) / totals.drvVals.length : 0,
      autoClimbRate: totals.autoClimbRateN ? totals.autoClimbRateMade / totals.autoClimbRateN : 0,
      shooting: { shuttling: totals.shooting.shuttling / matchCount, scoring: totals.shooting.scoring / matchCount },
      pickup: {
        ground: totals.pickup.ground / matchCount,
        outpost: totals.pickup.outpost / matchCount,
        depot: totals.pickup.depot / matchCount
      },
      role: {
        Scoring: totals.role.Scoring / matchCount,
        Shuttling: totals.role.Shuttling / matchCount,
        Defense: totals.role.Defense / matchCount,
        'Counter Defense': totals.role['Counter Defense'] / matchCount,
        Dead: totals.role.Dead / matchCount
      },
      climb: {
        none: totals.climb.none / matchCount,
        L1: totals.climb.L1 / matchCount,
        L2: totals.climb.L2 / matchCount,
        L3: totals.climb.L3 / matchCount,
        failed: totals.climb.failed / matchCount
      },
      perMatch
    };
  })();

  $: statSeries = viewStats
    ? {
        fuel: viewStats.perMatch.map((m) => m.fuel),
        speed: viewStats.perMatch.map((m) => m.speed),
        accuracy: viewStats.perMatch.map((m) => m.accuracy),
        driving: viewStats.perMatch.map((m) => m.driving),
        autoClimbRate: viewStats.perMatch.map((m) => (m.climbKey !== 'none' && m.climbKey !== 'failed' ? 1 : 0))
      }
    : null;

  $: lineDefs = viewStats
    ? [
        {
          key: 'fuel',
          label: 'Total Fuel',
          color: 'var(--chart-blue)',
          value: Math.round(viewStats.avgFuel),
          fmt: (v) => String(Math.round(v))
        },
        {
          key: 'speed',
          label: 'Speed',
          color: 'var(--chart-primary)',
          value: viewStats.avgSpeed.toFixed(1),
          fmt: (v) => Number(v).toFixed(1)
        },
        {
          key: 'accuracy',
          label: 'Accuracy',
          color: 'var(--chart-success)',
          value: viewStats.avgAccuracy.toFixed(1),
          fmt: (v) => Number(v).toFixed(1)
        },
        {
          key: 'driving',
          label: 'Driving',
          color: 'var(--chart-orange)',
          value: viewStats.avgDriving.toFixed(1),
          fmt: (v) => Number(v).toFixed(1)
        },
        {
          key: 'autoClimbRate',
          label: 'Auto Climb Rate',
          color: 'var(--chart-danger)',
          value: viewStats.autoClimbRate.toFixed(2),
          fmt: (v) => Number(v).toFixed(2)
        }
      ]
    : [];

  $: shootingTotal = viewStats ? viewStats.shooting.shuttling + viewStats.shooting.scoring : 0;
  $: pickupTotal = viewStats ? viewStats.pickup.ground + viewStats.pickup.outpost + viewStats.pickup.depot : 0;
  $: climbTotal = viewStats
    ? viewStats.climb.none + viewStats.climb.L1 + viewStats.climb.L2 + viewStats.climb.L3 + viewStats.climb.failed
    : 0;
  $: roleTotal = viewStats
    ? viewStats.role.Scoring +
      viewStats.role.Shuttling +
      viewStats.role.Defense +
      viewStats.role['Counter Defense'] +
      viewStats.role.Dead
    : 0;

  onMount(async () => {
    requestedTeamKey = normalizeTeamKey($page.url.searchParams.get('team'));
    // Land directly on the requested team's own view instead of flashing the
    // generic "Search Teams" picker first - a direct link (e.g. from
    // Strategy) already knows which team it wants, so show that team's shell
    // immediately (fields fill in as openTeam's fetches resolve) rather than
    // making the visitor wait through loadTeams() before anything specific
    // to their team appears. openTeam() re-sets this to the same value once
    // it actually starts loading, so this is purely a same-tick head start.
    if (requestedTeamKey) selectedTeam = requestedTeamKey;
    const requestedEventKey = String($page.url.searchParams.get('event_key') || '').trim();
    const requestedReturnTo = String($page.url.searchParams.get('from') || '').trim();
    // Only ever follow an internal, same-origin path - a `from` value could
    // otherwise be an open-redirect vector if someone crafted the URL.
    // `//host/...` and `/\host` are excluded via safeInternalPath.
    returnTo = safeInternalPath(requestedReturnTo, '');
    returnLabel = returnTo ? String($page.url.searchParams.get('fromLabel') || 'Back').trim() : '';
    await loadEventOptions();
    if (requestedEventKey && requestedEventKey !== eventKey) selectedEventKey = requestedEventKey;
  });

  onMount(() => {
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  // Re-load the team list whenever the resolved (browsed) event changes -
  // covers both the initial async load of the active event key and the user
  // switching the event dropdown afterward.
  $: {
    if (resolvedEventKey !== lastLoadedEventKeyForTeams) {
      lastLoadedEventKeyForTeams = resolvedEventKey;
      loadPage();
    }
  }
</script>

<div class="page-header card">
  <div class="teamview-header-copy">
    {#if returnTo}
      <a class="teamview-exit-link" href={returnTo}>&larr; Back to {returnLabel}</a>
    {/if}
    <h2 class="teamview-title">Team View</h2>
    {#if resolvedEventKey}
      <div class="form-label">Event: {resolvedEventKey}</div>
    {/if}
    {#if apiNote}
      <div class="note">{apiNote}</div>
    {/if}
  </div>
  <div class="page-actions with-select">
    <SeasonFilter
      options={browseEventOptions}
      bind:value={selectedEventKey}
      allLabel={`Current Event (${activeEventLabel})`}
    />
    {#if selectedTeam}
      <button class="btn btn-secondary" on:click={backToGrid}>&larr; All teams</button>
    {/if}
    <button class="btn btn-secondary" on:click={loadPage} disabled={loading}>Refresh</button>
  </div>
</div>

{#if !selectedTeam}
  <TeamGrid
    rows={gridRows}
    eventKey={resolvedEventKey}
    {loading}
    hrefFor={teamHref}
    on:open={(event) => openFromGrid(event.detail)}
  />
{:else if $isPhone}
  <!-- Phone: a compact team header, then one tab at a time instead of one long page. -->
  <section class="tv-hero">
    <div class="tv-photo">{@render photoBlock()}</div>
    <div class="tv-id"><b>{selectedTeamNumber}</b><span>{selectedTeamName}</span></div>
    <div class="tv-stats">
      <span><small>Rank</small><b>{officialTeam?.rank ? `#${officialTeam.rank}` : '—'}</b></span>
      <span
        ><small>Record</small><b
          >{officialTeam ? `${officialTeam.wins}-${officialTeam.losses}-${officialTeam.ties}` : '—'}</b
        ></span
      >
      <span
        ><small>Auto</small><b
          >{selectedProfile?.matchScoutSummary?.avgAutoPoints == null
            ? '—'
            : selectedProfile.matchScoutSummary.avgAutoPoints.toFixed(1)}</b
        ></span
      >
      <span
        ><small>Teleop</small><b
          >{selectedProfile?.matchScoutSummary?.avgBallsScored == null
            ? '—'
            : selectedProfile.matchScoutSummary.avgBallsScored.toFixed(1)}</b
        ></span
      >
    </div>
  </section>
  <div class="tv-tabs" role="tablist" aria-label="Team sections">
    {#each PHONE_TABS as [key, label]}
      <button role="tab" aria-selected={phoneTab === key} class:on={phoneTab === key} on:click={() => (phoneTab = key)}
        >{label}</button
      >
    {/each}
  </div>
  {#if phoneTab === 'overview'}
    <section class="card star-overview">
      <h3>Event-relative profile</h3>
      {#if selectedProfile}<RobotStarPlot left={selectedProfile} />{:else}<div class="empty">
          Not enough scouting data for a profile.
        </div>{/if}
    </section>
  {:else if phoneTab === 'charts'}
    {#if !loadingTeamData || allMatchEntries.length}
      <TeamChartsPanel teamKey={selectedTeam} allEntries={allMatchEntries} matches={eventMatches} />
    {/if}
    <div class="tv-scope">{@render scopeSelect()}</div>
    {@render trendsBlock()}
  {:else if phoneTab === 'matches'}
    {@render matchesBlock()}
  {:else if phoneTab === 'pit'}
    <section class="card">{@render pitBlock()}</section>
  {:else}
    {@render notesBlock()}
  {/if}
{:else}
  <div class="team-top">
    <div class="card team-meta-box">
      <div class="team-name-box">
        <span class="team-name-primary">{selectedTeamName}</span>
        <sub class="team-name-sub">{selectedTeamNumber}</sub>
      </div>
      <div class="team-rank-strip">
        <span
          ><small>Auto points</small><strong
            >{selectedProfile?.matchScoutSummary?.avgAutoPoints == null
              ? '—'
              : selectedProfile.matchScoutSummary.avgAutoPoints.toFixed(1)}</strong
          ></span
        >
        <span
          ><small>Teleop points</small><strong
            >{selectedProfile?.matchScoutSummary?.avgBallsScored == null
              ? '—'
              : selectedProfile.matchScoutSummary.avgBallsScored.toFixed(1)}</strong
          ></span
        >
        <span><small>Event rank</small><strong>{officialTeam?.rank ? `#${officialTeam.rank}` : '—'}</strong></span>
        <span
          ><small>Record</small><strong
            >{officialTeam ? `${officialTeam.wins}-${officialTeam.losses}-${officialTeam.ties}` : '—'}</strong
          ></span
        >
      </div>
      {@render scopeSelect()}
      {@render pitBlock()}
    </div>
    <div class="card image-box">
      {@render photoBlock()}
    </div>
  </div>

  <div class="team-overview-grid">
    <section class="card star-overview">
      <h3>Event-relative profile</h3>
      {#if selectedProfile}<RobotStarPlot left={selectedProfile} />{:else}<div class="empty">
          Not enough scouting data for a profile.
        </div>{/if}
    </section>
  </div>

  {#if !loadingTeamData || allMatchEntries.length}
    <TeamChartsPanel teamKey={selectedTeam} allEntries={allMatchEntries} matches={eventMatches} />
  {/if}

  <div class="main-split">
    {@render trendsBlock()}
    {@render notesBlock()}
  </div>

  {@render matchesBlock()}
{/if}

{#snippet scopeSelect()}
  <div class="filters-row">
    <Select class="form-select" bind:value={viewFilterScope}>
      {#each SCOPE_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}
    </Select>
  </div>
{/snippet}

{#snippet pitBlock()}
  <div class="pit-accordion">
    {#if !pitEntry}
      <div class="empty">No pit data.</div>
    {:else}
      <dl class="pit-fields">
        {#each pitFieldRows as field (field.label)}
          <div class="pit-field">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        {/each}
        {#if pitDetails.strengths}
          <div class="pit-field wide">
            <dt>Strengths</dt>
            <dd><span class="pit-long-text">{pitDetails.strengths}</span></dd>
          </div>
        {/if}
        {#if pitDetails.weaknesses}
          <div class="pit-field wide">
            <dt>Weaknesses</dt>
            <dd><span class="pit-long-text">{pitDetails.weaknesses}</span></dd>
          </div>
        {/if}
        <div class="pit-field wide">
          <dt>Most likely break point</dt>
          <dd><span class="pit-long-text">{pitEntry.likely_breaking_component || '—'}</span></dd>
        </div>
        {#if pitEntry.additional_notes}
          <div class="pit-field wide">
            <dt>Notes</dt>
            <dd><span class="pit-long-text">{pitEntry.additional_notes}</span></dd>
          </div>
        {/if}
      </dl>
      {#if hasMorePitData}
        <a class="btn btn-outline btn-sm pit-full-link" href={`/pitscout?team=${selectedTeam}`}
          >View full pit scouting data</a
        >
      {/if}
      {#if pitAutoOptions.length}
        <div class="pit-auto-group">
          <div class="pit-auto-heading">Auto Options ({pitAutoOptions.length})</div>
          <div class="pit-auto-list">
            {#each pitAutoOptions as option}
              <div class="pit-auto-card" title={`${option.name}: ${option.description}`}>
                <div class="pit-auto-name">{option.name}</div>
                <div class="pit-auto-description">{option.description}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
  {#if pitEntry?.scout_name || pitDetails.pit_contact_phone || pitDetails.strat_phone}
    <div class="pit-contact">
      {#if pitEntry?.scout_name || pitDetails.pit_contact_phone}<strong>Pit contact</strong><span
          >{pitEntry?.scout_name || 'Name not recorded'}{#if pitDetails.pit_contact_phone}
            · <a href={`tel:${dialablePhone(pitDetails.pit_contact_phone)}`}>{pitDetails.pit_contact_phone}</a
            >{/if}</span
        >{/if}
      {#if pitDetails.strat_phone}<strong>Strat phone</strong><a href={`tel:${dialablePhone(pitDetails.strat_phone)}`}
          >{pitDetails.strat_phone}</a
        >{/if}
    </div>
  {/if}
{/snippet}

{#snippet photoBlock()}
  {#if tbaPhotoUrl}
    <img class="team-image" src={tbaPhotoUrl} alt={`Team ${selectedTeamNumber} robot from The Blue Alliance`} />
    {#if safeUrl(tbaPhoto?.view_url)}<a
        class="photo-credit"
        href={safeUrl(tbaPhoto.view_url)}
        target="_blank"
        rel="noopener noreferrer">View source on The Blue Alliance</a
      >{:else}<span class="photo-credit">Photo from The Blue Alliance</span>{/if}
  {:else if primaryPhoto}
    <img class="team-image" src={photoUrl(primaryPhoto)} alt={`Team ${selectedTeamNumber} pit scouting`} />
    <span class="photo-credit">Pit scouting photo</span>
  {:else}<div class="image-empty">No robot photo available</div>{/if}
{/snippet}

{#snippet trendsBlock()}
  <div class="card data-panel">
    {#if viewStats}
      <div class="stat-block">
        <h3 class="panel-title">Performance Trends</h3>
        <div class="panel-subtitle">Averages across {viewStats.matchCount} qualification matches</div>
        <div class="trend-grid">
          {#each lineDefs as stat}
            {@const values = statSeries[stat.key]}
            {@const max = Math.max(...values, 1)}
            {@const mid = max / 2}
            <details class="trend-item">
              <summary class="trend-summary"><span>{stat.label}</span><strong>{stat.value}</strong></summary>
              <svg
                viewBox={`0 0 320 ${TREND_CHART_HEIGHT}`}
                class="line"
                role="button"
                tabindex="0"
                aria-label={`${stat.label} trend. Tap to close.`}
                on:click={closeParentDetails}
                on:keydown={closeOnKey}
              >
                <defs>
                  <linearGradient id={`trend-fill-${stat.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color={stat.color} stop-opacity="0.32" />
                    <stop offset="100%" stop-color={stat.color} stop-opacity="0" />
                  </linearGradient>
                </defs>
                <line x1="34" y1={TREND_CHART_HEIGHT - 34} x2="312" y2={TREND_CHART_HEIGHT - 34} class="axis" />
                <line x1="34" y1="10" x2="34" y2={TREND_CHART_HEIGHT - 34} class="axis" />
                <line x1="34" y1={yForTick(max, max)} x2="312" y2={yForTick(max, max)} class="grid" />
                <line x1="34" y1={yForTick(mid, max)} x2="312" y2={yForTick(mid, max)} class="grid" />
                <line x1="34" y1={yForTick(0, max)} x2="312" y2={yForTick(0, max)} class="grid" />
                <text x="2" y={yForTick(max, max) + 3} class="tick">{stat.fmt(max)}</text>
                <text x="2" y={yForTick(mid, max) + 3} class="tick">{stat.fmt(mid)}</text>
                <text x="10" y={yForTick(0, max) + 3} class="tick">0</text>
                {#if viewStats.perMatch.length > 0}
                  <text x={xForIndex(0, viewStats.perMatch.length) - 8} y={TREND_CHART_HEIGHT - 8} class="tick x-tick"
                    >{viewStats.perMatch[0].label}</text
                  >
                  <text
                    x={xForIndex(viewStats.perMatch.length - 1, viewStats.perMatch.length) - 8}
                    y={TREND_CHART_HEIGHT - 8}
                    class="tick x-tick">{viewStats.perMatch[viewStats.perMatch.length - 1].label}</text
                  >
                {/if}
                <polygon class="trend-area" fill={`url(#trend-fill-${stat.key})`} points={areaPoints(values)} />
                <polyline fill="none" stroke={stat.color} stroke-width="2.5" points={linePoints(values)} />
              </svg>
            </details>
          {/each}
        </div>
      </div>

      <div class="breakdown-block">
        <h3 class="panel-title">Category Breakdowns</h3>

        <div class="break-group">
          <div class="break-legend">
            {#each BREAKDOWN_KEYS.shooting as keyItem}<span
                ><i style={`background:${keyItem.color}`}></i>{keyItem.label}{#if shootingTotal > 0}
                  {pct(viewStats.shooting[keyItem.key] || 0, shootingTotal).toFixed(0)}%{/if}</span
              >{/each}
          </div>
          <details class="break-accordion">
            <summary class="break-summary"
              ><div class="break-row">
                <span>Shooting</span>
                <div class="mini-bar">
                  {#if shootingTotal > 0}{#if viewStats.shooting.shuttling > 0}<span
                        style={`flex:${pct(viewStats.shooting.shuttling, shootingTotal)};background:${BREAKDOWN_KEYS.shooting[0].color}`}
                        title={segmentTitle('Shuttling', viewStats.shooting.shuttling, shootingTotal)}
                      ></span>{/if}{#if viewStats.shooting.scoring > 0}<span
                        style={`flex:${pct(viewStats.shooting.scoring, shootingTotal)};background:${BREAKDOWN_KEYS.shooting[1].color}`}
                        title={segmentTitle('Scoring', viewStats.shooting.scoring, shootingTotal)}
                      ></span>{/if}{/if}
                </div>
              </div></summary
            >
            <div
              class="match-stack"
              role="button"
              tabindex="0"
              aria-label="Per-match breakdown. Tap to close."
              on:click={closeParentDetails}
              on:keydown={closeOnKey}
            >
              {#each viewStats.perMatch as m}{@const shuttling = Number(m?.shooting?.shuttling) || 0}{@const scoring =
                  Number(m?.shooting?.scoring) || 0}{@const t = shuttling + scoring}
                <div class="stack-col">
                  <div class="stack">
                    {#if t > 0}{#if shuttling > 0}<span
                          style={`flex:${pct(shuttling, t)};background:${BREAKDOWN_KEYS.shooting[0].color}`}
                          title={segmentTitle('Shuttling', shuttling, t)}
                        ></span>{/if}{#if scoring > 0}<span
                          style={`flex:${pct(scoring, t)};background:${BREAKDOWN_KEYS.shooting[1].color}`}
                          title={segmentTitle('Scoring', scoring, t)}
                        ></span>{/if}{/if}
                  </div>
                  <small>{m.label}</small>
                </div>{/each}
            </div>
          </details>
        </div>

        <div class="break-group">
          <div class="break-legend">
            {#each BREAKDOWN_KEYS.pickup as keyItem}<span
                ><i style={`background:${keyItem.color}`}></i>{keyItem.label}{#if pickupTotal > 0}
                  {pct(viewStats.pickup[keyItem.key] || 0, pickupTotal).toFixed(0)}%{/if}</span
              >{/each}
          </div>
          <details class="break-accordion">
            <summary class="break-summary"
              ><div class="break-row">
                <span>Pickup</span>
                <div class="mini-bar">
                  {#if pickupTotal > 0}{#if viewStats.pickup.ground > 0}<span
                        style={`flex:${pct(viewStats.pickup.ground, pickupTotal)};background:${BREAKDOWN_KEYS.pickup[0].color}`}
                        title={segmentTitle('Ground', viewStats.pickup.ground, pickupTotal)}
                      ></span>{/if}{#if viewStats.pickup.outpost > 0}<span
                        style={`flex:${pct(viewStats.pickup.outpost, pickupTotal)};background:${BREAKDOWN_KEYS.pickup[1].color}`}
                        title={segmentTitle('Outpost', viewStats.pickup.outpost, pickupTotal)}
                      ></span>{/if}{#if viewStats.pickup.depot > 0}<span
                        style={`flex:${pct(viewStats.pickup.depot, pickupTotal)};background:${BREAKDOWN_KEYS.pickup[2].color}`}
                        title={segmentTitle('Depot', viewStats.pickup.depot, pickupTotal)}
                      ></span>{/if}{/if}
                </div>
              </div></summary
            >
            <div
              class="match-stack"
              role="button"
              tabindex="0"
              aria-label="Per-match breakdown. Tap to close."
              on:click={closeParentDetails}
              on:keydown={closeOnKey}
            >
              {#each viewStats.perMatch as m}{@const ground = Number(m?.pickup?.ground) || 0}{@const outpost =
                  Number(m?.pickup?.outpost) || 0}{@const depot = Number(m?.pickup?.depot) || 0}{@const t =
                  ground + outpost + depot}
                <div class="stack-col">
                  <div class="stack">
                    {#if t > 0}{#if ground > 0}<span
                          style={`flex:${pct(ground, t)};background:${BREAKDOWN_KEYS.pickup[0].color}`}
                          title={segmentTitle('Ground', ground, t)}
                        ></span>{/if}{#if outpost > 0}<span
                          style={`flex:${pct(outpost, t)};background:${BREAKDOWN_KEYS.pickup[1].color}`}
                          title={segmentTitle('Outpost', outpost, t)}
                        ></span>{/if}{#if depot > 0}<span
                          style={`flex:${pct(depot, t)};background:${BREAKDOWN_KEYS.pickup[2].color}`}
                          title={segmentTitle('Depot', depot, t)}
                        ></span>{/if}{/if}
                  </div>
                  <small>{m.label}</small>
                </div>{/each}
            </div>
          </details>
        </div>

        <div class="break-group">
          <div class="break-legend">
            {#each BREAKDOWN_KEYS.climb as keyItem}<span
                ><i style={`background:${keyItem.color}`}></i>{keyItem.label}{#if climbTotal > 0}
                  {pct(viewStats.climb[keyItem.key] || 0, climbTotal).toFixed(0)}%{/if}</span
              >{/each}
          </div>
          <details class="break-accordion">
            <summary class="break-summary"
              ><div class="break-row">
                <span>Climb</span>
                <div class="mini-bar">
                  {#if climbTotal > 0}{#each BREAKDOWN_KEYS.climb as keyItem}{@const value =
                        viewStats.climb[keyItem.key] || 0}{#if value > 0}<span
                          style={`flex:${pct(value, climbTotal)};background:${keyItem.color}`}
                          title={segmentTitle(keyItem.label, value, climbTotal)}
                        ></span>{/if}{/each}{/if}
                </div>
              </div></summary
            >
            <div
              class="match-stack"
              role="button"
              tabindex="0"
              aria-label="Per-match breakdown. Tap to close."
              on:click={closeParentDetails}
              on:keydown={closeOnKey}
            >
              {#each viewStats.perMatch as m}<div class="stack-col">
                  <div class="stack">
                    {#if m.climbKey === 'none'}<span
                        style={`flex:1;background:${BREAKDOWN_KEYS.climb[0].color}`}
                        title="None: 100.0%"
                      ></span>{:else if m.climbKey === 'L1'}<span
                        style={`flex:1;background:${BREAKDOWN_KEYS.climb[1].color}`}
                        title="L1: 100.0%"
                      ></span>{:else if m.climbKey === 'L2'}<span
                        style={`flex:1;background:${BREAKDOWN_KEYS.climb[2].color}`}
                        title="L2: 100.0%"
                      ></span>{:else if m.climbKey === 'L3'}<span
                        style={`flex:1;background:${BREAKDOWN_KEYS.climb[3].color}`}
                        title="L3: 100.0%"
                      ></span>{:else}<span
                        style={`flex:1;background:${BREAKDOWN_KEYS.climb[4].color}`}
                        title="Failed: 100.0%"
                      ></span>{/if}
                  </div>
                  <small>{m.label}</small>
                </div>{/each}
            </div>
          </details>
        </div>

        <div class="break-group">
          <div class="break-legend">
            {#each BREAKDOWN_KEYS.role as keyItem}<span
                ><i style={`background:${keyItem.color}`}></i>{keyItem.label}{#if roleTotal > 0}
                  {pct(viewStats.role[keyItem.key] || 0, roleTotal).toFixed(0)}%{/if}</span
              >{/each}
          </div>
          <details class="break-accordion">
            <summary class="break-summary"
              ><div class="break-row">
                <span>Role</span>
                <div class="mini-bar">
                  {#if roleTotal > 0}{#each BREAKDOWN_KEYS.role as keyItem}{@const value =
                        viewStats.role[keyItem.key] || 0}{#if value > 0}<span
                          style={`flex:${pct(value, roleTotal)};background:${keyItem.color}`}
                          title={segmentTitle(keyItem.label, value, roleTotal)}
                        ></span>{/if}{/each}{/if}
                </div>
              </div></summary
            >
            <div
              class="match-stack"
              role="button"
              tabindex="0"
              aria-label="Per-match breakdown. Tap to close."
              on:click={closeParentDetails}
              on:keydown={closeOnKey}
            >
              {#each viewStats.perMatch as m}{@const roleScoring = Number(m?.role?.Scoring) || 0}{@const roleShuttling =
                  Number(m?.role?.Shuttling) || 0}{@const roleDefense =
                  Number(m?.role?.Defense) || 0}{@const roleCounterDefense =
                  Number(m?.role?.['Counter Defense']) || 0}{@const roleDead = Number(m?.role?.Dead) || 0}{@const t =
                  roleScoring + roleShuttling + roleDefense + roleCounterDefense + roleDead}
                <div class="stack-col">
                  <div class="stack">
                    {#if t > 0}{#each BREAKDOWN_KEYS.role as keyItem}{@const value =
                          Number(m?.role?.[keyItem.key]) || 0}{#if value > 0}<span
                            style={`flex:${pct(value, t)};background:${keyItem.color}`}
                            title={segmentTitle(keyItem.label, value, t)}
                          ></span>{/if}{/each}{/if}
                  </div>
                  <small>{m.label}</small>
                </div>{/each}
            </div>
          </details>
        </div>
      </div>
    {:else if loadingTeamData}
      <div class="empty">Loading team data...</div>
    {:else}
      <div class="empty">No scouting data for the selected filters.</div>
    {/if}
  </div>
{/snippet}

{#snippet notesBlock()}
  <div class="card notes-panel">
    <h3 class="notes-title">Scout Notes</h3>
    {#if !teamNotes.length}
      <div class="empty">No notes yet.</div>
    {:else}
      {#each teamNotes as note}
        <div class="note-row">
          <div class="note-meta">
            Match {note.match_number || '-'} - {formatLocalDateTimeWithZone(note.created_at)}
          </div>
          <div>{note.notes || '-'}</div>
        </div>
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet matchesBlock()}
  <section class="card match-history-card">
    <div class="section-title-row">
      <div>
        <h3>Previous matches</h3>
        <p>Official scores and recordings from The Blue Alliance.</p>
      </div>
      <strong>{playedTeamMatches.length}</strong>
    </div>
    {#if playedTeamMatches.length}
      <div class="match-history-list">
        {#each playedTeamMatches as match (match.key)}
          {@const alliance = allianceForTeam(match)}
          <div class="match-history-row">
            <div>
              <strong>{match.key.split('_').at(-1).toUpperCase()}</strong><span
                class:alliance-red={alliance === 'red'}
                class:alliance-blue={alliance === 'blue'}>{alliance} alliance</span
              >
            </div>
            <span>{match.alliances?.[alliance]?.team_keys?.map(displayTeam).join(', ')}</span>
            <strong>{matchResult(match)}</strong>
            <button type="button" class="btn btn-secondary btn-sm" on:click={() => (selectedVideoMatch = match)}
              >{match.videos?.length ? 'Watch video' : 'Open on TBA'}</button
            >
          </div>
        {/each}
      </div>
    {:else}<div class="empty">No completed matches are posted for this team yet.</div>{/if}
  </section>

  <!-- Folded by default: a season of other events can be close to a hundred matches. -->
  <details class="card match-history-card other-events">
    <summary class="section-title-row match-history-summary">
      <div>
        <h3><ChevronRight size={16} class="match-history-chevron" /> Match history at other events</h3>
        <p>This season's matches from The Blue Alliance, outside the currently viewed event.</p>
      </div>
      <strong>{crossEventMatches.length}</strong>
    </summary>
    {#if crossEventMatchesNote}<div class="empty">{crossEventMatchesNote}</div>
    {:else if crossEventMatches.length}
      <div class="match-history-list">
        {#each crossEventMatches as match (match.key)}
          {@const alliance = allianceForTeam(match)}
          <div class="match-history-row">
            <div>
              <strong>{match.event_key}</strong> <span>{match.key.split('_').at(-1).toUpperCase()}</span><span
                class:alliance-red={alliance === 'red'}
                class:alliance-blue={alliance === 'blue'}>{alliance} alliance</span
              >
            </div>
            <span>{match.alliances?.[alliance]?.team_keys?.map(displayTeam).join(', ')}</span>
            <strong>{matchResult(match)}</strong>
            <button type="button" class="btn btn-secondary btn-sm" on:click={() => (selectedVideoMatch = match)}
              >{match.videos?.length ? 'Watch video' : 'Open on TBA'}</button
            >
          </div>
        {/each}
      </div>
    {:else}<div class="empty">No other-event matches found for this team this season yet.</div>{/if}
  </details>

  <section class="card manual-reports-card">
    <div class="section-title-row">
      <div>
        <h3>Manual match reports</h3>
        <p>Every submitted report for Team {selectedTeamNumber} at this event.</p>
      </div>
      <strong>{matchEntries.length}</strong>
    </div>
    {#if matchEntries.length}
      {#each matchEntries as report (report.id)}<MatchScoutReport {report} />{/each}
    {:else}<div class="empty">No manual match reports yet.</div>{/if}
  </section>
{/snippet}

<MatchVideoModal match={selectedVideoMatch} on:close={() => (selectedVideoMatch = null)} />

<style>
  .teamview-header-copy {
    display: grid;
    gap: var(--gap-1);
  }
  .teamview-title {
    margin: 0;
  }
  .teamview-exit-link {
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--text-muted);
    text-decoration: none;
  }
  .teamview-exit-link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .team-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: var(--gap-3);
    margin-bottom: var(--space-2);
  }
  .team-meta-box {
    display: grid;
    gap: var(--gap-3);
  }
  .team-name-box {
    font-size: var(--font-xl);
    font-weight: 800;
    line-height: 1.2;
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .team-name-sub {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .team-rank-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .team-rank-strip span {
    display: grid;
    gap: 2px;
    padding: var(--space-2);
    border-right: 1px solid var(--border);
  }
  .team-rank-strip span:last-child {
    border-right: 0;
  }
  .team-rank-strip small {
    color: var(--text-muted);
    font-size: 0.66rem;
    text-transform: uppercase;
  }
  .filters-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gap-2);
    max-width: 260px;
  }
  .image-box {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: var(--space-2);
    min-height: 240px;
  }
  .team-image,
  .image-empty {
    width: 100%;
    height: 240px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .team-image {
    object-fit: cover;
  }
  .image-empty {
    display: grid;
    place-items: center;
    color: var(--text-muted);
    font-size: var(--font-sm);
    background: var(--surface-1);
  }
  .photo-credit {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .pit-full-link {
    display: inline-flex;
    text-decoration: none;
  }
  /* Pit answers fill the card's width in columns, label above value. */
  .pit-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--space-3) var(--space-4);
    margin: var(--space-2) 0;
    font-size: var(--font-sm);
  }
  .pit-field {
    min-width: 0;
  }
  .match-history-summary {
    cursor: pointer;
    list-style: none;
  }
  .match-history-summary::-webkit-details-marker {
    display: none;
  }
  .match-history-summary h3 {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .other-events :global(.match-history-chevron) {
    transition: transform 0.15s ease;
  }
  .other-events[open] :global(.match-history-chevron) {
    transform: rotate(90deg);
  }
  .other-events[open] .match-history-summary {
    margin-bottom: var(--space-2);
  }
  .pit-field.wide {
    grid-column: 1 / -1;
  }
  .pit-field dt {
    color: var(--text-muted);
    font-size: max(0.72rem, var(--text-min));
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pit-field dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
  }
  /* Only the scout's own text keeps its line breaks, so markup formatting never shows on screen. */
  .pit-long-text {
    white-space: pre-wrap;
  }
  .pit-auto-group {
    display: grid;
    gap: var(--gap-2);
    margin-top: var(--space-2);
  }
  .pit-auto-heading {
    font-size: var(--font-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .pit-auto-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: var(--gap-2);
  }
  .pit-auto-card {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  }
  .pit-contact {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.25rem var(--gap-2);
    align-items: baseline;
    padding: var(--space-2);
    border-top: 1px solid var(--border);
    font-size: 0.82rem;
  }
  .pit-contact span {
    color: var(--text-muted);
  }
  .pit-auto-name {
    font-size: var(--font-sm);
    font-weight: 700;
    line-height: 1.2;
  }
  .pit-auto-description {
    font-size: var(--font-xs);
    color: var(--text-muted);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .team-overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gap-3);
    margin: var(--space-3) 0;
  }
  .star-overview h3,
  .section-title-row h3 {
    margin: 0;
  }
  .section-title-row p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .star-overview {
    display: grid;
    align-content: start;
  }
  .main-split {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(300px, 3fr);
    gap: var(--gap-3);
  }
  .data-panel {
    display: grid;
    gap: var(--gap-3);
  }
  .stat-block,
  .breakdown-block {
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-1) 0;
    display: grid;
    gap: var(--gap-3);
  }
  .trend-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-2);
  }
  .trend-item {
    border-radius: var(--radius-sm);
    padding: 0;
    background: transparent;
    display: block;
  }
  .trend-summary {
    cursor: pointer;
    list-style: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gap-2);
    align-items: center;
    padding: var(--space-1) var(--space-2) var(--space-2);
  }
  .trend-summary::marker {
    content: '';
  }
  .trend-summary::-webkit-details-marker {
    display: none;
  }
  .panel-title {
    margin: 0;
    font-size: var(--font-md);
  }
  .panel-subtitle {
    font-size: var(--font-xs);
    color: var(--text-muted);
  }
  .line {
    width: 100%;
    height: 240px;
    margin: 0;
    background: color-mix(in srgb, var(--surface-1) 90%, transparent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .trend-area {
    pointer-events: none;
  }
  .axis {
    stroke: color-mix(in srgb, var(--text) 35%, transparent);
    stroke-width: 1;
  }
  .grid {
    stroke: color-mix(in srgb, var(--text) 14%, transparent);
    stroke-width: 1;
  }
  .tick {
    font-size: 9px;
    fill: var(--text-muted);
  }
  .x-tick {
    font-size: 8px;
  }
  .break-group {
    display: grid;
    gap: var(--gap-1);
    padding-top: var(--space-1);
  }
  .break-accordion {
    border: none;
    border-radius: var(--radius-sm);
    padding: 0;
    background: transparent;
  }
  .break-summary {
    cursor: pointer;
    display: block;
    list-style: none;
    padding: var(--space-2) var(--space-2) 0;
  }
  .break-summary::marker {
    content: '';
  }
  .break-summary::-webkit-details-marker {
    display: none;
  }
  .break-accordion[open] .break-summary {
    margin-bottom: var(--space-1);
  }
  .break-accordion[open] .match-stack {
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }
  .break-legend {
    padding: 0 var(--space-2) var(--space-1);
  }
  .break-row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    align-items: center;
    gap: var(--gap-2);
  }
  .break-legend {
    display: flex;
    gap: var(--gap-2);
    flex-wrap: wrap;
    font-size: var(--font-xs);
    color: var(--text-muted);
  }
  .break-legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .break-legend i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  .mini-bar {
    display: flex;
    height: 14px;
    background: color-mix(in srgb, var(--surface-1) 50%, transparent);
    border-radius: var(--radius-xs);
    overflow: hidden;
    gap: 0;
    font-size: 0;
  }
  .mini-bar span {
    display: block;
    min-width: 0;
    flex-shrink: 0;
    transform: scaleX(1.02);
  }
  .match-stack {
    display: flex;
    gap: var(--gap-1);
    overflow-x: auto;
    padding: var(--space-1) 0;
    cursor: pointer;
  }
  .stack-col {
    display: grid;
    justify-items: center;
    gap: 0.2rem;
  }
  .stack {
    width: 18px;
    height: 140px;
    display: flex;
    flex-direction: column-reverse;
    align-items: stretch;
    border-radius: var(--radius-xs);
    overflow: hidden;
    background: color-mix(in srgb, var(--surface-1) 50%, transparent);
    gap: 0;
    font-size: 0;
  }
  .stack span {
    display: block;
    width: 100%;
    min-height: 0;
    flex-shrink: 0;
    transform: scaleY(1.02);
  }
  .stack-col small {
    font-size: 0.62rem;
    color: var(--text-muted);
  }
  .notes-panel {
    max-height: 780px;
    overflow: auto;
  }
  .notes-title {
    margin: 0 0 var(--space-2);
  }
  .note-row {
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    margin-bottom: var(--space-2);
    background: color-mix(in srgb, var(--surface-1) 90%, transparent);
  }
  .note-meta {
    font-size: var(--font-xs);
    color: var(--text-muted);
    margin-bottom: var(--space-1);
  }
  .match-history-card,
  .manual-reports-card {
    margin-top: var(--space-3);
  }
  .section-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }
  .section-title-row > strong {
    display: grid;
    place-items: center;
    min-width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .match-history-list {
    display: grid;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
  }
  .match-history-row {
    display: grid;
    grid-template-columns: minmax(8rem, 0.7fr) minmax(12rem, 1fr) minmax(8rem, 0.7fr) auto;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-1);
  }
  .match-history-row > div {
    display: flex;
    gap: var(--gap-2);
    align-items: center;
  }
  .match-history-row > div span {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: capitalize;
  }
  .alliance-red {
    color: var(--status-danger);
  }
  .alliance-blue {
    color: var(--brand-blue, #2563eb);
  }
  @media (max-width: 980px) {
    .team-top,
    .team-overview-grid,
    .main-split {
      grid-template-columns: 1fr;
    }
    .trend-grid {
      grid-template-columns: 1fr;
    }
    .match-history-row {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 640px) {
    .break-row {
      grid-template-columns: 90px minmax(0, 1fr);
    }
    .team-name-box {
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }
    .team-rank-strip {
      grid-template-columns: repeat(2, 1fr);
    }
    .team-rank-strip span:nth-child(2) {
      border-right: 0;
    }
    .team-rank-strip span:nth-child(-n + 2) {
      border-bottom: 1px solid var(--border);
    }
    .match-history-row {
      grid-template-columns: 1fr;
    }
  }

  /* Phone */
  @media (max-width: 900px) {
    .page-header .teamview-header-copy .form-label {
      display: none;
    }
  }
  .tv-hero {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    grid-template-areas: 'photo id' 'stats stats';
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface-1);
  }
  .tv-photo {
    grid-area: photo;
    width: 96px;
    height: 72px;
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .tv-photo :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 0;
    border-radius: 0;
  }
  .tv-photo :global(.photo-credit) {
    display: none;
  }
  .tv-photo :global(.image-empty) {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border: 0;
    font-size: 0.7rem;
    text-align: center;
    color: var(--text-muted);
  }
  .tv-id {
    grid-area: id;
    display: grid;
    align-content: center;
    min-width: 0;
  }
  .tv-id b {
    font-family: var(--font-mono);
    font-size: 1.8rem;
    line-height: 1;
  }
  .tv-id span {
    color: var(--text-secondary);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tv-stats {
    grid-area: stats;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  .tv-stats span {
    display: grid;
    justify-items: center;
    padding: 6px 2px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .tv-stats small {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .tv-stats b {
    font-family: var(--font-mono);
    font-size: 1rem;
  }
  .tv-tabs {
    position: sticky;
    top: calc(3rem + env(safe-area-inset-top, 0px));
    z-index: 4;
    display: flex;
    gap: 2px;
    margin-bottom: var(--space-3);
    padding: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .tv-tabs button {
    flex: 1 0 auto;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .tv-tabs button.on {
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-raised);
  }
  .tv-scope {
    margin: var(--space-3) 0;
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .tv-id span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>
