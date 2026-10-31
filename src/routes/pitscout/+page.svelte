<script>
  import { matchLabel } from '$lib/matches/matchKeys.js';
  import { compressPhoto } from '$lib/ui/compressPhoto.js';
  import { suggest } from '$lib/ui/suggest.js';
  import Select from '$lib/components/common/Select.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { authFetch, getAuthHeader, supabase } from '$lib/app/supabase.js';
  import {
    fetchActiveScoutingEventKey,
    fetchAvailableScoutingEvents,
    fetchManualScoutingTeams
  } from '$lib/scouting/scoutingEvent.js';
  import { submitOrQueue } from '$lib/app/offlineQueue.js';
  import CustomQuestions from '$lib/components/forms/CustomQuestions.svelte';
  import { fetchLiveForm } from '$lib/scouting/forms/formsClient.js';
  import {
    createLayout,
    emptyForm,
    firstMissing,
    isAnswered,
    questionsIn,
    sanitizeAnswers,
    sectionItems
  } from '$lib/scouting/forms/formSchema.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import OfflineSyncBadge from '$lib/components/common/OfflineSyncBadge.svelte';
  import RebuiltFieldMap from '$lib/components/scouting/RebuiltFieldMap.svelte';
  import PitProblemsView from '$lib/components/scouting/PitProblemsView.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import {
    AUTO_TOOL_OPTIONS,
    BUMPER_FOAM_OPTIONS,
    CLIMB_OPTIONS,
    COPROCESSOR_OPTIONS,
    DRIVEBASE_OPTIONS,
    ENCODER_TYPE_OPTIONS,
    HOPPER_OPTIONS,
    MAIN_BREAKER_OPTIONS,
    MAX_AUTO_DESCRIPTION_LENGTH,
    MAX_AUTO_NAME_LENGTH,
    MAX_AUTO_OPTIONS,
    MAX_BREAKING_COMPONENT_LENGTH,
    MOTOR_CONTROLLER_OPTIONS,
    MOTOR_TYPE_OPTIONS,
    NO_CLIMB_OPTION,
    PIT_STATUS,
    PROGRAMMING_LANGUAGE_OPTIONS,
    SB_CONNECTOR_OPTIONS,
    SHOOTER_OPTIONS,
    SWERVE_MODULE_OPTIONS,
    TECHNICAL_MULTI_OPTIONS,
    TRENCH_OR_BUMP_OPTIONS,
    VISION_OPTIONS,
    YES_NO_OPTIONS,
    emptyTechnicalDetails,
    filledAutoOptions,
    hasEstimatedBps,
    normalizeAutoOptions,
    normalizeClimbOptions,
    normalizeLikelyBreakingComponent,
    normalizeTechnicalDetails,
    pitScoutStatus
  } from '$lib/scouting/pitForm.js';

  const ESTIMATED_BPS_SLIDER_MAX = 30;

  let eventKey = ''; // globally active scouting event - writes always target this
  let selectedEventKey = null; // event being browsed for reading, if different from active
  let availableEvents = [];
  let lastLoadedEventKeyForTeams = null;

  // Reads (team roster, pit entries) use this so a lead can browse a past
  // event's pit data. Saves intentionally keep targeting the active eventKey
  // below, not this - see saveEntry().
  $: resolvedEventKey = selectedEventKey || eventKey;
  $: isViewingPastEvent = !!selectedEventKey && selectedEventKey !== eventKey;

  let loading = false;
  let saving = false;
  let uploading = false;
  let apiNote = '';
  let activeView = 'teams';
  let problems = [];
  let problemsError = '';
  let problemLoading = false;
  let problemSaving = false;

  let teams = [];
  let entriesByTeam = {};
  let selectedTeam = '';
  let teamSearch = '';
  // Deep link support: ?team=frc9408 (Team View's "View full pit scouting
  // data" button, or anywhere else) opens straight to that team's entry
  // instead of leaving a scout on the team picker.
  let requestedTeamKey = '';
  let pitContacts = [];
  let scout_name = '';

  let drivebase_type = '';
  let shooter_type = '';
  let hopper_type = '';
  // Write-in text shown when the matching select above is set to 'Other' -
  // kept as separate fields (not folded into technical_details) because
  // drivebase/shooter/hopper type are plain passthrough columns server-side
  // with no fixed enum to validate against, unlike technical_details' single
  // -select fields.
  let drivebase_type_other = '';
  let shooter_type_other = '';
  let hopper_type_other = '';
  let human_player_balls_in_auto = '';
  let pitSchema = {
    scout_name: true,
    robot_archetype: true,
    additional_notes: true,
    likely_breaking_component: true,
    estimated_bps: true,
    auto_points_estimate: true,
    climb_options: true,
    auto_options: true,
    technical_details: true,
    custom_answers: true
  };
  let schemaWarning = '';
  let robot_archetype = '';
  let additional_notes = '';
  let likely_breaking_component = '';
  let estimated_bps = undefined;
  let auto_points_estimate = '';
  let climb_options = [];
  let autoOptions = [];
  let technical_details = emptyTechnicalDetails();
  let editablePhotoPaths = [];
  let pendingFiles = [];
  // Pit scouting is done standing in a noisy pit with a phone in one hand,
  // talking to a team that volunteers information in whatever order it likes.
  // A single 600-line scroll of ~40 selects is the wrong shape for that: you
  // cannot tell what is still missing, and you cannot jump to the thing the
  // team just mentioned. Topics are answered one at a time, jumpable in any
  // order, with the remaining count always visible so a scout knows when they
  // can walk away.
  // Main: the fields on the reference pit scouting form (one page, direct
  // instruction) plus photos. Everything else that used to live in its own
  // top-level topic (Basics' leftovers, Mechanisms, the rest of Electrical/
  // Controls, Structure, Ratings) now lives under one "Extra" topic, picked
  // with a dropdown instead of its own rail button - still jumpable, just
  // not competing with Main for a scout's attention.
  const EXTRA_GROUPS = [
    { id: 'setup', label: 'Contact & Setup' },
    { id: 'mechanisms', label: 'Mechanisms' },
    { id: 'electrical', label: 'Electrical' },
    { id: 'controls', label: 'Controls' },
    { id: 'structure', label: 'Structure' },
    { id: 'ratings', label: 'Ratings' }
  ];

  // Which answers belong to which group, for the per-topic counts. Kept
  // explicit rather than derived from the markup so a field moving between
  // groups is a deliberate edit, not a silent change in what "complete" means.
  const MAIN_DETAIL_FIELDS = [
    'main_breaker_brand',
    'main_breaker_shroud',
    'uses_canivore',
    'can_bus_count',
    'trench_or_bump',
    'hopper_capacity'
  ];
  const EXTRA_GROUP_DETAIL_FIELDS = {
    setup: ['pit_contact_phone'],
    mechanisms: ['use_net', 'intake_style', 'ground_roller_motor_count', 'motor_controllers', 'motor_types'],
    electrical: ['sb_connector'],
    controls: ['coprocessor', 'uses_wpilib', 'auto_tools', 'vision', 'programming_language', 'software_other'],
    structure: [
      'swerve_module',
      'drivetrain_length',
      'drivetrain_width',
      'drivetrain_height',
      'bumper_width',
      'bumper_height',
      'bumper_length',
      'bumper_foam',
      'fits_under_trench',
      'drives_over_mound',
      'printed_roller_hubs',
      'roller_hub_material',
      'encoder_types'
    ],
    ratings: ['drivebase_rating', 'electrical_rating', 'overall_reliability_rating']
  };

  let activeTopic = 'main';
  let activeExtraGroup = 'setup';
  // Questions an admin added in Scouting Admin > Edit, and this scout's answers to them.
  let customForm = { version: 0, schema: emptyForm() };
  let customAnswers = {};
  let showMissing = false;
  $: layout = createLayout(customForm.schema, 'pit');
  $: orders = layout.orders;
  $: customMain = questionsIn(customForm.schema, 'main');
  $: customExtra = questionsIn(customForm.schema, 'extra');
  const answeredCount = (questions) => questions.filter((question) => isAnswered(question, customAnswers)).length;

  const answered = (value) =>
    Array.isArray(value) ? value.length > 0 : value !== '' && value !== null && value !== undefined;

  // The answers each built-in main question collects, so hiding one also takes it out of the progress count.
  $: allMainAnswers = {
    'main.shooter': { shooter_type },
    'main.hopper': { hopper_type },
    'main.archetype': { robot_archetype },
    'main.bps': { estimated_bps },
    'main.autopoints': { auto_points_estimate },
    'main.breaking': { likely_breaking_component },
    'main.notes': { additional_notes },
    'main.technical': Object.fromEntries(MAIN_DETAIL_FIELDS.map((key) => [key, technical_details[key]]))
  };
  $: mainAnswers = Object.assign(
    {},
    ...Object.entries(allMainAnswers)
      .filter(([key]) => !layout.hidden(key))
      .map(([, fields]) => fields)
  );
  $: mainProgress = {
    done: Object.values(mainAnswers).filter(answered).length + answeredCount(customMain),
    total: Object.keys(mainAnswers).length + customMain.length
  };
  $: photosProgress = { done: editablePhotoPaths.length + pendingFiles.length ? 1 : 0, total: 1 };

  $: visibleGroupIds = new Set(extraGroups.map((group) => group.id));
  $: extraAnswers = {
    ...(visibleGroupIds.has('setup')
      ? {
          scout_name,
          drivebase_type,
          climb_options: climb_options.length ? climb_options : '',
          auto_options: autoOptions.length ? autoOptions : ''
        }
      : {}),
    ...Object.fromEntries(
      Object.entries(EXTRA_GROUP_DETAIL_FIELDS)
        .filter(([id]) => visibleGroupIds.has(id))
        .flatMap(([, keys]) => keys)
        .map((key) => [key, technical_details[key]])
    )
  };
  $: extraProgress = {
    done: Object.values(extraAnswers).filter(answered).length + answeredCount(customExtra),
    total: Object.keys(extraAnswers).length + customExtra.length
  };

  $: topicStates = [
    { id: 'main', label: 'Main', ...mainProgress },
    { id: 'extra', label: 'Extra', ...extraProgress },
    { id: 'photos', label: 'Photos', ...photosProgress }
  ];
  // The Extra pages in the order the form sets, minus hidden ones and with their own wording.
  $: extraGroups = [
    ...sectionItems(customForm.schema, 'pit', 'extra')
      .filter((item) => item.kind === 'core' && !item.view.hidden)
      .map((item) => ({
        ...EXTRA_GROUPS.find((group) => `extra.${group.id}` === item.block.key),
        label: item.view.label
      })),
    ...(customExtra.length ? [{ id: 'added', label: 'Added questions' }] : [])
  ];
  $: if (!extraGroups.some((group) => group.id === activeExtraGroup)) activeExtraGroup = extraGroups[0]?.id ?? 'setup';
  $: extraGroupStates = extraGroups.map((group) =>
    group.id === 'added'
      ? { ...group, done: answeredCount(customExtra), total: customExtra.length }
      : {
          ...group,
          done:
            (EXTRA_GROUP_DETAIL_FIELDS[group.id] || []).filter((key) => answered(technical_details[key])).length +
            (group.id === 'setup'
              ? [
                  scout_name,
                  drivebase_type,
                  climb_options.length ? climb_options : '',
                  autoOptions.length ? autoOptions : ''
                ].filter(answered).length
              : 0),
          total: (EXTRA_GROUP_DETAIL_FIELDS[group.id] || []).length + (group.id === 'setup' ? 4 : 0)
        }
  );
  let photoInputKey = 0;
  let photoInput;
  let prefersCameraCapture = false;

  function setClimbOption(option, checked) {
    if (option === NO_CLIMB_OPTION) {
      climb_options = checked ? [NO_CLIMB_OPTION] : [];
      return;
    }

    const selected = new Set(normalizeClimbOptions(climb_options));
    selected.delete(NO_CLIMB_OPTION);
    if (checked) selected.add(option);
    else selected.delete(option);
    climb_options = CLIMB_OPTIONS.filter((value) => value !== NO_CLIMB_OPTION && selected.has(value));
  }

  function setTechnicalMulti(field, option, checked) {
    const allowed = TECHNICAL_MULTI_OPTIONS[field] || [];
    const selected = new Set(Array.isArray(technical_details[field]) ? technical_details[field] : []);
    if (checked) selected.add(option);
    else selected.delete(option);
    technical_details = {
      ...technical_details,
      [field]: allowed.filter((value) => selected.has(value))
    };
  }

  function hasTechnicalMulti(field, option) {
    return Array.isArray(technical_details[field]) && technical_details[field].includes(option);
  }

  // Drives the slider's thumb from whatever is currently in estimated_bps -
  // clamped into the slider's own range so a value a scout typed above the
  // slider's max (there is no server-side ceiling, only min 0) still shows
  // the thumb pinned at the end rather than off the track.
  function estimatedBpsSliderValue(value) {
    return hasEstimatedBps(value) ? Math.max(0, Math.min(ESTIMATED_BPS_SLIDER_MAX, Number(value))) : 0;
  }

  function setEstimatedBpsFromSlider(rawValue) {
    estimated_bps = Math.round(Number(rawValue) * 100) / 100;
  }

  function displayTeam(teamKey) {
    return teamKey ? String(teamKey).replace(/^frc/i, '') : '';
  }

  function teamSort(a, b) {
    const an = Number(displayTeam(a));
    const bn = Number(displayTeam(b));
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a).localeCompare(String(b));
  }

  function teamListSort(a, b) {
    const aStatus = pitScoutStatus(entriesByTeam[a]);
    const bStatus = pitScoutStatus(entriesByTeam[b]);
    if (aStatus !== bStatus) return PIT_STATUS[aStatus].sort - PIT_STATUS[bStatus].sort;
    return teamSort(a, b);
  }

  function getPitScoutStatusLabel(entry) {
    return PIT_STATUS[pitScoutStatus(entry)].label;
  }

  function getPitScoutStatusClass(entry) {
    return PIT_STATUS[pitScoutStatus(entry)].className;
  }

  function photoUrl(path) {
    if (!path) return '';
    return supabase.storage.from('pit-scout-photos').getPublicUrl(path)?.data?.publicUrl || '';
  }

  // A previously-saved custom write-in (some string that isn't one of the
  // fixed choices) needs to reopen as "Other" with that text still editable,
  // not silently vanish because it doesn't match a known option.
  function splitOtherOption(rawValue, options) {
    const value = String(rawValue || '').trim();
    if (!value) return ['', ''];
    return options.includes(value) ? [value, ''] : ['Other', value];
  }

  function applyTeamEntry(teamKey) {
    const entry = entriesByTeam[teamKey] || null;
    scout_name = entry?.scout_name || '';
    customAnswers = { ...(entry?.custom_answers || {}) };
    showMissing = false;
    [drivebase_type, drivebase_type_other] = splitOtherOption(entry?.drivebase_type, DRIVEBASE_OPTIONS);
    [shooter_type, shooter_type_other] = splitOtherOption(entry?.shooter_type, SHOOTER_OPTIONS);
    [hopper_type, hopper_type_other] = splitOtherOption(entry?.hopper_type, HOPPER_OPTIONS);
    human_player_balls_in_auto = entry?.human_player_balls_in_auto || '';
    robot_archetype = String(entry?.robot_archetype || '').slice(0, 80);
    additional_notes = String(entry?.additional_notes || '');
    likely_breaking_component = entry?.likely_breaking_component || '';
    estimated_bps = hasEstimatedBps(entry?.estimated_bps) ? Number(entry.estimated_bps) : undefined;
    auto_points_estimate = entry?.auto_points_estimate || '';
    climb_options = normalizeClimbOptions(entry?.climb_options || []);
    autoOptions = normalizeAutoOptions(entry?.auto_options || []);
    technical_details = normalizeTechnicalDetails(entry?.technical_details || {});
    editablePhotoPaths = [...(entry?.photo_paths || [])];
    pendingFiles = [];
    photoInputKey += 1;
  }

  function syncSelectedTeam() {
    if (!teams.length) {
      selectedTeam = '';
      return;
    }

    if (selectedTeam && teams.includes(selectedTeam)) {
      applyTeamEntry(selectedTeam);
      return;
    }

    selectedTeam = '';
  }

  async function loadTeams() {
    if (!resolvedEventKey) {
      return [];
    }

    // Event roster and (qual) schedule barely move mid-event - cached, so a
    // scout standing in a pit with one bar of signal still gets the team
    // list instantly instead of a blank picker while this times out.
    const [eventTeamsData, eventMatchesData] = await Promise.all([
      fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(resolvedEventKey)}`, {
        cacheKey: `event-teams:${resolvedEventKey}`
      }).catch(() => null),
      fetchWithCache(`/api/tba/event-matches?event_key=${encodeURIComponent(resolvedEventKey)}&comp_level=qm`, {
        cacheKey: `event-matches:${resolvedEventKey}:qm`
      }).catch(() => null)
    ]);

    const set = new Set();

    for (const row of eventTeamsData?.success ? eventTeamsData.data || [] : []) {
      if (row?.key) set.add(row.key);
    }

    for (const match of eventMatchesData?.success ? eventMatchesData.data || [] : []) {
      for (const teamKey of match?.alliances?.red?.team_keys || []) set.add(teamKey);
      for (const teamKey of match?.alliances?.blue?.team_keys || []) set.add(teamKey);
    }

    if (!set.size && !eventTeamsData?.success && !eventMatchesData?.success) {
      const error = eventTeamsData?.error || eventMatchesData?.error || 'Failed to load event teams.';
      throw new Error(error);
    }

    // Manually-added teams only apply to the globally active event, not a
    // past event an admin is browsing.
    if (resolvedEventKey === eventKey) {
      for (const teamKey of await fetchManualScoutingTeams()) set.add(teamKey);
    }

    return [...set].sort(teamSort);
  }

  async function loadEntries() {
    if (!resolvedEventKey) {
      entriesByTeam = {};
      return {};
    }

    const res = await authFetch(`/pitscout?event_key=${encodeURIComponent(resolvedEventKey)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Failed to load pit entries (${res.status})`);
    }

    pitSchema = {
      ...pitSchema,
      ...(data?.meta?.schema || {})
    };
    schemaWarning = data?.meta?.warning || '';

    const next = {};
    for (const row of data.data || []) {
      if (row?.team_key) next[row.team_key] = row;
    }
    entriesByTeam = next;
    return next;
  }

  async function loadPitContacts() {
    const eventParam = resolvedEventKey ? `&event_key=${encodeURIComponent(resolvedEventKey)}` : '';
    const res = await authFetch(`/pitscout?resource=pit-contacts${eventParam}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) return [];
    pitContacts = data.data || [];
    return pitContacts;
  }

  async function loadProblems() {
    if (!resolvedEventKey) {
      problems = [];
      return [];
    }
    problemLoading = true;
    problemsError = '';
    try {
      const res = await authFetch(
        `/api/matchscout?resource=pit-problems&event_key=${encodeURIComponent(resolvedEventKey)}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Failed to load pit problems (${res.status})`);
      problems = data.data || [];
      return problems;
    } catch (e) {
      problems = [];
      problemsError = e.message || 'Failed to load pit problems';
      return [];
    } finally {
      problemLoading = false;
    }
  }

  // Returns true when the report was saved, so the form can clear itself.
  async function createProblem(draft) {
    if (!eventKey || !draft.team_key || !draft.summary.trim() || isViewingPastEvent) return false;
    problemSaving = true;
    apiNote = '';
    try {
      const res = await authFetch('/api/matchscout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'report-pit-problem',
          event_key: eventKey,
          team_key: draft.team_key,
          source: 'Pit scout',
          summary: draft.summary,
          detail: draft.detail,
          severity: draft.severity
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Problem save failed (${res.status})`);
      await loadProblems();
      apiNote = 'Pit problem added to the shared queue.';
      return true;
    } catch (e) {
      apiNote = e.message || 'Problem save failed';
      return false;
    } finally {
      problemSaving = false;
    }
  }

  async function setProblemResolved(problem, resolved) {
    problemSaving = true;
    apiNote = '';
    try {
      const res = await authFetch('/api/matchscout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-pit-problem', id: problem.id, resolved })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Problem update failed (${res.status})`);
      problems = problems.map((row) => (row.id === problem.id ? data.data : row));
    } catch (e) {
      apiNote = e.message || 'Problem update failed';
    } finally {
      problemSaving = false;
    }
  }

  async function loadEventOptions() {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    availableEvents = await fetchAvailableScoutingEvents();
  }

  async function loadAll() {
    loading = true;
    apiNote = '';

    try {
      if (!resolvedEventKey) {
        teams = [];
        entriesByTeam = {};
        selectedTeam = '';
        schemaWarning = '';
        apiNote = 'No event configured.';
        return;
      }

      const [loadedTeams, loadedEntries] = await Promise.all([
        loadTeams(),
        loadEntries(),
        loadProblems(),
        loadPitContacts()
      ]);
      teams = [...new Set([...loadedTeams, ...Object.keys(loadedEntries)])].sort(teamSort);
      if (requestedTeamKey && teams.includes(requestedTeamKey)) {
        selectedTeam = requestedTeamKey;
        requestedTeamKey = '';
      }
      syncSelectedTeam();
    } catch (e) {
      apiNote = e.message || 'Load error';
    } finally {
      loading = false;
    }
  }

  function scrollToTop() {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function openEntry(teamKey) {
    if (!teamKey) return;
    selectedTeam = teamKey;
    teamSearch = '';
    applyTeamEntry(teamKey);
    scrollToTop();
  }

  function goToTeamPicker() {
    selectedTeam = '';
    teamSearch = '';
    scrollToTop();
  }

  function handleTeamSearchInput(event) {
    const digitsOnly = String(event.currentTarget?.value || '')
      .replace(/\D/g, '')
      .slice(0, 6);
    teamSearch = digitsOnly;

    if (!digitsOnly) return;

    const exactMatch = teams.find((teamKey) => displayTeam(teamKey) === digitsOnly);
    if (exactMatch) openEntry(exactMatch);
  }

  function sanitizeFileName(name) {
    return String(name || 'photo').replace(/[^A-Za-z0-9._-]/g, '_');
  }

  function openPhotoPicker() {
    if (!photoSlotsRemaining) return;
    photoInput?.click();
  }

  function onFilesSelected(event) {
    const files = Array.from(event.currentTarget?.files || []);
    const slotsRemaining = Math.max(0, 3 - editablePhotoPaths.length - pendingFiles.length);

    if (!files.length || !slotsRemaining) {
      photoInputKey += 1;
      return;
    }

    pendingFiles = [...pendingFiles, ...files.slice(0, slotsRemaining)];
    photoInputKey += 1;
  }

  function removeExistingPhoto(path) {
    editablePhotoPaths = editablePhotoPaths.filter((photoPath) => photoPath !== path);
  }

  function removePendingPhoto(idx) {
    pendingFiles = pendingFiles.filter((_, i) => i !== idx);
  }

  function addAutoOption() {
    if (autoOptions.length >= MAX_AUTO_OPTIONS) return;
    autoOptions = [...autoOptions, { name: '', description: '', path: [] }];
  }

  function updateAutoOption(idx, field, value) {
    autoOptions = autoOptions.map((option, i) =>
      i === idx
        ? {
            ...option,
            [field]: String(value || '').slice(0, field === 'name' ? MAX_AUTO_NAME_LENGTH : MAX_AUTO_DESCRIPTION_LENGTH)
          }
        : option
    );
  }

  function removeAutoOption(idx) {
    autoOptions = autoOptions.filter((_, i) => i !== idx);
  }

  // Returns whichever photos made it up, plus whether any did not - never
  // throws. A pit interview's actual notes must never be lost just because
  // one photo (out of up to 3) hit a bad connection, an RLS hiccup, or a
  // format Storage rejected - each file is attempted independently, so one
  // failure doesn't also discard photos that already succeeded before it.
  async function uploadPendingPhotos(teamKey) {
    if (!pendingFiles.length) return { paths: [], failed: false };

    uploading = true;
    const uploadedPaths = [];
    let failed = false;

    try {
      for (let i = 0; i < pendingFiles.length; i += 1) {
        // Shrunk to at most 2048 px before upload; the original goes up unchanged if that is not possible.
        const file = await compressPhoto(pendingFiles[i]);
        const fileName = `${Date.now()}-${i}-${sanitizeFileName(file.name)}`;
        const path = `${eventKey}/${teamKey}/${fileName}`;

        try {
          const { error } = await supabase.storage
            .from('pit-scout-photos')
            .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });

          if (error) throw new Error(error.message || 'Upload failed');
          uploadedPaths.push(path);
        } catch {
          failed = true;
        }
      }

      return { paths: uploadedPaths, failed };
    } finally {
      uploading = false;
    }
  }

  async function saveEntry() {
    if (!selectedTeam || !eventKey) return;

    const normalizedLikelyBreakingComponent = normalizeLikelyBreakingComponent(likely_breaking_component);
    const normalizedEstimatedBps = hasEstimatedBps(estimated_bps)
      ? Math.round(Number(estimated_bps) * 100) / 100
      : null;
    const normalizedClimbOptions = normalizeClimbOptions(climb_options);
    const normalizedTechnicalDetails = normalizeTechnicalDetails(technical_details);

    const normalizedAutoOptions = filledAutoOptions(autoOptions);
    if (normalizedAutoOptions.some((option) => !option.name || !option.description)) {
      alert('Each auto option needs both a name and description.');
      return;
    }

    if (editablePhotoPaths.length + pendingFiles.length > 3) {
      alert('You can only save up to 3 photos.');
      return;
    }

    const missingAdded = firstMissing([...customMain, ...customExtra], customAnswers);
    if (missingAdded) {
      activeTopic = missingAdded.section === 'extra' ? 'extra' : 'main';
      if (activeTopic === 'extra') activeExtraGroup = 'added';
      showMissing = true;
      apiNote = `Answer “${missingAdded.label}” before saving.`;
      return;
    }

    saving = true;
    apiNote = '';

    try {
      // A photo upload failing (bad connection, an RLS hiccup, a format
      // Storage rejects - any reason) must not cost the scout their actual
      // pit interview notes - fall back to whatever photos did upload and
      // keep going with the rest of the save below, rather than throwing
      // the whole entry away. uploadPendingPhotos never throws, so this can
      // no longer be short-circuited by misclassifying a Storage error as
      // non-recoverable the way checking isQueueableFailure here used to.
      const { paths: uploadedPaths, failed: photoUploadFailed } = await uploadPendingPhotos(selectedTeam);
      const photo_paths = [...editablePhotoPaths, ...uploadedPaths].slice(0, 3);
      // A select left on "Other" saves the scout's own typed word instead of
      // the literal string "Other" - falls back to "Other" only if they
      // picked it but never typed anything.
      const resolveOther = (value, otherText) => (value === 'Other' ? otherText.trim() || 'Other' : value);
      const payload = {
        action: 'save-entry',
        event_key: eventKey,
        team_key: selectedTeam,
        ...(pitSchema.scout_name ? { scout_name: String(scout_name || '').trim() } : {}),
        drivebase_type: resolveOther(drivebase_type, drivebase_type_other),
        shooter_type: resolveOther(shooter_type, shooter_type_other),
        hopper_type: resolveOther(hopper_type, hopper_type_other),
        human_player_balls_in_auto,
        ...(pitSchema.robot_archetype ? { robot_archetype } : {}),
        ...(pitSchema.additional_notes ? { additional_notes } : {}),
        ...(pitSchema.likely_breaking_component
          ? { likely_breaking_component: normalizedLikelyBreakingComponent }
          : {}),
        ...(pitSchema.estimated_bps ? { estimated_bps: normalizedEstimatedBps } : {}),
        ...(pitSchema.auto_points_estimate
          ? {
              auto_points_estimate: String(auto_points_estimate || '')
                .trim()
                .slice(0, 40)
            }
          : {}),
        ...(pitSchema.climb_options ? { climb_options: normalizedClimbOptions } : {}),
        ...(pitSchema.auto_options ? { auto_options: normalizedAutoOptions } : {}),
        ...(pitSchema.technical_details ? { technical_details: normalizedTechnicalDetails } : {}),
        ...(pitSchema.custom_answers
          ? {
              custom_answers: sanitizeAnswers(customForm.schema, customAnswers),
              custom_form_version: customForm.version
            }
          : {}),
        photo_paths,
        photo_upload_failed: photoUploadFailed,
        client_submitted_at: new Date().toISOString()
      };

      // A dropped connection here must not cost the scout their pit
      // interview - submitOrQueue tries the real save with a short
      // timeout and falls back to a local queue (synced automatically once
      // back online) for a genuine network failure. /pitscout's save-entry
      // is an upsert keyed on event_key/team_key, so a queued retry that
      // lands after an earlier attempt actually succeeded (response merely
      // lost) overwrites the same row instead of duplicating it.
      const result = await submitOrQueue({
        url: '/pitscout',
        headers: await getAuthHeader(),
        label: `Pit scout / Team ${displayTeam(selectedTeam)}`,
        body: payload
      });

      if (result.queued) {
        entriesByTeam[selectedTeam] = { ...entriesByTeam[selectedTeam], ...payload };
        entriesByTeam = { ...entriesByTeam };
        apiNote = photoUploadFailed
          ? `Saved pit data for Team ${displayTeam(selectedTeam)} on this phone - no connection right now, so it'll sync once you're back online. The photo didn't upload; add it again once things save.`
          : `Saved pit data for Team ${displayTeam(selectedTeam)} on this phone - no connection right now, so it'll sync once you're back online.`;
      } else {
        const data = result.data;
        pitSchema = {
          ...pitSchema,
          ...(data?.meta?.schema || {})
        };
        schemaWarning = data?.meta?.warning || schemaWarning;
        entriesByTeam[selectedTeam] = data.data;
        entriesByTeam = { ...entriesByTeam };
        apiNote = photoUploadFailed
          ? `Saved pit data for Team ${displayTeam(selectedTeam)}, but the photo didn't upload. Try adding it again.`
          : `Saved pit data for Team ${displayTeam(selectedTeam)}.`;
      }
      goToTeamPicker();
    } catch (e) {
      apiNote = e.message || 'Save failed';
    } finally {
      saving = false;
    }
  }

  function detectCameraCapturePreference() {
    if (typeof navigator === 'undefined') return false;
    const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent || ''
    );
    return Boolean(navigator.userAgentData?.mobile || mobileUserAgent);
  }

  $: pitStatusCounts = teams.reduce(
    (counts, teamKey) => {
      const status = pitScoutStatus(entriesByTeam[teamKey]);
      counts[status] += 1;
      return counts;
    },
    { pending: 0, needs_photo: 0, completed: 0 }
  );
  $: pendingCount = pitStatusCounts.pending;
  $: needsPhotoCount = pitStatusCounts.needs_photo;
  $: completeCount = pitStatusCounts.completed;
  $: filteredTeams = teams
    .filter((teamKey) => !teamSearch || displayTeam(teamKey).includes(teamSearch))
    .sort(teamListSort);
  $: selectedEntry = selectedTeam ? entriesByTeam[selectedTeam] || null : null;
  $: photoSlotsRemaining = Math.max(0, 3 - editablePhotoPaths.length - pendingFiles.length);
  $: photoButtonLabel = prefersCameraCapture ? 'Take Photo' : 'Add Photos';
  $: openProblems = problems.filter((problem) => !problem.resolved);
  $: problemsByTeam = openProblems.reduce((map, report) => {
    (map[report.team_key] ||= []).push(report);
    return map;
  }, {});
  $: selectedTeamProblems = selectedTeam ? problemsByTeam[selectedTeam] || [] : [];

  onMount(() => {
    void fetchLiveForm('pit').then((live) => {
      customForm = live;
    });
    const teamParam = String($page.url.searchParams.get('team') || '').trim();
    const digits = displayTeam(teamParam).replace(/\D/g, '');
    if (digits) requestedTeamKey = `frc${parseInt(digits, 10)}`;
    prefersCameraCapture = detectCameraCapturePreference();
    loadEventOptions();
  });

  // Re-fetch teams/entries whenever the resolved (browsed) event changes -
  // covers both the initial async load of the active event key and the user
  // switching the event dropdown afterward.
  $: {
    if (resolvedEventKey !== lastLoadedEventKeyForTeams) {
      lastLoadedEventKeyForTeams = resolvedEventKey;
      loadAll();
    }
  }
