import { describe, expect, it } from 'vitest';
import { resolveScoutedBy, scoutDisplayName } from './scoutIdentity.js';

const profiles = [
  { id: 'me', full_name: 'Avery Lee' },
  { id: 'friend', full_name: 'Sam Ortiz' },
  { id: 'twin1', full_name: 'Jordan Kim' },
  { id: 'twin2', full_name: 'jordan kim' }
];
const db = {
  from: () => ({
    select: () => ({
      ilike: async (_col, pattern) => ({
        data: profiles.filter((row) => row.full_name.toLowerCase() === pattern.toLowerCase()),
        error: null
      })
    })
  })
};

describe('resolveScoutedBy', () => {
  it('is the submitter when the typed name is theirs or blank', async () => {
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'Avery Lee', scoutName: ' avery  lee ' })).toBe('me');
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'Avery Lee', scoutName: '' })).toBe('me');
  });

  it('is the other scout when someone scouted on a shared phone', async () => {
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'Avery Lee', scoutName: 'Sam Ortiz' })).toBe(
      'friend'
    );
  });

  it('is the submitter whose profile name is still an email', async () => {
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'avery@example.com', scoutName: 'Avery L' })).toBe(
      'me'
    );
  });

  it('stays unknown for free text or an ambiguous name', async () => {
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'Avery Lee', scoutName: 'Coach' })).toBeNull();
    expect(await resolveScoutedBy(db, { actorId: 'me', actorName: 'Avery Lee', scoutName: 'Jordan Kim' })).toBeNull();
  });
});

describe('scoutDisplayName', () => {
  const byId = new Map([
    ['me', { full_name: 'Avery Lee' }],
    ['mail', { full_name: 'x@example.com', email: 'x@example.com' }]
  ]);
  it('prefers the linked profile, then the typed name, then the submitter', () => {
    expect(scoutDisplayName({ scouted_by: 'me', scout_name: 'Av' }, byId)).toBe('Avery Lee');
    expect(scoutDisplayName({ scouted_by: 'mail', scout_name: 'Xavier' }, byId)).toBe('Xavier');
    expect(scoutDisplayName({ scouted_by: null, scout_name: '', created_by: 'me' }, byId)).toBe('Avery Lee');
  });
});
