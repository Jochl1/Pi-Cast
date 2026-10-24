import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

// The Sora weights the TV uses, by CSS weight.
const FILES = { 400: 'Sora-Regular.ttf', 600: 'Sora-SemiBold.ttf' };
const fonts = {};

/**
 * Character advance widths from a TrueType file: just the 'head', 'hhea',
 * 'hmtx' and 'cmap' (format 4) tables. Returns { upm, advance(codePoint) }.
 */
function readFont(file) {
  const b = fs.readFileSync(file);
  const tables = {};
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const at = 12 + i * 16;
    tables[b.toString('latin1', at, at + 4)] = b.readUInt32BE(at + 8);
  }
  const upm = b.readUInt16BE(tables.head + 18);
  const nMetrics = b.readUInt16BE(tables.hhea + 34);
  const widthOf = (glyph) => b.readUInt16BE(tables.hmtx + 4 * Math.min(glyph, nMetrics - 1));

  // The Unicode BMP subtable (platform 3/1 or 0/x), format 4: segments of code points.
  const cmap = tables.cmap;
  let sub = null;
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const [platform, encoding, offset] = [b.readUInt16BE(cmap + 4 + i * 8), b.readUInt16BE(cmap + 6 + i * 8), b.readUInt32BE(cmap + 8 + i * 8)];
    if ((platform === 3 && encoding === 1) || platform === 0) {
      if (b.readUInt16BE(cmap + offset) === 4) sub = cmap + offset;
    }
  }
  const segs = sub ? b.readUInt16BE(sub + 6) / 2 : 0;
  const ends = sub + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  const glyphOf = (cp) => {
    if (!sub || cp > 0xFFFF) return 0;
    for (let s = 0; s < segs; s++) {
      if (cp > b.readUInt16BE(ends + s * 2)) continue;
      const start = b.readUInt16BE(starts + s * 2);
      if (cp < start) return 0;
      const delta = b.readInt16BE(deltas + s * 2);
      const range = b.readUInt16BE(ranges + s * 2);
      if (!range) return (cp + delta) & 0xFFFF;
      const g = b.readUInt16BE(ranges + s * 2 + range + (cp - start) * 2);
      return g ? (g + delta) & 0xFFFF : 0;
    }
    return 0;
  };
  return { upm, advance: (cp) => widthOf(glyphOf(cp)) };
}

/**
 * Rendered width in px of `text` in Sora at CSS size `px` and `weight`
 * (400 or 600), plus `spacing` px per character; null if the font can't be
 * read, so callers fall back to an estimate.
 */
export function measure(text, px, { weight = 400, spacing = 0 } = {}) {
  const name = FILES[weight] ?? FILES[400];
  if (!(name in fonts)) {
    try {
      fonts[name] = readFont(path.join(ROOT, 'assets', 'fonts', name));
    } catch {
      fonts[name] = null;
    }
  }
  const font = fonts[name];
  if (!font) return null;
  let units = 0;
  let count = 0;
  for (const ch of String(text)) {
    units += font.advance(ch.codePointAt(0));
    count++;
  }
  return (units / font.upm) * px + count * spacing;
}
