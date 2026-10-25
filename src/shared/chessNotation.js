// German chess notation, for the TV and the web app: K König, D Dame,
// T Turm, L Läufer, S Springer (chess.js writes K, Q, R, B, N).
const LETTERS = { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' };

/** 'Nf3' → 'Sf3', 'exd8=Q+' → 'exd8=D+'. Squares and castling stay as they are. */
export const germanSan = (san) => san.replace(/[KQRBN]/g, (c) => LETTERS[c]);

/** The pieces as DejaVu Sans glyphs; both colours use the filled set and are told apart by paint. */
export const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
