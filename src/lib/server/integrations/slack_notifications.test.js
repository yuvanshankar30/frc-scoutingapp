import { describe, expect, it } from 'vitest';
import { scoutingTypeLabel } from './slack_notifications.js';

describe('scoutingTypeLabel', () => {
  it('names the report the scout files, from their role, for match scouting assignments', () => {
    expect(scoutingTypeLabel('data', 'performance')).toBe('performance');
    expect(scoutingTypeLabel('data', 'robot')).toBe('robot');
    expect(scoutingTypeLabel('data', 'data')).toBe('data');
  });

  it('says data when the role is unknown, and keeps note and quick scouting as they are', () => {
    expect(scoutingTypeLabel('data')).toBe('data');
    expect(scoutingTypeLabel('note', 'performance')).toBe('note');
    expect(scoutingTypeLabel('quick')).toBe('quick');
  });
});
