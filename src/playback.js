import { EventEmitter } from 'node:events';
import { classify } from './sources.js';

/**
 * Single owner of what's on screen. Both the cast receiver and the web UI go
 * through here, so they never fight over mpv.
 *
 * owner: 'cast' (YouTube app session) | 'web' (web UI / share) | null
 *
 * Events:
 *  'takeover' (previousOwner) - someone else started playing
 *  'ended' ({ owner, reason }) - the current item finished ('eof') or failed ('error')
 */
export default class Playback extends EventEmitter {
  constructor(mpv, streamlink, log) {
    super();
    this.mpv = mpv;
    this.streamlink = streamlink;
    this.log = log;
    this.owner = null;
    this.source = null;
    // True between starting a new item and mpv picking it up; end-file events
    // from the item being replaced are ignored during that window.
    this.switching = false;

    mpv.on('start-file', () => { this.switching = false; });
    mpv.on('end-file', (reason) => {
      if (this.switching || (reason !== 'eof' && reason !== 'error')) return;
      const { owner } = this;
      this.owner = null;
      this.source = null;
      this.streamlink.close();
      this.log.info(`playback ended (${reason})`);
      this.emit('ended', { owner, reason });
    });
  }

  async play(url, { owner, start = 0 }) {
    const kind = classify(url);
    const previous = this.owner;
    this.switching = true;
    this.owner = owner;
    this.source = { url, kind };
    if (previous && previous !== owner) this.emit('takeover', previous);
    this.log.info(`play [${owner}/${kind}] ${url}${start ? ` @${start}s` : ''}`);

    try {
      if (kind === 'twitch') {
        // Opening a new stream kills the old streamlink first; the resulting
        // EOF of the old item is ignored because we're switching.
        await this.mpv.load(await this.streamlink.open(url));
      } else {
        // Load first, then drop any old Twitch stream, so its EOF lands as a 'stop'.
        await this.mpv.load(url, { start });
        await this.streamlink.close();
      }
    } catch (e) {
      this.switching = false;
      this.owner = null;
      this.source = null;
      // Don't leave the previous item playing unowned.
      await this.streamlink.close();
      await this.mpv.stop().catch(() => {});
      throw e;
    }
  }

  async stop() {
    this.owner = null;
    this.source = null;
    // Stop mpv before killing streamlink, so the stream's end is seen as a 'stop'.
    await this.mpv.stop();
    await this.streamlink.close();
  }

  status() {
    const p = this.mpv.props;
    return {
      owner: this.owner,
      kind: this.source?.kind ?? null,
      url: this.source?.url ?? null,
      title: p['media-title'],
      idle: !!p['idle-active'],
      paused: !!p.pause,
      position: p['time-pos'] ?? 0,
      duration: p.duration ?? 0,
      volume: Math.round(p.volume ?? 100),
      muted: !!p.mute,
    };
  }
}
