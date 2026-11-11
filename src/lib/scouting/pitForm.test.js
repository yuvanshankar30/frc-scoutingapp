import { describe, expect, it } from 'vitest';
import {
  HOPPER_OPTIONS,
  SHOOTER_OPTIONS,
  MAX_WEAKNESSES_LENGTH,
  PIT_ABILITIES,
  dialablePhone,
  emptyTechnicalDetails,
  hasAnyPitData,
  normalizeAutoOptions,
  normalizeClimbOptions,
  normalizeTechnicalDetails,
  pitScoutStatus,
  weightedAbilityScore
} from './pitForm.js';

describe('pit form', () => {
  it('keeps every technical detail when a saved report is read back, including trench/bump, hopper capacity and the pit phone', () => {
    const saved = {
      trench_or_bump: 'Both',
      hopper_capacity: '42',
      pit_contact_phone: ' 555-0100 ',
      motor_types: ['CIM', 'X60', 'nope'],
      electrical_rating: 11,
      can_bus_count: ' 2 '
    };
    const clean = normalizeTechnicalDetails(saved);
    expect(clean.trench_or_bump).toBe('Both');
    expect(clean.hopper_capacity).toBe(42);
    expect(clean.pit_contact_phone).toBe('555-0100');
    expect(clean.motor_types).toEqual(['X60', 'CIM']);
    expect(clean.electrical_rating).toBeUndefined();
    expect(clean.can_bus_count).toBe('2');
    expect(normalizeTechnicalDetails({}, { emptyNumber: null }).drivetrain_width).toBeNull();
    expect(Object.keys(emptyTechnicalDetails())).toEqual(Object.keys(clean));
  });

  it('reads climbs and autos the way the form saves them', () => {
    expect(normalizeClimbOptions(['L2', 'L1', 'bogus'])).toEqual(['L1', 'L2']);
    expect(normalizeClimbOptions(['L2', 'No Climb'])).toEqual(['No Climb']);
    expect(
      normalizeAutoOptions([
        {
          name: ' Trench ',
          description: 'x',
          path: [
            [-5, 50],
            [120, 3],
            ['a', 1]
          ]
        }
      ])
    ).toEqual([
      {
        name: 'Trench',
        description: 'x',
        path: [
          [0, 50],
          [100, 3]
        ]
      }
    ]);
  });

  it('calls a report pending, needs photo or completed', () => {
    expect(pitScoutStatus(null)).toBe('pending');
    expect(hasAnyPitData({ additional_notes: '  ' })).toBe(false);
    expect(pitScoutStatus({ technical_details: { use_net: 'Yes' } })).toBe('needs_photo');
    expect(pitScoutStatus({ drivebase_type: 'Swerve', photo_paths: ['a.jpg'] })).toBe('completed');
  });
});

describe('pit redesign fields', () => {
  it('keeps strengths, weaknesses, preferred roles and ability ratings in technical details', () => {
    const clean = normalizeTechnicalDetails({
      strengths: '  fast cycles  ',
      weaknesses: 'x'.repeat(900),
      preferred_roles: ['Defense', 'Nope', 'Shooter'],
      ability_shooting: '8',
      ability_defense: 11,
      ability_auto: 0
    });
    expect(clean.strengths).toBe('fast cycles');
    expect(clean.weaknesses).toHaveLength(MAX_WEAKNESSES_LENGTH);
    expect(clean.preferred_roles).toEqual(['Shooter', 'Defense']);
    expect(clean.ability_shooting).toBe(8);
    expect(clean.ability_defense).toBeUndefined();
    expect(clean.ability_auto).toBeUndefined();
  });

  it('weights the rated abilities and leaves unrated ones out', () => {
    expect(weightedAbilityScore({})).toEqual({ score: null, rated: 0, total: PIT_ABILITIES.length });
    const weight = (key) => PIT_ABILITIES.find((ability) => ability.key === key).weight;
    const expected =
      (10 * weight('ability_shooting') + 4 * weight('ability_defense')) /
      (weight('ability_shooting') + weight('ability_defense'));
    const result = weightedAbilityScore({ ability_shooting: 10, ability_defense: 4, ability_auto: 'junk' });
    expect(result.rated).toBe(2);
    expect(result.score).toBe(Math.round(expected * 10) / 10);
    // Every ability rated the same gives that rating back, whatever the weights.
    expect(weightedAbilityScore(Object.fromEntries(PIT_ABILITIES.map(({ key }) => [key, 7]))).score).toBe(7);
  });

  it('gives every ability a distinct key and a positive weight, with shooting weighted most', () => {
    expect(new Set(PIT_ABILITIES.map((ability) => ability.key)).size).toBe(PIT_ABILITIES.length);
    expect(PIT_ABILITIES.every((ability) => ability.weight > 0)).toBe(true);
    expect(Math.max(...PIT_ABILITIES.map((ability) => ability.weight))).toBe(
      PIT_ABILITIES.find((ability) => ability.key === 'ability_shooting').weight
    );
  });

  it('counts a report with only the new answers as started', () => {
    expect(hasAnyPitData({ technical_details: { strengths: 'Great driver' } })).toBe(true);
    expect(hasAnyPitData({ technical_details: { preferred_roles: ['Shuttler'] } })).toBe(true);
  });
});

describe('strat phone and reliability', () => {
  it('keeps the strat phone apart from the pit contact phone', () => {
    const clean = normalizeTechnicalDetails({ pit_contact_phone: '555-0100', strat_phone: ' (555) 010-0200 ' });
    expect(clean.pit_contact_phone).toBe('555-0100');
    expect(clean.strat_phone).toBe('(555) 010-0200');
    expect(normalizeTechnicalDetails({ pit_contact_phone: '555-0100' }).strat_phone).toBe('');
  });

  it('turns a phone answer into a dialable target', () => {
    expect(dialablePhone('+1 (555) 010-0200')).toBe('+15550100200');
    expect(dialablePhone(undefined)).toBe('');
  });

  it('rates reliability on the answer Power Rankings reads', () => {
    expect(PIT_ABILITIES.map((ability) => ability.key)).toContain('overall_reliability_rating');
    expect(weightedAbilityScore({ overall_reliability_rating: 4 })).toMatchObject({ score: 4, rated: 1 });
  });
  it('keeps CANivores, CAN buses and robot weight as free text', () => {
    const clean = normalizeTechnicalDetails({ canivore_count: ' 2 ', can_bus_count: 3, robot_weight: '  112 lb  ' });
    expect(clean.canivore_count).toBe('2');
    // A number saved before V4.46.0 reads back as text.
    expect(clean.can_bus_count).toBe('3');
    expect(clean.robot_weight).toBe('112 lb');
    expect(normalizeTechnicalDetails({ robot_weight: 'x'.repeat(80) }).robot_weight).toHaveLength(40);
  });
  it('offers No Shooter and No Indexer first', () => {
    expect(SHOOTER_OPTIONS[0]).toBe('No Shooter');
    expect(HOPPER_OPTIONS[0]).toBe('No Indexer');
  });
});
