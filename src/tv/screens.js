import { themeFor } from '../shared/theme.js';
import { LANGUAGES, translator } from '../shared/i18n.js';
import {
  text, span, rect, circle, arcBand, escape, fit, textWidth, qrShape,
} from './ass.js';

/**
 * Pure layout functions: state in, ASS events out. Coordinates are 1920x1080
 * (the design mock-ups were 640x360, so their sizes are multiplied by 3).
 *
 * mpv packs all overlays into one texture, which the Pi 3's GPU caps at
 * 2048x2048; if they don't fit, nothing is drawn. So no full-screen shapes
 * behind the home screen (its backdrop is a picture mpv plays, see
 * background.js) and no big blurred glows. Run scripts/check-osd.js on the
 * Pi after changes.
 *
 * `t` is a look(): the theme's colors plus `tr`, the translator for the
 * language setting.
 */

export const W = 1920;
export const H = 1080;
const PAD_X = 96;
const PAD_Y = 84;
// Colors used over video, from the design.
const ON_VIDEO = { text: '#F2F4F7', muted: '#B4BCC8', track: 'rgba(255,255,255,0.2)', dim: 'rgba(6,8,12,0.62)' };
const SOURCE = { youtube: 'YouTube', twitch: 'Twitch' };
const source = (t, kind) => SOURCE[kind] ?? t.tr('link');

/** Colors and texts for `settings`: themeFor() plus tr (see i18n.js). */
export const look = (settings) => ({ ...themeFor(settings), tr: translator(settings.language) });

/** "pi·cast" with the dot in the accent color; `color` is the rest of the word. */
const wordmark = (t, color = t.text, opacity = 1) => `pi${span('·', t.accent, opacity)}${span('cast', color, opacity)}`;

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function clockParts(now, clock24, locale) {
  const date = `${now.toLocaleDateString(locale, { weekday: 'long' })}, ${now.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}`;
  const h = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (clock24) return { time: `${String(h).padStart(2, '0')}:${mm}`, suffix: '', date };
  return { time: `${h % 12 || 12}:${mm}`, suffix: h < 12 ? 'AM' : 'PM', date };
}

