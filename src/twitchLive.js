import { EventEmitter } from 'node:events';

const GQL = 'https://gql.twitch.tv/gql';
// Twitch's public web client ID, the one streamlink uses too; no account needed.
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const POLL_MS = 3 * 60 * 1000;
const TIMEOUT_MS = 15000;

/** The Twitch channel of a link, lowercased, or null. */
export function twitchChannel(url) {
  const m = /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/([a-z0-9_]{1,25})\/?(?:[?#]|$)/i.exec(url ?? '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Which Twitch favourites (colour keys) are live, for the home screen's
 * "LIVE" tags. One request for all of them every 3 minutes, skipped while
 * the TV is in standby.
 *
 * Events: 'change'
 */
export default class TwitchLive extends EventEmitter {
  constructor({ settings, playback, log }) {
    super();
    Object.assign(this, { settings, playback, log });
    this.live = new Set();
    this.timer = null;
  }

  start() {
    this.settings.on('change', (values, changed) => {
      if (changed.includes('shortcuts')) this.#poll();
    });
    this.#poll();
  }

  isLive(url) {
    const channel = twitchChannel(url);
    return !!channel && this.live.has(channel);
  }

  async #poll() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#poll(), POLL_MS);
    this.timer.unref();
    const channels = [...new Set(Object.values(this.settings.get().shortcuts)
      .map((s) => twitchChannel(s?.url)).filter(Boolean))];
    if (this.playback.standby) return;
    let live = new Set();
    if (channels.length) {
      try {
        // Logins are checked by twitchChannel(), so they're safe in the query.
        const query = `query { ${channels.map((c, i) => `u${i}: user(login: "${c}") { stream { id } }`).join(' ')} }`;
        const res = await fetch(GQL, {
          method: 'POST',
          headers: { 'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        live = new Set(channels.filter((c, i) => data?.[`u${i}`]?.stream));
      } catch (e) {
        this.log.debug('Twitch live check failed:', e.message);
        return; // keep the last known state
      }
    }
    if ([...live].join() !== [...this.live].join()) {
      this.live = live;
      this.emit('change');
    }
  }
}
