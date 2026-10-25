import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';

const SOUNDS_DIR = path.join(ROOT, 'assets', 'sounds');
const HELPER = path.join(ROOT, 'bin', 'sounds.py');
// The startup sound only plays at boot if the home screen shows this soon after it.
const BOOT_WINDOW_S = 300;
const REPLY_TIMEOUT_MS = 2000;

/**
 * UI sounds and the startup sound, played by bin/sounds.py.
 *
 * The HDMI audio device takes one program at a time, so the helper only holds
 * it while nothing plays and mpv's audio output is closed; mpv.beforeLoad
 * makes it let go before mpv opens anything that may have sound. So there are
 * no UI sounds during videos (or over a paused one). It also keeps off the
 * device while an AirPlay session is on (shairport-sync plays by itself).
 */
export default class Sounds {
  constructor({ config, mpv, playback, airplay, settings, log }) {
    Object.assign(this, { mpv, playback, airplay, settings, log });
    // mpv's ALSA device ('alsa/hdmi:...') without the 'alsa/' prefix.
    const dev = config.mpvAudioDevice?.startsWith('alsa/') ? config.mpvAudioDevice.slice(5) : 'default';
    this.device = `plug:'${dev}'`;
    this.proc = null;
    this.held = false;
    this.busy = null; // the open/close in flight
    this.replies = [];
    this.endsAt = 0; // when the sound playing now ends
    this.startupPending = false;
    this.disabled = process.platform === 'win32' || !fs.existsSync(HELPER);
  }

  start() {
    if (this.disabled) return;
    this.mpv.beforeLoad = () => this.#release();
    for (const emitter of [this.mpv, this.playback, this.airplay]) {
      emitter.on(emitter === this.mpv ? 'property' : 'change', () => this.#update());
    }
    this.#spawn();
  }

  /** Plays assets/sounds/<name>.wav if the device is free and sounds are on. */
  play(name) {
    if (!this.held || !this.settings.get().sounds) return;
    const file = path.join(SOUNDS_DIR, `${name}.wav`);
    if (!fs.existsSync(file)) return;
    this.#write(`play ${file}`);
    // 48 kHz stereo 16-bit, minus the 44-byte header.
    this.endsAt = Date.now() + ((fs.statSync(file).size - 44) / 192000) * 1000;
  }

  /** The home screen is up for the first time: the startup sound, if that's right after boot. */
  booted() {
    if (os.uptime() < BOOT_WINDOW_S) this.startup();
  }

  /** Plays the startup sound as soon as the device is free (e.g. when the TV comes back on). */
  startup() {
    this.startupPending = true;
    if (this.held && !this.busy) {
      this.startupPending = false;
      this.play('startup');
    }
  }

  /** True while the device may be held: nothing playing, mpv's audio closed and no AirPlay. */
  #free() {
    return !this.playback.source && !this.mpv.props['current-ao'] && !this.airplay.state.active;
  }

  #update() {
    // Once something plays, the startup sound's moment has passed.
    if (this.playback.source) this.startupPending = false;
    if (!this.proc || this.busy) return;
    if (this.#free() && !this.held) this.#open();
    else if (!this.#free() && this.held) this.#release();
  }

  async #open() {
    this.busy = this.#ask('open');
    const reply = await this.busy;
    this.busy = null;
    this.held = reply === 'opened';
    if (reply?.startsWith('error')) this.log.warn(`UI sounds: ${reply.slice(6)}`);
    if (this.held && this.startupPending) {
      this.startupPending = false;
      this.play('startup');
    }
    this.#update(); // things may have changed meanwhile
  }

  /** Lets go of the device; a sound that's still playing (at most 1 s more) finishes first. */
  async #release() {
    while (this.busy) await this.busy;
    if (!this.held || !this.proc) return;
    this.busy = (async () => {
      const left = this.endsAt - Date.now();
      if (left > 0) await new Promise((r) => setTimeout(r, Math.min(left, 1000)));
      await this.#ask('close');
      this.held = false;
    })();
    await this.busy;
    this.busy = null;
    this.#update();
  }

  /** Sends a command and resolves with the helper's reply (null if it doesn't answer). */
  #ask(cmd) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.replies = this.replies.filter((r) => r !== done);
        resolve(null);
      }, REPLY_TIMEOUT_MS);
      const done = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.replies.push(done);
      this.#write(cmd);
    });
  }

  #write(line) {
    this.proc?.stdin.write(`${line}\n`);
  }

  #spawn() {
    const proc = spawn('python3', [HELPER, this.device], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    let buffer = '';
    proc.stdout.on('data', (d) => {
      buffer += d.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('warn ')) this.log.warn(`UI sounds: ${line.slice(5)}`);
        else this.replies.shift()?.(line);
      }
    });
    proc.stderr.on('data', (d) => this.log.warn('[sounds]', d.toString().trim()));
    proc.stdin.on('error', () => { /* handled on exit */ });
    proc.on('error', (e) => this.log.warn('UI sounds helper failed to start:', e.message));
    proc.on('exit', (code) => {
      this.proc = null;
      this.held = false;
      for (const r of this.replies.splice(0)) r(null);
      this.log.warn(`UI sounds helper exited (${code}), restarting in 5 s`);
      setTimeout(() => this.#spawn(), 5000);
    });
    this.#update();
  }
}
