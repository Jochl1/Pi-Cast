import { EventEmitter } from 'node:events';

// Fetch the next page while this many Reels are still ahead.
const PREFETCH = 3;
// Older Reels are dropped beyond this many.
const MAX_REELS = 150;
// After a failed fetch, scrolling past the end doesn't ask Instagram again for this long.
const BACKOFF_MS = 60000;
// Reels that fail to play in a row before giving up.
const MAX_FAILURES = 3;
const SEEK_S = 5;

/**
 * Instagram Reels on the TV. ▲ on the home screen opens them; then ▼/▲
 * scroll, OK likes or unlikes, ◀ ▶ seek 5 s and Back goes home. Each Reel
 * plays through Playback (owner 'instagram') and loops. The list comes from
 * the Instagram worker a page at a time, fetched ahead while scrolling.
 *
 * Events: 'change'; 'toast' (i18n key, sound)
 */
export default class Reels extends EventEmitter {
  constructor({ instagram, playback, controls, log }) {
    super();
    Object.assign(this, { instagram, playback, controls, log });
    this.active = false;
    this.list = [];
    this.index = 0;
    this.more = true;
    this.fetching = null;
    this.retryAt = 0;
    // True while a Reel is being handed to Playback: its source is briefly gone if it fails.
    this.starting = false;
    this.failures = 0;
    // When the last like happened, for the big heart on the TV.
    this.likedAt = 0;

    // Someone else took the screen (a cast, the web app, a colour key).
    playback.on('play', ({ owner }) => {
      if (owner !== 'instagram') this.#end();
    });
    // Stopped from the web app, or the TV went to standby.
    playback.on('change', () => {
      if (!this.#stopped()) return;
      // A Reel that failed is skipped on 'ended', which comes right after.
      setImmediate(() => { if (this.#stopped()) this.#end(); });
    });
    playback.on('ended', ({ owner, reason }) => {
      if (owner !== 'instagram' || !this.active || reason !== 'error') return;
      this.log.warn(`Reel ${this.current?.code} didn't play`);
      this.#skip();
    });
  }

  /** The Reel on screen, or null. */
  get current() {
    return this.active ? this.list[this.index] ?? null : null;
  }

  /** Remote keys while Reels are open; returns true if the key was used. */
  key(k) {
    if (!this.active) return false;
    switch (k) {
      case 'down': this.#go(1); break;
      case 'up': this.#go(-1); break;
      case 'ok': this.#toggleLike(); break;
      case 'left': case 'rewind': this.#seek(-SEEK_S); break;
      case 'right': case 'fastforward': this.#seek(SEEK_S); break;
      case 'back': case 'stop': this.close(); break;
      default: return false; // play/pause and the rest work as for any video
    }
    return true;
  }

  async open() {
    if (this.active) return;
    if (!this.instagram.state.user) {
      this.emit('toast', this.instagram.state.available ? 'reelsLogin' : 'reelsFailed', 'error');
      return;
    }
    Object.assign(this, { active: true, list: [], index: 0, more: true, failures: 0, retryAt: 0 });
    this.log.info('Reels opened');
    this.emit('change');
    await this.#fetch(true);
    if (!this.active) return;
    if (!this.list.length) {
      if (!this.retryAt) this.emit('toast', 'reelsEmpty', 'notify');
      this.close();
      return;
    }
    this.#play();
  }

  close() {
    if (!this.active) return;
    this.#end();
    if (this.playback.owner === 'instagram') {
      this.playback.stop().catch((e) => this.log.warn('stopping Reels failed:', e.message));
    }
  }

  #end() {
    if (!this.active) return;
    this.active = false;
    this.log.info('Reels closed');
    this.emit('change');
  }

  #stopped() {
    return this.active && this.list.length > 0 && !this.starting && !this.playback.source;
  }

  #fetch(fresh = false) {
    this.fetching ??= this.instagram.reels({ fresh })
      .then(({ reels, more }) => {
        const known = new Set(this.list.map((r) => r.id));
        this.list.push(...reels.filter((r) => !known.has(r.id)));
        this.more = more;
        const drop = Math.max(0, Math.min(this.index - 1, this.list.length - MAX_REELS));
        if (drop) {
          this.list.splice(0, drop);
          this.index -= drop;
        }
        this.log.info(`Reels: ${reels.length} more (${this.list.length} in the list)`);
      })
      .catch((e) => {
        this.log.warn(`Reels: fetching failed (${e.code}): ${e.message}`);
        this.retryAt = Date.now() + BACKOFF_MS;
        if (e.code === 'loggedOut') {
          this.emit('toast', 'reelsLoggedOut', 'error');
          this.close();
        } else {
          this.emit('toast', e.code === 'wait' ? 'reelsWait' : 'reelsFailed', 'error');
        }
      })
      .finally(() => {
        this.fetching = null;
        this.emit('change');
      });
    return this.fetching;
  }

  /** Fetches ahead if the end of the list is near. */
  #fetchAhead() {
    if (this.more && !this.fetching && Date.now() >= this.retryAt && this.list.length - 1 - this.index < PREFETCH) {
      this.#fetch();
    }
  }

  #go(dir) {
    const next = this.index + dir;
    if (next < 0 || next >= this.list.length) return; // the next page is still on its way
    this.index = next;
    this.failures = 0;
    this.#play();
  }

  /** After a Reel failed to play: the next one, unless too many failed in a row. */
  #skip() {
    if (++this.failures >= MAX_FAILURES || this.index + 1 >= this.list.length) {
      this.emit('toast', 'reelsFailed', 'error');
      this.close();
      return;
    }
    this.index++;
    this.#play();
  }

  async #play() {
    const reel = this.current;
    this.emit('change');
    this.#fetchAhead();
    this.starting = true;
    try {
      await this.playback.play(reel.url, {
        owner: 'instagram',
        loop: true,
        info: {
          kind: 'instagram',
          title: reel.caption?.split('\n')[0].slice(0, 120) || `@${reel.user}`,
          channel: reel.user ? `@${reel.user}` : null,
          thumbnail: reel.thumbnail,
          duration: reel.duration,
        },
      });
    } catch (e) {
      if (this.current !== reel) return;
      this.log.warn(`Reel ${reel.code}: ${e.message}`);
      this.starting = false;
      this.#skip();
    } finally {
      if (this.current === reel) this.starting = false;
    }
  }

  #seek(seconds) {
    if (this.playback.owner !== 'instagram' || this.playback.loading) return;
    this.controls.seekBy(seconds).catch((e) => this.log.debug('Reels seek failed:', e.message));
  }

  #toggleLike() {
    const reel = this.current;
    if (!reel) return;
    const on = !reel.liked;
    const flip = (liked) => {
      reel.liked = liked;
      if (reel.likes != null) reel.likes += liked ? 1 : -1;
    };
    flip(on);
    if (on) this.likedAt = Date.now();
    this.emit('change');
    this.instagram.like(reel.id, on).catch((e) => {
      this.log.warn(`Reels: ${on ? 'like' : 'unlike'} failed (${e.code}): ${e.message}`);
      if (reel.liked === on) flip(!on);
      this.emit('toast', e.code === 'loggedOut' ? 'reelsLoggedOut' : 'reelsFailed', 'error');
      this.emit('change');
    });
  }
}
