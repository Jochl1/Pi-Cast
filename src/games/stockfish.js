import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

// Debian installs it to /usr/games, which isn't on a systemd service's PATH.
const BINARY = fs.existsSync('/usr/games/stockfish') ? '/usr/games/stockfish' : 'stockfish';

// How the computer plays at levels 1–5, as lichess does it: Stockfish's skill
// (0–20; below 20 it picks among its best few moves, with natural-looking
// mistakes), capped by search depth and time per move. Skill 0 is still too
// good for level 1, so there pi·cast itself picks from Stockfish's best 8
// moves, weighted by how good they are: a move `pick` centipawns worse is
// e times less likely. It misses tactics like a beginner, but never plays nonsense.
const LEVELS = [
  { pick: 120, depth: 4, ms: 100 },
  { skill: 3, depth: 5, ms: 100 },
  { skill: 7, depth: 5, ms: 200 },
  { skill: 11, depth: 8, ms: 400 },
  { skill: 20, depth: 14, ms: 1000 },
];
const PICK_FROM = 8;
const MATE = 100000;

/** A move from `candidates` ({ move, score }), the better ones likelier. */
function weightedPick(candidates, temperature) {
  const best = Math.max(...candidates.map((c) => c.score));
  const weights = candidates.map((c) => Math.exp((Math.max(c.score, best - 2000) - best) / temperature));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (const [i, w] of weights.entries()) if ((r -= w) <= 0) return candidates[i];
  return candidates[0];
}
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
   * pi·cast's move for the side to move after `moves` (UCI, e.g. ['e2e4', 'e7e5']),
   * at `level` 1–5: { move: 'g1f3', score } with the best line's score in
   * centipawns for the side to move (mate as ±100000).
   */
  best(moves, level) {
    const run = async () => {
      await this.#start();
      const { skill = 20, pick, depth, ms } = LEVELS[level - 1] ?? LEVELS[2];
      await this.#send(`setoption name Skill Level value ${skill}`);
      await this.#send(`setoption name MultiPV value ${pick ? PICK_FROM : 1}`);
      await this.#send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      // The latest score and first move of each line (MultiPV numbers them from 1).
      const lines = new Map();
      const line = await this.#send(`go depth ${depth} movetime ${ms}`, (l) => {
        const m = / multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/.exec(l);
        if (m) {
          const score = m[2] === 'cp' ? Number(m[3]) : (Number(m[3]) > 0 ? MATE : -MATE);
          lines.set(Number(m[1]), { move: m[4], score });
        }
        return l.startsWith('bestmove');
      });
      const best = line.split(' ')[1];
      if (!best || best === '(none)') throw new Error('stockfish has no move');
      const score = lines.get(1)?.score ?? 0;
      if (pick && lines.size) return { move: weightedPick([...lines.values()], pick).move, score };
      return { move: best, score };
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
