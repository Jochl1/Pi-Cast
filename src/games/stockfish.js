import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

// Debian installs it to /usr/games, which isn't on a systemd service's PATH.
const BINARY = fs.existsSync('/usr/games/stockfish') ? '/usr/games/stockfish' : 'stockfish';

// How the computer plays at levels 1–5: Stockfish's skill (0–20) and time per move.
const LEVELS = [
  { skill: 0, ms: 50, depth: 1 },
  { skill: 3, ms: 100, depth: 3 },
  { skill: 8, ms: 300 },
  { skill: 14, ms: 700 },
  { skill: 20, ms: 1500 },
];
// A search that hangs (or a dead engine) must not stop the game.
const TIMEOUT_MS = 10000;

/**
 * Stockfish (Debian's `stockfish` package) as game night's chess computer,
 * over UCI on stdin/stdout. One process, started on the first request and
 * kept running until stop() (when game night closes). Requests queue, since
 * an engine thinks about one position at a time. If the binary is missing,
 * best() rejects and the caller falls back to its own search.
 */
class Stockfish {
  #proc = null;
  #lines = null; // the next line waiter: (line) => void
  #queue = Promise.resolve();

  /** Sends a command and resolves with the first line `done(line)` accepts (or right away without one). */
  #send(cmd, done) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(); reject(new Error('stockfish timed out')); }, TIMEOUT_MS);
      this.#lines = done && ((line) => {
        if (!done(line)) return;
        clearTimeout(timer);
        this.#lines = null;
        resolve(line);
      });
      this.#proc.stdin.write(`${cmd}\n`);
      if (!done) { clearTimeout(timer); resolve(); }
    });
  }

  async #start() {
    if (this.#proc) return;
    const proc = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    await new Promise((resolve, reject) => {
      proc.once('spawn', resolve);
      proc.once('error', reject);
    });
    this.#proc = proc;
    proc.once('exit', () => { if (this.#proc === proc) this.#proc = null; });
    proc.on('error', () => {});
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.#lines?.(line));
    await this.#send('uci', (l) => l === 'uciok');
    // Small hash and one thread: the Pi also plays video.
    await this.#send('setoption name Hash value 16');
    await this.#send('setoption name Threads value 1');
    await this.#send('isready', (l) => l === 'readyok');
  }

  /**
   * The best move for the side to move after `moves` (UCI, e.g. ['e2e4', 'e7e5']),
   * at `level` 1–5: { move: 'g1f3', score } with the score in centipawns for
   * the side to move (mate as ±100000).
   */
  best(moves, level) {
    const run = async () => {
      await this.#start();
      const { skill, ms, depth } = LEVELS[level - 1] ?? LEVELS[2];
      await this.#send(`setoption name Skill Level value ${skill}`);
      await this.#send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      let score = 0;
      const line = await this.#send(`go movetime ${ms}${depth ? ` depth ${depth}` : ''}`, (l) => {
        const m = / score (cp|mate) (-?\d+)/.exec(l);
        if (m) score = m[1] === 'cp' ? Number(m[2]) : Math.sign(Number(m[2]) || -1) * 100000;
        return l.startsWith('bestmove');
      });
      const move = line.split(' ')[1];
      if (!move || move === '(none)') throw new Error('stockfish has no move');
      return { move, score };
    };
    const result = this.#queue.then(run);
    this.#queue = result.catch(() => {});
    return result;
  }

  stop() {
    this.#proc?.kill();
    this.#proc = null;
    this.#lines = null;
  }
}

export default new Stockfish();
