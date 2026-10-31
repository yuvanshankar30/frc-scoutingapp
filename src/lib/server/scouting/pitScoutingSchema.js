const PIT_SCOUT_OPTIONAL_COLUMN_DEFAULTS = Object.freeze({
  scout_name: null,
  robot_archetype: null,
  additional_notes: null,
  likely_breaking_component: null,
  estimated_bps: null,
  auto_points_estimate: null,
  climb_options: [],
  auto_options: [],
  technical_details: {},
  custom_answers: {},
  custom_form_version: null
});

const BASE_PIT_SCOUT_SELECT_COLUMNS = [
  'id',
  'event_key',
  'team_key',
  'drivebase_type',
  'shooter_type',
  'hopper_type',
  'human_player_balls_in_auto',
  'photo_paths',
  'created_by',
  'created_at',
  'updated_at'
];

export const PIT_SCOUT_OPTIONAL_COLUMNS = Object.keys(PIT_SCOUT_OPTIONAL_COLUMN_DEFAULTS);

function cloneDefaultValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

export function buildPitScoutSchema(supportedColumns = PIT_SCOUT_OPTIONAL_COLUMNS) {
  const supported = new Set((supportedColumns || []).map(String));
  return {
    scout_name: supported.has('scout_name'),
    robot_archetype: supported.has('robot_archetype'),
    additional_notes: supported.has('additional_notes'),
    likely_breaking_component: supported.has('likely_breaking_component'),
    estimated_bps: supported.has('estimated_bps'),
    auto_points_estimate: supported.has('auto_points_estimate'),
    climb_options: supported.has('climb_options'),
    auto_options: supported.has('auto_options'),
    technical_details: supported.has('technical_details'),
    custom_answers: supported.has('custom_answers'),
    custom_form_version: supported.has('custom_form_version')
  };
}

export function buildPitScoutSelectColumns(supportedColumns = PIT_SCOUT_OPTIONAL_COLUMNS) {
  return [...BASE_PIT_SCOUT_SELECT_COLUMNS, ...(supportedColumns || [])].join(', ');
}

export function missingPitScoutOptionalColumn(error, supportedColumns = PIT_SCOUT_OPTIONAL_COLUMNS) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();

  if (!text) return null;
  if (!text.includes('column') && !text.includes('schema cache') && !text.includes('does not exist')) {
    return null;
  }

  return (supportedColumns || []).find((columnName) => text.includes(String(columnName).toLowerCase())) || null;
}

export function normalizePitScoutRow(row, schema = buildPitScoutSchema()) {
  if (!row) return row ?? null;

  const normalized = { ...row };
  for (const [columnName, defaultValue] of Object.entries(PIT_SCOUT_OPTIONAL_COLUMN_DEFAULTS)) {
    if (schema?.[columnName]) {
      const value = row?.[columnName];
      normalized[columnName] = value === undefined || value === null ? cloneDefaultValue(defaultValue) : value;
      continue;
    }

    normalized[columnName] = cloneDefaultValue(defaultValue);
  }

  return normalized;
}

export function normalizePitScoutRows(rows, schema = buildPitScoutSchema()) {
  return Array.isArray(rows) ? rows.map((row) => normalizePitScoutRow(row, schema)) : [];
}

export function pitScoutSchemaWarning(schema = buildPitScoutSchema()) {
  const missing = [];
  if (!schema?.scout_name) missing.push('scout name');
  if (!schema?.robot_archetype) missing.push('robot archetype');
  if (!schema?.additional_notes) missing.push('additional notes');
  if (!schema?.likely_breaking_component) missing.push('likely breaking component');
  if (!schema?.estimated_bps) missing.push('estimated BPS');
  if (!schema?.auto_points_estimate) missing.push('auto points estimate');
  if (!schema?.climb_options) missing.push('climb options');
  if (!schema?.auto_options) missing.push('auto options');
  if (!schema?.technical_details) missing.push('technical details');

  return missing.length
    ? `Pit scout optional fields are unavailable until the latest migration runs: ${missing.join(', ')}.`
    : null;
}

export async function selectPitScoutEntries(db, configureQuery) {
  let supportedColumns = [...PIT_SCOUT_OPTIONAL_COLUMNS];

  while (true) {
    const schema = buildPitScoutSchema(supportedColumns);
    const { data, error } = await configureQuery(
      db.from('pit_scout_entries').select(buildPitScoutSelectColumns(supportedColumns))
    );

    if (!error) {
      return {
        data: Array.isArray(data) ? normalizePitScoutRows(data, schema) : normalizePitScoutRow(data, schema),
        error: null,
        schema,
        warning: pitScoutSchemaWarning(schema)
      };
    }

    const missingColumn = missingPitScoutOptionalColumn(error, supportedColumns);
    if (!missingColumn) {
      return {
        data: null,
        error,
        schema,
        warning: pitScoutSchemaWarning(schema)
      };
    }

    supportedColumns = supportedColumns.filter((columnName) => columnName !== missingColumn);
  }
}

