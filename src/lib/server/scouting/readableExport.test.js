import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildExportTable, exportTableToCsv, exportTableToXlsx, headerWidth } from './readableExport.js';

const records = {
  matchEntries: [
    {
      id: 7,
      created_by: '8f1d-uuid',
      form_version: 2,
      event_key: '2026cacg',
      match_key: '2026cacg_qm12',
      team_key: 'frc5940',
      alliance: 'red',
      report_kind: 'data',
      scout_name: 'Sam',
      created_at: '2026-03-28T20:14:00Z',
      starting_position: 'right trench',
      preload: true,
      auto_moved: 'did-not-run',
      balls_scored_band: '40-60',
      balls_scored_min: 40,
      balls_scored_max: 60,
      balls_scored_average: 50,
      teleop_roles: ['Scorer', 'Defense'],
      auto_path: { points: [[1, 2]] },
      auto_path_name: 'Left 3',
      robot_present: true
    },
    {
      event_key: '2026cacg',
      match_key: '2026cacg_qm3',
      team_key: 'frc254',
      report_kind: 'robot',
      scout_name: 'Rae',
      teleop_robot_status: 'dead',
      mechanical_break: true,
      card: '',
      robot_present: false
    },
    {
      event_key: '2026cacg',
      match_key: '2026cacg_qm3',
      team_key: 'frc254',
      report_kind: 'performance',
      scout_name: 'Ana',
      ratings: { 'Shot accuracy': 4, BPS: 3 },
      power_ranking: { frc254: 1, frc5940: 2 }
    }
  ],
  pitEntries: [{ id: 1, event_key: '2026cacg', team_key: 'frc5940', drivebase_type: 'Swerve', climb_options: ['L1'] }],
  problems: [
    { id: 'u', event_key: '2026cacg', team_key: 'frc254', summary: 'Chain off', severity: 'urgent', slack_ts: '1.2' }
  ]
};

describe('buildExportTable', () => {
  const table = buildExportTable(records);
  const headers = table.columns.map((column) => column.header);
  const cell = (rowIndex, header) => table.rows[rowIndex].cells[headers.indexOf(header)];

  it('uses plain column names and leaves out ids, codes, versions, Slack fields and auto paths', () => {
    expect(headers.slice(0, 3)).toEqual(['Record', 'Match', 'Team']);
    for (const hidden of ['id', 'created_by', 'form_version', 'slack_ts', 'auto_path', 'auto_path_name', 'Path'])
      expect(headers).not.toContain(hidden);
    expect(headers.join(' ')).not.toMatch(/_/);
  });

  it('writes values in words: matches, teams, yes/no, codes, lists and rankings', () => {
    const data = table.rows.findIndex((row) => row.type === 'data');
    expect(cell(data, 'Match')).toBe('Qual 12');
    expect(cell(data, 'Team')).toBe(5940);
    expect(cell(data, 'Starting position')).toBe('Right trench');
    expect(cell(data, 'Auto')).toBe("Didn't run");
    expect(cell(data, 'Preload')).toBe('Yes');
    expect(cell(data, 'Teleop roles')).toBe('Scorer, Defense');
    expect(cell(data, 'Balls scored (estimate)')).toBe(50);
    expect(cell(data, 'Beached') ?? null).toBeNull();
    const performance = table.rows.findIndex((row) => row.type === 'performance');
    expect(cell(performance, 'Shot accuracy means')).toBe('>75–85%');
    expect(cell(performance, 'Power ranking (best first)')).toBe('1. 254   2. 5940');
    const robot = table.rows.findIndex((row) => row.type === 'robot');
    expect(cell(robot, 'Robot status')).toBe('Dead');
    expect(cell(robot, 'Robot showed up')).toBe('No');
    expect(cell(robot, 'Card')).toBe('None');
  });

  it('sorts by record kind, then match, and drops columns nobody filled in', () => {
    expect(table.rows.map((row) => row.type)).toEqual(['data', 'performance', 'robot', 'pit', 'issue']);
    expect(headers).not.toContain('Shuttled');
  });

  it('writes a CSV with the same headers', () => {
    const csv = exportTableToCsv(table);
    expect(csv.split('\r\n')[0]).toBe(`\uFEFF${headers.map((header) => `"${header}"`).join(',')}`);
  });
});

describe('headerWidth', () => {
  it('fits the longest word of a heading plus the filter button, so no word breaks', () => {
    expect(headerWidth({ header: 'Mechanical break', width: 10 })).toBeGreaterThanOrEqual(Math.ceil(10 * 1.3 + 5));
    expect(headerWidth({ header: 'Intake jammed', width: 9 })).toBeGreaterThanOrEqual(Math.ceil(6 * 1.3 + 5));
    expect(headerWidth({ header: 'Teleop notes', width: 40 })).toBe(40);
  });
});

describe('exportTableToXlsx', () => {
  // Reads the zip's file list and one file's text, to check the workbook is put together right.
  function unzip(buffer) {
    const files = {};
    let offset = 0;
    while (buffer.readUInt32LE(offset) === 0x04034b50) {
      const size = buffer.readUInt32LE(offset + 18);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
      const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
      files[name] = inflateRawSync(data).toString();
      offset += 30 + nameLength + size;
    }
    return files;
  }

  it('builds a workbook with a Teams tab, a tab per kind of scouting, All records and a Guide', () => {
    const table = buildExportTable(records);
    const files = unzip(exportTableToXlsx(table, { eventKey: '2026cacg' }));
    const workbook = files['xl/workbook.xml'];
    const tabs = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]);
    expect(tabs).toEqual([
      'Teams',
      'Data scouting',
      'Performance scouting',
      'Robot scouting',
      'Pit scouting',
      'Notes &amp; pit problems',
      'All records',
      'Guide'
    ]);
    const data = files['xl/worksheets/sheet2.xml'];
    expect(data).toContain('state="frozen"');
    expect(data).toContain('<autoFilter');
    expect(data).toContain('Qual 12');
    expect(data).not.toContain('Shot accuracy');
    expect(files['xl/worksheets/sheet3.xml']).toContain('Shot accuracy (1-5)');
    expect(files['xl/worksheets/sheet1.xml']).toContain('Avg balls scored');
    expect(files['xl/worksheets/sheet8.xml']).toContain('Scouting export: 2026cacg');
    expect(files['xl/styles.xml']).toContain('FFB6D7A8');
    expect(files['xl/styles.xml']).toContain('formatCode="0.0"');
  });

  it('summarizes each team: report counts, averages, problems and power rank place', () => {
    const teams = buildExportTable(records).teams;
    const t254 = teams.find((row) => row.team === 254);
    expect(t254).toMatchObject({
      robotReports: 1,
      performanceReports: 1,
      accuracy: 4,
      bps: 3,
      problems: 0,
      noShows: 1
    });
    expect(t254.powerPlace).toBe(1);
    expect(teams.find((row) => row.team === 5940)).toMatchObject({ balls: 50, drivetrain: 'Swerve', powerPlace: 2 });
  });
});
