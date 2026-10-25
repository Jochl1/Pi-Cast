import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const PIPE = '/tmp/shairport-sync-metadata';
const COVER_DIR = path.join(DATA_DIR, 'airplay');
const RATE = 44100; // AirPlay's RTP clock
const RETRY_MS = 3000;
const RTSP_PORT = 5000; // shairport-sync's default for classic AirPlay

/**
 * AirPlay audio through shairport-sync, which plays on its own; this reads
 * its metadata pipe (shairport-sync.conf: metadata enabled, with cover art).
 *
 * state: { active, playing, title, artist, album, cover, position, duration, at }
 *  - active: an AirPlay session is on (shairport-sync wants the audio device)
 *  - cover: path of the cover image, or null
 *  - position/duration in seconds, as of `at` (Date.now())
 *
 * Events: 'change' (state); 'session' (true/false) when a session starts or ends.
 */
export default class AirPlay extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.state = {
      active: false, playing: false, title: null, artist: null, album: null, cover: null, position: 0, duration: 0, at: 0,
    };
    this.pending = {}; // track fields until the metadata bundle ends
    this.coverN = 0;
    this.buf = '';
  }

  start() {
    if (process.platform === 'win32') return;
    this.#open();
    this.#findSession();
  }

  /**
   * A session that was already on when Pi-Cast (re)started: its 'abeg' is
   * long gone, but the sender's connection to shairport-sync's port is still
   * there. The title and cover come with the next track.
   */
  #findSession() {
    execFile('ss', ['-tnH', 'state', 'established', `( sport = :${RTSP_PORT} )`], (e, out) => {
      if (e || !out.trim() || this.state.active) return;
      this.log.info('AirPlay session already on');
      this.#set({ active: true, playing: true });
    });
  }

  /**
   * Opens the FIFO read-write and non-blocking, read through a socket: never
   * EOF when shairport-sync closes its end, and no blocked read in libuv's
   * thread pool (fs.createReadStream's), which kept Node from exiting.
   */
  #open() {
    let fd;
    try {
      fd = fs.openSync(PIPE, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    } catch {
      setTimeout(() => this.#open(), RETRY_MS).unref(); // shairport-sync makes it on start
      return;
    }
    const pipe = new net.Socket({ fd, readable: true, writable: false });
    pipe.setEncoding('utf8');
    pipe.unref();
    pipe.on('data', (d) => this.#onData(d));
    pipe.on('error', (e) => this.log.debug('AirPlay metadata pipe:', e.message));
    pipe.on('close', () => setTimeout(() => this.#open(), RETRY_MS).unref());
  }

  #onData(chunk) {
    this.buf += chunk;
    const re = /<item><type>([0-9a-f]{8})<\/type><code>([0-9a-f]{8})<\/code><length>(\d+)<\/length>(?:\s*<data encoding="base64">\s*([^<]*)<\/data>)?<\/item>/g;
    let m;
    let end = 0;
    while ((m = re.exec(this.buf))) {
      end = re.lastIndex;
      const hex = (h) => Buffer.from(h, 'hex').toString('latin1');
      this.#item(hex(m[1]), hex(m[2]), m[4] ? Buffer.from(m[4], 'base64') : Buffer.alloc(0));
    }
    this.buf = this.buf.slice(end);
    if (this.buf.length > 4 * 1024 * 1024) this.buf = ''; // never in sync again otherwise
  }

  /**
   * Ends the session, so the audio device is free (a video takes over, or
   * Back on the TV). shairport-sync has no command for that, so it's
   * restarted, through a sudoers rule for exactly this (install.sh).
   */
  async release() {
    if (!this.state.active) return;
    this.log.info('AirPlay: ending the session');
    await new Promise((resolve) => {
      execFile('sudo', ['-n', 'systemctl', 'restart', 'shairport-sync'], (e) => {
        if (e) this.log.warn('ending the AirPlay session failed:', e.message);
        resolve();
      });
    });
    this.#set({ active: false, playing: false });
  }

  #set(patch) {
    const was = this.state.active;
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
    if (this.state.active !== was) this.emit('session', this.state.active);
  }

  #item(type, code, data) {
    const text = () => data.toString('utf8');
    if (type === 'core') {
      if (code === 'minm') this.pending.title = text();
      else if (code === 'asar') this.pending.artist = text();
      else if (code === 'asal') this.pending.album = text();
      return;
    }
    switch (code) {
      case 'abeg': this.log.info('AirPlay session started'); this.#set({ active: true }); break;
      case 'aend': this.log.info('AirPlay session ended'); this.#set({ active: false, playing: false }); break;
      case 'pbeg': case 'prsm': this.#set({ active: true, playing: true }); break;
      case 'pend': case 'pfls': this.#set({ playing: false }); break;
      case 'mdst': this.pending = {}; break;
      case 'mden': {
        const { title = null, artist = null, album = null } = this.pending;
        if (title !== this.state.title || artist !== this.state.artist) this.log.info(`AirPlay: ${artist} – ${title}`);
        // Only sent during a session, so it also catches one that began before Pi-Cast started.
        this.#set({ active: true, title, artist, album });
        break;
      }
      case 'prgr': {
        const [start, current, end] = text().split('/').map(Number);
        if ([start, current, end].every(Number.isFinite)) {
          this.#set({
            active: true, position: Math.max(0, (current - start) / RATE), duration: Math.max(0, (end - start) / RATE), at: Date.now(),
          });
        }
        break;
      }
      case 'PICT': this.#saveCover(data); break;
      default: break;
    }
  }

  #saveCover(data) {
    if (!data.length) {
      this.#set({ cover: null });
      return;
    }
    try {
      fs.mkdirSync(COVER_DIR, { recursive: true });
      const ext = data[0] === 0x89 ? 'png' : 'jpg';
      const file = path.join(COVER_DIR, `cover-${this.coverN++ % 2}.${ext}`);
      fs.writeFileSync(file, data);
      this.#set({ cover: file });
    } catch (e) {
      this.log.warn('AirPlay cover failed:', e.message);
    }
  }
}
