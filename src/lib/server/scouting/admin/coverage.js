// Scouting coverage for the Scouting Admin dashboard: which match slots are assigned, which reports came
// in, and which pit profiles are complete.

export function matchNumberForKey(matchKey) {
  const m = String(matchKey || '').match(/_qm(\d+)$/i);
  return m ? Number(m[1]) : null;
}

export function isMatchKeyForEvent(matchKey, eventKey) {
  const mk = String(matchKey || '')
    .trim()
    .toLowerCase();
  const ek = String(eventKey || '')
    .trim()
    .toLowerCase();
  if (!mk || !ek) return false;
  return mk.startsWith(`${ek}_`);
}

export function teamKeySort(a, b) {
  const na = Number(String(a || '').replace(/^frc/i, ''));
  const nb = Number(String(b || '').replace(/^frc/i, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a || '').localeCompare(String(b || ''));
}

export function slotKey(matchKey, teamKey) {
  return `${matchKey}::${teamKey}`;
}

export function userSlotKey(userId, matchKey, teamKey) {
  return `${userId}::${matchKey}::${teamKey}`;
}

export function computeTypeMetrics({ type, assignments, matches, slotTeamsByMatch, evidenceRows, userNameMap }) {
  const totalMatches = matches.length;
  const totalSlots = totalMatches * 6;

  const relevantAssignments = (assignments || []).filter((row) => row?.scouting_type === type);
  const assignedSlots = new Set();
  for (const row of relevantAssignments) {
    if (!row?.assigned_user) continue;
    if (!slotTeamsByMatch.has(row.match_key)) continue;
    assignedSlots.add(slotKey(row.match_key, row.team_key));
  }

  let fullyAssignedMatches = 0;
  for (const match of matches) {
    const teams = slotTeamsByMatch.get(match.key) || [];
    const allAssigned = teams.every((teamKey) => assignedSlots.has(slotKey(match.key, teamKey)));
    if (allAssigned) fullyAssignedMatches += 1;
  }

  const anyEvidenceBySlot = new Set();
  const ownEvidenceBySlot = new Set();
  const userMaxStartedMatch = new Map();

  for (const row of evidenceRows || []) {
    const mk = row?.match_key;
    const tk = row?.team_key;
    const uid = row?.created_by;
    if (!mk || !tk) continue;
    if (!slotTeamsByMatch.has(mk)) continue;

    anyEvidenceBySlot.add(slotKey(mk, tk));

    if (uid) {
      ownEvidenceBySlot.add(userSlotKey(uid, mk, tk));
      const mn = matchNumberForKey(mk);
      if (mn !== null) {
        const prev = userMaxStartedMatch.get(uid) || 0;
        if (mn > prev) userMaxStartedMatch.set(uid, mn);
      }
    }
  }

  let fullyScoutedMatches = 0;
  for (const match of matches) {
    const teams = slotTeamsByMatch.get(match.key) || [];
    const allScouted = teams.every((teamKey) => anyEvidenceBySlot.has(slotKey(match.key, teamKey)));
    if (allScouted) fullyScoutedMatches += 1;
  }

  const missedAssignments = [];
  for (const row of relevantAssignments) {
    if (!row?.assigned_user) continue;
    if (!slotTeamsByMatch.has(row.match_key)) continue;

    const matchNumber = matchNumberForKey(row.match_key);
    if (matchNumber === null) continue;

    const ownEvidence = ownEvidenceBySlot.has(userSlotKey(row.assigned_user, row.match_key, row.team_key));
    if (ownEvidence) continue;

    const maxStarted = userMaxStartedMatch.get(row.assigned_user) || 0;
    if (maxStarted > matchNumber) {
      missedAssignments.push({
        scouting_type: type,
        match_key: row.match_key,
        match_number: matchNumber,
        team_key: row.team_key,
        assigned_user: row.assigned_user,
        user_name: userNameMap.get(row.assigned_user) || null
      });
    }
  }

  const percent = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  return {
    assigned_matches: fullyAssignedMatches,
    assigned_match_percent: percent(fullyAssignedMatches, totalMatches),
    scouted_matches: fullyScoutedMatches,
    scouted_match_percent: percent(fullyScoutedMatches, totalMatches),
    assigned_slots: assignedSlots.size,
    total_slots: totalSlots,
    missed_shifts: missedAssignments.length,
    missed_shift_percent: percent(missedAssignments.length, assignedSlots.size || 0),
    missed_assignments: missedAssignments
  };
}

export function computeMissedMatchList(dataMissed, noteMissed, quickMissed = []) {
  const byMatch = new Map();
  for (const item of [...dataMissed, ...noteMissed, ...quickMissed]) {
    if (!byMatch.has(item.match_key)) {
      byMatch.set(item.match_key, {
        match_key: item.match_key,
        match_number: item.match_number,
        data_missed_count: 0,
        note_missed_count: 0,
        quick_missed_count: 0,
        missed_assignments: []
      });
    }
    const row = byMatch.get(item.match_key);
    if (item.scouting_type === 'data') row.data_missed_count += 1;
    if (item.scouting_type === 'note') row.note_missed_count += 1;
    if (item.scouting_type === 'quick') row.quick_missed_count += 1;
    row.missed_assignments.push(item);
  }

  return [...byMatch.values()].sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
}
