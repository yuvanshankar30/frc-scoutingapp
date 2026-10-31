import { describe, expect, it } from 'vitest';
import {
  KIND_ONLY_FIELDS,
  MATCH_SCOUT_MEMBER_KEYS,
  REPORT_KIND_PHASES,
  defaultReportKind,
  isDataReport,
  reportKindOf,
  withoutOtherKindFields
} from './reportKinds.js';
import { summarizeMatchScoutEntries } from './scoutingStats.js';
import { normalizeMatchScoutEntry } from '../server/scouting/matchScoutingSchema.js';

describe('match scouting report kinds', () => {
  it('treats reports saved before the split as data reports', () => {
    expect(reportKindOf({})).toBe('data');
    expect(reportKindOf({ report_kind: 'robot' })).toBe('robot');
    expect(reportKindOf({ report_kind: 'nonsense' })).toBe('data');
    expect(isDataReport({ report_kind: 'performance' })).toBe(false);
  });

  it('starts a scout on the tab their role names', () => {
    expect(defaultReportKind(['Performance Scout Member'])).toBe('performance');
    expect(defaultReportKind(['robot scout member', 'Other'])).toBe('robot');
    expect(defaultReportKind(['Data Scout Lead'])).toBe('data');
    expect(defaultReportKind(null)).toBe('data');
    expect(MATCH_SCOUT_MEMBER_KEYS).toEqual(['data scout member', 'performance scout member', 'robot scout member']);
  });

  it('gives each tab its own stages, all starting at pre-match and ending at post-match', () => {
    expect(REPORT_KIND_PHASES.performance).toEqual(['prematch', 'performance', 'postmatch']);
    expect(REPORT_KIND_PHASES.robot).toEqual(['prematch', 'robot', 'postmatch']);
    expect(REPORT_KIND_PHASES.data).not.toContain('performance');
  });
});

describe('saving a performance or robot report', () => {
  const base = {
    event_key: '2026casj',
    match_key: 'qm12',
    team_key: '5940',
    form_version: 2,
    section_fields: 2,
    scout_name: 'Ada'
  };

  it('does not demand the data-scouting answers', () => {
    const { value, error } = normalizeMatchScoutEntry(
      { ...base, report_kind: 'performance', driver_skill: 4, offense_rating: 3 },
      'u1'
    );
    expect(error).toBeNull();
    expect(value).toMatchObject({
      report_kind: 'performance',
      driver_skill: 4,
      offense_rating: 3,
      preload: null,
      mechanical_break: null,
      crash_or_break: false
    });
  });

  it('still needs a scout name, and a robot report needs the mechanical break answer', () => {
    expect(normalizeMatchScoutEntry({ ...base, scout_name: '', report_kind: 'performance' }).error).toMatch(
      /scout name/
    );
    expect(normalizeMatchScoutEntry({ ...base, report_kind: 'robot' }).error).toMatch(/mechanical break/);
    expect(normalizeMatchScoutEntry({ ...base, report_kind: 'robot', mechanical_break: true }).value).toMatchObject({
      report_kind: 'robot',
      crash_or_break: true
    });
  });

  it('keeps an unanswered driver skill empty instead of a 0 rating', () => {
    expect(
      normalizeMatchScoutEntry({ ...base, report_kind: 'performance', driver_skill: null }).value.driver_skill
    ).toBeNull();
  });

  it('still validates a data report in full', () => {
    expect(normalizeMatchScoutEntry({ ...base, report_kind: 'data' }).error).toMatch(/preload/);
    expect(normalizeMatchScoutEntry({ ...base }).error).toMatch(/preload/);
  });
});

