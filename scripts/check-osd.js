// Checks on the Pi that every TV screen fits into mpv's OSD texture. The Pi 3's
// GPU caps textures at 2048x2048, and when the overlays don't fit, mpv draws
// none of them and only logs an error. Run it after changing a screen; it uses
// the TV, so stop the app first:
//   sudo systemctl stop picast && node scripts/check-osd.js; sudo systemctl start picast
// Arguments filter the scenes by name (`node scripts/check-osd.js games` checks
// the game night screens). A file from data/osd-overflow/ replays the layers
// that overflowed instead.
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import Mpv from '../src/mpv.js';
import { look } from '../src/tv/screens.js';
import { scenes } from './tv-scenes.js';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };
const config = { ...loadConfig(), mpvSocket: '/tmp/picast-check-osd.sock' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Long enough for mpv to draw the overlays and log a failure.
const SETTLE_MS = 700;

const args = process.argv.slice(2);
const snapshotFile = args.find((a) => a.endsWith('.json'));
const toCheck = snapshotFile
  ? [[snapshotFile, { layers: () => Object.values(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')).layers).map((data) => data.split('\n')) }]]
  : Object.entries(scenes).filter(([name]) => !args.length || args.some((a) => name.includes(a)));

async function startMpv() {
  const mpv = new Mpv(config, quiet);
  const errors = [];
  mpv.on('log', (text) => { if (text.includes('OSD')) errors.push(text); });
  await mpv.start();
  return { mpv, errors };
}

/** Shows a scene's layers (clearing the last scene's extra ones); returns the OSD error, if any. */
async function check({ mpv, errors }, scene, shownBefore = 0) {
  const layers = scene.layers(scene.settings && look(scene.settings));
  for (const [i, events] of layers.entries()) await mpv.showOverlay(events.join('\n'), { id: i + 1, z: i });
  for (let id = layers.length + 1; id <= shownBefore; id++) await mpv.clearOverlay({ id });
  await wait(SETTLE_MS);
  return { error: errors.shift() ?? null, shown: layers.length };
}

// Fast pass: one mpv for all scenes. Its texture only grows and an overflow is
// sticky, so this can only go wrong after something didn't fit.
const shared = await startMpv();
let firstFail = -1;
let shown = 0;
for (const [i, [name, scene]] of toCheck.entries()) {
  const r = await check(shared, scene, shown);
  shown = r.shown;
  if (r.error) { firstFail = i; break; }
  console.log(`ok   ${name}`);
}
await shared.mpv.shutdown();

// From the first failure on, each scene gets a fresh mpv, to tell which really don't fit.
let failed = 0;
if (firstFail >= 0) {
  for (const [name, scene] of toCheck.slice(firstFail)) {
    const fresh = await startMpv();
    const { error } = await check(fresh, scene);
    await fresh.mpv.shutdown();
    if (error) failed++;
    console.log(`${error ? 'FAIL' : 'ok  '} ${name}${error ? `: ${error}` : ''}`);
  }
}
console.log(failed ? `${failed} screen(s) don't fit` : 'all screens fit');
process.exit(failed ? 1 : 0);
