import path from 'node:path';
import express from 'express';
import { ROOT } from './config.js';
import { extractUrl } from './sources.js';

/**
 * Web UI + JSON API. While a YouTube-app cast session owns playback,
 * controls go through the cast player so the phone stays in sync.
 */
export default function createWebServer({ playback, castPlayer, mpv, receiver, getPairingCode, log }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));

  const isCast = () => playback.owner === 'cast';

  const action = (fn) => async (req, res) => {
    try {
      await fn(req.body ?? {}, req);
      res.json({ ok: true });
    } catch (e) {
      log.warn(`${req.method} ${req.path} failed:`, e.message);
      res.status(e.status ?? 500).json({ ok: false, error: e.message });
    }
  };

  const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

  app.get('/api/status', (req, res) => {
    res.json({
      ...playback.status(),
      pairingCode: getPairingCode(),
      senders: receiver.getConnectedSenders().map((s) => s.name),
    });
  });

  app.post('/api/play', action(async ({ url, text }) => {
    const target = extractUrl(url ?? text);
    if (!target) throw badRequest('No URL found');
    await playback.play(target, { owner: 'web' });
  }));

  // Android share target (see public/manifest.webmanifest).
  app.get('/share', async (req, res) => {
    const target = extractUrl([req.query.url, req.query.text, req.query.title].join(' '));
    if (!target) return res.redirect('/?error=' + encodeURIComponent('No URL in shared content'));
    try {
      await playback.play(target, { owner: 'web' });
      res.redirect('/');
    } catch (e) {
      res.redirect('/?error=' + encodeURIComponent(e.message));
    }
  });

  app.post('/api/pause', action(() => (isCast() ? castPlayer.pause() : mpv.pause())));
  app.post('/api/resume', action(() => (isCast() ? castPlayer.resume() : mpv.resume())));
  app.post('/api/stop', action(() => (isCast() ? castPlayer.stop() : playback.stop())));

  app.post('/api/seek', action(({ position, offset }) => {
    const target = typeof offset === 'number'
      ? Math.max(0, (mpv.props['time-pos'] ?? 0) + offset)
      : Number(position);
    if (!Number.isFinite(target)) throw badRequest('position or offset required');
    return isCast() ? castPlayer.seek(target) : mpv.seek(target);
  }));

  app.post('/api/volume', action(({ level, muted }) => {
    const volume = {
      level: typeof level === 'number' ? level : Math.round(mpv.props.volume ?? 100),
      muted: typeof muted === 'boolean' ? muted : !!mpv.props.mute,
    };
    return isCast()
      ? castPlayer.setVolume(volume)
      : Promise.all([mpv.setVolume(volume.level), mpv.setMute(volume.muted)]);
  }));

  return app;
}
