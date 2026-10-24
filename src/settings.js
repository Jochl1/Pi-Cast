import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ACCENTS, STYLES, TWITCH_QUALITIES, isHex } from './shared/theme.js';

const bool = (v) => typeof v === 'boolean';

// Each setting: default value and a validator for incoming values.
const SCHEMA = {
  accent: { def: 'violet', ok: (v) => v === 'custom' || v in ACCENTS },
  customAccent: { def: '#A898FF', ok: isHex },
  style: { def: 'aurora', ok: (v) => v in STYLES },
  bootAnimation: { def: true, ok: bool },
  sponsorBlock: { def: true, ok: bool },
  clock24: { def: true, ok: bool },
  deviceName: { def: 'Pi-Cast', ok: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 40 },
  twitchQuality: { def: '720p60', ok: (v) => TWITCH_QUALITIES.includes(v) },
  cecEnabled: { def: true, ok: bool },
  cecSwitchInput: { def: true, ok: bool },
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
