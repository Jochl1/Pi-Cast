import { EventEmitter } from 'node:events';
import { youtubeId } from './metadata.js';

// YouTube's own web player API: no key, and ~5 KB back; it says isLive even
// when it wants a PO token for the streams.
const PLAYER = 'https://www.youtube.com/youtubei/v1/player';
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' };
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const POLL_MS = 3 * 60 * 1000;
const TIMEOUT_MS = 15000;

/** A channel's live link (youtube.com/@name/live, /channel/<id>/live, /c/<name>/live), or null. */
export function youtubeChannelLive(url) {
  const m = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/((?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)\/live)\/?(?:[?#]|$)/i.exec(url ?? '');
  return m ? `https://www.youtube.com/${m[1]}` : null;
}

/** What to ask for a favourite's link: { id } for a video, { page } for a channel's live link, or null. */
function target(url) {
  if (!/^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i.test(url ?? '')) return null;
  const page = youtubeChannelLive(url);
  if (page) return { page };
  const id = youtubeId(url);
  return id && /^[\w-]{11}$/.test(id) ? { id } : null;
}

async function videoIsLive(id) {
  const res = await fetch(PLAYER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ videoId: id, context: { client: CLIENT } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { videoDetails } = await res.json();
  if (!videoDetails) throw new Error('no videoDetails');
  return !!videoDetails.isLive;
}

// A channel's /live page is the live video's watch page while it streams.
async function pageIsLive(page) {
  const res = await fetch(page, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).includes('"isLiveNow":true');
}

/**
 * Which YouTube favourites (colour keys) are live streams that are on air,
 * for the home screen's "LIVE" tags, like TwitchLive. One small request per
 * YouTube favourite every 3 minutes and on wake-up, skipped while the TV is in standby.
 *
 * Events: 'change'
 */
export default class YoutubeLive extends EventEmitter {
  constructor({ settings, playback, log }) {
    super();
    Object.assign(this, { settings, playback, log });
    this.live = new Set(); // favourite links that are live
    this.timer = null;
  }

  start() {
    this.settings.on('change', (values, changed) => {
      if (changed.includes('shortcuts')) this.refresh();
    });
    this.refresh();
  }

  isLive(url) {
    return this.live.has(url);
  }

  async refresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), POLL_MS);
    this.timer.unref();
    if (this.playback.standby) return;
    const urls = [...new Set(Object.values(this.settings.get().shortcuts).map((s) => s?.url).filter((u) => target(u)))];
    const live = new Set();
    for (const url of urls) {
      const { id, page } = target(url);
      try {
        if (await (id ? videoIsLive(id) : pageIsLive(page))) live.add(url);
      } catch (e) {
        this.log.debug(`YouTube live check failed for ${url}:`, e.message);
        if (this.live.has(url)) live.add(url); // keep the last known state
      }
    }
    if ([...live].sort().join() !== [...this.live].sort().join()) {
      this.live = live;
      this.emit('change');
    }
  }
}
