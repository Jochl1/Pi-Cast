import { themeFor } from '../shared/theme.js';
import { LANGUAGES, translator } from '../shared/i18n.js';
import {
  text, span, paint, rect, circle, shape, arcBand, escape, fit, textWidth, qrShape,
} from './ass.js';
import { weatherIcon, weatherKind } from './weatherIcons.js';
import { measure } from './measure.js';

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
const SOURCE = { youtube: 'YouTube', twitch: 'Twitch', instagram: 'Instagram' };
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

/** The network as a label and value with the Wi-Fi icon: Wi-Fi + network name, Ethernet or Offline. */
function network(t, net) {
  let label = t.tr('wifi');
  let value = net?.ssid ?? 'Wi-Fi';
  let bars = 3;
  let active = true;
  if (net?.kind === 'wifi') {
    if (net.signal != null) bars = net.signal > 66 ? 3 : net.signal > 33 ? 2 : 1;
  } else if (net?.kind === 'wired') {
    [label, value] = [t.tr('network'), t.tr('ethernet')];
  } else {
    [label, value] = [t.tr('network'), t.tr(net?.kind === 'offline' ? 'offline' : 'network')];
    active = net?.kind !== 'offline';
  }
  return { label, value: fit(value, 39, 420), icon: (x, y) => wifiIcon(x, y, t.text, active, bars) };
}

