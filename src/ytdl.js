import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT } from './config.js';

const WORKER = path.join(ROOT, 'bin', 'ytdl.py');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const TIMEOUT_MS = 90000;
// Stream URLs stay valid for hours; this only covers casting the same video again.
const CACHE_MS = 20 * 60 * 1000;

/**
 * A long-running yt-dlp (bin/ytdl.py worker) that resolves YouTube links to
 * direct stream URLs. Starting yt-dlp costs ~6 s on a Pi 3, which mpv's ytdl
 * hook pays on every video; this pays it once. If the worker can't be used,
 * resolve() rejects and the caller falls back to mpv's hook.
 *
 * Resolves to { title, duration, live, height, video: { url, headers }, audio }.
 */
export default class Ytdl {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.cache = new Map();
    this.restartDelay = 2000;
    this.stopped = false;
  }

  start() {
    if (!fs.existsSync(PYTHON)) {
      this.log.info('yt-dlp worker disabled (no .venv), using mpv\'s ytdl hook');
      return;
    }
    const proc = spawn(PYTHON, [WORKER, 'worker', this.config.ytdlFormat], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.#onLine(line));
    proc.stderr.on('data', (d) => this.log.debug('[yt-dlp]', d.toString().trim()));
    proc.on('error', (e) => this.log.warn('yt-dlp worker failed to start:', e.message));
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null;
      for (const p of this.pending.values()) p.reject(new Error('yt-dlp worker exited'));
      this.pending.clear();
      if (this.stopped) return;
      this.log.warn(`yt-dlp worker exited (code ${code}, signal ${signal}), restarting in ${this.restartDelay / 1000}s`);
      setTimeout(() => this.start(), this.restartDelay).unref();
      this.restartDelay = Math.min(this.restartDelay * 2, 60000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  resolve(url) {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.result);
    if (!this.proc) return Promise.reject(new Error('yt-dlp worker not running'));

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('yt-dlp worker timed out'));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          if (!result.live) this.cache.set(url, { result, at: Date.now() });
          resolve(result);
        },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(`${JSON.stringify({ id, url })}\n`);
    });
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return this.log.debug('[yt-dlp]', line);
    }
    if (msg.ready) {
      this.restartDelay = 2000;
      return this.log.info('yt-dlp worker ready');
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error));
  }
}

/** mpv EDL that plays a separate video and audio stream as one file. */
export function edl(video, audio) {
  if (!audio) return video;
  const part = (u) => `!no_clip;!no_chapters;%${Buffer.byteLength(u)}%${u}`;
  return `edl://${part(video)};!new_stream;${part(audio)}`;
}
