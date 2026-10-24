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

export const STYLES = {
  aurora: {
    label: 'Aurora',
    bg: '#0C0B14', phone: '#0F0E1A', text: '#F5F3FF', muted: '#A9A6C4',
    surface: 'rgba(255,255,255,0.07)', line: 'rgba(255,255,255,0.10)', dim: 'rgba(255,255,255,0.16)',
    glass: 'rgba(16,14,30,0.72)', iconBg: '#15132A',
    radius: 20, small: 12, pill: 999, glow: true,
  },
  midnight: {
    label: 'Midnight',
    bg: '#0A0C10', phone: '#0D1015', text: '#F2F4F7', muted: '#98A2B3',
    surface: '#161A22', line: 'rgba(255,255,255,0.08)', dim: '#272C36',
    glass: 'rgba(10,12,16,0.82)', iconBg: '#11141A',
    radius: 14, small: 8, pill: 999, glow: false,
  },
  studio: {
    label: 'Studio',
    bg: '#171614', phone: '#1A1917', text: '#EEEBE4', muted: '#A9A59B',
    surface: '#25231F', line: '#34322D', dim: '#3A3832',
    glass: 'rgba(23,22,20,0.88)', iconBg: '#25231F',
    radius: 4, small: 3, pill: 4, glow: false,
  },
};

export const STYLE_ORDER = ['aurora', 'midnight', 'studio'];

export const TWITCH_QUALITIES = ['1080p60', '720p60', '720p', '480p'];

export const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Resolves settings to concrete colors: { accent, accentName, ...style tokens }. */
export function themeFor(settings) {
  const style = STYLES[settings.style] ?? STYLES.aurora;
  const custom = settings.accent === 'custom';
  const accent = custom ? settings.customAccent : (ACCENTS[settings.accent] ?? ACCENTS.violet).hex;
  return {
    ...style,
    styleId: STYLES[settings.style] ? settings.style : 'aurora',
    accent: accent.toUpperCase(),
    accentName: custom ? 'Custom' : (ACCENTS[settings.accent] ?? ACCENTS.violet).label,
  };
}
