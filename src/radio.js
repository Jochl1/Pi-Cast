import { EventEmitter } from 'node:events';

// radio-browser.info: a free, open directory of internet radio stations.
const API = 'https://de1.api.radio-browser.info/json';
const TIMEOUT_MS = 15000;
const COLS = 4;

/**
 * Radio on ◀ from the home screen: a grid of the stations saved in the web
 * app, played by mpv with the backdrop as the picture (playback.js). The grid
 * stays open under a station and comes back when it stops, like game night.
 *
 * Events: 'change'
 */
export default class Radio extends EventEmitter {
  constructor({ settings, playback, sounds, log }) {
    super();
    Object.assign(this, { settings, playback, sounds, log });
    this.active = false;
    this.focus = 0;
    // Anything else playing closes the grid, so it doesn't come back after a video.
    playback.on('play', ({ kind }) => {
      if (kind !== 'radio' && this.active) this.close();
    });
  }

  get stations() {
    return this.settings.get().radioStations;
  }

  /** The saved station that's playing now, or -1. */
  playingIndex() {
    const s = this.playback.source;
    return s?.kind === 'radio' ? this.stations.findIndex((st) => st.url === s.url) : -1;
  }

  open() {
    this.active = true;
    this.focus = Math.min(this.focus, Math.max(0, this.stations.length - 1));
    this.sounds.play('open');
    this.emit('change');
  }

  close() {
    this.active = false;
    this.emit('change');
  }

  /** Remote keys while the grid shows; true if used. */
  key(k) {
    if (!this.active || this.playback.source) return false;
    const n = this.stations.length;
    const { focus } = this;
    switch (k) {
      case 'left': if (focus % COLS > 0) this.focus--; break;
      case 'right': if (focus % COLS < COLS - 1 && focus < n - 1) this.focus++; break;
      case 'up': if (focus >= COLS) this.focus -= COLS; break;
      case 'down': if (focus + COLS < n) this.focus += COLS; else if (Math.floor(focus / COLS) < Math.floor((n - 1) / COLS)) this.focus = n - 1; break;
      case 'ok':
        if (n) this.play(focus);
        return true;
      case 'back':
      case 'stop':
        this.sounds.play('close');
        this.close();
        return true;
      default: return false;
    }
    if (this.focus !== focus) this.sounds.play('move');
    this.emit('change');
    return true;
  }

  play(index) {
    const station = this.stations[index];
    if (!station) return;
    this.focus = index;
    this.sounds.play('select');
    this.playback.play(station.url, {
      owner: 'web', info: { kind: 'radio', title: station.name, channel: station.tags || null },
    }).catch((e) => this.log.warn(`radio ${station.name}: ${e.message}`));
  }

  /** ◀ ▶ on the radio screen: the previous or next saved station. */
  step(dir) {
    const n = this.stations.length;
    if (!n) return;
    const at = this.playingIndex();
    this.play(((at < 0 ? this.focus : at) + dir + n) % n);
  }

  /** Stations for a search in the web app: [{ name, url, tags, codec, bitrate }]. */
  async search(query) {
    const params = new URLSearchParams({
      name: query, limit: '20', hidebroken: 'true', order: 'clickcount', reverse: 'true',
    });
    const res = await fetch(`${API}/stations/search?${params}`, {
      headers: { 'User-Agent': 'pi-cast/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`radio-browser: HTTP ${res.status}`);
    const list = await res.json();
    const seen = new Set();
    return list.filter((s) => /^https?:\/\//.test(s.url_resolved) && !seen.has(s.url_resolved) && seen.add(s.url_resolved))
      .map((s) => ({
        name: s.name.trim().slice(0, 40),
        url: s.url_resolved,
        tags: s.tags.split(',').filter(Boolean).slice(0, 3).join(', ').slice(0, 60),
        codec: s.codec,
        bitrate: s.bitrate,
      }));
  }
}
