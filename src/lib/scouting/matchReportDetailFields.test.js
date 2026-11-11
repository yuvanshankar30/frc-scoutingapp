// defense details on Data, every Performance answer required with the BPS slider, and robot status per shift,
// break details and foul nature on Robot. Older section_fields keep their old rules so queued reports still save.
import { describe, expect, it } from 'vitest';
import {
  bpsBucket,
  normalizeDefense,
  overallRobotStatus,
  validateMatchScoutForm,
  validatePerformanceRatings,
  validateRobotCondition
} from './matchScouting.js';
import { defenseSummary } from './defenseStats.js';
import { normalizeMatchScoutEntry } from '$lib/server/scouting/matchScoutingSchema.js';
import { buildExportTable } from '$lib/server/scouting/readableExport.js';

const dataBase = {
  scout_name: 'Sam',
  preload: true,
  teleop_roles: ['Defense'],
  balls_scored_band: '10',
  section_fields: 4
};
const defense = { targets: ['frc254'], periods: ['inactive'], shifts: ['shift2'], effectiveness: 7 };
const allShifts = { shift1: 'active', shift2: 'active', shift3: 'dead', shift4: 'dead', endgame: 'dead' };

describe('Data scouting defense', () => {
  it('asks who, when and how well once Defense is picked, then a description', () => {
    expect(validateMatchScoutForm(dataBase)).toMatch(/robots it defended/);
    expect(validateMatchScoutForm({ ...dataBase, defense: { ...defense, periods: [] } })).toMatch(/active or inactive/);
    expect(validateMatchScoutForm({ ...dataBase, defense: { ...defense, shifts: [] } })).toMatch(/shifts/);
    expect(validateMatchScoutForm({ ...dataBase, defense: { ...defense, effectiveness: 11 } })).toMatch(/1 to 10/);
    expect(validateMatchScoutForm({ ...dataBase, defense })).toMatch(/Describe the defense/);
    expect(validateMatchScoutForm({ ...dataBase, defense, teleop_notes: 'Pinned 254 at the hub' })).toBeNull();
  });

  it('leaves robots that did not defend, and older pages, alone', () => {
    expect(validateMatchScoutForm({ ...dataBase, teleop_roles: ['Scorer'] })).toBeNull();
    expect(validateMatchScoutForm({ ...dataBase, section_fields: 3 })).toBeNull();
  });

  it('drops unknown values when cleaning', () => {
    expect(
      normalizeDefense({ targets: ['frc254', 'nope'], periods: ['active', 'x'], shifts: ['endgame', 'shift9'] })
    ).toEqual({ targets: ['frc254'], periods: ['active'], shifts: ['endgame'], effectiveness: null });
    expect(normalizeDefense({})).toBeNull();
  });
});

describe('Performance scouting', () => {
  const full = {
    section_fields: 4,
    ratings: { 'Shot accuracy': 4 },
    bps: 0,
    intake_speed: 2,
    driver_skill: 3,
    power_ranking: { frc5940: 1 },
    performance_notes: 'Fast cycles'
  };
  it('requires every answer, and a BPS of 0 counts as set', () => {
    expect(validatePerformanceRatings(full)).toBeNull();
    expect(validatePerformanceRatings({ ...full, bps: null })).toMatch(/slider/);
    expect(validatePerformanceRatings({ ...full, intake_speed: null })).toMatch(/intake/);
    expect(validatePerformanceRatings({ ...full, driver_skill: null })).toMatch(/driver/);
    expect(validatePerformanceRatings({ ...full, power_ranking: {} })).toMatch(/Rank/);
    expect(validatePerformanceRatings({ ...full, performance_notes: ' ' })).toMatch(/notes/);
  });
  it('buckets the slider into the older 1-5 BPS band', () => {
    expect([0, 5, 6, 10, 15, 25, 31].map(bpsBucket)).toEqual([1, 1, 2, 2, 3, 4, 5]);
    expect(bpsBucket(null)).toBe(0);
  });
});

