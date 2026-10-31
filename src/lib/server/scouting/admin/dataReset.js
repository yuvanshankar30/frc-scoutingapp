// "Delete all scouting data" for an event, and the paged reads and deletes it is built from.
import { escapeMatchKeyPrefix, normalizeEventCode } from '$lib/scouting/eventCode.js';

export const PIT_SCOUT_PHOTO_BUCKET = 'pit-scout-photos';

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

export async function fetchEventRowsByMatchPrefix(db, tableName, matchPrefix) {
  const { data, error } = await db.from(tableName).select('*').ilike('match_key', matchPrefix);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchEventPitEntryRows(db, eventKey) {
  const { data, error } = await db.from('pit_scout_entries').select('*').eq('event_key', eventKey);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function deleteRowsByMatchPrefix(db, tableName, matchPrefix, count) {
  if (count === 0) return 0;
  const { error } = await db.from(tableName).delete().ilike('match_key', matchPrefix);
  if (error) throw error;
  return count;
}

export async function deleteRowsByEventKey(db, tableName, eventKey, count) {
  if (count === 0) return 0;
  const { error } = await db.from(tableName).delete().eq('event_key', eventKey);
  if (error) throw error;
  return count;
}

export async function removePitPhotos(db, photoPaths) {
  const safePaths = (photoPaths || [])
    .map((p) => String(p || '').trim())
    .filter((p) => p && !p.startsWith('match-starts/') && !p.includes('..'));
  let removed = 0;
  const warnings = [];

  for (const batch of chunk(safePaths, 100)) {
    if (!batch.length) continue;
    const { error } = await db.storage.from(PIT_SCOUT_PHOTO_BUCKET).remove(batch);
    if (error) {
      warnings.push(`Failed to remove some pit photos: ${error.message}`);
      continue;
    }
    removed += batch.length;
  }

  return { removed, warnings };
}

export async function clearAllScoutingData(db, eventKey, { actorId = null } = {}) {
  const normalizedEventKey = normalizeEventCode(eventKey);
  const matchPrefix = escapeMatchKeyPrefix(normalizedEventKey);
  if (!normalizedEventKey || !matchPrefix) {
    throw new Error('A valid event_key is required to clear scouting data.');
  }

  const [dataRows, noteRows, assignmentRows, pitRows] = await Promise.all([
    fetchEventRowsByMatchPrefix(db, 'scout_data_events', matchPrefix),
    fetchEventRowsByMatchPrefix(db, 'scout_notes', matchPrefix),
    fetchEventRowsByMatchPrefix(db, 'scout_match_assignments', matchPrefix),
    fetchEventPitEntryRows(db, normalizedEventKey)
  ]);

  const safePhotoPaths = [
    ...new Set(
      (pitRows || [])
        .flatMap((row) => (Array.isArray(row?.photo_paths) ? row.photo_paths : []))
        .map((value) => String(value || '').trim())
        .filter((p) => p && !p.startsWith('match-starts/') && !p.includes('..'))
    )
  ];

  const warningParts = [];
  let backupRecorded = false;
  const backupSnapshot = {
    event_key: normalizedEventKey,
    backed_up_at: new Date().toISOString(),
    counts: {
      data_events: dataRows.length,
      notes: noteRows.length,
      assignments: assignmentRows.length,
      pit_entries: pitRows.length,
      pit_photos: safePhotoPaths.length
    },
    rows: {
      pit_scout_entries: pitRows,
      scout_data_events: dataRows,
      scout_notes: noteRows,
      scout_match_assignments: assignmentRows
    }
  };

  try {
    const backupRes = await db.from('activity_log').insert?.([
      {
        action: 'BACKUP_BEFORE_DELETE_ALL_SCOUTING_DATA',
        table_name: 'scouting_event_backup',
        record_id: normalizedEventKey,
        actor: actorId || null,
        old_data: backupSnapshot,
        new_data: null
      }
    ]);
    if (!backupRes?.error) backupRecorded = true;
    else warningParts.push(`Backup log warning: ${backupRes.error.message}`);
  } catch (err) {
    warningParts.push(`Backup log warning: ${err?.message || err}`);
  }

  const [dataEventsDeleted, notesDeleted, assignmentsDeleted, pitEntriesDeleted] = await Promise.all([
    deleteRowsByMatchPrefix(db, 'scout_data_events', matchPrefix, dataRows.length),
    deleteRowsByMatchPrefix(db, 'scout_notes', matchPrefix, noteRows.length),
    deleteRowsByMatchPrefix(db, 'scout_match_assignments', matchPrefix, assignmentRows.length),
    deleteRowsByEventKey(db, 'pit_scout_entries', normalizedEventKey, pitRows.length)
  ]);

  const pitPhotoRemoval = await removePitPhotos(db, safePhotoPaths);
  warningParts.push(...pitPhotoRemoval.warnings);

  return {
    event_key: normalizedEventKey,
    backup_recorded: backupRecorded,
    deleted: {
      data_events: dataEventsDeleted,
      notes: notesDeleted,
      assignments: assignmentsDeleted,
      pit_entries: pitEntriesDeleted,
      pit_photos: pitPhotoRemoval.removed
    },
    warning: warningParts.filter(Boolean).join(' ')
  };
}
