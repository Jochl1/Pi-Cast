import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { run } from '../render.js';

const DIR = path.join(DATA_DIR, 'thumbs');
const KEEP = 10;

/**
 * Downloads a thumbnail and converts it to raw BGRA for mpv's overlay-add,
 * cropped to 16:9 (YouTube's hqdefault has letterbox bars) and scaled to w x h.
 * Resolves to the file path.
 */
export async function thumbnailBgra(url, w, h) {
  const key = crypto.createHash('sha1').update(`${url} ${w}x${h}`).digest('hex').slice(0, 16);
  const file = path.join(DIR, `${key}.bgra`);
  if (fs.existsSync(file)) return file;

  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-rw_timeout', '8000000', '-i', url,
    '-frames:v', '1',
    '-vf', `crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=${w}:${h}:flags=bicubic,format=bgra`,
    '-f', 'rawvideo', tmp,
  ]);
  await fs.promises.rename(tmp, file);
  prune();
  return file;
}

/**
 * A local cover image as raw, premultiplied BGRA for overlay-add: cropped
 * square, `size` px, with rounded corners (radius `r`) in its alpha.
 * Resolves to the file path.
 */
export async function coverBgra(image, size, r) {
  const key = crypto.createHash('sha1').update(fs.readFileSync(image)).update(`${size} ${r}`).digest('hex').slice(0, 16);
  const file = path.join(DIR, `${key}.bgra`);
  if (fs.existsSync(file)) return file;

  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  // Alpha 0 outside a rounded square, antialiased over a pixel.
  const d = `hypot(max(0,abs(X-(W-1)/2)-(W/2-${r})),max(0,abs(Y-(H-1)/2)-(H/2-${r})))`;
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', image, '-frames:v', '1',
    '-vf', `crop='min(iw,ih)':'min(iw,ih)',scale=${size}:${size}:flags=bicubic,format=rgba,`
      + `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(${r}+0.5-${d},0,1)',premultiply=inplace=1,format=bgra`,
    '-f', 'rawvideo', tmp,
  ]);
  await fs.promises.rename(tmp, file);
  prune();
  return file;
}

function prune() {
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.bgra'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP)) fs.rmSync(path.join(DIR, f), { force: true });
}
