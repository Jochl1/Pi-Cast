import QRCode from 'qrcode';
import { ACCENTS, KEY_COLORS } from '../shared/theme.js';
import { LANGUAGES } from '../shared/i18n.js';
import { networkStatus } from '../network.js';
import { coverBgra, thumbnailBgra } from './thumbnail.js';
import { backgroundClip, backgroundPng } from './background.js';
import * as screens from './screens.js';

// osd-overlay ids; higher z draws on top. The thumbnail is an overlay-add
// bitmap, which mpv always draws above all of these.
const LAYERS = {
  home: { id: 2, z: 1 },
  loading: { id: 7, z: 2 },
  dots: { id: 8, z: 3 },
  reels: { id: 9, z: 4 },
  popup: { id: 3, z: 5 },
  pause: { id: 4, z: 6 },
  panel: { id: 5, z: 8 },
  toast: { id: 6, z: 9 },
};
const THUMB_OVERLAY = 0;
const POPUP_MS = 5000;
const FADE_MS = 600;
const TOAST_MS = 5000;
const DOTS_MS = 250; // dots redraw interval (each redraw re-composites the overlays)
const DOTS_CYCLE_MS = 1200;
// Short stalls don't get the buffering card.
const BUFFERING_MS = 1000;
const UNHOLD_MS = 400;
// The big heart after a like fades out over this long.
const PULSE_MS = 700;
// How long the power row waits for its second OK.
const POWER_CONFIRM_MS = 4000;

/**
 * Everything drawn on the TV: home screen, loading, now-playing pop-ups,
 * pause screen, settings panel, Reels, AirPlay and toasts. Redraws only when something
 * visible changes, since every redraw costs CPU on a Pi 3.
 * `powerOff`: called by the settings panel's power row.
 */
export default class Tv {
  constructor({
    mpv, playback, cast, settings, sounds, reels, weather, instagram, airplay, twitchLive, log, remote, powerOff,
  }) {
    Object.assign(this, {
      mpv, playback, cast, settings, sounds, reels, weather, instagram, airplay, twitchLive, log, remote, powerOff,
    });
    this.cover = { image: null, want: null }; // AirPlay's cover: the image and its bitmap
    this.sent = {};
    this.panel = { open: false, focus: 0, powerConfirm: null }; // powerConfirm: a timer while it waits
    this.card = null; // { until, quality }
    this.sender = null; // { name, until }
    this.message = null; // { text, until }
    this.net = null;
    this.thumb = { want: null, shown: null }; // { file, x, y, w, h }
    this.timer = null;
    this.scheduled = false;
    this.backdropKey = null;
    this.dotsTimer = null;
    this.bufferingSince = null;
    // The web remote's address as a QR code on the home screen.
    const { modules } = QRCode.create(`http://${remote}`, { errorCorrectionLevel: 'M' });
    this.qr = Array.from({ length: modules.size }, (_, r) => Array.from({ length: modules.size }, (_, c) => !!modules.get(r, c)));
  }

