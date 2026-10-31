<script>
  import { suggest } from '$lib/ui/suggest.js';
  import CustomQuestions from '$lib/components/forms/CustomQuestions.svelte';
  import { fetchLiveForm } from '$lib/scouting/forms/formsClient.js';
  import {
    createLayout,
    emptyForm,
    firstMissing,
    questionsIn,
    sanitizeAnswers
  } from '$lib/scouting/forms/formSchema.js';
  import Select from '$lib/components/common/Select.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { holdScreenAwake } from '$lib/ui/wakeLock.js';
  import { isPhone } from '$lib/stores/device.js';
  import { scoutIdentity } from '$lib/scouting/scoutIdentity.js';
  import {
    BALL_COUNT_RANGES,
    MATCH_FORM_RATING_FIELDS,
    MATCH_OPTIONAL_RATING_FIELDS,
    MATCH_FORM_ROLES as TELEOP_ROLES,
    AUTO_FUEL_SOURCES,
    ACCURACY_LABELS,
    BPS_LABELS,
    validateMatchScoutForm,
    validatePerformanceRatings,
    validateRobotCondition,
    parseAutoPointsEstimate
  } from '$lib/scouting/matchScouting.js';
  import { userProfile } from '$lib/stores/auth.js';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import { submitOrQueue } from '$lib/app/offlineQueue.js';
  import { canonicalMatchKey, matchInputValue } from '$lib/matches/matchKeys.js';
  import { matchLabel } from '$lib/matches/matchKeys.js';
  import { radarPoint } from '$lib/charts/radar.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import OfflineSyncBadge from '$lib/components/common/OfflineSyncBadge.svelte';
  import {
    AlertTriangle,
    ArrowLeftRight,
    Check,
    ChevronRight,
    ClipboardCheck,
    ExternalLink,
    Gauge,
    GraduationCap,
    MapPinned,
    Minus,
    Plus,
    Route,
    Shuffle,
    Timer,
    Trophy,
    Wrench
  } from 'lucide-svelte';
  import PowerRankingPicker from '$lib/components/scouting/PowerRankingPicker.svelte';
  import { youtubeUrl } from '$lib/scouting/training.js';
  import {
    REPORT_KINDS,
    REPORT_KIND_LABELS,
    REPORT_KIND_PHASES,
    defaultReportKind,
    reportKindOf
  } from '$lib/scouting/reportKinds.js';

  const START_POSITIONS = ['left trench', 'left mound', 'center', 'right mound', 'right trench'];
  const RATING_FIELDS = [...MATCH_FORM_RATING_FIELDS, ...MATCH_OPTIONAL_RATING_FIELDS];
  const TELEOP_RATING_FIELDS = MATCH_FORM_RATING_FIELDS;
  const BALL_SOURCE_OPTIONS = AUTO_FUEL_SOURCES.map((source) => [source, source]);
  const AUTO_POINTS_SLIDER_MAX = 500;

  let phase = 'prematch';
  // Questions an admin added in Scouting Admin > Edit, and this scout's answers to them.
  let customForm = { version: 0, schema: emptyForm() };
  let customAnswers = {};
  let showMissing = false;
  // Data, Performance and Robot scouting are separate tabs: each walks only its own stages and saves its own report.
  // A scout starts on the tab their Scouting Admin role names (Data, Performance or Robot Scout Member).
  let reportKind = 'data';
  let kindChosen = false;
  $: if (!kindChosen && $userProfile?.roster_keys) reportKind = defaultReportKind($userProfile.roster_keys);
  $: kindPhases = REPORT_KIND_PHASES[reportKind];
  const PHASE_INFO = {
    prematch: { label: 'Pre-match', icon: MapPinned },
    auto: { label: 'Auto', icon: Route },
    teleop: { label: 'Teleop', icon: Timer },
    shuttling: { label: 'Shuttling', icon: Shuffle },
    performance: { label: 'Performance', icon: Gauge },
    robot: { label: 'Robot', icon: Wrench },
    postmatch: { label: 'Post-match', icon: Trophy }
  };
  const KIND_ICONS = { data: Route, performance: Gauge, robot: Wrench };
  // Short names that fit one line on a phone.
  const KIND_SHORT = { data: 'Data', performance: 'Performance', robot: 'Robot' };
  const KIND_TINY = { data: 'Data', performance: 'Perf', robot: 'Robot' };
  const PHASE_SHORT = {
    prematch: 'Pre',
    auto: 'Auto',
    teleop: 'Teleop',
    shuttling: 'Shuttle',
    performance: 'Rate',
    robot: 'Robot',
    postmatch: 'Post'
  };
  const phaseAfter = (current) => kindPhases[kindPhases.indexOf(current) + 1] || 'postmatch';
  const phaseBefore = (current) => kindPhases[kindPhases.indexOf(current) - 1] || 'prematch';
  $: layout = createLayout(customForm.schema, 'match');
  $: orders = layout.orders;
  const customIn = (id) => questionsIn(customForm.schema, id);
  // The first phase (from `phases`) that still has an unanswered required added question.
  function missingCustom(phases) {
    // A robot that never came out answers nothing else, added questions included.
    if (robotPresent === false) return null;
    for (const id of phases) {
      const question = firstMissing(customIn(id), customAnswers);
      if (question) return { phase: id, question };
    }
    return null;
  }
  // Moves forward only once the current phase's required added questions are answered.
  function advanceFrom(current, next, extra) {
    const missing = missingCustom([current]);
    if (missing) {
      showMissing = true;
      error = `Answer “${missing.question.label}” to continue.`;
      return;
    }
    error = '';
    extra?.();
    selectPhase(next);
  }
  let matchNumber = '';
  let robotNumber = '';
  let alliance = 'red';
  let startingPosition = '';
  let scoutName = '';
  let preload = null;
  // On every tab: did the robot show up to the field? It starts at Yes (a robot nobody says was missing showed up);
  // "No" makes every other question optional, and tapping No again goes back to Yes.
  let robotPresent = true;
  $: noShow = robotPresent === false;
  const setRobotPresent = (value) => (robotPresent = value === false && robotPresent === false ? true : value);
  let autoCycles = null;
  let ratingsUnknown = [];
  let teleopRolesNone = false;
  let significantCrash = null;
  let crashTarget = '';
  let crashDetails = '';
  let teleopRobotStatus = '';
  let mechanicalBreak = null;
  let autoPoints = '';
  let autoMoved = '';
  let ballSources = [];
  let ballsScored = '';
  let autoCollision = false;
  let autoCollisionNotes = '';
  let ratings = Object.fromEntries(RATING_FIELDS.map((field) => [field, 0]));
  let teleopRoles = [];
  let teleopNotes = '';
  let intakeSpeed = 0;
  let intakeJammed = false;
  let robotDisabled = '';
  let card = '';
  let driverSkill;
  let pitProblem = false;
  let pitProblemDetails = '';
  let beached = false;
  let postNotes = '';
  // Shuttling, Performance and Robot sections. Every answer here is optional.
  let shuttled = null;
  let shuttleBand = '';
  let shuttleRating = 0;
  let shuttleNotes = '';
  let offenseRating = 0;
  let defenseRating = 0;
  let performanceNotes = '';
  let powerRanking = {};
  let rankingSkipped = [];
  let foulsMinor = null;
  let foulsMajor = null;
  let breakDetails = '';
  let breakImpact = '';
  let breakResponse = '';
  // The robots in this match (for the power ranking) and, for a training match, the past match being watched.
  let matchTeams = { red: [], blue: [], training: null };
  let matchTeamsLoading = false;
  let matchTeamsFor = '';
  let submitted = false;
  let queuedOffline = false;
  let pitNotificationWarning = '';
  let editing = false;
  let showReports = false;
  let myReports = [];
  let reportsLoading = false;
  let reportsError = '';
  let reportFilter = '';
  let activeEventKey = '';
  let eventKey = '';
  let availableEvents = [];
  let eventTeams = [];
  let saving = false;
  let startPhotos = {};
  let startPhotoError = '';
  // Scouts sit on either side of the field. Flipping turns the starting-position pictures 180 degrees and reverses
  // their order so the lane on the scout's left is the leftmost card. Only the picture changes, never the answer.
  // Remembered per device, since a scout usually keeps one seat.
  const FLIP_STORAGE_KEY = 'matchscout:flip-start-view';
  let flipStartView = false;
  $: startCards = START_POSITIONS.map((position, index) => ({ position, index }));
  $: shownStartCards = flipStartView ? [...startCards].reverse() : startCards;
  function toggleStartView() {
    flipStartView = !flipStartView;
    try {
      localStorage.setItem(FLIP_STORAGE_KEY, flipStartView ? '1' : '0');
    } catch {
      /* storage can be unavailable */
    }
  }
  let error = '';
  $: if (!scoutName && $userProfile?.full_name && !$userProfile.full_name.includes('@'))
    scoutName = $userProfile.full_name;

  // Preload and starting position are data-scouting questions; the other tabs only need the match and robot.
  // The match box takes "12", "Q12", "sf2m1" or "f1m2"; anything else would be stored as free text.
  $: matchKeyValid = !matchNumber.trim() || !eventKey || Boolean(canonicalMatchKey(matchNumber, eventKey));
  $: assignmentReady =
    matchNumber.trim() &&
    matchKeyValid &&
    robotNumber.trim() &&
    scoutName.trim() &&
    (noShow || reportKind !== 'data' || (startingPosition && typeof preload === 'boolean'));
  $: assignmentLabel = assignmentReady ? `Match ${matchNumber} · Robot ${robotNumber}` : 'Set your assignment';
  // The pit crew handoff belongs to Robot scouting, the tab that watches the robot's condition.
  $: requiresPitReport =
    reportKind === 'robot' &&
    (mechanicalBreak === true ||
      robotDisabled === 'disabled' ||
      robotDisabled === 'died' ||
      teleopRobotStatus === 'dead');
  $: shouldReportPitProblem = reportKind === 'robot' && (requiresPitReport || pitProblem);
  $: canFinish = !saving && !autoPointsInvalid && (!shouldReportPitProblem || pitProblemDetails.trim());
  $: autoPointsEstimate = parseAutoPointsEstimate(autoPoints);
  $: ballsEstimate = ballsScored ? parseAutoPointsEstimate(ballsScored) : null;
  $: autoPointsInvalid = Boolean(autoPoints.trim()) && !autoPointsEstimate;
  // Drives the slider's thumb position from whatever is currently typed -
  // an exact number sits at its own value, a range/lower-bound sits at its
  // midpoint-or-min estimate, and an empty/unparseable field sits at 0.
  $: autoPointsSliderValue = Math.max(
    0,
    Math.min(AUTO_POINTS_SLIDER_MAX, Math.round(autoPointsEstimate?.average ?? 0))
  );
  $: competitionOptions = [
    ...new Map(
      [
        ...(activeEventKey ? [{ value: activeEventKey, label: activeEventKey }] : []),
        ...(eventKey ? [{ value: eventKey, label: eventKey }] : []),
        ...availableEvents
      ].map((option) => [option.value, option])
    ).values()
  ].sort((a, b) => b.value.localeCompare(a.value));

  function setAutoPointsFromSlider(rawValue) {
    const value = Number(rawValue);
    autoPoints = value >= AUTO_POINTS_SLIDER_MAX ? `${AUTO_POINTS_SLIDER_MAX}+` : String(value);
  }

  function selectPhase(nextPhase) {
    phase = nextPhase;
    showMissing = false;
    submitted = false;
    queuedOffline = false;
    pitNotificationWarning = '';
  }

  function nextAssignment() {
    matchNumber = '';
    robotNumber = '';
    startingPosition = '';
    preload = null;
    robotPresent = true;
    clearAnswers();
  }

  // Everything but the assignment (match, robot, alliance, scout), so switching tabs keeps the robot being watched.
  function clearAnswers() {
    editing = false;
    autoPoints = '';
    autoMoved = '';
    autoCycles = null;
    ballSources = [];
    ballsScored = '';
    autoCollision = false;
    autoCollisionNotes = '';
    customAnswers = {};
    ratings = Object.fromEntries(RATING_FIELDS.map((field) => [field, 0]));
    ratingsUnknown = [];
    teleopRoles = [];
    teleopRolesNone = false;
    teleopNotes = '';
    intakeSpeed = 0;
    intakeJammed = false;
    significantCrash = null;
    crashTarget = '';
    crashDetails = '';
    teleopRobotStatus = '';
    mechanicalBreak = null;
    robotDisabled = '';
    card = '';
    driverSkill = undefined;
    pitProblem = false;
    pitProblemDetails = '';
    beached = false;
    postNotes = '';
    error = '';
    shuttled = null;
    shuttleBand = '';
    shuttleRating = 0;
    shuttleNotes = '';
    offenseRating = 0;
    defenseRating = 0;
    performanceNotes = '';
    powerRanking = {};
    rankingSkipped = [];
    foulsMinor = null;
    foulsMajor = null;
    breakDetails = '';
    breakImpact = '';
    breakResponse = '';
    selectPhase('prematch');
  }

  function switchKind(kind) {
    if (kind === reportKind || saving) return;
    kindChosen = true;
    reportKind = kind;
    clearAnswers();
    const url = new URL(window.location.href);
    url.searchParams.set('tab', kind);
    window.history.replaceState({}, '', url);
  }

  function setRobotStatus(status) {
    robotDisabled = status;
    if (status === 'disabled' || status === 'died') pitProblem = true;
  }

  function toggleTeleopRole(role) {
    teleopRolesNone = false;
    teleopRoles = teleopRoles.includes(role) ? teleopRoles.filter((entry) => entry !== role) : [...teleopRoles, role];
  }

  function toggleRating(field, value) {
    const next = ratings[field] === value ? 0 : value;
    ratings = { ...ratings, [field]: next };
    ratingsUnknown = next
      ? ratingsUnknown.filter((entry) => entry !== field)
      : [...new Set([...ratingsUnknown, field])];
  }

  function formAnswers() {
    return {
      robot_present: robotPresent,
      scout_name: scoutName,
      preload,
      teleop_roles: teleopRoles,
      teleop_roles_none: teleopRolesNone,
      balls_scored_band: ballsScored
    };
  }

  const ratingAnswers = () => ({ robot_present: robotPresent, ratings, ratings_unknown: ratingsUnknown });

  const conditionAnswers = () => ({
    robot_present: robotPresent,
    significant_crash: significantCrash,
    crash_target: crashTarget,
    crash_details: crashDetails,
    teleop_robot_status: teleopRobotStatus
  });

  function continueFromTeleop() {
    const invalid = validateMatchScoutForm(formAnswers());
    if (invalid) {
      error = invalid;
      return;
    }
    advanceFrom('teleop', 'shuttling');
  }

  function continueFromPerformance() {
    const invalid = validatePerformanceRatings(ratingAnswers());
    if (invalid) {
      error = invalid;
      return;
    }
    advanceFrom('performance', 'postmatch');
  }

  function continueFromRobot() {
    const invalid = validateRobotCondition(conditionAnswers());
    if (invalid) {
      error = invalid;
      return;
    }
    if (!noShow && typeof mechanicalBreak !== 'boolean') {
      error = 'Select whether a mechanical break occurred.';
      return;
    }
    if (shouldReportPitProblem && !pitProblemDetails.trim()) {
      error = 'Describe what the pit crew needs to inspect.';
      return;
    }
    advanceFrom('robot', 'postmatch');
  }

  // Fouls start unknown ("—"); the first + counts from zero.
  const stepCount = (value, delta) => Math.max(0, Math.min(50, (value ?? 0) + delta));
  const toggleScale = (current, value) => (current === value ? 0 : value);

  $: robotKey = robotNumber.trim() ? `frc${robotNumber.trim()}` : '';
  $: teamNames = Object.fromEntries(
    eventTeams.map((team) => [String(team.team_number), team.nickname || team.name || ''])
  );
  $: matchTeamsKey = eventKey && matchNumber.trim() ? `${eventKey}|${matchNumber.trim()}` : '';
  $: if (matchTeamsKey !== matchTeamsFor) loadMatchTeams(matchTeamsKey);

  async function loadMatchTeams(key) {
    matchTeamsFor = key;
    matchTeams = { red: [], blue: [], training: null };
    if (!key) return;
    const [event, match] = key.split('|');
    matchTeamsLoading = true;
    try {
      await fetchWithCache(
        `/api/matchscout?resource=match-teams&event_key=${encodeURIComponent(event)}&match_key=${encodeURIComponent(match)}`,
        {
          cacheKey: `match-teams:${key}`,
          headers: await getAuthHeader(),
          onUpdate: (payload) => {
            if (matchTeamsFor !== key || !payload?.success) return;
            matchTeams = {
              red: payload.data.red || [],
              blue: payload.data.blue || [],
              training: payload.data.training || null
            };
            // The schedule knows which alliance the robot is on; a scout who picked the other one gets corrected.
            if (!editing && robotKey && matchTeams.red.includes(robotKey)) alliance = 'red';
            if (!editing && robotKey && matchTeams.blue.includes(robotKey)) alliance = 'blue';
          }
        }
      );
    } catch {
      // No connection and nothing cached: the picker lets the scout type the robots in.
    } finally {
      if (matchTeamsFor === key) matchTeamsLoading = false;
    }
  }

  function toggleBallSource(source) {
    ballSources = ballSources.includes(source)
      ? ballSources.filter((entry) => entry !== source)
      : [...ballSources, source];
  }

  // Rating profile as a star/radar. Five axes on an identical 0-5 scale for one
  // robot in one match, which is the case a radar is actually good for: the
  // shape itself is the signal - a spiky robot reads differently from a
  // balanced one at a glance. The usual complaint about radars is that exact
  // values are hard to read off, so every axis carries its number as a label
  // too; the shape is a summary, not the only encoding.
  const STAR_MAX = 5;
  const STAR_SIZE = 260;
  const STAR_CENTER = STAR_SIZE / 2;
  const STAR_RADIUS = 84;

  const starPoint = (index, value, count) => radarPoint(STAR_CENTER, STAR_RADIUS, index, count, value / STAR_MAX);

  function starPolygon(values, count, scale = 1) {
    return values
      .map((value, index) =>
        starPoint(index, value * scale, count)
          .map((n) => n.toFixed(1))
          .join(',')
      )
      .join(' ');
  }

  $: starFields = RATING_FIELDS.map((field) => ({ field, value: Number(ratings[field]) || 0 }));
  $: starShape = starPolygon(
    starFields.map((entry) => entry.value),
    starFields.length
  );
  // Rings at each whole rating, so a reader can count outward instead of
  // estimating a distance.
  $: starRings = [1, 2, 3, 4, 5].map((ring) =>
    starPolygon(
      starFields.map(() => STAR_MAX),
      starFields.length,
      ring / STAR_MAX
    )
  );
  $: ratedCount = starFields.filter((entry) => entry.value > 0).length;

  // Cached - the roster barely changes mid-event, so a scout mid-match on
  // a bad connection still gets the team picker instantly from whatever
  // loaded last time, instead of an empty dropdown while this times out.
  async function loadEventTeams(key) {
    eventTeams = [];
    if (!key) return;
    try {
      await fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(key)}`, {
        cacheKey: `event-teams:${key}`,
        onUpdate: (payload) => {
          if (payload?.success)
            eventTeams = (payload.data || []).sort((a, b) => Number(a.team_number) - Number(b.team_number));
        }
      });
    } catch {
      // No cache and the network failed - leave eventTeams as whatever it
      // already was rather than clearing a picker someone might be using.
    }
  }

  async function changeCompetition(event) {
    const nextEventKey = String(event.currentTarget?.value || '').trim();
    if (!nextEventKey || nextEventKey === eventKey) return;
    eventKey = nextEventKey;
    myReports = [];
    reportsError = '';
    showReports = false;
    nextAssignment();

    const url = new URL(window.location.href);
    if (eventKey === activeEventKey) url.searchParams.delete('event_key');
    else url.searchParams.set('event_key', eventKey);
    window.history.replaceState({}, '', url);
    await loadEventTeams(eventKey);
  }

  function normalizeRobotNumber(event) {
    robotNumber = String(event.currentTarget?.value || '')
      .replace(/\D/g, '')
      .slice(0, 6);
  }

  function openAutoPhase() {
    advanceFrom('prematch', 'auto');
  }

  async function loadMyReports() {
    if (!eventKey) {
      reportsError = 'No active scouting event is set.';
      return;
    }
    reportsLoading = true;
    reportsError = '';
    try {
      const response = await fetch(`/api/matchscout?event_key=${encodeURIComponent(eventKey)}&mine=1`, {
        headers: await getAuthHeader()
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not load your reports.');
      myReports = result.data || [];
    } catch (exception) {
      reportsError = exception.message;
    } finally {
      reportsLoading = false;
    }
  }

  // The same key the API stores the report under ("2026cc_qm12").
  function toAssignmentMatchKey(rawMatchNumber) {
    return canonicalMatchKey(rawMatchNumber, eventKey) || '';
  }

  function toAssignmentTeamKey(rawTeamNumber) {
    const digits = String(rawTeamNumber || '')
      .trim()
      .replace(/^frc/i, '');
    return digits ? `frc${digits}` : '';
  }

  async function completeMyAssignment(rawMatchNumber, rawTeamNumber) {
    const matchKey = toAssignmentMatchKey(rawMatchNumber);
    const teamKey = toAssignmentTeamKey(rawTeamNumber);
    if (!matchKey || !teamKey) return;
    try {
      const response = await fetch('/api/scout-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          action: 'complete',
          scouting_type: 'data',
          match_key: matchKey,
          team_key: teamKey
        })
      });
      if (!response.ok) return;
    } catch {
      // The report is already saved; the database trigger is the fallback.
    }
  }

  // The homepage links a completed assignment card straight back here with
  // the same ?match=&team= it used the first time, so a scout can revisit
  // and correct an answer. If a report already exists for that match/team,
  // load it into the normal edit flow instead of starting a blank one.
  async function tryLoadExistingReport(rawMatchNumber, rawTeamNumber) {
    if (!eventKey || !rawMatchNumber || !rawTeamNumber) return false;
    try {
      const response = await fetch(`/api/matchscout?event_key=${encodeURIComponent(eventKey)}&mine=1`, {
        headers: await getAuthHeader()
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) return false;
      const assignmentMatchKey = toAssignmentMatchKey(rawMatchNumber);
      const assignmentTeamKey = toAssignmentTeamKey(rawTeamNumber);
      const entry = (result.data || []).find(
        (row) =>
          toAssignmentMatchKey(row.match_key) === assignmentMatchKey &&
          toAssignmentTeamKey(row.team_key) === assignmentTeamKey &&
          reportKindOf(row) === reportKind
      );
      if (entry) {
        await editReport(entry);
        return true;
      }
    } catch {
      /* fall through to a fresh entry */
    }
    return false;
  }

  async function editReport(entry) {
    reportsLoading = true;
    reportsError = '';
    try {
      // Load the handoff as well, so resubmitting an incident keeps its summary.
      const response = await fetch(
        `/api/matchscout?resource=pit-problems&event_key=${encodeURIComponent(eventKey)}&team_key=${encodeURIComponent(entry.team_key)}`,
        { headers: await getAuthHeader() }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not load the pit crew report.');
      const problem = (result.data || []).find(
        (row) =>
          row.match_key === entry.match_key &&
          row.source === 'Match scout' &&
          !row.resolved &&
          (row.created_by === entry.created_by ||
            (row.scout_observations || []).some((observation) => observation.created_by === entry.created_by))
      );
      const ownObservation = (problem?.scout_observations || []).find(
        (observation) => observation.created_by === entry.created_by
      );
      nextAssignment();
      kindChosen = true;
      reportKind = reportKindOf(entry);
      matchNumber = matchInputValue(entry.match_key);
      robotNumber = entry.team_key.replace(/^frc/, '');
      alliance = entry.alliance || 'red';
      startingPosition = entry.starting_position || '';
      scoutName = entry.scout_name || scoutName;
      preload = entry.preload ?? null;
      robotPresent = entry.robot_present !== false;
      autoCycles = entry.auto_cycles ?? null;
      autoPoints = entry.auto_points_band || '';
      autoMoved = entry.auto_moved || '';
      ballSources = [...(entry.ball_sources || [])];
      ballsScored = entry.balls_scored_band || '';
      autoCollision = entry.auto_collision === true;
      autoCollisionNotes = entry.auto_collision_notes || '';
      ratings = {
        ...(entry.ratings || {}),
        ...Object.fromEntries(RATING_FIELDS.map((field) => [field, entry.ratings?.[field] || 0]))
      };
      ratingsUnknown = [...(entry.ratings_unknown || [])];
      customAnswers = { ...(entry.custom_answers || {}) };
      teleopRoles = [...(entry.teleop_roles || [])];
      teleopRolesNone = entry.teleop_roles_none === true;
      teleopNotes = entry.teleop_notes || '';
      intakeSpeed = entry.intake_speed || 0;
      intakeJammed = entry.intake_jammed === true;
      significantCrash = entry.significant_crash ?? null;
      crashTarget = entry.crash_target || '';
      crashDetails = entry.crash_details || '';
      teleopRobotStatus = entry.teleop_robot_status === 'brownout' ? 'dead' : entry.teleop_robot_status || '';
      mechanicalBreak = entry.mechanical_break ?? null;
      robotDisabled = entry.robot_disabled || '';
      card = entry.card || 'none';
      driverSkill = entry.driver_skill ?? undefined;
      pitProblem = Boolean(problem);
      pitProblemDetails = ownObservation?.summary || problem?.summary || '';
      beached = entry.beached === true;
      postNotes = entry.post_notes || '';
      shuttled = typeof entry.shuttled === 'boolean' ? entry.shuttled : null;
      shuttleBand = entry.shuttle_band || '';
      shuttleRating = entry.shuttle_rating || 0;
      shuttleNotes = entry.shuttle_notes || '';
      offenseRating = entry.offense_rating || 0;
      defenseRating = entry.defense_rating || 0;
      performanceNotes = entry.performance_notes || '';
      powerRanking = { ...(entry.power_ranking || {}) };
      foulsMinor = entry.fouls_minor ?? null;
      foulsMajor = entry.fouls_major ?? null;
      breakDetails = entry.break_details || '';
      breakImpact = entry.break_impact || '';
      breakResponse = entry.break_response || '';
      editing = true;
      showReports = false;
    } catch (exception) {
      reportsError = exception.message;
    } finally {
      reportsLoading = false;
    }
  }

  // Only the answers this tab asks for, so a performance or robot report never carries stray data-scouting values.
  function kindAnswers() {
    if (reportKind === 'performance') {
      return {
        ...ratingAnswers(),
        intake_speed: intakeSpeed || null,
        driver_skill: driverSkill || null,
        offense_rating: offenseRating || null,
        defense_rating: defenseRating || null,
        performance_notes: performanceNotes,
        power_ranking: powerRanking
      };
    }
    if (reportKind === 'robot') {
      return {
        ...conditionAnswers(),
        auto_collision: autoCollision,
        auto_collision_notes: autoCollision ? autoCollisionNotes : '',
        intake_jammed: intakeJammed,
        mechanical_break: mechanicalBreak,
        robot_disabled: teleopRobotStatus === 'dead' ? 'died' : robotDisabled,
        // The UI says "None"; the stored vocabulary uses an empty string.
        card: card === 'none' ? '' : card,
        fouls_minor: foulsMinor,
        fouls_major: foulsMajor,
        break_details: breakDetails,
        break_impact: breakImpact,
        break_response: breakResponse,
        beached
      };
    }
    return {
      ...formAnswers(),
      auto_cycles: autoCycles,
      starting_position: startingPosition,
      auto_points_estimate: autoPoints,
      auto_moved: autoMoved,
      ball_sources: ballSources,
      teleop_notes: teleopNotes,
      shuttled,
      shuttle_band: shuttled ? shuttleBand : '',
      shuttle_rating: shuttled ? shuttleRating || null : null,
      shuttle_notes: shuttled ? shuttleNotes : ''
    };
  }

  async function finishScout() {
    if (!assignmentReady) {
      phase = 'prematch';
      return;
    }
    if (!eventKey) {
      error = 'No active scouting event is set, so this report has nowhere to go.';
      return;
    }
    if (!toAssignmentMatchKey(matchNumber)) {
      phase = 'prematch';
      error = `"${matchNumber.trim()}" isn't a match number. Use 12 for Qual 12, or sf2m1 / f1m2 for playoffs.`;
      return;
    }
    const invalid =
      reportKind === 'performance'
        ? validatePerformanceRatings(ratingAnswers())
        : reportKind === 'robot'
          ? validateRobotCondition(conditionAnswers())
          : validateMatchScoutForm(formAnswers());
    if (invalid) {
      phase = reportKind === 'data' ? 'teleop' : reportKind;
      error = invalid;
      return;
    }
    if (!noShow && reportKind === 'robot' && typeof mechanicalBreak !== 'boolean') {
      phase = 'robot';
      error = 'Select whether a mechanical break occurred.';
      return;
    }
    const missingAdded = missingCustom(kindPhases);
    if (missingAdded) {
      phase = missingAdded.phase;
      showMissing = true;
      error = `Answer “${missingAdded.question.label}” before submitting.`;
      return;
    }
    if (shouldReportPitProblem && !pitProblemDetails.trim()) {
      phase = 'robot';
      error = 'Describe what the pit crew needs to inspect before submitting.';
      return;
    }
    saving = true;
    error = '';
    try {
      // A dropped connection here must not cost the scout their report -
      // submitOrQueue tries the real save with a short timeout, and only
      // falls back to a local queue (synced automatically once back
      // online) for a genuine network failure. The API's save-entry is an
      // upsert keyed on event_key/match_key/team_key/created_by, so a
      // queued retry landing after an earlier attempt actually succeeded
      // (response merely lost) overwrites the same row instead of
      // duplicating it - see offlineQueue.js's own docstring for why this
      // matters before pointing it at any other endpoint.
      const result = await submitOrQueue({
        url: '/api/matchscout',
        headers: await getAuthHeader(),
        label: `Match ${matchNumber.trim()} / Team ${robotNumber.trim()}`,
        body: {
          action: 'save-entry',
          form_version: 2,
          section_fields: 3,
          report_kind: reportKind,
          robot_present: robotPresent,
          scout_name: scoutName,
          event_key: eventKey,
          match_key: matchNumber.trim(),
          team_key: robotNumber.trim(),
          alliance,
          ...kindAnswers(),
          post_notes: postNotes,
          report_pit_problem: shouldReportPitProblem,
          pit_problem_summary: pitProblemDetails,
          pit_problem_detail: postNotes,
          custom_answers: sanitizeAnswers(customForm.schema, customAnswers),
          custom_form_version: customForm.version
        }
      });
      queuedOffline = result.queued;
      pitNotificationWarning =
        !result.queued &&
        shouldReportPitProblem &&
        result.data?.pit_notification?.ok === false &&
        result.data.pit_notification.reason !== 'not-configured'
          ? 'The pit problem was saved, but Slack could not deliver it. Save this report again to retry the alert.'
          : '';
      submitted = true;
      editing = true;
      if (!queuedOffline) {
        void completeMyAssignment(matchNumber, robotNumber);
      }
    } catch (exception) {
      error = exception.message;
    } finally {
      saving = false;
    }
  }

  // Keep the phone screen on while a robot is being watched, so it does not lock mid-match.
  $: me = scoutIdentity($userProfile);
  const screenAwake = holdScreenAwake();
  $: screenAwake.set(Boolean(assignmentReady && !submitted));
  onDestroy(() => screenAwake.release());

  onMount(async () => {
    try {
      flipStartView = localStorage.getItem(FLIP_STORAGE_KEY) === '1';
    } catch {
      /* storage can be unavailable */
    }
    void fetchLiveForm('match').then((live) => {
      customForm = live;
    });
    try {
      const response = await fetch('/api/matchscout?resource=start-photos', { headers: await getAuthHeader() });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Starting-position photos unavailable.');
      startPhotos = payload.data || {};
    } catch (error) {
      startPhotoError = error.message;
    }
    const query = new URLSearchParams(window.location.search);
    [activeEventKey, availableEvents] = await Promise.all([
      fetchActiveScoutingEventKey(),
      fetchAvailableScoutingEvents()
    ]);
    activeEventKey ||= '';
    eventKey = String(query.get('event_key') || '').trim() || activeEventKey;
    await loadEventTeams(eventKey);
    matchNumber = query.get('match') || '';
    robotNumber = query.get('team') || '';
    alliance = query.get('alliance') === 'blue' ? 'blue' : 'red';
    startingPosition = query.get('start') || '';
    if (REPORT_KINDS.includes(query.get('tab'))) {
      reportKind = query.get('tab');
      kindChosen = true;
    }
    if (matchNumber && robotNumber) await tryLoadExistingReport(matchNumber, robotNumber);
  });
