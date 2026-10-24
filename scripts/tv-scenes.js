// Sample TV screens, shared by preview-tv.js (PNG previews) and check-osd.js
// (fit test on the Pi). Each scene's layers are lists of ASS events, in the
// same stacking order the app uses. Scenes without `video` sit on the
// background color, which mpv draws itself (the app shows a backdrop image there).
import QRCode from 'qrcode';
import { ACCENTS } from '../src/shared/theme.js';
import * as screens from '../src/tv/screens.js';

const base = { accent: 'violet', customAccent: '#A898FF', clock24: true, bootAnimation: true, sponsorBlock: true, cecSwitchInput: true };
function qrModules(url) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, r) => Array.from({ length: modules.size }, (_, c) => !!modules.get(r, c)));
}
const now = new Date(2026, 9, 24, 21, 34);
const homeState = {
  now, clock24: true, net: { kind: 'wifi', ssid: 'Home', signal: 70 },
  pairingCode: '123 456 789 012', remote: 'picast.local:8080', deviceName: 'Pi-Cast',
  qr: qrModules('http://picast.local:8080'),
};
const video = {
  title: 'Building a tiny cast receiver out of a Raspberry Pi', channel: 'Some Channel', kind: 'youtube',
  position: 724, duration: 1907, live: false,
};
const toastText = "Couldn't play that link";
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
  toast: { settings: base, video: true, layers: (t) => [screens.toast(t, toastText)] },
  // Worst cases: the biggest screens with a toast on top.
  'buffering+popup+toast': {
    settings: base, video: true,
    layers: (t) => [screens.loadingOverVideo(t, 'BUFFERING', video), screens.dots(t, 0),
      screens.senderPill(t, 'iPhone'), screens.toast(t, toastText)],
  },
  'paused+toast': { settings: base, video: true, layers: (t) => [screens.paused(t, video), screens.toast(t, toastText)] },
  'settings+toast': {
    settings: base,
    layers: (t) => [screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 0, swatches }), screens.toast(t, toastText)],
  },
};
