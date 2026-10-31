import { describe, it, expect } from 'vitest';
import {
  allianceOutlook,
  briefsByTeam,
  coverage,
  isPlayed,
  longLabel,
  reportsFor,
  shortLabel,
  sortMatches
} from './matchView.js';

const match = (level, set, number, extra = {}) => ({
  key: `2026cc_${level}${level === 'qm' ? '' : set + 'm'}${number}`,
  comp_level: level,
  set_number: set,
  match_number: number,
  alliances: {
    red: { team_keys: ['frc1', 'frc2', 'frc3'], score: -1 },
    blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: -1 }
  },
  ...extra
});
const entry = (matchKey, teamKey, balls, extra = {}) => ({
  id: matchKey + teamKey + balls,
  match_key: matchKey,
  team_key: teamKey,
  balls_scored_average: balls,
  auto_points_average: 10,
  created_at: '2026-09-20T10:00:00Z',
  ...extra
});

describe('labels and order', () => {
  it('names qualification and playoff matches', () => {
    expect(shortLabel(match('qm', 1, 12))).toBe('QM12');
    expect(shortLabel(match('sf', 2, 1))).toBe('SF2-1');
    expect(longLabel(match('qm', 1, 12))).toBe('Qualification 12');
    expect(longLabel(match('f', 1, 2))).toBe('Final 1 · Match 2');
  });
  it('orders qualifications before playoffs, by number', () => {
    const sorted = sortMatches([match('f', 1, 1), match('qm', 1, 10), match('qm', 1, 2), match('sf', 1, 1)]);
    expect(sorted.map(shortLabel)).toEqual(['QM2', 'QM10', 'SF1-1', 'F1-1']);
  });
  it('knows played from unplayed', () => {
    expect(isPlayed(match('qm', 1, 1))).toBe(false);
    expect(
      isPlayed(
        match('qm', 1, 1, { alliances: { red: { team_keys: [], score: 120 }, blue: { team_keys: [], score: 98 } } })
      )
    ).toBe(true);
  });
});

describe('reports and outlook', () => {
  const entries = [
    entry('2026cc_qm1', 'frc1', 100),
    entry('2026cc_qm2', 'frc1', 200),
    entry('2026cc_qm2', 'frc2', 50),
    entry('2026cc_qm2', 'frc1', 220, { created_at: '2026-09-20T11:00:00Z' })
  ];
  it('picks one team in one match, newest first', () => {
    const list = reportsFor(entries, '2026cc_qm2', 'frc1');
    expect(list.map((row) => row.balls_scored_average)).toEqual([220, 200]);
  });
  it('sums only the robots we know about', () => {
    const briefs = briefsByTeam(entries);
    const outlook = allianceOutlook(['frc1', 'frc2', 'frc3'], briefs);
    expect(outlook.known).toBe(2);
    expect(outlook.size).toBe(3);
    expect(outlook.balls).toBe(Math.round(briefs.get('frc1').avgBallsScored + briefs.get('frc2').avgBallsScored));
  });
  it('counts how many robots have a report for the match', () => {
    expect(coverage(match('qm', 1, 2, { key: '2026cc_qm2' }), entries)).toEqual({ reported: 2, total: 6 });
  });
});

import {
  ballSeries,
  eventCountsFor,
  humanizeKey,
  keyFigures,
  notesFor,
  officialByTeam,
  openProblemsFor,
  rankingPoints,
  tbaMatchUrl,
  winnerOf,
  youtubeLinks
} from './matchView.js';

