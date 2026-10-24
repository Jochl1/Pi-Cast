import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Runtime state: settings, recent list, receiver session, generated images.
export const DATA_DIR = process.env.PICAST_DATA || path.join(ROOT, 'data');

// Prefer tools from the project venv (created by deploy/install.sh), fall back to PATH.
function venvBin(name) {
  const p = path.join(ROOT, '.venv', 'bin', name);
  return fs.existsSync(p) ? p : name;
}

const defaults = {
  // Name shown in the YouTube app's cast menu.
  deviceName: 'Pi-Cast',
  webPort: 8080,
  dialPort: 3000,

  mpvPath: 'mpv',
  mpvSocket: process.platform === 'win32' ? '\\\\.\\pipe\\picast-mpv' : '/tmp/picast-mpv.sock',
  // Hardware decoder for mpv. On a Pi 3 try 'v4l2m2m-copy' (safe) or 'drm' (zero-copy).
  mpvHwdec: 'v4l2m2m-copy',
  // ALSA device for HDMI audio. The vc4 HDMI driver needs the 'hdmi:' plugin
  // (it only takes IEC958 frames); 'auto' would pick the headphone jack.
  mpvAudioDevice: 'alsa/hdmi:CARD=vc4hdmi,DEV=0',
  mpvExtraArgs: [],

  ytdlPath: venvBin('yt-dlp'),
  streamlinkPath: venvBin('streamlink'),
  streamlinkPort: 8890,
  // First available quality wins. 1080p60 is too much for a Pi 3.
  twitchQuality: '720p60,720p,480p,best',

  logLevel: 'info',
};

export function loadConfig() {
  const file = process.env.PICAST_CONFIG || path.join(ROOT, 'config.json');
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...defaults, ...user };
}
