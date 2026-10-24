import {
  rect, circle, polygon,
} from './ass.js';

/**
 * Weather icons as ASS shapes, drawn in a `size` x `size` box with its top
 * left at (x, y): the sun and moon in the accent, clouds in the text color,
 * rain and lightning in the accent. Shapes of one color may overlap (they're
 * opaque), so a cloud is a few circles on a rounded bar.
 *
 * `kind` comes from weatherKind(): clear, partly, cloudy, fog, drizzle,
 * rain, snow, thunder.
 */
export function weatherIcon(kind, x, y, size, { accent, text }, night = false) {
  const s = size;
  const sky = (cx, cy, r) => (night ? moon(cx, cy, r * 0.8, accent) : sun(cx, cy, r, accent));
  switch (kind) {
    case 'clear': return sky(x + s / 2, y + s / 2, s / 2);
    case 'partly': return [
      ...sky(x + s * 0.38, y + s * 0.36, s * 0.34),
      ...cloud(x + s * 0.22, y + s * 0.34, s * 0.78, text),
    ];
    case 'fog': return [0.3, 0.5, 0.7].map((k, i) => rect(x + s * (i === 1 ? 0.06 : 0.16), y + s * k - s * 0.04,
      s * (i === 1 ? 0.88 : 0.68), s * 0.08, { color: text, radius: s * 0.04 }));
    case 'cloudy': return cloud(x + s * 0.04, y + s * 0.2, s * 0.92, text);
    default: {
      // A cloud with something falling out of it.
      const events = cloud(x + s * 0.06, y + s * 0.06, s * 0.88, text);
      const below = y + s * 0.66;
      if (kind === 'snow') {
        [0.3, 0.52, 0.74].forEach((k, i) => events.push(circle(x + s * k, below + s * (i === 1 ? 0.2 : 0.1), s * 0.06, { color: accent })));
      } else if (kind === 'thunder') {
        const p = (px, py) => [x + s * px, below + s * py - s * 0.06];
        events.push(polygon([p(0.56, 0), p(0.38, 0.2), p(0.5, 0.2), p(0.42, 0.38), p(0.64, 0.14), p(0.52, 0.14), p(0.6, 0)], { color: accent }));
      } else {
        const drops = kind === 'drizzle' ? [0.38, 0.62] : [0.28, 0.5, 0.72];
        drops.forEach((k) => events.push(streak(x + s * k, below + s * 0.04, s * 0.22, s * 0.065, accent)));
      }
      return events;
    }
  }
}

/** Sun: a disc and eight rays around (cx, cy), `r` = outer radius of the rays. */
function sun(cx, cy, r, color) {
  const events = [circle(cx, cy, r * 0.46, { color })];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const [dx, dy] = [Math.cos(a), Math.sin(a)];
    const [nx, ny] = [-dy * r * 0.07, dx * r * 0.07];
    const [r1, r2] = [r * 0.66, r * 0.96];
    events.push(polygon([
      [cx + dx * r1 + nx, cy + dy * r1 + ny], [cx + dx * r2 + nx, cy + dy * r2 + ny],
      [cx + dx * r2 - nx, cy + dy * r2 - ny], [cx + dx * r1 - nx, cy + dy * r1 - ny],
    ], { color }));
  }
  return events;
}

/** Crescent moon: the disc of radius r minus a bite from its upper right. */
function moon(cx, cy, r, color) {
  const bite = { x: cx + r * 0.5, y: cy - r * 0.35, r: r * 0.82 };
  const steps = 48;
  const around = (ox, oy, rad, from) => Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + (i / steps) * 2 * Math.PI;
    return [ox + rad * Math.cos(a), oy + rad * Math.sin(a)];
  });
  const towardBite = Math.atan2(bite.y - cy, bite.x - cx);
  // Start each circle inside the other one's cut, so what's kept is one run.
  const outer = around(cx, cy, r, towardBite).filter(([px, py]) => Math.hypot(px - bite.x, py - bite.y) >= bite.r);
  const inner = around(bite.x, bite.y, bite.r, towardBite).filter(([px, py]) => Math.hypot(px - cx, py - cy) <= r);
  const last = outer[outer.length - 1];
  const near = (p) => Math.hypot(p[0] - last[0], p[1] - last[1]);
  if (near(inner[0]) > near(inner[inner.length - 1])) inner.reverse();
  return [polygon([...outer, ...inner], { color })];
}

/** Cloud `w` wide (about 0.6 w tall) with its top left at (x, y). */
function cloud(x, y, w, color) {
  return [
    circle(x + w * 0.3, y + w * 0.36, w * 0.19, { color }),
    circle(x + w * 0.56, y + w * 0.27, w * 0.25, { color }),
    circle(x + w * 0.78, y + w * 0.4, w * 0.16, { color }),
    rect(x + w * 0.08, y + w * 0.34, w * 0.86, w * 0.22, { color, radius: w * 0.11 }),
  ];
}

/** A slanted rain streak from (x, y), `len` long and `wid` wide. */
function streak(x, y, len, wid, color) {
  const dx = -len * 0.35;
  return polygon([[x, y], [x + wid, y], [x + wid + dx, y + len], [x + dx, y + len]], { color });
}

/** Open-Meteo's WMO weather code to an icon kind (and condition text key). */
export function weatherKind(code) {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}
