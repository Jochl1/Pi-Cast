import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { PLAYER_COLORS } from '../shared/theme.js';
import { DEFAULT_LEVEL, LEVELS } from './levels.js';
import connect4 from './connect4.js';
import tictactoe from './tictactoe.js';
import eins from './eins.js';

/** The games in menu order. */
export const GAMES = Object.fromEntries([connect4, tictactoe, eins].map((g) => [g.id, g]));
const ORDER = Object.keys(GAMES);
const MAX_PLAYERS = 6;
const NAME_MAX = 16;
// The computer waits a moment, so its move can be seen coming.
const BOT_DELAY_MS = 900;
// Back during a game asks first: a second Back within this long ends it.
const BACK_CONFIRM_MS = 3000;

const newId = () => crypto.randomBytes(4).toString('hex');
const newToken = () => crypto.randomBytes(16).toString('hex');

/**
 * Game night: phones join with a name and colour and play games against each
 * other or against pi·cast. ▼ on the TV's home screen (or a phone) opens it;
 * the first person to join is the host, who adds computer players, picks the
 * game and starts it. The TV remote can do the same: ◀ ▶ pick, OK start, Back.
 *
 * Each phone holds a secret token (from join()) that it sends with every
 * request. A game is a rules module (connect4.js, tictactoe.js, eins.js) with
 * create/turn/move/bot, and public/private when not everything may be seen
 * (Eins!'s hands); the party seats the players, checks turns, keeps the wins
 * and lets computer players move.
 *
 * Events: 'change'; 'sound' (UI sound name); 'toast' (i18n key)
 */
export default class Party extends EventEmitter {
  constructor({ log }) {
    super();
    this.log = log;
    this.#reset();
  }

