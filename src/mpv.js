import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ROOT } from './config.js';

// time-pos isn't observed: it changes every frame, which is a lot of IPC
// traffic for a Pi 3. It's polled once a second during playback instead.
// current-ao is set while mpv has the audio device open; icy-title is a radio stream's song.
const ICY = 'metadata/by-key/icy-title';
const OBSERVED = ['pause', 'duration', 'volume', 'mute', 'idle-active', 'media-title', 'paused-for-cache', 'current-ao', ICY];
const SCRIPTS_DIR = path.join(ROOT, 'mpv-scripts');

/**
 * Runs a single long-lived mpv instance (idle, fullscreen on the TV) and
 * talks to it over its JSON IPC socket. Restarts mpv if it crashes.
 *
 * Events: 'property' (name, value), 'end-file' (reason, playlist entry id),
 * 'start-file' (playlist entry id), 'file-loaded',
 * 'playback-restart' (first frame after a load or seek), 'ready',
 * 'log' (text of an mpv error message)
 * ('property' also fires for the polled 'time-pos')
 */
export default class Mpv extends EventEmitter {
  constructor(config, log) {
    super();
    this.config = config;
    this.log = log;
    this.props = {
      pause: false, 'time-pos': 0, duration: 0, volume: 100, mute: false,
      'idle-active': true, 'media-title': null, 'paused-for-cache': false, 'current-ao': null, [ICY]: null,
    };
    // Awaited before loading anything that may have sound (the UI sounds let go of the device).
    this.beforeLoad = null;
    // Decides which scripts in mpv-scripts/ get loaded (e.g. SponsorBlock on/off).
    this.scriptFilter = () => true;
    this.quickRestart = false;
    setInterval(() => this.#pollPosition(), 1000);
    this.pending = new Map();
    this.nextId = 1;
    this.socket = null;
    this.proc = null;
    this.shuttingDown = false;
    this.restartDelay = 2000;
    this.restartTimer = null;
    this.lastLog = null;
  }

  /** Starts mpv. Never throws: failures are logged and retried with backoff. */
  async start() {
    this.#spawn();
    try {
      await this.#connect();
      this.restartDelay = 2000;
    } catch (e) {
      // A running-but-unreachable mpv gets killed; its 'exit' schedules the restart.
      if (this.proc?.pid !== undefined && this.proc.exitCode === null) {
        this.log.error(e.message);
        this.proc.kill();
      }
    }
  }

  /** Restarts mpv on purpose, e.g. to load a different set of scripts. */
  async restart() {
    this.log.info('restarting mpv');
    this.quickRestart = true;
    try { await this.command('quit'); } catch { this.proc?.kill(); }
  }

  #scheduleRestart(why) {
    if (this.shuttingDown || this.restartTimer) return;
    let delay = 100;
    if (this.quickRestart) {
      this.quickRestart = false;
    } else {
      delay = this.restartDelay;
      this.restartDelay = Math.min(delay * 2, 60000);
      this.log.error(`mpv ${why}, restarting in ${delay / 1000}s`);
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delay);
  }

  async shutdown() {
    this.shuttingDown = true;
    try { await this.command('quit'); } catch { /* already gone */ }
    this.proc?.kill();
  }

  #spawn() {
    const { mpvPath, mpvSocket, mpvHwdec, mpvAudioDevice, ytdlPath, ytdlFormat, mpvExtraArgs } = this.config;
    if (process.platform !== 'win32') fs.rmSync(mpvSocket, { force: true });

    const scripts = fs.existsSync(SCRIPTS_DIR)
      ? fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.lua') && this.scriptFilter(f)).map((f) => `--script=${path.join(SCRIPTS_DIR, f)}`)
      : [];

    const args = [
      `--include=${path.join(ROOT, 'deploy', 'mpv.conf')}`,
      '--idle=yes',
      '--force-window=yes',
      '--no-terminal',
      `--input-ipc-server=${mpvSocket}`,
      `--hwdec=${mpvHwdec}`,
      ...(mpvAudioDevice ? [`--audio-device=${mpvAudioDevice}`] : []),
      `--script-opts-append=ytdl_hook-ytdl_path=${ytdlPath}`,
      `--ytdl-format=${ytdlFormat}`,
      ...scripts,
      ...mpvExtraArgs,
    ];
    this.log.debug('spawning mpv', args.join(' '));
    const proc = spawn(mpvPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
    proc.stderr.on('data', (d) => this.log.debug('[mpv]', d.toString().trim()));
    proc.on('error', (e) => {
      this.#dropSocket();
      this.#scheduleRestart(`failed to start (${e.message})`);
    });
    proc.on('exit', (code, signal) => {
      this.#dropSocket();
      this.#scheduleRestart(`exited (code ${code}, signal ${signal})`);
    });
  }

