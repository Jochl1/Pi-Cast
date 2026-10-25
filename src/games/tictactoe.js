import { mistakeChance } from './levels.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function line(cells) {
  for (const l of LINES) {
    const [a, b, c] = l;
    if (cells[a] != null && cells[a] === cells[b] && cells[a] === cells[c]) return l;
  }
  return null;
}

/** Score for `seat` with best play from here: +1 win, 0 draw, -1 loss. */
function minimax(cells, toMove, seat) {
  const l = line(cells);
  if (l) return cells[l[0]] === seat ? 1 : -1;
  if (cells.every((c) => c != null)) return 0;
  const scores = [];
  cells.forEach((c, i) => {
    if (c != null) return;
    cells[i] = toMove;
    scores.push(minimax(cells, 1 - toMove, seat));
    cells[i] = null;
  });
  return toMove === seat ? Math.max(...scores) : Math.min(...scores);
}

/**
 * Tic-Tac-Toe: seat 0 is ✕, seat 1 is ○; who starts alternates by round.
 * Actions: { cell: 0-8 } (row by row).
 */
export default {
  id: 'tictactoe',
  min: 2,
  max: 2,

  create(seats, round) {
    return { cells: Array(9).fill(null), turn: round % 2, last: null, line: null, over: false, winner: null };
  },

  turn: (s) => (s.over ? null : s.turn),

  move(s, seat, { cell }) {
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.cells[cell] != null) throw new Error('illegal move');
    const cells = [...s.cells];
    cells[cell] = seat;
    const l = line(cells);
    const full = cells.every((c) => c != null);
    return {
      cells, turn: 1 - seat, last: cell, line: l, over: !!l || full, winner: l ? seat : null,
    };
  },

  bot(s, seat, level) {
    const free = s.cells.flatMap((c, i) => (c == null ? [i] : []));
    if (Math.random() < mistakeChance(level)) return { cell: free[Math.floor(Math.random() * free.length)] };
    let best = -2;
    let choices = [];
    for (const i of free) {
      const cells = [...s.cells];
      cells[i] = seat;
      const score = minimax(cells, 1 - seat, seat);
      if (score > best) [best, choices] = [score, [i]];
      else if (score === best) choices.push(i);
    }
    return { cell: choices[Math.floor(Math.random() * choices.length)] };
  },
};
