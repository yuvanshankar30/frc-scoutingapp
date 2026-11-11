import { describe, expect, it } from 'vitest';
import {
  BALL_COUNT_RANGES,
  RATING_FIELDS,
  normalizeMatchScoutEntry,
  normalizePowerRanking,
  sectionFields,
  normalizePitProblemReport,
  normalizeRatings,
  normalizeRankedTeamKey,
  normalizeTeamKey,
  requiresPitProblemReport,
  validatePitProblemHandoff
} from './matchScoutingSchema.js';

describe('normalizeRankedTeamKey', () => {
  it('accepts team numbers with an optional one-letter suffix, in TBA form', () => {
    expect(normalizeRankedTeamKey('frc4414B')).toBe('frc4414B');
    expect(normalizeRankedTeamKey(' 4414b ')).toBe('frc4414B');
    expect(normalizeRankedTeamKey('frc5940')).toBe('frc5940');
    for (const bad of ['', null, 'frc', 'abc', 'frc4414BB', '123456', 'frcB'])
      expect(normalizeRankedTeamKey(bad)).toBeNull();
  });
});

describe('normalizeTeamKey', () => {
  it('accepts the forms a scout or a query string actually supplies', () => {
    expect(normalizeTeamKey('5940')).toBe('frc5940');
    expect(normalizeTeamKey('frc5940')).toBe('frc5940');
    expect(normalizeTeamKey('  FRC5940 ')).toBe('frc5940');
  });

  it('rejects anything that is not a team number', () => {
    for (const bad of ['', null, undefined, 'frc', 'abc', 'frc97a', '123456', '-1']) {
      expect(normalizeTeamKey(bad)).toBeNull();
    }
  });
});

describe('normalizeRatings', () => {
  it('keeps only known fields, clamped to 1-5', () => {
    const ratings = normalizeRatings({
      'Shot accuracy': 3,
      Defense: 9,
      'Not a field': 5,
      Reliability: -2
    });
    expect(ratings).toEqual({ 'Shot accuracy': 3, Defense: 5 });
  });

  it('treats 0 as unrated rather than a score of zero', () => {
    expect(normalizeRatings(Object.fromEntries(RATING_FIELDS.map((f) => [f, 0])))).toEqual({});
  });

  it('tolerates junk', () => {
    expect(normalizeRatings(null)).toEqual({});
    expect(normalizeRatings([1, 2])).toEqual({});
    expect(normalizeRatings({ Defense: 'good' })).toEqual({});
  });
});