describe('Robot scouting', () => {
  const base = { section_fields: 4, significant_crash: false, robot_status_shifts: allShifts };
  it('needs a status for every shift and keeps the worst one', () => {
    expect(validateRobotCondition(base)).toBeNull();
    expect(validateRobotCondition({ ...base, robot_status_shifts: { shift1: 'active' } })).toMatch(/Shift 2/);
    expect(overallRobotStatus(allShifts)).toBe('dead');
    expect(overallRobotStatus({ shift1: 'stopped', shift2: 'active' })).toBe('stopped');
  });
  it('requires what broke, and the nature of any foul', () => {
    expect(validateRobotCondition({ ...base, mechanical_break: true })).toMatch(/what broke/);
    expect(validateRobotCondition({ ...base, fouls_minor: 1 })).toMatch(/nature/);
    expect(validateRobotCondition({ ...base, fouls_major: 1, foul_nature: 'Other' })).toMatch(/Describe/);
    expect(validateRobotCondition({ ...base, fouls_minor: 2, foul_nature: 'Contact / pinning' })).toBeNull();
  });
});

describe('saving and exporting', () => {
  const save = (body) =>
    normalizeMatchScoutEntry({
      form_version: 2,
      event_key: '2026cc',
      match_key: '12',
      team_key: '5940',
      starting_position: 'center',
      ...body
    });

  it('stores the new answers on their own kind only', () => {
    const data = save({ ...dataBase, defense, teleop_notes: 'Pinned', report_kind: 'data' });
    expect(data.error).toBeNull();
    expect(data.value.defense).toEqual(defense);
    expect(data.value.bps).toBeNull();

    const robot = save({
      ...dataBase,
      report_kind: 'robot',
      significant_crash: false,
      mechanical_break: false,
      robot_status_shifts: allShifts,
      fouls_minor: 1,
      foul_nature: 'Field damage'
    });
    expect(robot.error).toBeNull();
    expect(robot.value.teleop_robot_status).toBe('dead');
    expect(robot.value.robot_status_shifts).toEqual(allShifts);
    expect(robot.value.foul_nature).toBe('Field damage');
    expect(robot.value.defense).toBeNull();

    const performance = save({
      scout_name: 'Sam',
      report_kind: 'performance',
      section_fields: 4,
      ratings: { 'Shot accuracy': 4 },
      bps: 22,
      intake_speed: 2,
      driver_skill: 3,
      power_ranking: { frc5940: 1 },
      performance_notes: 'Fast'
    });
    expect(performance.error).toBeNull();
    expect(performance.value.bps).toBe(22);
    expect(performance.value.ratings.BPS).toBe(4);
  });

  it('measures defense from both sides and puts it in the export', () => {
    const rows = [
      // 254 usually scores 100; in qm2, defended by 5940 (rated 8), it scored 40.
      { report_kind: 'data', match_key: 'qm1', team_key: 'frc254', balls_scored_average: 100 },
      { report_kind: 'data', match_key: 'qm2', team_key: 'frc254', balls_scored_average: 40 },
      {
        report_kind: 'data',
        match_key: 'qm2',
        team_key: 'frc5940',
        balls_scored_average: 5,
        teleop_roles: ['Defense'],
        defense: { ...defense, effectiveness: 8 }
      }
    ];
    const summary = Object.fromEntries(defenseSummary(rows).map((row) => [row.team_key, row]));
    expect(summary.frc5940).toMatchObject({ played: 1, playedRating: 8, impact: 60 });
    expect(summary.frc254).toMatchObject({ faced: 1, resistance: 2, keptShare: 40 });

    const table = buildExportTable({ matchEntries: rows });
    const headers = table.columns.map((column) => column.header);
    expect(headers).toContain('Defended against');
    expect(headers).toContain('Defense effectiveness (1-10)');
    const team5940 = table.teams.find((row) => row.team === 5940);
    expect(team5940.defensePlayed).toBe(8);
  });
});
