import { ON_ACCENT } from '../shared/theme.js';
import {
  text, span, paint, rect, circle, polygon, escape, fit, roundedRectPath,
} from './ass.js';
import { W, H, qrTile } from './screens.js';
import { COLS, ROWS } from '../games/connect4.js';

/**
 * Game night on the TV (see games/party.js): the lobby ("Wer spielt mit?"
 * with the QR code, the players and the games) and each game's board.
 * Same rules as screens.js: state in, ASS events out, nothing full-screen.
 */

const PAD_X = 96;
const PAD_Y = 84;

const glass = (x, y, w, h, r, selected, t) => rect(x, y, w, h, selected
  ? { color: '#FFFFFF', opacity: 0.10, radius: r, border: 4, borderColor: t.accent }
  : { color: '#FFFFFF', opacity: 0.055, radius: r, border: 2, borderColor: '#FFFFFF', borderOpacity: 0.16 });
const smallLabel = (t, s, x, y, opts = {}) => text(escape(s.toLocaleUpperCase(t.tr.locale)), {
  x, y, an: 7, px: 28, weight: 600, spacing: 3.6, color: t.accent, ...opts,
});
/** "OK Start      Back Home": keys in the text colour, what they do in muted. */
const hints = (t, parts, y = H - 56) => text(parts.map(([k, s]) => `{${paint(t.text)}}${escape(k)}{${paint(t.muted)}} ${escape(s)}`).join('      '), {
  x: W / 2, y, an: 2, px: 28, color: t.muted,
});
const botName = (t, color = t.text) => `pi${span('·', t.accent)}${span('cast', color)}`;
const nameOf = (t, p, px, maxW, color = t.text) => (p.bot ? `pi${span('·', t.accent)}${span(escape(p.name.slice('pi·'.length)), color)}`
  : escape(fit(p.name, px, maxW)));

/** A round avatar: the player's initial on their colour; pi·cast's is dark with an accent ring. */
function avatar(t, cx, cy, r, p) {
  if (p.bot) {
    return [
      circle(cx, cy, r, { color: t.iconBg, border: 3, borderColor: t.accent }),
      text(`pi${span('·', t.accent)}`, { x: cx, y: cy + 2, an: 5, px: r * 0.62, weight: 600, color: t.text }),
    ];
  }
  return [
    circle(cx, cy, r, { color: p.color }),
    text(escape([...p.name][0]?.toLocaleUpperCase(t.tr.locale) ?? '?'), { x: cx, y: cy + 2, an: 5, px: r * 0.95, weight: 700, color: ON_ACCENT }),
  ];
}

// --- Game icons, drawn in an s×s box at (x, y) ---

const ICON_COLORS = { a: '#FF7A59', b: '#FFC247', o: '#6FA8FF' };
const icons = {
  connect4(t, x, y, s) {
    const c = s / 4;
    const rad = c * 0.36;
    const fill = { '3,0': 'a', '3,1': 'b', '2,1': 'a', '3,2': 'a', '2,2': 'b', '1,2': 'b', '3,3': 'b', '2,3': 'a' };
    const ev = [rect(x, y + c * 0.5, s, s - c * 0.5, { color: '#FFFFFF', opacity: 0.08, radius: c * 0.4 })];
    for (let r = 1; r < 4; r++) {
      for (let col = 0; col < 4; col++) {
        const k = fill[`${r},${col}`];
        ev.push(circle(x + c * col + c / 2, y + c * 0.5 + (r - 1) * c * 1.1 + c * 0.62, rad,
          k ? { color: ICON_COLORS[k] } : { color: '#FFFFFF', opacity: 0.12 }));
      }
    }
    ev.push(circle(x + c * 1.5, y + c * 0.05, rad, { color: ICON_COLORS.a }));
    return ev;
  },
  eins(t, x, y, s) {
    const w = s * 0.42;
    const h = s * 0.62;
    const bx = x + s / 2 - w / 2;
    const by = y + s * 0.2;
    return [
      ...card(t, bx, by, w, h, { color: 'b', value: '7' }, 16),
      ...card(t, bx, by, w, h, { color: 'y', value: '3' }, -16),
      ...card(t, bx, by, w, h, { color: 'r', value: '1' }, 0),
    ];
  },
  tictactoe(t, x, y, s) {
    const c = s / 3;
    const th = s * 0.035;
    const ev = [];
    for (const i of [1, 2]) {
      ev.push(rect(x + c * i - th / 2, y + 6, th, s - 12, { color: t.muted, opacity: 0.6, radius: th / 2 }));
      ev.push(rect(x + 6, y + c * i - th / 2, s - 12, th, { color: t.muted, opacity: 0.6, radius: th / 2 }));
    }
    const at = (i, j) => [x + c * j + c / 2, y + c * i + c / 2];
    for (const [i, j] of [[0, 0], [0, 2], [2, 2]]) ev.push(...cross(...at(i, j), c * 0.28, c * 0.09, ICON_COLORS.a));
    for (const [i, j] of [[1, 1], [2, 0]]) ev.push(ring(...at(i, j), c * 0.27, c * 0.085, ICON_COLORS.o));
    return ev;
  },
};

