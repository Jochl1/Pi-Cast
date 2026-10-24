// Renders the animated home backdrops (looping clips of the drifting glows)
// for every accent preset. Too slow for a Pi 3, so run it on a PC with
// ffmpeg (libx264), then copy the clips to the Pi's data/backdrops/:
//   node scripts/render-backdrops.js [out-dir] [ffmpeg]
//   pscp data/backdrops/*.mp4 admin@picast.local:Pi-Cast/data/backdrops/
// Clips are named by the backdrop's content, so stale ones are just unused.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ACCENTS, themeFor } from '../src/shared/theme.js';
import { CLIP_DIR, backdropKey, backgroundSpec, painter } from '../src/tv/background.js';

const [outDir = CLIP_DIR, ffmpeg = 'ffmpeg'] = process.argv.slice(2);
const FPS = 10;
const SECONDS = 30;

function encode(spec, file) {
  const frame = painter(spec);
  const n = FPS * SECONDS;
  // CRF 10 with grain tuning keeps the dither, so the gradients don't band.
  const ff = spawn(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'grain', '-crf', '10', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', `${file}.tmp.mp4`,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  return new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('exit', (code) => (code === 0 ? resolve(fs.renameSync(`${file}.tmp.mp4`, file)) : reject(new Error(`ffmpeg exited ${code}`))));
    (async () => {
      // Phases i/n for i < n: the frame after the last is the first again.
      for (let i = 0; i < n; i++) {
        if (!ff.stdin.write(frame(i / n, i))) await new Promise((r) => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
    })();
  });
}

fs.mkdirSync(outDir, { recursive: true });
for (const accent of Object.keys(ACCENTS)) {
  const spec = backgroundSpec(themeFor({ accent }));
  const key = backdropKey(spec);
  const file = path.join(outDir, `${key}.mp4`);
  if (fs.existsSync(file)) {
    console.log(`have   ${accent} ${key}`);
    continue;
  }
  const t0 = Date.now();
  await encode(spec, file);
  console.log(`render ${accent} ${key} ${((Date.now() - t0) / 1000).toFixed(0)}s ${(fs.statSync(file).size / 1e6).toFixed(0)} MB`);
}
