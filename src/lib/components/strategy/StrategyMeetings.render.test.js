import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import StrategyMeetings from './StrategyMeetings.svelte';

const US = 'frc5940';
const START = 4_000_000_000; // far in the future, so no step has gone by yet
const match = (n, red) => ({
  key: `2026tst_qm${n}`,
  comp_level: 'qm',
  match_number: n,
  predicted_time: START + n * 600,
  alliances: {
    red: { team_keys: red || [`frc${n}1`, `frc${n}2`, `frc${n}3`] },
    blue: { team_keys: [`frc${n}4`, `frc${n}5`, `frc${n}6`] }
  }
});

describe('StrategyMeetings', () => {
  it('shows each step for our next match and the partners with a text link when pit scouting has a phone', () => {
    const matches = Array.from({ length: 20 }, (_, i) => match(i + 1, i + 1 === 15 ? [US, 'frc254', 'frc1678'] : null));
    const { body } = render(StrategyMeetings, {
      props: { matches, teamKey: US, phoneByTeam: new Map([['frc254', '(555) 010-0254']]), nameByTeam: new Map() }
    });
    expect(body).toContain('Set a meeting time');
    expect(body).toContain('Strategy meeting');
    expect(body).toContain('Send our strategy to the pit crew');
    expect(body).toContain('Tell the drive coach');
    expect(body).toContain('href="sms:5550100254"');
    expect(body).toContain('No strat phone in pit scouting');
  });

  it('says when there is nothing to plan', () => {
    const { body } = render(StrategyMeetings, { props: { matches: [match(1)], teamKey: US } });
    expect(body).toContain('No upcoming matches for 5940');
  });
});
