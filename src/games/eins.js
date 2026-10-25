import crypto from 'node:crypto';
import { mistakeChance } from './levels.js';

export const COLORS = ['r', 'y', 'g', 'b'];
const HAND = 7;

/** 108 cards: per colour one 0, two each of 1-9, skip, reverse, +2; four wilds and four +4s. */
function deck() {
  const cards = [];
  for (const color of COLORS) {
    cards.push({ color, value: '0' });
    for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', '+2']) {
      cards.push({ color, value }, { color, value });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ color: null, value: 'wild' }, { color: null, value: '+4' });
  return shuffle(cards.map((c, id) => ({ id, ...c })));
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const isWild = (c) => c.color == null;
const isNumber = (c) => /^\d$/.test(c.value);
const top = (s) => s.pile[s.pile.length - 1];

/** May `card` go on the pile now? With a draw stack open only +2 (on a +2 or in the colour) and +4 may. */
function playable(s, card) {
  if (s.pending) return card.value === '+4' || (card.value === '+2' && (top(s).value === '+2' || card.color === s.color));
  return isWild(card) || card.color === s.color || card.value === top(s).value;
}

/** The seat `steps` players on in the current direction, passing over those who have finished. */
function next(s, from, steps = 1) {
  const n = s.hands.length;
  let seat = from;
  for (let k = 0; k < steps; k++) {
    do seat = (seat + s.dir + n) % n; while (s.finished.includes(seat));
  }
  return seat;
}

/** Draws `n` cards for `seat`; when the deck runs out, the pile (but its top card) is shuffled in. */
function draw(s, seat, n) {
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) {
      if (s.pile.length < 2) return;
      s.deck = shuffle(s.pile.splice(0, s.pile.length - 1));
    }
    s.hands[seat].push(s.deck.pop());
  }
}

const clone = (s) => ({
  ...s, hands: s.hands.map((h) => [...h]), deck: [...s.deck], pile: [...s.pile], called: [...s.called], finished: [...s.finished],
});

/**
 * Eins! (house rules): match the colour or the value; +2 and +4 stack in any
 * combination, and whoever can't add one draws the whole stack and is done;
 * +4 can always be played; drawing (one card) ends the turn; with two players
 * a reverse works as a skip. Press "Eins!" before playing your second-to-last
 * card, or draw 2 as a penalty. Whoever runs out of cards takes the next
 * place, and the round goes on until one player is left (last place).
 * `winner` is first place, `finished` the seats in finishing order.
 *
 * Actions: { type: 'play', card: id, color?: 'r'|'y'|'g'|'b' (wilds), eins?: true },
 * { type: 'draw' }.
 */
export default {
  id: 'eins',
  min: 2,
  max: 6,

  create(seats, round) {
    const s = {
      deck: deck(), hands: Array.from({ length: seats }, () => []), pile: [], color: null, dir: 1,
      turn: round % seats, pending: 0, called: Array(seats).fill(false), finished: [], last: null, over: false, winner: null,
    };
    for (let i = 0; i < HAND; i++) for (let p = 0; p < seats; p++) draw(s, p, 1);
    // The first card is a number, so the round starts without an effect.
    let i = s.deck.findLastIndex(isNumber);
    s.pile.push(...s.deck.splice(i, 1));
    s.color = top(s).color;
    return s;
  },

  turn: (s) => (s.over ? null : s.turn),

  move(state, seat, action) {
    const s = clone(state);
    if (action.type === 'draw') {
      const n = s.pending || 1;
      draw(s, seat, n);
      s.pending = 0;
      s.called[seat] = false;
      s.last = { seat, type: 'draw', n };
      s.turn = next(s, seat);
      return s;
    }
    if (action.type !== 'play') throw new Error('illegal move');
    const hand = s.hands[seat];
    const at = hand.findIndex((c) => c.id === action.card);
    const card = hand[at];
    if (!card || !playable(s, card)) throw new Error('illegal move');
    if (isWild(card) && !COLORS.includes(action.color)) throw new Error('pick a colour');
    hand.splice(at, 1);
    s.pile.push(card);
    s.color = isWild(card) ? action.color : card.color;
    s.last = { seat, type: 'play', card, color: s.color };
    // Out of cards: the next place. The card still counts (a +2 still stacks for the next player).
    if (!hand.length) {
      s.finished.push(seat);
      s.last.place = s.finished.length;
      s.winner = s.finished[0];
      s.called[seat] = false;
      const left = s.hands.map((_, i) => i).filter((i) => !s.finished.includes(i));
      if (left.length === 1) {
        s.finished.push(left[0]);
        s.over = true;
        return s;
      }
    } else if (hand.length === 1 && !action.eins) {
      // Down to one card without calling it: two cards as a penalty.
      draw(s, seat, 2);
      s.last.penalty = true;
    }
    s.called[seat] = hand.length === 1 && !!action.eins;
    let steps = 1;
    if (card.value === 'skip') steps = 2;
    else if (card.value === 'rev') {
      s.dir = -s.dir;
      // Two players left: the same player goes again (not if that was their last card).
      if (hand.length && s.hands.length - s.finished.length === 2) steps = 2;
    } else if (card.value === '+2' || card.value === '+4') {
      s.pending += Number(card.value.slice(1));
    }
    s.turn = next(s, seat, steps);
    return s;
  },

  /** What everyone sees: card counts, the pile's top two cards, the colour and the stack. */
  public(s) {
    return {
      counts: s.hands.map((h) => h.length), pile: s.pile.slice(-2), deck: s.deck.length, color: s.color, dir: s.dir,
      pending: s.pending, called: s.called, finished: s.finished, last: s.last, turn: s.turn, over: s.over, winner: s.winner,
    };
  },

  /** Only for `seat`'s phone: their hand and which cards they may play. */
  private(s, seat) {
    const hand = s.hands[seat];
    return { hand, playable: s.over || s.turn !== seat ? [] : hand.filter((c) => playable(s, c)).map((c) => c.id) };
  },

  bot(s, seat, level) {
    const hand = s.hands[seat];
    const options = hand.filter((c) => playable(s, c));
    if (!options.length) return { type: 'draw' };
    const sloppy = Math.random() < mistakeChance(level);
    // The colour it holds most of (wilds don't count).
    const counts = Object.fromEntries(COLORS.map((c) => [c, hand.filter((h) => h.color === c).length]));
    const favourite = COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    const nextCount = s.hands[next(s, seat)].length;
    const score = (c) => {
      if (sloppy) return Math.random();
      let v = 0;
      if (isWild(c)) v -= 20; // keep wilds for when nothing else goes
      if (c.value === '+4') v -= 5;
      if (['skip', 'rev', '+2', '+4'].includes(c.value)) v += nextCount <= 2 ? 30 : 2; // stop someone about to win
      if (c.color === favourite) v += 5;
      if (isNumber(c)) v += Number(c.value) / 10; // get rid of high numbers
      return v;
    };
    const card = options.reduce((a, b) => (score(b) > score(a) ? b : a));
    return {
      type: 'play', card: card.id, color: isWild(card) ? favourite : undefined,
      // Forgets to call "Eins!" as often as it makes mistakes.
      eins: hand.length === 2 && Math.random() >= mistakeChance(level),
    };
  },
};