  start() {
    const { mpv, playback, cast, settings } = this;
    mpv.on('ready', () => {
      // A (re)started mpv has no overlays.
      this.sent = {};
      this.thumb.shown = null;
      this.render();
    });
    mpv.on('property', (name, value) => {
      if (name === 'paused-for-cache') {
        this.bufferingSince = value ? Date.now() : null;
        if (value) setTimeout(() => this.render(), BUFFERING_MS + 50);
      }
      // time-pos only matters for the progress bars.
      if (name !== 'time-pos' || this.screen() === 'paused' || this.card) this.render();
    });
    playback.on('started', () => this.#onStarted());
    playback.on('change', () => this.render());
    playback.on('ended', ({ reason }) => {
      if (reason === 'error') this.toast(screens.look(this.settings.get()).tr('couldntPlay'), { sound: 'error' });
    });
    cast.on('senderConnect', (name) => {
      this.sender = { name, until: Date.now() + POPUP_MS };
      this.render();
    });
    cast.on('change', () => this.render());
    this.reels.on('change', () => this.render());
    this.weather.on('change', () => this.render());
    this.twitchLive.on('change', () => this.render());
    // The ▲ Instagram hint shows while logged in.
    this.instagram.on('change', () => this.render());
    this.airplay.on('change', (state) => {
      if (state.cover !== this.cover.image) this.#prepareCover(state.cover);
      this.render();
    });
    settings.on('change', () => {
      this.#updateBackdrop();
      this.render();
    });

    this.#tickClock();
    this.#pollNetwork();
    this.#updateBackdrop();
    this.render();
  }

  /** 'home' | 'loading' | 'buffering' | 'playing' | 'paused' | 'reels' | 'airplay' */
  screen() {
    const p = this.mpv.props;
    const { source, loading, background } = this.playback;
    if (this.reels.active) return 'reels';
    if (!source) return this.airplay.state.active ? 'airplay' : 'home';
    if (p['idle-active'] || background.showing || loading) return 'loading';
    if (p.pause) return 'paused';
    if (this.bufferingSince && Date.now() - this.bufferingSince >= BUFFERING_MS) return 'buffering';
    return 'playing';
  }

  /**
   * The home screen's backdrop, shown by mpv on its video plane (it would
   * never fit the OSD texture): the drifting loop clip if animation is on and
   * one was rendered for this look, otherwise a still image painted here.
   * AirPlay shares it, so switching screens doesn't load another file.
   */
  async #updateBackdrop() {
    const s = this.settings.get();
    const t = screens.look(s);
    const key = `${t.accent} ${s.bootAnimation}`;
    if (key === this.backdropKey) return;
    this.backdropKey = key;
    try {
      const file = (s.bootAnimation && backgroundClip(t)) || await backgroundPng(t);
      if (this.backdropKey === key) this.playback.setBackground(file);
    } catch (e) {
      this.log.warn('TV background image failed:', e.message);
    }
  }

  /** Shows a short message; `dot` = color of a dot in front of it, `sound` = UI sound to play. */
  toast(text, { dot = null, sound = 'notify' } = {}) {
    this.message = { text, dot, until: Date.now() + TOAST_MS };
    this.sounds.play(sound);
    this.render();
  }

  /**
   * Remote keys for the settings panel: 'up' 'down' 'left' 'right' 'ok' 'back'.
   * Returns true if the key was used (OK on the home screen opens the panel).
   */
  key(k) {
    if (!this.panel.open) {
      if (k !== 'ok' || this.screen() !== 'home') return false;
      this.panel = { open: true, focus: 0, powerConfirm: null };
      this.playback.holdBackground('panel', true);
      this.sounds.play('open');
      this.render();
      return true;
    }
    const rows = screens.PANEL_ROWS;
    const row = rows[this.panel.focus];
    const { focus } = this.panel;
    if (row.key === 'power' && (k === 'ok' || k === 'left' || k === 'right')) {
      if (k === 'ok') this.#powerKey();
      return true;
    }
    this.#cancelPower();
    switch (k) {
      case 'up': this.panel.focus = Math.max(0, focus - 1); break;
      case 'down': this.panel.focus = Math.min(rows.length - 1, focus + 1); break;
      case 'left': this.#change(row.key, -1); break;
      case 'right': this.#change(row.key, 1); break;
      case 'ok': this.#change(row.key, 1); break;
      case 'back': this.panel.open = false; break;
      default: return false;
    }
    if (k === 'back') this.sounds.play('close');
    else if (k === 'up' || k === 'down') { if (this.panel.focus !== focus) this.sounds.play('move'); }
    else this.sounds.play('select');
    this.render();
    return true;
  }

