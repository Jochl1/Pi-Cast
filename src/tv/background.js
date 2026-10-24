import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import zlib from 'node:zlib';
import { DATA_DIR } from '../config.js';
import { parseColor } from './ass.js';
import { CARD } from './screens.js';

/**
 * The home screen's backdrop: a 1920x1080 PNG that mpv shows on its video
 * plane while nothing plays, so it costs none of the OSD texture (see
 * screens.js). Painted here in floating point and dithered to 8 bits, because
 * dark, soft gradients band badly on a TV when rounded straight to 8 bits.
 *
 * The animated version is a looping H.264 clip of the glows drifting. Painting
 * and encoding it takes far too long on a Pi 3, so scripts/render-backdrops.js
 * renders the clips on a PC; they're copied to CLIP_DIR and picked up by name.
 */

export const W = 1920;
export const H = 1080;
const DIR = path.join(DATA_DIR, 'background');
export const CLIP_DIR = path.join(DATA_DIR, 'backdrops');
const KEEP = 6;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => {
  const x = clamp((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const rgb = (c) => {
  const { r, g, b } = parseColor(c);
  return [r, g, b];
};

/** Rotates the hue of an `[r, g, b]` color by `deg` and scales its saturation and lightness. */
export function shiftHue([r, g, b], deg, { sat = 1, light = 1 } = {}) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let l = (max + min) / 2;
  let s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h = 0;
  if (d) h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  h = (h + deg + 360) % 360;
  s = clamp(s * sat);
  l = clamp(l * light);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [R, G, B] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [R, G, B].map((v) => (v + m) * 255);
}

/** Everything the image depends on; also its cache key. */
export function backgroundSpec(t) {
  const accent = rgb(t.accent);
  // The accent at the top left, a neighbouring hue at the bottom right and a
  // soft third light at the top right, like the draft's glows.
  const spec = { bg: rgb(t.bg), glows: [], vignette: 0.35, card: true };
  spec.top = shiftHue(rgb(t.bg), 0, { light: 1.5 });
  spec.glows = [
    // `drift`: how far (px) and how much brighter each one moves around its
    // loop in the animated background; f = cycles per loop, p = phase.
    { x: 230, y: -120, rx: 1250, ry: 900, color: shiftHue(accent, 0, { sat: 1.3 }), a: 0.7, drift: { x: 260, y: 140, a: 0.15, f: 1, p: 0 } },
    { x: 1880, y: 1180, rx: 1150, ry: 760, color: shiftHue(accent, 55, { sat: 1.4 }), a: 0.55, drift: { x: 300, y: 160, a: 0.2, f: 1, p: 2.1 } },
    { x: 1480, y: 230, rx: 640, ry: 480, color: shiftHue(accent, -35, { sat: 1.3 }), a: 0.25, drift: { x: 380, y: 220, a: 0.35, f: 2, p: 4.2 } },
  ];
  // Rounded, so the key is the same on the PC that renders the clips and the Pi.
  for (const g of spec.glows) g.color = g.color.map((v) => Math.round(v * 10) / 10);
  spec.top = spec.top.map((v) => Math.round(v * 10) / 10);
  return spec;
}

/**
 * Prepares painting `spec` at w x h. Returns `frame(phase)`, which paints the
 * glows at `phase` (0..1 around their drift loop; 0 for the still image) into
 * an RGB buffer (rows of w*3 bytes). Everything that doesn't move is worked
 * out once, so a frame is cheap enough to paint hundreds for the loop clip.
 */
export function painter(spec, w = W, h = H) {
  const k = w / W; // spec coordinates are at 1080p
  const n = w * h;
  const { top } = spec;
  // Per pixel: vignette factor, card (white) alpha.
  const vig = new Float32Array(n);
  const card = new Float32Array(n);
  const box = Object.fromEntries(Object.entries(CARD).map(([key, v]) => [key, v * k]));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const vx = (x - w / 2) / (w / 2);
      const vy = (y - h / 2) / (h / 2);
      vig[i] = 1 - spec.vignette * smoothstep(0.5, 1.45, Math.sqrt(vx * vx + vy * vy));
      // Frosted card behind "Ready to cast": signed distance to a rounded
      // rect, antialiased over one pixel, with a brighter top-left edge.
      const qx = Math.abs(x + 0.5 - (box.x + box.w / 2)) - box.w / 2 + box.r;
      const qy = Math.abs(y + 0.5 - (box.y + box.h / 2)) - box.h / 2 + box.r;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - box.r;
      if (d >= 1.5) continue;
      const fill = clamp(0.5 - d) * (0.075 - 0.04 * clamp((y - box.y) / box.h));
      const edge = clamp(1 - Math.abs(d + 1)) * (0.07 + 0.16 * (1 - clamp((x - box.x + y - box.y) / (box.w + box.h))));
      card[i] = fill + edge;
    }
  }
  // Triangular dither noise of about one level, reused with a per-frame offset.
  const NOISE = 1 << 16;
  const noise = new Float32Array(NOISE);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < NOISE; i++) noise[i] = rand() + rand() - 1;

  return function frame(phase = 0, offset = 0) {
    const buf = Buffer.alloc(n * 3);
    const out = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length); // rounds and clamps
    // Glow positions and strength on their loop (whole cycles, so it repeats).
    const th = 2 * Math.PI * phase;
    const glows = spec.glows.map((g) => {
      const m = g.drift ?? { x: 0, y: 0, a: 0, f: 1, p: 0 };
      const gx = (g.x + m.x * Math.sin(th * m.f + m.p)) * k;
      const gy = (g.y + m.y * Math.sin(th * (m.f + 1) + m.p * 2)) * k;
      // The gaussian over an ellipse is separable: exp(-(dx²+dy²)) = exp(-dx²)·exp(-dy²).
      const fx = new Float32Array(w);
      const fy = new Float32Array(h);
      for (let x = 0; x < w; x++) fx[x] = Math.exp(-2.6 * ((x - gx) / (g.rx * k)) ** 2);
      for (let y = 0; y < h; y++) fy[y] = g.a * (1 + m.a * Math.sin(th + m.p * 3)) * Math.exp(-2.6 * ((y - gy) / (g.ry * k)) ** 2);
      return { fx, fy, r: g.color[0], g: g.color[1], b: g.color[2] };
    });
    let ni = (offset * 7919) & (NOISE - 1);

    for (let y = 0; y < h; y++) {
      // Base: slightly lighter at the top.
      const t = y / (h - 1);
      const r0 = top[0] + (spec.bg[0] - top[0]) * t;
      const g0 = top[1] + (spec.bg[1] - top[1]) * t;
      const b0 = top[2] + (spec.bg[2] - top[2]) * t;
      const row = glows.filter((gl) => gl.fy[y] > 0.0005);
      let i = y * w;
      for (let x = 0; x < w; x++, i++) {
        let r = r0;
        let g = g0;
        let b = b0;
        // Glows composited over the base.
        for (let j = 0; j < row.length; j++) {
          const gl = row[j];
          const a = gl.fx[x] * gl.fy[y];
          if (a < 0.0005) continue;
          r += (gl.r - r) * a;
          g += (gl.g - g) * a;
          b += (gl.b - b) * a;
        }
        const v = vig[i];
        r *= v;
        g *= v;
        b *= v;
        const ca = card[i];
        if (ca) {
          r += (255 - r) * ca;
          g += (255 - g) * ca;
          b += (255 - b) * ca;
        }
        const o = i * 3;
        out[o] = r + noise[ni];
        out[o + 1] = g + noise[(ni + 1) & (NOISE - 1)];
        out[o + 2] = b + noise[(ni + 2) & (NOISE - 1)];
        ni = (ni + 3) & (NOISE - 1);
      }
    }
    return buf;
  };
}