/** QR code tile (dark modules on a light rounded square), top left at (x, y). */
export function qrTile(t, qr, x, y, cell = 6) {
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

const BOTTOM_Y = H - PAD_Y; // baseline of the bottom row
const LINE_Y = 806; // the divider above it

/** A small spaced-out label over a value, at the bottom row's baseline; `icon(x, y)` goes before the value. */
function infoBlock(t, x, label, value, { mono = false, icon = null } = {}) {
  const events = [text(escape(label.toLocaleUpperCase(t.tr.locale)), {
    x, y: BOTTOM_Y - 50, an: 1, px: 24, weight: 600, spacing: 3.6, color: t.muted,
  })];
  let vx = x;
  if (icon) {
    events.push(...icon(vx - 4, BOTTOM_Y - 48));
    vx += 56;
  }
  events.push(text(escape(value), {
    x: vx, y: BOTTOM_Y, an: 1, px: 39, font: mono ? 'JetBrains Mono' : 'Sora', weight: 500, color: t.text,
  }));
  return { events, w: vx - x + textWidth(value, 39, mono ? 0.6 : 0.55) };
}

/**
 * Below the divider: the web remote's QR code, the TV code and the network
 * on the left, the wordmark on the right.
 */
function bottomBar(t, { pairingCode, qr, net }) {
  const events = [rect(PAD_X, LINE_Y, W - 2 * PAD_X, 3, { color: t.line })];
  let x = PAD_X;
  if (qr) {
    const cell = 5;
    const size = (qr.length + 4) * cell;
    events.push(...qrTile(t, qr, x, BOTTOM_Y + 6 - size, cell).events);
    x += size + 40;
  }
  const code = infoBlock(t, x, t.tr('tvCode'), pairingCode ?? '—', { mono: true });
  const n = network(t, net);
  const netBlock = infoBlock(t, x + code.w + 96, n.label, n.value, { icon: n.icon });
  events.push(
    ...code.events,
    ...netBlock.events,
    text(wordmark(t, t.text), { x: W - PAD_X, y: BOTTOM_Y + 16, an: 3, px: 104, weight: 600, spacing: -2, color: t.text }),
  );
  return events;
}

const deg = (v) => `${Math.round(v)}°`.replace('-', '−');
const weekday = (date, locale) => new Date(`${date}T12:00`).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');

/**
 * Weather at the top right, opposite the clock: icon and temperature, the
 * condition with today's high and low, and the next three days in columns.
 * It ends well above the glass card (CARD.y).
 * `weather` = { current: { temp, code, day }, days: [{ date, code, max, min }] }
 * with today first.
 */
function weather(t, w) {
  const right = W - PAD_X;
  const colors = { accent: t.accent, text: t.text };
  const temp = deg(w.current.temp);
  const kind = weatherKind(w.current.code);
  const events = [
    text(temp, { x: right, y: PAD_Y - 36, an: 9, px: 112, weight: 600, spacing: -3, color: t.text }),
    ...weatherIcon(kind, right - textWidth(temp, 112, 0.5) - 28 - 92, PAD_Y - 2, 92, colors, !w.current.day),
  ];
  const [today, ...next] = w.days;
  const line = [t.tr(`wx_${kind}`), today && `${deg(today.max)} / ${deg(today.min)}`].filter(Boolean).join(' · ');
  events.push(text(escape(line), { x: right, y: PAD_Y + 112, an: 9, px: 33, color: t.muted }));
  const colW = 124;
  next.slice(0, 3).forEach((d, i) => {
    const cx = right - colW / 2 - (2 - i) * colW;
    events.push(
      text(escape(weekday(d.date, t.tr.locale)), { x: cx, y: 250, an: 8, px: 26, weight: 600, color: t.muted }),
      ...weatherIcon(weatherKind(d.code), cx - 20, 288, 40, colors),
      text(`${deg(d.max)}{${paint(t.muted)}} ${deg(d.min)}`, { x: cx, y: 334, an: 8, px: 26, color: t.text }),
    );
  });
  return events;
}

const LIVE_RED = '#FF4D5E';

/**
 * A row above the divider: the colour keys' favourites on the left
 * (`keys` = [{ hex, name, live }]; a live Twitch channel gets a red "LIVE"
 * pill and a brighter name), and "▲ Instagram" on the right while logged in.
 * Names are measured in the font, so the pills never overlap them.
 */
function keyHints(t, keys, instagram) {
  const y = LINE_Y - 52;
  const events = [];
  let x = PAD_X;
  for (const { hex, name, live } of keys) {
    const short = fit(name, 30, 300);
    const nameW = measure(short, 30) ?? textWidth(short, 30, 0.6);
    events.push(
      circle(x + 10, y, 10, { color: hex }),
      text(escape(short), { x: x + 32, y, an: 4, px: 30, color: live ? t.text : t.muted }),
    );
    x += 32 + nameW;
    if (live) {
      const pillW = 74;
      events.push(
        rect(x + 16, y - 17, pillW, 34, { color: LIVE_RED, radius: 17 }),
        text('LIVE', { x: x + 16 + pillW / 2, y, an: 5, px: 20, weight: 600, spacing: 2, color: '#FFFFFF' }),
      );
      x += 16 + pillW;
    }
    x += 48;
  }
  if (instagram) {
    events.push(
      text(`▲ {${paint(t.muted)}}${escape(t.tr('homeInstagram'))}`, { x: W - PAD_X, y, an: 6, px: 30, weight: 600, color: t.text }),
    );
  }
  return events;
}

/**
 * Home / idle screen. `loading` = { title, channel, kind, sender } while a
 * video starts; `weather` (see weather()) and `keys`/`instagram` (see
 * keyHints()) are optional.
 */
export function home(t, {
  now, clock24, net, pairingCode, qr, deviceName, loading, panelOpen, weather: w, keys = [], instagram = false,
}) {
  if (panelOpen) return clock(t, now, clock24, 0.35);

  const events = [glassCard(), ...clock(t, now, clock24), ...bottomBar(t, { pairingCode, qr, net })];
  if (w) events.push(...weather(t, w));
  if (!loading) events.push(...keyHints(t, keys, instagram));
  if (loading) {
    events.push(...loadingText(t, 'loading', loading));
  } else {
    events.push(
      text(escape(fit(t.tr('readyToCast'), 78, CARD.w - 80, 0.5)), { x: W / 2, y: 452, an: 8, px: 78, weight: 600, spacing: -0.8, color: t.text }),
      text(escape(fit(t.tr('castHint', { name: deviceName }), 39, CARD.w - 80)), { x: W / 2, y: 560, an: 8, px: 39, color: t.muted }),
    );
  }
  return events;
}

// The glass card in the middle of the home screen.
export const CARD = { x: 320, y: 440, w: 1280, h: 222, r: 56 };
/** The home screen's glass card: a faint white fill and edge over the backdrop. */
const glassCard = () => rect(CARD.x, CARD.y, CARD.w, CARD.h, {
  color: '#FFFFFF', opacity: 0.055, radius: CARD.r, border: 2, borderColor: '#FFFFFF', borderOpacity: 0.16,
});
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
  { key: 'sounds', label: 'rowSounds' },
  { key: 'sponsorBlock', label: 'rowSponsors' },
  { key: 'clock24', label: 'rowClock' },
  { key: 'cecSwitchInput', label: 'rowSwitchInput' },
  // An action, not a setting: OK twice.
  { key: 'power', label: 'rowPower' },
];

function panelValue(t, key, s, powerConfirm) {
  if (key === 'power') return powerConfirm ? t.tr('powerConfirm') : '';
  if (key === 'language') return `‹ ${LANGUAGES[s.language]?.label ?? s.language} ›`;
  if (key === 'clock24') return s.clock24 ? '24h' : '12h';
  return s[key] ? t.tr('on') : t.tr('off');
}