  /** OK on the power row: the first asks, the second (within a few seconds) powers off. */
  #powerKey() {
    if (this.panel.powerConfirm) {
      this.#cancelPower();
      this.panel.open = false;
      this.toast(screens.look(this.settings.get()).tr('poweringOff'), { sound: 'select' });
      this.powerOff?.();
      return;
    }
    this.sounds.play('select');
    this.panel.powerConfirm = setTimeout(() => {
      this.panel.powerConfirm = null;
      this.render();
    }, POWER_CONFIRM_MS);
    this.render();
  }

  #cancelPower() {
    clearTimeout(this.panel.powerConfirm);
    this.panel.powerConfirm = null;
  }

  #change(key, dir) {
    const s = this.settings.get();
    const cycle = (list, current) => list[(list.indexOf(current) + dir + list.length) % list.length];
    let patch;
    if (key === 'accent') {
      const list = Object.keys(ACCENTS);
      if (s.accent === 'custom') list.push('custom');
      patch = { accent: cycle(list, s.accent) };
    } else if (key === 'language') {
      patch = { language: cycle(Object.keys(LANGUAGES), s.language) };
    } else {
      patch = { [key]: !s[key] };
    }
    this.settings.update(patch).catch((e) => this.log.warn('TV settings change failed:', e.message));
  }

  async #onStarted() {
    const { mpv } = this;
    if (this.reels.active) return; // Reels show their own info
    let quality = null;
    try {
      const [height, fps] = await Promise.all([mpv.get('height'), mpv.get('container-fps').catch(() => null)]);
      if (height) quality = `${height}p${fps >= 49 ? Math.round(fps) : ''}`;
    } catch { /* audio-only or not known yet */ }
    this.card = { until: Date.now() + POPUP_MS, quality };
    this.#prepareThumbnail();
    this.render();
  }

  /** The AirPlay cover as a bitmap in real screen pixels, with rounded corners. */
  async #prepareCover(image) {
    this.cover = { image, want: null };
    if (!image) return;
    try {
      const s = ((await this.mpv.get('osd-height')) || screens.H) / screens.H;
      const c = screens.AIRPLAY_COVER;
      const size = Math.round(c.size * s);
      const file = await coverBgra(image, size, Math.round(c.r * s));
      if (this.cover.image !== image) return;
      this.cover.want = { file, x: Math.round(c.x * s), y: Math.round(c.y * s), w: size, h: size };
      this.render();
    } catch (e) {
      this.log.debug('AirPlay cover failed:', e.message);
    }
  }

  async #prepareThumbnail() {
    const url = this.playback.source?.thumbnail;
    this.thumb.want = null;
    if (!url) return;
    try {
      // Bitmaps are placed in real screen pixels, so scale the 1080p layout.
      const osdH = (await this.mpv.get('osd-height')) || screens.H;
      const s = osdH / screens.H;
      const box = screens.cardLayout(true).thumb;
      const w = Math.round(box.w * s);
      const h = Math.round(box.h * s);
      const file = await thumbnailBgra(url, w, h);
      if (this.playback.source?.thumbnail !== url) return;
      this.thumb.want = { file, x: Math.round(box.x * s), y: Math.round(box.y * s), w, h };
      this.render();
    } catch (e) {
      this.log.debug('thumbnail failed:', e.message);
    }
  }

  /** Schedules a redraw; several changes in a row collapse into one. */
  render() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.#draw().catch((e) => this.log.debug('TV draw failed:', e.message));
    }, 30);
  }

  async #draw() {
    if (!this.mpv.socket) return; // redrawn on 'ready'
    const now = Date.now();
    const s = this.settings.get();
    const t = screens.look(s);
    const screen = this.screen();
    const status = this.playback.status();
    // While switching videos the old one keeps playing under the loading card.
    const p = this.mpv.props;
    const overVideo = screen === 'buffering' || (screen === 'loading' && !p['idle-active'] && !this.playback.background.showing);
    const onHome = screen === 'home' || (screen === 'loading' && !overVideo);
    if (screen !== 'home') this.panel.open = false;

    const fade = (until) => (until > now ? Math.min(1, (until - now) / FADE_MS) : 0);
    if (this.sender && this.sender.until <= now) this.sender = null;
    // mpv's property updates can trail file-loaded, so only drop the card once
    // it's clearly gone (paused, or back home).
    if (this.card && (this.card.until <= now || screen === 'paused' || screen === 'home')) this.card = null;
    if (this.message && this.message.until <= now) this.message = null;

    // The home screen's backdrop is mpv's own background color: a full-screen
    // overlay would take half of the Pi 3's overlay texture (see screens.js).
    await this.#setBackground(onHome || ['loading', 'reels', 'airplay'].includes(screen) ? t.bg : '#000000');
    this.#updateBackdrop();
    // AirPlay's progress redraws every second, so its backdrop holds still like the panel's.
    if (screen === 'airplay') this.playback.holdBackground('airplay', true);

    const layers = {
      home: null, loading: null, reels: null, popup: null, pause: null, panel: null, toast: null,
    };
    const sender = status.owner === 'cast' ? this.cast.senders()[0] : null;
    if (overVideo) {
      layers.loading = screens.loadingOverVideo(t, screen === 'buffering' ? 'buffering' : 'loading', { ...status, sender });
    }
    if (onHome) {
      layers.home = screens.home(t, {
        now: new Date(now),
        clock24: s.clock24,
        net: this.net,
        pairingCode: this.cast.pairingCode,
        qr: this.qr,
        deviceName: s.deviceName,
        loading: screen === 'loading' ? { ...status, sender } : null,
        panelOpen: this.panel.open,
        weather: this.weather.data,
        keys: Object.entries(KEY_COLORS).filter(([color]) => s.shortcuts[color]).map(([color, hex]) => ({
          hex, name: s.shortcuts[color].name, live: this.twitchLive.isLive(s.shortcuts[color].url),
        })),
        instagram: !!this.instagram.state.user,
      });
    }
    // AirPlay takes the home screen's layer; the position runs on locally between updates.
    const air = this.airplay.state;
    if (screen === 'airplay') {
      const position = air.position + (air.playing && air.at ? (now - air.at) / 1000 : 0);
      layers.home = screens.airplay(t, {
        now: new Date(now),
        clock24: s.clock24,
        item: { ...air, position: Math.min(position, air.duration || position) },
      });
    }
    const popup = [];
    if (this.card) {
      popup.push(...screens.nowPlaying(t, {
        ...status, quality: this.card.quality, withThumb: !!status.thumbnail,
      }, fade(this.card.until)));
    }
    if (this.sender) popup.push(...screens.senderPill(t, this.sender.name, fade(this.sender.until)));
    if (popup.length) layers.popup = popup;
    if (screen === 'paused') layers.pause = screens.paused(t, status);
    const pulse = screen === 'reels' ? 1 - (now - this.reels.likedAt) / PULSE_MS : 0;
    if (screen === 'reels') {
      layers.reels = screens.reels(t, {
        reel: this.reels.current,
        paused: !!status.url && !status.loading && !!p.pause,
        pulse: Math.max(0, pulse),
      });
    }
    if (this.panel.open) {
      const ids = Object.keys(ACCENTS);
      if (s.accent === 'custom') ids.push('custom');
      layers.panel = screens.settingsPanel(t, {
        settings: s,
        focus: this.panel.focus,
        powerConfirm: !!this.panel.powerConfirm,
        swatches: ids.map((id) => ({
          id, hex: id === 'custom' ? s.customAccent : ACCENTS[id].hex, selected: id === s.accent,
        })),
      });
    }
    if (this.message) layers.toast = screens.toast(t, this.message.text, this.message.dot);

    for (const [name, events] of Object.entries(layers)) {
      await this.#send(name, events ? events.join('\n') : null);
    }
    // The backdrop moves again once the panel or AirPlay is gone: a little later,
    // since mpv's redraw without it mustn't meet the clip starting to move.
    clearTimeout(this.unholdTimer);
    const unhold = () => {
      if (!this.panel.open) this.playback.holdBackground('panel', false);
      if (this.screen() !== 'airplay') this.playback.holdBackground('airplay', false);
    };
    if ((!this.panel.open && this.playback.holds.has('panel'))
      || (screen !== 'airplay' && this.playback.holds.has('airplay'))) {
      this.unholdTimer = setTimeout(unhold, UNHOLD_MS);
    }
    // Reels: the dots sit in the middle, where the next Reel will be.
    const reelLoading = screen === 'reels' && (!this.reels.current || status.loading);
    this.#animateDots(screen === 'loading' || screen === 'buffering' || reelLoading ? t : null,
      screen === 'reels' ? screens.H / 2 : undefined);

    // Thumbnail: only while the card is fully visible (bitmaps can't fade).
    const thumb = screen === 'airplay' ? this.cover.want
      : this.card && fade(this.card.until) >= 1 ? this.thumb.want : null;
    await this.#showThumbnail(thumb);

    // Wake up again for fades and expiries.
    const deadlines = [this.card?.until, this.sender?.until, this.message?.until].filter(Boolean);
    clearTimeout(this.timer);
    if (pulse > 0) {
      this.timer = setTimeout(() => this.render(), 120);
    } else if (screen === 'airplay' && air.playing && air.duration) {
      // The progress, once a second.
      this.timer = setTimeout(() => this.render(), 1000 - ((now - air.at) % 1000) + 20);
    } else if (deadlines.length) {
      const next = Math.min(...deadlines);
      const wait = next - now > FADE_MS ? next - now - FADE_MS : 120;
      this.timer = setTimeout(() => this.render(), wait);
    }
  }

  /** Keeps the loading dots pulsing while `t` is set, at height `y`; clears them otherwise. */
  #animateDots(t, y) {
    this.dotsTheme = t;
    this.dotsY = y;
    if (!t) {
      clearInterval(this.dotsTimer);
      this.dotsTimer = null;
      this.#send('dots', null);
      return;
    }
    const tick = () => {
      const phase = (Date.now() % DOTS_CYCLE_MS) / DOTS_CYCLE_MS;
      this.#send('dots', screens.dots(this.dotsTheme, phase, screens.W / 2, this.dotsY).join('\n'));
    };
    if (!this.dotsTimer) {
      tick();
      this.dotsTimer = setInterval(tick, DOTS_MS);
    }
  }

  /** What's drawn now, layer by layer, for the log: "home 41 events 9 kB, toast 2 events 0 kB". */
  layerSummary() {
    return Object.entries(this.sent).filter(([name, data]) => LAYERS[name] && data)
      .map(([name, data]) => `${name} ${data.split('\n').length} events ${Math.round(data.length / 1024)} kB`).join(', ') || 'none';
  }

  async #send(name, data) {
    if (this.sent[name] === data) return;
    const { id, z } = LAYERS[name];
    try {
      if (data === null) await this.mpv.clearOverlay({ id });
      else await this.mpv.showOverlay(data, { id, z });
      this.sent[name] = data;
    } catch (e) {
      delete this.sent[name]; // retried on the next draw
      this.log.warn(`TV overlay "${name}" failed:`, e.message);
    }
  }

  async #setBackground(color) {
    if (this.sent.background === color) return;
    try {
      await this.mpv.set('background-color', color);
      this.sent.background = color;
    } catch (e) {
      this.log.warn('TV background failed:', e.message);
    }
  }

  async #showThumbnail(want) {
    const shown = this.thumb.shown;
    if (shown?.file === want?.file && shown?.x === want?.x) return;
    try {
      if (want) {
        await this.mpv.command('overlay-add', THUMB_OVERLAY, want.x, want.y, want.file, 0, 'bgra', want.w, want.h, want.w * 4);
      } else {
        await this.mpv.command('overlay-remove', THUMB_OVERLAY);
      }
      this.thumb.shown = want;
    } catch (e) {
      this.log.debug('thumbnail overlay failed:', e.message);
    }
  }

  #tickClock() {
    const now = new Date();
    const wait = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(() => {
      if (this.screen() === 'home' || this.screen() === 'airplay') this.render();
      this.#tickClock();
    }, wait);
  }

  async #pollNetwork() {
    try {
      const net = await networkStatus();
      if (JSON.stringify(net) !== JSON.stringify(this.net)) {
        this.net = net;
        this.render();
      }
    } catch { /* keep the last known state */ }
    setTimeout(() => this.#pollNetwork(), this.screen() === 'home' ? 30000 : 120000);
  }
}
