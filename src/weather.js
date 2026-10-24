import { EventEmitter } from 'node:events';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
// Older data isn't shown.
const STALE_MS = 3 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

/**
 * Weather for the home screen, from Open-Meteo (free, no key), for the place
 * in the `weatherPlace` setting. Refreshed every 30 minutes.
 *
 * data: { current: { temp, code, day }, days: [{ date, code, max, min }] }
 * with today first, or null.
 *
 * Events: 'change'
 */
export default class Weather extends EventEmitter {
  constructor({ settings, log }) {
    super();
    Object.assign(this, { settings, log });
    this.result = null; // { data, at, key }
    this.timer = null;
  }

  start() {
    this.settings.on('change', (values, changed) => {
      if (changed.includes('weatherPlace')) this.#refresh();
    });
    this.#refresh();
  }

  /** The current weather, or null if there's no place or the data is too old. */
  get data() {
    const place = this.settings.get().weatherPlace;
    const r = this.result;
    if (!place || !r || r.key !== key(place) || Date.now() - r.at > STALE_MS) return null;
    return r.data;
  }

  async #refresh() {
    clearTimeout(this.timer);
    const place = this.settings.get().weatherPlace;
    if (!place) {
      this.result = null;
      this.emit('change');
      return;
    }
    let wait = REFRESH_MS;
    try {
      const data = await forecast(place);
      if (key(this.settings.get().weatherPlace ?? {}) !== key(place)) return; // changed meanwhile
      this.result = { data, at: Date.now(), key: key(place) };
      this.emit('change');
    } catch (e) {
      this.log.warn(`weather for ${place.name} failed: ${e.message}`);
      wait = RETRY_MS;
    }
    this.timer = setTimeout(() => this.#refresh(), wait);
    this.timer.unref();
  }
}

const key = (place) => `${place.lat},${place.lon}`;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function forecast({ lat, lon }) {
  const q = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: 4,
  });
  const j = await getJson(`${FORECAST}?${q}`);
  return {
    current: { temp: j.current.temperature_2m, code: j.current.weather_code, day: j.current.is_day === 1 },
    days: j.daily.time.map((date, i) => ({
      date,
      code: j.daily.weather_code[i],
      max: j.daily.temperature_2m_max[i],
      min: j.daily.temperature_2m_min[i],
    })),
  };
}

/** The best match for a place name: { name, lat, lon }, or null. `name` reads like "Berlin, Germany". */
export async function findPlace(query, language) {
  const q = new URLSearchParams({ name: query, count: 1, language, format: 'json' });
  const j = await getJson(`${GEOCODING}?${q}`);
  const p = j.results?.[0];
  if (!p) return null;
  return { name: [p.name, p.country].filter(Boolean).join(', ').slice(0, 80), lat: p.latitude, lon: p.longitude };
}
