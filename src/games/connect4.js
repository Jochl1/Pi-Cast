import { mistakeChance } from './levels.js';

export const COLS = 7;
export const ROWS = 6;
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first: better pruning
const DEPTH = [1, 2, 4, 5, 6];
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const WIN = 1e6;

const at = (cells, r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? cells[r * COLS + c] : undefined);

/** The free row in column `col` (rows count from the top), or -1 if it's full. */
function dropRow(cells, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (cells[r * COLS + col] == null) return r;
  return -1;
}

/** The four (or more) in a row through (r, c), as cell indexes, or null. */
function lineThrough(cells, r, c) {
  const seat = at(cells, r, c);
  for (const [dr, dc] of DIRS) {
    const run = [r * COLS + c];
    for (const sign of [1, -1]) {
      for (let k = 1; at(cells, r + sign * k * dr, c + sign * k * dc) === seat; k++) {
        run.push((r + sign * k * dr) * COLS + (c + sign * k * dc));
      }
    }
    if (run.length >= 4) return run;
  }
  return null;
}

/** How good the board looks for `seat`: open threes and twos, and the centre column. */
function evaluate(cells, seat) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) if (cells[r * COLS + 3] === seat) score += 3;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of DIRS) {
        if (at(cells, r + 3 * dr, c + 3 * dc) === undefined) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k++) {
          const v = cells[(r + k * dr) * COLS + c + k * dc];
          if (v === seat) mine++;
          else if (v != null) theirs++;
        }
        if (theirs === 0) score += [0, 0, 2, 5][mine] ?? 0;
        else if (mine === 0) score -= [0, 0, 2, 4][theirs] ?? 0;
      }
    }
  }
  return score;
}

function negamax(cells, seat, depth, alpha, beta) {
  if (depth === 0) return evaluate(cells, seat);
  let any = false;
  for (const col of ORDER) {
    const r = dropRow(cells, col);
    if (r < 0) continue;
    any = true;
    const i = r * COLS + col;
    cells[i] = seat;
    // Sooner wins score higher.
    const score = lineThrough(cells, r, col) ? WIN + depth : -negamax(cells, 1 - seat, depth - 1, -beta, -alpha);
    cells[i] = null;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return any ? alpha : 0; // a full board is a draw
}

/**
 * Vier gewinnt (Connect 4) on a 7×6 board; who starts alternates by round.
 * Actions: { col: 0-6 }.
 */
export default {
  id: 'connect4',
  min: 2,
  max: 2,

  create(seats, round) {
    return { cells: Array(ROWS * COLS).fill(null), turn: round % 2, last: null, line: null, over: false, winner: null };
  },

  turn: (s) => (s.over ? null : s.turn),

  move(s, seat, { col }) {
    const r = Number.isInteger(col) && col >= 0 && col < COLS ? dropRow(s.cells, col) : -1;
    if (r < 0) throw new Error('illegal move');
    const cells = [...s.cells];
    const last = r * COLS + col;
    cells[last] = seat;
    const line = lineThrough(cells, r, col);
    const full = cells.every((c) => c != null);
    return { cells, turn: 1 - seat, last, line, over: !!line || full, winner: line ? seat : null };
  },

  bot(s, seat, level) {
    const free = ORDER.filter((c) => dropRow(s.cells, c) >= 0);
    if (Math.random() < mistakeChance(level)) return { col: free[Math.floor(Math.random() * free.length)] };
    const cells = [...s.cells];
    const depth = DEPTH[level - 1] ?? 4;
    let best = -Infinity;
    let choices = [];
    for (const col of free) {
      const r = dropRow(cells, col);
      cells[r * COLS + col] = seat;
      const score = lineThrough(cells, r, col) ? WIN + depth : -negamax(cells, 1 - seat, depth - 1, -Infinity, Infinity);
      cells[r * COLS + col] = null;
      if (score > best) [best, choices] = [score, [col]];
      else if (score === best) choices.push(col);
    }
    return { col: choices[Math.floor(Math.random() * choices.length)] };
  },
};
