import { describe, expect, it } from 'vitest';
import {
  ELO_K,
  communityBreakdown,
  eloDelta,
  eventKeyFromMatchKey,
  eventModel,
  profileNames,
  publicMatch,
  requireActor
} from './predictionMarketV2.js';

const matches = [
  {
    key: '2026test_qm1',
    time: 2_000_000_000,
    alliances: {
      red: { team_keys: ['frc1', 'frc2', 'frc3'], score: 90 },
      blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: 60 }
    },
    winning_alliance: 'red'
  }
];

describe('prediction market v2 backend helpers', () => {
  it('uses the fixed K=32 confidence-weighted Elo formula', () => {
    expect(ELO_K).toBe(32);
    expect(eloDelta('red', 'red', 0.75)).toEqual({ probability: 0.75, delta: 8 });
    expect(eloDelta('blue', 'red', 0.75)).toEqual({ probability: 0.25, delta: -8 });
  });

  it('summarizes community picks and exposes the EPA model probability', () => {
    const picks = [
      { user_id: 'a', side: 'red' },
      { user_id: 'b', side: 'red' },
      { user_id: 'c', side: 'blue' }
    ];
    expect(communityBreakdown(picks)).toEqual({ red: 2, blue: 1, total: 3 });
    const probability = eventModel(matches).get('2026test_qm1');
    const row = publicMatch(matches[0], probability, picks, 'c');
    expect(row).toMatchObject({
      match_key: '2026test_qm1',
      red_teams: ['frc1', 'frc2', 'frc3'],
      blue_teams: ['frc4', 'frc5', 'frc6'],
      my_pick: 'blue',
      community_red_pct: 2 / 3,
      community_blue_pct: 1 / 3,
      status: 'upcoming'
    });
    expect(row.model_probability_red).toBeGreaterThan(0.5);
  });

  it('derives an event key from a TBA match key', () => {
    expect(eventKeyFromMatchKey('2026cc_qm42')).toBe('2026cc');
    expect(eventKeyFromMatchKey('not-a-match-key')).toBeNull();
  });

  it('requires an approved, non-banned user in requireActor and avoids exposing email in profileNames', async () => {
    const makeClient = (user, profile) => ({
      auth: { getUser: async () => ({ data: { user } }) },
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          in: async () => ({ data: profile ? [profile] : [], error: null }),
          maybeSingle: async () => ({ data: profile, error: null })
        };
        return q;
      }
    });

    expect(await requireActor(makeClient(null, null))).toBeNull();
    expect(
      await requireActor(
        makeClient({ id: 'u1' }, { id: 'u1', role: 'member', general_role: 'none', permissions: [], banned: false })
      )
    ).toBeNull();
    expect(
      await requireActor(
        makeClient(
          { id: 'u1' },
          { id: 'u1', role: 'admin', general_role: 'lead', permissions: ['CAN_SEE_ROUTES'], banned: true }
        )
      )
    ).toBeNull();
    expect(
      await requireActor(
        makeClient(
          { id: 'u1' },
          { id: 'u1', role: 'member', general_role: 'member', permissions: ['CAN_SEE_ROUTES'], banned: false }
        )
      )
    ).toEqual({ id: 'u1' });

    const names = await profileNames(makeClient(null, { id: 'u1', full_name: '', email: 'secret@example.test' }), [
      'u1'
    ]);
    expect(names.get('u1')).toBe('Scout');
  });
});
