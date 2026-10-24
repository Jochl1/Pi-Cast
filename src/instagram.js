import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT, DATA_DIR } from './config.js';

const WORKER = path.join(ROOT, 'bin', 'insta.py');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const SESSION = path.join(DATA_DIR, 'instagram.json');
// A login can wait minutes for the security code (bin/insta.py gives up after 5).
const LOGIN_TIMEOUT_MS = 6 * 60 * 1000;
const TIMEOUT_MS = 60000;

/**
 * Instagram through bin/insta.py, a Python worker (instagrapi) that stays
 * running like the yt-dlp worker. Keeps the login state for the web app.
 *
 * state: { available, user, busy, code, error }
 *  - user: the logged-in username or null
 *  - busy: true while a login runs
 *  - code: 'email' | 'sms' | '2fa' while Instagram waits for a security code
 *  - error: the last login's error code (badPassword, challenge, wait, ...)
 *
 * Failed requests reject with an Error whose `code` is the worker's error
 * code; 'loggedOut' means the session is gone and the user must log in again.
 *
 * Events: 'change' (state)
 */
export default class Instagram extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.restartDelay = 2000;
    this.stopped = false;
    this.state = { available: false, user: null, busy: false, code: null, error: null };
  }

  start() {
    if (!fs.existsSync(PYTHON)) {
      this.log.info('Instagram disabled (no .venv)');
      return;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const proc = spawn(PYTHON, [WORKER, SESSION], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.#onLine(line));
    proc.stderr.on('data', (d) => this.log.debug('[instagram]', d.toString().trim()));
    proc.on('error', (e) => this.log.warn('Instagram worker failed to start:', e.message));
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null;
      for (const p of this.pending.values()) p.reject(new Error('Instagram worker exited'));
      this.pending.clear();
      this.#set({ available: false, busy: false, code: null });
      if (this.stopped) return;
      this.log.warn(`Instagram worker exited (code ${code}, signal ${signal}), restarting in ${this.restartDelay / 1000}s`);
      setTimeout(() => this.start(), this.restartDelay).unref();
      this.restartDelay = Math.min(this.restartDelay * 2, 60000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  /** Starts a login with { username, password } or { sessionid }; the outcome shows up in `state`. */
  login(credentials) {
    if (this.state.busy) throw Object.assign(new Error('A login is already running'), { status: 409 });
    this.#set({ busy: true, error: null });
    this.#request({ op: 'login', ...credentials }, LOGIN_TIMEOUT_MS)
      .then(({ user }) => {
        this.log.info(`Instagram: logged in as ${user}`);
        this.#set({ user, busy: false });
      })
      .catch((e) => {
        this.log.warn(`Instagram login failed: ${e.message}`);
        this.#set({ busy: false, error: e.code ?? 'error' });
      });
  }

  /** The security code Instagram sent; null cancels the login. */
  code(code) {
    return this.#request({ op: 'code', code });
  }

  async logout() {
    await this.#request({ op: 'logout' });
    this.log.info('Instagram: logged out');
    this.#set({ user: null, error: null });
  }

  /** The next page of the Reels feed: { reels: [...], more }. `fresh` starts from the top. */
  reels({ fresh = false } = {}) {
    return this.#request({ op: 'reels', fresh });
  }

  like(media, on) {
    return this.#request({ op: 'like', media, on });
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  #request(req, timeoutMs = TIMEOUT_MS) {
    if (!this.proc) return Promise.reject(Object.assign(new Error('Instagram worker not running'), { code: 'unavailable' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('Instagram worker timed out'), { code: 'error' }));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(`${JSON.stringify({ id, ...req })}\n`);
    });
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return this.log.debug('[instagram]', line);
    }
    if (msg.ready) {
      this.restartDelay = 2000;
      this.log.info(`Instagram worker ready${msg.user ? ` (${msg.user})` : ''}`);
      return this.#set({ available: true, user: msg.user });
    }
    if (msg.event === 'code') return this.#set({ code: msg.method });
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) return p.resolve(msg);
    if (msg.error === 'loggedOut' && this.state.user) {
      this.log.warn('Instagram: the session is gone');
      this.#set({ user: null });
    }
    p.reject(Object.assign(new Error(msg.message || msg.error), { code: msg.error }));
  }
}
