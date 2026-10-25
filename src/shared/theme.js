// Design tokens shared by the server (TV overlays, icons) and the web app.
// Served to the browser as /shared/theme.js, so keep this file dependency-free.

export const ACCENTS = {
  violet: { label: 'Violet', hex: '#A898FF' },
  sky: { label: 'Sky', hex: '#6FA8FF' },
  cyan: { label: 'Cyan', hex: '#3DD6F5' },
  mint: { label: 'Mint', hex: '#4BE3B0' },
  lime: { label: 'Lime', hex: '#B6F25A' },
  amber: { label: 'Amber', hex: '#FFC247' },
  coral: { label: 'Coral', hex: '#FF7A59' },
  red: { label: 'Red', hex: '#FF5D5D' },
  rose: { label: 'Rose', hex: '#FF7EB6' },
  ice: { label: 'Ice', hex: '#E6ECF2' },
};

/** Text color on accent-colored backgrounds. */
export const ON_ACCENT = '#0A0C10';

// The look (Aurora). There used to be Midnight and Studio styles too.
export const STYLE = {
  bg: '#0C0B14', phone: '#0F0E1A', text: '#F5F3FF', muted: '#A9A6C4',
  surface: 'rgba(255,255,255,0.07)', line: 'rgba(255,255,255,0.10)', dim: 'rgba(255,255,255,0.16)',
  glass: 'rgba(16,14,30,0.72)', iconBg: '#15132A',
  radius: 20, small: 12, pill: 999,
};

/** The TV remote's colour keys (favourite shortcuts), in remote order, with their dot colors. */
export const KEY_COLORS = { red: '#FF5D5D', green: '#4BE3B0', yellow: '#FFC247', blue: '#6FA8FF' };

/** Game night: the players' colours, in the order they're handed out. */
export const PLAYER_COLORS = ['#FF7A59', '#FFC247', '#6FA8FF', '#4BE3B0', '#FF7EB6', '#B6F25A'];

/** Radio station tiles, by the station's place in the list (TV and web app). */
export const STATION_COLORS = ['#FFC247', '#FF7A59', '#6FA8FF', '#4BE3B0', '#FF7EB6', '#FF5D5D', '#E6ECF2', '#A898FF'];

export const TWITCH_QUALITIES = ['1080p60', '720p60', '720p', '480p'];

export const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Resolves settings to concrete colors: { accent, accentName, ...STYLE }. */
export function themeFor(settings) {
  const custom = settings.accent === 'custom';
  const accent = custom ? settings.customAccent : (ACCENTS[settings.accent] ?? ACCENTS.violet).hex;
  return {
    ...STYLE,
    accent: accent.toUpperCase(),
    accentName: custom ? 'Custom' : (ACCENTS[settings.accent] ?? ACCENTS.violet).label,
  };
}