describe('fields that moved tabs (section_fields 3)', () => {
  const base = {
    event_key: '2026casj',
    match_key: 'qm12',
    team_key: '5940',
    form_version: 2,
    section_fields: 3,
    scout_name: 'Ada'
  };
  const data = {
    ...base,
    report_kind: 'data',
    preload: true,
    starting_position: 'center',
    teleop_roles: ['Scorer'],
    balls_scored_band: '40-60'
  };
  const ratings = { ratings: { 'Shot accuracy': 4 }, ratings_unknown: ['BPS'] };
  const condition = { significant_crash: false, teleop_robot_status: 'active' };

  it('saves a robot nobody marked missing as having shown up, and a No as a no-show with nothing else answered', () => {
    expect(normalizeMatchScoutEntry(data, 'u1').value.robot_present).toBe(true);
    const noShow = normalizeMatchScoutEntry({ ...base, report_kind: 'robot', robot_present: false }, 'u1');
    expect(noShow.error).toBeNull();
    expect(noShow.value.robot_present).toBe(false);
  });

  it('saves a data report without ratings, crash or robot status', () => {
    const { value, error } = normalizeMatchScoutEntry(data, 'u1');
    expect(error).toBeNull();
    expect(value).toMatchObject({
      ratings: {},
      significant_crash: null,
      teleop_robot_status: null,
      intake_speed: null,
      robot_disabled: null
    });
  });

  it('asks a performance report for shot accuracy and BPS, and keeps intake speed there', () => {
    expect(normalizeMatchScoutEntry({ ...base, report_kind: 'performance' }).error).toMatch(/Shot accuracy/);
    const { value, error } = normalizeMatchScoutEntry(
      { ...base, report_kind: 'performance', ...ratings, intake_speed: 3 },
      'u1'
    );
    expect(error).toBeNull();
    expect(value).toMatchObject({ ratings: { 'Shot accuracy': 4 }, ratings_unknown: ['BPS'], intake_speed: 3 });
  });

  it('asks a robot report for the crash and robot status, and keeps collisions and jams there', () => {
    const robot = { ...base, report_kind: 'robot', mechanical_break: false };
    expect(normalizeMatchScoutEntry(robot).error).toMatch(/significant crash/);
    expect(normalizeMatchScoutEntry({ ...robot, significant_crash: false }).error).toMatch(/robot status/);
    const { value, error } = normalizeMatchScoutEntry(
      {
        ...robot,
        ...condition,
        teleop_robot_status: 'dead',
        auto_collision: true,
        auto_collision_notes: 'hit the hub',
        intake_jammed: true
      },
      'u1'
    );
    expect(error).toBeNull();
    expect(value).toMatchObject({
      teleop_robot_status: 'dead',
      robot_disabled: 'died',
      auto_collision: true,
      auto_collision_notes: 'hit the hub',
      intake_jammed: true
    });
  });

  it('still saves performance and robot reports from a page on the older layout', () => {
    const older = { ...base, section_fields: 2 };
    expect(normalizeMatchScoutEntry({ ...older, report_kind: 'performance' }).error).toBeNull();
    expect(normalizeMatchScoutEntry({ ...older, report_kind: 'robot', mechanical_break: false }).error).toBeNull();
  });

  it('stores an unrated intake speed as empty, not as the slowest rating', () => {
    expect(
      normalizeMatchScoutEntry({ ...base, report_kind: 'performance', ...ratings, intake_speed: null }).value
        .intake_speed
    ).toBeNull();
  });
});

describe('match statistics with separate report kinds', () => {
  it('builds play stats from data reports only, but driver skill and breaks from every report', () => {
    const summary = summarizeMatchScoutEntries([
      { match_key: 'qm1', form_version: 2, report_kind: 'data', balls_scored_average: 20, driver_skill: 0 },
      { match_key: 'qm1', form_version: 2, report_kind: 'performance', driver_skill: 4 },
      {
        match_key: 'qm2',
        form_version: 2,
        report_kind: 'robot',
        teleop_robot_status: 'active',
        mechanical_break: true,
        crash_or_break: true
      }
    ]);
    expect(summary).toMatchObject({
      reportCount: 1,
      matchesScouted: 1,
      avgBallsScored: 20,
      avgDriverSkill: 4,
      timesBroken: 1,
      incidentRate: 1
    });
  });

  it('reads ratings and intake speed from performance reports, and collisions from robot reports', () => {
    const summary = summarizeMatchScoutEntries([
      {
        match_key: 'qm1',
        form_version: 2,
        report_kind: 'data',
        balls_scored_average: 20,
        auto_collision: false,
        intake_jammed: false
      },
      {
        match_key: 'qm1',
        form_version: 2,
        report_kind: 'performance',
        ratings: { 'Shot accuracy': 4, BPS: 2 },
        intake_speed: 3
      },
      { match_key: 'qm1', form_version: 2, report_kind: 'robot', teleop_robot_status: 'active', auto_collision: true },
      { match_key: 'qm2', form_version: 2, report_kind: 'robot', teleop_robot_status: 'active', auto_collision: false }
    ]);
    expect(summary.ratingAverages['Shot accuracy']).toBe(4);
    expect(summary.ratingAverages.BPS).toBe(2);
    expect(summary.avgIntakeSpeed).toBe(3);
    // The data report's default "no collision" is not an answer, so only the two robot reports count.
    expect(summary.collisionRate).toBe(0.5);
    expect(summary.incidentRate).toBe(0);
  });

  it('still counts the condition answers on data reports saved before the move', () => {
    const summary = summarizeMatchScoutEntries([
      {
        match_key: 'qm1',
        form_version: 2,
        report_kind: 'data',
        teleop_robot_status: 'active',
        auto_collision: true,
        ratings: { BPS: 3 }
      },
      { match_key: 'qm2', form_version: 1, auto_collision: false, intake_jammed: true }
    ]);
    expect(summary).toMatchObject({ collisionRate: 0.5, incidentRate: 0.5 });
    expect(summary.ratingAverages.BPS).toBe(3);
  });
});

describe('withoutOtherKindFields', () => {
  it("clears answers that belong to another kind and keeps the kind's own", () => {
    const report = {
      report_kind: 'performance',
      starting_position: 'center',
      preload: true,
      offense_rating: 4,
      fouls_minor: 2,
      intake_speed: 2
    };
    expect(withoutOtherKindFields(report)).toEqual({
      report_kind: 'performance',
      starting_position: null,
      preload: null,
      offense_rating: 4,
      fouls_minor: null,
      intake_speed: 2
    });
  });

  it('treats a report with no kind as data and lists each field under one kind only', () => {
    expect(withoutOtherKindFields({ starting_position: 'left', break_details: 'x' })).toEqual({
      starting_position: 'left',
      break_details: null
    });
    const all = Object.values(KIND_ONLY_FIELDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
