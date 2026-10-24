import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// HDMI-CEC "user control" codes (CEC spec, table 30) we care about.
const UI_CODES = {
  0x00: 'ok', 0x01: 'up', 0x02: 'down', 0x03: 'left', 0x04: 'right',
  0x0d: 'back',
  0x44: 'play', 0x45: 'stop', 0x46: 'pause', 0x48: 'rewind', 0x49: 'fastforward',
  0x4b: 'forward', 0x4c: 'backward',
  0x60: 'play', 0x61: 'playpause', 0x64: 'stop',
};
// The TV repeats a code while a key is held; toggles must not flip back and forth.
const NO_REPEAT = new Set(['ok', 'play', 'pause', 'playpause', 'stop', 'back']);
const REPEAT_GAP_MS = 350;

/**
 * Key name from a cec-client traffic line, or null. Received USER_CONTROL_PRESSED
 * looks like "TRAFFIC: [  1234]	>> 04:44:01" (from TV 0 to us 4, opcode 0x44).
 */
export function parseKey(line) {
  const m = line.match(/>>\s+[0-9a-f]{2}:44:([0-9a-f]{2})/i);
  return m ? UI_CODES[parseInt(m[1], 16)] ?? null : null;
}

/**
 * TV remote over HDMI-CEC, using libcec's cec-client. It registers as a
 * playback device and answers the TV's protocol questions (power status,
 * menu state, ...), which many TVs need before they forward remote keys.
 * We read key presses from its traffic log and send commands on stdin.
 *
 * Events: 'key' (name)
 */
export default class Cec extends EventEmitter {
  constructor({ name, log, path = 'cec-client' }) {
    super();
    Object.assign(this, { name, log, path });
    this.proc = null;
    this.enabled = false;
    this.restartDelay = 5000;
    this.lastKey = { name: null, at: 0 };
  }

  start() {
    this.enabled = true;
    if (this.proc) return;
    // -t p: playback device, -o: name shown on the TV, -d 8: log traffic only.
    const proc = spawn(this.path, ['-t', 'p', '-o', this.name.slice(0, 14), '-d', '8'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    // Writing to a cec-client that just died raises EPIPE here; without a
    // handler that would crash the whole app. 'exit' handles the restart.
    proc.stdin.on('error', (e) => this.log.debug('[cec] stdin:', e.message));
    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) this.#onLine(line);
    });
    proc.stderr.on('data', (d) => this.log.debug('[cec]', d.toString().trim()));
    proc.on('error', (e) => {
      this.log.warn(`HDMI-CEC unavailable (${e.code === 'ENOENT' ? 'cec-client not installed' : e.message})`);
      this.proc = null;
      this.enabled = false; // don't keep retrying a missing binary
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (!this.enabled) return;
      this.log.warn(`cec-client exited (code ${code}), restarting in ${this.restartDelay / 1000}s`);
      setTimeout(() => this.enabled && this.start(), this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 300000);
    });
    this.log.info('HDMI-CEC started');
  }

  stop() {
    this.enabled = false;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdin.end('q\n');
      setTimeout(() => proc.kill(), 2000).unref();
    }
  }

  async restart(name) {
    this.name = name;
    if (!this.enabled) return;
    this.stop();
    await new Promise((r) => setTimeout(r, 2500));
    this.start();
  }

  /** Wakes the TV and makes it switch to the Pi's HDMI input. */
  switchInput() {
    if (!this.proc) return;
    this.log.info('HDMI-CEC: switching TV input');
    this.proc.stdin.write('on 0\n'); // "image view on" to the TV
    this.proc.stdin.write('as\n'); // "active source": this input
  }

  #onLine(line) {
    if (line.includes('connection opened')) this.restartDelay = 5000;
    if (/ERROR|could not|failed/i.test(line)) this.log.debug('[cec]', line.trim());
    const name = parseKey(line);
    if (!name) return;
    const now = Date.now();
    if (NO_REPEAT.has(name) && this.lastKey.name === name && now - this.lastKey.at < REPEAT_GAP_MS) {
      this.lastKey.at = now;
      return;
    }
    this.lastKey = { name, at: now };
    this.log.debug('HDMI-CEC key:', name);
    this.emit('key', name);
  }
}
