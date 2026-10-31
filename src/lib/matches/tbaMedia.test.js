import { describe, expect, it } from 'vitest';
import {
  bestTeamPhoto,
  eventWebcastEmbed,
  parseYoutubeId,
  pickWebcast,
  matchVideoSources,
  matchVideoUrl,
  mediaImageUrl,
  safeExternalHttpUrl,
  safeUrl
} from './tbaMedia.js';

describe('TBA media helpers', () => {
  it('prefers a robot photo over an avatar', () => {
    const avatar = { type: 'avatar', preferred: true, details: { base64Image: 'abc' } };
    const photo = { type: 'smugmug-photo', direct_url: 'https://img.example/robot.jpg' };
    expect(bestTeamPhoto([avatar, photo])).toBe(photo);
    expect(mediaImageUrl(photo)).toBe('https://img.example/robot.jpg');
  });

  it('rejects javascript: and data: URLs in mediaImageUrl, bestTeamPhoto.view_url, and eventWebcastEmbed', () => {
    expect(mediaImageUrl({ type: 'imgur', direct_url: 'javascript:alert(1)' })).toBe('');
    expect(mediaImageUrl({ type: 'imgur', direct_url: 'data:text/html,<script>alert(1)</script>' })).toBe('');
    expect(mediaImageUrl({ type: 'avatar', details: { base64Image: 'abc" onerror="alert(1)' } })).toBe('');
    const unsafeView = bestTeamPhoto([
      {
        type: 'imgur',
        direct_url: 'https://img.example/robot.jpg',
        view_url: 'javascript:alert(document.cookie)'
      }
    ]);
    expect(unsafeView.view_url).toBe('');
    // An unsafe link means no webcast at all, not a link to it.
    expect(eventWebcastEmbed([{ type: 'iframe', channel: 'javascript:alert(1)' }])).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeExternalHttpUrl('https://www.thebluealliance.com')).toBe('https://www.thebluealliance.com/');
  });

  it('uses YouTube when a match has video and TBA otherwise', () => {
    expect(matchVideoUrl({ key: '2026cc_qm1', videos: [{ type: 'youtube', key: 'abc123' }] })).toBe(
      'https://www.youtube.com/watch?v=abc123'
    );
    expect(matchVideoUrl({ key: '2026cc_qm2', videos: [] })).toBe('https://www.thebluealliance.com/match/2026cc_qm2');
  });

  it('resolves zero, one, and multiple supported match videos with provenance', () => {
    expect(matchVideoSources({ key: '2026cc_qm1', videos: [] })).toEqual([]);
    expect(matchVideoSources({ key: '2026cc_qm1', videos: [{ type: 'youtube', key: 'abc' }] })).toEqual([
      expect.objectContaining({ provider: 'youtube', external_id: 'abc', review_only: true, calibrated: false })
    ]);
    expect(
      matchVideoSources({
        key: '2026cc_qm1',
        videos: [
          { type: 'youtube', key: 'abc' },
          { type: 'twitch', key: '123' },
          { type: 'unknown', key: 'x' }
        ]
      })
    ).toHaveLength(2);
  });

  it('reads every form of YouTube and Twitch webcast TBA uses', () => {
    expect(parseYoutubeId('https://www.youtube.com/live/70Dvxy-kVgI')).toBe('70Dvxy-kVgI');
    expect(eventWebcastEmbed([{ type: 'youtube', channel: 'https://www.youtube.com/live/70Dvxy-kVgI' }]).embedUrl).toBe(
      'https://www.youtube.com/embed/70Dvxy-kVgI?autoplay=0'
    );
    expect(eventWebcastEmbed([{ type: 'youtube', channel: 'Nd32P1jrvkk' }]).linkUrl).toBe(
      'https://www.youtube.com/watch?v=Nd32P1jrvkk'
    );
    expect(eventWebcastEmbed([{ type: 'youtube', channel: 'UCabcdefghijklmnopqrstuv' }]).embedUrl).toContain(
      'live_stream?channel=UCabcdefghijklmnopqrstuv'
    );
    expect(eventWebcastEmbed([{ type: 'twitch', channel: 'https://www.twitch.tv/robosportsnetwork' }]).linkUrl).toBe(
      'https://www.twitch.tv/robosportsnetwork'
    );
    expect(eventWebcastEmbed([])).toBeNull();
  });

  it("picks today's stream when TBA lists one per day, and YouTube before Twitch", () => {
    const casts = [
      { type: 'youtube', channel: 'day1aaaaaaa', date: '2026-09-18' },
      { type: 'youtube', channel: 'day2bbbbbbb', date: '2026-09-19' },
      { type: 'twitch', channel: 'robosportsnetwork' }
    ];
    expect(pickWebcast(casts, '2026-09-19').channel).toBe('day2bbbbbbb');
    expect(pickWebcast(casts, '2026-10-01').type).toBe('twitch');
    expect(pickWebcast([{ type: 'youtube', channel: 'old1aaaaaaa', date: '2026-09-18' }], '2026-10-01').channel).toBe(
      'old1aaaaaaa'
    );
  });
});
