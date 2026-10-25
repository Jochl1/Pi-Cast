// Sample TV screens, shared by preview-tv.js (PNG previews) and check-osd.js
// (fit test on the Pi). Each scene's layers are lists of ASS events, in the
// same stacking order the app uses. Scenes without `video` sit on the
// background color, which mpv draws itself (the app shows a backdrop image there).
// `reel` scenes get a stand-in for the upright Reel in the previews.
import QRCode from 'qrcode';
import { ACCENTS } from '../src/shared/theme.js';
import * as screens from '../src/tv/screens.js';
import * as gameScreens from '../src/tv/games.js';
import { Chess } from 'chess.js';
import Party from '../src/games/party.js';
import chessRules from '../src/games/chess.js';

const base = { accent: 'violet', customAccent: '#A898FF', clock24: true, bootAnimation: true, sponsorBlock: true, cecSwitchInput: true };
function qrModules(url) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, r) => Array.from({ length: modules.size }, (_, c) => !!modules.get(r, c)));
}
const de = { ...base, language: 'de' };
const now = new Date(2026, 9, 24, 21, 34);
const homeState = {
  now, clock24: true, net: { kind: 'wifi', ssid: 'Home', signal: 70 },
  pairingCode: '123 456 789 012', deviceName: 'pi-cast',
  qr: qrModules('http://picast.local:8080'),
  weather: {
    current: { temp: 13.6, code: 2, day: true },
    days: [
      { date: '2026-10-24', code: 2, max: 15.2, min: 8.1 },
      { date: '2026-10-25', code: 61, max: 12.4, min: 7.9 },
      { date: '2026-10-26', code: 3, max: 11.0, min: 6.2 },
      { date: '2026-10-27', code: 0, max: 14.8, min: 5.5 },
    ],
  },
  keys: [{ hex: '#FF5D5D', name: 'Trymacs', live: true }, { hex: '#4BE3B0', name: 'BigSpin' }],
  instagram: true,
};
const video = {
  title: 'Building a tiny cast receiver out of a Raspberry Pi', channel: 'Some Channel', kind: 'youtube',
  position: 724, duration: 1907, live: false,
};
const toastText = "Couldn't play that link";
const reel = {
  user: 'kitchen.stories.daily',
  caption: 'Three-ingredient pasta in 10 minutes 🍝🔥 Save this for later! Recipe: 200 g spaghetti, 2 cloves of garlic, olive oil, chili flakes and a lot of parmesan #pasta #recipe #quickdinner #foodtok',
  likes: 48213,
  liked: false,
};
// Game night: a real Party, played into the states to show.
function party(build) {
  const p = new Party({ log: { info() {}, warn() {}, debug() {} } });
  build(p);
  clearTimeout(p.botTimer); // no computer moves in a preview
  return p.view();
}
const gamesQr = qrModules('http://pi-cast.local:8080/#games');
const lobbyView = party((p) => {
  p.join(null, { name: 'Johann' });
  p.join(null, { name: 'Lea' });
  p.addBot(null);
});
const c4Moves = [3, 3, 2, 4, 2, 2, 4, 1, 1];
const c4View = party((p) => {
  const a = p.join(null, { name: 'Johann' }).token;
  const b = p.join(null, { name: 'Lea' }).token;
  p.start(null);
  c4Moves.forEach((col, i) => p.move(i % 2 ? b : a, { col }));
  p.point(b, 4);
});
const c4WonView = party((p) => {
  const a = p.join(null, { name: 'Johann' }).token;
  const b = p.join(null, { name: 'Maximilian' }).token;
  p.start(null);
  [0, 6, 1, 6, 2, 5, 3].forEach((col, i) => p.move(i % 2 ? b : a, { col }));
});
const tttWonView = party((p) => {
  const { id } = p.join(null, { name: 'Johann' });
  p.addBot(null);
  p.select(null, 'tictactoe');
  p.start(null);
  // ✕ won on the diagonal.
  p.game.state = {
    cells: [0, 1, null, 1, 0, null, null, null, 0], turn: 1, last: 8, line: [0, 4, 8], over: true, winner: 0,
  };
  p.wins = { tictactoe: { [id]: 3 } };
});

