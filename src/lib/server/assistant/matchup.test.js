import { describe, expect, it } from 'vitest';
import { allianceTotals, matchupOdds, normalCdf, roleHints, spreadOf, watchList, winProbability } from './matchup.js';
import { findByName, normalizeName, pickTeam } from './teamNames.js';

const team = (n, balls, extra = {}) => ({
  team: String(n),
  balls,
  ballSeries: [balls - 5, balls, balls + 5],
  auto: 10,
  incidentRate: 0,
  opr: null,
  matches: 6,
  ...extra
});

describe('win probability', () => {
  it('is 50% when even, rises with the gap, and is symmetric', () => {
    expect(winProbability(100, 20, 100, 20)).toBeCloseTo(0.5);
    expect(winProbability(120, 20, 100, 20)).toBeGreaterThan(0.7);
    expect(winProbability(140, 20, 100, 20)).toBeGreaterThan(winProbability(120, 20, 100, 20));
    expect(winProbability(120, 20, 100, 20) + winProbability(100, 20, 120, 20)).toBeCloseTo(1);
    expect(winProbability(5, 0, 3, 0)).toBe(1);
    expect(normalCdf(0)).toBeCloseTo(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
  });
  it('treats a team with few matches as more uncertain', () => {
    expect(spreadOf([50, 52, 48], 50)).toBeLessThan(spreadOf([50], 50));
    expect(spreadOf([50, 50, 50], 50)).toBe(5);
  });
});

describe('alliance totals and odds', () => {
  it('adds scouted scoring and takes breakdowns off for the cautious figure', () => {
    const totals = allianceTotals([team(1, 40), team(2, 30, { incidentRate: 0.5 })]);
    expect(totals.mean).toBe(70);
    expect(totals.riskAdjusted).toBe(55);
    expect(totals.teamsWithData).toBe(2);
  });
  it('blends scouting and OPR and labels confidence by the thinnest sample', () => {
    const strong = [team(1, 60, { opr: 90 }), team(2, 50, { opr: 80 })];
    const weak = [team(3, 30, { opr: 40 }), team(4, 25, { opr: 35 })];
    const odds = matchupOdds(strong, weak);
    expect(Object.keys(odds.win_chance_percent.by_method)).toEqual(['scouting', 'scouting_with_breakdowns', 'opr']);
    expect(odds.win_chance_percent.central).toBeGreaterThan(90);
    expect(odds.confidence).toBe('high');
    expect(odds.win_chance_percent.high).toBeLessThanOrEqual(97);
    expect(matchupOdds([team(3, 30)], [team(1, 90)]).win_chance_percent.low).toBeGreaterThanOrEqual(3);
    expect(matchupOdds([team(1, 60, { matches: 2 })], [team(3, 30)]).confidence).toBe('low');
    expect(matchupOdds([team(1, 60, { matches: 4 })], [team(3, 30)]).confidence).toBe('medium');
    expect(matchupOdds([team(1, null, { balls: null })], [team(3, 30)]).win_chance_percent).toBeNull();
  });
});

describe('roles and watch list', () => {
  it('makes the top scorer the main scorer and gives the rest a data-based role', () => {
    const hints = roleHints([
      team(1, 30, { shuttlingRate: 0 }),
      team(2, 20, { shuttlingRate: 0.6 }),
      team(3, 15, { defense: 4 }),
      team(4, null, { balls: null })
    ]);
    expect(hints.map((h) => [h.team, h.role])).toEqual([
      ['1', 'main scorer'],
      ['2', 'shuttler'],
      ['3', 'defender'],
      ['4', 'unknown']
    ]);
  });
  it('points out the opposing robots to plan around', () => {
    const list = watchList([team(1, 20, { auto: 5, incidentRate: 0.4 }), team(2, 35, { auto: 40, incidentRate: 0 })]);
    expect(list).toEqual([
      { team: '2', why: 'biggest scorer' },
      { team: '2', why: 'strongest auto' },
      { team: '1', why: 'breaks down most often' }
    ]);
  });
});

describe('team name matching', () => {
  const dir = [
    ['frc1678', 'Citrus Circuits', true],
    ['frc9999', 'Cyber Circuits', true],
    ['frc254', 'The Cheesy Poofs', true],
    ['frc4276', 'HighTide', false],
    ['frc77', 'Cit', false]
  ].map(([key, nickname, inEvent]) => ({
    key,
    number: Number(key.slice(3)),
    nickname,
    inEvent,
    norm: normalizeName(nickname)
  }));
  it('ignores case, spaces and punctuation', () => {
    expect(normalizeName('High Tide!')).toBe('hightide');
    expect(normalizeName('Team Cheesy-Poofs')).toBe('cheesypoofs');
  });
  it('ranks exact, then prefix, then substring, and keeps ambiguity honest', () => {
    expect(findByName(dir, 'high tide')[0].key).toBe('frc4276');
    expect(findByName(dir, 'citrus')[0].key).toBe('frc1678');
    expect(pickTeam(findByName(dir, 'circuits'))).toBeNull();
    expect(pickTeam(findByName(dir, 'cheesy poofs')).key).toBe('frc254');
    expect(findByName(dir, 'ab')).toEqual([]);
  });
  it('prefers a team that has scouting data when several match', () => {
    const twins = [
      { key: 'frc1', number: 1, nickname: 'Robo Stars', inEvent: false, norm: 'robostars' },
      { key: 'frc2', number: 2, nickname: 'Robo Stars', inEvent: false, norm: 'robostars' }
    ];
    expect(pickTeam(findByName(twins, 'robo stars'))).toBeNull();
    expect(pickTeam(findByName(twins, 'robo stars', new Set(['frc2']))).key).toBe('frc2');
  });
});
