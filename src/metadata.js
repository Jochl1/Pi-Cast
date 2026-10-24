/**
 * Quick title/channel/thumbnail lookup, so the TV and the phone can show what's
 * playing before mpv + yt-dlp have finished loading (that takes a while on a Pi 3).
 * YouTube uses the public oEmbed endpoint; Twitch info comes from the URL.
 */

const cache = new Map();

export function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function twitchChannel(url) {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0];
    return first && !['videos', 'directory'].includes(first) ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Resolves { title, channel, thumbnail } (any may be null). Never throws. */
export async function lookup(url, kind) {
  if (cache.has(url)) return cache.get(url);
  let meta = { title: null, channel: null, thumbnail: null };

  if (kind === 'youtube') {
    const id = youtubeId(url);
    if (id) meta.thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = await res.json();
        meta = { ...meta, title: data.title ?? null, channel: data.author_name ?? null };
      }
    } catch { /* offline or private video: fall back to mpv's media-title */ }
  } else if (kind === 'twitch') {
    const channel = twitchChannel(url);
    if (channel) {
      meta = {
        title: channel,
        channel,
        thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-640x360.jpg`,
      };
    }
  }

  if (cache.size > 200) cache.clear();
  cache.set(url, meta);
  return meta;
}
