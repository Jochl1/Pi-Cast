import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR } from './config.js';
import { svgToPng, xml } from './render.js';
import { themeFor } from './shared/theme.js';
import { translator } from './shared/i18n.js';
import { parseColor } from './tv/ass.js';

export const SPLASH_DIR = path.join(DATA_DIR, 'plymouth');
// Installed by deploy/install.sh; copies SPLASH_DIR into the Plymouth theme
// and rebuilds the initramfs. Allowed via a sudoers rule for this one command.
const UPDATE_HELPER = '/usr/local/sbin/picast-plymouth-update';
const SPLASH_KEYS = ['accent', 'customAccent', 'bootAnimation', 'language'];

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

function glowSvg(size, color, peak) {
  return svg(size, size, `<defs><radialGradient id="g">
    <stop offset="0" stop-color="${color}" stop-opacity="${peak}"/>
    <stop offset="0.66" stop-color="${color}" stop-opacity="0"/>
  </radialGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/>`);
}

/** Renders the boot splash images and script for `settings` into `outDir`. */
export async function buildSplash(settings, outDir = SPLASH_DIR) {
  const t = themeFor(settings);
  fs.mkdirSync(outDir, { recursive: true });
  const put = async (name, svgText, size) => {
    fs.copyFileSync(await svgToPng(svgText, size), path.join(outDir, name));
  };

  // Sizes at 1080p; the script scales them to the real screen.
  await put('wordmark.png', svg(520, 180, `<text x="260" y="128" text-anchor="middle" font-family="Sora" font-weight="600"
    font-size="132" letter-spacing="-2.6" fill="${t.text}">pi<tspan fill="${t.accent}">·</tspan>cast</text>`));
  await put('dots.png', svg(66, 18, [9, 33, 57].map((cx, i) => {
    const { r, g, b, a } = parseColor(i === 1 ? t.accent : t.dim);
    return `<circle cx="${cx}" cy="9" r="9" fill="rgb(${r},${g},${b})" fill-opacity="${a}"/>`;
  }).join('')));
  await put('status.png', svg(360, 48, `<text x="180" y="36" text-anchor="middle" font-family="Sora"
    font-size="33" letter-spacing="2.6" fill="${t.muted}">${xml(translator(settings.language)('startingUp'))}</text>`));
  await put('glow-a.png', glowSvg(1080, t.accent, 0.45));
  await put('glow-b.png', glowSvg(990, t.accent, 0.30));

  const bg = parseColor(t.bg);
  const script = fs.readFileSync(path.join(ROOT, 'deploy', 'plymouth', 'picast.script.in'), 'utf8')
    .replaceAll('@BG_R@', (bg.r / 255).toFixed(4))
    .replaceAll('@BG_G@', (bg.g / 255).toFixed(4))
    .replaceAll('@BG_B@', (bg.b / 255).toFixed(4))
    .replaceAll('@ANIMATE@', settings.bootAnimation ? '1' : '0');
  fs.writeFileSync(path.join(outDir, 'picast.script'), script);
  fs.copyFileSync(path.join(ROOT, 'deploy', 'plymouth', 'picast.plymouth'), path.join(outDir, 'picast.plymouth'));
}

/**
 * Keeps the boot splash in sync with the look settings. Rebuilding the
 * initramfs takes about a minute on a Pi 3, so changes are batched.
 */
export default class BootSplash {
  constructor({ settings, log, delay = 15000 }) {
    Object.assign(this, { settings, log, delay });
    this.timer = null;
    settings.on('change', (values, changed) => {
      if (changed.some((k) => SPLASH_KEYS.includes(k))) this.schedule();
    });
  }

  schedule() {
    if (process.platform !== 'linux' || !fs.existsSync(UPDATE_HELPER)) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#update(), this.delay);
  }

  async #update() {
    try {
      await buildSplash(this.settings.get());
      const proc = spawn('sudo', ['-n', UPDATE_HELPER], { stdio: 'ignore', detached: true });
      proc.on('error', (e) => this.log.warn('boot splash update failed:', e.message));
      proc.unref();
      this.log.info('boot splash updated; it shows from the next boot');
    } catch (e) {
      this.log.warn('boot splash build failed:', e.message);
    }
  }
}
