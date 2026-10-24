import os from 'node:os';
import YouTubeCastReceiver from 'yt-cast-receiver';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import Mpv from './mpv.js';
import Streamlink from './streamlink.js';
import Playback from './playback.js';
import CastPlayer from './castPlayer.js';
import createWebServer from './web.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

const mpv = new Mpv(config, log);
const streamlink = new Streamlink(config, log);
const playback = new Playback(mpv, streamlink, log);
const castPlayer = new CastPlayer(playback, mpv, log);

const receiver = new YouTubeCastReceiver(castPlayer, {
  device: {
    name: config.deviceName,
    screenName: config.deviceName,
    brand: 'Pi-Cast',
    model: 'Raspberry Pi',
  },
  dial: { port: config.dialPort },
  logLevel: config.logLevel,
});
receiver.on('senderConnect', (s) => log.info(`cast: ${s.name} connected`));
receiver.on('senderDisconnect', (s) => log.info(`cast: ${s.name} disconnected`));
receiver.on('error', (e) => log.error('cast receiver error:', e.message));
receiver.on('terminate', (e) => {
  log.error('cast receiver terminated:', e.message);
  process.exit(1); // systemd restarts us
});

// "Link with TV code" pairing, shown on the idle screen and in the web UI.
let pairingCode = null;
const pairing = receiver.getPairingCodeRequestService();
pairing.on('response', (code) => {
  pairingCode = code.replace(/(\d{3})(?=\d)/g, '$1 ');
  updateIdleScreen();
});
pairing.on('error', (e) => log.warn('pairing code request failed:', e.message));

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    const a = addrs?.find((x) => x.family === 'IPv4' && !x.internal);
    if (a) return a.address;
  }
  return os.hostname();
}

async function updateIdleScreen() {
  try {
    if (!mpv.props['idle-active']) {
      await mpv.clearOverlay();
      return;
    }
    const lines = [
      `{\\an5\\fs64\\b1}${config.deviceName}`,
      '{\\fs30\\b0}Ready to cast from the YouTube app',
      ' ',
      `{\\fs26}Web: http://${lanAddress()}:${config.webPort}`,
    ];
    if (pairingCode) lines.push(`{\\fs26}TV code: ${pairingCode}`);
    await mpv.showOverlay(lines.join('\\N'));
  } catch (e) {
    log.debug('idle screen update failed:', e.message);
  }
}
mpv.on('ready', updateIdleScreen);
mpv.on('property', (name) => {
  if (name === 'idle-active') updateIdleScreen();
});

await mpv.start();
await receiver.start();
pairing.start();

const web = createWebServer({
  playback, castPlayer, mpv, receiver, log,
  getPairingCode: () => pairingCode,
});
web.listen(config.webPort, () => {
  log.info(`Pi-Cast "${config.deviceName}" ready — web UI at http://${lanAddress()}:${config.webPort}`);
});

async function shutdown() {
  log.info('shutting down');
  pairing.stop();
  streamlink.close();
  await receiver.stop().catch(() => {});
  await mpv.shutdown();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
