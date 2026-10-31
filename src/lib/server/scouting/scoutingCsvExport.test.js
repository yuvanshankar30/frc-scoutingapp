import { describe, expect, it } from 'vitest';
import { csvCell, matchScoutingRowsToCsv, localDayRangeUtc } from './scoutingCsvExport.js';

describe('scouting CSV export', () => {
  it('escapes quotes, commas, newlines, arrays, and objects', () => {
    const csv = matchScoutingRowsToCsv([
      {
        event_key: '2026test',
        team_key: 'frc5940',
        notes: 'Fast, but "fragile"\nCheck chain',
        tags: ['drive', 'pit'],
        detail: { urgent: true }
      }
    ]);
    expect(csv).toContain('"Fast, but ""fragile""\nCheck chain"');
    expect(csv).toContain('"[""drive"",""pit""]"');
    expect(csv).toContain('"{""urgent"":true}"');
  });

  it('neutralizes spreadsheet formulas from user-entered cells', () => {
    expect(csvCell('=HYPERLINK("https://bad.example")')).toBe('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"');
    expect(csvCell('\r=1+1')).toBe('"\'\r=1+1"');
    expect(csvCell('\n=1+1')).toBe('"\'\n=1+1"');
    expect(csvCell('  -cmd|"/c calc"!A0')).toBe('"\'  -cmd|""/c calc""!A0"');
    expect(csvCell('|cmd')).toBe('"\'|cmd"');
  });
});

describe('matchScoutingRowsToCsv', () => {
  it('exports match scouting fields without an assignment or dataset column', () => {
    const csv = matchScoutingRowsToCsv([
      { event_key: '2026test', match_key: '2026test_qm1', team_key: 'frc5940', crash_or_break: false }
    ]);
    expect(csv).toContain('"event_key","match_key","team_key"');
    expect(csv).not.toContain('dataset');
    expect(csv).not.toContain('assigned_user');
  });

  it('handles an empty day with no submissions', () => {
    expect(matchScoutingRowsToCsv([])).toBe('\uFEFF\r\n');
  });
});

describe('localDayRangeUtc', () => {
  it('spans exactly 24 hours', () => {
    const { start, end } = localDayRangeUtc('2026-09-19', 'America/Los_Angeles');
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('starts at local midnight, expressed in UTC (PDT, UTC-7, in September)', () => {
    const { start } = localDayRangeUtc('2026-09-19', 'America/Los_Angeles');
    expect(start).toBe('2026-09-19T07:00:00.000Z');
  });

  it('accounts for the winter PST offset (UTC-8), not a hardcoded -7', () => {
    const { start } = localDayRangeUtc('2026-01-15', 'America/Los_Angeles');
    expect(start).toBe('2026-01-15T08:00:00.000Z');
  });

  it('rejects a malformed date instead of silently returning garbage', () => {
    expect(() => localDayRangeUtc('not-a-date')).toThrow(/YYYY-MM-DD/);
    expect(() => localDayRangeUtc('')).toThrow(/YYYY-MM-DD/);
  });
});