/** An ✕ centred on (cx, cy): arm half-length `a`, stroke `w`. */
function cross(cx, cy, a, w, color, opacity = 1) {
  return [
    polygon([[cx - a, cy - a + w], [cx - a + w, cy - a], [cx + a, cy + a - w], [cx + a - w, cy + a]], { color, opacity }),
    polygon([[cx + a - w, cy - a], [cx + a, cy - a + w], [cx - a + w, cy + a], [cx - a, cy + a - w]], { color, opacity }),
  ];
}
const ring = (cx, cy, r, w, color, opacity = 1) => circle(cx, cy, r, {
  color: '#000000', opacity: 0, border: w, borderColor: color, borderOpacity: opacity,
});

// --- Lobby ---

/**
 * "Wer spielt mit?": the QR code to join, the players (+ a free seat), and
 * the games along the bottom with the selected one framed.
 */
export function lobby(t, view, qr) {
  const ev = [
    smallLabel(t, t.tr('gamesNight'), PAD_X, PAD_Y),
    text(escape(t.tr('gamesWhoPlays')), { x: PAD_X, y: PAD_Y + 44, an: 7, px: 78, weight: 600, spacing: -0.8, color: t.text }),
  ];
  const q = qrTile(t, qr, PAD_X, 330, 7);
  ev.push(...q.events, text(escape(t.tr('gamesScan')), { x: PAD_X + q.size / 2, y: 330 + q.size + 26, an: 8, px: 28, color: t.muted }));

  const slots = [...view.players, ...(view.players.length < 6 ? [null] : [])];
  const r = slots.length > 5 ? 62 : 74;
  const gap = slots.length > 5 ? 52 : 70;
  let x = PAD_X + q.size + 110 + r;
  const y = 330 + r + 20;
  for (const p of slots) {
    if (!p) {
      ev.push(
        circle(x, y, r, { color: '#FFFFFF', opacity: 0.04, border: 3, borderColor: '#FFFFFF', borderOpacity: 0.22 }),
        text('+', { x, y: y - 4, an: 5, px: r * 0.9, weight: 300, color: t.muted }),
      );
      break;
    }
    ev.push(...avatar(t, x, y, r, p));
    ev.push(text(nameOf(t, p, 34, 2 * r + gap - 12), { x, y: y + r + 24, an: 8, px: 34, weight: 600, color: p.bot ? t.muted : t.text }));
    const tag = p.bot ? `${t.tr('gamesComputer')} · ${p.bot}` : p.id === view.hostId ? t.tr('gamesHost') : '';
    if (tag) ev.push(text(escape(tag.toLocaleUpperCase(t.tr.locale)), { x, y: y + r + 74, an: 8, px: 20, weight: 600, spacing: 3, color: t.muted }));
    x += 2 * r + gap;
  }

  const n = view.games.length;
  const sw = 400;
  const sgap = 32;
  const sx = (W - (n * sw + (n - 1) * sgap)) / 2;
  const sy = 760;
  view.games.forEach((g, i) => {
    const gx = sx + i * (sw + sgap);
    ev.push(glass(gx, sy, sw, 150, 36, g.id === view.selected, t));
    ev.push(...icons[g.id](t, gx + 28, sy + 30, 90));
    ev.push(text(escape(t.tr(`game_${g.id}`)), { x: gx + 146, y: sy + 58, an: 4, px: 34, weight: 600, color: t.text }));
    const players = g.min === g.max ? t.tr('gamesPlayers', { n: g.max }) : t.tr('gamesPlayersRange', { min: g.min, max: g.max });
    ev.push(text(escape(players), { x: gx + 146, y: sy + 102, an: 4, px: 24, color: t.muted }));
  });
  ev.push(hints(t, [['◀ ▶', t.tr('gamesPick')], ['OK', t.tr('gamesStart')], [t.tr('keyBack'), t.tr('gamesQuit')]]));
  return ev;
}

