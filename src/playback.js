import { EventEmitter } from 'node:events';
import { classify } from './sources.js';
import { lookup, youtubeId } from './metadata.js';
import { edl } from './ytdl.js';

/**
 * Single owner of what's on screen. Both the cast receiver and the web UI go
 * through here, so they never fight over mpv.
 *
 * owner: 'cast' (YouTube app session) | 'web' (web UI / share) | null
 *
 * Events:
 *  'takeover' (previousOwner) - someone else started playing
 *  'ended' ({ owner, reason }) - the current item finished ('eof') or failed ('error')
 *  'started' - the first frame of a new item is on screen
 *  'change' - owner, source, metadata or loading changed
 *  'play' ({ owner, url, kind }) - a new item was requested
 *  'loaded' - mpv opened the current item
 *
 * While nothing plays, mpv shows the home screen's backdrop as a looping
 * "file" (see setBackground). Its events are filtered out here, so to the
 * rest of the app it looks like idle.
 */
export default class Playback extends EventEmitter {
  /** `getTwitchQuality` returns the streamlink quality list to use for the next stream. */
  constructor(mpv, streamlink, ytdl, log, { getTwitchQuality }) {
    super();
    this.mpv = mpv;
    this.streamlink = streamlink;
    this.ytdl = ytdl;
    this.log = log;
    this.getTwitchQuality = getTwitchQuality;
    this.owner = null;
    // { url, kind, title, channel, thumbnail } of the current item.
    this.source = null;
    // True between starting a new item and mpv picking it up; end-file events
    // from the item being replaced are ignored during that window.
    this.switching = false;
    // True from the request until the first frame. mpv's start-file comes
    // right after loadfile, long before yt-dlp has found the streams, so
    // idle-active alone would show a black screen for most of the wait.
    this.loading = false;
    // Timestamps of the current load, logged once the first frame shows.
    this.timing = null;
    // The backdrop: `file` to show; `loaded` and `id` = the file last handed to
    // mpv and its playlist entry; `showing` while that's mpv's current file;
    // `failed` = a file that didn't open.
    this.background = { file: null, loaded: null, id: null, showing: false, failed: null };

    mpv.on('ready', () => {
      // A (re)started mpv is idle.
      Object.assign(this.background, { id: null, showing: false });
      this.#toIdle();
    });
    mpv.on('start-file', (id) => {
      this.background.showing = id != null && id === this.background.id;
      if (this.background.showing) return;
      this.switching = false;
      this.#mark('start-file');
    });
    mpv.on('file-loaded', () => {
      if (this.background.showing) return;
      this.#mark('file-loaded');
      if (this.source) this.emit('loaded');
    });
    mpv.on('playback-restart', () => {
      if (!this.loading || this.background.showing) return;
      this.#mark('first frame');
      this.#setLoading(false);
      this.emit('started');
    });
    mpv.on('end-file', (reason, id) => {
      const bg = this.background;
      if (id != null && id === bg.id) {
        bg.showing = false;
        if (reason === 'error') {
          bg.failed = bg.file;
          this.log.warn(`couldn't show the background ${bg.file}`);
        }
        return;
      }
      if (this.switching || (reason !== 'eof' && reason !== 'error')) return;
      this.#setLoading(false);
      const { owner } = this;
      this.#clear();
      this.streamlink.close();
      this.log.info(`playback ended (${reason})`);
      this.emit('ended', { owner, reason });
      this.#toIdle();
    });
  }

  /** Sets the backdrop shown while nothing plays (a PNG or a looping clip). */
  setBackground(file) {
    if (this.background.file === file) return;
    this.background.file = file;
    if (!this.source) this.#toIdle();
  }

