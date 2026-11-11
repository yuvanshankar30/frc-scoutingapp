import { describe, expect, it } from 'vitest';
import { describeActivity, filterActivity, subjectOf } from './activityLog.js';

const names = new Map([['u1', 'Riley']]);

describe('activity log', () => {
  it('names the record a row is about', () => {
    expect(subjectOf({ new_data: { team_key: 'frc254', match_key: '2026cc_qm12' } })).toBe('team 254, QM12');
    expect(subjectOf({ old_data: { name: 'Pit lead' } })).toBe('Pit lead');
    expect(subjectOf({ new_data: { event_key: '2026cc' } })).toBe('2026CC');
  });

  it('describes a change with the actor and only meaningful, non-private fields', () => {
    const entry = describeActivity(
      {
        id: 9,
        table_name: 'user_profiles',
        operation: 'UPDATE',
        actor: 'u1',
        changed_columns: ['access_role_id', 'updated_at', 'email'],
        old_data: { full_name: 'Sam', access_role_id: null, email: 'a@b.c' },
        new_data: { full_name: 'Sam', access_role_id: 'r1', email: 'x@y.z' },
        created_at: '2026-11-10T00:00:00Z'
      },
      names
    );
    expect(entry).toMatchObject({ area: 'People', verb: 'Changed', subject: 'Sam', actor: 'Riley' });
    expect(entry.changes).toEqual([{ field: 'access role id', from: '—', to: 'r1' }]);
  });

  it('falls back for unknown actors and tables', () => {
    expect(describeActivity({ table_name: 'odd_table', operation: 'INSERT', actor: null }).actor).toBe('The system');
    expect(describeActivity({ table_name: 'odd_table', operation: 'INSERT', actor: 'gone' }, names).actor).toMatch(
      /removed/
    );
  });

  it('filters by who, what and fields', () => {
    const entries = [
      describeActivity(
        { table_name: 'scouting_picklist', operation: 'UPDATE', actor: 'u1', new_data: { team_key: 'frc254' } },
        names
      ),
      describeActivity(
        { table_name: 'access_roles', operation: 'INSERT', actor: null, new_data: { name: 'Drive' } },
        names
      )
    ];
    expect(filterActivity(entries, 'riley').map((e) => e.area)).toEqual(['Picklist']);
    expect(filterActivity(entries, 'roles').map((e) => e.subject)).toEqual(['Drive']);
    expect(filterActivity(entries, '')).toHaveLength(2);
  });
});
