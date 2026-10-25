import { EventEmitter } from 'node:events';
import { youtubeId } from './metadata.js';

// YouTube's own web API (no key): the watch page's data has a continuation
// for the comments, and one more request returns the top 20.
const NEXT = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
const CLIENT = { clientName: 'WEB', clientVersion: '2.20251020.00.00' };
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const PREFETCH_MS = 8000;

function* walk(o) {
  if (!o || typeof o !== 'object') return;
  yield o;
  for (const v of Object.values(o)) yield* walk(v);
}

async function next(body, hl) {
  const res = await fetch(NEXT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ context: { client: { ...CLIENT, hl, gl: 'DE' } }, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The top comments of video `id`: [{ author, text, likes, ago }] (likes and ago as YouTube writes them). */
export async function fetchComments(id, hl = 'en') {
  const page = await next({ videoId: id }, hl);
  let token = null;
  for (const o of walk(page)) {
    const section = o.itemSectionRenderer;
    if (section?.sectionIdentifier === 'comment-item-section') {
      token = section.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    }
  }
  if (!token) return []; // comments are off, or a live stream
  const list = [];
  for (const o of walk(await next({ continuation: token }, hl))) {
    const p = o.commentEntityPayload;
    if (!p?.properties?.content?.content) continue;
    list.push({
      author: p.author?.displayName ?? '',
      text: p.properties.content.content,
      likes: p.toolbar?.likeCountNotliked?.trim() || '',
      ago: p.properties.publishedTime ?? '',
    });
  }
  return list;
}

/**
 * The comment card over a YouTube video (▼): one comment at a time, ▼ and ▲
 * step through them, Back closes. Fetched a few seconds into each video
 * (or when the card opens) and kept for it.
 *
 * Events: 'change', 'empty' (the video has no comments to show)
 */
export default class YtComments extends EventEmitter {
  constructor({ playback, settings, sounds, log }) {
    super();
    Object.assign(this, { playback, settings, sounds, log });
    this.open = false;
    this.index = 0;
    this.videoId = null;
    this.list = null; // null while loading
    this.pending = null;
    playback.on('change', () => {
      if (this.open && youtubeId(playback.source?.url ?? '') !== this.videoId) this.close();
    });
    // Fetched a little after the first frame, so ▼ shows them at once; not
    // during the start, which needs the CPU.
    playback.on('started', () => {
      const s = playback.source;
      if (s?.kind !== 'youtube' || s.live) return;
      setTimeout(() => {
        if (playback.source === s) this.#load(youtubeId(s.url));
      }, PREFETCH_MS);
    });
  }

  /** The comment shown now, or null while loading. */
  get current() {
    return this.list?.[this.index] ?? null;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('change');
  }

  /** Remote keys over a YouTube video; true if used. */
  key(k) {
    const s = this.playback.source;
    if (s?.kind !== 'youtube' || s.live) return false;
    if (!this.open) {
      if (k !== 'down') return false;
      this.#show(youtubeId(s.url));
      return true;
    }
    if (k === 'back' || k === 'stop') {
      this.sounds.play('close');
      this.close();
      return true;
    }
    if (k !== 'down' && k !== 'up') return false;
    const n = this.list?.length ?? 0;
    const i = this.index + (k === 'down' ? 1 : -1);
    // ▲ on the first one closes the card.
    if (i < 0) {
      this.close();
      return true;
    }
    if (i < n) {
      this.index = i;
      this.sounds.play('move');
      this.emit('change');
    }
    return true;
  }

  /** Fetches the comments of `id` once; a second call while it runs waits for the same one. */
  #load(id) {
    if (id === this.videoId && this.pending) return this.pending;
    if (id === this.videoId && this.list) return Promise.resolve();
    this.videoId = id;
    this.list = null;
    this.index = 0;
    this.pending = fetchComments(id, this.settings.get().language).then((list) => {
      if (this.videoId === id) this.list = list;
    }, (e) => {
      this.log.warn('YouTube comments failed:', e.message);
      if (this.videoId !== id) return;
      this.videoId = null; // try again next time
      this.list = [];
    }).finally(() => {
      if (this.videoId === id || this.videoId === null) this.pending = null;
    });
    return this.pending;
  }

  async #show(id) {
    this.open = true;
    this.sounds.play('open');
    this.emit('change');
    await this.#load(id);
    if (!this.open) return;
    if (this.list && !this.list.length) {
      this.open = false;
      this.emit('empty');
    }
    this.emit('change');
  }
}
