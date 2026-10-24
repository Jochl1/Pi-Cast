import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ROOT } from './config.js';

const OBSERVED = ['pause', 'time-pos', 'duration', 'volume', 'mute', 'idle-active', 'media-title'];
const SCRIPTS_DIR = path.join(ROOT, 'mpv-scripts');

/**
 * Runs a single long-lived mpv instance (idle, fullscreen on the TV) and
 * talks to it over its JSON IPC socket. Restarts mpv if it crashes.
 *
 * Events: 'property' (name, value), 'end-file' (reason), 'start-file', 'file-loaded', 'ready'
 */
export default class Mpv extends EventEmitter {
  constructor(config, log) {
    super();
    this.config = config;
    this.log = log;
    this.props = {
      pause: false, 'time-pos': 0, duration: 0, volume: 100, mute: false,
      'idle-active': true, 'media-title': null,
    };
    this.pending = new Map();
    this.nextId = 1;
    this.socket = null;
    this.proc = null;
    this.shuttingDown = false;
    this.restartDelay = 2000;
    this.restartTimer = null;
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

  #scheduleRestart(why) {
    if (this.shuttingDown || this.restartTimer) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(delay * 2, 60000);
    this.log.error(`mpv ${why}, restarting in ${delay / 1000}s`);
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
    const { mpvPath, mpvSocket, mpvHwdec, ytdlPath, mpvExtraArgs } = this.config;
    if (process.platform !== 'win32') fs.rmSync(mpvSocket, { force: true });

    const scripts = fs.existsSync(SCRIPTS_DIR)
      ? fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.lua')).map((f) => `--script=${path.join(SCRIPTS_DIR, f)}`)
      : [];

    const args = [
      `--include=${path.join(ROOT, 'deploy', 'mpv.conf')}`,
      '--idle=yes',
      '--force-window=yes',
      '--no-terminal',
      `--input-ipc-server=${mpvSocket}`,
      `--hwdec=${mpvHwdec}`,
      `--script-opts-append=ytdl_hook-ytdl_path=${ytdlPath}`,
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
    switch (msg.event) {
      case 'property-change':
        this.props[msg.name] = msg.data ?? null;
        this.emit('property', msg.name, msg.data);
        break;
      case 'end-file':
        this.log.debug('mpv end-file', msg.reason, msg.file_error ?? '');
        this.emit('end-file', msg.reason);
        break;
      case 'start-file':
      case 'file-loaded':
        this.emit(msg.event);
        break;
    }
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

  set(name, value) {
    return this.command('set_property', name, value);
  }

  async load(url, { start = 0 } = {}) {
    // 'start' is a global option, so reset it on every load.
    await this.set('start', start > 0 ? String(start) : 'none');
    await this.set('pause', false);
    await this.command('loadfile', url, 'replace');
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
