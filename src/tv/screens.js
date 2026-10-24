import {
  text, span, rect, circle, arcBand, escape, fit, textWidth,
} from './ass.js';

/**
 * Pure layout functions: state in, ASS events out. Coordinates are 1920x1080
 * (the design mock-ups were 640x360, so their sizes are multiplied by 3).
 *
 * mpv packs all overlays into one texture, which the Pi 3's GPU caps at
 * 2048x2048; if they don't fit, nothing is drawn. So no full-screen shapes
 * behind the home screen (its color is mpv's background-color, see Tv) and
 * no big blurred glows. Run scripts/check-osd.js on the Pi after changes.
 */

export const W = 1920;
export const H = 1080;
const PAD_X = 96;
const PAD_Y = 84;
// Colors used over video, from the design.
const ON_VIDEO = { text: '#F2F4F7', muted: '#B4BCC8', track: 'rgba(255,255,255,0.2)', dim: 'rgba(6,8,12,0.62)' };
const SOURCE = { youtube: 'YouTube', twitch: 'Twitch', generic: 'Link' };

/** "pi·cast" with the dot in the accent color; `color` is the rest of the word. */
const wordmark = (t, color = t.text, opacity = 1) => `pi${span('·', t.accent, opacity)}${span('cast', color, opacity)}`;

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function clockParts(now, clock24) {
  const date = `${now.toLocaleDateString('en-GB', { weekday: 'long' })}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  const h = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (clock24) return { time: `${String(h).padStart(2, '0')}:${mm}`, suffix: '', date };
  return { time: `${h % 12 || 12}:${mm}`, suffix: h < 12 ? 'AM' : 'PM', date };
}

function clock(t, now, clock24, opacity = 1) {
  const c = clockParts(now, clock24);
  const events = [
    text(c.time + (c.suffix ? `{\\fsp0\\fs${Math.round(48 * 1.54)}}\\h${c.suffix}` : ''),
      { x: PAD_X, y: PAD_Y - 53, px: 156, weight: 600, spacing: -4.7, color: t.text, opacity }),
    text(escape(c.date), { x: PAD_X, y: PAD_Y + 157, px: 39, color: t.muted, opacity }),
  ];
  return events;
}

function wifiIcon(x, y, color, active, bars) {
  // 48px icon: three arcs around a dot (like the design's stroked SVG).
  const cx = x + 24;
  const cy = y + 40;
  const events = [circle(cx, cy - 1, 3.5, { color, opacity: active ? 1 : 0.4 })];
  [[10, 44], [20, 44], [30, 42]].forEach(([r, half], i) => {
    events.push(arcBand(cx, cy, r, 4, -half, half, { color, opacity: active && i < bars ? 1 : 0.3 }));
  });
  return events;
}

function network(t, net) {
  let label = 'Network';
  let bars = 3;
  let active = true;
  if (net?.kind === 'wifi') {
    label = net.ssid ? `Wi-Fi · ${net.ssid}` : 'Wi-Fi';
    if (net.signal != null) bars = net.signal > 66 ? 3 : net.signal > 33 ? 2 : 1;
  } else if (net?.kind === 'wired') {
    label = 'Ethernet';
  } else if (net?.kind === 'offline') {
    label = 'Offline';
    active = false;
  }
  label = fit(label, 36, 600);
  const right = W - PAD_X;
  const iconX = right - textWidth(label, 36) - 18 - 48;
  return [
    ...wifiIcon(iconX, PAD_Y + 6, t.muted, active, bars),
    text(escape(label), { x: right, y: PAD_Y, an: 9, px: 36, color: t.muted }),
  ];
}

function bottomBar(t, { pairingCode, remote }) {
  const lineY = 846;
  const labelY = 888;
  const valueY = 924;
  const remoteX = PAD_X + Math.max(textWidth('000 000 000 000', 45, 0.6), textWidth(pairingCode ?? '', 45, 0.6)) + 96;
  const label = (s, x) => text(s, { x, y: labelY, px: 30, weight: 600, spacing: 3.6, color: t.muted });
  const value = (s, x) => text(escape(s), { x, y: valueY, px: 45, font: 'JetBrains Mono', weight: 500, color: t.text });
  return [
    rect(PAD_X, lineY, W - 2 * PAD_X, 3, { color: t.line }),
    label('TV CODE', PAD_X),
    value(pairingCode ?? '—', PAD_X),
    label('REMOTE', remoteX),
    value(remote, remoteX),
    text(wordmark(t, t.muted), { x: W - PAD_X, y: 996, an: 3, px: 39, weight: 600, color: t.muted }),
  ];
}

/** Home / idle screen. `loading` = { title, channel, kind, sender } while a video starts. */
export function home(t, { now, clock24, net, pairingCode, remote, deviceName, loading, panelOpen }) {
  if (panelOpen) return clock(t, now, clock24, 0.35);

  const events = [...clock(t, now, clock24), ...network(t, net), ...bottomBar(t, { pairingCode, remote })];
  if (loading) {
    const sub = [loading.channel, SOURCE[loading.kind], loading.sender && `from ${loading.sender}`].filter(Boolean).join(' · ');
    events.push(
      text('LOADING', { x: W / 2, y: 430, an: 8, px: 30, weight: 600, spacing: 3.6, color: t.accent }),
      text(escape(fit(loading.title || 'Getting the video ready', 60, 1500)), { x: W / 2, y: 478, an: 8, px: 60, weight: 600, color: t.text }),
      text(escape(fit(sub, 39, 1500)), { x: W / 2, y: 572, an: 8, px: 39, color: t.muted }),
      ...dots(t, W / 2, 680),
    );
  } else {
    events.push(
      text('Ready to cast', { x: W / 2, y: 452, an: 8, px: 78, weight: 600, spacing: -0.8, color: t.text }),
      text(escape(`Open YouTube on your phone and tap Cast → ${deviceName}`), { x: W / 2, y: 560, an: 8, px: 39, color: t.muted }),
    );
  }
  return events;
}

/** Three dots, middle one in the accent color (as on the boot screen). */
export function dots(t, cx, cy) {
  return [-24, 0, 24].map((dx) => circle(cx + dx, cy, 9, { color: dx === 0 ? t.accent : t.dim }));
}

/** "<sender> connected" pill, top right. */
export function senderPill(t, name, opacity = 1) {
  const label = escape(fit(`${name} connected`, 36, 700));
  const h = 96;
  const w = 42 + 24 + 24 + textWidth(label, 36, 0.56) + 42;
  const x = W - 54 - w;
  const y = 54;
  return [
    rect(x, y, w, h, { color: t.glass, opacity, radius: Math.min(t.pill * 3, h / 2) }),
    circle(x + 42 + 12, y + h / 2, 12, { color: t.accent, opacity }),
    text(label, { x: x + 42 + 24 + 24, y: y + h / 2, an: 4, px: 36, weight: 500, color: ON_VIDEO.text, opacity }),
  ];
}

/** Geometry of the now-playing card; the thumbnail bitmap goes at `thumb`. */
export function cardLayout(withThumb) {
  const y = H - 66 - 234;
  return { x: 54, y, h: 234, thumb: withThumb ? { x: 54 + 36, y: y + 36, w: 288, h: 162 } : null };
}

/** Now-playing card (bottom left) plus the thin progress line at the very bottom. */
export function nowPlaying(t, { title, kind, quality, position, duration, live, withThumb }, opacity = 1) {
  const L = cardLayout(withThumb);
  const textX = withThumb ? L.x + 36 + 288 + 42 : L.x + 54;
  const maxText = 1260 - (textX - L.x) - 54;
  const titleText = fit(title || 'Playing', 45, maxText, 0.5);
  const sub = [SOURCE[kind] ?? 'Link', 'Ad-free', quality].filter(Boolean).join(' · ');
  const textW = Math.min(maxText, Math.max(textWidth(titleText, 45, 0.5), textWidth(sub, 33), textWidth('NOW PLAYING', 30, 0.75)));
  const w = textX - L.x + textW + 54;
  const midY = L.y + L.h / 2;

  const events = [
    rect(L.x, L.y, w, L.h, { color: t.glass, opacity, radius: t.radius * 3 }),
    text('NOW PLAYING', { x: textX, y: midY - 74, px: 30, weight: 600, spacing: 3.6, color: t.accent, opacity }),
    text(escape(titleText), { x: textX, y: midY - 30, px: 45, weight: 600, color: ON_VIDEO.text, opacity }),
    text(escape(sub), { x: textX, y: midY + 34, px: 33, color: ON_VIDEO.muted, opacity }),
  ];
  if (withThumb) {
    // Placeholder under the bitmap, visible while the thumbnail loads.
    events.push(rect(L.thumb.x, L.thumb.y, L.thumb.w, L.thumb.h, { color: '#3A4254', opacity, radius: t.small * 3 }));
  }
  events.push(rect(0, H - 9, W, 9, { color: 'rgba(255,255,255,0.15)', opacity }));
  const frac = live ? 1 : duration ? Math.min(1, position / duration) : 0;
  if (frac > 0) events.push(rect(0, H - 9, W * frac, 9, { color: t.accent, opacity: live ? opacity * 0.5 : opacity }));
  return events;
}

/** Paused screen: dimmed video, pause ring, title and progress. */
export function paused(t, { title, channel, kind, position, duration, live }) {
  const left = PAD_X;
  const width = W - 2 * PAD_X;
  const barY = 924;
  const frac = live ? 1 : duration ? Math.min(1, position / duration) : 0;
  const sub = [channel, SOURCE[kind]].filter(Boolean).join(' · ');
  const events = [
    rect(0, 0, W, H, { color: ON_VIDEO.dim }),
    circle(W / 2, H / 2, 102, { color: t.accent, opacity: 0, border: 6, borderColor: t.accent }),
    rect(W / 2 - 12 - 18, H / 2 - 36, 18, 72, { color: t.accent, radius: 6 }),
    rect(W / 2 + 12, H / 2 - 36, 18, 72, { color: t.accent, radius: 6 }),
    text(escape(fit(title || 'Paused', 60, width, 0.5)), { x: left, y: barY - 156, px: 60, weight: 600, color: ON_VIDEO.text }),
    text(escape(fit(sub, 36, width)), { x: left, y: barY - 72, px: 36, color: ON_VIDEO.muted }),
    rect(left, barY, width, 12, { color: ON_VIDEO.track, radius: 6 }),
  ];
  if (frac > 0) events.push(rect(left, barY, Math.max(12, width * frac), 12, { color: t.accent, radius: 6, opacity: live ? 0.5 : 1 }));
  const time = (s, x, an) => text(s, { x, y: barY + 36, an, px: 33, font: 'JetBrains Mono', weight: 500, color: ON_VIDEO.muted });
  events.push(live ? time('LIVE', left, 7) : time(fmtTime(position), left, 7));
  if (!live) events.push(time(fmtTime(duration), left + width, 9));
  return events;
}

/** Rows of the TV settings panel, in order. */
export const PANEL_ROWS = [
  { key: 'accent', label: 'Accent color' },
  { key: 'bootAnimation', label: 'Animations' },
  { key: 'sponsorBlock', label: 'Skip sponsors' },
  { key: 'clock24', label: 'Clock' },
  { key: 'cecSwitchInput', label: 'Switch TV input' },
];

function panelValue(key, s) {
  if (key === 'clock24') return s.clock24 ? '24h' : '12h';
  return s[key] ? 'On' : 'Off';
}

/** Settings panel on the right; `swatches` = [{ id, hex }], `focus` = row index. */
export function settingsPanel(t, { settings, focus, swatches }) {
  const x = W - 60 - 930;
  const y = 60;
  const w = 930;
  const h = H - 120;
  const inner = x + 54;
  const innerW = w - 108;
  const events = [
    rect(x, y, w, h, { color: t.glass, radius: t.radius * 3, border: 3, borderColor: t.line }),
    text('Settings', { x: inner, y: y + 50, px: 54, weight: 600, color: t.text }),
  ];

  let rowY = y + 150;
  const ROW_H = 78;
  const GAP = 10;
  PANEL_ROWS.forEach((row, i) => {
    const focused = i === focus;
    const isAccent = row.key === 'accent';
    const rowH = isAccent ? 177 : ROW_H;
    if (focused) {
      events.push(rect(inner, rowY, innerW, rowH, {
        color: t.accent, opacity: 0.12, radius: t.small * 3, border: 3, borderColor: t.accent,
      }));
    }
    if (isAccent) {
      events.push(text(row.label, { x: inner + 36, y: rowY + 28, px: 36, weight: 600, color: t.text }));
      swatches.forEach((sw, n) => {
        const cx = inner + 36 + 24 + n * 69;
        const cy = rowY + 28 + 56 + 24 + 12;
        if (sw.selected) events.push(circle(cx, cy, 31, { color: '#FFFFFF', opacity: 0, border: 4.5, borderColor: '#FFFFFF' }));
        events.push(circle(cx, cy, 24, { color: sw.hex }));
      });
    } else {
      const mid = rowY + rowH / 2;
      events.push(
        text(row.label, { x: inner + 36, y: mid, an: 4, px: 36, weight: focused ? 600 : 400, color: t.text }),
        text(panelValue(row.key, settings), { x: inner + innerW - 36, y: mid, an: 6, px: 36, color: focused ? t.text : t.muted }),
      );
    }
    rowY += rowH + GAP;
  });

  events.push(text('◀ ▶ change · OK select · Back close', {
    x: inner, y: y + h - 54, an: 1, px: 30, spacing: 1.2, color: t.muted,
  }));
  return events;
}

/** Short message at the bottom centre, e.g. playback errors. */
export function toast(t, message) {
  const label = escape(fit(message, 39, 1400));
  const w = textWidth(label, 39, 0.56) + 108;
  const h = 114;
  return [
    rect(W / 2 - w / 2, H - 120 - h, w, h, { color: t.glass, radius: Math.min(t.pill * 3, h / 2), border: 3, borderColor: t.line }),
    text(label, { x: W / 2, y: H - 120 - h / 2, an: 5, px: 39, color: t.text }),
  ];
}

export { wordmark };
