// Checks on the Pi that every TV screen fits into mpv's OSD texture. The Pi 3's
// GPU caps textures at 2048x2048, and when the overlays don't fit, mpv draws
// none of them and only logs an error. Run it after changing a screen; it uses
// the TV, so stop the app first:
//   sudo systemctl stop picast && node scripts/check-osd.js; sudo systemctl start picast
// With a file from data/osd-overflow/ it replays the layers that overflowed instead.
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import Mpv from '../src/mpv.js';
import { look } from '../src/tv/screens.js';
import { scenes } from './tv-scenes.js';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };
const config = { ...loadConfig(), mpvSocket: '/tmp/picast-check-osd.sock' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const snapshotFile = process.argv[2];
const toCheck = snapshotFile
  ? { [snapshotFile]: { layers: () => Object.values(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')).layers).map((data) => data.split('\n')) } }
  : scenes;

let failed = 0;
for (const [name, scene] of Object.entries(toCheck)) {
  // A fresh mpv per scene, since its texture only ever grows.
  const mpv = new Mpv(config, quiet);
  const errors = [];
  mpv.on('log', (text) => errors.push(text));
  await mpv.start();
  const layers = scene.layers(scene.settings && look(scene.settings));
  for (const [i, events] of layers.entries()) {
    await mpv.showOverlay(events.join('\n'), { id: i + 1, z: i });
  }
  await wait(1500);
  await mpv.shutdown();
  const osd = errors.filter((e) => e.includes('OSD'));
  if (osd.length) failed++;
  console.log(`${osd.length ? 'FAIL' : 'ok  '} ${name}${osd.length ? `: ${osd[0]}` : ''}`);
}
console.log(failed ? `${failed} screen(s) don't fit` : 'all screens fit');
process.exit(failed ? 1 : 0);