describe('normalizeMatchScoutEntry', () => {
  const base = { event_key: '2026casj', match_key: 'qm12', team_key: '5940' };

  it('requires the identifying keys', () => {
    expect(normalizeMatchScoutEntry({ ...base, event_key: '' }).error).toMatch(/event_key/);
    expect(normalizeMatchScoutEntry({ ...base, match_key: '' }).error).toMatch(/match_key/);
    expect(normalizeMatchScoutEntry({ ...base, team_key: 'nope' }).error).toMatch(/team_key/);
  });

  it('stores the canonical match key and keeps what the scout typed', () => {
    for (const typed of ['12', 'Quals 12', 'Q12', 'qm12', '2026casj_qm12']) {
      const { value } = normalizeMatchScoutEntry({ ...base, match_key: typed });
      expect(value).toMatchObject({ match_key: '2026casj_qm12', match_label: typed });
    }
    expect(normalizeMatchScoutEntry({ ...base, match_key: 'Finals 2' }).value.match_key).toBe('2026casj_f1m2');
  });

  it('refuses a match box it cannot read instead of storing free text', () => {
    expect(normalizeMatchScoutEntry({ ...base, match_key: 'einstein match 10' }).error).toMatch(/isn't a match number/);
    expect(normalizeMatchScoutEntry({ ...base, match_key: '6962' }).error).toMatch(/isn't a match number/);
  });

  it('normalizes a full submission and stamps the author', () => {
    const { value } = normalizeMatchScoutEntry(
      {
        ...base,
        alliance: 'blue',
        starting_position: 'center',
        auto_start_zone: 'wing',
        auto_points_estimate: '80-100',
        ball_sources: ['wing', 'wing', 'floor'],
        auto_collision: true,
        auto_collision_notes: 'Bumped 254 near center',
        ratings: { Defense: 4 },
        teleop_roles: ['Scoring', 'Defense', 'Defense', 'made-up role'],
        intake_speed: 2,
        intake_jammed: true,
        crash_or_break: true,
        card: 'yellow',
        beached: true,
        driver_skill: 4
      },
      'user-1'
    );
    expect(value.team_key).toBe('frc5940');
    expect(value.alliance).toBe('blue');
    expect(value.ball_sources).toEqual(['wing', 'floor']); // deduped
    expect(value.auto_points_band).toBe('80-100');
    expect(value.auto_points_min).toBe(80);
    expect(value.auto_points_max).toBe(100);
    expect(value.auto_points_average).toBe(90);
    expect(value.auto_collision).toBe(true);
    expect(value.auto_collision_notes).toBe('Bumped 254 near center');
    expect(value.teleop_roles).toEqual(['Scoring', 'Defense']);
    expect(value.intake_speed).toBe(2);
    expect(value.intake_jammed).toBe(true);
    expect(value.crash_or_break).toBe(true);
    expect(value.beached).toBe(true);
    expect(value.created_by).toBe('user-1');
  });

  it('drops values outside the known vocabularies rather than storing them', () => {
    // A renamed UI option should surface as missing data, not silently widen
    // the schema with a value nothing else understands.
    const { value } = normalizeMatchScoutEntry({
      ...base,
      alliance: 'green',
      starting_position: 'somewhere else',
      card: 'blue',
      ball_sources: ['wing', 'unknown-source']
    });
    expect(value.alliance).toBeNull();
    expect(value.starting_position).toBeNull();
    expect(value.card).toBeNull();
    expect(value.ball_sources).toEqual(['wing']);
  });

  it('rejects malformed point estimates rather than saving ambiguous text', () => {
    expect(normalizeMatchScoutEntry({ ...base, auto_points_estimate: 'a bunch' }).error).toMatch(/Auto points/);
    expect(normalizeMatchScoutEntry({ ...base, auto_points_estimate: '100-50' }).error).toMatch(/Auto points/);
  });

  it('keeps older point-band clients compatible while deriving an average', () => {
    const { value } = normalizeMatchScoutEntry({ ...base, auto_points_band: '6-10' });
    expect(value.auto_points_band).toBe('6-10');
    expect(value.auto_points_average).toBe(8);
  });

  it('clamps driver skill and treats junk as unrated', () => {
    expect(normalizeMatchScoutEntry({ ...base, driver_skill: 99 }).value.driver_skill).toBe(5);
    expect(normalizeMatchScoutEntry({ ...base, driver_skill: -3 }).value.driver_skill).toBe(0);
    expect(normalizeMatchScoutEntry({ ...base, driver_skill: 'great' }).value.driver_skill).toBeNull();
  });

  it('only accepts a literal true for crash_or_break', () => {
    expect(normalizeMatchScoutEntry({ ...base, crash_or_break: 'yes' }).value.crash_or_break).toBe(false);
    expect(normalizeMatchScoutEntry(base).value.crash_or_break).toBe(false);
  });

  it('clamps intake speed to the 1-3 scouting scale and defaults booleans safely', () => {
    expect(normalizeMatchScoutEntry({ ...base, intake_speed: 9 }).value.intake_speed).toBe(3);
    expect(normalizeMatchScoutEntry({ ...base, intake_speed: 0 }).value.intake_speed).toBe(1);
    expect(normalizeMatchScoutEntry({ ...base, intake_speed: 'fast' }).value.intake_speed).toBeNull();
    expect(normalizeMatchScoutEntry({ ...base, auto_collision: 'yes', intake_jammed: 'yes' }).value).toMatchObject({
      auto_collision: false,
      intake_jammed: false
    });
  });

  it('caps long free text instead of rejecting the whole report', () => {
    const { value } = normalizeMatchScoutEntry({ ...base, post_notes: 'x'.repeat(10_000) });
    expect(value.post_notes.length).toBe(4000);
  });
});

describe('pit problem handoff requirement', () => {
  it('requires a description when a robot is disabled or dies', () => {
    expect(requiresPitProblemReport('disabled')).toBe(true);
    expect(requiresPitProblemReport('died')).toBe(true);
    expect(validatePitProblemHandoff({ robot_disabled: 'disabled', pit_problem_summary: '' })).toMatch(/Describe/);
  });

  it('keeps notes and voluntary handoffs optional for an active robot', () => {
    expect(requiresPitProblemReport('no')).toBe(false);
    expect(validatePitProblemHandoff({ robot_disabled: 'no' })).toBeNull();
    expect(validatePitProblemHandoff({ robot_disabled: 'no', report_pit_problem: true })).toMatch(/Describe/);
  });
});

describe('normalizePitProblemReport', () => {
  const base = { event_key: '2026casj', team_key: '5940' };

  it('requires an event and a real team', () => {
    expect(normalizePitProblemReport({ ...base, event_key: '' }).error).toMatch(/event_key/);
    expect(normalizePitProblemReport({ ...base, team_key: '' }).error).toMatch(/team_key/);
  });

  it('falls back to a usable summary rather than storing an empty report', () => {
    expect(normalizePitProblemReport(base).value.summary).toBe('Mechanical issue flagged after match');
  });

  it('derives urgency from what was observed, overriding the client', () => {
    // A robot that died is urgent whatever the form submitted.
    for (const state of ['died', 'disabled']) {
      const { value } = normalizePitProblemReport({ ...base, robot_disabled: state, severity: 'watch' });
      expect(value.severity).toBe('urgent');
    }
  });

  it('honours a valid requested severity when nothing worse was observed', () => {
    expect(normalizePitProblemReport({ ...base, severity: 'urgent' }).value.severity).toBe('urgent');
    expect(normalizePitProblemReport({ ...base, severity: 'watch' }).value.severity).toBe('watch');
    expect(normalizePitProblemReport({ ...base, severity: 'catastrophic' }).value.severity).toBe('watch');
  });

  it('always creates the report unresolved and attributed', () => {
    const { value } = normalizePitProblemReport({ ...base, resolved: true }, 'user-9');
    expect(value.resolved).toBe(false);
    expect(value.created_by).toBe('user-9');
    expect(value.source).toBe('Match scout');
  });
});

describe('ball count estimate', () => {
  const base = { event_key: '2026casj', match_key: 'qm12', team_key: '5940' };

  it('stores the bucket alongside its parsed bounds', () => {
    const { value } = normalizeMatchScoutEntry({ ...base, balls_scored_band: '75-100' });
    expect(value.balls_scored_band).toBe('75-100');
    expect(value.balls_scored_min).toBe(75);
    expect(value.balls_scored_max).toBe(100);
    expect(value.balls_scored_average).toBe(87.5);
  });

  it('leaves the top bucket open-ended rather than inventing a ceiling', () => {
    const { value } = normalizeMatchScoutEntry({ ...base, balls_scored_band: '500+' });
    expect(value.balls_scored_min).toBe(500);
    expect(value.balls_scored_max).toBeNull();
    expect(value.balls_scored_average).toBe(500);
  });

  it('drops a value outside the bucket vocabulary instead of storing it', () => {
    // A free-typed or drifted client value is missing data, not a new bucket.
    for (const bad of ['0-30', '1000+', 'lots', '25', '']) {
      expect(normalizeMatchScoutEntry({ ...base, balls_scored_band: bad }).value.balls_scored_band).toBeNull();
    }
  });

  it('is optional and does not fail the report when absent', () => {
    const { value, error } = normalizeMatchScoutEntry(base);
    expect(error).toBeNull();
    expect(value.balls_scored_band).toBeNull();
    expect(value.balls_scored_average).toBeNull();
  });

  it('accepts every bucket the UI offers', () => {
    for (const range of BALL_COUNT_RANGES) {
      expect(normalizeMatchScoutEntry({ ...base, balls_scored_band: range }).value.balls_scored_band).toBe(range);
    }
  });
});

describe('normalizePowerRanking', () => {
  it('keeps distinct 1-6 ranks keyed by team and leaves unwatched robots out', () => {
    expect(normalizePowerRanking({ 254: 1, frc5940: 2, ' FRC1678 ': 3 })).toEqual({
      frc254: 1,
      frc5940: 2,
      frc1678: 3
    });
    expect(normalizePowerRanking({})).toEqual({});
  });

  it('keeps B teams (TBA keys like frc4414B) instead of dropping the whole ranking', () => {
    expect(
      normalizePowerRanking({ frc4414B: 1, frc9084b: 2, frc254: 3, ' FRC973B ': 4, frc1678: 5, frc5940: 6 })
    ).toEqual({
      frc4414B: 1,
      frc9084B: 2,
      frc254: 3,
      frc973B: 4,
      frc1678: 5,
      frc5940: 6
    });
    expect(normalizePowerRanking({ frc4414B: 1, frc4414b: 2 })).toEqual({});
    expect(normalizePowerRanking({ frc4414BB: 1 })).toEqual({});
  });

  it('drops the whole ranking rather than storing a duplicated or invalid rank', () => {
    for (const bad of [
      { frc254: 1, frc5940: 1 },
      { frc254: 0 },
      { frc254: 7 },
      { frc254: 1.5 },
      { abc: 1 },
      [1, 2],
      null,
      'frc254'
    ]) {
      expect(normalizePowerRanking(bad)).toEqual({});
    }
  });
});

describe('sectionFields', () => {
  it('stores shuttling answers only when the robot shuttled', () => {
    expect(
      sectionFields({ shuttled: true, shuttle_band: '25-50', shuttle_rating: 4, shuttle_notes: ' over the bump ' })
    ).toMatchObject({
      shuttled: true,
      shuttle_band: '25-50',
      shuttle_min: 25,
      shuttle_max: 50,
      shuttle_average: 37.5,
      shuttle_rating: 4,
      shuttle_notes: 'over the bump'
    });
    expect(sectionFields({ shuttled: false, shuttle_band: '25-50', shuttle_rating: 4 })).toMatchObject({
      shuttled: false,
      shuttle_band: null,
      shuttle_rating: null
    });
    expect(sectionFields({}).shuttled).toBeNull();
  });

  it('keeps 1-5 ratings and 0-50 foul counts, and treats blanks as unknown', () => {
    const value = sectionFields({
      offense_rating: 5,
      defense_rating: 0,
      fouls_minor: 2,
      fouls_major: '',
      break_details: ' intake chain '
    });
    expect(value).toMatchObject({
      offense_rating: 5,
      defense_rating: null,
      fouls_minor: 2,
      fouls_major: null,
      break_details: 'intake chain',
      break_impact: null
    });
    expect(sectionFields({ fouls_minor: 51, offense_rating: 6 })).toMatchObject({
      fouls_minor: null,
      offense_rating: null
    });
  });
});