// --- In a game ---

/** One player at the side of a two-player board: avatar, name, their piece, turn and wins. */
function side(t, cx, p, { turn, piece, wins }) {
  const cy = 420;
  const r = 84;
  const ev = [];
  if (turn) ev.push(ring(cx, cy, r + 14, 5, t.accent));
  ev.push(...avatar(t, cx, cy, r, p));
  ev.push(text(nameOf(t, p, 44, 400), { x: cx, y: cy + r + 40, an: 8, px: 44, weight: 600, color: t.text }));
  ev.push(...piece(cx, cy + r + 140));
  if (turn) {
    if (p.bot) {
      ev.push(text(escape(t.tr('gamesThinking')), { x: cx, y: cy + r + 224, an: 5, px: 28, color: t.muted }));
    } else {
      const label = t.tr('gamesTurn').toLocaleUpperCase(t.tr.locale);
      const w = Math.max(200, label.length * 22 * 0.75 + 64);
      ev.push(rect(cx - w / 2, cy + r + 196, w, 56, { color: t.accent, radius: 28 }));
      ev.push(text(escape(label), { x: cx, y: cy + r + 224, an: 5, px: 22, weight: 600, spacing: 3, color: ON_ACCENT }));
    }
  }
  ev.push(text(`{${paint(t.muted)}}${escape(t.tr('gamesWins'))} {${paint(t.text)}}${wins}`, { x: cx, y: cy + r + 300, an: 5, px: 28, weight: 500 }));
  return ev;
}

function header(t, view) {
  return [
    smallLabel(t, t.tr(`game_${view.game.id}`), PAD_X, PAD_Y - 20),
    text(escape(t.tr('gamesRound', { n: view.game.round + 1 })), { x: W - PAD_X, y: PAD_Y - 20, an: 9, px: 28, color: t.muted }),
  ];
}

/** The banner under the board when a round is over, and the keys for what's next. */
function result(t, view, players, y) {
  const s = view.game.state;
  const msg = s.winner != null ? t.tr('gamesWinner', { name: players[s.winner].name }) : t.tr('gamesDraw');
  return [
    rect(W / 2 - 330, y, 660, 104, { color: t.glass, radius: 52 }),
    rect(W / 2 - 330, y, 660, 104, {
      color: t.accent, opacity: 0.18, radius: 52, border: 2, borderColor: t.accent, borderOpacity: 0.5,
    }),
    text(escape(fit(msg, 44, 600)), { x: W / 2, y: y + 52, an: 5, px: 44, weight: 600, color: t.text }),
    hints(t, [['OK', t.tr('gamesAgain')], [t.tr('keyBack'), t.tr('gamesToLobby')]]),
  ];
}

const seated = (view) => view.game.seats.map((id) => view.players.find((p) => p.id === id) ?? { name: '?', color: '#888888' });
const winsOf = (view, p) => view.wins[view.game.id]?.[p.id] ?? 0;