/**
 * Settings panel on the right; `swatches` = [{ id, hex }], `focus` = row index,
 * `powerConfirm` while the power row waits for its second OK.
 */
export function settingsPanel(t, {
  settings, focus, swatches, powerConfirm = false,
}) {
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

  let rowY = y + 140;
  const ROW_H = 68;
  const GAP = 8;
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
        text(panelValue(t, row.key, settings, powerConfirm), {
          x: inner + innerW - 36, y: mid, an: 6, px: 36, color: row.key === 'power' ? t.accent : focused ? t.text : t.muted,
        }),
      );
    }
    rowY += rowH + GAP;
  });

  events.push(text(t.tr('panelFooter'), {
    x: inner, y: y + h - 54, an: 1, px: 30, spacing: 1.2, color: t.muted,
  }));
  return events;
}

/** Short message at the bottom centre, e.g. playback errors; `dot` = color of a leading dot. */
export function toast(t, message, dot = null) {
  const label = escape(fit(message, 39, 1400));
  const lead = dot ? 24 + 24 : 0;
  const w = textWidth(label, 39, 0.56) + 108 + lead;
  const h = 114;
  const x = W / 2 - w / 2;
  const events = [
    rect(x, H - 120 - h, w, h, { color: t.glass, radius: Math.min(t.pill * 3, h / 2), border: 3, borderColor: t.line }),
    text(label, { x: W / 2 + lead / 2, y: H - 120 - h / 2, an: 5, px: 39, color: t.text }),
  ];
  if (dot) events.push(circle(x + 54 + 12, H - 120 - h / 2, 12, { color: dot }));
  return events;
}

// --- Instagram Reels ---

/** Where mpv shows an upright 9:16 Reel: full height, centred. */
export const REEL = { x: Math.round((W - (H * 9) / 16) / 2), w: Math.round((H * 9) / 16) };
const REEL_SIDE = { left: PAD_X, right: REEL.x + REEL.w + 64, w: REEL.x - 64 - PAD_X };

/** A heart, `size` px wide, with its top left at (x, y). */
export function heart(x, y, size, opts = {}) {
  const k = size / 100;
  const pts = [50, 92, 22, 72, 0, 54, 0, 30, 0, 13, 13, 0, 30, 0, 40, 0, 47, 5, 50, 13,
    53, 5, 60, 0, 70, 0, 87, 0, 100, 13, 100, 30, 100, 54, 78, 72, 50, 92].map((v) => Math.round(v * k * 10) / 10);
  const [mx, my, ...curves] = pts;
  const b = [];
  for (let i = 0; i < curves.length; i += 6) b.push(`b ${curves.slice(i, i + 6).join(' ')}`);
  return shape(`m ${mx} ${my} ${b.join(' ')}`, { ...opts, x, y });
}

/** libass has no emoji font: drop emoji, flags and joiners, and fold line breaks. */
const plain = (s) => String(s ?? '')
  .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Splits text into at most `maxLines` lines of roughly `maxW` px; the last one ends in … if cut. */
function wrap(s, px, maxW, maxLines, avg = 0.52) {
  const max = Math.max(8, Math.floor(maxW / (px * avg)));
  const lines = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && lines.join(' ').length < s.length) lines[maxLines - 1] = fit(`${lines[maxLines - 1]}…`, px, maxW, avg);
  return lines;
}

const compact = (n, locale) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/**
 * Reels: the Reel itself is mpv's video in the middle (REEL), with the
 * background color on both sides. Left: the title and the keys. Right: who
 * posted it, the caption and the likes. `reel` = { user, caption, likes,
 * liked } or null while the first page loads; `pulse` (0..1) fades the big
 * heart after a like; `paused` shows the pause ring.
 */
