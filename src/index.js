import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, DATA_DIR } from './config.js';
import { createLogger } from './log.js';
import Mpv from './mpv.js';
import Streamlink from './streamlink.js';
import Ytdl from './ytdl.js';
import Instagram from './instagram.js';
import Reels from './reels.js';
import Weather, { findPlace } from './weather.js';
import AirPlay from './airplay.js';
import TwitchLive from './twitchLive.js';
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
import Sounds from './sounds.js';
import { KEY_COLORS, themeFor } from './shared/theme.js';
import { translator } from './shared/i18n.js';

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
const instagram = new Instagram(log);
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
const reels = new Reels({
  instagram, playback, controls, log,
});

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
events.setSnapshot(() => ({
  status: getStatus(), settings: settings.get(), recent: recent.list(), instagram: instagram.state,
}));
instagram.on('change', (state) => events.send('instagram', state));
// The polled time-pos only matters while something plays (the backdrop ticks too).
mpv.on('property', (name) => {
  if (name !== 'time-pos' || playback.source) pushStatus();
});
playback.on('change', pushStatus);
cast.on('change', pushStatus);

playback.on('loaded', () => {
  const s = playback.source;
  if (s.kind === 'instagram') return; // every Reel would push the rest out
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
// The Pi 3 can't fit the overlays and then draws none of them until mpv
// restarts (DESIGN §4.2). Log what was on screen, and restart once idle.
mpv.on('log', (text) => {
  if (!text.includes('OSD bitmaps do not fit') || mpvRestartPending) return;
  log.warn(`overlays didn't fit (screen ${tv.screen()}: ${tv.layerSummary()}); restarting mpv when idle`);
  restartMpvWhenIdle();
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
const airplay = new AirPlay(log);
airplay.start();
const sounds = new Sounds({
  config, mpv, playback, airplay, settings, log,
});
sounds.start();
// A video takes the audio device from AirPlay (the session ends on the phone);
// AirPlay starting stops whatever plays, since picking pi-cast means music.
const releaseSounds = mpv.beforeLoad;
mpv.beforeLoad = async () => {
  await airplay.release();
  await releaseSounds?.();
};
airplay.on('session', (on) => {
  if (on && playback.source) controls.stop().catch((e) => log.warn('stopping for AirPlay failed:', e.message));
});
const weather = new Weather({ settings, log });
weather.start();
const twitchLive = new TwitchLive({ settings, playback, log });
twitchLive.start();
/**
 * The settings panel's power row. A Pi 3 only starts again when its power is
 * reconnected. The toast shows for a moment first; systemd then stops Pi-Cast
 * as usual. Allowed through a sudoers rule for exactly this (install.sh).
 */
function powerOff() {
  log.info('powering off (settings panel)');
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'poweroff'], (e) => {
      if (e) log.warn('powering off failed:', e.message);
    });
  }, 1500);
}
const tv = new Tv({
  mpv, playback, cast, settings, sounds, reels, weather, instagram, airplay, twitchLive, log,
  remote: `${os.hostname()}.local:${config.webPort}`, powerOff,
});
tv.start();
reels.on('toast', (key, sound) => tv.toast(translator(settings.get().language)(key), { sound }));

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
/** A colour key plays its favourite, on any screen, like "Play a link" in the web app. */
function playShortcut(color) {
  const tr = translator(settings.get().language);
  const shortcut = settings.get().shortcuts[color];
  const keyName = tr(`key${color[0].toUpperCase()}${color.slice(1)}`);
  if (!shortcut) {
    tv.toast(tr('shortcutUnset', { key: keyName }), { dot: KEY_COLORS[color], sound: 'error' });
    return;
  }
  tv.toast(shortcut.name, { dot: KEY_COLORS[color] });
  playback.play(shortcut.url, { owner: 'web' }).catch((e) => {
    log.warn(`${color} key: ${e.message}`);
    tv.toast(tr('couldntPlay'), { sound: 'error' });
  });
}

/** A key from the TV remote (or /api/tv/key); returns true if it did something. */
function remoteKey(key) {
  if (key in KEY_COLORS) {
    playShortcut(key);
    return true;
  }
  // Reels, then the settings panel (and OK on the home screen) come first.
  if (reels.key(key) || tv.key(key)) return true;
  if (tv.screen() === 'airplay' && (key === 'back' || key === 'stop')) {
    airplay.release();
    return true;
  }
  if (key === 'up' && tv.screen() === 'home') {
    reels.open().catch((e) => log.warn('opening Reels failed:', e.message));
    return true;
  }
  if (!playback.source || !REMOTE_ACTIONS[key]) return false;
  Promise.resolve(REMOTE_ACTIONS[key]()).catch((e) => log.debug(`remote key ${key} failed:`, e.message));
  return true;
}
cec.on('key', remoteKey);
playback.on('play', () => {
  if (settings.get().cecEnabled && settings.get().cecSwitchInput) cec.switchInput();
});
// TV off: stop, and the home screen holds still. TV on: it moves again, with the startup sound,
// and the widgets (weather, LIVE tags) are fetched again.
function setStandby(on) {
  if (on === playback.standby) return;
  log.info(on ? 'TV is off: standby' : 'TV is on: waking up');
  playback.setStandby(on); // first, so stopping brings the backdrop back paused
  if (on) playback.stop().catch((e) => log.warn('stopping for standby failed:', e.message));
  else {
    weather.refresh();
    twitchLive.refresh();
  }
  // Not when the TV was woken by a cast: the video is already on its way.
  if (!on && !playback.source) sounds.startup();
}
cec.on('power', (power) => setStandby(power === 'standby' && settings.get().cecStandby));
settings.on('change', (values, changed) => {
  if (changed.includes('cecStandby') && !values.cecStandby) setStandby(false);
  if (changed.includes('cecEnabled')) (values.cecEnabled ? cec.start() : cec.stop());
  else if (changed.includes('deviceName')) cec.restart(values.deviceName);
});
if (settings.get().cecEnabled) cec.start();

// --- Start ---
/**
 * The boot splash stays up until mpv is about to take the screen (with no
 * gap, as the TV would show black). picast.service is Type=notify and ordered
 * before plymouth-quit, so telling systemd we're ready lets Plymouth go; mpv
 * then starts once the display is free.
 */
async function endSplash() {
  if (!process.env.NOTIFY_SOCKET) return; // not under systemd, or not at boot
  await new Promise((resolve) => {
    execFile('systemd-notify', ['--ready'], (e) => {
      if (e) log.warn('telling systemd we are ready failed:', e.message);
      resolve();
    });
  });
  for (let i = 0; i < 100 && fs.existsSync('/run/plymouth/pid'); i++) await new Promise((r) => setTimeout(r, 100));
}
await endSplash();
// Splash, then the startup sound, then the home screen.
playback.once('backdrop', () => sounds.booted());
// Doesn't wait for mpv: it retries in the background if it can't start.
mpv.start();
ytdl.start();
instagram.start();
await cast.start(settings.get().deviceName);

const web = createWebServer({
  playback, controls, settings, recent, events, remoteKey, instagram, findPlace, getStatus, getTheme, log,
});
web.listen(config.webPort, () => {
  log.info(`Pi-Cast "${settings.get().deviceName}" ready — web app at http://${lanAddress()}:${config.webPort}`);
});

async function shutdown() {
  log.info('shutting down');
  cec.stop();
  ytdl.stop();
  instagram.stop();
  await streamlink.close();
  await cast.stop();
  await mpv.shutdown();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
