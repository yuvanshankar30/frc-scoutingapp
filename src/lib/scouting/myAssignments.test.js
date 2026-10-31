import { describe, expect, it } from 'vitest';
import {
  allianceFor,
  assignmentHref,
  assignmentKind,
  assignmentRoleLabel,
  openAssignments,
  scheduledMatch,
  scoutKinds
} from './myAssignments.js';

const tbaMatch = (key, red, blue, extra = {}) => ({
  key,
  alliances: { red: { team_keys: red, score: -1 }, blue: { team_keys: blue, score: -1 } },
  ...extra
});

const schedule = [
  tbaMatch('2026cabl_qm12', ['frc5940', 'frc254', 'frc1678'], ['frc604', 'frc649', 'frc840'], { time: 1000 }),
  tbaMatch('2026cabl_qm3', ['frc1', 'frc2', 'frc3'], ['frc5940', 'frc5', 'frc6'], {
    time: 500,
    actual_time: 510,
    alliances: {
      red: { team_keys: ['frc1', 'frc2', 'frc3'], score: 40 },
      blue: { team_keys: ['frc5940', 'frc5', 'frc6'], score: 52 }
    }
  }),
  tbaMatch('2026cabl_sf2m1', ['frc8', 'frc9', 'frc10'], ['frc11', 'frc12', 'frc13'])
];

describe('assignmentKind', () => {
  it('follows the scout role from the People tab, case-insensitively', () => {
    expect(assignmentKind(['Performance Scout Member'])).toBe('performance');
    expect(assignmentKind(['robot scout member', 'Pit Crew'])).toBe('robot');
    expect(assignmentKind(['Data Scout Member'])).toBe('data');
  });

  it('is data for someone without a scout role, and data first when they hold several', () => {
    expect(assignmentKind([])).toBe('data');
    expect(assignmentKind(['Scouting Lead'])).toBe('data');
    expect(assignmentKind(['Robot Scout Member', 'Data Scout Member'])).toBe('data');
  });

  it('lists every scout role a person holds', () => {
    expect(scoutKinds(['Robot Scout Member', 'Performance Scout Member', 'Driver'])).toEqual(['performance', 'robot']);
    expect(scoutKinds(null)).toEqual([]);
  });
});

describe('assignmentRoleLabel', () => {
  it('names the kind for match assignments and the type for the others', () => {
    expect(assignmentRoleLabel({ scouting_type: 'data', report_kind: 'performance' })).toBe('Performance scout');
    expect(assignmentRoleLabel({ scouting_type: 'data' })).toBe('Data scout');
    expect(assignmentRoleLabel({ scouting_type: 'note' })).toBe('Note scout');
    expect(assignmentRoleLabel({ scouting_type: 'quick' })).toBe('Quick scout');
  });
});

describe('schedule lookups', () => {
  it('finds the TBA match by suffix even when the event code differs', () => {
    expect(scheduledMatch('training_qm12', schedule)?.key).toBe('2026cabl_qm12');
    expect(scheduledMatch('2026cabl_qm99', schedule)).toBeNull();
  });

  it('finds the alliance with or without the frc prefix', () => {
    expect(allianceFor(schedule[0], 'frc254')).toBe('red');
    expect(allianceFor(schedule[1], '5940')).toBe('blue');
    expect(allianceFor(schedule[0], 'frc1')).toBeNull();
    expect(allianceFor(null, 'frc1')).toBeNull();
  });
});

describe('assignmentHref', () => {
  it('opens Match Scouting on the scout tab with match, team, alliance and event filled in', () => {
    const href = assignmentHref(
      { scouting_type: 'data', report_kind: 'robot', match_key: '2026cabl_qm12', team_key: 'frc5940' },
      'red'
    );
    const url = new URL(href, 'https://x.test');
    expect(url.pathname).toBe('/matchscout');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tab: 'robot',
      match: '12',
      team: '5940',
      alliance: 'red',
      event_key: '2026cabl'
    });
  });

  it('keeps playoff suffixes and sends note and quick assignments to their pages', () => {
    expect(assignmentHref({ scouting_type: 'data', match_key: '2026cabl_sf2m1', team_key: 'frc8' })).toContain(
      'match=sf2m1'
    );
    expect(assignmentHref({ scouting_type: 'note', match_key: '2026cabl_qm1', team_key: 'frc1' })).toBe('/notescout');
    expect(assignmentHref({ scouting_type: 'quick', match_key: '2026cabl_qm1', team_key: 'frc1' })).toBe('/quickscout');
  });
});

describe('openAssignments', () => {
  const rows = [
    { id: 'a', scouting_type: 'data', report_kind: 'performance', match_key: '2026cabl_sf2m1', team_key: 'frc8' },
    { id: 'b', scouting_type: 'data', report_kind: 'performance', match_key: '2026cabl_qm12', team_key: 'frc5940' },
    { id: 'c', scouting_type: 'data', report_kind: 'performance', match_key: '2026cabl_qm3', team_key: 'frc5940' },
    {
      id: 'd',
      scouting_type: 'data',
      report_kind: 'performance',
      match_key: '2026cabl_qm2',
      team_key: 'frc1',
      completed_at: '2026-10-01T00:00:00Z'
    }
  ];

  it('drops completed assignments and orders the rest the way matches are played', () => {
    expect(openAssignments(rows, schedule).map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('labels each one and flags a played match as overdue', () => {
    const [played, upcoming] = openAssignments(rows, schedule);
    expect(played).toMatchObject({
      role: 'Performance scout',
      matchLabel: 'Qual 3',
      team: '5940',
      alliance: 'blue',
      overdue: true
    });
    expect(upcoming).toMatchObject({ matchLabel: 'Qual 12', alliance: 'red', overdue: false, startsAtMs: 1000000 });
    expect(upcoming.href).toContain('tab=performance');
    expect(upcoming.href).toContain('alliance=red');
  });

  it('works without a schedule', () => {
    const [first] = openAssignments(rows, []);
    expect(first).toMatchObject({ alliance: null, overdue: false });
    expect(first.href).not.toContain('alliance=');
  });
});