/** Paints the still background at 1080p. */
export const paint = (spec) => painter(spec)(0);

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Encodes an RGB buffer as an 8-bit PNG. */
export function encodePng(rgbBuf, w = W, h = H) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgbBuf.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Painting takes ~10 s on a throttled Pi 3, so it runs in a worker thread.
if (!isMainThread && workerData?.backgroundSpec) {
  parentPort.postMessage(encodePng(paint(workerData.backgroundSpec)));
}

function paintInWorker(spec) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { backgroundSpec: spec } });
    worker.once('message', (png) => resolve(Buffer.from(png)));
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`background worker exited (${code})`)));
  });
}

/** Identifies a backdrop by everything it depends on; names its PNG and clip. */
export const backdropKey = (spec) => crypto.createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 16);

/** Path of the loop clip for theme `t`, or null if none was rendered for it. */
export function backgroundClip(t) {
  const file = path.join(CLIP_DIR, `${backdropKey(backgroundSpec(t))}.mp4`);
  return fs.existsSync(file) ? file : null;
}

/** Path of the background PNG for theme `t`, painted on first use and cached. */
export async function backgroundPng(t) {
  const spec = backgroundSpec(t);
  const key = backdropKey(spec);
  const file = path.join(DIR, `${key}.png`);
  if (fs.existsSync(file)) {
    // Touched, so the cleanup below keeps the ones in use.
    fs.utimesSync(file, new Date(), new Date());
    return file;
  }
  fs.mkdirSync(DIR, { recursive: true });
  await fs.promises.writeFile(`${file}.tmp`, await paintInWorker(spec));
  await fs.promises.rename(`${file}.tmp`, file);
  // Keep the newest few (one per accent the user tried recently).
  const old = fs.readdirSync(DIR).filter((f) => f.endsWith('.png'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(KEEP);
  for (const { f } of old) fs.rmSync(path.join(DIR, f), { force: true });
  return file;
}
