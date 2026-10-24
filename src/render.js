import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const CACHE_DIR = path.join(DATA_DIR, 'render');
const inflight = new Map();

/** Runs a command with `input` on stdin; resolves when it exits with 0. */
export function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code}): ${err.trim()}`))));
    if (input) proc.stdin.end(input);
  });
}

/**
 * Rasterises an SVG to PNG with rsvg-convert (fonts come from fontconfig, so
 * Sora must be installed). Results are cached by content; resolves to the path.
 */
export function svgToPng(svg, { width, height } = {}) {
  const key = crypto.createHash('sha1').update(`${width}x${height}\n${svg}`).digest('hex').slice(0, 16);
  const file = path.join(CACHE_DIR, `${key}.png`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (inflight.has(file)) return inflight.get(file);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  const args = ['-f', 'png', '-o', tmp];
  if (width) args.push('-w', String(width));
  if (height) args.push('-h', String(height));
  const job = run('rsvg-convert', args, svg)
    .then(() => fs.promises.rename(tmp, file))
    .then(() => file)
    .finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

/** Escapes text for use inside SVG/XML. */
export const xml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