function connect4(t, view) {
  const { state: s, turn, pointer } = view.game;
  const players = seated(view);
  const cell = 104;
  const pad = 22;
  const bw = COLS * cell + 2 * pad;
  const bh = ROWS * cell + 2 * pad;
  const bx = (W - bw) / 2;
  const by = 270;
  const line = new Set(s.line ?? []);
  const ev = [...header(t, view)];
  ev.push(rect(bx, by, bw, bh, { color: '#FFFFFF', opacity: 0.07, radius: 44, border: 2, borderColor: '#FFFFFF', borderOpacity: 0.16 }));
  s.cells.forEach((seat, i) => {
    const cx = bx + pad + (i % COLS) * cell + cell / 2;
    const cy = by + pad + Math.floor(i / COLS) * cell + cell / 2;
    if (seat == null) ev.push(circle(cx, cy, 40, { color: t.bg, opacity: 0.55 }));
    else ev.push(circle(cx, cy, 40, { color: players[seat].color, opacity: line.size && !line.has(i) ? 0.45 : 1 }));
    if (line.has(i)) ev.push(ring(cx, cy, 46, 5, '#FFFFFF'));
  });
  if (s.last != null && !s.over) {
    ev.push(circle(bx + pad + (s.last % COLS) * cell + cell / 2, by + pad + Math.floor(s.last / COLS) * cell + cell / 2, 14, { color: '#FFFFFF', opacity: 0.9 }));
  }
  // The disc the player whose turn it is holds over a column (from their phone).
  if (turn != null && pointer?.seat === turn && Number.isInteger(pointer.value)) {
    const hx = bx + pad + pointer.value * cell + cell / 2;
    const color = players[turn].color;
    ev.push(circle(hx, by - 64, 40, { color }), polygon([[hx - 14, by - 14], [hx + 14, by - 14], [hx, by + 2]], { color }));
  }
  players.forEach((p, seat) => {
    ev.push(...side(t, seat ? W - 330 : 330, p, {
      turn: turn === seat, wins: winsOf(view, p), piece: (x, y) => [circle(x, y, 26, { color: p.color })],
    }));
  });
  // The board fills the height, so the banner takes the hovering disc's place above it.
  if (s.over) ev.push(...result(t, view, players, by - 124));
  else ev.push(hints(t, [[t.tr('keyBack'), t.tr('gamesEnd')]]));
  return ev;
}

