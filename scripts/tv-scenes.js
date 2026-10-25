// Sample TV screens, shared by preview-tv.js (PNG previews) and check-osd.js
// (fit test on the Pi). Each scene's layers are lists of ASS events, in the
// same stacking order the app uses. Scenes without `video` sit on the
// background color, which mpv draws itself (the app shows a backdrop image there).
// `reel` scenes get a stand-in for the upright Reel in the previews.
import QRCode from 'qrcode';
import { ACCENTS } from '../src/shared/theme.js';
import * as screens from '../src/tv/screens.js';

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
const swatches = Object.entries(ACCENTS).map(([id, a]) => ({ id, hex: a.hex, selected: id === 'violet' }));

export const scenes = {
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
  'paused+toast': { settings: base, video: true, layers: (t) => [screens.paused(t, video), screens.toast(t, toastText)] },
  'settings+toast': {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 0, swatches }), screens.toast(t, toastText)],
  },
};