describe('Blue Alliance match data', () => {
  const played = {
    key: '2026cc_qm1',
    comp_level: 'qm',
    match_number: 1,
    set_number: 1,
    winning_alliance: 'red',
    videos: [
      { type: 'youtube', key: 'abc123' },
      { type: 'tba', key: 'x' }
    ],
    alliances: { red: { team_keys: [], score: 120 }, blue: { team_keys: [], score: 98 } },
    score_breakdown: {
      red: { totalPoints: 120, autoPoints: 40, rp: 3, endgameStatus: 'Climbed', adjustPoints: 0, nested: { a: 1 } },
      blue: { totalPoints: 98, autoPoints: 30, rp: 1, endgameStatus: 'None', adjustPoints: 0 }
    }
  };
  it('links to videos and the match page', () => {
    expect(youtubeLinks(played)).toEqual(['https://www.youtube.com/watch?v=abc123']);
    expect(tbaMatchUrl('2026cc_qm1')).toBe('https://www.thebluealliance.com/match/2026cc_qm1');
  });
  it('names the winner and ranking points', () => {
    expect(winnerOf(played)).toBe('red');
    expect(winnerOf({ ...played, winning_alliance: '', alliances: { red: { score: 5 }, blue: { score: 5 } } })).toBe(
      'tie'
    );
    expect(winnerOf({ ...played, alliances: { red: { score: -1 }, blue: { score: -1 } } })).toBeNull();
    expect(rankingPoints(played, 'red')).toBe(3);
    expect(rankingPoints({}, 'red')).toBeNull();
  });
  it('pulls the points by phase and the bonuses earned', () => {
    const match = {
      score_breakdown: {
        red: {
          totalAutoPoints: 41,
          totalTeleopPoints: 257,
          totalTowerPoints: 12,
          foulPoints: 5,
          totalPoints: 303,
          energizedAchieved: true,
          superchargedAchieved: false
        },
        blue: {
          totalAutoPoints: 118,
          totalTeleopPoints: 553,
          totalTowerPoints: 0,
          foulPoints: 25,
          totalPoints: 696,
          energizedAchieved: true,
          superchargedAchieved: true
        }
      }
    };
    const { rows, bonuses } = keyFigures(match);
    expect(rows).toEqual([
      { label: 'Auto', red: 41, blue: 118 },
      { label: 'Teleop', red: 257, blue: 553 },
      { label: 'Endgame', red: 12, blue: 0 },
      { label: 'Fouls', red: 5, blue: 25 }
    ]);
    expect(bonuses).toEqual({ red: ['Energized'], blue: ['Energized', 'Supercharged'] });
    expect(keyFigures({}).rows).toEqual([]);
    expect(humanizeKey('teleopFuelCount')).toBe('Teleop Fuel Count');
  });
});

describe('extra scouting detail', () => {
  it('finds notes, event counts and open pit problems', () => {
    expect(
      notesFor(
        [
          { match_key: 'm', team_key: 't', notes: ' fast ' },
          { match_key: 'm', team_key: 't', notes: '  ' }
        ],
        'm',
        't'
      )
    ).toHaveLength(1);
    const counts = eventCountsFor(
      [
        { match_key: 'm', team_key: 't', event_type: 'fuel' },
        { match_key: 'm', team_key: 't', event_type: 'fuel' },
        { match_key: 'm', team_key: 't', event_type: 'climb' },
        { match_key: 'x', team_key: 't', event_type: 'fuel' }
      ],
      'm',
      't'
    );
    expect(counts).toEqual([
      { type: 'fuel', count: 2 },
      { type: 'climb', count: 1 }
    ]);
    expect(
      openProblemsFor(
        [
          { team_key: 't', resolved: false },
          { team_key: 't', resolved: true }
        ],
        't'
      )
    ).toHaveLength(1);
  });
  it('averages scouts on the same match into one balls-per-match series', () => {
    const series = ballSeries(
      [
        { team_key: 't', match_key: 'e_qm2', balls_scored_average: 100 },
        { team_key: 't', match_key: 'e_qm2', balls_scored_average: 200 },
        { team_key: 't', match_key: 'e_qm1', balls_scored_average: 50 },
        { team_key: 'u', match_key: 'e_qm1', balls_scored_average: 9 }
      ],
      't'
    );
    expect(series).toEqual([
      { number: 1, balls: 50 },
      { number: 2, balls: 150 }
    ]);
  });
  it('keys official rank, record and OPR by team', () => {
    const map = officialByTeam([
      { team: 5940, rank: 4, epa: 61.2, wins: 9, losses: 1, ties: 0 },
      { team: 254, rank: null, epa: null, wins: 0, losses: 0, ties: 0 }
    ]);
    expect(map.get('frc5940')).toEqual({ rank: 4, opr: 61.2, record: '9-1-0' });
    expect(map.get('frc254').record).toBeNull();
  });
});