export function mergePitScoutPayloadWithExisting(existing, incoming) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const merged = { ...incoming };
  const clientSubmittedAt = merged.client_submitted_at || null;
  const removedPhotoPaths = Array.isArray(merged.removed_photo_paths)
    ? new Set(merged.removed_photo_paths.map(String))
    : null;
  delete merged.client_submitted_at;
  delete merged.removed_photo_paths;

  if (!existing || typeof existing !== 'object') return merged;

  const existingPhotos = Array.isArray(existing.photo_paths) ? existing.photo_paths.filter(Boolean) : [];
  const incomingPhotos = Array.isArray(merged.photo_paths) ? merged.photo_paths.filter(Boolean) : [];

  if (existingPhotos.length > 0) {
    if (!incomingPhotos.length && !removedPhotoPaths) {
      merged.photo_paths = [...existingPhotos];
    } else if (removedPhotoPaths) {
      const kept = existingPhotos.filter((p) => !removedPhotoPaths.has(p));
      merged.photo_paths = [...new Set([...kept, ...incomingPhotos])].slice(0, 3);
    }
  }

  const clientMs = Date.parse(String(clientSubmittedAt || ''));
  const existingMs = Date.parse(String(existing.updated_at || existing.created_at || ''));
  const isStaleReplay = Number.isFinite(clientMs) && Number.isFinite(existingMs) && existingMs > clientMs;

  if (isStaleReplay) {
    const scalarFields = [
      'drivebase_type',
      'shooter_type',
      'hopper_type',
      'human_player_balls_in_auto',
      'scout_name',
      'robot_archetype',
      'additional_notes',
      'likely_breaking_component',
      'estimated_bps',
      'auto_points_estimate',
      'custom_form_version'
    ];
    for (const field of scalarFields) {
      const existingVal = existing[field];
      if (existingVal !== null && existingVal !== undefined && existingVal !== '') {
        merged[field] = existingVal;
      }
    }
    for (const arrField of ['climb_options', 'auto_options']) {
      if (Array.isArray(existing[arrField]) && existing[arrField].length > 0) {
        merged[arrField] = [...existing[arrField]];
      }
    }
    if (existingPhotos.length > 0 || incomingPhotos.length > 0) {
      merged.photo_paths = [...new Set([...existingPhotos, ...incomingPhotos])].slice(0, 3);
    }
    for (const objField of ['technical_details', 'custom_answers']) {
      const existingObj = existing[objField] && typeof existing[objField] === 'object' ? existing[objField] : {};
      const incomingObj = merged[objField] && typeof merged[objField] === 'object' ? merged[objField] : {};
      const combined = { ...incomingObj };
      for (const [k, v] of Object.entries(existingObj)) {
        if (v !== null && v !== undefined && v !== '') {
          combined[k] = v;
        }
      }
      merged[objField] = combined;
    }
    if (existing.updated_at) {
      merged.updated_at = existing.updated_at;
    }
  }

  return merged;
}

export async function upsertPitScoutEntry(db, payload) {
  let supportedColumns = [...PIT_SCOUT_OPTIONAL_COLUMNS];
  let existingRow = null;
  if (payload?.event_key && payload?.team_key) {
    try {
      const query = db.from('pit_scout_entries')?.select?.('*');
      if (typeof query?.eq === 'function') {
        const res = await query.eq('event_key', payload.event_key).eq('team_key', payload.team_key).maybeSingle?.();
        if (res?.data) existingRow = res.data;
      }
    } catch {
      // ignore if mock db does not implement .eq().maybeSingle()
    }
  }
  let workingPayload = mergePitScoutPayloadWithExisting(existingRow, payload);

  while (true) {
    const schema = buildPitScoutSchema(supportedColumns);
    const { data, error } = await db
      .from('pit_scout_entries')
      .upsert(workingPayload, { onConflict: 'event_key,team_key' })
      .select(buildPitScoutSelectColumns(supportedColumns))
      .single();

    if (!error) {
      return {
        data: normalizePitScoutRow(data, schema),
        error: null,
        schema,
        warning: pitScoutSchemaWarning(schema)
      };
    }

    const missingColumn = missingPitScoutOptionalColumn(error, supportedColumns);
    if (!missingColumn) {
      return {
        data: null,
        error,
        schema,
        warning: pitScoutSchemaWarning(schema)
      };
    }

    supportedColumns = supportedColumns.filter((columnName) => columnName !== missingColumn);
    delete workingPayload[missingColumn];
  }
}
