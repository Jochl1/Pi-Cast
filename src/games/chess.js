import fs from 'node:fs';
import { Chess } from 'chess.js';
import stockfish from './stockfish.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** The position after `moves` (UCI strings), with its history for repetitions. */
function replay(moves) {
  const game = new Chess();
  for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return game;
}

const uci = (m) => m.from + m.to + (m.promotion ?? '');

const START = { q: 1, r: 2, b: 2, n: 2, p: 8 };

/**
 * What each side has taken, most valuable first ({ w: ['q', 'p'], b: [...] }:
 * w is what white took), and `lead`, white's material minus black's (a
 * promotion counts as the new piece, so this can differ from the captures).
 */
function material(board) {
  const count = { w: {}, b: {} };
  for (const p of board) if (p) count[p[0]][p[1]] = (count[p[0]][p[1]] ?? 0) + 1;
  const taken = (from) => Object.keys(START).flatMap((type) => Array(Math.max(0, START[type] - (count[from][type] ?? 0))).fill(type));
  const worth = (c) => Object.entries(count[c]).reduce((sum, [type, n]) => sum + VALUE[type] * n, 0);
  return { w: taken('b'), b: taken('w'), lead: worth('w') - worth('b') };
}

// The opening names by position (scripts/build-openings.js), read on first use.
let openingNames = null;
const openings = () => {
  openingNames ??= JSON.parse(fs.readFileSync(new URL('./openings.json', import.meta.url), 'utf8'));
  return openingNames;
};

/** How the game stands after the last move: a result reason, or null if it goes on. */
function ending(game) {
  if (game.isCheckmate()) return 'checkmate';
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'material';
  if (game.isThreefoldRepetition()) return 'repetition';
  if (game.isDrawByFiftyMoves()) return 'fifty';
  return null;
}

/** Without Stockfish: two plies deep on material, captures and checks first. */
function fallback(game) {
  const material = (g) => g.board().flat().reduce((sum, sq) => sum + (sq ? (sq.color === g.turn() ? 1 : -1) * VALUE[sq.type] : 0), 0);
  let best = -Infinity;
  let choices = [];
  for (const m of game.moves({ verbose: true })) {
    game.move(m);
    let score;
    if (game.isCheckmate()) score = 1000;
    else if (game.isDraw()) score = 0;
    else score = -Math.max(...game.moves({ verbose: true }).map((r) => {
      game.move(r);
      const v = game.isCheckmate() ? 1000 : -material(game);
      game.undo();
      return v;
    }));
    game.undo();
    if (score > best) [best, choices] = [score, [m]];
    else if (score === best) choices.push(m);
  }
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Schach, with chess.js for the rules and Stockfish as the computer. Who plays
 * white alternates by round. The game ends with checkmate, stalemate, a draw
 * by repetition (threefold), the fifty-move rule or too little material, a
 * resignation, or a draw offer the other player accepts. A draw offer stands
 * until the other player answers it or moves (which declines it).
 *
 * The state keeps the moves as UCI strings and replays them, so repetitions
 * are counted; public() turns it into what the screens need.
 *
 * Actions: { type: 'move', from: 'e2', to: 'e4', promotion?: 'q'|'r'|'b'|'n' },
 * { type: 'resign' }, { type: 'offer' }, { type: 'accept' }, { type: 'decline' }.
 * Only moves wait for the player's turn.
 */
export default {
  id: 'chess',
  min: 2,
  max: 2,

  create(seats, round) {
    stockfish.warm();
    return {
      moves: [], sans: [], white: round % 2, turn: round % 2, offer: null, declined: null, over: false, winner: null, result: null,
    };
  },

  turn: (s) => (s.over ? null : s.turn),

  anyTime: (action) => action?.type !== 'move',

  move(state, seat, action) {
    const s = { ...state, declined: null };
    const other = 1 - seat;
    if (action.type === 'resign') return { ...s, over: true, winner: other, result: 'resign', resigned: seat, offer: null };
    if (action.type === 'offer') {
      if (s.offer != null) throw new Error('already offered');
      return { ...s, offer: seat };
    }
    if (action.type === 'accept' || action.type === 'decline') {
      if (s.offer !== other) throw new Error('nothing to answer');
      if (action.type === 'decline') return { ...s, offer: null, declined: seat };
      return { ...s, offer: null, over: true, winner: null, result: 'agreed' };
    }
    if (action.type !== 'move') throw new Error('illegal move');
    const game = replay(s.moves);
    let m;
    try {
      m = game.move({ from: action.from, to: action.to, promotion: action.promotion ?? 'q' });
    } catch {
      throw new Error('illegal move');
    }
    const result = ending(game);
    return {
      ...s,
      moves: [...s.moves, uci(m)],
      sans: [...s.sans, m.san],
      turn: other,
      // Moving answers an offer made to you with no.
      offer: s.offer === other ? null : s.offer,
      declined: s.offer === other ? seat : null,
      over: !!result,
      winner: result === 'checkmate' ? seat : null,
      result,
    };
  },

  /**
   * The board (64 squares from a8 to h1, e.g. 'wk' or null), the last move,
   * the king in check, the legal moves of the side to move by square, the
   * material and the opening.
   */
  public(s) {
    const game = replay(s.moves);
    const board = game.board().flat().map((sq) => (sq ? sq.color + sq.type : null));
    // The newest position in the moves that has a name (none after the book ends: the last one stays).
    let opening = null;
    for (const m of game.history({ verbose: true }).reverse()) {
      const name = openings()[m.after.split(' ').slice(0, 4).join(' ')];
      if (name) {
        opening = { eco: name.slice(0, 3), name: name.slice(4) };
        break;
      }
    }
    const last = s.moves.at(-1);
    const legal = {};
    if (!s.over) for (const m of game.moves({ verbose: true })) (legal[m.from] ??= []).includes(m.to) || legal[m.from].push(m.to);
    let check = null;
    if (game.inCheck()) check = game.findPiece({ type: 'k', color: game.turn() })[0];
    return {
      board, sans: s.sans, white: s.white, turn: s.turn, toMove: game.turn(),
      last: last ? [last.slice(0, 2), last.slice(2, 4)] : null, check, legal, material: material(board), opening,
      offer: s.offer, declined: s.declined, over: s.over, winner: s.winner, result: s.result, resigned: s.resigned ?? null,
    };
  },

  async bot(s, seat, level) {
    const game = replay(s.moves);
    let pick = null;
    let score = 0;
    try {
      const best = await stockfish.best(s.moves, level);
      score = best.score;
      pick = { from: best.move.slice(0, 2), to: best.move.slice(2, 4), promotion: best.move[4] };
    } catch {
      pick = fallback(game);
    }
    // An offer made to the computer: yes when it's clearly behind, or when it's even late in the game.
    if (s.offer === 1 - seat) {
      const accept = score <= -150 || (Math.abs(score) <= 30 && s.moves.length >= 60);
      if (accept) return { type: 'accept' };
    }
    return { type: 'move', from: pick.from, to: pick.to, promotion: pick.promotion };
  },

  /** Game night closed: the engine doesn't need to stay in memory. */
  close() {
    stockfish.stop();
  },
};
