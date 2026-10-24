import { svgToPng } from './render.js';

/**
 * Home Screen icon: "pi·" in Sora on the icon background, the dot in the
 * accent color. Full-bleed square; iOS rounds the corners itself.
 */
export function iconSvg(theme, size = 180) {
  const font = Math.round(size * 0.37);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${theme.iconBg}"/>
  <text x="50%" y="${Math.round(size * 0.6)}" text-anchor="middle" font-family="Sora" font-weight="700"
    font-size="${font}" letter-spacing="${(-0.03 * font).toFixed(1)}" fill="${theme.text}">pi<tspan fill="${theme.accent}">·</tspan></text>
</svg>`;
}

export function iconPng(theme, size) {
  return svgToPng(iconSvg(theme, size), { width: size, height: size });
}