function clock(t, now, clock24, opacity = 1) {
  const c = clockParts(now, clock24, t.tr.locale);
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
  let label = t.tr('network');
  let bars = 3;
  let active = true;
  if (net?.kind === 'wifi') {
    label = net.ssid ? `Wi-Fi · ${net.ssid}` : 'Wi-Fi';
    if (net.signal != null) bars = net.signal > 66 ? 3 : net.signal > 33 ? 2 : 1;
  } else if (net?.kind === 'wired') {
    label = t.tr('ethernet');
  } else if (net?.kind === 'offline') {
    label = t.tr('offline');
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

/** QR code tile (dark modules on a light rounded square), top left at (x, y). */
export function qrTile(t, qr, x, y) {
  const cell = 6;
  const quiet = 2; // modules of light margin; less than the spec's 4, but phones cope
  const size = (qr.length + 2 * quiet) * cell;
  return {
    size,
    events: [
      rect(x, y, size, size, { color: t.text, radius: t.small * 1.5 }),
      qrShape(qr, x + quiet * cell, y + quiet * cell, cell, { color: t.bg }),
    ],
  };
}

function bottomBar(t, { pairingCode, remote, qr }) {
  const lineY = 846;
  const labelY = 888;
  const valueY = 924;
  const remoteX = PAD_X + Math.max(textWidth('000 000 000 000', 45, 0.6), textWidth(pairingCode ?? '', 45, 0.6)) + 96;
  const label = (s, x) => text(s, { x, y: labelY, px: 30, weight: 600, spacing: 3.6, color: t.muted });
  const value = (s, x) => text(escape(s), { x, y: valueY, px: 45, font: 'JetBrains Mono', weight: 500, color: t.text });
  const events = [
    rect(PAD_X, lineY, W - 2 * PAD_X, 3, { color: t.line }),
    label(t.tr('tvCode'), PAD_X),
    value(pairingCode ?? '—', PAD_X),
    label(t.tr('remote'), remoteX),
    value(remote, remoteX),
    text(wordmark(t, t.muted), { x: W - PAD_X, y: 1012, an: 3, px: 60, weight: 600, spacing: -1.2, color: t.muted }),
  ];
  if (qr) {
    // Next to the remote's address, with a short caption to its right.
    const x = remoteX + textWidth(remote, 45, 0.6) + 60;
    const tile = qrTile(t, qr, x, lineY + 24);
    const mid = lineY + 24 + tile.size / 2;
    events.push(
      ...tile.events,
      text(t.tr('scanLine1'), { x: x + tile.size + 24, y: mid - 4, an: 1, px: 30, color: t.muted }),
      text(t.tr('scanLine2'), { x: x + tile.size + 24, y: mid + 4, an: 7, px: 30, color: t.muted }),
    );
  }
  return events;
}

/** Home / idle screen. `loading` = { title, channel, kind, sender } while a video starts. */
export function home(t, { now, clock24, net, pairingCode, remote, qr, deviceName, loading, panelOpen }) {
  if (panelOpen) return clock(t, now, clock24, 0.35);

  const events = [...clock(t, now, clock24), ...network(t, net), ...bottomBar(t, { pairingCode, remote, qr })];
  if (loading) {
    // The backdrop image already has the glass card.
    events.push(...loadingText(t, 'loading', loading));
  } else {
    events.push(
      text(escape(fit(t.tr('readyToCast'), 78, CARD.w - 80, 0.5)), { x: W / 2, y: 452, an: 8, px: 78, weight: 600, spacing: -0.8, color: t.text }),
      text(escape(fit(t.tr('castHint', { name: deviceName }), 39, CARD.w - 80)), { x: W / 2, y: 560, an: 8, px: 39, color: t.muted }),
    );
  }
  return events;
}

// The glass card in the middle of the home backdrop (see background.js).
export const CARD = { x: 320, y: 440, w: 1280, h: 222, r: 56 };
const DOTS_Y = CARD.y + CARD.h + 64;

/**
 * Label, title and source line of the loading card. `label` is 'loading' or
 * 'buffering'; `item` = { title, channel, kind, sender }.
 */
function loadingText(t, label, item, onVideo = false) {
  const sub = [item.channel, source(t, item.kind), item.sender && t.tr('from', { name: item.sender })].filter(Boolean).join(' · ');
  const color = onVideo ? ON_VIDEO : t;
  return [
    text(t.tr(label), { x: W / 2, y: CARD.y + 34, an: 8, px: 30, weight: 600, spacing: 3.6, color: t.accent }),
    text(escape(fit(item.title || t.tr('gettingReady'), 54, CARD.w - 120, 0.5)), {
      x: W / 2, y: CARD.y + 76, an: 8, px: 54, weight: 600, color: color.text,
    }),
    text(escape(fit(sub, 36, CARD.w - 120)), { x: W / 2, y: CARD.y + 158, an: 8, px: 36, color: color.muted }),
  ];
}

/**
 * Loading card over a video: dimmed video and a glass card like the
 * backdrop's. `label` is 'loading' (the next video starts) or 'buffering'.
 */
export function loadingOverVideo(t, label, item) {
  return [
    rect(0, 0, W, H, { color: ON_VIDEO.dim }),
    rect(CARD.x, CARD.y, CARD.w, CARD.h, { color: t.glass, radius: CARD.r }),
    ...loadingText(t, label, item, true),
  ];
}

/**
 * The three loading dots under the card, pulsing one after another (the
 * middle one in the accent, as on the boot screen). `phase` runs 0..1 per
 * cycle; redrawn a few times a second on a layer of their own.
 */
export function dots(t, phase, cx = W / 2, cy = DOTS_Y) {
  return [-1, 0, 1].map((i) => {
    // Each dot swells and brightens in turn.
    const p = (phase - (i + 1) / 3 + 1) % 1;
    const pulse = Math.max(0, Math.cos(p * 2 * Math.PI)) ** 2;
    return circle(cx + i * 36, cy, 9 + 4 * pulse, { color: i === 0 ? t.accent : t.text, opacity: i === 0 ? 0.55 + 0.45 * pulse : 0.25 + 0.5 * pulse });
  });
}

/** "<sender> connected" pill, top right. */
export function senderPill(t, name, opacity = 1) {
  const label = escape(fit(t.tr('connected', { name }), 36, 700));
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
  const titleText = fit(title || t.tr('playing'), 45, maxText, 0.5);
  const sub = [source(t, kind), t.tr('adFree'), quality].filter(Boolean).join(' · ');
  const textW = Math.min(maxText, Math.max(textWidth(titleText, 45, 0.5), textWidth(sub, 33), textWidth(t.tr('nowPlaying'), 30, 0.75)));
  const w = textX - L.x + textW + 54;
  const midY = L.y + L.h / 2;

  const events = [
    rect(L.x, L.y, w, L.h, { color: t.glass, opacity, radius: t.radius * 3 }),
    text(t.tr('nowPlaying'), { x: textX, y: midY - 74, px: 30, weight: 600, spacing: 3.6, color: t.accent, opacity }),
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
  const sub = [channel, source(t, kind)].filter(Boolean).join(' · ');
  const events = [
    rect(0, 0, W, H, { color: ON_VIDEO.dim }),
    circle(W / 2, H / 2, 102, { color: t.accent, opacity: 0, border: 6, borderColor: t.accent }),
    rect(W / 2 - 12 - 18, H / 2 - 36, 18, 72, { color: t.accent, radius: 6 }),
    rect(W / 2 + 12, H / 2 - 36, 18, 72, { color: t.accent, radius: 6 }),
    text(escape(fit(title || t.tr('paused'), 60, width, 0.5)), { x: left, y: barY - 156, px: 60, weight: 600, color: ON_VIDEO.text }),
    text(escape(fit(sub, 36, width)), { x: left, y: barY - 72, px: 36, color: ON_VIDEO.muted }),
    rect(left, barY, width, 12, { color: ON_VIDEO.track, radius: 6 }),
  ];
  if (frac > 0) events.push(rect(left, barY, Math.max(12, width * frac), 12, { color: t.accent, radius: 6, opacity: live ? 0.5 : 1 }));
  const time = (s, x, an) => text(s, { x, y: barY + 36, an, px: 33, font: 'JetBrains Mono', weight: 500, color: ON_VIDEO.muted });
  events.push(live ? time(t.tr('live'), left, 7) : time(fmtTime(position), left, 7));
  if (!live) events.push(time(fmtTime(duration), left + width, 9));
  return events;
}

/** Rows of the TV settings panel, in order; `label` is a string key (i18n.js). */
export const PANEL_ROWS = [
  { key: 'accent', label: 'rowAccent' },
  { key: 'language', label: 'rowLanguage' },
  { key: 'bootAnimation', label: 'rowAnimations' },
  { key: 'sponsorBlock', label: 'rowSponsors' },
  { key: 'clock24', label: 'rowClock' },
  { key: 'cecSwitchInput', label: 'rowSwitchInput' },
];

function panelValue(t, key, s) {
  if (key === 'language') return `‹ ${LANGUAGES[s.language]?.label ?? s.language} ›`;
  if (key === 'clock24') return s.clock24 ? '24h' : '12h';
  return s[key] ? t.tr('on') : t.tr('off');
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
    text(t.tr('settings'), { x: inner, y: y + 50, px: 54, weight: 600, color: t.text }),
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
      events.push(text(t.tr(row.label), { x: inner + 36, y: rowY + 28, px: 36, weight: 600, color: t.text }));
      swatches.forEach((sw, n) => {
        const cx = inner + 36 + 24 + n * 69;
        const cy = rowY + 28 + 56 + 24 + 12;
        if (sw.selected) events.push(circle(cx, cy, 31, { color: '#FFFFFF', opacity: 0, border: 4.5, borderColor: '#FFFFFF' }));
        events.push(circle(cx, cy, 24, { color: sw.hex }));
      });
    } else {
      const mid = rowY + rowH / 2;
      events.push(
        text(t.tr(row.label), { x: inner + 36, y: mid, an: 4, px: 36, weight: focused ? 600 : 400, color: t.text }),
        text(panelValue(t, row.key, settings), { x: inner + innerW - 36, y: mid, an: 6, px: 36, color: focused ? t.text : t.muted }),
      );
    }
    rowY += rowH + GAP;
  });

  events.push(text(t.tr('panelFooter'), {
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