</script>

{#if $isPhone}
  <!-- Phone (#124): event and three status counts; the event picker folds away. -->
  <header class="pp-head">
    <div class="pp-stats">
      <span><b>{pendingCount}</b>to do</span>
      <span><b>{needsPhotoCount}</b>need photo</span>
      <span class="pp-done"><b>{completeCount}</b>done</span>
    </div>
    {#if apiNote}<div class="note">{apiNote}</div>{/if}
    {#if schemaWarning}<div class="note">{schemaWarning}</div>{/if}
    <details class="pp-more">
      <summary>{resolvedEventKey || 'No event'} · change event</summary>
      <div class="pp-more-body">
        <SeasonFilter
          options={availableEvents}
          bind:value={selectedEventKey}
          allLabel={`Current Event (${eventKey || 'none set'})`}
        />
        <button class="btn btn-secondary" type="button" on:click={loadAll} disabled={loading}>Refresh</button>
        <OfflineSyncBadge />
      </div>
    </details>
  </header>
{:else}
  <div class="page-header card">
    <div>
      <h2 style="margin:0">Pit Scouting</h2>
      {#if resolvedEventKey}
        <div class="form-label" style="margin-top:0.25rem">Event: {resolvedEventKey}</div>
      {/if}
      {#if apiNote}
        <div class="note" style="margin-top:0.5rem">{apiNote}</div>
      {/if}
      {#if schemaWarning}
        <div class="note" style="margin-top:0.5rem">{schemaWarning}</div>
      {/if}
      <div style="margin-top:0.5rem"><OfflineSyncBadge /></div>
    </div>

    <div class="page-summary">
      <SeasonFilter
        options={availableEvents}
        bind:value={selectedEventKey}
        allLabel={`Current Event (${eventKey || 'none set'})`}
      />
      <div class="summary-pill">
        <span>Pending</span>
        <strong>{pendingCount}</strong>
      </div>
      <div class="summary-pill">
        <span>Needs photo</span>
        <strong>{needsPhotoCount}</strong>
      </div>
      <div class="summary-pill">
        <span>Completed</span>
        <strong>{completeCount}</strong>
      </div>
      <button class="btn btn-secondary" type="button" on:click={loadAll} disabled={loading}> Refresh </button>
    </div>
  </div>
{/if}

<div class="view-tabs" aria-label="Pit Scouting sections">
  <button class:active={activeView === 'teams'} type="button" on:click={() => (activeView = 'teams')}
    >Team profiles</button
  >
  <button class:active={activeView === 'problems'} type="button" on:click={() => (activeView = 'problems')}>
    Problems {#if openProblems.length}<span>{openProblems.length}</span>{/if}
  </button>
</div>

{#if activeView === 'problems'}
  <PitProblemsView
    {problems}
    {teams}
    loading={problemLoading}
    saving={problemSaving}
    eventLabel={resolvedEventKey || 'the active event'}
    readOnly={isViewingPastEvent}
    onRefresh={loadProblems}
    onCreate={createProblem}
    onResolve={setProblemResolved}
  />
{:else if !selectedTeam}
  <div class="card picker-card">
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label" for="teamSearch">Team</label>
      <input
        id="teamSearch"
        class="form-input team-search"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        enterkeyhint="go"
        placeholder="Type team number"
        value={teamSearch}
        on:input={handleTeamSearchInput}
      />
    </div>

    {#if loading}
      <div class="empty">Loading teams...</div>
    {:else if !teams.length}
      <div class="empty">No teams loaded for this event.</div>
    {:else if !filteredTeams.length}
      <div class="empty">No teams match Team {teamSearch}.</div>
    {:else}
      <div class="team-list" class:pp-tiles={$isPhone}>
        {#each filteredTeams as teamKey}
          <button class="team-row" type="button" on:click={() => openEntry(teamKey)}>
            <span class="team-row-main">Team {displayTeam(teamKey)}</span>
            {#if (problemsByTeam[teamKey] || []).length}
              <span
                class="problem-flag"
                class:urgent={problemsByTeam[teamKey].some((report) => report.severity === 'urgent')}
              >
                {problemsByTeam[teamKey].length} to inspect
              </span>
            {/if}
            <span class={`team-status ${getPitScoutStatusClass(entriesByTeam[teamKey])}`}>
              {getPitScoutStatusLabel(entriesByTeam[teamKey])}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <form class="card entry-card" on:submit|preventDefault={saveEntry}>
    <nav class="topic-rail" aria-label="Pit scouting topics">
      {#each topicStates as topic}
        <button
          type="button"
          class="topic-tab"
          class:active={activeTopic === topic.id}
          class:done={topic.done === topic.total}
          on:click={() => (activeTopic = topic.id)}
        >
          <span class="topic-name">{topic.label}</span>
          <span class="topic-count">{topic.done}/{topic.total}</span>
        </button>
        {#if topic.id === 'extra' && activeTopic === 'extra'}
          <div class="extra-group-list" role="group" aria-label="More questions">
            {#each extraGroupStates as group}
              <button
                type="button"
                class="extra-group-item"
                class:active={activeExtraGroup === group.id}
                on:click={() => (activeExtraGroup = group.id)}
              >
                <span>{group.label}</span>
                <span class="topic-count">{group.done}/{group.total}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
    </nav>

    <div class="entry-content">
      <div class="entry-header">
        <button class="btn btn-secondary" type="button" on:click={goToTeamPicker}>Back</button>

        <div>
          <h3 style="margin:0">Team {displayTeam(selectedTeam)}</h3>
          <div class="entry-subtitle">
            {#if selectedEntry}
              Existing pit entry loaded. Submitting again will update it.
            {:else}
              New pit entry.
            {/if}
          </div>
        </div>
      </div>

      {#if isViewingPastEvent}
        <div class="note">
          Viewing past event {selectedEventKey}. This form shows that event's pit data, but submitting will save under
          the active event ({eventKey || 'none set'}) instead — switch back to "Current Event" to edit this team's live
          pit entry.
        </div>
      {/if}

      {#if problemsError}
        <div class="note">{problemsError}</div>
      {/if}

      {#if selectedTeamProblems.length}
        <section class="team-problem-queue" aria-label="Open problems flagged by match scouts">
          <h4>Flagged by match scouts</h4>
          {#each selectedTeamProblems as report}
            <article class="problem-item" class:urgent={report.severity === 'urgent'}>
              <div class="problem-body">
                <p class="problem-summary">{report.summary}</p>
                {#if report.detail}<p class="problem-detail">{report.detail}</p>{/if}
                <p class="team-problem-meta">
                  {report.source}{report.match_key ? ` · ${matchLabel(report.match_key)}` : ''}
                  {report.severity === 'urgent' ? ' · urgent' : ''}
                </p>
              </div>
              <button class="btn btn-outline btn-sm" type="button" on:click={() => setProblemResolved(report, true)}>
                Mark inspected
              </button>
            </article>
          {/each}
        </section>
      {/if}

      {#if activeTopic === 'main'}
        <div class="pit-blocks">
          {#if !layout.hidden('main.shooter')}
            <div class="blk" style="order:{orders.get('core:main.shooter') ?? 0}">
              <div class="form-group">
                <label class="form-label" for="shooterSelect">{layout.label('main.shooter', 'Shooter Type')}</label>
                <Select id="shooterSelect" class="form-select" bind:value={shooter_type}>
                  <option value="">-- Select --</option>
                  {#each SHOOTER_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
                {#if shooter_type === 'Other'}
                  <input class="form-input" maxlength="60" placeholder="What kind?" bind:value={shooter_type_other} />
                {/if}
              </div>
            </div>
          {/if}

          {#if !layout.hidden('main.hopper')}
            <div class="blk" style="order:{orders.get('core:main.hopper') ?? 0}">
              <div class="form-group">
                <label class="form-label" for="hopperSelect">{layout.label('main.hopper', 'Indexer Type')}</label>
                <Select id="hopperSelect" class="form-select" bind:value={hopper_type}>
                  <option value="">-- Select --</option>
                  {#each HOPPER_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
                {#if hopper_type === 'Other'}
                  <input class="form-input" maxlength="60" placeholder="What kind?" bind:value={hopper_type_other} />
                {/if}
              </div>
            </div>
          {/if}

          {#if !layout.hidden('main.archetype')}
            <div class="blk" style="order:{orders.get('core:main.archetype') ?? 0}">
              {#if pitSchema.robot_archetype}
                <div class="form-group">
                  <label class="form-label" for="robotArchetypeInput"
                    >{layout.label('main.archetype', 'Robot Role')}</label
                  >
                  <input
                    id="robotArchetypeInput"
                    class="form-input"
                    maxlength="80"
                    placeholder="e.g. shooter, shuttler, hybrid"
                    bind:value={robot_archetype}
                  />
                </div>
              {/if}
            </div>
          {/if}

          {#if !layout.hidden('main.bps')}
            <div class="blk" style="order:{orders.get('core:main.bps') ?? 0}">
              {#if pitSchema.estimated_bps}
                <div class="form-group">
                  <label class="form-label" for="estimatedBpsInput">{layout.label('main.bps', 'Estimated BPS')}</label>
                  <input
                    id="estimatedBpsInput"
                    class="form-input"
                    type="number"
                    min="0"
                    step="0.1"
                    bind:value={estimated_bps}
                    placeholder="e.g. 2.4"
                  />
                  <div class="estimated-bps-slider">
                    <input
                      type="range"
                      min="0"
                      max={ESTIMATED_BPS_SLIDER_MAX}
                      step="0.1"
                      value={estimatedBpsSliderValue(estimated_bps)}
                      aria-label="Estimated BPS"
                      on:input={(event) => setEstimatedBpsFromSlider(event.currentTarget.value)}
                    />
                    <output>{hasEstimatedBps(estimated_bps) ? Number(estimated_bps).toFixed(1) : '0.0'}</output>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if !layout.hidden('main.technical')}
            <div class="blk" style="order:{orders.get('core:main.technical') ?? 0}">
              {#if pitSchema.technical_details}
                <div class="form-group">
                  <label class="form-label" for="mainBreakerBrandSelect">Main Breaker Brand</label>
                  <Select
                    id="mainBreakerBrandSelect"
                    class="form-select"
                    bind:value={technical_details.main_breaker_brand}
                  >
                    <option value="">-- Select --</option>
                    {#each MAIN_BREAKER_OPTIONS as option}
                      <option value={option}>{option}</option>
                    {/each}
                  </Select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="mainBreakerShroudSelect"
                    >Is Main Breaker Protected from Bumping with other Robots?</label
                  >
                  <Select
                    id="mainBreakerShroudSelect"
                    class="form-select"
                    bind:value={technical_details.main_breaker_shroud}
                  >
                    <option value="">-- Select --</option>
                    {#each YES_NO_OPTIONS as option}
                      <option value={option}>{option}</option>
                    {/each}
                  </Select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="usesCanivoreSelect">Uses Canivore?</label>
                  <Select id="usesCanivoreSelect" class="form-select" bind:value={technical_details.uses_canivore}>
                    <option value="">-- Select --</option>
                    {#each YES_NO_OPTIONS as option}
                      <option value={option}>{option}</option>
                    {/each}
                  </Select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="canBusCountInput">How Many Can Busses</label>
                  <input
                    id="canBusCountInput"
                    class="form-input"
                    type="number"
                    min="0"
                    step="1"
                    bind:value={technical_details.can_bus_count}
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="trenchOrBumpSelect">Trench or Bump?</label>
                  <Select id="trenchOrBumpSelect" class="form-select" bind:value={technical_details.trench_or_bump}>
                    <option value="">-- Select --</option>
                    {#each TRENCH_OR_BUMP_OPTIONS as option}
                      <option value={option}>{option}</option>
                    {/each}
                  </Select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="hopperCapacityInput">Hopper Capacity</label>
                  <input
                    id="hopperCapacityInput"
                    class="form-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 5"
                    bind:value={technical_details.hopper_capacity}
                  />
                </div>
              {/if}
            </div>
          {/if}

          {#if !layout.hidden('main.breaking')}
            <div class="blk" style="order:{orders.get('core:main.breaking') ?? 0}">
              {#if pitSchema.likely_breaking_component}
                <div class="form-group">
                  <label class="form-label" for="likelyBreakingComponentInput"
                    >{layout.label('main.breaking', "What's most likely to break?")}</label
                  >
                  <textarea
                    id="likelyBreakingComponentInput"
                    class="form-input break-risk-input"
                    rows="3"
                    maxlength={MAX_BREAKING_COMPONENT_LENGTH}
                    bind:value={likely_breaking_component}
                    placeholder="Describe the most likely failure point"
                  ></textarea>
                </div>
              {/if}
            </div>
          {/if}

          {#if !layout.hidden('main.autopoints')}
            <div class="blk" style="order:{orders.get('core:main.autopoints') ?? 0}">
              {#if pitSchema.auto_points_estimate}
                <div class="form-group">
                  <label class="form-label" for="autoPointsEstimateInput"
                    >{layout.label('main.autopoints', 'How many points do you usually score in auto?')}</label
                  >
                  <input
                    id="autoPointsEstimateInput"
                    class="form-input"
                    maxlength="40"
                    placeholder="e.g. 10 or 5-15"
                    bind:value={auto_points_estimate}
                  />
                </div>
              {/if}
            </div>
          {/if}

          {#if !layout.hidden('main.notes')}
            <div class="blk" style="order:{orders.get('core:main.notes') ?? 0}">
              {#if pitSchema.additional_notes}
                <div class="form-group">
                  <label class="form-label" for="additionalNotesInput"
                    >{layout.label('main.notes', 'Anything else?')}</label
                  >
                  <textarea
                    id="additionalNotesInput"
                    class="form-input additional-notes-input"
                    rows="5"
                    maxlength="4000"
                    bind:value={additional_notes}
                    placeholder="Strategy observations, pit conversations, repair history, or follow-up questions"
                  ></textarea>
                  <small class="form-help"
                    >Saved for human review. Structured pit capabilities and unresolved problems affect Power Rankings.</small
                  >
                </div>
              {/if}
            </div>
          {/if}

          <CustomQuestions questions={customMain} bind:answers={customAnswers} {orders} {showMissing} />
        </div>
      {/if}

      {#if activeTopic === 'extra' && activeExtraGroup === 'added'}
        <CustomQuestions questions={customExtra} bind:answers={customAnswers} {showMissing} />
      {/if}

      {#if activeTopic === 'photos'}
        <section class="question-section photo-section">
          <div class="photo-header">
            <div>
              <h4>Pit Photos</h4>
              <small class="form-help">{editablePhotoPaths.length + pendingFiles.length}/3 selected</small>
            </div>
            <button
              class="btn btn-primary"
              type="button"
              on:click={openPhotoPicker}
              disabled={!photoSlotsRemaining || saving || uploading}
            >
              {photoButtonLabel}
            </button>
          </div>

          {#key photoInputKey}
            <input
              bind:this={photoInput}
              id="photoUpload"
              type="file"
              class="visually-hidden"
              accept="image/*"
              multiple={!prefersCameraCapture}
              capture={prefersCameraCapture ? 'environment' : undefined}
              disabled={!photoSlotsRemaining}
              on:change={onFilesSelected}
            />
          {/key}

          {#if prefersCameraCapture && photoSlotsRemaining > 0}
            <small class="form-help">Tap the button again to add the next photo.</small>
          {/if}

          {#if editablePhotoPaths.length || pendingFiles.length}
            <div class="photo-grid">
              {#each editablePhotoPaths as path}
                <div class="photo-item">
                  <img src={photoUrl(path)} alt="Pit robot" />
                  <button
                    class="photo-remove"
                    type="button"
                    aria-label="Remove photo"
                    title="Remove photo"
                    on:click={() => removeExistingPhoto(path)}>&times;</button
                  >
                </div>
              {/each}

              {#each pendingFiles as file, idx}
                <div class="photo-item pending-file-card">
                  <div class="pending-file-name">
                    <span class="pending-file-badge">Ready to upload</span>
                    {file.name || `Photo ${idx + 1}`}
                  </div>
                  <button
                    class="photo-remove"
                    type="button"
                    aria-label="Remove photo"
                    title="Remove photo"
                    on:click={() => removePendingPhoto(idx)}>&times;</button
                  >
                </div>
              {/each}
            </div>
          {:else}
            <div class="photo-empty">No photos yet. Add up to 3 so scouts can recognize the robot at a glance.</div>
          {/if}
        </section>
      {/if}

      {#if activeTopic === 'extra' && activeExtraGroup === 'setup'}
        {#if pitSchema.scout_name}
          <div class="form-group">
            <label class="form-label" for="scoutNameInput">Pit contact name</label>
            <input
              id="scoutNameInput"
              class="form-input"
              type="text"
              maxlength="120"
              list="pitContacts"
              use:suggest
              autocomplete="off"
              placeholder="Start typing the person you spoke with"
              bind:value={scout_name}
            />
            <datalist id="pitContacts">
              {#each pitContacts as contact}<option value={contact}></option>{/each}
            </datalist>
            <small class="form-help"
              >Suggestions appear as you type from previous pit contacts. You can always enter someone new for follow-up
              questions.</small
            >
          </div>
          <div class="form-group">
            <label class="form-label" for="pitContactPhone">Pit contact phone</label>
            <input
              id="pitContactPhone"
              class="form-input"
              type="tel"
              inputmode="tel"
              maxlength="32"
              autocomplete="tel"
              placeholder="Optional: (555) 555-5555"
              bind:value={technical_details.pit_contact_phone}
            />
            <small class="form-help">Saved with this team’s private pit profile for follow-up questions.</small>
          </div>
        {/if}

        <div class="form-group">
          <label class="form-label" for="drivebaseSelect">Drivebase Type</label>
          <Select id="drivebaseSelect" class="form-select" bind:value={drivebase_type}>
            <option value="">-- Select --</option>
            {#each DRIVEBASE_OPTIONS as option}
              <option value={option}>{option}</option>
            {/each}
          </Select>
          {#if drivebase_type === 'Other'}
            <input class="form-input" maxlength="60" placeholder="What kind?" bind:value={drivebase_type_other} />
          {/if}
        </div>

        {#if pitSchema.climb_options}
          <div class="form-group">
            <div class="form-label">Climb Options</div>
            <div class="climb-options-grid">
              {#each CLIMB_OPTIONS as option}
                <label class="form-checkbox climb-option">
                  <input
                    type="checkbox"
                    checked={climb_options.includes(option)}
                    disabled={option !== NO_CLIMB_OPTION && climb_options.includes(NO_CLIMB_OPTION)}
                    on:change={(event) => setClimbOption(option, event.currentTarget.checked)}
                  />
                  <span>{option}</span>
                </label>
              {/each}
            </div>
            <small class="form-help">{climb_options.length}/{CLIMB_OPTIONS.length} selected</small>
          </div>
        {/if}

        {#if pitSchema.auto_options}
          <div class="form-group">
            <div class="auto-options-header">
              <div class="form-label">Auto Options</div>
              <button
                class="btn btn-outline"
                type="button"
                on:click={addAutoOption}
                disabled={autoOptions.length >= MAX_AUTO_OPTIONS}
              >
                Add Auto
              </button>
            </div>
            <small class="form-help">{autoOptions.length}/{MAX_AUTO_OPTIONS} autos listed</small>

            {#if !autoOptions.length}
              <div class="auto-options-empty">No named auto options added.</div>
            {:else}
              <div class="auto-option-editor-list">
                {#each autoOptions as option, idx}
                  <div class="card auto-option-editor">
                    <div class="auto-option-editor-header">
                      <strong>Auto {idx + 1}</strong>
                      <button class="btn btn-outline" type="button" on:click={() => removeAutoOption(idx)}>
                        Remove
                      </button>
                    </div>

                    <input
                      class="form-input"
                      type="text"
                      maxlength={MAX_AUTO_NAME_LENGTH}
                      placeholder="Auto name"
                      value={option.name}
                      on:input={(event) => updateAutoOption(idx, 'name', event.currentTarget.value)}
                    />

                    <textarea
                      class="form-input auto-option-description"
                      rows="3"
                      maxlength={MAX_AUTO_DESCRIPTION_LENGTH}
                      placeholder="Short description of the path, starting spot, and scoring plan"
                      value={option.description}
                      on:input={(event) => updateAutoOption(idx, 'description', event.currentTarget.value)}
                    ></textarea>
                    <div class="pit-auto-route-heading">
                      <span>Mirrored auto path</span>
                      <div>
                        <button
                          class="btn btn-outline btn-sm"
                          type="button"
                          on:click={() => updateAutoOption(idx, 'name', 'Trench auto')}>Trench</button
                        ><button
                          class="btn btn-outline btn-sm"
                          type="button"
                          on:click={() => updateAutoOption(idx, 'name', 'Bump auto')}>Bump</button
                        >
                      </div>
                    </div>
                    <RebuiltFieldMap alliance="blue" bind:path={autoOptions[idx].path} />
                    <small class="form-help"
                      >Draw once in this mirrored field view; pit scouting does not need an alliance selection.</small
                    >
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}

      {#if pitSchema.technical_details}
        {#if activeTopic === 'extra' && activeExtraGroup === 'mechanisms'}
          <section class="question-section">
            <h4>Robot and Mechanisms</h4>

            <div class="field-grid">
              <div class="form-group">
                <label class="form-checkbox" for="useNetInput"
                  ><input
                    id="useNetInput"
                    type="checkbox"
                    checked={technical_details.use_net === 'Yes'}
                    on:change={(event) =>
                      (technical_details = {
                        ...technical_details,
                        use_net: event.currentTarget.checked ? 'Yes' : 'No'
                      })}
                  /><span>Do they use a net?</span></label
                >
              </div>

              <div class="form-group">
                <label class="form-label" for="intakeStyleInput">Ground intake style</label>
                <input
                  id="intakeStyleInput"
                  class="form-input"
                  maxlength="80"
                  placeholder="Describe the intake"
                  bind:value={technical_details.intake_style}
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="groundRollerMotorCountInput">Motors powering ground roller</label>
                <input
                  id="groundRollerMotorCountInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="1"
                  bind:value={technical_details.ground_roller_motor_count}
                />
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Motor controllers used</div>
              <div class="option-grid compact">
                {#each MOTOR_CONTROLLER_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('motor_controllers', option)}
                      on:change={(event) => setTechnicalMulti('motor_controllers', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Motor types used</div>
              <div class="option-grid compact">
                {#each MOTOR_TYPE_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('motor_types', option)}
                      on:change={(event) => setTechnicalMulti('motor_types', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>
          </section>
        {/if}

        {#if activeTopic === 'extra' && activeExtraGroup === 'electrical'}
          <section class="question-section">
            <h4>Electrical</h4>
            <p class="extra-note">Main breaker brand and bump protection moved to the Main form.</p>

            <div class="field-grid">
              <div class="form-group">
                <label class="form-label" for="sbConnectorSelect">SB connector</label>
                <Select id="sbConnectorSelect" class="form-select" bind:value={technical_details.sb_connector}>
                  <option value="">-- Select --</option>
                  {#each SB_CONNECTOR_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>
            </div>
          </section>
        {/if}

        {#if activeTopic === 'extra' && activeExtraGroup === 'controls'}
          <section class="question-section">
            <h4>Controls and Software</h4>
            <p class="extra-note">Uses Canivore and CAN bus count moved to the Main form.</p>

            <div class="field-grid">
              <div class="form-group">
                <label class="form-label" for="coprocessorSelect">Coprocessor</label>
                <Select id="coprocessorSelect" class="form-select" bind:value={technical_details.coprocessor}>
                  <option value="">-- Select --</option>
                  {#each COPROCESSOR_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>

              <div class="form-group">
                <label class="form-label" for="usesWpilibSelect">Uses WPILib?</label>
                <Select id="usesWpilibSelect" class="form-select" bind:value={technical_details.uses_wpilib}>
                  <option value="">-- Select --</option>
                  {#each YES_NO_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Auto tools used</div>
              <div class="option-grid compact">
                {#each AUTO_TOOL_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('auto_tools', option)}
                      on:change={(event) => setTechnicalMulti('auto_tools', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Vision used</div>
              <div class="option-grid compact">
                {#each VISION_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('vision', option)}
                      on:change={(event) => setTechnicalMulti('vision', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Programming language</div>
              <div class="option-grid compact">
                {#each PROGRAMMING_LANGUAGE_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('programming_language', option)}
                      on:change={(event) =>
                        setTechnicalMulti('programming_language', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="softwareOtherInput">Other software or controls</label>
              <input
                id="softwareOtherInput"
                class="form-input"
                maxlength="240"
                placeholder="Anything not listed above"
                bind:value={technical_details.software_other}
              />
            </div>
          </section>
        {/if}

        {#if activeTopic === 'extra' && activeExtraGroup === 'structure'}
          <section class="question-section">
            <h4>Drivebase and Structure</h4>

            <div class="field-grid">
              <div class="form-group">
                <label class="form-label" for="swerveModuleSelect">Swerve module</label>
                <Select id="swerveModuleSelect" class="form-select" bind:value={technical_details.swerve_module}>
                  <option value="">-- Select --</option>
                  {#each SWERVE_MODULE_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>

              <div class="form-group">
                <label class="form-label" for="fitsUnderTrenchSelect">Can fit under the trench?</label>
                <Select id="fitsUnderTrenchSelect" class="form-select" bind:value={technical_details.fits_under_trench}>
                  <option value="">-- Select --</option>
                  {#each YES_NO_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>

              <div class="form-group">
                <label class="form-label" for="drivesOverMoundSelect">Can drive over the mound?</label>
                <Select id="drivesOverMoundSelect" class="form-select" bind:value={technical_details.drives_over_mound}>
                  <option value="">-- Select --</option>
                  {#each YES_NO_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>

              <div class="form-group">
                <label class="form-label" for="bumperFoamSelect">Bumper foam</label>
                <Select id="bumperFoamSelect" class="form-select" bind:value={technical_details.bumper_foam}>
                  <option value="">-- Select --</option>
                  {#each BUMPER_FOAM_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>
            </div>

            <div class="dimension-grid">
              <div class="form-group">
                <label class="form-label" for="drivetrainLengthInput">Drivetrain length (in)</label><input
                  id="drivetrainLengthInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.drivetrain_length}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="drivetrainWidthInput">Drivetrain width (in)</label><input
                  id="drivetrainWidthInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.drivetrain_width}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="drivetrainHeightInput">Drivetrain height (in)</label><input
                  id="drivetrainHeightInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.drivetrain_height}
                />
              </div>
            </div>

            <div class="dimension-grid">
              <div class="form-group">
                <label class="form-label" for="bumperLengthInput">Bumper length</label>
                <input
                  id="bumperLengthInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.bumper_length}
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="bumperWidthInput">Bumper width</label>
                <input
                  id="bumperWidthInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.bumper_width}
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="bumperHeightInput">Bumper height</label>
                <input
                  id="bumperHeightInput"
                  class="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={technical_details.bumper_height}
                />
              </div>
            </div>

            <div class="form-group">
              <div class="form-label">Encoder types used</div>
              <div class="option-grid compact">
                {#each ENCODER_TYPE_OPTIONS as option}
                  <label class="form-checkbox option-tile">
                    <input
                      type="checkbox"
                      checked={hasTechnicalMulti('encoder_types', option)}
                      on:change={(event) => setTechnicalMulti('encoder_types', option, event.currentTarget.checked)}
                    />
                    <span>{option}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="field-grid">
              <div class="form-group">
                <label class="form-label" for="printedRollerHubsSelect">3D printed roller hubs?</label>
                <Select
                  id="printedRollerHubsSelect"
                  class="form-select"
                  bind:value={technical_details.printed_roller_hubs}
                >
                  <option value="">-- Select --</option>
                  {#each YES_NO_OPTIONS as option}
                    <option value={option}>{option}</option>
                  {/each}
                </Select>
              </div>

              <div class="form-group">
                <label class="form-label" for="rollerHubMaterialInput">Roller hub print material</label>
                <input
                  id="rollerHubMaterialInput"
                  class="form-input"
                  type="text"
                  maxlength="80"
                  placeholder="e.g. PLA, PETG, Onyx"
                  bind:value={technical_details.roller_hub_material}
                />
              </div>
            </div>
          </section>
        {/if}

        {#if activeTopic === 'extra' && activeExtraGroup === 'ratings'}
          <section class="question-section">
            <h4>Subjective Ratings</h4>
            <div class="rating-grid">
              <div class="form-group">
                <label class="form-label" for="electricalRatingInput">Electrical rating (1-10)</label>
                <div class="rating-slider">
                  <input
                    id="electricalRatingInput"
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    bind:value={technical_details.electrical_rating}
                  />
                  <output>{technical_details.electrical_rating ?? 'Not rated'}</output>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="drivebaseRatingInput">Drivebase rating (1-10)</label>
                <div class="rating-slider">
                  <input
                    id="drivebaseRatingInput"
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    bind:value={technical_details.drivebase_rating}
                  />
                  <output>{technical_details.drivebase_rating ?? 'Not rated'}</output>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="overallReliabilityRatingInput">Overall reliability rating (1-10)</label>
                <div class="rating-slider">
                  <input
                    id="overallReliabilityRatingInput"
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    bind:value={technical_details.overall_reliability_rating}
                  />
                  <output>{technical_details.overall_reliability_rating ?? 'Not rated'}</output>
                </div>
              </div>
            </div>
          </section>
        {/if}
      {/if}

      <div class="submit-row">
        <small class="submit-hint"
          >This saves everything filled in so far across Main, Extra, and Photos at once - submitting from here doesn't
          skip anything on the other tabs.</small
        >
        <button class="btn btn-primary submit-btn" type="submit" disabled={saving || uploading}>
          {#if uploading}
            Uploading...
          {:else if saving}
            Submitting...
          {:else}
            Submit Pit Entry
          {/if}
        </button>
      </div>
    </div>
  </form>
{/if}

<style>
  .pit-blocks {
    display: flex;
    flex-direction: column;
  }
  .pit-blocks > .blk {
    display: block;
    min-width: 0;
  }
  .view-tabs {
    display: flex;
    gap: 0.5rem;
    max-width: 760px;
    margin: 0 0 1rem;
  }

  .view-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: var(--control-height);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-muted);
    cursor: pointer;
  }

  .view-tabs button.active {
    border-color: var(--brand-gold-strong);
    background: var(--surface-2);
    color: var(--text);
    font-weight: 700;
  }

  /* Was a solid-filled red circle - the loudest thing on the page for a
     plain unresolved-count. A quiet outlined pill still reads as "this
     needs attention" without competing with genuinely urgent flags. */
  .view-tabs button span {
    min-width: 1.35rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.72rem;
    text-align: center;
  }

  .additional-notes-input {
    min-height: 120px;
    resize: vertical;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .page-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .summary-pill {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  }

  .summary-pill strong {
    font-size: 1.1rem;
  }

  .entry-card {
    display: grid;
    gap: 1rem;
    max-width: 760px;
    margin: 0 auto;
  }

  /* Wider than .entry-card on purpose - the team list is the one screen in
     this flow that benefits from the page's full width instead of a narrow
     centered column. A ~40-team event in a single 760px-wide column was all
     scroll and almost no use of the rest of the screen; letting it flow into
     several columns turns that into a few rows. */
  .picker-card {
    display: grid;
    gap: 1rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .team-search {
    font-size: 1.05rem;
  }

  .team-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.6rem;
  }

  .team-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-1);
    padding: 0.7rem 0.8rem;
    cursor: pointer;
  }

  .team-row-main {
    font-weight: 600;
  }

  .team-status {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.84rem;
    color: var(--text-secondary);
  }

  /* One marker shape per state, drawn in the neutral text color: an empty ring for
     not started, half filled for needs photo, solid for completed. */
  .team-status::before {
    content: '';
    flex: 0 0 auto;
    width: 0.65rem;
    height: 0.65rem;
    box-sizing: border-box;
    border: 1.5px solid currentColor;
    border-radius: 50%;
  }

  .status-pending {
    color: var(--text-muted);
  }
  .status-needs-photo::before {
    box-shadow: inset -0.3rem 0 0 currentColor;
  }
  .status-complete::before {
    background: currentColor;
  }

  .entry-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .entry-header > div {
    flex: 1;
  }

  .entry-subtitle {
    margin-top: 0.3rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .problem-flag {
    font-size: 0.82rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .problem-flag.urgent {
    font-weight: 600;
    color: var(--text);
  }

  .team-problem-queue {
    display: grid;
    gap: var(--gap-2);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .team-problem-queue h4 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .problem-item {
    display: flex;
    gap: var(--gap-3);
    align-items: flex-start;
    justify-content: space-between;
  }
  .problem-item + .problem-item {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
  }
  .problem-body {
    min-width: 0;
  }
  .problem-summary {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .problem-item.urgent .problem-summary {
    color: var(--text);
    font-weight: 600;
  }
  .problem-detail {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .team-problem-meta {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  /* Topic rail: horizontal on a phone (thumb-reachable, scrolls), a fixed
     column on a laptop. Deliberately not cards - it is a wayfinding control,
     and the count is the whole point of it. */
  .topic-rail {
    display: flex;
    gap: var(--gap-1);
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .topic-rail::-webkit-scrollbar {
    display: none;
  }
  .topic-tab {
    display: flex;
    align-items: baseline;
    gap: var(--gap-2);
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    min-height: 2.75rem;
  }
  .topic-tab:hover {
    color: var(--text);
  }
  .topic-tab.active {
    color: var(--text);
    border-bottom-color: var(--brand-gold-base, #d9a413);
  }
  .topic-name {
    font-weight: 600;
    font-size: 0.92rem;
  }
  .topic-count {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  /* A finished topic is the one thing worth colouring - it is what tells a
     scout they can stop asking about it. */
  .topic-tab.done .topic-count {
    color: var(--text-secondary);
  }

  @media (min-width: 900px) {
    /* Room for a persistent column, so the remaining topics stay visible
       while answering one of them. */
    .entry-card {
      grid-template-columns: 12rem minmax(0, 1fr);
      column-gap: var(--space-5);
      align-items: start;
      /* The rail costs 12rem, so give the answer column back the width it
         had rather than squeezing every select into two thirds of it. */
      max-width: 1040px;
    }
    /* Just two real grid children now - the rail and everything else in one
       .entry-content wrapper - each explicitly placed in its own column and
       the shared row 1. That row sizes to entry-content (by far the taller
       of the two), which is exactly what gives the sticky rail room to
       float down the page as that column scrolls; no per-child column
       overrides or fragile multi-row spanning needed to get there. */
    .topic-rail,
    .entry-content {
      grid-row: 1;
    }
    .entry-content {
      grid-column: 2;
      display: grid;
      gap: 1rem;
    }
    .topic-rail {
      grid-column: 1;
      position: sticky;
      top: var(--space-4);
      flex-direction: column;
      overflow-x: visible;
      border-bottom: 0;
      border-right: 1px solid var(--border);
    }
    .topic-tab {
      justify-content: space-between;
      border-bottom: 0;
      border-right: 2px solid transparent;
      text-align: left;
    }
    .topic-tab.active {
      border-right-color: var(--brand-gold-base, #d9a413);
      background: var(--surface-2);
    }
  }

  .question-section {
    display: grid;
    gap: 0.85rem;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }

  .extra-note {
    margin: -0.4rem 0 0;
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  /* Pressing Extra drops its sub-topics open right there in the rail - a
     list of rows, not a native <select> box - same shape as Main/Extra/
     Photos above it, just indented one level to read as "inside Extra". */
  .extra-group-list {
    display: flex;
    flex-direction: column;
    background: var(--surface-2);
  }

  .extra-group-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--gap-2);
    padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) * 2);
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.82rem;
    text-align: left;
    cursor: pointer;
  }

  .extra-group-item:hover {
    color: var(--text);
  }
  .extra-group-item.active {
    color: var(--text);
    font-weight: 600;
    background: color-mix(in srgb, var(--brand-gold-soft) 60%, transparent);
  }

  .question-section h4 {
    margin: 0;
    font-size: 1rem;
  }

  .field-grid,
  .dimension-grid,
  .rating-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.75rem;
  }

  .rating-slider {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .rating-slider input[type='range'] {
    flex: 1;
    min-width: 0;
  }
  .rating-slider output {
    min-width: 4.5rem;
    text-align: right;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .option-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.55rem;
    margin-top: 0.5rem;
  }

  .option-grid.compact {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  }

  .option-tile {
    min-height: 44px;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  }

  .auto-options-header,
  .auto-option-editor-header,
  .photo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .auto-options-empty {
    margin-top: 0.5rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 0.8rem;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface-1) 90%, transparent);
  }

  .auto-option-editor-list {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.55rem;
  }

  .auto-option-editor {
    display: grid;
    gap: 0.6rem;
    padding: 0.75rem;
  }

  .auto-option-description {
    min-height: 88px;
    resize: vertical;
  }

  .break-risk-input {
    min-height: 88px;
    resize: vertical;
  }

  .estimated-bps-slider {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--gap-3, 0.75rem);
    margin-top: 0.4rem;
  }
  .estimated-bps-slider input[type='range'] {
    width: 100%;
    accent-color: var(--brand-gold, #f1c331);
  }
  .estimated-bps-slider output {
    min-width: 2.6rem;
    text-align: right;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .climb-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .climb-option {
    min-height: 48px;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .photo-section .photo-header h4 {
    margin: 0 0 2px;
  }
  .photo-section .photo-header small {
    color: var(--text-muted);
  }

  .photo-empty {
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  }

  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }

  .photo-item {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .photo-item img {
    display: block;
    width: 100%;
    height: 150px;
    object-fit: cover;
  }

  .photo-remove {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--media-scrim);
    color: var(--on-media);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
  }

  .photo-remove:hover {
    background: var(--media-scrim-strong);
  }

  .pending-file-card {
    height: 150px;
    padding: 0.75rem;
    display: grid;
    align-content: center;
    background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  }

  .pending-file-card .photo-remove {
    background: var(--surface-1);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .pending-file-badge {
    display: inline-block;
    margin-bottom: 0.3rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    color: var(--text);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .pending-file-name {
    word-break: break-word;
    font-size: 0.85rem;
  }

  .submit-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-3);
    margin-top: 0.5rem;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }

  .submit-hint {
    flex: 1;
    color: var(--text-muted);
    font-size: 0.76rem;
  }

  .submit-btn {
    min-width: 190px;
    flex: none;
  }

  @media (max-width: 768px) {
    .page-header,
    .entry-header,
    .auto-options-header,
    .auto-option-editor-header,
    .photo-header {
      flex-direction: column;
      align-items: stretch;
    }

    .page-summary {
      width: 100%;
      justify-content: flex-start;
    }

    .summary-pill {
      flex: 1 1 140px;
      justify-content: space-between;
    }

    .photo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .submit-row {
      flex-direction: column;
      align-items: stretch;
      justify-content: stretch;
    }

    .submit-btn {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .photo-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Phone (#124) */
  .pp-head {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .pp-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .pp-stats span {
    display: grid;
    justify-items: center;
    padding: 8px 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .pp-stats b {
    font-family: var(--font-mono);
    font-size: 1.35rem;
    color: var(--text);
  }
  .pp-stats .pp-done b {
    color: var(--success);
  }
  .pp-more {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
  }
  .pp-more summary {
    min-height: var(--tap-min);
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    color: var(--text-secondary);
    font-size: 0.88rem;
  }
  .pp-more-body {
    display: grid;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }
  .team-list.pp-tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .pp-tiles .team-row {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 4px;
    min-height: 76px;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    text-align: center;
  }
  .pp-tiles .team-row-main {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .pp-tiles .team-row:has(.status-complete) {
    border-color: color-mix(in srgb, var(--success) 50%, var(--border));
  }
  .pp-tiles .team-row:has(.status-needs-photo) {
    border-color: color-mix(in srgb, var(--warning) 50%, var(--border));
  }
  .pp-tiles .team-status {
    font-size: 0.72rem;
  }
  .pp-tiles .problem-flag {
    font-size: 0.7rem;
  }
  @media (max-width: 900px) {
    .view-tabs button {
      min-height: var(--tap-min);
    }
    .topic-rail {
      position: sticky;
      top: calc(3rem + var(--safe-top));
      z-index: 4;
      background: var(--surface-1);
    }
    .submit-row {
      position: sticky;
      bottom: calc(var(--dock-height) + var(--space-2));
      z-index: 4;
      padding: var(--space-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-1) 96%, transparent);
      backdrop-filter: blur(8px);
      box-shadow: var(--shadow-dock-up);
    }
    .submit-row .submit-hint {
      display: none;
    }
    .submit-btn {
      min-height: var(--tap-comfort);
    }
  }
</style>