  /** Shows the backdrop, or stops mpv if there's none. */
  async #toIdle() {
    if (!this.mpv.socket) return; // done again on 'ready'
    try {
      if (!(await this.#showBackground())) await this.mpv.stop();
    } catch (e) {
      this.log.debug('going idle failed:', e.message);
    }
  }

  /** Loads the backdrop unless it's already showing; false if there's none to show. */
  async #showBackground() {
    const bg = this.background;
    const { file } = bg;
    if (!file || bg.failed === file) return false;
    if (bg.showing && bg.loaded === file) return true;
    await this.mpv.set('image-display-duration', 'inf');
    const id = await this.mpv.load(file, { loop: true });
    Object.assign(bg, { loaded: file, id });
    return true;
  }

  #setLoading(on) {
    if (!on && this.timing) {
      const t0 = this.timing.request;
      const steps = Object.entries(this.timing).filter(([k]) => k !== 'request')
        .map(([k, t]) => `${k} +${((t - t0) / 1000).toFixed(1)}s`);
      this.log.info(`load timing: ${steps.join(', ')}`);
      this.timing = null;
    }
    if (this.loading === on) return;
    this.loading = on;
    this.emit('change');
  }

  #mark(step) {
    if (this.timing && !(step in this.timing)) this.timing[step] = Date.now();
  }

  #clear() {
    this.#setLoading(false);
    this.owner = null;
    this.source = null;
    this.emit('change');
  }

  async play(url, { owner, start = 0 }) {
    const kind = classify(url);
    const previous = this.owner;
    const wasPlaying = !!this.source;
    this.switching = true;
    this.timing = { request: Date.now() };
    this.loading = true;
    this.owner = owner;
    const source = { url, kind, title: null, channel: null, thumbnail: null };
    this.source = source;
    if (previous && previous !== owner) this.emit('takeover', previous);
    this.emit('play', { owner, url, kind });
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
        this.#mark('streamlink');
        await meta;
        await this.mpv.load(local, { title: source.title ?? url });
        this.#mark('loadfile');
      } else {
        let direct = null;
        if (kind === 'youtube') {
          // Resolving takes seconds: show the loading screen over the
          // backdrop, not over the old video.
          if (wasPlaying) await this.#toIdle();
          direct = await this.#resolve(url);
        }
        if (this.source !== source) {
          // Replaced or stopped while yt-dlp was busy.
          if (!this.source) this.switching = false;
          return;
        }
        // Load first, then drop any old Twitch stream, so its EOF lands as a 'stop'.
        if (direct) {
          // The Referer lets the SponsorBlock script find the video ID.
          const id = youtubeId(url);
          const headers = [
            ...Object.entries(direct.video.headers).map(([k, v]) => `${k}: ${v}`),
            ...(id ? [`Referer: https://www.youtube.com/watch?v=${id}`] : []),
          ];
          await this.mpv.load(edl(direct.video.url, direct.audio?.url), { start, title: direct.title ?? source.title ?? '', headers });
        } else {
          await this.mpv.load(url, { start });
        }
        this.#mark('loadfile');
        await this.streamlink.close();
      }
    } catch (e) {
      this.switching = false;
      if (this.source === source) this.#clear();
      // Don't leave the previous item playing unowned.
      if (!this.source) await this.#toIdle();
      await this.streamlink.close();
      throw e;
    }
  }

  /** Direct stream URLs from the yt-dlp worker, or null to let mpv's ytdl hook do it. */
  async #resolve(url) {
    try {
      const direct = await this.ytdl.resolve(url);
      this.#mark('resolved');
      return direct;
    } catch (e) {
      this.log.warn(`yt-dlp worker: ${e.message}; letting mpv resolve ${url}`);
      return null;
    }
  }

  async stop() {
    this.#clear();
    // Stop mpv before killing streamlink, so the stream's end is seen as a 'stop'.
    await this.#toIdle();
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
      idle: !s || !!p['idle-active'],
      // Between asking for a video and its first frame (yt-dlp is slow on a Pi 3).
      loading: !!s && (this.loading || !!p['paused-for-cache']),
      paused: !!s && !!p.pause,
      live: s?.kind === 'twitch',
      position: s ? p['time-pos'] ?? 0 : 0,
      duration: s ? p.duration ?? 0 : 0,
      volume: Math.round(p.volume ?? 100),
      muted: !!p.mute,
    };
  }
}