  #dropSocket() {
    this.socket?.destroy();
    this.socket = null;
  }

  async #connect() {
    const deadline = Date.now() + 10000;
    const proc = this.proc;
    for (;;) {
      if (this.proc !== proc || proc.exitCode !== null || proc.pid === undefined) {
        throw new Error('mpv is not running');
      }
      try {
        this.socket = await new Promise((resolve, reject) => {
          const s = net.createConnection(this.config.mpvSocket, () => resolve(s));
          s.once('error', reject);
        });
        break;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`could not connect to mpv IPC: ${e.message}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    let buffer = '';
    this.socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) this.#onMessage(JSON.parse(line));
      }
    });
    this.socket.on('error', (e) => this.log.warn('mpv socket error:', e.message));
    this.socket.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('mpv connection closed'));
      this.pending.clear();
    });

    await Promise.all(OBSERVED.map((name, i) => this.command('observe_property', i + 1, name)));
    // mpv reports some failures only in its log, e.g. overlays that don't fit
    // the GPU's texture size (they're then silently not drawn).
    await this.command('request_log_messages', 'error');
    this.log.info('mpv ready');
    this.emit('ready');
  }

  #onMessage(msg) {
    if (msg.request_id !== undefined) {
      const p = this.pending.get(msg.request_id);
      if (!p) return;
      this.pending.delete(msg.request_id);
      if (msg.error === 'success') p.resolve(msg.data);
      else p.reject(new Error(`mpv: ${msg.error}`));
      return;
    }
    // Events go out after the code awaiting a reply has run, even when both
    // arrive in one chunk: e.g. loadfile's playlist_entry_id is known before
    // that file's start-file is handled.
    setImmediate(() => this.#onEvent(msg));
  }

  #onEvent(msg) {
    switch (msg.event) {
      case 'property-change':
        this.props[msg.name] = msg.data ?? null;
        this.emit('property', msg.name, msg.data);
        break;
      case 'end-file':
        this.log.debug('mpv end-file', msg.reason, msg.file_error ?? '');
        this.emit('end-file', msg.reason, msg.playlist_entry_id);
        break;
      case 'start-file':
        this.emit('start-file', msg.playlist_entry_id);
        break;
      case 'file-loaded':
      case 'playback-restart':
        this.emit(msg.event);
        break;
      case 'log-message':
        this.#onLog(`${msg.prefix}: ${msg.text.trim()}`);
        break;
    }
  }

  #onLog(text) {
    // Harmless: mpv runs as a service, without a terminal.
    if (text.includes("Can't open TTY for VT control")) return;
    // Some errors repeat on every frame; log each one at most once a minute.
    const now = Date.now();
    if (this.lastLog?.text === text && now - this.lastLog.at < 60000) return;
    this.lastLog = { text, at: now };
    this.log.warn('[mpv]', text);
    this.emit('log', text);
  }

  /** Send a command. Pass positional args, or a single object for named-argument commands. */
  command(...args) {
    if (!this.socket) return Promise.reject(new Error('mpv not connected'));
    const request_id = this.nextId++;
    const command = args.length === 1 && typeof args[0] === 'object' ? args[0] : args;
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject });
      this.socket.write(JSON.stringify({ command, request_id }) + '\n');
    });
  }

  get(name) {
    return this.command('get_property', name);
  }

  async #pollPosition() {
    if (!this.socket || this.props['idle-active']) return;
    try {
      const pos = await this.get('time-pos');
      this.props['time-pos'] = pos ?? 0;
      this.emit('property', 'time-pos', pos);
    } catch { /* not available while loading */ }
  }

  set(name, value) {
    return this.command('set_property', name, value);
  }

  /**
   * `headers`: HTTP header lines ("Name: value") for the stream requests.
   * `audio`: false for files without sound (the backdrop).
   * Resolves to the new playlist entry's id.
   */
  /** `external`: a file whose video plays along (a radio stream over the backdrop). */
  async load(url, {
    start = 0, title = '', headers = [], loop = false, audio = true, external = null,
  } = {}) {
    if (audio) await this.beforeLoad?.();
    // These are global options, so reset them on every load.
    await this.set('start', start > 0 ? String(start) : 'none');
    await this.set('force-media-title', title);
    await this.set('http-header-fields', headers);
    await this.set('loop-file', loop ? 'inf' : 'no');
    await this.set('external-files', external ? [external] : []);
    await this.set('speed', 1);
    await this.set('pause', false);
    const result = await this.command('loadfile', url, 'replace');
    return result?.playlist_entry_id ?? null;
  }

  stop() { return this.command('stop'); }
  pause() { return this.set('pause', true); }
  resume() { return this.set('pause', false); }
  seek(seconds) { return this.command('seek', seconds, 'absolute'); }
  setVolume(level) { return this.set('volume', Math.max(0, Math.min(100, level))); }
  setMute(muted) { return this.set('mute', muted); }

  /**
   * Text/shape overlay in ASS markup, laid out on a 1920x1080 canvas
   * regardless of the real screen size. Higher z draws on top.
   */
  showOverlay(ass, { id = 1, z = 0 } = {}) {
    return this.command({
      name: 'osd-overlay', id, format: 'ass-events', data: ass, res_x: 1920, res_y: 1080, z,
    });
  }

  clearOverlay({ id = 1 } = {}) {
    return this.command({ name: 'osd-overlay', id, format: 'none', data: '' });
  }
}
