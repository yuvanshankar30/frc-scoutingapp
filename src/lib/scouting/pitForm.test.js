import { describe, expect, it } from 'vitest';
import {
  emptyTechnicalDetails,
  hasAnyPitData,
  normalizeAutoOptions,
  normalizeClimbOptions,
  normalizeTechnicalDetails,
  pitScoutStatus
} from './pitForm.js';

describe('pit form', () => {
  it('keeps every technical detail when a saved report is read back, including trench/bump, hopper capacity and the pit phone', () => {
    const saved = {
      trench_or_bump: 'Both',
      hopper_capacity: '42',
      pit_contact_phone: ' 555-0100 ',
      motor_types: ['CIM', 'X60', 'nope'],
      electrical_rating: 11,
      can_bus_count: '2.6'
    };
    const clean = normalizeTechnicalDetails(saved);
    expect(clean.trench_or_bump).toBe('Both');
    expect(clean.hopper_capacity).toBe(42);
    expect(clean.pit_contact_phone).toBe('555-0100');
    expect(clean.motor_types).toEqual(['X60', 'CIM']);
    expect(clean.electrical_rating).toBeUndefined();
    expect(clean.can_bus_count).toBe(3);
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
