<script>
  import { todayInAppTimeZone } from '$lib/app/timezone.js';
  import { compressPhoto } from '$lib/ui/compressPhoto.js';
  import Select from '$lib/components/common/Select.svelte';
  import { onMount } from 'svelte';
  import { scoutDisplayName } from '$lib/scouting/scoutNames.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import { userStore } from '$lib/stores/auth.js';
  import { authFetch } from '$lib/app/supabase.js';
  import { supabase } from '$lib/app/supabase.js';
  import { competitionRoleLabel, hasScoutingAdmin, isCompetitionLead } from '$lib/scouting/competitionRoles.js';
  import { competitionTeamChoices } from '$lib/app/teamSettings.js';
  import { team } from '$lib/stores/team.js';
  import ScoutAssignmentPanel from '$lib/components/scouting/ScoutAssignmentPanel.svelte';
  import PitAssignmentPanel from '$lib/components/scouting/PitAssignmentPanel.svelte';
  import { fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import { displayEventCode, normalizeEventCode } from '$lib/scouting/eventCode.js';
  import { setActiveEvent } from '$lib/stores/activeEvent.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import DatePicker from '$lib/components/common/DatePicker.svelte';
  import FormEditor from '$lib/components/forms/FormEditor.svelte';
  import ScoutDataBrowser from '$lib/components/scouting/ScoutDataBrowser.svelte';
  import TeamRankingDefensePanel from '$lib/components/scouting/TeamRankingDefensePanel.svelte';
  import MatchKeyReview from '$lib/components/scouting/MatchKeyReview.svelte';
  import DataStoragePanel from '$lib/components/scouting/DataStoragePanel.svelte';
  import TeamSettingsPanel from '$lib/components/settings/TeamSettingsPanel.svelte';
  import TbaEventPicker from '$lib/components/scouting/TbaEventPicker.svelte';
  import { page } from '$app/stores';
  import { SCOUTING_ADMIN_PAGES } from '$lib/app/navigation.js';
  import { isPhone } from '$lib/stores/device.js';
  import LineChart from '$lib/components/charts/LineChart.svelte';
  import CountBars from '$lib/components/charts/CountBars.svelte';
  import { reportKindMix, robotsReportedPerMatch } from '$lib/scouting/adminCharts.js';
  import BottomSheet from '$lib/components/common/BottomSheet.svelte';
  import {
    CalendarClock,
    CalendarDays,
    Check,
    ChevronDown,
    Database,
    GraduationCap,
    LayoutDashboard,
    ListTodo,
    Pencil,
    UserCog,
    UserPlus,
    RefreshCw,
    Wrench
  } from 'lucide-svelte';

  // Phones pick an admin section from a sheet instead of a ten-tab strip.
  const ADMIN_ICONS = {
    CalendarClock,
    CalendarDays,
    Database,
    GraduationCap,
    LayoutDashboard,
    ListTodo,
    Pencil,
    UserCog,
    UserPlus,
    Wrench
  };
  let sectionSheetOpen = false;
  const tabIsActive = (tab, currentSection, path) =>
    tab.href === '/scouting-admin' ? currentSection === 'overview' : path.startsWith(tab.href);
  $: currentTab =
    SCOUTING_ADMIN_PAGES.find((tab) => tabIsActive(tab, section, $page.url.pathname)) || SCOUTING_ADMIN_PAGES[0];
  $: if ($page.url.pathname) sectionSheetOpen = false;

  let user;
  let loading = false;
  const autosaveTimers = new Map();
  let errorMsg = '';
  let successMsg = '';
  let warning = '';
  let eventKey = '';
  let upcomingEvents = [];
  let selectedEventKey = '';
  let savingEvent = false;
  let newEventCode = '';
  // Optional TBA event a new code tracks, and the active code's current link.
  let newEventTba = '';
  let newEventTbaLabel = '';
  let activeLink = { tba_event_key: '', tba_name: '' };
  let activeLinkFor = '';
  let savingLink = false;
  let deletingAllScoutingData = false;
  let exportingMatchScoutingCsv = false;
  // Defaults to today (in the team timezone, matching how the export itself interprets
  // the date) so the common case - "export today's match scouting" at the
  // end of a competition day - needs no picking at all.
  let matchScoutingExportDate = todayInAppTimeZone();

  // Separate from selectedEventKey above (which drives the "Competition
  // Code" picker that sets the live active event) - this just lets an admin
  // browse which past events have scouting data. The dashboard metrics below
  // come entirely from /api/scouting-admin, which is always scoped to the
  // active event server-side, so this doesn't re-filter them; it's here for
  // consistency with the other scouting pages' event browser.
  let browseEventKey = null;
  let availableEvents = [];
  // Events whose scouting data is stored but that the TBA upcoming list no longer offers (already
  // over, or never on TBA), so an admin can switch back to one.
  $: pastEventsWithData = availableEvents.filter(
    (ev) => ev.value !== eventKey && !upcomingEvents.some((up) => up.key === ev.value)
  );

  // Google Sheets batch sync - see docs/plans for design context. Not
  // real-time: this is either the daily-ish cron or a manual "Sync Now".
  let googleSheetId = '';
  let googleSheetIdInput = '';
  let googleSheetLastSyncedAt = null;
  let googleSheetLastSyncError = '';
  let savingGoogleSheetId = false;
  let syncingSheet = false;

  // Prescouting: teams typed in by hand before an event has a roster on TBA.
  let manualTeams = [];
  let manualTeamInput = '';
  let savingManualTeam = false;
  let removingManualTeam = null;

  // Which assignment board is showing - a picker instead of five stacked
  // accordions the admin had to scroll past and open one at a time.
  const ASSIGNMENT_TABS = [
    { key: 'data', label: 'Data Scout' },
    { key: 'note', label: 'Note Scout' },
    { key: 'prescout', label: 'Prescout' },
    { key: 'pit', label: 'Pit Scout' }
  ];
  let activeAssignmentTab = 'data';

  let metrics = {
    pit: { percent: 0, scouted_teams: 0, pending_teams: 0, needs_photo_teams: 0, completed_teams: 0, total_teams: 0 },
    data: {
      assigned_percent: 0,
      scouted_percent: 0,
      missed_shift_percent: 0,
      missed_shifts: 0,
      assigned_matches: 0,
      scouted_matches: 0,
      total_matches: 0
    },
    note: {
      assigned_percent: 0,
      scouted_percent: 0,
      missed_shift_percent: 0,
      missed_shifts: 0,
      assigned_matches: 0,
      scouted_matches: 0,
      total_matches: 0
    },
    quick: {
      assigned_percent: 0,
      scouted_percent: 0,
      missed_shift_percent: 0,
      missed_shifts: 0,
      assigned_matches: 0,
      scouted_matches: 0,
      total_matches: 0
    },
    match: { reports: 0, matches: 0, teams: 0 },
    overall: { assigned_percent: 0, scouted_percent: 0, missed_shift_percent: 0 }
  };

  let users = [];
  let matchReports = [];
  let userSearch = '';
  let roleFilter = 'all';
  let editingId = null;
  const roleLabel = competitionRoleLabel;
  const initialOf = (row) =>
    String(scoutDisplayName(row) || row.email || '?')
      .trim()
      .slice(0, 1)
      .toUpperCase();

  let competitionRoleGroups = [];
  let frcTeamOptions = competitionTeamChoices($team);
  $: competitionRoleOptions = competitionRoleGroups.flatMap((group) => group.roles);
  const rolesOf = (u) => drafts[u.id]?.competition_roles ?? u.competition_roles ?? [];

  let drafts = {};
  const startingPositions = ['left trench', 'left mound', 'center', 'right mound', 'right trench'];
  let startPhotos = {};
  let photoSaving = false;
  let photoStatus = '';
  let nameDrafts = {};
  let savingNameId = null;
  let lastUserId = null;
  let canAccess = null;

  // Which page of Scouting Admin this is (/scouting-admin, /scouting-admin/event, ...). The
  // state and loading below live in this layout, so moving between the pages keeps the data.
  $: section = $page.url.pathname.replace(/\/$/, '').split('/')[2] || 'overview';

  userStore.subscribe((v) => {
    user = v;
  });

  $: filteredUsers = users.filter((u) => {
    const q = String(userSearch || '')
      .trim()
      .toLowerCase();
    if (!q) return true;
    return (
      String(u.full_name || '')
        .toLowerCase()
        .includes(q) ||
      String(u.email || '')
        .toLowerCase()
        .includes(q)
    );
  });

  $: visibleUsers = filteredUsers.filter((u) => {
    if (roleFilter === 'all') return true;
    if (roleFilter === 'none') return !rolesOf(u).length;
    return rolesOf(u).includes(roleFilter);
  });
  $: roleCounts = users.reduce((acc, u) => {
    const roles = rolesOf(u);
    for (const role of roles.length ? roles : ['none']) acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  // One file with every scouting record for the event (Excel with colors, or plain CSV); `day` (YYYY-MM-DD) narrows
  // it to records from that day.
  async function exportEventData(day = '', format = 'xlsx') {
    const exportEventKey = browseEventKey || eventKey;
    if (!exportEventKey || exportingMatchScoutingCsv) return;
    exportingMatchScoutingCsv = true;
    errorMsg = '';
    successMsg = '';
    try {
      const response = await authFetch(
        `/api/scouting-admin?resource=export-event-csv&format=${format}&event_key=${encodeURIComponent(exportEventKey)}${day ? `&date=${encodeURIComponent(day)}` : ''}`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `scouting-${exportEventKey.replace(/[^a-z0-9_-]/gi, '_')}${day ? `-${day}` : ''}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      successMsg = day ? `Exported every scouting record from ${day}.` : `Exported all scouting for ${exportEventKey}.`;
    } catch (error) {
      errorMsg = error?.message || 'Could not export scouting data.';
    } finally {
      exportingMatchScoutingCsv = false;
    }
  }

  async function loadStartPhotos() {
    const response = await authFetch('/api/matchscout?resource=start-photos');
    const payload = await response.json();
    if (!response.ok || !payload.success)
      throw new Error(payload.error || 'Could not load start photos. Apply the v2 migration before deployment.');
    startPhotos = payload.data || {};
  }

  async function uploadStartPhoto(event, photoAlliance, position) {
    const picked = event.currentTarget.files?.[0];
    if (!picked) return;
    photoSaving = true;
    photoStatus = '';
    try {
      // Shrunk to at most 2048 px before upload (every match scout downloads these); the original goes up
      // unchanged if that is not possible.
      const file = await compressPhoto(picked);
      const response = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-start-photo-upload', content_type: file.type, size: file.size })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Could not prepare upload.');
      const { error } = await supabase.storage
        .from('pit-scout-photos')
        .uploadToSignedUrl(payload.data.path, payload.data.token, file, { contentType: file.type });
      if (error) throw error;
      const saved = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-start-photo', alliance: photoAlliance, position, path: payload.data.path })
      });
      const result = await saved.json();
      if (!saved.ok || !result.success) throw new Error(result.error || 'Could not save photo.');
      await loadStartPhotos();
      photoStatus = `Saved ${photoAlliance} ${position}.`;
    } catch (error) {
      photoStatus = error.message;
    } finally {
      photoSaving = false;
    }
  }

  async function renameScout(row) {
    await saveScoutName(row);
    if (!errorMsg) editingId = null;
  }

  // Accounts: approving new sign-ups, setting a password, making admins. The server checks who may (admins and the
  // Competition Lead; only admins make admins).
  $: me = $userStore;
  $: canManageAccounts = me?.role === 'admin' || isCompetitionLead(me);
  $: pendingUsers = users.filter((u) => !u.approved);
  let accountBusyId = null;
  let passwordForId = null;
  let passwordDraft = '';

  async function accountAction(row, body, done) {
    accountBusyId = row.id;
    errorMsg = '';
    successMsg = '';
    try {
      const response = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, target_user_id: row.id })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'That did not work.');
      await loadDashboard({ silent: true });
      successMsg = done;
    } catch (error) {
      errorMsg = error.message;
    } finally {
      accountBusyId = null;
    }
  }

  const nameOf = (row) => scoutDisplayName(row) || row.email || 'this person';
  const approveUser = (row, approved = true) =>
    accountAction(
      row,
      { action: 'approve-user', approved },
      approved ? `${nameOf(row)} can now use the app.` : `${nameOf(row)} no longer sees the scouting data.`
    );

  async function rejectUser(row) {
    const ok = await requestConfirmation({
      title: 'Ban this account?',
      message: `${nameOf(row)} (${row.email || 'no email'}) is signed out and can never sign in again.`,
      confirmLabel: 'Ban account',
      danger: true
    });
    if (ok) await accountAction(row, { action: 'ban-and-revoke-user' }, `${nameOf(row)} was banned.`);
  }

  async function savePassword(row) {
    await accountAction(
      row,
      { action: 'set-user-password', password: passwordDraft },
      `New password set for ${nameOf(row)}. They were signed out everywhere.`
    );
    if (!errorMsg) {
      passwordForId = null;
      passwordDraft = '';
    }
  }

  async function toggleAdmin(row) {
    const making = row.role !== 'admin';
    const ok = await requestConfirmation({
      title: making ? 'Make this person an admin?' : 'Remove admin?',
      message: making
        ? `${nameOf(row)} will be able to change every setting, approve and ban accounts, and delete data.`
        : `${nameOf(row)} keeps their account and roles but loses admin rights.`,
      confirmLabel: making ? 'Make admin' : 'Remove admin',
      danger: making
    });
    if (ok)
      await accountAction(
        row,
        { action: 'set-admin', admin: making },
        making ? `${nameOf(row)} is now an admin.` : `${nameOf(row)} is no longer an admin.`
      );
  }

  async function saveScoutName(row) {
    savingNameId = row.id;
    errorMsg = '';
    try {
      const response = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-scout-name', target_user_id: row.id, full_name: nameDrafts[row.id] })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Could not save name.');
      await loadDashboard({ silent: true });
      successMsg = 'Scout name updated. Assignment panels show the corrected name after refresh.';
    } catch (error) {
      errorMsg = error.message;
    } finally {
      savingNameId = null;
    }
  }

  function initDrafts(list) {
    const next = {};
    for (const row of list || []) {
      next[row.id] = {
        competition_roles: [...(row.competition_roles || [])],
        adding_role: '',
        frc_team: row.frc_team || ''
      };
    }
    drafts = next;
  }

  async function loadDashboard(options = {}) {
    const { silent = false } = options;
    if (!user?.id) return;

    if (!silent) {
      loading = true;
      errorMsg = '';
      successMsg = '';
      warning = '';
    }

    try {
      const res = await authFetch('/api/scouting-admin');
      const data = await res.json().catch(() => null);
      if (res.status === 403) {
        canAccess = false;
        return;
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load (${res.status})`);
      }

      canAccess = true;
      eventKey = data.data?.event_key || '';
      upcomingEvents = data.data?.upcoming_events || [];
      selectedEventKey = eventKey || upcomingEvents[0]?.key || '';
      warning = data.data?.warning || '';
      metrics = data.data?.metrics || metrics;
      competitionRoleGroups = data.data?.competition_role_groups || [];
      frcTeamOptions = data.data?.competition_teams || competitionTeamChoices($team);
      users = data.data?.users || [];
      nameDrafts = Object.fromEntries(
        users.map((row) => [row.id, row.full_name && !row.full_name.includes('@') ? row.full_name : ''])
      );
      loadStartPhotos().catch((error) => (photoStatus = error.message));
      matchReports = data.data?.match_reports || [];
      googleSheetId = data.data?.google_sheet_id || '';
      googleSheetIdInput = googleSheetId;
      googleSheetLastSyncedAt = data.data?.google_sheet_last_synced_at || null;
      googleSheetLastSyncError = data.data?.google_sheet_last_sync_error || '';
      manualTeams = data.data?.manual_teams || [];
      initDrafts(users);
    } catch (e) {
      errorMsg = e.message || 'Failed to load scouting admin dashboard.';
    } finally {
      if (!silent) {
        loading = false;
      }
    }
  }

  async function saveRole(userRow) {
    const draft = drafts[userRow.id];
    if (!draft) return;
    const saved = users.find((u) => u.id === userRow.id);
    const nextRoles = draft.competition_roles || [];
    const nextFrcTeam = draft.frc_team || null;
    const savedRoles = saved?.competition_roles || [];
    const savedFrcTeam = saved?.frc_team || null;
    if (nextRoles.join('|') === savedRoles.join('|') && nextFrcTeam === savedFrcTeam) return;

    errorMsg = '';
    successMsg = '';

    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update-competition-roles',
          target_user_id: userRow.id,
          competition_roles: nextRoles,
          frc_team: nextFrcTeam
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save (${res.status})`);
      }

      users = users.map((u) => {
        if (u.id !== userRow.id) return u;
        return {
          ...u,
          competition_roles: data.data?.competition_roles ?? nextRoles,
          frc_team: data.data?.frc_team || nextFrcTeam
        };
      });
      drafts = {
        ...drafts,
        [userRow.id]: {
          competition_roles: [...(data.data?.competition_roles || [])],
          adding_role: '',
          frc_team: data.data?.frc_team || ''
        }
      };
      successMsg = `Updated roles for ${userRow.full_name || userRow.email}.`;
    } catch (e) {
      errorMsg = e.message || 'Failed to save role.';
      const saved = users.find((u) => u.id === userRow.id);
      if (saved)
        drafts = {
          ...drafts,
          [userRow.id]: {
            competition_roles: [...(saved.competition_roles || [])],
            adding_role: '',
            frc_team: saved.frc_team || ''
          }
        };
    }
  }

  function addRole(userRow) {
    const draft = drafts[userRow.id];
    const role = draft?.adding_role;
    if (!role) return;
    const roles = draft.competition_roles.includes(role)
      ? draft.competition_roles
      : competitionRoleOptions.filter((r) => r === role || draft.competition_roles.includes(r));
    drafts = { ...drafts, [userRow.id]: { ...draft, competition_roles: roles, adding_role: '' } };
    queueSaveRole(userRow);
  }

  function removeRole(userRow, role) {
    const draft = drafts[userRow.id];
    drafts = {
      ...drafts,
      [userRow.id]: { ...draft, competition_roles: draft.competition_roles.filter((r) => r !== role) }
    };
    queueSaveRole(userRow);
  }

  function queueSaveRole(userRow) {
    const key = userRow.id;
    const existing = autosaveTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      autosaveTimers.delete(key);
      saveRole(userRow);
    }, 220);
    autosaveTimers.set(key, timer);
  }

  // Sets the competition every scouting page works from. Other events' data is kept; it just
  // stops showing until that event is made active again.
  async function saveEventKey(key = selectedEventKey, { create = false } = {}) {
    if (!key) return;
    const code = displayEventCode(key);
    const ok = await requestConfirmation({
      title: create ? 'Create and set competition code' : 'Change the active event',
      message: `Every scouting page will switch to ${code}. Scouting data for other events is kept and comes back if you set that event again.`,
      confirmLabel: `Set ${code}`
    });
    if (!ok) return;
    savingEvent = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: create ? 'create-event-key' : 'update-event-key',
          event_key: key
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save event (${res.status})`);
      }
      eventKey = data.data?.event_key || key;
      selectedEventKey = eventKey;
      setActiveEvent(eventKey);
      let linkNote = '';
      if (create && newEventTba) {
        try {
          await saveTbaLink(eventKey, newEventTba);
          linkNote = ` It tracks ${newEventTbaLabel || newEventTba} on The Blue Alliance.`;
        } catch (linkError) {
          linkNote = ` The code was created, but linking ${newEventTba} failed: ${linkError.message}`;
        }
      }
      if (create) {
        newEventCode = '';
        newEventTba = '';
        newEventTbaLabel = '';
      }
      const name = data.data?.event_name;
      successMsg =
        (create && !name && !linkNote
          ? `Scouting event set to ${displayEventCode(eventKey)}. The Blue Alliance does not list it yet, so its match schedule and team list stay empty until it does, or until you link a TBA event below.`
          : `Scouting event set to ${displayEventCode(eventKey)}${name ? ` (${name})` : ''}.`) + linkNote;
      activeLinkFor = '';
      await loadDashboard({ silent: true });
    } catch (e) {
      errorMsg = e.message || 'Failed to update event key.';
    } finally {
      savingEvent = false;
    }
  }

  // Which TBA event a competition code tracks. Every TBA lookup for the code uses that event from then on.
  async function saveTbaLink(code, tbaEventKey) {
    const res = await authFetch('/api/scouting-event-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_key: code, tba_event_key: tbaEventKey || null })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Failed to link the TBA event (${res.status})`);
    return data.data;
  }

  async function loadActiveLink(code) {
    activeLinkFor = code;
    activeLink = { tba_event_key: '', tba_name: '' };
    if (!code) return;
    try {
      const res = await authFetch(`/api/scouting-event-link?event_key=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => null);
      if (activeLinkFor === code && res.ok && data?.success)
        activeLink = { tba_event_key: data.data.tba_event_key || '', tba_name: data.data.tba_name || '' };
    } catch {
      /* the control just shows no link */
    }
  }
  $: if (section === 'event' && eventKey && activeLinkFor !== eventKey) loadActiveLink(eventKey);

  async function changeActiveLink(event) {
    savingLink = true;
    errorMsg = '';
    successMsg = '';
    try {
      const saved = await saveTbaLink(eventKey, event.detail.value);
      activeLink = { tba_event_key: saved.tba_event_key || '', tba_name: saved.tba_name || event.detail.label || '' };
      successMsg = saved.tba_event_key
        ? `${displayEventCode(eventKey)} now tracks ${activeLink.tba_name || saved.tba_event_key} on The Blue Alliance: its schedule, teams, rankings and OPRs.`
        : `${displayEventCode(eventKey)} no longer tracks another TBA event; it uses its own code on The Blue Alliance.`;
    } catch (e) {
      errorMsg = e.message;
      await loadActiveLink(eventKey);
    } finally {
      savingLink = false;
    }
  }

  async function saveGoogleSheetId() {
    savingGoogleSheetId = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update-google-sheet-id',
          google_sheet_id: googleSheetIdInput.trim()
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save Google Sheet ID (${res.status})`);
      }
      googleSheetId = data.data?.google_sheet_id || '';
      googleSheetIdInput = googleSheetId;
      successMsg = googleSheetId ? 'Google Sheet configured.' : 'Google Sheet sync disabled.';
    } catch (e) {
      errorMsg = e.message || 'Failed to update Google Sheet ID.';
    } finally {
      savingGoogleSheetId = false;
    }
  }

  async function syncSheetNow() {
    syncingSheet = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-scouting-sheet' })
      });
      const data = await res.json().catch(() => null);
      if (!data?.data?.ok) {
        throw new Error(data?.data?.error || `Sync failed (${data?.data?.reason || res.status})`);
      }
      successMsg = `Synced ${data.data.rows} row${data.data.rows === 1 ? '' : 's'} to the Google Sheet.`;
      await loadDashboard({ silent: true });
    } catch (e) {
      errorMsg = e.message || 'Failed to sync Google Sheet.';
    } finally {
      syncingSheet = false;
    }
  }

  function displayTeam(teamKey) {
    return teamKey ? String(teamKey).replace(/^frc/i, '') : '';
  }

  async function addManualTeam() {
    const raw = manualTeamInput.trim();
    if (!raw) return;

    savingManualTeam = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add-manual-team', team_key: raw })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to add team (${res.status})`);
      }
      manualTeams = data.data?.manual_teams || manualTeams;
      manualTeamInput = '';
      successMsg = `Added team ${displayTeam(raw)} for prescouting.`;
    } catch (e) {
      errorMsg = e.message || 'Failed to add team.';
    } finally {
      savingManualTeam = false;
    }
  }

  async function removeManualTeam(teamKey) {
    removingManualTeam = teamKey;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove-manual-team', team_key: teamKey })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to remove team (${res.status})`);
      }
      manualTeams = data.data?.manual_teams || manualTeams.filter((t) => t !== teamKey);
      successMsg = `Removed team ${displayTeam(teamKey)} from prescouting.`;
    } catch (e) {
      errorMsg = e.message || 'Failed to remove team.';
    } finally {
      removingManualTeam = null;
    }
  }

  function buildDeleteSummary(deleted = {}) {
    const segments = [
      `${deleted.data_events || 0} data events`,
      `${deleted.notes || 0} notes`,
      `${deleted.assignments || 0} assignments`,
      `${deleted.pit_entries || 0} pit entries`,
      `${deleted.pit_photos || 0} pit photos`
    ];
    return `Deleted all scouting data (${segments.join(', ')}).`;
  }

  async function deleteAllScoutingData() {
    if (
      !(await requestConfirmation({
        title: 'Delete all scouting data',
        message:
          'This permanently removes scouting notes, assignments, data events, pit entries, and pit scout photos.',
        confirmLabel: 'Delete all data',
        danger: true,
        requireText: 'DELETE'
      }))
    ) {
      return;
    }

    deletingAllScoutingData = true;
    errorMsg = '';
    successMsg = '';

    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete-all-scouting-data'
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to delete scouting data (${res.status})`);
      }

      await loadDashboard({ silent: true });
      const dashboardWarning = warning;
      successMsg = buildDeleteSummary(data.data?.deleted || {});
      warning = [dashboardWarning, data.data?.warning].filter(Boolean).join(' ');
    } catch (e) {
      errorMsg = e.message || 'Failed to delete scouting data.';
    } finally {
      deletingAllScoutingData = false;
    }
  }

  async function removeMatchReport(report) {
    if (!report?.id) return;
    const teamNumber = String(report.team_key || '').replace(/^frc/i, '');
    const matchLabel =
      String(report.match_key || '')
        .split('_')
        .at(-1) || report.match_key;
    if (
      !(await requestConfirmation({
        title: 'Remove match report',
        message: `Permanently remove ${report.scout_name || 'this scout'}'s report for Team ${teamNumber}, match ${matchLabel}? This cannot be undone.`,
        confirmLabel: 'Remove report',
        danger: true
      }))
    ) {
      return;
    }

    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/matchscout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete-entry', id: report.id })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Failed to remove the report (${res.status})`);
      matchReports = matchReports.filter((entry) => entry.id !== report.id);
      successMsg = `Removed ${report.scout_name || 'the'} report for Team ${teamNumber}, match ${matchLabel}.`;
    } catch (e) {
      errorMsg = e.message || 'Failed to remove the report.';
    }
  }

  async function loadAvailableEvents() {
    availableEvents = await fetchAvailableScoutingEvents();
  }

  onMount(() => {
    loadDashboard();
    loadAvailableEvents();
  });

  $: if (user?.id && user.id !== lastUserId) {
    lastUserId = user.id;
    loadDashboard();
  }

  $: if (!user?.id) {
    canAccess = null;
  }