function tictactoe(t, view) {
  const { state: s, turn } = view.game;
  const players = seated(view);
  const cell = 186;
  const size = 3 * cell;
  const bx = (W - size) / 2;
  const by = 200;
  const th = 8;
  const ev = [...header(t, view)];
  for (const i of [1, 2]) {
    ev.push(rect(bx + cell * i - th / 2, by + 10, th, size - 20, { color: '#FFFFFF', opacity: 0.22, radius: th / 2 }));
    ev.push(rect(bx + 10, by + cell * i - th / 2, size - 20, th, { color: '#FFFFFF', opacity: 0.22, radius: th / 2 }));
  }
  const line = new Set(s.line ?? []);
  const mark = (seat, cx, cy, size, opacity = 1) => (seat === 0
    ? cross(cx, cy, size, size / 3, players[0].color, opacity)
    : [ring(cx, cy, size * 0.93, size / 3, players[1].color, opacity)]);
  s.cells.forEach((seat, i) => {
    if (seat == null) return;
    const cx = bx + (i % 3) * cell + cell / 2;
    const cy = by + Math.floor(i / 3) * cell + cell / 2;
    ev.push(...mark(seat, cx, cy, 54, line.size && !line.has(i) ? 0.4 : 1));
  });
  if (s.line) {
    // A line through the three, from the first to the last centre.
    const c = (i) => [bx + (i % 3) * cell + cell / 2, by + Math.floor(i / 3) * cell + cell / 2];
    const [x1, y1] = c(s.line[0]);
    const [x2, y2] = c(s.line[2]);
    const len = Math.hypot(x2 - x1, y2 - y1) + 120;
    const deg = (-Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    ev.push(`{\\an5\\pos(${mx},${my})\\frz${deg.toFixed(1)}\\bord0\\shad0${paint('#FFFFFF')}\\p1}${roundedRectPath(len, 14, 7)}{\\p0}`);
  }
  players.forEach((p, seat) => {
    ev.push(...side(t, seat ? W - 330 : 330, p, {
      turn: turn === seat, wins: winsOf(view, p), piece: (x, y) => mark(seat, x, y, 26),
    }));
  });
  if (s.over) ev.push(...result(t, view, players, by + size + 36));
  else ev.push(hints(t, [[t.tr('keyBack'), t.tr('gamesEnd')]]));
  return ev;
}

// --- Eins! ---

export const CARD_COLORS = { r: '#FF5D5D', y: '#FFC247', g: '#4BE3B0', b: '#6FA8FF' };
const SYMBOL = { skip: '⊘', rev: '⇄' };
/** What's printed on a card: the number, +2/+4, or a symbol (DejaVu has them, Sora doesn't). */
const face = (value) => (value === 'wild' ? '' : SYMBOL[value] ?? value);

/** Wraps an event in a rotation of `deg` around (ox, oy). */
const turned = (event, deg, ox, oy) => (deg ? event.replace('{', `{\\org(${ox},${oy})\\frz${deg}`) : event);

/** One card, w×h at (x, y), turned by `deg` around its centre. Wilds are dark with the four colours. */
function card(t, x, y, w, h, c, deg = 0) {
  const ox = x + w / 2;
  const oy = y + h / 2;
  const r = w * 0.12;
  const wild = c.color == null;
  const ev = [
    rect(x, y, w, h, { color: wild ? '#1B1834' : CARD_COLORS[c.color], radius: r }),
    rect(x + w * 0.07, y + w * 0.07, w * 0.86, h - w * 0.14, {
      color: '#000000', opacity: 0, radius: r * 0.6, border: Math.max(2, w * 0.012), borderColor: '#FFFFFF', borderOpacity: 0.5,
    }),
  ];
  if (wild) {
    const q = w * 0.16;
    ['r', 'y', 'g', 'b'].forEach((k, i) => {
      ev.push(circle(ox + (i % 2 ? q : -q) * 0.9, oy + (i < 2 ? -q : q) * 0.9, q, { color: CARD_COLORS[k] }));
    });
  }
  const label = face(c.value);
  const font = SYMBOL[c.value] ? 'DejaVu Sans' : 'Sora';
  if (label) {
    // A wild's middle is its four colours; the value goes in the corner only.
    if (!wild) ev.push(text(escape(label), { x: ox, y: oy + 2, an: 5, px: w * (label.length > 1 ? 0.36 : 0.5), weight: 700, font, color: '#FFFFFF' }));
    ev.push(text(escape(label), { x: x + w * 0.15, y: y + w * 0.12, an: 7, px: w * 0.15, weight: 700, font, color: '#FFFFFF' }));
  }
  return ev.map((e) => turned(e, deg, ox, oy));
}

function cardBack(t, x, y, w, h) {
  return [
    rect(x, y, w, h, { color: '#1B1834', radius: w * 0.12, border: 3, borderColor: t.accent, borderOpacity: 0.7 }),
    text(`Eins${span('!', t.accent)}`, { x: x + w / 2, y: y + h / 2, an: 5, px: w * 0.24, weight: 700, color: t.text }),
  ];
}

/** "Blau 7", "Rot +2", "+4": a card's name for the TV's log line. */
export function cardName(tr, c) {
  const value = { skip: tr('einsSkip'), rev: tr('einsReverse'), wild: tr('einsWild') }[c.value] ?? c.value;
  return c.color ? `${tr(`einsColor_${c.color}`)} ${value}` : value;
}

function eins(t, view) {
  const g = view.game;
  const s = g.state;
  const players = seated(view);
  const ev = [
    smallLabel(t, t.tr('game_eins'), PAD_X, PAD_Y - 20),
    text(escape(t.tr('einsDeck', { n: s.deck })), { x: W - PAD_X, y: PAD_Y - 20, an: 9, px: 28, color: t.muted }),
  ];

  // The players across the top; the one whose turn it is framed.
  const n = players.length;
  const gap = 24;
  const pw = Math.min(300, (W - 2 * PAD_X - (n - 1) * gap) / n);
  const px0 = (W - (n * pw + (n - 1) * gap)) / 2;
  const py = 170;
  players.forEach((p, i) => {
    const x = px0 + i * (pw + gap);
    const turn = g.turn === i;
    ev.push(rect(x, py, pw, 140, turn
      ? { color: '#FFFFFF', opacity: 0.10, radius: 70, border: 4, borderColor: t.accent }
      : { color: '#FFFFFF', opacity: 0.055, radius: 70, border: 2, borderColor: '#FFFFFF', borderOpacity: 0.16 }));
    ev.push(...avatar(t, x + 70, py + 70, 46, p));
    ev.push(text(nameOf(t, p, 34, pw - 150), { x: x + 134, y: py + 50, an: 4, px: 34, weight: 600, color: t.text }));
    const place = s.finished.indexOf(i) + 1;
    let sub = t.tr(s.counts[i] === 1 ? 'einsOneCard' : 'einsCards', { n: s.counts[i] });
    if (place) sub = t.tr('einsPlace', { n: place });
    else if (turn && p.bot) sub = t.tr('gamesThinking');
    ev.push(text(escape(sub), { x: x + 134, y: py + 94, an: 4, px: 26, weight: place ? 600 : 400, color: place ? t.accent : t.muted }));
    if (s.counts[i] === 1 && s.called[i]) {
      ev.push(rect(x + pw - 110, py - 22, 120, 48, { color: CARD_COLORS.r, radius: 24 }));
      ev.push(text('EINS!', { x: x + pw - 50, y: py + 2, an: 5, px: 22, weight: 700, spacing: 2, color: '#FFFFFF' }));
    }
  });
  if (s.over) return [...ev, ...standings(t, players, s.finished)];
  ev.push(text(`{${paint(t.muted)}}${escape(t.tr('einsDirection'))} ${s.dir > 0 ? '→' : '←'}`, { x: W - PAD_X, y: py + 190, an: 9, px: 26, weight: 500 }));

  // The table: the draw pile, the pile's top two cards, the colour and an open stack.
  const cw = 230;
  const ch = 340;
  const cy = 410;
  ev.push(...cardBack(t, W / 2 - cw - 80, cy + 10, cw, ch), ...cardBack(t, W / 2 - cw - 70, cy, cw, ch));
  const tilt = (c) => ((c.id * 7) % 13) - 6; // each card lies a little differently, but always the same
  const [under, topCard] = s.pile.length > 1 ? s.pile : [null, s.pile[0]];
  if (under) ev.push(...card(t, W / 2 + 60, cy + 6, cw, ch, under, tilt(under)));
  ev.push(...card(t, W / 2 + 70, cy, cw, ch, topCard, tilt(topCard)));
  const dx = W / 2 + 70 + cw + 130;
  ev.push(circle(dx, cy + 120, 36, { color: CARD_COLORS[s.color] }));
  ev.push(text(escape(t.tr(`einsColor_${s.color}`).toLocaleUpperCase(t.tr.locale)), { x: dx, y: cy + 184, an: 8, px: 22, weight: 600, spacing: 3, color: t.muted }));
  if (s.pending) ev.push(text(`+${s.pending}`, { x: dx, y: cy + 290, an: 5, px: 72, weight: 700, color: CARD_COLORS.r }));

  // What just happened, and whose turn it is.
  const l = s.last;
  const who = (seat) => players[seat].name;
  let line = '';
  if (l?.type === 'play') {
    line = t.tr('einsPlays', { name: who(l.seat), card: `{${paint(l.card.color ? CARD_COLORS[l.card.color] : t.text)}}${escape(cardName(t.tr, l.card))}{${paint(t.muted)}}` });
    if (l.card.color == null) line += ` → {${paint(CARD_COLORS[l.color])}}${escape(t.tr(`einsColor_${l.color}`))}{${paint(t.muted)}}`;
    if (l.penalty) line += ` · ${escape(t.tr('einsForgot'))}`;
    if (l.place) line += ` · {${paint(t.accent)}}${escape(t.tr('einsPlace', { n: l.place }))}{${paint(t.muted)}}`;
  } else if (l?.type === 'draw') {
    line = escape(t.tr(l.n === 1 ? 'einsDrawsOne' : 'einsDraws', { name: who(l.seat), n: l.n }));
  }
  const turnText = `{${paint(t.text)}}${escape(t.tr('gamesTheirTurn', { name: who(g.turn) }))}`;
  ev.push(text([line, turnText].filter(Boolean).join(` {${paint(t.muted)}}· `), { x: W / 2, y: cy + ch + 90, an: 5, px: 34, color: t.muted }));
  ev.push(hints(t, [[t.tr('keyBack'), t.tr('gamesEnd')]]));
  return ev;
}

/** The end of an Eins! round: every place, first to last. */
function standings(t, players, finished) {
  const rowH = 84;
  const y0 = 560 - (finished.length * rowH) / 2;
  const x = W / 2 - 230;
  const ev = [];
  finished.forEach((seat, i) => {
    const y = y0 + i * rowH + rowH / 2;
    const p = players[seat];
    ev.push(
      text(`${i + 1}.`, { x: x + 40, y, an: 6, px: i ? 40 : 52, weight: 700, color: i ? t.muted : t.accent }),
      ...avatar(t, x + 100, y, 30, p),
      text(nameOf(t, p, i ? 40 : 48, 380), { x: x + 150, y, an: 4, px: i ? 40 : 48, weight: 600, color: i ? t.text : t.accent }),
    );
  });
  return [...ev, hints(t, [['OK', t.tr('gamesAgain')], [t.tr('keyBack'), t.tr('gamesToLobby')]])];
}

const BOARDS = { connect4, tictactoe, eins };

/** The game night screen: the lobby, or the game being played. */
export function games(t, view, qr) {
  return view.game ? BOARDS[view.game.id](t, view) : lobby(t, view, qr);
}
