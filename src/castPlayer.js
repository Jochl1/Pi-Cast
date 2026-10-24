import { Player, Constants } from 'yt-cast-receiver';

const { PLAYER_STATUSES } = Constants;

/**
 * Bridges yt-cast-receiver (the YouTube app's cast protocol) to Playback.
 * The receiver only hands us video IDs; mpv + yt-dlp fetch the streams
 * directly, so YouTube's ad system never runs.
 */
export default class CastPlayer extends Player {
  constructor(playback, mpv, log) {
    super();
    this.playback = playback;
    this.mpv = mpv;
    this.log = log;

    playback.on('takeover', (previous) => {
      if (previous === 'cast') {
        this.notifyExternalStateChange(PLAYER_STATUSES.STOPPED).catch(() => {});
      }
    });
    playback.on('ended', ({ owner, reason }) => {
      if (owner === 'cast') this.#onEnded(reason);
    });
  }

  // The receiver doesn't detect end of playback itself; advancing the queue is up to us.
  async #onEnded(reason) {
    try {
      if (reason === 'eof') {
        await this.pause();
        if (await this.next()) return;
      }
      await this.stop();
    } catch (e) {
      this.log.error('cast: failed to advance queue:', e.message);
    }
  }

  async #try(fn) {
    try {
      await fn();
      return true;
    } catch (e) {
      this.log.error('cast:', e.message);
      return false;
    }
  }

  doPlay(video, position) {
    const url = `https://www.youtube.com/watch?v=${video.id}`;
    return this.#try(() => this.playback.play(url, { owner: 'cast', start: position }));
  }

  doPause() { return this.#try(() => this.mpv.pause()); }
  doResume() { return this.#try(() => this.mpv.resume()); }
  doStop() { return this.#try(() => this.playback.stop()); }
  doSeek(position) { return this.#try(() => this.mpv.seek(position)); }

  doSetVolume({ level, muted }) {
    return this.#try(() => Promise.all([this.mpv.setVolume(level), this.mpv.setMute(muted)]));
  }

  async doGetVolume() {
    return { level: Math.round(this.mpv.props.volume ?? 100), muted: !!this.mpv.props.mute };
  }

  async doGetPosition() { return this.mpv.props['time-pos'] ?? 0; }
  async doGetDuration() { return this.mpv.props.duration ?? 0; }
}
