import { EventEmitter } from 'node:events';
import { classify } from './sources.js';
import { lookup, youtubeId } from './metadata.js';
import { edl } from './ytdl.js';

// mpv restarts the hardware decoder on every loop-file seek, which flashes
// the whole screen black on a Pi 3. The clip repeated back to back in an EDL
// plays on without that (one segment to the next), and wraps around hourly.
// mpv opens a file that's repeated in an EDL only once, so this works for
// URLs too (Reels loop the same way).
const CLIP_REPEATS = 120;
// Behind a radio station it has to last longer: 4 hours of 30 s clips, then the last frame stays.
const RADIO_REPEATS = 480;
const repeated = (file, n = CLIP_REPEATS) => `edl://${Array(n).fill(`%${Buffer.byteLength(file)}%${file}`).join(';')}`;
const seamless = (file, n) => (file.endsWith('.mp4') ? repeated(file, n) : file);

/**
 * Single owner of what's on screen. Both the cast receiver and the web UI go
 * through here, so they never fight over mpv.
 *
 * owner: 'cast' (YouTube app session) | 'web' (web UI / share) |
 *        'instagram' (Reels, see reels.js) | null
 *
 * Events:
 *  'takeover' (previousOwner) - someone else started playing
 *  'ended' ({ owner, reason, why }) - the current item finished ('eof') or failed
 *     ('error'); `why` is an i18n key when yt-dlp said why (e.g. age-restricted)
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
    // While the TV is off the backdrop stays loaded but paused, so it's there the moment the TV is back.
    this.standby = false;
    // Reasons the backdrop holds still: 'standby' (paused), and 'panel', 'airplay' and 'radio' (its grid)
    // (overlay redraws over the moving clip flicker black on a Pi 3).
    this.holds = new Set();

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
      if (this.background.showing) {
        this.emit('backdrop'); // its first frame is on screen
        return;
      }
      if (!this.loading) return;
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

  /** TV off: the backdrop holds still. The caller stops playback. */
  setStandby(on) {
    this.standby = on;
    this.holdBackground('standby', on);
  }

  /**
   * For the panel and AirPlay the clip crawls at 1% instead of pausing:
   * resuming after the overlays changed flashed black, changing the speed doesn't.
   */
  async #holdSpeed() {
    await this.mpv.set('speed', ['panel', 'airplay', 'radio'].some((r) => this.holds.has(r)) ? 0.01 : 1);
  }

  /** Holds the backdrop still while any `reason` holds it. */
  holdBackground(reason, on) {
    if (this.holds.has(reason) === on) return;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
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
    if (bg.showing && bg.loaded === file) {
      // Paused by play(), or held still.
      if (!!this.mpv.props.pause !== this.standby) await this.mpv.set('pause', this.standby);
      await this.#holdSpeed();
      return true;
    }
    await this.mpv.set('image-display-duration', 'inf');
    const id = await this.mpv.load(seamless(file), { loop: true, audio: false });
    Object.assign(bg, { loaded: file, id });
    if (this.standby) await this.mpv.pause(); // its first frame still shows
    await this.#holdSpeed();
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

  /**
   * `info` = { kind, title, channel, thumbnail } when the caller already knows
   * them (Reels): no lookup, and `url` is played as it is. `loop` repeats it
   * without a black flash between rounds.
   */
  async play(url, {
    owner, start = 0, info = null, loop = false,
  }) {
    const kind = info?.kind ?? classify(url);
    const previous = this.owner;
    this.switching = true;
    this.timing = { request: Date.now() };
    this.loading = true;
    this.owner = owner;
    const source = { url, kind, title: null, channel: null, thumbnail: null, ...info };
    this.source = source;
    if (previous && previous !== owner) this.emit('takeover', previous);
    this.emit('play', { owner, url, kind });
    this.emit('change');
    // Whatever is on screen (the old video, dimmed under the loading card, or
    // the backdrop) holds still while the new item loads: overlays redrawn
    // over moving video cost CPU that yt-dlp needs, and made the backdrop
    // clip flicker black.
    if (!this.mpv.props['idle-active']) await this.mpv.pause().catch(() => {});
    this.log.info(`play [${owner}/${kind}] ${url}${start ? ` @${start}s` : ''}`);

    // Fetched in parallel with loading; shown as soon as it arrives.
    const meta = info ? Promise.resolve() : lookup(url, kind).then((m) => {
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
      } else if (kind === 'radio') {
        // The backdrop plays along as the picture, so the colours keep drifting behind the radio screen.
        const bg = this.background;
        const picture = bg.file && bg.file !== bg.failed ? seamless(bg.file, RADIO_REPEATS) : null;
        await this.mpv.load(url, { title: source.title ?? '', external: picture });
        this.#mark('loadfile');
        await this.streamlink.close();
      } else {
        const direct = kind === 'youtube' ? await this.#resolve(url) : null;
        if (this.source !== source) {
          // Replaced or stopped while yt-dlp was busy.
          if (!this.source) this.switching = false;
          return;
        }
        // Load first, then drop any old Twitch stream, so its EOF lands as a 'stop'.
        if (direct) {
          source.live = direct.live; // YouTube live streams show "LIVE" instead of times
          // The Referer lets the SponsorBlock script find the video ID.
          const id = youtubeId(url);
          const headers = [
            ...Object.entries(direct.video.headers).map(([k, v]) => `${k}: ${v}`),
            ...(id ? [`Referer: https://www.youtube.com/watch?v=${id}`] : []),
          ];
          await this.mpv.load(edl(direct.video.url, direct.audio?.url), { start, title: direct.title ?? source.title ?? '', headers });
        } else if (loop) {
          // 60 rounds without a flash, then mpv loops the whole EDL.
          await this.mpv.load(repeated(url, 60), { start, title: source.title ?? '', loop: true });
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
      if (e.why && !this.source) {
        this.log.warn(`couldn't play ${url}: ${e.message}`);
        this.emit('ended', { owner, reason: 'error', why: e.why });
      }
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
      if (e.why) throw e;
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
    // A looped item (Reels) knows its own length; mpv sees all the rounds.
    const round = s?.duration || 0;
    const position = s ? p['time-pos'] ?? 0 : 0;
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
      paused: !!s && !this.loading && !!p.pause, // play() holds the old picture still while loading
      live: s?.kind === 'twitch' || s?.kind === 'radio' || !!s?.live,
      // The song a radio station sends along (ICY metadata).
      song: s?.kind === 'radio' ? p['metadata/by-key/icy-title'] || null : null,
      position: round ? position % round : position,
      duration: round || (s ? p.duration ?? 0 : 0),
      volume: Math.round(p.volume ?? 100),
      muted: !!p.mute,
    };
  }
}