  #reset() {
    this.active = false;
    this.players = []; // { id, token, name, color, bot: level | null }, in seating order
    this.hostId = null;
    this.selected = ORDER[0];
    this.game = null; // { id, seats: [playerId], state, round, pointer }
    this.rounds = {}; // gameId -> rounds played, so who starts alternates
    this.wins = {}; // gameId -> { playerId: wins }
    this.backAt = 0;
    clearTimeout(this.botTimer);
  }

  open() {
    if (this.active) return;
    this.active = true;
    this.log.info('game night opened');
    this.emit('sound', 'open');
    this.emit('change');
  }

  /** The host ends the game night for everyone. */
  closeBy(token) {
    this.#hostOnly(token);
    this.close();
  }

  close() {
    if (!this.active) return;
    this.#reset();
    this.log.info('game night closed');
    this.emit('sound', 'close');
    this.emit('change');
  }

  // --- Players ---

  /** Joins (or, with a known token, updates) a player; returns { token, id }. Opens the party if needed. */
  join(token, { name, color } = {}) {
    let p = this.#byToken(token);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) throw Object.assign(new Error('the table is full'), { why: 'gamesFull' });
      this.open();
      p = { id: newId(), token: newToken(), name: '', color: null, bot: null };
      this.players.push(p);
      this.log.info(`game night: player ${p.id} joined`);
    }
    const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    if (clean) p.name = clean;
    if (!p.name) p.name = `Player ${this.#humans().length}`; // the phone asks for a name; just in case
    if (PLAYER_COLORS.includes(color) && !this.players.some((o) => o !== p && o.color === color)) p.color = color;
    p.color ??= this.#freeColor();
    this.#fixHost();
    this.emit('change');
    return { token: p.token, id: p.id };
  }

  leave(token) {
    const p = this.#byToken(token);
    if (!p) return;
    this.#remove(p);
    if (!this.#humans().length) this.close();
  }

  /** The host (or the TV, token null) adds a computer player. */
  addBot(token, level = DEFAULT_LEVEL) {
    this.#hostOnly(token);
    if (this.players.length >= MAX_PLAYERS) throw Object.assign(new Error('the table is full'), { why: 'gamesFull' });
    const bots = this.players.filter((p) => p.bot).length;
    this.players.push({
      id: newId(), token: null, name: bots ? `pi·cast ${bots + 1}` : 'pi·cast', color: this.#freeColor(), bot: LEVELS.includes(level) ? level : DEFAULT_LEVEL,
    });
    this.emit('change');
  }

  /** The host changes a computer player's level, or removes it (level null). */
  setBot(token, id, level) {
    this.#hostOnly(token);
    const p = this.players.find((o) => o.id === id && o.bot);
    if (!p) return;
    if (level == null) this.#remove(p);
    else if (LEVELS.includes(level)) p.bot = level;
    this.emit('change');
  }

  #remove(p) {
    this.players = this.players.filter((o) => o !== p);
    if (this.game?.seats.includes(p.id)) {
      this.game = null;
      this.emit('toast', 'gamesPlayerLeft');
    }
    this.#fixHost();
    this.emit('change');
  }

  #humans() { return this.players.filter((p) => !p.bot); }
  #byToken(token) { return token ? this.players.find((p) => p.token === token) : null; }
  #freeColor() { return PLAYER_COLORS.find((c) => !this.players.some((p) => p.color === c)) ?? PLAYER_COLORS[0]; }

  #fixHost() {
    if (!this.#humans().some((p) => p.id === this.hostId)) this.hostId = this.#humans()[0]?.id ?? null;
  }

  /** Lobby actions: the host's phone, or the TV (token null; the web API never passes null). */
  #hostOnly(token) {
    if (token == null) return;
    const p = this.#byToken(token);
    if (!p || p.id !== this.hostId) throw Object.assign(new Error('only the host can do that'), { status: 403, why: 'gamesHostOnly' });
  }

  // --- Games ---

  select(token, gameId) {
    this.#hostOnly(token);
    if (!GAMES[gameId] || this.game) return;
    this.selected = gameId;
    this.emit('sound', 'move');
    this.emit('change');
  }

  /** Starts the selected game (a new round if one just ended); fills empty seats with pi·cast. */
  start(token) {
    this.#hostOnly(token);
    if (this.game && !this.game.state.over) return;
    const rules = GAMES[this.selected];
    while (this.players.length < rules.min) this.addBot(null);
    const round = this.rounds[rules.id] ?? 0;
    const seats = this.players.slice(0, rules.max).map((p) => p.id);
    this.game = { id: rules.id, seats, state: rules.create(seats.length, round), round, pointer: null };
    this.log.info(`game night: ${rules.id} round ${round + 1} (${seats.length} players)`);
    this.emit('sound', 'select');
    this.emit('change');
    this.#botTurn();
  }

  /** Back to the lobby. */
  endGame(token) {
    this.#hostOnly(token);
    if (!this.game) return;
    this.game = null;
    this.emit('sound', 'close');
    this.emit('change');
  }

  /** A player's move: `action` is the rules module's (e.g. { col: 3 }). */
  move(token, action) {
    const p = this.#byToken(token);
    const seat = this.game?.seats.indexOf(p?.id) ?? -1;
    if (seat < 0) throw Object.assign(new Error('not in this game'), { status: 403 });
    this.#apply(seat, action);
  }

  /**
   * What the player whose turn it is points at on their phone, shown on the
   * TV (Vier gewinnt: the column the disc hovers over). Not a move.
   */
  point(token, value) {
    const p = this.#byToken(token);
    const g = this.game;
    if (!g || !p) return;
    const seat = g.seats.indexOf(p.id);
    if (seat < 0 || GAMES[g.id].turn(g.state) !== seat) return;
    g.pointer = { seat, value };
    this.emit('change');
  }

  #apply(seat, action) {
    const g = this.game;
    const rules = GAMES[g.id];
    if (rules.turn(g.state) !== seat) throw Object.assign(new Error('not your turn'), { status: 409, why: 'gamesNotYourTurn' });
    try {
      g.state = rules.move(g.state, seat, action ?? {});
    } catch (e) {
      throw Object.assign(e, { status: 400 });
    }
    g.pointer = null;
    if (g.state.over) this.#finish(g);
    else this.emit('sound', 'move');
    this.emit('change');
    this.#botTurn();
  }

  #finish(g) {
    this.rounds[g.id] = g.round + 1;
    const winner = g.state.winner != null ? g.seats[g.state.winner] : null;
    if (winner) {
      const wins = (this.wins[g.id] ??= {});
      wins[winner] = (wins[winner] ?? 0) + 1;
    }
    // With more people than seats, someone who lost (or seat 0 on a draw) makes room.
    const rules = GAMES[g.id];
    if (this.players.length > rules.max) {
      const out = g.seats.find((id) => id !== winner);
      const p = this.players.find((o) => o.id === out);
      this.players = [...this.players.filter((o) => o !== p), p];
    }
    this.emit('sound', 'notify');
  }

  /** If it's a computer player's turn, it moves after a short pause. */
  #botTurn() {
    clearTimeout(this.botTimer);
    const g = this.game;
    if (!g) return;
    const seat = GAMES[g.id].turn(g.state);
    const p = seat == null ? null : this.players.find((o) => o.id === g.seats[seat]);
    if (!p?.bot) return;
    this.botTimer = setTimeout(async () => {
      if (this.game !== g) return;
      try {
        const action = await GAMES[g.id].bot(g.state, seat, p.bot);
        if (this.game === g) this.#apply(seat, action);
      } catch (e) {
        this.log.warn(`game night: pi·cast's move failed: ${e.message}`);
      }
    }, BOT_DELAY_MS);
  }

  // --- TV remote ---

  /** Remote keys while the game night is on the TV; returns true if used. */
  key(k) {
    if (!this.active) return false;
    const g = this.game;
    if (!g) {
      const i = ORDER.indexOf(this.selected);
      if (k === 'left' || k === 'right') this.select(null, ORDER[(i + (k === 'left' ? -1 : 1) + ORDER.length) % ORDER.length]);
      else if (k === 'ok') this.start(null);
      else if (k === 'back') this.close();
      return true;
    }
    if (g.state.over) {
      if (k === 'ok') this.start(null);
      else if (k === 'back') this.endGame(null);
      return true;
    }
    if (k === 'back') {
      if (Date.now() - this.backAt < BACK_CONFIRM_MS) {
        this.backAt = 0;
        this.endGame(null);
      } else {
        this.backAt = Date.now();
        this.emit('toast', 'gamesBackAgain');
      }
    }
    return true;
  }

  // --- Views ---

  /** What everyone may see: the TV and every phone. */
  view() {
    const g = this.game;
    return {
      active: this.active,
      hostId: this.hostId,
      players: this.players.map(({ id, name, color, bot }) => ({ id, name, color, bot })),
      games: ORDER.map((id) => ({ id, min: GAMES[id].min, max: GAMES[id].max })),
      selected: this.selected,
      wins: this.wins,
      game: g && {
        id: g.id,
        seats: g.seats,
        round: g.round,
        pointer: g.pointer,
        state: GAMES[g.id].public?.(g.state) ?? g.state,
        turn: GAMES[g.id].turn(g.state),
      },
    };
  }

  /** The view for one phone: adds who they are (null if they haven't joined) and what only they may see. */
  viewFor(token) {
    const p = this.#byToken(token);
    const view = this.view();
    if (!p) return { ...view, me: null };
    const seat = this.game?.seats.indexOf(p.id) ?? -1;
    const mine = seat >= 0 ? GAMES[this.game.id].private?.(this.game.state, seat) : undefined;
    return { ...view, me: { id: p.id, host: p.id === this.hostId }, mine };
  }
}
