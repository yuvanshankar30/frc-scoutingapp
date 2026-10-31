import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { notifyPitProblem, pitProblemMessage } = await import('./pit_problem_notifications.js');

const problem = {
  id: 'p1',
  event_key: '2026demo',
  team_key: 'frc1234',
  match_key: '2026demo_qm7',
  summary: 'Intake <broken>',
  severity: 'watch'
};

describe('pit problem Slack posts', () => {
  it('writes a readable message and escapes Slack markup', () => {
    const text = pitProblemMessage(problem, 'Sam');
    expect(text).toContain('Team 1234');
    expect(text).toContain('Qualification 7');
    expect(text).toContain('Intake &lt;broken&gt;');
    expect(text).toContain('*Reported by:* Sam');
  });

  it('does nothing when Slack is not configured', async () => {
    await expect(notifyPitProblem(problem)).resolves.toEqual({ ok: false, reason: 'not-configured' });
  });

  it('posts a new problem and updates one that was already posted', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, channel: 'C1', ts: '1.1' }),
        update: vi.fn().mockResolvedValue({ ok: true, channel: 'C1', ts: '1.1' })
      }
    };
    const posted = await notifyPitProblem(problem, 'Sam', { client, channel: 'C1' });
    expect(posted).toMatchObject({ ok: true, channel: 'C1', ts: '1.1' });
    await notifyPitProblem({ ...problem, slack_channel: 'C1', slack_ts: '1.1', resolved: true }, 'Sam', { client });
    expect(client.chat.update).toHaveBeenCalledWith(expect.objectContaining({ channel: 'C1', ts: '1.1' }));
  });

  it('reports a Slack failure instead of throwing', async () => {
    const client = { chat: { postMessage: vi.fn().mockRejectedValue(new Error('boom')) } };
    await expect(notifyPitProblem(problem, null, { client, channel: 'C1' })).resolves.toEqual({
      ok: false,
      reason: 'boom'
    });
  });
});
