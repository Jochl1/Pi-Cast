import { EventEmitter } from 'node:events';
import { classify } from './sources.js';
import { lookup } from './metadata.js';

/**
 * Single owner of what's on screen. Both the cast receiver and the web UI go
 * through here, so they never fight over mpv.
 *
 * owner: 'cast' (YouTube app session) | 'web' (web UI / share) | null
 *
 * Events:
 *  'takeover' (previousOwner) - someone else started playing
 *  'ended' ({ owner, reason }) - the current item finished ('eof') or failed ('error')
 *  'change' - owner, source or metadata changed
 */
export default class Playback extends EventEmitter {
  /** `getTwitchQuality` returns the streamlink quality list to use for the next stream. */
  constructor(mpv, streamlink, log, { getTwitchQuality }) {
    super();
    this.mpv = mpv;
    this.streamlink = streamlink;
    this.log = log;
    this.getTwitchQuality = getTwitchQuality;
    this.owner = null;
    // { url, kind, title, channel, thumbnail } of the current item.
    this.source = null;
    // True between starting a new item and mpv picking it up; end-file events
    // from the item being replaced are ignored during that window.
    this.switching = false;

    mpv.on('start-file', () => { this.switching = false; });
    mpv.on('end-file', (reason) => {
      if (this.switching || (reason !== 'eof' && reason !== 'error')) return;
      const { owner } = this;
      this.#clear();
      this.streamlink.close();
      this.log.info(`playback ended (${reason})`);
      this.emit('ended', { owner, reason });
    });
  }

  #clear() {
    this.owner = null;
    this.source = null;
    this.emit('change');
  }

  async play(url, { owner, start = 0 }) {
    const kind = classify(url);
    const previous = this.owner;
    this.switching = true;
    this.owner = owner;
    const source = { url, kind, title: null, channel: null, thumbnail: null };
    this.source = source;
    if (previous && previous !== owner) this.emit('takeover', previous);
    this.emit('change');
    this.log.info(`play [${owner}/${kind}] ${url}${start ? ` @${start}s` : ''}`);

    // Fetched in parallel with loading; shown as soon as it arrives.
    const meta = lookup(url, kind).then((m) => {
      if (this.source !== source) return;
      Object.assign(source, m);
      this.emit('change');
    });

    try {
      if (kind === 'twitch') {
        // Opening a new stream kills the old streamlink first; the resulting
        // EOF of the old item is ignored because we're switching.
        const local = await this.streamlink.open(url, this.getTwitchQuality());
        await meta;
        await this.mpv.load(local, { title: source.title ?? url });
      } else {
        // Load first, then drop any old Twitch stream, so its EOF lands as a 'stop'.
        await this.mpv.load(url, { start });
        await this.streamlink.close();
      }
    } catch (e) {
      this.switching = false;
      if (this.source === source) this.#clear();
      // Don't leave the previous item playing unowned.
      await this.streamlink.close();
      await this.mpv.stop().catch(() => {});
      throw e;
    }
  }

  async stop() {
    this.#clear();
    // Stop mpv before killing streamlink, so the stream's end is seen as a 'stop'.
    await this.mpv.stop();
    await this.streamlink.close();
  }

  status() {
    const p = this.mpv.props;
    const s = this.source;
    return {
      owner: this.owner,
      kind: s?.kind ?? null,
      url: s?.url ?? null,
      title: s?.title ?? (s ? p['media-title'] : null),
      channel: s?.channel ?? null,
      thumbnail: s?.thumbnail ?? null,
      idle: !!p['idle-active'],
      // Between asking for a video and its first frame (yt-dlp is slow on a Pi 3).
      loading: !!s && (this.switching || !!p['idle-active'] || !!p['paused-for-cache']),
      paused: !!p.pause,
      live: s?.kind === 'twitch',
      position: p['time-pos'] ?? 0,
      duration: p.duration ?? 0,
      volume: Math.round(p.volume ?? 100),
      muted: !!p.mute,
    };
  }
}
