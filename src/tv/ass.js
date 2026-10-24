/**
 * Small toolkit for drawing the TV screens as ASS events (rendered by mpv's
 * libass on a 1920x1080 canvas). Sizes are CSS-like pixels at 1080p.
 */

// libass sizes text by the font's winAscent+winDescent, not the em square;
// these factors turn a CSS font size into an ASS \fs that looks the same.
const FS_FACTOR = { Sora: 1.54, 'JetBrains Mono': 1.565 };

const r1 = (v) => Math.round(v * 10) / 10;
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();

/** Parses '#RRGGBB' or 'rgba(r,g,b,a)' into { r, g, b, a } with a in 0..1. */
export function parseColor(input) {
  const m = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return { r, g, b, a };
  }
  const h = input.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

/** ASS color + alpha override tags for fill (1), border (3) or shadow (4). */
export function paint(color, opacity = 1, which = 1) {
  const { r, g, b, a } = parseColor(color);
  return `\\${which}c&H${hex2(b)}${hex2(g)}${hex2(r)}&\\${which}a&H${hex2(255 - a * opacity * 255)}&`;
}

/** Escapes user text (titles etc.) so libass doesn't read it as tags. */
export function escape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\⁠')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/[\r\n]+/g, ' ');
}

/** Cuts text to roughly fit `maxWidth` px at font size `px` (no real text measuring in ASS). */
export function fit(text, px, maxWidth, avg = 0.54) {
  const s = String(text ?? '');
  const max = Math.max(4, Math.floor(maxWidth / (px * avg)));
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Rough rendered width of text, for placing things next to it. */
export const textWidth = (text, px, avg = 0.54) => String(text).length * px * avg;

/**
 * A text event. Options: x, y, an (alignment 1-9), px (CSS font size),
 * font, weight, color, opacity, spacing (letter spacing in px).
 */
export function text(content, {
  x, y, an = 7, px = 32, font = 'Sora', weight = 400, color = '#FFFFFF', opacity = 1, spacing = 0,
}) {
  const fs = r1(px * (FS_FACTOR[font] ?? 1.5));
  return `{\\an${an}\\pos(${r1(x)},${r1(y)})\\q2\\bord0\\shad0\\fn${font}\\fs${fs}\\b${weight}`
    + `\\fsp${r1(spacing)}${paint(color, opacity)}}${content}`;
}

/** Inline color change inside a text event, e.g. for the accent dot in "pi·cast". */
export const span = (content, color, opacity = 1) => `{${paint(color, opacity)}}${content}`;

// --- Shapes. Paths use local coordinates starting at (0,0) and are placed
// with \pos, so libass's drawing alignment can't shift them. ---

const KAPPA = 0.5523;

/** Rounded rectangle path, w x h, corner radius r. */
export function roundedRectPath(w, h, r = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `m 0 0 l ${r1(w)} 0 ${r1(w)} ${r1(h)} 0 ${r1(h)}`;
  const k = r * (1 - KAPPA);
  const p = (v) => r1(v);
  return [
    `m ${p(r)} 0`,
    `l ${p(w - r)} 0`, `b ${p(w - k)} 0 ${p(w)} ${p(k)} ${p(w)} ${p(r)}`,
    `l ${p(w)} ${p(h - r)}`, `b ${p(w)} ${p(h - k)} ${p(w - k)} ${p(h)} ${p(w - r)} ${p(h)}`,
    `l ${p(r)} ${p(h)}`, `b ${p(k)} ${p(h)} 0 ${p(h - k)} 0 ${p(h - r)}`,
    `l 0 ${p(r)}`, `b 0 ${p(k)} ${p(k)} 0 ${p(r)} 0`,
  ].join(' ');
}

export const circlePath = (radius) => roundedRectPath(radius * 2, radius * 2, radius);

/**
 * A filled shape event at (x, y). Options: color, opacity, blur, border
 * (stroke width; with fill opacity 0 this draws an outline), borderColor.
 */
export function shape(path, {
  x = 0, y = 0, color = '#FFFFFF', opacity = 1, blur = 0, border = 0, borderColor, borderOpacity = 1,
}) {
  const stroke = border ? paint(borderColor ?? color, borderOpacity, 3) : '';
  return `{\\an7\\pos(${r1(x)},${r1(y)})\\bord${r1(border)}\\shad0\\blur${r1(blur)}`
    + `${paint(color, opacity)}${stroke}\\p1}${path}{\\p0}`;
}

export const rect = (x, y, w, h, opts = {}) => shape(roundedRectPath(w, h, opts.radius ?? 0), { ...opts, x, y });
export const circle = (cx, cy, radius, opts = {}) => shape(circlePath(radius), { ...opts, x: cx - radius, y: cy - radius });

/** Polygon from absolute points; normalised to local coordinates. */
export function polygon(points, opts = {}) {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const local = points.map(([px, py]) => `${r1(px - minX)} ${r1(py - minY)}`);
  return shape(`m ${local[0]} l ${local.slice(1).join(' ')}`, { ...opts, x: minX, y: minY });
}

/** A thick arc (ring segment) around (cx, cy), angles in degrees, 0 = up, clockwise. */
export function arcBand(cx, cy, radius, thickness, from, to, opts = {}) {
  const steps = 14;
  const pt = (rad, deg) => {
    const a = (deg - 90) * (Math.PI / 180);
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const deg = from + ((to - from) * i) / steps;
    outer.push(pt(radius + thickness / 2, deg));
    inner.push(pt(radius - thickness / 2, deg));
  }
  return polygon([...outer, ...inner.reverse()], opts);
}

/**
 * Soft radial glow: stacked blurred circles approximating a linear falloff
 * from `peak` opacity at the centre to 0 at `radius` (like CSS radial-gradient).
 */
export function glow(cx, cy, radius, color, peak, rings = 8) {
  const coverage = (k) => (k > rings ? 0 : peak * (1 - (k - 0.5) / rings));
  const events = [];
  for (let k = rings; k >= 1; k--) {
    const a = 1 - (1 - coverage(k)) / (1 - coverage(k + 1));
    events.push(circle(cx, cy, (radius * k) / rings, { color, opacity: a, blur: (radius / rings) * 0.9 }));
  }
  return events;
}
