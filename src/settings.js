import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ACCENTS, KEY_COLORS, TWITCH_QUALITIES, isHex } from './shared/theme.js';
import { LANGUAGES } from './shared/i18n.js';

const bool = (v) => typeof v === 'boolean';
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** { red, green, yellow, blue }: each null or { name, url } with an http(s) link. */
const shortcutsOk = (v) => isObject(v) && Object.entries(v).every(([color, s]) => color in KEY_COLORS && (s === null || (
  isObject(s) && typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 30
  && typeof s.url === 'string' && /^https?:\/\/\S+$/i.test(s.url) && s.url.length <= 500)));

// Each setting: default value and a validator for incoming values.
const SCHEMA = {
  accent: { def: 'violet', ok: (v) => v === 'custom' || v in ACCENTS },
  customAccent: { def: '#A898FF', ok: isHex },
  // Drifting glows on the boot splash and the home backdrop.
  bootAnimation: { def: true, ok: bool },
  // UI sounds and the startup sound.
  sounds: { def: true, ok: bool },
  sponsorBlock: { def: true, ok: bool },
  clock24: { def: true, ok: bool },
  language: { def: 'en', ok: (v) => v in LANGUAGES },
  // Favourites on the remote's colour keys.
  shortcuts: {
    def: {
      red: { name: 'Trymacs', url: 'https://www.twitch.tv/trymacs' },
      green: { name: 'BigSpin', url: 'https://www.twitch.tv/bigspincr' },
      yellow: null,
      blue: null,
    },
    ok: shortcutsOk,
  },
  deviceName: { def: 'pi-cast', ok: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 40 },
  twitchQuality: { def: '720p60', ok: (v) => TWITCH_QUALITIES.includes(v) },
  cecEnabled: { def: true, ok: bool },
  cecSwitchInput: { def: true, ok: bool },
  // Stop and go dark while the TV is off; startup sound when it's back.
  cecStandby: { def: true, ok: bool },
};

/**
 * User settings, changed from the web app or the TV settings panel and
 * persisted in data/settings.json. Emits 'change' (settings, changedKeys).
 */
export default class Settings extends EventEmitter {
  constructor(file, { deviceName } = {}) {
    super();
    this.file = file;
    this.values = Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.def]));
    if (deviceName) this.values.deviceName = deviceName;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(saved)) {
        if (SCHEMA[k]?.ok(v)) this.values[k] = v;
      }
    } catch { /* first run */ }
  }

  get() {
    return { ...this.values };
  }

  /** Applies a partial update. Throws (status 400) on unknown keys or bad values. */
  async update(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!SCHEMA[k]) throw Object.assign(new Error(`Unknown setting: ${k}`), { status: 400 });
      const value = typeof v === 'string' ? v.trim() : v;
      if (!SCHEMA[k].ok(value)) throw Object.assign(new Error(`Invalid value for ${k}`), { status: 400 });
      if (this.values[k] !== value) changed.push(k);
    }
    if (!changed.length) return this.get();
    for (const k of changed) this.values[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
    await this.#save();
    this.emit('change', this.get(), changed);
    return this.get();
  }

  async #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.values, null, 2));
    await fs.promises.rename(tmp, this.file);
  }
}

/** streamlink quality list for a setting: the choice first, then lower fallbacks. */
export function streamlinkQuality(choice) {
  const i = TWITCH_QUALITIES.indexOf(choice);
  return [...TWITCH_QUALITIES.slice(i < 0 ? 1 : i), 'best'].join(',');
}