// Eins!: four players; Lea is down to one card (called), a +6 stack is open.
const einsView = party((p) => {
  ['Johann', 'Lea', 'Maximilian'].forEach((name) => p.join(null, { name }));
  p.addBot(null);
  p.select(null, 'eins');
  p.start(null);
  const s = p.game.state;
  s.hands[1] = s.hands[1].slice(0, 1);
  s.called[1] = true;
  s.hands[0] = [];
  s.finished = [0];
  s.pile.push({ id: 200, color: 'g', value: '+2' }, { id: 201, color: null, value: '+4' });
  s.color = 'b';
  s.pending = 6;
  s.turn = 2;
  s.last = { seat: 1, type: 'play', card: { id: 201, color: null, value: '+4' }, color: 'b' };
});
const einsOverView = party((p) => {
  ['Johann', 'Lea', 'Maximilian', 'Sophie'].forEach((name) => p.join(null, { name }));
  p.addBot(null);
  p.select(null, 'eins');
  p.start(null);
  const s = p.game.state;
  Object.assign(s, { over: true, winner: 2, finished: [2, 0, 4, 1, 3] });
});

// Schach: moves given in SAN, played through the rules module.
function chessPlay(p, sans) {
  const board = new Chess();
  for (const san of sans) {
    const { from, to, promotion } = board.move(san);
    p.game.state = chessRules.move(p.game.state, p.game.state.turn, { type: 'move', from, to, promotion });
  }
}
// Against pi·cast, in the Italian game (Møller attack); material is even.
const chessView = party((p) => {
  p.join(null, { name: 'Johann' });
  p.addBot(null);
  p.select(null, 'chess');
  p.start(null);
  chessPlay(p, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Nc3', 'Nxe4', 'O-O', 'Bxc3',
    'd5', 'Bf6', 'Re1', 'Ne7', 'Rxe4', 'd6', 'Bg5', 'Bxg5', 'Nxg5', 'h6']);
});
// Two people; Lea (white this round) gives check and offers a draw.
const chessCheckView = party((p) => {
  const { id } = p.join(null, { name: 'Johann' });
  p.join(null, { name: 'Lea' });
  p.select(null, 'chess');
  p.rounds.chess = 1;
  p.start(null);
  chessPlay(p, ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Bb4', 'cxd5', 'exd5', 'Qa4+']);
  p.game.state = chessRules.move(p.game.state, 1, { type: 'offer' });
  p.wins = { chess: { [id]: 1 } };
});
// The most taken pieces on a card (11) and a big lead.
const chessMaterialView = party((p) => {
  p.join(null, { name: 'Johann' });
  p.join(null, { name: 'Sophie' });
  p.select(null, 'chess');
  p.start(null);
  chessPlay(p, ['Nf3', 'b6', 'g3', 'Ba6', 'Nh4', 'Bb5', 'f4', 'h5', 'c3', 'Rh7', 'Bg2', 'c6', 'e4', 'Bc4', 'a3', 'Be6', 'b4', 'a5',
    'bxa5', 'Rh8', 'axb6', 'Qxb6', 'Bb2', 'Qxb2', 'Bh3', 'Qxa3', 'e5', 'Qxa1', 'Bxe6', 'dxe6', 'Qe2', 'Kd7', 'Qd3+', 'Kc8', 'Ng2',
    'Rh6', 'f5', 'exf5', 'Qxf5+', 'Kd8', 'Qd3+', 'Ke8', 'Rg1', 'Ra7', 'Qc4', 'Qxb1+', 'Ke2', 'Qxg1', 'Nh4', 'g6', 'g4', 'Bg7', 'gxh5',
    'Qxh2+', 'Ng2', 'c5', 'Qb5+', 'Kd8', 'd3', 'Qxg2+', 'Ke1', 'Qh1+', 'Ke2', 'Qxh5+', 'Kf2', 'Ra8', 'Qxc5', 'Ra2+']);
});
const chessMateView = party((p) => {
  p.join(null, { name: 'Johann' });
  p.join(null, { name: 'Maximilian' });
  p.select(null, 'chess');
  p.start(null);
  chessPlay(p, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
});

const comments = [
  { author: '@maxbaut', ago: 'vor 2 Tagen', likes: '4202', text: 'Wer hätte gedacht, dass ein Raspberry Pi das alles schafft. Bau ich am Wochenende nach.' },
  { author: '@a.very.long.channel.name.that.goes.on', ago: '3 years ago (edited)', likes: '427,408', text: 'This is a really long comment that keeps going and going so that it needs more than three lines on the TV, which means the end of it has to be cut off with an ellipsis somewhere around here, or maybe a bit later than that, it depends on the font and the width of the card.' },
];
const stations = [
  { name: '1LIVE', tags: 'pop, rock' }, { name: 'SWR3', tags: 'pop, rock' }, { name: 'FM4', tags: 'alternative, electronic' },
  { name: 'Deutschlandfunk', tags: 'news, culture' }, { name: 'bigFM', tags: 'charts, hip-hop' }, { name: 'Radio BOB!', tags: 'rock' },
  { name: 'Klassik Radio', tags: 'classical' }, { name: 'Lofi Radio', tags: 'lofi, chill' },
];
const swatches = Object.entries(ACCENTS).map(([id, a]) => ({ id, hex: a.hex, selected: id === 'violet' }));

export const scenes = {
  comment: {
    settings: de, video: true,
    layers: (t) => [screens.commentCard(t, { comment: comments[0], index: 0, total: 20 })],
  },
  'comment-long+toast-top': {
    settings: base, video: true,
    layers: (t) => [screens.commentCard(t, { comment: comments[1], index: 4, total: 20 }), screens.toast(t, toastText, null, { top: true })],
  },
  'comment-loading': { settings: de, video: true, layers: (t) => [screens.commentCard(t, { comment: null, index: 0, total: 0 })] },
  'radio-grid': {
    settings: de,
    layers: (t) => [screens.radioGrid(t, { now, clock24: true, stations, focus: 0 })],
  },
  'radio-grid-scrolled+toast': {
    settings: base,
    layers: (t) => [screens.radioGrid(t, { now, clock24: false, stations: [...stations, ...stations.slice(0, 3)], focus: 9 }), screens.toast(t, toastText, null, { top: true })],
  },
  'radio-empty': { settings: de, layers: (t) => [screens.radioGrid(t, { now, clock24: true, stations: [], focus: 0 })] },
  radio: {
    settings: de,
    layers: (t) => [screens.radio(t, { station: { ...stations[0], index: 0 }, song: 'Die Beispiele - Ein Lied über den Herbst', paused: false })],
  },
  'radio-long-paused+toast': {
    settings: base,
    layers: (t) => [screens.radio(t, { station: { name: 'Deutschlandfunk Kultur', tags: 'culture, news', index: 3 }, song: 'Ein sehr langer Titel einer Sendung ohne Trennstrich und mit vielen Wörtern', paused: true }),
      screens.toast(t, 'Lautstärke 45', null, { top: true })],
  },
  home: { settings: base, layers: (t) => [screens.home(t, homeState)] },
  'home-12h-amber': {
    settings: { ...base, accent: 'amber' },
    layers: (t) => [screens.home(t, { ...homeState, clock24: false })],
  },
  loading: {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, loading: { ...video, sender: 'iPhone' } }), screens.dots(t, 0.3)],
  },
  'loading-over-video': {
    settings: base, video: true,
    layers: (t) => [screens.loadingOverVideo(t, 'LOADING', { ...video, sender: 'iPhone' }), screens.dots(t, 0.6)],
  },
  playing: {
    settings: base, video: true,
    layers: (t) => [screens.nowPlaying(t, { ...video, quality: '1080p', withThumb: true }), screens.senderPill(t, 'iPhone')],
  },
  paused: { settings: base, video: true, layers: (t) => [screens.paused(t, video)] },
  settings: {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 0, swatches })],
  },
  'settings-focus': {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 2, swatches })],
  },
  'settings-power': {
    settings: de,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: de, focus: screens.PANEL_ROWS.length - 1, swatches, powerConfirm: true })],
  },
  toast: { settings: base, video: true, layers: (t) => [screens.toast(t, toastText)] },
  'key-toast': { settings: base, video: true, layers: (t) => [screens.toast(t, 'Trymacs', '#FF5D5D')] },
  'home-night-icons': {
    settings: { ...base, accent: 'cyan' },
    layers: (t) => [screens.home(t, {
      ...homeState,
      weather: {
        current: { temp: -2.4, code: 0, day: false },
        days: [
          { date: '2026-10-24', code: 0, max: 1, min: -4 },
          { date: '2026-10-25', code: 73, max: 0, min: -3 },
          { date: '2026-10-26', code: 95, max: 4, min: 1 },
          { date: '2026-10-27', code: 45, max: 3, min: -1 },
        ],
      },
      keys: [{ hex: '#FF5D5D', name: 'Trymacs', live: true }, { hex: '#4BE3B0', name: 'BigSpin', live: true }, { hex: '#FFD23F', name: 'Lofi Girl', live: true }, { hex: '#4D7CFF', name: 'Kurzgesagt' }],
    })],
  },
  airplay: {
    settings: de,
    layers: (t) => [screens.airplay(t, {
      now, clock24: true,
      item: { title: 'Flying High', artist: 'DCX, DJ Square', album: 'Flying High (Dj Square Hardcore Remix)', position: 83, duration: 201, playing: true },
    })],
  },
  'airplay-paused+toast': {
    settings: de,
    layers: (t) => [screens.airplay(t, {
      now, clock24: true,
      item: { title: 'A much longer song title that has to be cut', artist: 'Someone', album: '', position: 10, duration: 0, playing: false },
    }), screens.toast(t, toastText)],
  },
  // German: the longest texts.
  'home-de+toast-top': {
    settings: de,
    layers: (t) => [screens.home(t, homeState), screens.toast(t, t.tr('reelsLoggedOut'), null, { top: true, narrow: true })],
  },
  'home+key-toast-top': {
    settings: base,
    layers: (t) => [screens.home(t, homeState), screens.toast(t, 'Trymacs', '#FF5D5D', { top: true, narrow: true })],
  },
  'home-de': { settings: de, layers: (t) => [screens.home(t, homeState)] },
  'loading-de': {
    settings: de,
    layers: (t) => [screens.home(t, { ...homeState, loading: { ...video, sender: 'iPhone' } }), screens.dots(t, 0.3)],
  },
  'playing-de': {
    settings: de, video: true,
    layers: (t) => [screens.nowPlaying(t, { ...video, quality: '1080p', withThumb: true }), screens.senderPill(t, 'iPhone von Johann')],
  },
  'settings-de+toast': {
    settings: de,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: de, focus: 1, swatches }), screens.toast(t, t.tr('couldntPlay'))],
  },
  reels: { settings: base, reel: true, layers: (t) => [screens.reels(t, { reel })] },
  'reels-loading': { settings: base, layers: (t) => [screens.reels(t, { reel: null }), screens.dots(t, 0.3, screens.W / 2, screens.H / 2)] },
  'reels-de-liked': {
    settings: de, reel: true,
    layers: (t) => [screens.reels(t, { reel: { ...reel, liked: true, likes: 48214, caption: 'Kurz' }, pulse: 0.8 })],
  },
  // Worst cases: the biggest screens with a toast on top.
  'buffering+popup+toast': {
    settings: base, video: true,
    layers: (t) => [screens.loadingOverVideo(t, 'BUFFERING', video), screens.dots(t, 0),
      screens.senderPill(t, 'iPhone'), screens.toast(t, toastText)],
  },
  'reels-paused+like+toast': {
    settings: de, reel: true,
    layers: (t) => [screens.reels(t, { reel, paused: true, pulse: 1 }), screens.toast(t, t.tr('reelsLoggedOut'))],
  },
  timeline: { settings: base, video: true, layers: (t) => [screens.timeline(t, video)] },
  'timeline-live+toast': {
    settings: de, video: true,
    layers: (t) => [screens.timeline(t, { ...video, live: true }), screens.toast(t, toastText, null, { top: true })],
  },
  'paused+toast': { settings: base, video: true, layers: (t) => [screens.paused(t, video), screens.toast(t, toastText)] },
  'settings+toast': {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 0, swatches }), screens.toast(t, toastText)],
  },
  'games-lobby': { settings: de, layers: (t) => [gameScreens.games(t, lobbyView, gamesQr)] },
  'games-lobby-full-en': {
    settings: base,
    layers: (t) => [gameScreens.games(t, party((p) => {
      ['Johann', 'Lea', 'Maximilian', 'Sophie', 'Ben'].forEach((name) => p.join(null, { name }));
      p.addBot(null);
    }), gamesQr), screens.toast(t, toastText, null, { top: true })],
  },
  'games-connect4': { settings: de, layers: (t) => [gameScreens.games(t, c4View, gamesQr)] },
  'games-connect4-won+toast': {
    settings: de,
    layers: (t) => [gameScreens.games(t, c4WonView, gamesQr), screens.toast(t, t.tr('gamesBackAgain'), null, { top: true })],
  },
  'games-tictactoe-won': { settings: de, layers: (t) => [gameScreens.games(t, tttWonView, gamesQr)] },
  'games-eins+toast': {
    settings: de,
    layers: (t) => [gameScreens.games(t, einsView, gamesQr), screens.toast(t, t.tr('gamesBackAgain'), null, { top: true })],
  },
  'games-chess': { settings: de, layers: (t) => [gameScreens.games(t, chessView, gamesQr)] },
  'games-chess-check+toast': {
    settings: { ...de, accent: 'mint' },
    layers: (t) => [gameScreens.games(t, chessCheckView, gamesQr), screens.toast(t, t.tr('gamesBackAgain'), null, { top: true })],
  },
  'games-chess-material-en': { settings: base, layers: (t) => [gameScreens.games(t, chessMaterialView, gamesQr)] },
  'games-chess-mate': { settings: de, layers: (t) => [gameScreens.games(t, chessMateView, gamesQr)] },
  'games-eins-won': { settings: de, layers: (t) => [gameScreens.games(t, einsOverView, gamesQr)] },
};