</script>

{#if canAccess === false}
  <div class="scouting-admin-page">
    <div class="card denied-card">
      <h2>Scouting Admin</h2>
      <p class="text-muted">Access denied.</p>
    </div>
  </div>
{:else}
  <div class="scouting-admin-page">
    {#if $isPhone}
      <button type="button" class="adm-picker" aria-haspopup="dialog" on:click={() => (sectionSheetOpen = true)}>
        <svelte:component this={ADMIN_ICONS[currentTab.icon]} size={20} />
        <span><b>{currentTab.label}</b><small>{currentTab.blurb}</small></span>
        <ChevronDown size={18} />
      </button>
      <BottomSheet
        open={sectionSheetOpen}
        title="Scouting Admin"
        subtitle="Pick a section"
        on:close={() => (sectionSheetOpen = false)}
      >
        <nav class="adm-sheet" aria-label="Scouting Admin pages">
          {#each SCOUTING_ADMIN_PAGES as tab (tab.key)}
            <a
              href={tab.href}
              class:active={tab.key === currentTab.key}
              aria-current={tab.key === currentTab.key ? 'page' : undefined}
            >
              <svelte:component this={ADMIN_ICONS[tab.icon]} size={20} />
              <span><b>{tab.label}</b><small>{tab.blurb}</small></span>
            </a>
          {/each}
        </nav>
      </BottomSheet>
    {:else}
      <div class="admin-bar">
        <nav class="admin-tabs" aria-label="Scouting Admin pages">
          {#each SCOUTING_ADMIN_PAGES as tab (tab.key)}
            <a
              class="admin-tab"
              class:active={tab.href === '/scouting-admin'
                ? section === 'overview'
                : $page.url.pathname.startsWith(tab.href)}
              href={tab.href}
              aria-current={(
                tab.href === '/scouting-admin' ? section === 'overview' : $page.url.pathname.startsWith(tab.href)
              )
                ? 'page'
                : undefined}>{tab.label}</a
            >
          {/each}
        </nav>
        <div class="admin-bar-end">
          <button
            class="admin-refresh"
            type="button"
            disabled={loading}
            on:click={loadDashboard}
            aria-label="Refresh"
            title="Refresh"><RefreshCw size={15} class={loading ? 'spin' : ''} /></button
          >
        </div>
      </div>
    {/if}

    {#if warning || errorMsg || successMsg}
      <div class="status-stack">
        {#if warning}
          <div class="status-message status-warning">{warning}</div>
        {/if}
        {#if errorMsg}
          <div class="status-message status-error">{errorMsg}</div>
        {/if}
        {#if successMsg}
          <div class="status-message status-success">{successMsg}</div>
        {/if}
      </div>
    {/if}

    {#if section === 'event'}
      <div class="ev">
        <section class="ev-summary" aria-label="Current event">
          <div>
            <span class="ev-k">Now scouting</span>
            <b class="ev-code">{displayEventCode(eventKey) || 'No event set'}</b>
          </div>
          <div>
            <span class="ev-k">Schedule and teams from</span>
            <b
              >{activeLink.tba_name ||
                activeLink.tba_event_key ||
                (eventKey ? `${displayEventCode(eventKey)} on TBA` : '—')}</b
            >
          </div>
          <div>
            <span class="ev-k">Prescouting teams</span>
            <b>{manualTeams.length}</b>
          </div>
          <div>
            <span class="ev-k">Starting photos</span>
            <b>{Object.values(startPhotos).filter(Boolean).length} of {startingPositions.length * 2}</b>
          </div>
        </section>

        <section class="ev-step">
          <header class="ev-head">
            <span class="ev-num">1</span>
            <div>
              <h3>Choose the event</h3>
              <p>The competition every scouting page works from.</p>
            </div>
          </header>
          <div class="ev-body">
            <label class="ev-field" for="eventSelect">Event</label>
            <div class="sp-row">
              <Select
                id="eventSelect"
                class="sp-input"
                wrap="sel-event"
                bind:value={selectedEventKey}
                aria-label="Competition code"
              >
                {#if eventKey && !upcomingEvents.find((e) => e.key === eventKey)}
                  <option value={eventKey}>{eventKey} (current)</option>
                {/if}
                {#each upcomingEvents as ev}
                  <option value={ev.key}>{ev.key} - {ev.name}{ev.start_date ? ` (${ev.start_date})` : ''}</option>
                {/each}
                {#each pastEventsWithData as ev}
                  <option value={ev.value}>{ev.value}{ev.label && ev.label !== ev.value ? ` - ${ev.label}` : ''}</option
                  >
                {/each}
              </Select>
              <button
                class="btn btn-primary"
                disabled={!selectedEventKey || savingEvent || selectedEventKey === eventKey}
                on:click={() => saveEventKey()}>{savingEvent ? 'Saving...' : 'Set event'}</button
              >
            </div>

            <details class="ev-more">
              <summary>Event not in the list? Create a competition code</summary>
              <div class="ev-more-body">
                <p>
                  For an off-season or practice event: the year followed by the event code, like 2026mttd. It can follow
                  an event on The Blue Alliance, or stand on its own.
                </p>
                <label class="ev-field" for="newEventCode">Competition code</label>
                <input
                  id="newEventCode"
                  class="sp-input sp-code-input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck="false"
                  maxlength="32"
                  placeholder="2026MTTD"
                  bind:value={newEventCode}
                  on:keydown={(e) => {
                    if (e.key === 'Enter' && normalizeEventCode(newEventCode) && !savingEvent)
                      saveEventKey(newEventCode, { create: true });
                  }}
                />
                <label class="ev-field" for="new-tba-event"
                  >Follows TBA event <span class="sp-optional">optional</span></label
                >
                <TbaEventPicker
                  id="new-tba-event"
                  code={normalizeEventCode(newEventCode) || ''}
                  bind:value={newEventTba}
                  bind:label={newEventTbaLabel}
                  disabled={savingEvent}
                />
                <div>
                  <button
                    class="btn btn-primary"
                    disabled={!normalizeEventCode(newEventCode) || savingEvent}
                    on:click={() => saveEventKey(newEventCode, { create: true })}
                    >{savingEvent ? 'Saving...' : 'Create and set'}</button
                  >
                </div>
              </div>
            </details>
          </div>
        </section>

        {#if eventKey}
          <section class="ev-step">
            <header class="ev-head">
              <span class="ev-num">2</span>
              <div>
                <h3>Follow a TBA event <span class="sp-optional">optional</span></h3>
                <p>
                  Take {displayEventCode(eventKey)}'s schedule, teams, rankings and OPRs from another event on The Blue
                  Alliance, for example when a practice code follows the real event. Leave empty to use
                  {displayEventCode(eventKey)} itself.
                </p>
              </div>
            </header>
            <div class="ev-body">
              <label class="ev-field" for="active-tba-event">TBA event</label>
              <TbaEventPicker
                id="active-tba-event"
                code={eventKey}
                value={activeLink.tba_event_key}
                label={activeLink.tba_name}
                disabled={savingLink}
                on:change={changeActiveLink}
              />
            </div>
          </section>
        {/if}

        <section class="ev-step">
          <header class="ev-head">
            <span class="ev-num">{eventKey ? 3 : 2}</span>
            <div>
              <h3>Prescouting teams <span class="sp-count">{manualTeams.length}</span></h3>
              <p>
                Teams added by hand before the event has a roster on The Blue Alliance. They can stay once the real
                roster is out.
              </p>
            </div>
          </header>
          <div class="ev-body">
            <label class="ev-field" for="manual-team">Team number</label>
            <div class="sp-row">
              <input
                id="manual-team"
                class="sp-input"
                type="text"
                inputmode="numeric"
                placeholder="e.g. 5199"
                bind:value={manualTeamInput}
                on:keydown={(e) => {
                  if (e.key === 'Enter') addManualTeam();
                }}
              />
              <button
                class="btn btn-primary"
                disabled={!manualTeamInput.trim() || savingManualTeam}
                on:click={addManualTeam}>{savingManualTeam ? 'Adding...' : 'Add team'}</button
              >
            </div>
            {#if manualTeams.length}
              <ul class="sp-chips">
                {#each manualTeams as teamKey}
                  <li>
                    {teamKey.replace(/^frc/i, '')}<button
                      type="button"
                      disabled={removingManualTeam === teamKey}
                      on:click={() => removeManualTeam(teamKey)}
                      aria-label={`Remove team ${teamKey.replace(/^frc/i, '')}`}>&times;</button
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </section>

        <section class="ev-step">
          <header class="ev-head">
            <span class="ev-num">{eventKey ? 4 : 3}</span>
            <div>
              <h3>Starting position photos <span class="sp-optional">optional</span></h3>
              <p>
                What scouts see when choosing where a robot starts. JPEG, PNG or WebP, up to 5 MiB. Without a photo they
                see a schematic.
              </p>
            </div>
          </header>
          <div class="ev-body">
            {#each ['red', 'blue'] as photoAlliance}
              <div class="sp-alliance">
                <h4 class={photoAlliance}>{photoAlliance} alliance</h4>
                <div class="sp-tiles">
                  {#each startingPositions as position}
                    <label class="sp-tile" class:has-photo={startPhotos[`${photoAlliance}:${position}`]}>
                      {#if startPhotos[`${photoAlliance}:${position}`]}
                        <img
                          src={startPhotos[`${photoAlliance}:${position}`]}
                          alt={`${photoAlliance} ${position} starting position`}
                        />
                      {:else}
                        <span class="sp-empty">No photo</span>
                      {/if}
                      <span class="sp-cap"
                        ><b>{position}</b><small
                          >{startPhotos[`${photoAlliance}:${position}`] ? 'Replace' : 'Upload'}</small
                        ></span
                      >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={photoSaving}
                        on:change={(event) => uploadStartPhoto(event, photoAlliance, position)}
                      />
                    </label>
                  {/each}
                </div>
              </div>
            {/each}
            {#if photoStatus}<p class="sp-meta" role="status">{photoStatus}</p>{/if}
          </div>
        </section>
      </div>
    {:else if section === 'assignments'}
      <div class="assignment-section">
        <div class="assignment-tab-picker" role="tablist" aria-label="Assignment board">
          {#each ASSIGNMENT_TABS as tab (tab.key)}
            <button
              type="button"
              role="tab"
              aria-selected={activeAssignmentTab === tab.key}
              class="assignment-tab-btn"
              class:active={activeAssignmentTab === tab.key}
              on:click={() => (activeAssignmentTab = tab.key)}>{tab.label}</button
            >
          {/each}
        </div>
        {#if activeAssignmentTab === 'data'}<ScoutAssignmentPanel scoutingType="data" open={true} />{/if}
        {#if activeAssignmentTab === 'note'}<ScoutAssignmentPanel scoutingType="note" open={true} />{/if}
        {#if activeAssignmentTab === 'prescout'}<PitAssignmentPanel assignmentKind="prescout" open={true} />{/if}
        {#if activeAssignmentTab === 'pit'}<PitAssignmentPanel open={true} />{/if}
      </div>
    {:else if section === 'edit'}
      <FormEditor />
    {:else if section === 'scouts'}
      <section class="scouts" aria-label="People">
        <div class="scouts-bar">
          <input
            class="scout-search"
            type="search"
            placeholder="Search name or email"
            bind:value={userSearch}
            aria-label="Search people"
          />
          <label class="sf"
            >Role
            <Select bind:value={roleFilter} aria-label="Filter by role">
              <option value="all">All roles ({users.length})</option>
              <option value="none">Not assigned ({roleCounts.none || 0})</option>
              {#each competitionRoleOptions as opt}<option value={opt}>{roleLabel(opt)} ({roleCounts[opt] || 0})</option
                >{/each}
            </Select>
          </label>
        </div>
        {#if canManageAccounts && pendingUsers.length}
          <div class="pending card" aria-label="Accounts waiting for approval">
            <h3>Waiting for approval ({pendingUsers.length})</h3>
            <p class="scouts-note">
              These accounts signed up but can't see anything yet. Approve the people you know; ban the rest.
            </p>
            <ul>
              {#each pendingUsers as row (row.id)}
                <li>
                  <span class="pending-who"><b>{nameOf(row)}</b><small>{row.email || '-'}</small></span>
                  <span class="pending-actions">
                    <button
                      class="btn btn-sm btn-primary"
                      type="button"
                      disabled={accountBusyId !== null}
                      on:click={() => approveUser(row)}>Approve</button
                    >
                    <button
                      class="btn btn-sm btn-outline"
                      type="button"
                      disabled={accountBusyId !== null}
                      on:click={() => rejectUser(row)}>Ban</button
                    >
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        <p class="scouts-note">
          Roles and teams save as you pick them, and a person can hold several roles. Competition Lead, Scouting Lead,
          Strategy Lead, Pit Lead and the Picklist Leads can use Scouting Admin. Data, Performance and Robot Scouts each
          open their own Match Scouting tab. The team applies to this competition only.
        </p>

        {#if !visibleUsers.length}
          <p class="scouts-empty">No scouts match.</p>
        {:else}
          <ul class="scout-list">
            <li class="scout-head" aria-hidden="true">
              <span></span><span>Person</span><span>Competition roles</span><span>Team</span><span class="admin-head"
                >Scouting Admin</span
              >
            </li>
            {#each visibleUsers as row (row.id)}
              <li class="scout-row" class:assigned={drafts[row.id]?.competition_roles?.length}>
                <span class="av" aria-hidden="true">{initialOf(row)}</span>
                <div class="who">
                  {#if editingId === row.id}
                    <form class="rename" on:submit|preventDefault={() => renameScout(row)}>
                      <input
                        id={`scout-name-${row.id}`}
                        maxlength="120"
                        placeholder="Full name"
                        bind:value={nameDrafts[row.id]}
                        aria-label={`Name for ${row.email}`}
                      />
                      <button
                        class="btn btn-sm btn-primary"
                        type="submit"
                        disabled={savingNameId !== null ||
                          !nameDrafts[row.id]?.trim() ||
                          nameDrafts[row.id] === row.full_name}>Save</button
                      >
                      <button class="btn btn-sm" type="button" on:click={() => (editingId = null)}>Cancel</button>
                    </form>
                  {:else}
                    <button
                      type="button"
                      class="name"
                      title="Click to rename"
                      on:click={() => {
                        editingId = row.id;
                        if (!nameDrafts[row.id]) nameDrafts[row.id] = scoutDisplayName(row) || '';
                      }}>{scoutDisplayName(row) || 'Unnamed'}</button
                    >
                  {/if}
                  <small
                    >{row.email || '-'}{#if row.role === 'admin'}
                      · Admin{/if}{#if !row.approved}
                      · Waiting for approval{/if}</small
                  >
                  {#if canManageAccounts}
                    {#if passwordForId === row.id}
                      <form class="rename" on:submit|preventDefault={() => savePassword(row)}>
                        <input
                          type="password"
                          autocomplete="new-password"
                          minlength="8"
                          placeholder="New password (8+ characters)"
                          bind:value={passwordDraft}
                          aria-label={`New password for ${row.email}`}
                        />
                        <button
                          class="btn btn-sm btn-primary"
                          type="submit"
                          disabled={accountBusyId !== null || passwordDraft.length < 8}>Set</button
                        >
                        <button class="btn btn-sm" type="button" on:click={() => (passwordForId = null)}>Cancel</button>
                      </form>
                    {:else}
                      <span class="account-actions">
                        <button
                          type="button"
                          class="link-btn"
                          disabled={accountBusyId !== null}
                          on:click={() => {
                            passwordForId = row.id;
                            passwordDraft = '';
                          }}>Set password</button
                        >
                        {#if me?.role === 'admin' && row.id !== me?.id}
                          <button
                            type="button"
                            class="link-btn"
                            disabled={accountBusyId !== null}
                            on:click={() => toggleAdmin(row)}
                            >{row.role === 'admin' ? 'Remove admin' : 'Make admin'}</button
                          >
                        {/if}
                        {#if row.approved && row.role !== 'admin' && row.id !== me?.id}
                          <button
                            type="button"
                            class="link-btn"
                            disabled={accountBusyId !== null}
                            on:click={() => approveUser(row, false)}>Take away access</button
                          >
                        {/if}
                      </span>
                    {/if}
                  {/if}
                </div>
                <div class="roles">
                  {#each drafts[row.id].competition_roles as role (role)}
                    <span class="role-chip"
                      >{roleLabel(role)}<button
                        type="button"
                        aria-label={`Remove ${roleLabel(role)} from ${row.full_name || row.email}`}
                        on:click={() => removeRole(row, role)}>&times;</button
                      ></span
                    >
                  {/each}
                  <Select
                    compact
                    wrap="sel-role"
                    aria-label={`Add a competition role for ${row.email}`}
                    bind:value={drafts[row.id].adding_role}
                    on:change={() => addRole(row)}
                  >
                    <option value="">{drafts[row.id].competition_roles.length ? 'Add role' : 'Not assigned'}</option>
                    {#each competitionRoleOptions.filter((opt) => !drafts[row.id].competition_roles.includes(opt)) as opt}<option
                        value={opt}>{roleLabel(opt)}</option
                      >{/each}
                  </Select>
                </div>
                <Select
                  compact
                  wide
                  wrap="sel-team"
                  aria-label={`FRC team for ${row.email}`}
                  bind:value={drafts[row.id].frc_team}
                  on:change={() => queueSaveRole(row)}
                >
                  <option value="">Not set</option>
                  {#each frcTeamOptions as opt}<option value={opt}>{opt}</option>{/each}
                </Select>
                <!-- Follows the roles picked above, using the same rule as the Scouting Admin API. -->
                {#if hasScoutingAdmin(row, drafts[row.id].competition_roles)}
                  <span class="admin-cell yes"
                    ><Check size={16} aria-hidden="true" /><span class="admin-label">Scouting Admin</span></span
                  >
                {:else}
                  <span class="admin-cell no"
                    ><span aria-hidden="true">—</span><span class="sr-only">No Scouting Admin</span></span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if section === 'data'}
      <div class="sp-grid">
        <section class="sp-panel">
          <header>
            <h3>Scouting data export</h3>
            <p>
              Everything for the event in one sheet, ready to sort and filter: Data, Performance and Robot reports, pit
              scouting, match rankings, scout notes and pit problems, one row each, in plain words. Excel adds colors
              and a guide; CSV is the same table as plain text.
            </p>
          </header>
          <SeasonFilter
            options={availableEvents}
            bind:value={browseEventKey}
            allLabel={`Current event (${eventKey || 'none set'})`}
          />
          <div class="sp-row">
            <button
              class="btn btn-primary"
              disabled={exportingMatchScoutingCsv || !(browseEventKey || eventKey)}
              on:click={() => exportEventData('', 'xlsx')}
              >{exportingMatchScoutingCsv ? 'Exporting...' : 'Whole event (Excel)'}</button
            >
            <button
              class="btn btn-outline"
              disabled={exportingMatchScoutingCsv || !(browseEventKey || eventKey)}
              on:click={() => exportEventData('', 'csv')}>Whole event (CSV)</button
            >
          </div>
          <div class="sp-row">
            <label class="sr-only" for="matchScoutingExportDate">Day to export</label>
            <DatePicker id="matchScoutingExportDate" bind:value={matchScoutingExportDate} />
            <button
              class="btn btn-outline"
              disabled={exportingMatchScoutingCsv || !(browseEventKey || eventKey) || !matchScoutingExportDate}
              on:click={() => exportEventData(matchScoutingExportDate, 'xlsx')}>This day (Excel)</button
            >
            <button
              class="btn btn-outline"
              disabled={exportingMatchScoutingCsv || !(browseEventKey || eventKey) || !matchScoutingExportDate}
              on:click={() => exportEventData(matchScoutingExportDate, 'csv')}>CSV</button
            >
          </div>
        </section>

        <section class="sp-panel">
          <header>
            <h3>Google Sheet</h3>
            <p>
              Keeps one shared sheet in step with the export above: the same readable table, replaced on every sync.
              Share the sheet with the AutoCAM service account (editor) first.
            </p>
          </header>
          <div class="sp-row">
            <input
              id="googleSheetId"
              class="sp-input"
              type="text"
              placeholder="Sheet ID from its URL (blank turns sync off)"
              bind:value={googleSheetIdInput}
              aria-label="Google Sheet ID"
            />
            <button
              class="btn btn-outline"
              disabled={savingGoogleSheetId || googleSheetIdInput.trim() === googleSheetId}
              on:click={saveGoogleSheetId}>{savingGoogleSheetId ? 'Saving...' : 'Save'}</button
            >
          </div>
          <div class="sp-row sp-split">
            <span class="sp-meta"
              >{#if googleSheetLastSyncedAt}Last synced {new Date(googleSheetLastSyncedAt).toLocaleString()}{:else}Not
                synced yet{/if}</span
            >
            <button class="btn btn-primary" disabled={!googleSheetId || syncingSheet} on:click={syncSheetNow}
              >{syncingSheet ? 'Syncing...' : 'Sync now'}</button
            >
          </div>
          {#if googleSheetLastSyncError}<p class="sp-error">{googleSheetLastSyncError}</p>{/if}
        </section>
      </div>
      <TeamRankingDefensePanel reports={matchReports} />
      <MatchKeyReview />
      <div class="data-browser">
        <ScoutDataBrowser reports={matchReports} onRemove={removeMatchReport} />
      </div>
      <DataStoragePanel />
      <div class="sp-grid">
        <section class="sp-panel sp-wide sp-danger">
          <div>
            <h3>Reset scouting data</h3>
            <p>
              Permanently deletes scouting notes, assignments, data events, pit scouting entries and pit photos. This
              cannot be undone.
            </p>
          </div>
          <button class="btn btn-outline-danger" disabled={deletingAllScoutingData} on:click={deleteAllScoutingData}
            >{deletingAllScoutingData ? 'Deleting...' : 'Delete scouting data'}</button
          >
        </section>
      </div>
    {:else if section === 'team'}
      <TeamSettingsPanel />
    {:else}
      <!-- The event at a glance: how much is covered, not who did what. -->
      <section class="ov-tiles" aria-label="Event coverage">
        {#each [{ label: 'Matches scouted', percent: metrics.data.scouted_percent, detail: `${metrics.data.scouted_matches} of ${metrics.data.total_matches} matches have reports` }, { label: 'Pit scouted', percent: metrics.pit.percent, detail: `${metrics.pit.completed_teams ?? metrics.pit.scouted_teams} of ${metrics.pit.total_teams} teams` }, { label: 'Assignments set', percent: metrics.data.assigned_percent, detail: `${metrics.data.assigned_matches} of ${metrics.data.total_matches} matches have scouts` }] as tile (tile.label)}
          <div class="ov-tile">
            <span class="ov-label">{tile.label}</span>
            <b class="ov-value">{tile.percent ?? 0}%</b>
            <div class="ov-bar" aria-hidden="true"><i style:width={`${Math.min(100, tile.percent ?? 0)}%`}></i></div>
            <small>{tile.detail}</small>
          </div>
        {/each}
        <div class="ov-tile">
          <span class="ov-label">Match reports</span>
          <b class="ov-value">{metrics.match?.reports || 0}</b>
          <small>{metrics.match?.matches || 0} matches · {metrics.match?.teams || 0} teams</small>
        </div>
      </section>

      <section class="admin-charts" aria-label="Scouting charts">
        <figure class="card chart-card wide">
          <h3>Robots reported per match</h3>
          <LineChart
            ariaLabel="Robots with a report in each match, out of six"
            max={6}
            digits={0}
            series={[{ name: 'Robots reported', color: 'var(--accent)', points: robotsReportedPerMatch(matchReports) }]}
            reference={{ value: 6, label: 'All six' }}
          />
        </figure>
        <figure class="card chart-card">
          <h3>Report kinds</h3>
          <CountBars rows={reportKindMix(matchReports)} color="var(--accent)" emptyText="No match reports yet." />
        </figure>
      </section>
    {/if}

    <slot />
  </div>
{/if}

<style>
  /* Event setup: one column of numbered steps under a summary of the current event. */
  .ev {
    display: grid;
    gap: var(--space-4);
    max-width: 56rem;
  }
  .ev-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .ev-summary > div {
    display: grid;
    gap: 4px;
    padding: var(--space-3) var(--space-4);
    border-left: 1px solid var(--border);
  }
  .ev-summary > div:first-child {
    border-left: 0;
  }
  .ev-k {
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .ev-summary b {
    color: var(--text-strong, var(--text));
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .ev-code {
    font-size: 1.25rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .ev-step {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .ev-head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .ev-num {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text-strong, var(--text));
    font-size: 0.85rem;
    font-weight: 600;
  }
  .ev-head h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0.15rem 0 0;
    font-size: 1.05rem;
    font-weight: 500;
  }
  .ev-head p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .ev-body {
    display: grid;
    gap: var(--space-2);
    padding-left: calc(1.75rem + var(--space-3));
  }
  .ev-field {
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .ev-more {
    margin-top: var(--space-2);
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
  .ev-more summary {
    color: var(--text-secondary);
    font-size: 0.88rem;
    cursor: pointer;
  }
  .ev-more summary:hover {
    color: var(--text);
  }
  .ev-more-body {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .ev-more-body p {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  @media (max-width: 700px) {
    .ev-body {
      padding-left: 0;
    }
    .ev-summary > div:nth-child(odd) {
      border-left: 0;
    }
  }
  .ov-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }
  .ov-tile {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .ov-label {
    color: var(--text-secondary);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .ov-value {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--text-strong, var(--text));
    font-variant-numeric: tabular-nums;
  }
  .ov-bar {
    height: 0.35rem;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    overflow: hidden;
  }
  .ov-bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }
  .ov-tile small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .sp-optional {
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.62rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .start-photo-upload {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin: 1rem 0;
  }
  .start-photo-preview {
    width: 160px;
    height: 100px;
    object-fit: cover;
  }
  .sr-only {
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
  .scouting-admin-page {
    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
    padding-bottom: var(--space-7);
  }

  .scouting-admin-page :global(.card) {
    margin: 0;
  }

  .denied-card h2 {
    margin: 0;
  }

  .sub-label {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .scouting-header {
    margin: 0;
  }

  .scouting-header-content {
    min-width: 260px;
  }

  .match-scouting-export {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
  }

  /* Event card */
  .event-card {
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .danger-card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-3);
    flex-wrap: wrap;
    margin-top: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-color: var(--border);
    background: var(--surface-2);
  }

  .danger-copy {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
    max-width: 42rem;
  }

  .event-controls {
    display: flex;
    align-items: flex-end;
    gap: var(--gap-3);
    flex-wrap: wrap;
  }

  .event-control {
    flex: 1;
    min-width: min(100%, 420px);
    margin: 0;
  }

  .event-hint {
    margin: 0;
    font-size: var(--font-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Status messages */
  .status-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
  }

  .status-message {
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-xs);
    line-height: 1.4;
  }

  .status-warning {
    background: var(--status-pending-bg);
    border-color: var(--status-pending-border);
    color: var(--status-pending-text);
  }

  .status-error {
    background: var(--status-risk-bg);
    border-color: var(--status-risk-border);
    color: var(--status-risk-text);
  }

  .status-success {
    background: var(--status-ready-bg);
    border-color: var(--status-ready-border);
    color: var(--status-ready-text);
  }

  /* Stat cards */
  .stat-content {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }

  .stat-label {
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-value {
    font-size: var(--font-2xl);
    font-weight: 700;
    line-height: 1;
  }

  .stat-sub {
    font-size: var(--font-xs);
    color: var(--text-muted);
  }

  /* Missed matches */
  .compact-empty {
    padding: var(--space-4);
  }

  .table-wrap {
    overflow-x: auto;
  }

  .missed-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
    font-size: var(--font-xs);
  }

  /* Shift assignments */
  .assignment-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }
  .assignment-tab-picker {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .assignment-tab-btn {
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    border-right: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-muted);
    font: inherit;
    font-weight: 600;
    font-size: var(--font-sm);
    padding: var(--space-2) var(--space-2);
    text-align: center;
    cursor: pointer;
  }
  .assignment-tab-btn:last-child {
    border-right: 0;
  }
  .assignment-tab-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .assignment-tab-btn.active {
    background: var(--accent-subtle);
    color: var(--accent-strong);
  }
  @media (max-width: 640px) {
    .assignment-tab-picker {
      flex-wrap: wrap;
    }
    .assignment-tab-btn {
      flex: 1 1 33%;
      border-bottom: 1px solid var(--border);
    }
  }

  @media (max-width: 768px) {
    .scouting-admin-page {
      gap: var(--gap-4);
    }

    .event-controls {
      flex-direction: column;
      align-items: stretch;
    }
  }

  /* All four .table uses on this page (missed matches, fuel calibration,
     quick scout attribution, competition roles) become one card per row
     below phone width - a data-label attribute on each <td> supplies the
     printed label since the real <th> row is hidden here. Label-above-value
     (not inline space-between) because several cells hold more than one
     element (an input + button, a <select>), which space-between would
     otherwise spread apart oddly. The 768px min-width rule above is a
     no-op once cells are display:block/width:100% here, so nothing to
     override for it. */
  @media (max-width: 640px) {
    .table-container {
      overflow-x: visible;
    }
  }

  .data-browser {
    margin: var(--space-5) 0;
  }
  /* The section switcher: pill tabs on a hairline, with the event and a refresh button at the end. */
  .admin-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .admin-tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 2px;
    flex-wrap: wrap;
  }
  .admin-tab {
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.92rem;
    font-weight: 500;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }
  .admin-tab:hover {
    color: var(--text-strong, var(--text));
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
  .admin-tab.active {
    color: var(--text-strong, var(--text));
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .admin-bar-end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .admin-refresh {
    display: inline-grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .admin-refresh:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .admin-refresh :global(.spin) {
    animation: admin-spin 0.9s linear infinite;
  }
  @keyframes admin-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 700px) {
    .admin-tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .admin-tab {
      white-space: nowrap;
    }
  }

  .scouts {
    display: grid;
    gap: var(--space-3);
  }
  .scouts-bar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .sf {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .scout-search {
    flex: 0 1 18rem;
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
  }
  .scout-search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .scouts-note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .scouts-empty {
    margin: 0;
    padding: var(--space-5);
    text-align: center;
    color: var(--text-muted);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .scout-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .pending {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    border-left: 3px solid var(--accent);
  }
  .pending h3 {
    margin: 0;
    font-size: 1rem;
  }
  .pending ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .pending li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .pending-who {
    display: grid;
    min-width: 0;
  }
  .pending-who small {
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .pending-actions {
    display: flex;
    gap: var(--space-2);
  }
  .account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }
  .link-btn {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    min-height: var(--tap-min, 44px);
  }
  .link-btn:hover {
    text-decoration: underline;
  }
  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (min-width: 901px) {
    .link-btn {
      min-height: 0;
    }
  }

  .scout-head,
  .scout-row {
    display: grid;
    grid-template-columns: 2.4rem minmax(12rem, 1fr) minmax(14rem, 2fr) minmax(7rem, 9rem) 7.5rem;
    gap: var(--space-4);
    align-items: center;
    padding: 0 var(--space-4);
  }
  .scout-head {
    height: 2.4rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .admin-head {
    text-align: center;
  }
  .admin-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
  }
  .admin-cell.yes {
    color: var(--accent-strong);
  }
  .admin-cell.no {
    color: var(--text-muted);
  }
  /* On desktop the column header names it; phones show the words next to the check. */
  .admin-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
    padding: var(--space-2) 0;
    min-width: 0;
  }
  .role-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 2px 2px var(--space-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .role-chip button {
    display: grid;
    place-items: center;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .role-chip button:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .scout-row {
    min-height: 3.6rem;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
  }
  .scout-row:last-child {
    border-bottom: 0;
  }
  .scout-row:hover {
    background: var(--surface-2);
  }
  .scout-row.assigned {
    border-left-color: var(--accent);
  }
  .av {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 0.9rem;
  }
  .who {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .who small {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    justify-self: start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .rename {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .rename input {
    flex: 1;
    min-width: 0;
    min-height: 2.1rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
  @media (max-width: 800px) {
    .scout-head {
      display: none;
    }
    .scout-row {
      grid-template-columns: 2.4rem 1fr 1fr;
      grid-template-areas: 'av who who' '. roles roles' '. team admin';
      padding: var(--space-3);
      row-gap: var(--space-2);
    }
    .scout-row .av {
      grid-area: av;
    }
    .scout-row .who {
      grid-area: who;
    }
    .scout-row .roles {
      grid-area: roles;
    }
    .scout-row :global(.sel-team) {
      grid-area: team;
    }
    .scout-row .admin-cell {
      grid-area: admin;
      justify-content: flex-start;
      font-size: max(0.85rem, var(--text-min));
    }
    .scout-row .admin-label {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip: auto;
    }
    .scout-row .admin-cell.no {
      display: none;
    }
  }

  .sp-panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .sp-panel.sp-wide {
    grid-column: 1 / -1;
  }
  .sp-panel h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .sp-panel p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .sp-panel header p {
    flex-basis: 100%;
    margin-top: 2px;
  }
  .sp-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .sp-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .sp-row > .btn {
    min-height: 2.5rem;
  }
  .sp-row.sp-split {
    justify-content: space-between;
  }
  .sp-input {
    flex: 1;
    min-width: 0;
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
  .sp-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .sp-meta {
    color: var(--text-muted) !important;
    font-size: 0.85rem !important;
  }
  .sp-row :global(.sel-event) {
    flex: 1;
  }
  .sp-code-input {
    text-transform: uppercase;
    font-family: var(--font-mono, ui-monospace, monospace);
    letter-spacing: 0.06em;
  }
  .sp-code-input::placeholder {
    text-transform: none;
    letter-spacing: normal;
  }
  .sp-error {
    color: var(--text) !important;
    padding-left: var(--space-3);
    border-left: 3px solid var(--danger);
  }
  .sp-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-height: 11rem;
    overflow-y: auto;
  }
  .sp-chips li {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
  }
  .sp-chips li {
    padding-left: 0.55rem;
  }
  .sp-chips button {
    padding: 0.2rem 0.45rem;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
  }
  .sp-chips button:hover {
    color: var(--text);
  }
  .sp-alliance {
    display: grid;
    gap: var(--space-2);
  }
  .sp-alliance h4 {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .sp-tiles {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .sp-tile {
    position: relative;
    display: grid;
    grid-template-rows: auto auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-2);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .sp-tile:hover,
  .sp-tile:focus-within {
    border-color: var(--accent);
  }
  .sp-tile img,
  .sp-empty {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: grid;
    place-items: center;
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .sp-cap {
    display: grid;
    gap: 1px;
    padding: var(--space-2) var(--space-3);
  }
  .sp-cap b {
    font-weight: 500;
    text-transform: capitalize;
    font-size: 0.85rem;
  }
  .sp-cap small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .sp-tile:hover .sp-cap small {
    color: var(--text);
  }
  .sp-tile input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .sp-danger {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
  .sp-danger h3 {
    margin-bottom: 2px;
  }
  .sp-lede {
    margin: 0 0 var(--space-4);
    color: var(--text-muted);
  }
  @media (max-width: 900px) {
    .sp-grid {
      grid-template-columns: 1fr;
    }
    .sp-tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .sp-danger {
      grid-template-columns: 1fr;
    }
  }

  /* Phone */
  .adm-picker {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 3.5rem;
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .adm-picker :global(svg:first-child) {
    color: var(--accent-strong);
  }
  .adm-picker span,
  .adm-sheet span {
    display: grid;
    min-width: 0;
  }
  .adm-picker small,
  .adm-sheet small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .adm-sheet {
    display: grid;
    gap: var(--space-2);
  }
  .adm-sheet a {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    min-height: 3.5rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    text-decoration: none;
  }
  .adm-sheet a.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }
  .adm-sheet a :global(svg) {
    color: var(--text-secondary);
  }
  @media (max-width: 900px) {
    .sp-grid {
      grid-template-columns: 1fr;
    }
    .sp-row {
      flex-direction: column;
      align-items: stretch;
    }
    /* Phone: stretch the row's controls, but never the visually hidden labels. */
    .sp-row > :global(:not(.sr-only)) {
      width: 100%;
    }
    .sp-panel .btn {
      min-height: var(--tap-min);
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .who small,
    .name {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }

  .admin-charts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    margin: var(--space-4) 0;
  }
  .chart-card {
    margin: 0;
    display: grid;
    gap: var(--space-2);
    align-content: start;
  }
  .chart-card.wide {
    grid-column: 1 / -1;
  }
  .chart-card h3 {
    margin: 0;
    font-size: 1rem;
  }
  .chart-note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  @media (max-width: 900px) {
    .admin-charts {
      grid-template-columns: 1fr;
      gap: var(--space-3);
      margin: var(--space-3) 0;
    }
  }
</style>