</script>

<svelte:head><title>Match Scouting</title></svelte:head>

<main class="match-scouting-page">
  {#if $isPhone}
    <!-- Phone (#124): who is scouting and what, at a glance; the competition and past reports fold away. -->
    <header class="ph-scout">
      <div class="ph-scout-top">
        <div><small>{me.greeting}, {me.firstName}</small><b>{REPORT_KIND_LABELS[reportKind]}</b></div>
        <OfflineSyncBadge />
      </div>
      {#if assignmentReady}
        <div class="ph-scout-chip" class:red={alliance === 'red'} class:blue={alliance === 'blue'}>
          <span>Match <b>{matchNumber}</b> · Robot <b>{robotNumber}</b></span><b class="ph-side">{alliance}</b>
        </div>
      {/if}
      {#if editing && !submitted}<p class="ph-editing">
          Editing a saved report. <button class="btn btn-sm" disabled={saving} on:click={nextAssignment}
            >New assignment</button
          >
        </p>{/if}
      <!-- Past reports and the competition live in My Reports on phones. -->
    </header>
  {:else}
    <header class="page-header">
      <div class="header-content">
        <h1><ClipboardCheck size={22} /> Match Scouting</h1>
        <p>{assignmentReady ? 'Assigned robot ready for a match report.' : 'Enter the match handoff to begin.'}</p>
      </div>
      <div class="report-actions">
        <label class="competition-picker">
          <span>Competition</span>
          <Select
            class="form-select"
            wrapText
            value={eventKey}
            disabled={saving || reportsLoading}
            on:change={changeCompetition}
          >
            <option value="" disabled>Select competition</option>
            {#each competitionOptions as option (option.value)}
              <option value={option.value}>
                {option.value}{option.label && option.label !== option.value
                  ? ` — ${option.label}`
                  : ''}{option.value === activeEventKey ? ' (active)' : ''}
              </option>
            {/each}
          </Select>
        </label>
        <button
          class="btn btn-secondary"
          disabled={saving || reportsLoading}
          on:click={() => {
            showReports = !showReports;
            if (showReports) loadMyReports();
          }}>My reports</button
        >
        {#if editing && !submitted}<span>Editing saved report. Save changes when finished.</span><button
            class="btn"
            disabled={saving}
            on:click={nextAssignment}>New assignment</button
          >{/if}
      </div>
      <div class="assignment-chip" class:red={alliance === 'red'} class:blue={alliance === 'blue'}>
        <span>{assignmentLabel}</span>
        {#if assignmentReady}<b>{alliance}</b>{/if}
      </div>
      <OfflineSyncBadge />
    </header>
  {/if}

  <div class="toolbar">
    <div class="kind-tabs" role="tablist" aria-label="Kind of match scouting">
      {#each REPORT_KINDS as kind (kind)}
        <button
          role="tab"
          aria-selected={reportKind === kind}
          class:active={reportKind === kind}
          disabled={saving}
          on:click={() => switchKind(kind)}
        >
          <svelte:component this={KIND_ICONS[kind]} size={17} /><span
            >{$isPhone ? KIND_SHORT[kind] : REPORT_KIND_LABELS[kind]}</span
          >
        </button>
      {/each}
    </div>
  </div>
  {#if showReports}
    <section class="card report-history" aria-label="My submitted scouting reports">
      <h2>Teams you’ve scouted</h2>
      <p>
        Your match reports for {eventKey || 'the active event'}. Choose a report to edit its answers.
      </p>
      <label
        >Find a team or match<input
          class="form-input"
          bind:value={reportFilter}
          placeholder="Team number or match"
        /></label
      >
      {#if reportsError}<p role="alert">{reportsError}</p>{/if}
      {#if reportsLoading}<p>Loading reports...</p>
      {:else}
        {#each myReports.filter((entry) => `${entry.team_key} ${entry.match_key} ${matchLabel(entry.match_key)}`
            .toLowerCase()
            .includes(reportFilter.trim().toLowerCase())) as entry (entry.id)}
          <div class="report-row">
            <span
              >Team {entry.team_key.replace(/^frc/, '')} · {matchLabel(entry.match_key)} · {REPORT_KIND_LABELS[
                reportKindOf(entry)
              ]}</span
            >
            <div class="report-row-actions">
              <button class="btn btn-secondary" on:click={() => editReport(entry)}>Edit answers</button>
            </div>
          </div>
        {:else}<p>
            {myReports.length
              ? 'No reports match your search.'
              : 'You haven’t submitted any match reports for this event yet.'}
          </p>{/each}
      {/if}
    </section>
  {/if}

  {#if $isPhone}
    <!-- Phone (#124): kind and stage in one slim sticky bar. Kind is icon-only (the title names it);
         only the current stage shows its name. -->
    <div class="ph-bar">
      <div class="ph-kinds" role="tablist" aria-label="Kind of match scouting">
        {#each REPORT_KINDS as kind (kind)}
          <button
            role="tab"
            aria-selected={reportKind === kind}
            aria-label={REPORT_KIND_LABELS[kind]}
            class:on={reportKind === kind}
            disabled={saving}
            on:click={() => switchKind(kind)}
            ><svelte:component this={KIND_ICONS[kind]} size={16} /><span>{KIND_TINY[kind]}</span></button
          >
        {/each}
      </div>
      <ol class="ph-stages" aria-label={`${REPORT_KIND_LABELS[reportKind]} stages`}>
        {#each kindPhases as id, index (id)}
          <li>
            <button
              class:on={phase === id}
              class:done={index < kindPhases.indexOf(phase)}
              aria-current={phase === id ? 'step' : undefined}
              aria-label={`${index + 1}. ${PHASE_INFO[id].label}`}
              on:click={() => (id === 'auto' ? openAutoPhase() : selectPhase(id))}><span class="seg"></span></button
            >
          </li>
        {/each}
      </ol>
      <span class="ph-stage-name"
        >{PHASE_INFO[phase]?.label || ''}<small>{kindPhases.indexOf(phase) + 1}/{kindPhases.length}</small></span
      >
    </div>
  {/if}
  <div class="scouting-shell">
    <aside class="stage-nav" aria-label={`${REPORT_KIND_LABELS[reportKind]} stages`}>
      {#each kindPhases as id, index (id)}
        <button class:active={phase === id} on:click={() => (id === 'auto' ? openAutoPhase() : selectPhase(id))}
          ><svelte:component this={PHASE_INFO[id].icon} size={18} /><span
            >{$isPhone ? PHASE_SHORT[id] : PHASE_INFO[id].label}</span
          ><small>{String(index + 1).padStart(2, '0')}</small></button
        >
      {/each}
    </aside>

    <section class="match-workspace">
      {#if matchTeams.training}
        <div class="training-banner">
          <GraduationCap size={18} />
          <div>
            <b>Training match</b><span
              >{matchTeams.training.source_event_name || matchTeams.training.source_event_key} · {matchTeams.training
                .source_label || matchTeams.training.source_match_key}</span
            >
          </div>
          {#if matchTeams.training.video_key}<a
              class="btn btn-secondary"
              href={youtubeUrl(matchTeams.training.video_key)}
              target="_blank"
              rel="noopener noreferrer">Watch the match <ExternalLink size={14} /></a
            >{:else}<span class="muted">No video on TBA</span>{/if}
        </div>
      {/if}
      {#if !submitted && assignmentReady && reportKind === 'robot'}
        <div class="persistent-status" class:urgent={requiresPitReport}>
          <div><span class="field-label">Robot status</span><small>Available throughout the match</small></div>
          <div class="choice-grid status-buttons">
            <button class:chosen={robotDisabled === 'no'} on:click={() => setRobotStatus('no')}>Active</button>
            <button class:chosen={robotDisabled === 'disabled'} on:click={() => setRobotStatus('disabled')}
              >Disabled</button
            >
            <button class:chosen={robotDisabled === 'died'} on:click={() => setRobotStatus('died')}>Died</button>
          </div>
        </div>
      {/if}
      {#if submitted}
        <div class="submitted-state">
          <div class="submitted-icon"><Check size={28} /></div>
          <h2>Match {matchNumber} &middot; Robot {robotNumber}</h2>
          {#if queuedOffline}
            <p>Saved on this phone - no connection right now, so it'll sync automatically once you're back online.</p>
          {:else}
            <p>Saved. Here is how you rated them.</p>
          {/if}
          {#if pitNotificationWarning}<p class="submit-error" role="alert">{pitNotificationWarning}</p>{/if}

          {#if reportKind !== 'performance'}
            <p class="star-empty">Your {REPORT_KIND_LABELS[reportKind].toLowerCase()} report is saved.</p>
          {:else if ratedCount}
            <figure class="rating-star">
              <svg
                viewBox={`0 0 ${STAR_SIZE} ${STAR_SIZE}`}
                role="img"
                aria-label={`Rating profile: ${starFields.map((entry) => `${entry.field} ${entry.value} of ${STAR_MAX}`).join(', ')}`}
              >
                {#each starRings as ring, index}
                  <polygon points={ring} class="star-ring" class:outer={index === starRings.length - 1} />
                {/each}
                {#each starFields as _entry, index}
                  <line
                    x1={STAR_CENTER}
                    y1={STAR_CENTER}
                    x2={starPoint(index, STAR_MAX, starFields.length)[0]}
                    y2={starPoint(index, STAR_MAX, starFields.length)[1]}
                    class="star-spoke"
                  />
                {/each}
                <polygon points={starShape} class="star-shape" />
                {#each starFields as entry, index}
                  {#if entry.value > 0}
                    <circle
                      cx={starPoint(index, entry.value, starFields.length)[0]}
                      cy={starPoint(index, entry.value, starFields.length)[1]}
                      r="4"
                      class="star-node"
                    />
                  {/if}
                {/each}
                {#each starFields as _entry, index}
                  <text
                    x={starPoint(index, STAR_MAX + 0.9, starFields.length)[0]}
                    y={starPoint(index, STAR_MAX + 0.9, starFields.length)[1]}
                    class="star-axis-index">{index + 1}</text
                  >
                {/each}
              </svg>
              <figcaption class="star-legend">
                {#each starFields as entry}
                  <span class="star-legend-row" class:unrated={!entry.value}>
                    <span class="star-legend-index">{starFields.indexOf(entry) + 1}</span>
                    <span class="star-legend-label">{entry.field}</span>
                    <span class="star-legend-value">{entry.value || '—'}</span>
                  </span>
                {/each}
              </figcaption>
            </figure>
          {:else}
            <p class="star-empty">No ratings were recorded for this robot.</p>
          {/if}

          <button class="btn btn-secondary" on:click={() => selectPhase('prematch')}>Edit answers</button>
          <button class="btn btn-primary" on:click={nextAssignment}>Next assignment</button>
        </div>
      {:else if phase === 'prematch'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Pre-match</span>
            <h2>Match assignment</h2>
            <p>Set the robot and its opening location before the field goes live.</p>
          </div>
          <MapPinned size={20} />
        </div>
        <div class="blocks prematch-blocks">
          <div class="blk assignment-blk" style="order:{orders.get('core:prematch.assignment') ?? 0}">
            <div class="assignment-grid">
              <label
                >Scout name (required)<input
                  class="form-input"
                  maxlength="120"
                  autocomplete="name"
                  bind:value={scoutName}
                /></label
              >
              <label
                >Match #<input
                  class="form-input"
                  inputmode="numeric"
                  placeholder="14"
                  bind:value={matchNumber}
                  disabled={editing}
                  aria-invalid={!matchKeyValid}
                />
                {#if !matchKeyValid}<small class="match-hint">Use 12 for Qual 12, or sf2m1 / f1m2 for playoffs.</small
                  >{/if}</label
              >
              <label>
                Robot #
                <input
                  class="form-input"
                  inputmode="numeric"
                  placeholder="Start typing a team number"
                  list="event-team-options"
                  use:suggest
                  autocomplete="off"
                  disabled={editing}
                  value={robotNumber}
                  on:input={normalizeRobotNumber}
                />
                <datalist id="event-team-options">
                  {#each eventTeams as team}
                    <option value={team.team_number}>{team.nickname || team.name || `Team ${team.team_number}`}</option>
                  {/each}
                </datalist>
              </label>
              <fieldset class="alliance-field">
                <legend>Alliance</legend>
                <div class="segmented alliance-choice">
                  <button class:chosen={alliance === 'red'} class="red-choice" on:click={() => (alliance = 'red')}
                    >Red</button
                  ><button class:chosen={alliance === 'blue'} class="blue-choice" on:click={() => (alliance = 'blue')}
                    >Blue</button
                  >
                </div>
              </fieldset>
            </div>
          </div>
          <div class="blk" style="order:{orders.get('core:prematch.present') ?? 0}">
            <fieldset class="control-group present-card">
              <legend>Did the robot show up to the field?</legend>
              <div class="segmented present-choice">
                <button class:chosen={!noShow} aria-pressed={!noShow} on:click={() => setRobotPresent(true)}>Yes</button
                ><button class:chosen={noShow} aria-pressed={noShow} on:click={() => setRobotPresent(false)}>No</button>
              </div>
              {#if noShow}<p class="present-note">
                  Every other question is optional now. Submit the report, or add anything you saw first.
                </p>{/if}
            </fieldset>
          </div>
          {#if reportKind === 'data'}
            <div class="blk" style="order:{orders.get('core:prematch.preload') ?? 0}">
              <fieldset class="control-group preload-card">
                <legend>{layout.label('prematch.preload', 'Preload')} (required)</legend>
                <div class="segmented preload-choice">
                  <button class:chosen={preload === true} on:click={() => (preload = true)}>Has preload</button><button
                    class:chosen={preload === false}
                    on:click={() => (preload = false)}>No preload</button
                  >
                </div>
              </fieldset>
            </div>
            <div class="blk" style="order:{orders.get('core:prematch.start') ?? 0}">
              <div class="start-position-block">
                <div class="start-position-head">
                  <span class="field-label">{layout.label('prematch.start', 'Starting position')}</span>
                  <button
                    type="button"
                    class="flip-view"
                    aria-pressed={flipStartView}
                    on:click={toggleStartView}
                    title="Turn the field around to match your side of the stands"
                    ><ArrowLeftRight size={15} />{flipStartView ? 'Flipped view' : 'Flip view'}</button
                  >
                </div>
                <div class="position-grid" class:flipped={flipStartView}>
                  {#each shownStartCards as { position, index } (position)}
                    <button
                      class="start-position-card"
                      class:chosen={startingPosition === position}
                      on:click={() => (startingPosition = position)}
                    >
                      {#if startPhotos[`${alliance}:${position}`]}
                        <img
                          src={startPhotos[`${alliance}:${position}`]}
                          alt={`${alliance} alliance ${position} field starting position`}
                        />
                      {:else}
                        <svg
                          viewBox="0 0 100 48.5"
                          role="img"
                          aria-label={`2026 REBUILT field, ${alliance} alliance wall on the ${flipStartView ? 'right' : 'left'}, ${position} starting lane highlighted`}
                        >
                          <g transform={flipStartView ? 'rotate(180 50 24.25)' : undefined}>
                            <image
                              href="/rebuilt-2026-field.png"
                              width="100"
                              height="48.5"
                              transform={alliance === 'red' ? 'translate(100 48.5) rotate(180)' : undefined}
                            />
                            <circle
                              cx="23"
                              cy={4 + index * 10}
                              r="3"
                              fill="none"
                              stroke="var(--on-media)"
                              stroke-width="0.8"
                            />
                            <rect
                              x="21.5"
                              y={2.5 + index * 10}
                              width="3"
                              height="3"
                              fill={alliance === 'red' ? 'var(--alliance-red-vivid)' : 'var(--alliance-blue-vivid)'}
                              stroke="var(--on-media)"
                              stroke-width="0.5"
                            />
                          </g>
                        </svg>
                      {/if}
                      <span>{position}</span>
                    </button>
                  {/each}
                </div>
                {#if startPhotoError}<small class="field-help"
                    >Custom photos unavailable; the 2026 field image is shown. {startPhotoError}</small
                  >{/if}
              </div>
            </div>
          {/if}
          <CustomQuestions questions={customIn('prematch')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        <div class="section-footer">
          <span
            >{assignmentReady
              ? noShow
                ? `Robot ${robotNumber} didn't show up.`
                : `Robot ${robotNumber} is ready to scout.`
              : reportKind === 'data'
                ? 'Match, robot, preload, and starting position are required.'
                : 'Match and robot are required.'}</span
          >{#if noShow}<button class="btn btn-primary" disabled={!assignmentReady || !canFinish} on:click={finishScout}
              >{saving ? 'Saving...' : 'Submit report'}</button
            >{:else}<button
              class="btn btn-primary"
              disabled={!assignmentReady}
              on:click={() =>
                reportKind === 'data' ? openAutoPhase() : advanceFrom('prematch', phaseAfter('prematch'))}
              >Begin {PHASE_INFO[phaseAfter('prematch')].label.toLowerCase()} <ChevronRight size={16} /></button
            >{/if}
        </div>
      {:else if phase === 'auto'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Autonomous</span>
            <h2>Auto report</h2>
            <p>Record whether auto ran and roughly how much fuel scored.</p>
          </div>
          <Route size={20} />
        </div>
        <div class="auto-layout">
          <div class="auto-controls blocks packed">
            {#if !layout.hidden('auto.ran')}
              <div class="blk" style="order:{orders.get('core:auto.ran') ?? 0}">
                <div class="control-group">
                  <span class="field-label">{layout.label('auto.ran', 'Did autonomous run?')}</span>
                  <div class="segmented">
                    <button class:chosen={autoMoved === 'ran'} on:click={() => (autoMoved = 'ran')}>Yes</button><button
                      class:chosen={autoMoved === 'did-not-run'}
                      on:click={() => (autoMoved = 'did-not-run')}>No</button
                    >
                  </div>
                </div>
              </div>
            {/if}
            {#if !layout.hidden('auto.points')}
              <div class="blk tall" style="order:{orders.get('core:auto.points') ?? 0}">
                <div class="control-group auto-points-control">
                  <label for="auto-points-estimate" class="field-label"
                    >{layout.label('auto.points', 'Estimated points scored')}</label
                  >
                  {#if layout.help('auto.points')}<small class="field-help">{layout.help('auto.points')}</small>{/if}
                  <input
                    id="auto-points-estimate"
                    class="form-input auto-points-input"
                    class:invalid={autoPointsInvalid}
                    inputmode="decimal"
                    placeholder="e.g. 40-60 or 100+"
                    bind:value={autoPoints}
                  />
                  <div class="auto-points-slider">
                    <input
                      type="range"
                      min="0"
                      max={AUTO_POINTS_SLIDER_MAX}
                      step="5"
                      value={autoPointsSliderValue}
                      aria-label="Estimated points scored"
                      on:input={(event) => setAutoPointsFromSlider(event.currentTarget.value)}
                    />
                    <output for="auto-points-estimate"
                      >{autoPointsSliderValue >= AUTO_POINTS_SLIDER_MAX
                        ? `${AUTO_POINTS_SLIDER_MAX}+`
                        : autoPointsSliderValue}</output
                    >
                  </div>
                  {#if autoPointsEstimate?.kind === 'range'}
                    <small class="estimate-result"
                      >Analytics estimate: <strong>{autoPointsEstimate.average} points</strong> (midpoint of {autoPointsEstimate.input}).</small
                    >
                  {:else if autoPointsEstimate?.kind === 'lower-bound'}
                    <small class="estimate-result"
                      >Analytics estimate: <strong>at least {autoPointsEstimate.average} points</strong> (conservative lower
                      bound).</small
                    >
                  {:else if autoPointsEstimate}
                    <small class="estimate-result"
                      >Analytics estimate: <strong>{autoPointsEstimate.average} points</strong>.</small
                    >
                  {:else if autoPointsInvalid}
                    <small class="estimate-error">Use a number, a low-high range, or a value ending in +.</small>
                  {/if}
                </div>
              </div>
            {/if}
            {#if !layout.hidden('auto.sources')}
              <div class="blk tall" style="order:{orders.get('core:auto.sources') ?? 0}">
                <fieldset class="control-group">
                  <legend class="field-label"
                    >{layout.label('auto.sources', 'Where did the robot collect fuel?')}</legend
                  >
                  {#if layout.help('auto.sources')}<small class="field-help">{layout.help('auto.sources')}</small>{/if}
                  <div class="choice-grid auto-source-grid">
                    {#each BALL_SOURCE_OPTIONS as source}
                      <button
                        class:chosen={ballSources.includes(source[0])}
                        on:click={() => toggleBallSource(source[0])}>{source[1]}</button
                      >
                    {/each}
                  </div>
                </fieldset>
              </div>
            {/if}
            {#if !layout.hidden('auto.cycles')}
              <div class="blk" style="order:{orders.get('core:auto.cycles') ?? 0}">
                <label class="control-group"
                  >{layout.label('auto.cycles', 'Autonomous cycles')}<input
                    class="form-input"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="Number of completed collect-and-score cycles"
                    bind:value={autoCycles}
                  /></label
                >
              </div>
            {/if}
            <CustomQuestions questions={customIn('auto')} bind:answers={customAnswers} {orders} {showMissing} />
          </div>
        </div>
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase('prematch')}>Back</button><button
            class="btn btn-primary"
            disabled={autoPointsInvalid}
            on:click={() => advanceFrom('auto', 'teleop')}>Continue to teleop <ChevronRight size={16} /></button
          >
        </div>
      {:else if phase === 'teleop'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Teleop</span>
            <h2>Roles and scoring</h2>
            <p>What the robot did during teleop. Everything is required except the items marked optional.</p>
          </div>
          <Timer size={20} />
        </div>
        <div class="blocks packed">
          <div class="blk" style="order:{orders.get('core:teleop.roles') ?? 0}">
            <section class="t-card" aria-labelledby="t-roles">
              <header class="t-head">
                <h3 id="t-roles">{layout.label('teleop.roles', 'Observed roles')}</h3>
                <span class="tag req">Required</span>
              </header>
              {#if layout.help('teleop.roles')}<p class="field-help">{layout.help('teleop.roles')}</p>{/if}
              <div class="choice-grid role-grid" role="group" aria-labelledby="t-roles">
                {#each TELEOP_ROLES as role}
                  <button
                    aria-pressed={teleopRoles.includes(role)}
                    class:chosen={teleopRoles.includes(role)}
                    on:click={() => toggleTeleopRole(role)}
                    >{#if teleopRoles.includes(role)}<Check size={15} />{/if}{role}</button
                  >
                {/each}
                <button
                  class="none-choice"
                  aria-pressed={teleopRolesNone}
                  class:chosen={teleopRolesNone}
                  on:click={() => {
                    teleopRoles = [];
                    teleopRolesNone = true;
                  }}
                  >{#if teleopRolesNone}<Check size={15} />{/if}None observed</button
                >
              </div>
            </section>
          </div>

          <div class="blk" style="order:{orders.get('core:teleop.balls') ?? 0}">
            <section class="t-card balls-control">
              <header class="t-head">
                <label for="balls-scored" class="t-title">{layout.label('teleop.balls', 'Balls scored')}</label><span
                  class="tag req">Required</span
                >
              </header>
              {#if layout.help('teleop.balls')}<p class="field-help">{layout.help('teleop.balls')}</p>{/if}
              <input
                id="balls-scored"
                class="form-input"
                list="ball-count-options"
                use:suggest
                inputmode="text"
                required
                bind:value={ballsScored}
                placeholder="e.g. 137 or 100-150"
              />
              <datalist id="ball-count-options">
                {#each BALL_COUNT_RANGES as range}
                  <option value={range}>{range}</option>
                {/each}
              </datalist>
              {#if ballsEstimate?.kind === 'lower-bound'}
                <small class="estimate-result"
                  >Analytics estimate: <strong>at least {ballsEstimate.average} balls</strong> (no upper bound observed).</small
                >
              {:else if ballsEstimate}
                <small class="estimate-result"
                  >Analytics estimate: <strong>{ballsEstimate.average} balls</strong> (midpoint of {ballsEstimate.input}).</small
                >
              {/if}
            </section>
          </div>

          {#if !layout.hidden('teleop.notes')}
            <div class="blk" style="order:{orders.get('core:teleop.notes') ?? 0}">
              <label class="notes-label scouter-notes"
                ><span class="t-head"
                  ><span class="t-title">{layout.label('teleop.notes', 'Real-scout observations')}</span><span
                    class="tag">Optional</span
                  ></span
                ><textarea
                  class="form-input"
                  rows="9"
                  placeholder="What did the robot actually do? Note repeatable strengths, defense response, cycle consistency, field awareness, or anything the numbers miss."
                  bind:value={teleopNotes}
                ></textarea></label
              >
            </div>
          {/if}
          <CustomQuestions questions={customIn('teleop')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        {#if error}<p class="submit-error" role="alert">{error}</p>{/if}
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase('auto')}>Back</button><button
            class="btn btn-primary"
            on:click={continueFromTeleop}>Continue to shuttling <ChevronRight size={16} /></button
          >
        </div>
      {:else if phase === 'shuttling'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Data scouting</span>
            <h2>Shuttling</h2>
            <p>
              Fuel the robot moved toward its alliance zone without scoring it: driving it over, pushing it or launching
              it.
            </p>
          </div>
          <Shuffle size={20} />
        </div>
        <div class="blocks packed">
          {#if !layout.hidden('shuttling.shuttled')}
            <div class="blk" style="order:{orders.get('core:shuttling.shuttled') ?? 0}">
              <div class="t-card control-group" role="group" aria-labelledby="s-shuttled">
                <header class="t-head">
                  <span id="s-shuttled" class="t-title"
                    >{layout.label('shuttling.shuttled', 'Did the robot shuttle fuel?')}</span
                  ><span class="tag">Optional</span>
                </header>
                {#if layout.help('shuttling.shuttled')}<p class="field-help">
                    {layout.help('shuttling.shuttled')}
                  </p>{/if}
                <div class="segmented big">
                  <button
                    aria-pressed={shuttled === false}
                    class:chosen={shuttled === false}
                    on:click={() => (shuttled = shuttled === false ? null : false)}>No</button
                  >
                  <button
                    aria-pressed={shuttled === true}
                    class:chosen={shuttled === true}
                    on:click={() => (shuttled = shuttled === true ? null : true)}>Yes</button
                  >
                </div>
              </div>
            </div>
          {/if}
          {#if shuttled}
            {#if !layout.hidden('shuttling.amount')}
              <div class="blk" style="order:{orders.get('core:shuttling.amount') ?? 0}">
                <section class="t-card balls-control">
                  <header class="t-head">
                    <label for="shuttle-band" class="t-title">{layout.label('shuttling.amount', 'Fuel shuttled')}</label
                    ><span class="tag">Optional</span>
                  </header>
                  {#if layout.help('shuttling.amount')}<p class="field-help">
                      {layout.help('shuttling.amount')}
                    </p>{/if}
                  <input
                    id="shuttle-band"
                    class="form-input"
                    list="ball-count-options"
                    use:suggest
                    inputmode="text"
                    bind:value={shuttleBand}
                    placeholder="e.g. 30 or 25-50"
                  />
                </section>
              </div>
            {/if}
            {#if !layout.hidden('shuttling.rating')}
              <div class="blk" style="order:{orders.get('core:shuttling.rating') ?? 0}">
                <section class="t-card">
                  <header class="t-head">
                    <h3>{layout.label('shuttling.rating', 'Shuttling effectiveness')}</h3>
                    <span class="tag">Optional</span>
                  </header>
                  {#if layout.help('shuttling.rating')}<p class="field-help">
                      {layout.help('shuttling.rating')}
                    </p>{/if}
                  <div class="scale" role="group" aria-label="Shuttling effectiveness">
                    {#each [1, 2, 3, 4, 5] as value}
                      <button
                        class="scale-btn"
                        aria-pressed={shuttleRating === value}
                        aria-label={`Shuttling effectiveness: ${value} of 5`}
                        class:chosen={shuttleRating === value}
                        on:click={() => (shuttleRating = toggleScale(shuttleRating, value))}
                        ><b>{value}</b><small>{value === 1 ? 'poor' : value === 5 ? 'excellent' : '\u00a0'}</small
                        ></button
                      >
                    {/each}
                  </div>
                </section>
              </div>
            {/if}
            {#if !layout.hidden('shuttling.notes')}
              <div class="blk" style="order:{orders.get('core:shuttling.notes') ?? 0}">
                <label class="notes-label"
                  >{layout.label('shuttling.notes', 'Shuttling notes')} (optional)<textarea
                    class="form-input"
                    rows="3"
                    placeholder="Where did it shuttle from, and how: over the bump, through the trench, or launched?"
                    bind:value={shuttleNotes}
                  ></textarea></label
                >
              </div>
            {/if}
          {/if}
          <CustomQuestions questions={customIn('shuttling')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        {#if error}<p class="submit-error" role="alert">{error}</p>{/if}
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase('teleop')}>Back</button><button
            class="btn btn-primary"
            on:click={() => advanceFrom('shuttling', 'postmatch')}
            >Continue to post-match <ChevronRight size={16} /></button
          >
        </div>
      {:else if phase === 'performance'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Performance scouting</span>
            <h2>How well they played</h2>
            <p>
              Rate the shooting, driving and play, then rank the robots you watched. Tap a rating to set it and tap it
              again to clear it if you could not judge it.
            </p>
          </div>
          <Gauge size={20} />
        </div>
        <div class="blocks">
          <div class="blk" style="order:{orders.get('core:teleop.ratings') ?? 0}">
            <section class="t-card">
              <header class="t-head"><h3>{layout.label('teleop.ratings', 'Performance ratings')}</h3></header>
              {#if layout.help('teleop.ratings')}<p class="field-help">{layout.help('teleop.ratings')}</p>{/if}
              {#each TELEOP_RATING_FIELDS as field}
                {@const labels =
                  field === 'BPS' ? BPS_LABELS.map((label) => label.replace(' BPS', '')) : ACCURACY_LABELS}
                <div class="scale-row">
                  <span class="scale-name"
                    >{field}{#if field === 'BPS'}
                      <small>balls per second</small>{/if}</span
                  >
                  <div class="scale" role="group" aria-label={field}>
                    {#each [1, 2, 3, 4, 5] as value}
                      <button
                        class="scale-btn"
                        aria-pressed={ratings[field] === value}
                        aria-label={`${field}: ${value}, ${(field === 'BPS' ? BPS_LABELS : ACCURACY_LABELS)[value - 1]}`}
                        class:chosen={ratings[field] === value}
                        on:click={() => toggleRating(field, value)}
                        ><b>{value}</b><small>{labels[value - 1]}</small></button
                      >
                    {/each}
                  </div>
                </div>
              {/each}
            </section>
          </div>

          {#if !layout.hidden('teleop.extraRatings')}
            <div class="blk" style="order:{orders.get('core:teleop.extraRatings') ?? 0}">
              <section class="t-card">
                <header class="t-head">
                  <h3>{layout.label('teleop.extraRatings', 'Additional ratings')}</h3>
                  <span class="tag">Optional</span>
                </header>
                {#if layout.help('teleop.extraRatings')}<p class="field-help">
                    {layout.help('teleop.extraRatings')}
                  </p>{/if}
                {#each MATCH_OPTIONAL_RATING_FIELDS as field}
                  <div class="scale-row">
                    <span class="scale-name">{field}</span>
                    <div class="scale" role="group" aria-label={field}>
                      {#each [1, 2, 3, 4, 5] as value}
                        <button
                          class="scale-btn"
                          aria-pressed={ratings[field] === value}
                          aria-label={`${field}: ${value} of 5`}
                          class:chosen={ratings[field] === value}
                          on:click={() => toggleRating(field, value)}
                          ><b>{value}</b><small>{value === 1 ? 'poor' : value === 5 ? 'excellent' : '\u00a0'}</small
                          ></button
                        >
                      {/each}
                    </div>
                  </div>
                {/each}
              </section>
            </div>
          {/if}

          {#if !layout.hidden('teleop.intake')}
            <div class="blk" style="order:{orders.get('core:teleop.intake') ?? 0}">
              <section class="t-card">
                <header class="t-head">
                  <h3>{layout.label('teleop.intake', 'Intake speed')}</h3>
                  <span class="tag">Optional</span>
                </header>
                {#if layout.help('teleop.intake')}<p class="field-help">{layout.help('teleop.intake')}</p>{/if}
                <div class="scale scale-3" role="group" aria-label="Intake speed">
                  {#each [1, 2, 3] as value}
                    <button
                      class="scale-btn"
                      aria-pressed={intakeSpeed === value}
                      class:chosen={intakeSpeed === value}
                      on:click={() => (intakeSpeed = intakeSpeed === value ? 0 : value)}
                      ><b>{value}</b><small>{value === 1 ? 'slow' : value === 3 ? 'fast' : '\u00a0'}</small></button
                    >
                  {/each}
                </div>
              </section>
            </div>
          {/if}
          {#each [['performance.driver', 'Driver skill', 'driver'], ['performance.offense', 'Offense rating', 'offense'], ['performance.defense', 'Defense rating', 'defense']] as [key, fallback, field] (key)}
            {#if !layout.hidden(key)}
              <div class="blk" style="order:{orders.get(`core:${key}`) ?? 0}">
                <section class="t-card">
                  <header class="t-head">
                    <h3>{layout.label(key, fallback)}</h3>
                    <span class="tag">Optional</span>
                  </header>
                  {#if layout.help(key)}<p class="field-help">{layout.help(key)}</p>{/if}
                  <div class="scale" role="group" aria-label={layout.label(key, fallback)}>
                    {#each [1, 2, 3, 4, 5] as value}
                      {@const current =
                        field === 'driver' ? driverSkill : field === 'offense' ? offenseRating : defenseRating}
                      <button
                        class="scale-btn"
                        aria-pressed={current === value}
                        aria-label={`${layout.label(key, fallback)}: ${value} of 5`}
                        class:chosen={current === value}
                        on:click={() => {
                          if (field === 'driver') driverSkill = toggleScale(driverSkill, value);
                          else if (field === 'offense') offenseRating = toggleScale(offenseRating, value);
                          else defenseRating = toggleScale(defenseRating, value);
                        }}
                        ><b>{value}</b><small>{value === 1 ? 'poor' : value === 5 ? 'excellent' : '\u00a0'}</small
                        ></button
                      >
                    {/each}
                  </div>
                </section>
              </div>
            {/if}
          {/each}
          {#if !layout.hidden('performance.ranking')}
            <div class="blk" style="order:{orders.get('core:performance.ranking') ?? 0}">
              <section class="t-card">
                <header class="t-head">
                  <h3>{layout.label('performance.ranking', 'Power ranking')}</h3>
                  <span class="tag">Optional</span>
                </header>
                {#if layout.help('performance.ranking')}<p class="field-help">
                    {layout.help('performance.ranking')}
                  </p>{/if}
                <PowerRankingPicker
                  red={matchTeams.red}
                  blue={matchTeams.blue}
                  bind:ranking={powerRanking}
                  bind:skipped={rankingSkipped}
                  ownTeamKey={robotKey}
                  names={teamNames}
                  loading={matchTeamsLoading && !matchTeams.red.length && !matchTeams.blue.length}
                />
              </section>
            </div>
          {/if}
          {#if !layout.hidden('performance.notes')}
            <div class="blk" style="order:{orders.get('core:performance.notes') ?? 0}">
              <label class="notes-label"
                >{layout.label('performance.notes', 'Notes about performance')} (optional)<textarea
                  class="form-input"
                  rows="5"
                  placeholder="What stood out about how they played: strengths, mistakes, strategy, how they reacted to defense."
                  bind:value={performanceNotes}
                ></textarea></label
              >
            </div>
          {/if}
          <CustomQuestions questions={customIn('performance')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        {#if error}<p class="submit-error" role="alert">{error}</p>{/if}
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase(phaseBefore('performance'))}>Back</button><button
            class="btn btn-primary"
            on:click={continueFromPerformance}>Continue to post-match <ChevronRight size={16} /></button
          >
        </div>
      {:else if phase === 'robot'}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Robot scouting</span>
            <h2>Condition, penalties and breaks</h2>
            <p>How the robot held up, penalties against it, anything that broke, and what the team did about it.</p>
          </div>
          <Wrench size={20} />
        </div>
        <div class="blocks">
          <div class="blk" style="order:{orders.get('core:teleop.status') ?? 0}">
            <div class="t-card control-group" role="group" aria-labelledby="t-status">
              <header class="t-head">
                <span id="t-status" class="t-title">{layout.label('teleop.status', 'Robot status')}</span><span
                  class="tag req">Required</span
                >
              </header>
              <div class="choice-grid status-choice-grid">
                {#each [['active', 'Active'], ['dead', 'Dead'], ['stopped', 'Stopped']] as [status, label]}<button
                    class="status-choice status-{status}"
                    aria-pressed={teleopRobotStatus === status}
                    class:chosen={teleopRobotStatus === status}
                    on:click={() => (teleopRobotStatus = status)}>{label}</button
                  >{/each}
              </div>
            </div>
          </div>
          <div class="blk" style="order:{orders.get('core:teleop.crash') ?? 0}">
            <div class="t-card control-group" role="group" aria-labelledby="t-crash">
              <header class="t-head">
                <span id="t-crash" class="t-title">{layout.label('teleop.crash', 'Significant crash')}</span><span
                  class="tag req">Required</span
                >
              </header>
              <div class="segmented big">
                <button
                  aria-pressed={significantCrash === false}
                  class:chosen={significantCrash === false}
                  on:click={() => (significantCrash = false)}>No</button
                >
                <button
                  aria-pressed={significantCrash === true}
                  class:chosen={significantCrash === true}
                  on:click={() => (significantCrash = true)}>Yes</button
                >
              </div>
              {#if significantCrash}
                <label
                  >Crash target (required)
                  <Select class="form-input" bind:value={crashTarget}>
                    <option value="">Choose target</option>
                    {#each ['robot', 'wall', 'field element', 'other'] as target}<option value={target}>{target}</option
                      >{/each}
                  </Select>
                </label>
                {#if crashTarget === 'other'}<label
                    >Other target (required)<input
                      class="form-input"
                      maxlength="500"
                      bind:value={crashDetails}
                    /></label
                  >{/if}
              {/if}
            </div>
          </div>
          {#if !layout.hidden('auto.collision')}
            <div class="blk" style="order:{orders.get('core:auto.collision') ?? 0}">
              <div class="t-card control-group" role="group" aria-labelledby="r-collision">
                <header class="t-head">
                  <span id="r-collision" class="t-title"
                    >{layout.label('auto.collision', 'Any collision during auto?')}</span
                  ><span class="tag">Optional</span>
                </header>
                <div class="segmented big">
                  <button
                    aria-pressed={!autoCollision}
                    class:chosen={!autoCollision}
                    on:click={() => (autoCollision = false)}>No</button
                  >
                  <button
                    aria-pressed={autoCollision}
                    class:chosen={autoCollision}
                    on:click={() => (autoCollision = true)}>Yes</button
                  >
                </div>
                {#if autoCollision}
                  <textarea
                    class="form-input collision-notes"
                    rows="2"
                    maxlength="500"
                    placeholder="Robot, wall, or field element: where and what happened?"
                    bind:value={autoCollisionNotes}
                  ></textarea>
                {/if}
              </div>
            </div>
          {/if}
          {#if !layout.hidden('robot.intakeJammed')}
            <div class="blk" style="order:{orders.get('core:robot.intakeJammed') ?? 0}">
              <label class="incident-toggle"
                ><input type="checkbox" bind:checked={intakeJammed} /><span
                  ><AlertTriangle size={17} />
                  {layout.label('robot.intakeJammed', 'Intake jammed during the match')}</span
                ></label
              >
            </div>
          {/if}
          {#if !layout.hidden('postmatch.cards')}
            <div class="blk" style="order:{orders.get('core:postmatch.cards') ?? 0}">
              <div class="post-grid outcome-panel">
                <fieldset>
                  <legend>{layout.label('postmatch.cards', 'Cards')}</legend>
                  <div class="choice-grid card-choice-grid">
                    <button
                      class="card-choice card-none"
                      class:chosen={card === 'none'}
                      on:click={() => (card = 'none')}><i class="card-swatch" aria-hidden="true"></i>None</button
                    ><button
                      class="card-choice card-yellow"
                      class:chosen={card === 'yellow'}
                      on:click={() => (card = 'yellow')}><i class="card-swatch" aria-hidden="true"></i>Yellow</button
                    ><button class="card-choice card-red" class:chosen={card === 'red'} on:click={() => (card = 'red')}
                      ><i class="card-swatch" aria-hidden="true"></i>Red</button
                    >
                  </div>
                </fieldset>
              </div>
            </div>
          {/if}
          {#if !layout.hidden('robot.fouls')}
            <div class="blk" style="order:{orders.get('core:robot.fouls') ?? 0}">
              <section class="t-card">
                <header class="t-head">
                  <h3>{layout.label('robot.fouls', 'Fouls')}</h3>
                  <span class="tag">Optional</span>
                </header>
                {#if layout.help('robot.fouls')}<p class="field-help">{layout.help('robot.fouls')}</p>{/if}
                <div class="foul-grid">
                  {#each [['minor', 'Minor fouls'], ['major', 'Major fouls']] as [kind, label] (kind)}
                    {@const value = kind === 'minor' ? foulsMinor : foulsMajor}
                    <div class="stepper" role="group" aria-label={label}>
                      <span class="stepper-label">{label}</span>
                      <button
                        class="step-btn"
                        aria-label={`One fewer ${label.toLowerCase()}`}
                        disabled={!value}
                        on:click={() => {
                          if (kind === 'minor') foulsMinor = stepCount(foulsMinor, -1);
                          else foulsMajor = stepCount(foulsMajor, -1);
                        }}><Minus size={16} /></button
                      >
                      <output class="step-value" aria-live="polite">{value ?? '—'}</output>
                      <button
                        class="step-btn"
                        aria-label={`One more ${label.toLowerCase()}`}
                        on:click={() => {
                          if (kind === 'minor') foulsMinor = stepCount(foulsMinor, 1);
                          else foulsMajor = stepCount(foulsMajor, 1);
                        }}><Plus size={16} /></button
                      >
                      {#if value === null}<button
                          class="none-btn"
                          on:click={() => {
                            if (kind === 'minor') foulsMinor = 0;
                            else foulsMajor = 0;
                          }}>None</button
                        >{:else}<button
                          class="none-btn"
                          on:click={() => {
                            if (kind === 'minor') foulsMinor = null;
                            else foulsMajor = null;
                          }}>Not sure</button
                        >{/if}
                    </div>
                  {/each}
                </div>
              </section>
            </div>
          {/if}
          <div class="blk" style="order:{orders.get('core:postmatch.break') ?? 0}">
            <div class="post-grid outcome-panel">
              <fieldset>
                <legend>{layout.label('postmatch.break', 'Mechanical break')} (required)</legend>
                <div class="segmented">
                  <button class:chosen={mechanicalBreak === false} on:click={() => (mechanicalBreak = false)}>No</button
                  ><button class:chosen={mechanicalBreak === true} on:click={() => (mechanicalBreak = true)}
                    >Yes — pit crew report required</button
                  >
                </div>
              </fieldset>
            </div>
          </div>
          {#if !layout.hidden('robot.breaks')}
            <div class="blk" style="order:{orders.get('core:robot.breaks') ?? 0}">
              <section
                class="t-card breaks-card"
                class:emphasis={mechanicalBreak === true ||
                  teleopRobotStatus === 'dead' ||
                  robotDisabled === 'disabled' ||
                  robotDisabled === 'died'}
              >
                <header class="t-head">
                  <h3>{layout.label('robot.breaks', 'What broke and how the team handled it')}</h3>
                  <span class="tag">Optional</span>
                </header>
                {#if layout.help('robot.breaks')}<p class="field-help">{layout.help('robot.breaks')}</p>{/if}
                <label
                  >What broke<textarea
                    class="form-input"
                    rows="2"
                    maxlength="2000"
                    placeholder="e.g. intake chain snapped, shooter stopped spinning, lost comms"
                    bind:value={breakDetails}
                  ></textarea></label
                >
                <label
                  >How it affected the robot's performance<textarea
                    class="form-input"
                    rows="2"
                    maxlength="2000"
                    placeholder="e.g. could not collect from the ground, only scored preload"
                    bind:value={breakImpact}
                  ></textarea></label
                >
                <label
                  >How the team played or handled it<textarea
                    class="form-input"
                    rows="2"
                    maxlength="2000"
                    placeholder="e.g. switched to defense, fed partners, fixed it before the next match"
                    bind:value={breakResponse}
                  ></textarea></label
                >
              </section>
            </div>
          {/if}
          {#if !layout.hidden('postmatch.beached')}
            <div class="blk" style="order:{orders.get('core:postmatch.beached') ?? 0}">
              <label class="incident-toggle"
                ><input type="checkbox" bind:checked={beached} /><span
                  ><AlertTriangle size={17} /> {layout.label('postmatch.beached', 'Robot became beached')}</span
                ></label
              >
            </div>
          {/if}
          <div class="blk" style="order:{orders.get('core:postmatch.problem') ?? 0}">
            {#if requiresPitReport}
              <div class="required-handoff">
                <AlertTriangle size={17} /><span
                  >An pit crew report is required for a mechanical break, dead, or disabled robot.</span
                >
              </div>
            {:else if !layout.hidden('postmatch.problem')}
              <label class="incident-toggle"
                ><input type="checkbox" bind:checked={pitProblem} /><span
                  ><AlertTriangle size={17} />
                  {layout.label('postmatch.problem', 'Send a problem to the pit crew')}</span
                ></label
              >
            {/if}
            {#if shouldReportPitProblem}
              <label class="notes-label pit-report-field"
                >Problem for pit crew (required)<textarea
                  class="form-input"
                  required
                  rows="3"
                  placeholder="What failed, and what should the pit crew inspect before the next match?"
                  bind:value={pitProblemDetails}
                ></textarea></label
              >
            {/if}
          </div>
          <CustomQuestions questions={customIn('robot')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        {#if error}<p class="submit-error" role="alert">{error}</p>{/if}
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase(phaseBefore('robot'))}>Back</button><button
            class="btn btn-primary"
            on:click={continueFromRobot}>Continue to post-match <ChevronRight size={16} /></button
          >
        </div>
      {:else}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Post-match</span>
            <h2>Wrap up</h2>
            <p>Anything strategy should know, then submit the report.</p>
          </div>
          <Trophy size={20} />
        </div>
        <div class="blocks packed">
          {#if !layout.hidden('postmatch.notes')}
            <div class="blk" style="order:{orders.get('core:postmatch.notes') ?? 0}">
              <label class="notes-label scouter-notes"
                >{layout.label('postmatch.notes', 'Post-match scout notes')} (optional)<textarea
                  class="form-input"
                  rows="8"
                  placeholder="Anything strategy should know that the structured fields missed? Leave blank if not."
                  bind:value={postNotes}
                ></textarea></label
              >
            </div>
          {/if}
          <CustomQuestions questions={customIn('postmatch')} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
        <div class="section-footer">
          <button class="btn" on:click={() => selectPhase(phaseBefore('postmatch'))}>Back</button><button
            class="btn btn-primary"
            on:click={finishScout}
            disabled={!canFinish}
            >{saving
              ? 'Saving...'
              : editing
                ? 'Save changes'
                : `Finish ${REPORT_KIND_LABELS[reportKind].toLowerCase()}`}
            <Check size={16} /></button
          >
        </div>
        {#if error}<p class="submit-error">{error}</p>{/if}
      {/if}
    </section>
  </div>
</main>

<style>
  .report-row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  /* flex-end, not center: .competition-picker is a 2-row grid (its own
     "Competition" label above the select), so centering it against the
     single-line "My reports" button left the button riding high, aligned
     with the label text instead of the select it actually sits next to. */
  .report-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .competition-picker {
    display: grid;
    gap: 0.25rem;
    min-width: min(100%, 22rem);
    font-weight: 600;
  }
  .competition-picker span {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .report-history {
    padding: var(--space-4);
    margin-bottom: var(--space-4);
  }
  .report-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  .start-position-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
  }
  .start-position-card img,
  .start-position-card svg {
    width: 100%;
    height: auto;
    aspect-ratio: 100 / 48.5;
    object-fit: cover;
  }
  .submit-error {
    margin: var(--space-2) 0 0;
    color: var(--danger);
    font-size: 0.85rem;
  }
  .match-scouting-page {
    margin: 0 auto;
    padding: var(--space-4);
  }
  .match-scouting-page {
    transition:
      background-color 160ms ease,
      box-shadow 160ms ease;
    clip-path: inset(0 -100vmax);
  }
  h1,
  h2 {
    margin: 0;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
  }
  h2 {
    font-size: 1.2rem;
  }
  .assignment-chip {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    font-size: 0.85rem;
  }
  .assignment-chip b {
    text-transform: uppercase;
    font-size: 0.72rem;
  }
  .assignment-chip.red b {
    color: var(--red-strong);
  }
  .assignment-chip.blue b {
    color: var(--blue-strong);
  }
  .kind-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .kind-tabs button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-2);
    min-height: 2.9rem;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-right: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
  }
  .kind-tabs button:last-child {
    border-right: 0;
  }
  .kind-tabs button.active {
    color: var(--text);
    background: var(--brand-gold-soft);
    box-shadow: inset 0 -3px 0 var(--brand-gold-base);
  }
  .kind-tabs button:disabled {
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .kind-tabs button span {
      font-size: 0.8rem;
    }
    .kind-tabs button {
      flex-direction: column;
      gap: 2px;
    }
  }
  .scouting-shell {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    gap: var(--gap-4);
    align-items: start;
  }
  .stage-nav {
    position: sticky;
    top: calc(var(--strip-height) + var(--space-3));
    display: grid;
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .stage-nav button {
    display: flex;
    gap: var(--gap-2);
    align-items: center;
    min-height: 3.25rem;
    padding: var(--space-3);
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
  }
  .stage-nav button:last-child {
    border-bottom: 0;
  }
  .stage-nav button.active {
    color: var(--text);
    background: var(--brand-gold-soft);
    box-shadow: inset 3px 0 0 var(--brand-gold-base);
  }
  .stage-nav button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .stage-nav span,
  .eyebrow,
  .field-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .section-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-bottom: var(--space-5);
  }
  .section-heading :global(svg) {
    color: var(--text-muted);
  }
  .persistent-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-left: 3px solid var(--green-base);
    background: var(--surface-2);
  }
  .persistent-status.urgent {
    border-left-color: var(--red-base);
    background: var(--red-soft);
  }
  .persistent-status > div:first-child {
    display: grid;
    gap: 2px;
  }
  .persistent-status small,
  .field-help {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .status-buttons {
    margin-top: 0;
  }
  .assignment-grid,
  .post-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--gap-4);
  }
  label,
  fieldset {
    display: grid;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
  }
  .segmented,
  .choice-grid,
  .position-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
  }
  .segmented button,
  .choice-grid button,
  .position-grid button {
    min-height: var(--control-height);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    cursor: pointer;
  }
  .segmented button.chosen,
  .choice-grid button.chosen,
  .position-grid button.chosen {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
    color: var(--secondary);
    font-weight: 600;
  }
  .segmented .red-choice.chosen {
    border-color: var(--red-base);
    background: var(--red-soft);
  }
  .segmented .blue-choice.chosen {
    border-color: var(--blue-base);
    background: var(--blue-soft);
  }
  .start-position-block,
  .control-group,
  .notes-label,
  .incident-toggle {
    margin-top: var(--space-5);
  }
  .position-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin-top: var(--space-2);
  }
  .position-grid button {
    min-height: 4rem;
    text-transform: capitalize;
  }
  .section-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .section-footer .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
  }
  .auto-layout {
    display: grid;
  }
  .choice-grid {
    margin-top: var(--space-2);
  }
  .auto-points-input {
    margin-top: var(--space-2);
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }
  .auto-points-input.invalid {
    border-color: var(--danger);
  }
  .balls-control {
    display: grid;
    gap: 4px;
    margin-bottom: var(--space-4);
    max-width: 22rem;
  }
  .auto-points-slider {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--gap-3);
    margin-top: var(--space-2);
  }
  .auto-points-slider input[type='range'] {
    width: 100%;
    accent-color: var(--brand-gold);
  }
  .auto-points-slider output {
    min-width: 3rem;
    text-align: right;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .estimate-result {
    color: var(--text-muted);
  }
  .estimate-result strong {
    color: var(--text);
  }
  .estimate-error {
    color: var(--danger);
  }
  .auto-source-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .collision-notes {
    margin-top: var(--space-2);
    resize: vertical;
  }
  .role-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  }
  .role-grid button {
    overflow-wrap: anywhere;
    white-space: normal;
    height: auto;
  }
  .notes-label textarea {
    resize: vertical;
    min-height: 7rem;
    line-height: 1.5;
  }
  .scouter-notes textarea {
    min-height: 12rem;
  }
  .incident-toggle {
    display: flex;
    grid-template-columns: auto 1fr;
    align-items: center;
    color: var(--text);
    font-size: 0.9rem;
  }
  .incident-toggle span {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
  }
  .incident-toggle :global(svg) {
    color: var(--red-base);
  }
  .pit-report-field {
    margin-top: var(--space-3);
  }
  .t-card {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-4) 0 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
    min-width: 0;
  }
  .t-card > p,
  .t-card > .field-help {
    margin: 0;
  }
  .t-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    padding: 0;
  }
  .t-head h3,
  .t-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .tag {
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.66rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tag.req {
    border-color: var(--brand-gold-strong);
    color: var(--brand-gold-strong);
  }
  .role-grid button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-2);
  }
  .role-grid .none-choice:not(.chosen) {
    color: var(--text-muted);
  }
  .balls-control .form-input {
    max-width: 22rem;
  }
  .scale-row {
    display: grid;
    grid-template-columns: minmax(7rem, 0.7fr) minmax(0, 2fr);
    align-items: center;
    gap: var(--gap-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .scale-name {
    font-size: 0.92rem;
    font-weight: 500;
  }
  .scale-name small {
    display: block;
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 400;
  }
  .scale {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--gap-2);
  }
  .scale.scale-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    max-width: 20rem;
  }
  .scale-btn {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    min-height: 3.4rem;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background-color 0.12s ease,
      transform 0.1s ease;
  }
  .scale-btn b {
    font-size: 1.05rem;
    font-weight: 600;
  }
  .scale-btn small {
    color: var(--text-muted);
    font-size: 0.66rem;
    line-height: 1.15;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .scale-btn:hover {
    border-color: var(--brand-gold-strong);
  }
  .scale-btn.chosen {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
    transform: translateY(-1px);
  }
  .scale-btn.chosen b {
    color: var(--secondary);
  }
  .scale-btn.chosen small {
    color: var(--text);
  }
  .segmented.big button {
    min-width: 5rem;
    min-height: 3rem;
  }
  .card-panel {
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .blocks {
    display: flex;
    flex-direction: column;
  }
  .blk {
    display: block;
    min-width: 0;
  }
  .status-choice-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .status-choice.chosen.status-dead {
    border-color: var(--red-base);
    background: var(--red-soft);
    color: var(--text);
  }
  .status-choice.chosen.status-stopped {
    border-color: var(--chart-orange);
    background: color-mix(in srgb, var(--chart-orange) 20%, transparent);
    color: var(--text);
  }
  .outcome-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-4);
    margin-bottom: var(--space-5);
  }
  .outcome-panel {
    margin: 0;
  }
  .card-choice-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .card-choice {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-2);
  }
  .card-swatch {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .card-yellow .card-swatch {
    background: var(--card-yellow);
    border-color: var(--card-yellow-edge);
  }
  .card-red .card-swatch {
    background: var(--red-base);
    border-color: var(--red-base);
  }
  .card-yellow.chosen {
    border-color: var(--card-yellow-edge);
    background: var(--brand-gold-soft);
    color: var(--brand-gold-strong);
  }
  .card-red.chosen {
    border-color: var(--red-base);
    background: var(--red-soft);
    color: var(--text);
  }
  /* "Did the robot show up?" is one short row at the top of Pre-match on every tab: the question, then Yes / No. */
  .present-card {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .present-card legend {
    float: left;
    margin: 0;
    padding: 0;
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .present-choice {
    display: inline-grid;
    grid-template-columns: repeat(2, 4.5rem);
    gap: var(--gap-2);
  }
  .present-choice button {
    min-height: 2.25rem;
    font-weight: 600;
  }
  .present-note {
    flex-basis: 100%;
    margin: 0;
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.85rem);
  }
  .required-handoff {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-2);
    margin-top: var(--space-5);
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--red-base);
    background: var(--red-soft);
    color: var(--text);
    font-size: 0.88rem;
  }
  .required-handoff :global(svg) {
    flex: none;
    color: var(--red-base);
  }
  /* One series, so no legend box is needed for identity - the axis labels
     name each value directly, and the numbers sit beside the shape so the
     chart is never the only encoding. Grid and spokes stay recessive; only
     the shape carries the accent. */
  .rating-star {
    display: grid;
    grid-template-columns: auto minmax(0, 11rem);
    gap: var(--gap-4);
    align-items: center;
    margin: 0;
  }
  .rating-star svg {
    width: min(260px, calc(60 * var(--vw)));
    height: auto;
    overflow: visible;
  }
  .star-ring {
    fill: none;
    stroke: var(--border);
    stroke-width: 1;
  }
  .star-ring.outer {
    stroke: var(--text-muted);
    opacity: 0.45;
  }
  .star-spoke {
    stroke: var(--border);
    stroke-width: 1;
  }
  .star-shape {
    fill: color-mix(in srgb, var(--brand-gold-base, #d9a413) 26%, transparent);
    stroke: var(--brand-gold-base, #d9a413);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .star-node {
    fill: var(--brand-gold-base, #d9a413);
    stroke: var(--surface-1);
    stroke-width: 2;
  }
  .star-legend {
    display: grid;
    gap: 2px;
    text-align: left;
  }
  .star-legend-row {
    display: flex;
    align-items: baseline;
    gap: var(--gap-2);
    font-size: 0.82rem;
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
  }
  .star-legend-label {
    flex: 1;
  }
  .star-axis-index,
  .star-legend-index {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    fill: var(--text-muted);
    color: var(--text-muted);
  }
  .star-axis-index {
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .star-legend-index {
    min-width: 1ch;
  }
  .star-legend-label {
    color: var(--text-muted);
  }
  .star-legend-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--text);
  }
  .star-legend-row.unrated .star-legend-value {
    color: var(--text-muted);
    font-weight: 400;
  }
  .star-empty {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  @media (max-width: 480px) {
    .rating-star {
      grid-template-columns: 1fr;
      justify-items: center;
    }
    .star-legend {
      width: min(260px, calc(80 * var(--vw)));
    }
  }
  .submitted-state {
    min-height: 32rem;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    text-align: center;
  }
  .submitted-state p {
    margin: 0;
    color: var(--text-muted);
  }
  .submitted-icon {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
    background: var(--green-soft);
    color: var(--green-strong);
    border-radius: 50%;
  }

  /* Match Scouting intentionally shares Pit Scouting's focused field-workspace language. */
  .match-scouting-page .page-header {
    margin-bottom: var(--space-5);
  }
  .assignment-chip {
    min-height: 2.7rem;
    background: var(--surface-1);
    border-radius: 0;
  }
  .assignment-chip.red {
    border-left: 3px solid var(--red-base);
  }
  .assignment-chip.blue {
    border-left: 3px solid var(--blue-base);
  }
  .scouting-shell {
    grid-template-columns: 13.5rem minmax(0, 1fr);
    gap: var(--space-4);
  }
  .stage-nav {
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: 0;
  }
  .stage-nav button {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    min-height: 3.2rem;
    padding: var(--space-2);
    border-bottom: 0;
  }
  .stage-nav button.active {
    box-shadow: inset 3px 0 0 var(--brand-gold-strong);
  }
  .stage-nav button small {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .match-workspace {
    padding: var(--space-5);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .section-heading {
    margin-bottom: var(--space-5);
  }
  .section-heading p {
    max-width: 38rem;
    margin: 0.45rem 0 0;
    color: var(--text-muted);
    font-size: 0.87rem;
    line-height: 1.45;
  }
  .section-heading > :global(svg) {
    padding: 0.55rem;
    box-sizing: content-box;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .assignment-grid {
    grid-template-columns: 1fr 1fr 1.25fr;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .start-position-block {
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
    margin-top: 0;
  }
  .position-grid button {
    position: relative;
    min-height: 8rem;
    text-transform: capitalize;
  }
  .position-grid button.chosen::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 0.65rem;
    width: 0.35rem;
    height: 0.35rem;
    border-radius: 50%;
    background: var(--brand-gold-strong);
    transform: translateX(-50%);
  }
  .auto-layout {
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .control-group {
    margin-top: 0;
  }
  .notes-label {
    padding: var(--space-4);
    border: 1px solid var(--border);
  }
  .incident-toggle {
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--red-base);
    background: var(--red-soft);
  }
  .post-grid {
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .post-grid {
    grid-template-columns: 1fr;
  }
  .submitted-state {
    background: var(--surface-2);
  }
  .training-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-left: 3px solid var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .training-banner > div {
    display: grid;
    flex: 1;
    min-width: 12rem;
  }
  .training-banner span {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .training-banner .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .training-banner .muted {
    font-size: 0.8rem;
  }
  .foul-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-3);
  }
  .stepper {
    display: grid;
    grid-template-columns: 1fr auto 3rem auto;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .stepper-label {
    grid-column: 1 / -1;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .stepper .step-btn {
    grid-row: 2;
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .stepper .step-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .stepper .step-btn:first-of-type {
    grid-column: 2;
  }
  .stepper .step-btn:last-of-type {
    grid-column: 4;
  }
  .step-value {
    grid-row: 2;
    grid-column: 3;
    text-align: center;
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .none-btn {
    grid-row: 2;
    grid-column: 1;
    justify-self: start;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .breaks-card label {
    color: var(--text);
    font-size: 0.85rem;
  }
  .breaks-card textarea {
    resize: vertical;
  }
  .breaks-card.emphasis {
    border-left: 3px solid var(--red-base);
  }

  /* The page uses the whole stage. Competition, My reports and the three tabs share one toolbar row. */
  .match-scouting-page .page-header {
    margin-bottom: var(--space-3);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .toolbar .kind-tabs {
    flex: 1 1 30rem;
    margin-bottom: 0;
  }
  /* The competition picker and My reports sit in the header, beside the assignment chip. */
  .page-header .report-actions {
    align-items: center;
    margin: 0 0 0 auto;
  }
  .page-header .competition-picker {
    grid-template-columns: auto minmax(14rem, 22rem);
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  /* Each phase's cards sit on an aligned grid of at most four columns. Cards in a row share one height, and
     a card's controls sit at its bottom so button rows line up across the row. Cards holding several ratings
     span two rows; the power ranking, notes, fouls and breaks span two columns. Pre-match stays one column. */
  .blocks.packed {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(max(22rem, calc((100% - 3 * var(--gap-4)) / 4)), 1fr));
    grid-auto-flow: row dense;
    gap: var(--gap-4);
    align-items: stretch;
  }
  .blocks.packed > :global(*) {
    margin: 0;
    min-width: 0;
  }
  .blocks.packed > .blk {
    display: flex;
    flex-direction: column;
  }
  .blocks.packed > .blk > :global(*) {
    flex: 1;
    margin: 0;
  }
  .match-workspace {
    container-type: inline-size;
  }
  @container (min-width: 46rem) {
    .blocks.packed > .tall {
      grid-row: span 2;
    }
  }
  .blocks.packed .t-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Help text reserves two lines, so controls in neighbouring cards start at the same height. */
  .blocks.packed :is(.t-card, .control-group) > .field-help {
    min-height: 2.6em;
    line-height: 1.3;
  }
  .blocks.packed .t-head {
    min-height: 1.7rem;
  }
  /* A card with one scale grows its buttons to fill the card, instead of leaving a gap under them. */
  .blocks.packed .t-card > .scale {
    flex: 1;
    max-width: none;
  }
  .blocks.packed .notes-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .blocks.packed .notes-label textarea {
    flex: 1;
  }
  /* Auto has three columns: the two short questions stack in the first, beside the points and fuel-source cards. */
  .auto-controls.blocks.packed {
    grid-template-columns: repeat(auto-fit, minmax(max(22rem, calc((100% - 2 * var(--gap-4)) / 3)), 1fr));
  }
  .blocks.packed .balls-control,
  .blocks.packed .balls-control .form-input {
    max-width: none;
  }
  .blocks.packed .scouter-notes textarea,
  .blocks.packed .notes-label textarea {
    min-height: 6rem;
  }
  .blocks.packed .role-grid {
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  }
  /* Alliance is the first thing a scout checks, so Red and Blue are large, colored buttons. */
  /* Pre-match: the assignment spans the top; Preload is a narrow card to the left of Starting position. */
  .prematch-blocks {
    display: grid;
    grid-template-columns: minmax(11rem, 14rem) minmax(0, 1fr);
    gap: var(--gap-4);
  }
  .prematch-blocks > :global(*) {
    grid-column: 1 / -1;
    margin: 0;
  }
  .prematch-blocks > .blk:has(> .preload-card) {
    grid-column: 1;
  }
  .prematch-blocks > .blk:has(> .start-position-block) {
    grid-column: 2;
  }
  .prematch-blocks > .blk {
    display: flex;
    flex-direction: column;
  }
  .prematch-blocks > .blk > :global(*) {
    flex: 1;
  }
  .preload-card {
    display: block;
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .preload-card legend {
    float: left;
    width: 100%;
  }
  .preload-card legend,
  .start-position-block .field-label {
    display: block;
    margin-bottom: var(--space-3);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }
  .preload-card legend + * {
    clear: both;
  }
  .preload-card {
    display: flex;
    flex-direction: column;
  }
  .preload-choice {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    grid-auto-rows: minmax(3.25rem, 1fr);
    gap: var(--gap-2);
  }
  .preload-choice button {
    min-height: 3.25rem;
    font-weight: 600;
  }
  .start-position-block .position-grid {
    margin-top: 0;
  }
  .start-position-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }
  .start-position-head .field-label {
    margin: 0;
  }
  .flip-view {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-muted);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .flip-view:hover {
    border-color: var(--brand-gold-strong);
    color: var(--text);
  }
  .flip-view[aria-pressed='true'] {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
    color: var(--text);
  }
  .position-grid.flipped img {
    transform: rotate(180deg);
  }
  /* The field pictures take as much of each card as they can. */
  .start-position-block .position-grid {
    gap: var(--gap-2);
  }
  .start-position-block .position-grid button.start-position-card {
    gap: 0.3rem;
    min-height: 0;
    padding: var(--space-1) var(--space-1) var(--space-2);
  }
  .start-position-block .start-position-card span {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .start-position-block .position-grid button.chosen::after {
    display: none;
  }
  @media (max-width: 768px) {
    .prematch-blocks {
      grid-template-columns: 1fr;
    }
    .prematch-blocks > .blk:has(> :is(.preload-card, .start-position-block)) {
      grid-column: 1;
    }
    .preload-choice {
      grid-template-columns: 1fr 1fr;
    }
  }
  .alliance-field {
    display: block;
  }
  .alliance-field legend {
    float: left;
    width: 100%;
    margin-bottom: var(--space-2);
  }
  .alliance-field legend + * {
    clear: both;
  }
  .alliance-choice {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-2);
  }
  .alliance-choice button {
    min-height: 3.25rem;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .alliance-choice .red-choice {
    color: var(--red-strong);
    border-color: color-mix(in srgb, var(--red-base) 55%, var(--border));
  }
  .alliance-choice .blue-choice {
    color: var(--blue-strong);
    border-color: color-mix(in srgb, var(--blue-base) 55%, var(--border));
  }
  .segmented.alliance-choice .red-choice.chosen {
    background: var(--red-soft);
    border-color: var(--red-base);
    color: var(--red-strong);
    box-shadow: inset 0 -3px 0 var(--red-base);
  }
  .segmented.alliance-choice .blue-choice.chosen {
    background: var(--blue-soft);
    border-color: var(--blue-base);
    color: var(--blue-strong);
    box-shadow: inset 0 -3px 0 var(--blue-base);
  }
  .break-fields {
    display: grid;
    gap: var(--space-3);
  }
  /* Cards narrower than a full row put the label above its buttons; wide ones spread their fields out. */
  .t-card {
    container-type: inline-size;
  }
  @container (min-width: 40rem) {
    .break-fields {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @container (max-width: 30rem) {
    .scale-row {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }
    .foul-grid {
      grid-template-columns: 1fr;
    }
    .scale-btn {
      padding: var(--space-1) 0;
    }
    .scale-btn small {
      font-size: 0.6rem;
      overflow-wrap: normal;
      letter-spacing: -0.02em;
    }
  }

  /* Every block in a packed phase is the same kind of card: a title row, then controls that fill the card's width. */
  .blocks.packed > .blk > :is(.control-group, .notes-label, .post-grid) {
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .blocks.packed :is(.control-group, .outcome-panel fieldset) {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  /* A fieldset draws its legend into its border; floating it makes it an ordinary heading inside the card. */
  .blocks.packed legend {
    float: left;
    width: 100%;
  }
  .blocks.packed legend + * {
    clear: both;
  }
  .blocks.packed :is(.field-label, legend),
  .blocks.packed > .blk > :is(label.control-group, .notes-label) {
    margin: 0;
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }
  .blocks.packed :is(input, textarea) {
    font-weight: 400;
  }
  .blocks.packed .field-help {
    margin: 0;
  }
  .blocks.packed .choice-grid {
    margin-top: 0;
  }
  .blocks.packed :is(.segmented, .status-choice-grid, .card-choice-grid) {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--gap-2);
  }
  .blocks.packed :is(.segmented, .choice-grid) button {
    min-height: 3rem;
    padding: var(--space-2) var(--space-3);
    white-space: normal;
    line-height: 1.25;
  }
  .auto-layout {
    padding: 0;
    border: 0;
    background: none;
  }
  .auto-points-control {
    gap: var(--space-2);
  }
  .auto-points-control .auto-points-input,
  .auto-points-control .auto-points-slider {
    margin-top: 0;
  }
  @media (min-width: 961px) {
    .match-workspace > .blocks,
    .match-workspace > .auto-layout {
      margin-bottom: var(--space-2);
    }
    .section-heading {
      margin-bottom: var(--space-4);
    }
    .section-heading p {
      max-width: 60rem;
    }
    .assignment-grid {
      grid-template-columns: 1fr 0.7fr 1fr minmax(16rem, 1.1fr);
      align-items: end;
    }
    .assignment-grid :is(.form-input) {
      min-height: 3.25rem;
    }
    /* The row's inputs line up along the bottom, so the match hint hangs below its field instead of lifting it. */
    .assignment-grid label:has(.match-hint) {
      position: relative;
    }
    .assignment-grid .match-hint {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
    }
    .assignment-grid:has(.match-hint) {
      padding-bottom: calc(var(--space-4) + 2.6em);
    }
  }
  @media (max-width: 960px) {
    .scouting-shell {
      grid-template-columns: 1fr;
    }
    .stage-nav {
      position: static;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .stage-nav button {
      grid-template-columns: 1fr;
      justify-items: center;
      text-align: center;
    }
    .stage-nav button small {
      display: none;
    }
    .match-workspace {
      min-height: 0;
    }
  }
  @media (max-width: 768px) {
    .match-scouting-page {
      padding: var(--space-3);
    }
    .match-scouting-page .page-header {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-3);
    }
    .assignment-chip {
      width: 100%;
      justify-content: space-between;
    }
    .stage-nav {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
      padding: var(--space-2);
    }
    .stage-nav button {
      min-height: 3.5rem;
    }
    .match-workspace {
      padding: var(--space-4);
    }
    .assignment-grid {
      grid-template-columns: 1fr;
    }
    .start-position-block {
      padding: var(--space-3);
    }
    .position-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .auto-layout,
    .foul-grid {
      grid-template-columns: 1fr;
    }
    .scale-row {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }
    .persistent-status {
      align-items: flex-start;
      flex-direction: column;
    }
    .section-footer {
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .section-footer > button {
      flex: 1 1 10rem;
      min-height: 3rem;
    }
    .choice-grid button,
    .segmented button,
    .position-grid button {
      min-height: 2.75rem;
    }
    .auto-layout,
    .t-card,
    .notes-label,
    .post-grid,
    .card-panel {
      padding: var(--space-3);
    }
  }
  @media (max-width: 480px) {
    .match-scouting-page {
      padding: var(--space-2);
    }
    .match-workspace {
      padding: var(--space-3);
    }
    .stage-nav {
      gap: var(--space-1);
    }
    .stage-nav button {
      min-height: 3.25rem;
      padding: var(--space-2);
    }
    .section-heading {
      align-items: flex-start;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .section-heading h2 {
      font-size: var(--font-lg);
    }
    .position-grid {
      grid-template-columns: 1fr;
    }
    .auto-source-grid {
      grid-template-columns: 1fr;
    }
    .submitted-state {
      min-height: 24rem;
      padding: var(--space-4) var(--space-2);
    }
  }

  /* Phone layout (#124). The page sits on the app's own gutter, the stages are one thin row that
     stays under the header, and each stage's Back / Continue bar docks above the bottom bar so the
     next step is always under the thumb. */
  @media (max-width: 768px) {
    .match-scouting-page {
      padding: 0;
    }
    .match-scouting-page .page-header .header-content p {
      display: none;
    }
    .match-scouting-page .page-header h1 {
      font-size: 1.25rem;
    }
    .page-header .report-actions {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
      margin: 0;
    }
    .page-header .competition-picker {
      grid-template-columns: 1fr;
      min-width: 0;
    }
    .assignment-chip {
      min-height: var(--tap-comfort);
      font-size: 1rem;
      font-weight: 600;
    }
    .kind-tabs button {
      min-height: var(--tap-comfort);
    }
    .stage-nav {
      position: sticky;
      top: calc(3rem + var(--safe-top));
      z-index: 4;
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      grid-template-columns: none;
      gap: 2px;
      padding: 4px;
      margin-bottom: var(--space-2);
      background: color-mix(in srgb, var(--surface-1) 94%, transparent);
      backdrop-filter: blur(8px);
    }
    .stage-nav button {
      min-height: var(--tap-min);
      padding: 4px 2px;
      gap: 2px;
      grid-template-columns: 1fr;
      justify-items: center;
      font-size: 0.75rem;
    }
    .stage-nav button :global(svg) {
      width: 16px;
      height: 16px;
    }
    .stage-nav button.active {
      box-shadow: inset 0 -3px 0 var(--brand-gold-strong);
    }
    .match-workspace {
      padding: var(--space-3);
    }
    .section-footer {
      position: static;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
      gap: var(--space-2);
      margin: var(--space-5) calc(-1 * var(--space-2)) 0;
      padding: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--surface-1) 96%, transparent);
      backdrop-filter: blur(8px);
    }
    .section-footer > span {
      grid-column: 1 / -1;
      font-size: 0.8rem;
      line-height: 1.3;
    }
    .section-footer > button {
      min-height: var(--tap-comfort);
      width: 100%;
      justify-content: center;
    }
    .section-footer > button:only-of-type {
      grid-column: 1 / -1;
    }
    .section-footer > button.btn-primary {
      font-size: 1rem;
    }
    .choice-grid button,
    .segmented button,
    .position-grid button {
      min-height: var(--tap-comfort);
    }
    .tag {
      font-size: var(--text-min);
    }
    /* 16px text stops iOS zooming into a field when it is tapped. */
    .match-workspace :is(input:not([type='checkbox']):not([type='radio']):not([type='range']), .form-input, textarea) {
      min-height: var(--tap-comfort);
      font-size: 1rem;
    }
    .flip-view {
      min-height: var(--tap-min);
    }
  }
  @container (max-width: 30rem) {
    .scale-btn small {
      font-size: 0.7rem;
      letter-spacing: 0;
    }
  }

  /* Phone header (#124) */
  .ph-scout {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .ph-scout-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .ph-scout-top > div {
    display: grid;
  }
  .ph-scout-top small {
    color: var(--text-secondary);
    font-size: 0.88rem;
  }
  .ph-scout-top b {
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 6vw, 1.9rem);
    line-height: 1.1;
  }
  .ph-scout-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--tap-comfort);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-left: 4px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    font-size: 1rem;
  }
  .ph-scout-chip.red {
    border-left-color: var(--red-base);
  }
  .ph-scout-chip.blue {
    border-left-color: var(--blue-base);
  }
  .ph-scout-chip b {
    font-family: var(--font-mono);
  }
  .ph-scout-chip .ph-side {
    text-transform: uppercase;
    font-family: var(--font-display);
    letter-spacing: 0.08em;
    font-size: 0.85rem;
  }
  .ph-scout-chip.red .ph-side {
    color: var(--red-strong);
  }
  .ph-scout-chip.blue .ph-side {
    color: var(--blue-strong);
  }
  .ph-editing {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--warning);
    font-size: 0.85rem;
  }

  /* Phone, compact (#124): as much of each stage on screen as possible. Smaller kind switch and
     stage row, no descriptions, two fields per row where they fit, and the stage's action docked. */
  @media (max-width: 900px) {
    .ph-scout {
      gap: 6px;
      margin-bottom: 8px;
    }
    .ph-scout-top b {
      font-size: 1.3rem;
    }
    .ph-scout-top small {
      font-size: 0.8rem;
    }
    .ph-scout-chip {
      min-height: var(--tap-min);
      font-size: 0.95rem;
    }
    .kind-tabs {
      margin-bottom: 6px;
      border-radius: 10px;
      overflow: hidden;
    }
    .kind-tabs button,
    .kind-tabs button:is(*) {
      flex-direction: row;
      gap: 6px;
      min-height: var(--tap-min);
      padding: 0 6px;
      font-size: 0.85rem;
    }
    .kind-tabs button span {
      font-size: 0.85rem;
    }
    .stage-nav {
      padding: 2px;
      margin-bottom: 6px;
      border-radius: 10px;
    }
    .stage-nav button {
      min-height: var(--tap-min);
      padding: 2px;
      gap: 0;
      font-size: 0.75rem;
      letter-spacing: 0;
      text-transform: none;
    }
    .stage-nav button :global(svg) {
      width: 15px;
      height: 15px;
    }
    .section-heading {
      margin-bottom: 8px;
    }
    .section-heading .eyebrow,
    .section-heading p,
    .section-heading > :global(svg) {
      display: none;
    }
    .section-heading h2 {
      font-size: 1.1rem;
    }
    .match-workspace {
      padding: 10px;
    }
    .assignment-grid {
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 10px;
    }
    .assignment-grid > label:first-child,
    .assignment-grid > .alliance-field {
      grid-column: 1 / -1;
    }
    .assignment-grid label,
    .assignment-grid fieldset {
      gap: 4px;
      font-size: 0.78rem;
    }
    .match-workspace :is(input:not([type='checkbox']):not([type='radio']):not([type='range']), .form-input) {
      min-height: var(--tap-min);
    }
    .alliance-choice button {
      min-height: var(--tap-min);
      font-size: 0.9rem;
    }
    .blocks.packed > .blk > :is(.control-group, .notes-label, .post-grid) {
      padding: 10px;
    }
    .blocks.packed :is(.segmented, .choice-grid) button {
      min-height: var(--tap-min);
      padding: 4px 8px;
    }
    .scale-btn {
      min-height: 2.75rem;
    }
    .start-position-block {
      margin-top: 10px;
      padding: 10px;
    }
    .start-position-block .position-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .start-position-block .start-position-card span {
      font-size: 0.75rem;
    }
    .section-footer {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      margin-top: 12px;
      padding: 6px 6px 6px 10px;
    }
    .section-footer > span {
      grid-column: auto;
      font-size: 0.75rem;
      line-height: 1.25;
    }
    .section-footer > button {
      min-height: var(--tap-min);
      width: auto;
      padding: 0 16px;
    }
    .section-footer > button.btn-primary {
      font-size: 0.95rem;
    }
    .section-footer:has(> button + button) {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .section-footer > button:only-of-type {
      grid-column: auto;
    }
    .assignment-grid {
      padding: 0;
      border: 0;
      background: none;
    }
    .preload-choice button,
    .preload-card button {
      min-height: var(--tap-min);
    }
    .preload-card,
    .present-card {
      padding: 10px;
    }
    .present-card legend {
      font-size: 0.9rem;
    }
    .present-choice button {
      min-height: var(--tap-min);
    }
    .preload-card legend,
    .start-position-block .field-label {
      margin-bottom: 6px;
      font-size: 0.9rem;
    }
    .blocks.packed {
      gap: 8px;
    }
    .rating-star svg {
      width: min(190px, calc(52 * var(--vw)));
    }
    .rating-star {
      gap: 8px;
    }
  }

  /* Phone: one bar for kind + stage (#124) */
  @media (max-width: 900px) {
    .toolbar .kind-tabs,
    .stage-nav {
      display: none;
    }
  }
  .ph-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    margin: 0 0 8px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--surface-1) 94%, transparent);
    backdrop-filter: blur(8px);
  }
  .ph-kinds {
    flex: none;
    display: flex;
    gap: 0;
    padding-right: 6px;
    border-right: 1px solid var(--border);
  }
  .ph-kinds button {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1px;
    width: 44px;
    padding: 0;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    height: var(--tap-min);
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .ph-kinds button.on {
    background: var(--brand-gold-soft);
    color: var(--text);
  }
  .ph-kinds button span {
    font-size: 0.75rem;
  }
  .ph-stages {
    flex: 1;
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }
  .ph-stages li {
    flex: 1 1 0;
    min-width: 0;
  }
  .ph-stages button {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: var(--tap-min);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .ph-stages .seg {
    display: block;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-3);
  }
  .ph-stages button.done .seg {
    background: var(--brand-gold-strong);
  }
  .ph-stages button.on .seg {
    background: var(--brand-gold-base);
    height: 8px;
  }
  .ph-stage-name {
    flex: none;
    display: grid;
    justify-items: end;
    width: 4.6rem;
    font-size: 0.85rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ph-stage-name small {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .ph-stage-name {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
  .match-hint {
    display: block;
    margin-top: 4px;
    color: var(--warning);
    font-size: 0.8rem;
    font-weight: 500;
  }
</style>
