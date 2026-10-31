import { safeExternalHttpUrl, safeUrl } from '$lib/app/safeUrl.js';

export { safeExternalHttpUrl, safeUrl };

const PHOTO_TYPES = new Set(['smugmug-photo', 'imgur', 'instagram-image', 'cdphotothread']);

export function mediaImageUrl(media) {
  if (!media) return '';
  if (media.type === 'avatar' && media.details?.base64Image) {
    const b64 = String(media.details.base64Image).trim();
    return /^[A-Za-z0-9+/=]+$/.test(b64) ? `data:image/png;base64,${b64}` : '';
  }
  return safeUrl(
    media.direct_url || media.details?.image_url || media.details?.image_url_med || media.details?.image_url_sm || ''
  );
}

export function bestTeamPhoto(media = []) {
  const usable = media
    .filter((item) => mediaImageUrl(item))
    .sort((a, b) => {
      const aPhoto = PHOTO_TYPES.has(a.type) ? 1 : 0;
      const bPhoto = PHOTO_TYPES.has(b.type) ? 1 : 0;
      return bPhoto - aPhoto || Number(Boolean(b.preferred)) - Number(Boolean(a.preferred));
    });
  const best = usable[0] || null;
  if (!best || !best.view_url) return best;
  const cleanViewUrl = safeUrl(best.view_url);
  return cleanViewUrl === best.view_url ? best : { ...best, view_url: cleanViewUrl };
}

export function matchVideoUrl(match) {
  const youtube = (match?.videos || []).find((video) => video?.type === 'youtube' && video?.key);
  if (youtube) return `https://www.youtube.com/watch?v=${encodeURIComponent(youtube.key)}`;
  return match?.key ? `https://www.thebluealliance.com/match/${encodeURIComponent(match.key)}` : '';
}

/** The 11-character YouTube video id from a bare id or any common YouTube URL (watch, youtu.be, embed, live, shorts), else null. */
export function parseYoutubeId(input) {
  const text = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const match = text.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/live\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Today's date where the viewer is (YYYY-MM-DD), to match TBA's per-day webcast dates.
const localDay = () => new Date().toLocaleDateString('en-CA');

/**
 * The webcast to show for an event: today's (TBA lists one per day for multi-day streams; undated ones
 * count for every day), preferring YouTube, then Twitch, then anything else. Null when there is none.
 */
export function pickWebcast(webcasts = [], today = localDay()) {
  const casts = (webcasts || []).filter((cast) => cast?.type && cast?.channel);
  const current = casts.filter((cast) => !cast.date || cast.date === today);
  const pool = current.length ? current : casts;
  const rank = (cast) =>
    (cast.type === 'youtube' ? 0 : cast.type === 'twitch' ? 1 : 2) - (cast.date === today ? 0.5 : 0);
  return [...pool].sort((a, b) => rank(a) - rank(b))[0] || null;
}

/**
 * An embeddable iframe URL (YouTube, Twitch) and a plain link for an event's webcast, or null when TBA
 * lists none. TBA's YouTube `channel` can be a video id, a video URL or a channel id ("UC…"); Twitch's can
 * be a channel name or URL. Other types (direct links and the rest) only get a link.
 */
export function eventWebcastEmbed(webcasts = [], today = localDay()) {
  const usable = pickWebcast(webcasts, today);
  if (!usable) return null;
  const channel = String(usable.channel).trim();
  if (usable.type === 'youtube') {
    const videoId = parseYoutubeId(channel);
    if (videoId) {
      return {
        type: 'YouTube',
        embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=0`,
        linkUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      };
    }
    const channelId = channel.match(/(?:^|\/channel\/)(UC[A-Za-z0-9_-]{22})/)?.[1];
    if (channelId) {
      return {
        type: 'YouTube',
        embedUrl: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}&autoplay=0`,
        linkUrl: `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`
      };
    }
    const linkUrl = safeUrl(channel);
    return linkUrl ? { type: 'YouTube', embedUrl: null, linkUrl } : null;
  }
  if (usable.type === 'twitch') {
    const name = channel.match(/twitch\.tv\/([A-Za-z0-9_]+)/i)?.[1] || (/^[A-Za-z0-9_]+$/.test(channel) ? channel : '');
    if (!name) return null;
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return {
      type: 'Twitch',
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(name)}&parent=${encodeURIComponent(parent)}&autoplay=false`,
      linkUrl: `https://www.twitch.tv/${encodeURIComponent(name)}`
    };
  }
  const linkUrl = safeUrl(channel);
  return linkUrl ? { type: usable.type, embedUrl: null, linkUrl } : null;
}

export function matchVideoSources(match) {
  const matchKey = String(match?.key || '').trim();
  const sources = [];
  for (const video of match?.videos || []) {
    const provider = String(video?.type || '')
      .trim()
      .toLowerCase();
    const externalId = String(video?.key || '').trim();
    if (!provider || !externalId) continue;
    let url = '';
    if (provider === 'youtube') url = `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`;
    else if (provider === 'twitch') url = `https://www.twitch.tv/videos/${encodeURIComponent(externalId)}`;
    if (!url) continue;
    sources.push({
      provider,
      external_id: externalId,
      url,
      label: `${provider === 'youtube' ? 'YouTube' : 'Twitch'} · ${externalId}`,
      review_only: true,
      calibrated: false,
      provenance: { resolver: 'tba_match_videos', match_key: matchKey }
    });
  }
  return sources;
}