export function reels(t, { reel, paused: isPaused, pulse = 0 }) {
  const { left, right, w } = REEL_SIDE;
  const events = [
    text('INSTAGRAM', { x: left, y: PAD_Y, px: 30, weight: 600, spacing: 3.6, color: t.accent }),
    text(t.tr('reelsTitle'), { x: left, y: PAD_Y + 44, px: 72, weight: 600, spacing: -1.5, color: t.text }),
  ];

  const keys = [['▲ ▼', 'reelsKeyScroll'], ['OK', 'reelsKeyLike'], ['◀ ▶', 'reelsKeySeek'], [t.tr('reelsKeyBack'), 'reelsKeyHome']];
  keys.forEach(([key, label], i) => {
    const y = H - PAD_Y - (keys.length - 1 - i) * 56;
    events.push(
      text(escape(key), { x: left, y, an: 1, px: 30, weight: 600, color: t.text }),
      text(t.tr(label), { x: left + 150, y, an: 1, px: 30, color: t.muted }),
    );
  });

  if (reel) {
    // Bottom up: likes, caption, user.
    const likeH = 48;
    const likeY = H - PAD_Y - likeH;
    events.push(heart(right, likeY + 2, 50, reel.liked
      ? { color: t.accent }
      : { color: t.text, opacity: 0, border: 3.5, borderColor: t.text }));
    if (reel.likes != null) {
      events.push(text(compact(reel.likes, t.tr.locale), {
        x: right + 50 + 24, y: likeY + likeH / 2, an: 4, px: 36, weight: 600, color: reel.liked ? t.accent : t.text,
      }));
    }
    const lines = wrap(plain(reel.caption), 30, w, 4);
    const lineH = 44;
    const capTop = likeY - 48 - lines.length * lineH;
    lines.forEach((line, i) => events.push(text(escape(line), { x: right, y: capTop + i * lineH, px: 30, color: t.muted })));
    if (reel.user) {
      events.push(text(escape(fit(`@${reel.user}`, 42, w, 0.56)), {
        x: right, y: capTop - (lines.length ? 24 : 0) - 58, px: 42, weight: 600, color: t.text,
      }));
    }
  }

  const cx = W / 2;
  const cy = H / 2;
  if (isPaused) {
    events.push(
      circle(cx, cy, 102, { color: ON_VIDEO.dim, border: 6, borderColor: t.accent }),
      rect(cx - 12 - 18, cy - 36, 18, 72, { color: t.accent, radius: 6 }),
      rect(cx + 12, cy - 36, 18, 72, { color: t.accent, radius: 6 }),
    );
  }
  if (pulse > 0) {
    const size = 240 + 40 * (1 - pulse);
    events.push(heart(cx - size / 2, cy - size * 0.46, size, { color: t.accent, opacity: pulse }));
  }
  return events;
}

export { wordmark };

// --- AirPlay ---

/** Where the cover bitmap goes (overlay-add, so it's placed by tv.js). */
export const AIRPLAY_COVER = { x: W - PAD_X - 620, y: 180, size: 620, r: 28 };

/**
 * Music over AirPlay, like a poster: the clock and date at the top left as on
 * the home screen, the cover on the right (a bitmap, see AIRPLAY_COVER; a
 * placeholder tile is drawn under it), and the title, artist and album and
 * the progress at the bottom left. `item` = { title, artist, album,
 * position, duration, playing }; paused adds "· PAUSED" to the label.
 */
export function airplay(t, { now, clock24, item }) {
  const width = AIRPLAY_COVER.x - 96 - PAD_X;
  const title = item.title || t.tr('airplayTitle');
  const big = title.length <= 18;
  const sub = [item.artist, item.album].filter(Boolean).join(' — ');
  const c = AIRPLAY_COVER;
  const events = [
    ...clock(t, now, clock24),
    rect(c.x, c.y, c.size, c.size, { color: t.surface, radius: c.r }),
    // Paused shows here: the cover bitmap would hide anything drawn over it.
    text(`${span('●', t.accent)}${span(' AIRPLAY', t.text)}${item.playing ? '' : span(` · ${t.tr('paused').toLocaleUpperCase(t.tr.locale)}`, t.muted)}`, {
      x: PAD_X, y: 590, px: 27, weight: 600, spacing: 3.6, color: t.text,
    }),
    text(escape(fit(title, big ? 96 : 72, width, 0.52)), {
      x: PAD_X, y: big ? 640 : 656, px: big ? 96 : 72, weight: 600, spacing: big ? -2 : -1.4, color: t.text,
    }),
  ];
  if (sub) events.push(text(escape(fit(sub, 39, width)), { x: PAD_X, y: 770, px: 39, color: t.muted }));
  if (item.duration > 0) {
    const frac = Math.min(1, item.position / item.duration);
    const barW = Math.min(1000, width);
    events.push(
      rect(PAD_X, 900, barW, 8, { color: 'rgba(255,255,255,0.18)', radius: 4 }),
      rect(PAD_X, 900, Math.max(8, barW * frac), 8, { color: t.accent, radius: 4 }),
      text(fmtTime(item.position), { x: PAD_X, y: 926, px: 27, font: 'JetBrains Mono', weight: 500, color: t.muted }),
      text(fmtTime(item.duration), { x: PAD_X + barW, y: 926, an: 9, px: 27, font: 'JetBrains Mono', weight: 500, color: t.muted }),
    );
  }
  return events;
}
