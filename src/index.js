import os from 'node:os';
import path from 'node:path';
import { loadConfig, DATA_DIR } from './config.js';
import { createLogger } from './log.js';
import Mpv from './mpv.js';
import Streamlink from './streamlink.js';
import Ytdl from './ytdl.js';
import Playback from './playback.js';
import Cast from './cast.js';
import Settings, { streamlinkQuality } from './settings.js';
import Recent from './recent.js';
import Events from './events.js';
import createControls from './controls.js';
import createWebServer from './web.js';
import ReceiverStore from './receiverStore.js';
import Tv from './tv/tv.js';
import Cec from './cec.js';
import BootSplash from './boot.js';
import { themeFor } from './shared/theme.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

const settings = new Settings(path.join(DATA_DIR, 'settings.json'), { deviceName: config.deviceName });
const recent = new Recent(path.join(DATA_DIR, 'recent.json'));
const events = new Events();
const getTheme = () => themeFor(settings.get());

const mpv = new Mpv(config, log);
mpv.scriptFilter = (file) => !file.startsWith('sponsorblock') || settings.get().sponsorBlock;
const streamlink = new Streamlink(config, log);
const ytdl = new Ytdl(config, log);
const playback = new Playback(mpv, streamlink, ytdl, log, {
  getTwitchQuality: () => streamlinkQuality(settings.get().twitchQuality),
});
const cast = new Cast({
  playback, mpv, log,
  dataStore: new ReceiverStore(path.join(DATA_DIR, 'receiver.json')),
  dialPort: config.dialPort,
  logLevel: config.logLevel,
});
const controls = createControls({ playback, cast, mpv });

function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat()
    .filter((x) => x?.family === 'IPv4' && !x.internal);
  // Skip link-local (169.254.x.x) addresses unless there's nothing else.
  const a = all.find((x) => !x.address.startsWith('169.254.')) ?? all[0];
  return a ? a.address : os.hostname();
}

function getStatus() {
  return {
    ...playback.status(),
    deviceName: settings.get().deviceName,
    pairingCode: cast.pairingCode,
    senders: cast.senders(),
  };
}

// --- Live updates to the web app (debounced: mpv can change several properties at once) ---
let statusTimer = null;
function pushStatus() {
  statusTimer ??= setTimeout(() => {
    statusTimer = null;
    events.send('status', getStatus());
  }, 150);
}
events.setSnapshot(() => ({ status: getStatus(), settings: settings.get(), recent: recent.list() }));
// The polled time-pos only matters while something plays (the backdrop ticks too).
mpv.on('property', (name) => {
  if (name !== 'time-pos' || playback.source) pushStatus();
});
playback.on('change', pushStatus);
cast.on('change', pushStatus);

playback.on('loaded', () => {
  const s = playback.source;
  const { url, kind, thumbnail, channel } = s;
  recent.add({ url, kind, title: s.title ?? mpv.props['media-title'] ?? url, channel, thumbnail })
    .then(() => events.send('recent', recent.list()))
    .catch((e) => log.warn('saving recent list failed:', e.message));
});

// --- Applying settings ---
// mpv can't unload scripts, so SponsorBlock on/off needs an mpv restart; that
// waits until nothing is playing.
let mpvRestartPending = false;
function restartMpvWhenIdle() {
  if (!playback.source) {
    mpvRestartPending = false;
    mpv.restart();
  } else {
    mpvRestartPending = true;
  }
}
playback.on('change', () => {
  if (mpvRestartPending) restartMpvWhenIdle();
});

settings.on('change', (values, changed) => {
  log.info('settings changed:', changed.join(', '));
  events.send('settings', values);
  if (changed.includes('deviceName')) {
    cast.restart(values.deviceName).catch((e) => log.error('cast receiver restart failed:', e.message));
  }
  if (changed.includes('sponsorBlock')) restartMpvWhenIdle();
  pushStatus();
});

// --- TV screens ---
const tv = new Tv({
  mpv, playback, cast, settings, log,
  remote: `${os.hostname()}.local:${config.webPort}`,
});
tv.start();

// Keeps the Plymouth boot splash in the current accent.
new BootSplash({ settings, log });

// --- TV remote (HDMI-CEC) ---
const cec = new Cec({ name: settings.get().deviceName, log });
const REMOTE_ACTIONS = {
  ok: () => controls.toggle(),
  playpause: () => controls.toggle(),
  play: () => controls.resume(),
  pause: () => controls.pause(),
  stop: () => controls.stop(),
  back: () => controls.stop(),
  left: () => controls.seekBy(-10),
  rewind: () => controls.seekBy(-10),
  right: () => controls.seekBy(10),
  fastforward: () => controls.seekBy(10),
  backward: () => controls.seekBy(-30),
  forward: () => controls.seekBy(30),
};
cec.on('key', (key) => {
  // The settings panel (and OK on the home screen) come first.
  if (tv.key(key) || !playback.source) return;
  Promise.resolve(REMOTE_ACTIONS[key]?.()).catch((e) => log.debug(`remote key ${key} failed:`, e.message));
});
playback.on('play', () => {
  if (settings.get().cecEnabled && settings.get().cecSwitchInput) cec.switchInput();
});
settings.on('change', (values, changed) => {
  if (changed.includes('cecEnabled')) (values.cecEnabled ? cec.start() : cec.stop());
  else if (changed.includes('deviceName')) cec.restart(values.deviceName);
});
if (settings.get().cecEnabled) cec.start();

// --- Start ---
// Doesn't wait for mpv: it retries in the background if it can't start.
mpv.start();
ytdl.start();
await cast.start(settings.get().deviceName);

const web = createWebServer({
  playback, controls, settings, recent, events, tv, getStatus, getTheme, log,
});
web.listen(config.webPort, () => {
  log.info(`Pi-Cast "${settings.get().deviceName}" ready — web app at http://${lanAddress()}:${config.webPort}`);
});

async function shutdown() {
  log.info('shutting down');
  cec.stop();
  ytdl.stop();
  await streamlink.close();
  await cast.stop();
  await mpv.shutdown();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
