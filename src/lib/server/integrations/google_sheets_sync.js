// Batch-syncs scouting data to a single, scout-manager-configured Google
// Sheet - deliberately NOT real-time (no API call per tap/event). Design
// context: docs/plans has the fuller feature history; the short version is
// this replaces "every scout sets up their own export" with one shared
// sheet the whole team points at.
//
// Auth: reuses the same service account as the AutoCAM Drive watcher
// (GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY), via $lib/server/google_service_account.js
// with a spreadsheets-scoped token instead of Drive's. The target sheet
// must be shared (Editor access) with that service account's email - same
// sharing model already used for AutoCAM's watched Drive folders, not a
// new concept for whoever manages that credential.
//
// STATUS: built and safe to ship with zero configuration (no-ops until
// both scouting_settings.google_sheet_id and GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY
// are set), but genuinely untested against a real Google Sheet - this
// environment has no Google credentials, same caveat already accepted for
// the Drive watcher (see its own header comment). Treat the first real
// sync against a real sheet as unverified.
import { getSupabase } from '$lib/server/serviceClient.js';
import { getServiceAccountAccessToken } from '$lib/server/integrations/google_service_account.js';
import { redactSecretText } from '$lib/server/redact.js';
import { fetchEventExportRecords } from '$lib/server/scouting/admin/eventData.js';
import { buildExportTable, EXPORT_GROUPS, headerWidth } from '$lib/server/scouting/readableExport.js';
import { env } from '$env/dynamic/private';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Unqualified ranges (no "SheetName!" prefix) target the spreadsheet's first visible tab, so the scout manager does
// not have to create or rename a tab before this works. Wide enough for every export column.
const SYNC_RANGE = 'A1:CZ10000';

// The sheet holds the same readable table as Scouting Admin's Excel and CSV export (readableExport.js): one row per
// record (Data, Performance and Robot reports, pit scouting, match rankings, notes, pit problems), plain column names,
// with a first row naming which form each block of columns comes from.
function sheetValues(table) {
  const groupRow = table.columns.map((column, index) =>
    index === 0 || table.columns[index - 1].group !== column.group
      ? EXPORT_GROUPS.find((group) => group.key === column.group)?.label || ''
      : ''
  );
  return [
    groupRow,
    table.columns.map((column) => column.header),
    ...table.rows.map((row) => row.cells.map((cell) => (cell === null || cell === undefined ? '' : cell)))
  ];
}

const rgb = (hex) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255
});

// Makes the first tab look like the Excel export: frozen headings and Record/Match/Team columns, bold headings
// colored by form, a filter, and column widths. Best effort - the values are already written if this fails.
async function formatSheet(spreadsheetId, accessToken, table) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const meta = await fetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, {
    headers
  }).then((res) => res.json());
  const sheetId = meta?.sheets?.[0]?.properties?.sheetId;
  if (sheetId === undefined) return;
  const columnCount = table.columns.length;
  const requests = [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 3 } },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
      }
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: table.rows.length + 2,
            startColumnIndex: 0,
            endColumnIndex: columnCount
          }
        }
      }
    }
  ];
  table.columns.forEach((column, index) => {
    const fill = rgb(EXPORT_GROUPS.find((group) => group.key === column.group)?.fill || 'D9D9D9');
    requests.push(
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: index, endColumnIndex: index + 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: fill,
              textFormat: { bold: true },
              wrapStrategy: 'WRAP',
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)'
        }
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
          properties: { pixelSize: Math.round(headerWidth(column) * 7.5) },
          fields: 'pixelSize'
        }
      }
    );
  });
  await fetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests })
  });
}

export async function syncScoutingDataToSheet() {
  const supa = getSupabase();
  const { data: settings, error: settingsError } = await supa
    .from('scouting_settings')
    .select('event_key, google_sheet_id')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) return { ok: false, reason: 'settings-query-failed', error: settingsError.message };

  const eventKey = String(settings?.event_key || '').trim();
  const sheetId = String(settings?.google_sheet_id || '').trim();
  if (!eventKey || !sheetId) {
    return { ok: false, reason: 'not-configured' };
  }

  const serviceAccountJson = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    return { ok: false, reason: 'no-service-account' };
  }

  try {
    const table = buildExportTable(await fetchEventExportRecords(supa, eventKey));
    const values = sheetValues(table);
    const rows = table.rows;

    const accessToken = await getServiceAccountAccessToken(serviceAccountJson, SHEETS_SCOPE);
    // Clear first: a shorter or narrower table must not leave old rows or columns behind.
    await fetch(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(SYNC_RANGE)}:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{}'
    });
    const res = await fetch(
      `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(SYNC_RANGE)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ range: SYNC_RANGE, majorDimension: 'ROWS', values })
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = redactSecretText(body?.error?.message || `Sheets API error ${res.status}`).slice(0, 500);
      await supa.from('scouting_settings').update({ google_sheet_last_sync_error: message }).eq('id', 1);
      return { ok: false, reason: 'sheets-api-error', error: message };
    }

    await formatSheet(sheetId, accessToken, table).catch(() => {});

    await supa
      .from('scouting_settings')
      .update({ google_sheet_last_synced_at: new Date().toISOString(), google_sheet_last_sync_error: null })
      .eq('id', 1);

    return { ok: true, rows: rows.length };
  } catch (e) {
    const message = redactSecretText(e?.message || String(e)).slice(0, 500);
    await supa
      .from('scouting_settings')
      .update({ google_sheet_last_sync_error: message })
      .eq('id', 1)
      .then(
        () => {},
        () => {}
      );
    return { ok: false, reason: 'exception', error: message };
  }
}
