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
  // One dot at its largest (13 px, like screens.dots()); the script scales and fades it.
  const dot = (color) => {
    const { r, g, b } = parseColor(color);
    return svg(26, 26, `<circle cx="13" cy="13" r="13" fill="rgb(${r},${g},${b})"/>`);
  };
  await put('dot.png', dot(t.text));
  await put('dot-accent.png', dot(t.accent));
  await put('status.png', svg(360, 48, `<text x="180" y="36" text-anchor="middle" font-family="Sora"
    font-size="33" letter-spacing="2.6" fill="${t.muted}">${xml(translator(settings.language)('startingUp'))}</text>`));
  // From older versions; the install helper copies every PNG.
  for (const old of ['glow-a.png', 'glow-b.png', 'dots.png']) fs.rmSync(path.join(outDir, old), { force: true });

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
