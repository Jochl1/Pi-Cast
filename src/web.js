import path from 'node:path';
import express from 'express';
import { ROOT } from './config.js';
import { extractUrl } from './sources.js';
import { translator } from './shared/i18n.js';
import { iconPng, iconSvg } from './icons.js';

const ICON_SIZES = [180, 192, 512];

/** Web app + JSON API. Live state goes out over SSE at /api/events. */
export default function createWebServer({
  playback, controls, settings, recent, events, remoteKey, instagram, party, findPlace, getStatus, getTheme, log,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/shared', express.static(path.join(ROOT, 'src', 'shared')));

  const action = (fn) => async (req, res) => {
    try {
      const result = await fn(req.body ?? {}, req);
      res.json(result ?? { ok: true });
    } catch (e) {
      log.warn(`${req.method} ${req.path} failed:`, e.message);
      res.status(e.status ?? 500).json({ ok: false, error: e.message, ...(e.why && { why: e.why }) });
    }
  };

  const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

  app.get('/api/status', (req, res) => res.json(getStatus()));
  app.get('/api/events', events.handler());
  app.get('/api/recent', (req, res) => res.json(recent.list()));
  app.get('/api/settings', (req, res) => res.json(settings.get()));
  app.put('/api/settings', action((body) => settings.update(body)));

  // Used by the web app and the iOS "Send to Pi-Cast" Shortcut.
  app.post('/api/play', action(async ({ url, text }) => {
    const target = extractUrl(url ?? text);
    if (!target) throw badRequest('No link found');
    await playback.play(target, { owner: 'web' });
  }));

  // GET variant, for Shortcuts that open a URL instead of posting JSON.
  app.get('/share', async (req, res) => {
    const target = extractUrl([req.query.url, req.query.text].join(' '));
    if (!target) return res.redirect('/?error=' + encodeURIComponent('No link found'));
    try {
      await playback.play(target, { owner: 'web' });
      res.redirect('/');
    } catch (e) {
      res.redirect('/?error=' + encodeURIComponent(e.why ? translator(settings.get().language)(e.why) : e.message));
    }
  });

  app.post('/api/pause', action(() => controls.pause()));
  app.post('/api/resume', action(() => controls.resume()));
  app.post('/api/toggle', action(() => controls.toggle()));
  app.post('/api/stop', action(() => controls.stop()));

  app.post('/api/seek', action(({ position, offset }) => {
    if (typeof offset === 'number') return controls.seekBy(offset);
    if (!Number.isFinite(position)) throw badRequest('position or offset required');
    return controls.seek(position);
  }));

  app.post('/api/volume', action((body) => controls.setVolume(body)));

  // Same keys as the TV remote; handy for testing without HDMI-CEC.
  app.post('/api/tv/key', action(({ key }) => ({ ok: true, handled: remoteKey(String(key)) })));

  // Game night. Phones send their player token (from join) in X-Player; the
  // party's state arrives over SSE ('party'), each phone with its own view.
  // Never null: that's the TV remote, which may do what the host does.
  const player = (req) => req.get('X-Player') || '';
  app.post('/api/party/join', action(({ name, color }, req) => party.join(player(req), { name, color })));
  app.post('/api/party/leave', action((body, req) => party.leave(player(req))));
  app.post('/api/party/close', action((body, req) => party.closeBy(player(req))));
  app.post('/api/party/bot', action(({ id, level }, req) => (id ? party.setBot(player(req), id, level ?? null) : party.addBot(player(req), level))));
  app.post('/api/party/select', action(({ game }, req) => party.select(player(req), game)));
  app.post('/api/party/start', action((body, req) => party.start(player(req))));
  app.post('/api/party/end', action((body, req) => party.endGame(player(req))));
  app.post('/api/party/move', action(({ action: move }, req) => party.move(player(req), move)));
  app.post('/api/party/point', action(({ value }, req) => party.point(player(req), value)));

  // Instagram login. The outcome arrives over SSE ('instagram'), since a login
  // can wait minutes for the security code.
  app.get('/api/instagram', (req, res) => res.json(instagram.state));
  app.post('/api/instagram/login', action(({ username, password, sessionid }) => {
    const filled = (v) => typeof v === 'string' && v.trim().length > 0;
    if (filled(sessionid)) return instagram.login({ sessionid });
    if (!filled(username) || !filled(password)) throw badRequest('username and password required');
    return instagram.login({ username, password });
  }));
  app.post('/api/instagram/code', action(({ code }) => instagram.code(typeof code === 'string' ? code : null)));
  app.post('/api/instagram/logout', action(() => instagram.logout()));

  // Weather place: looked up by name; an empty name hides the weather.
  app.post('/api/weather/place', action(async ({ query }) => {
    const name = typeof query === 'string' ? query.trim() : '';
    const place = name ? await findPlace(name.slice(0, 100), settings.get().language) : null;
    if (name && !place) return { ok: false, notFound: true };
    await settings.update({ weatherPlace: place });
    return { ok: true, place };
  }));

  // Icons follow the current accent.
  const sendIcon = (size) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(await iconPng(getTheme(), size));
    } catch (e) {
      log.debug('icon render failed:', e.message);
      res.status(404).end();
    }
  };
  app.get('/apple-touch-icon.png', sendIcon(180));
  for (const size of ICON_SIZES) app.get(`/icons/${size}.png`, sendIcon(size));
  app.get('/icon.svg', (req, res) => {
    res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(iconSvg(getTheme(), 64));
  });

  app.get('/manifest.webmanifest', (req, res) => {
    const theme = getTheme();
    res.type('application/manifest+json').send({
      name: settings.get().deviceName,
      short_name: 'pi-cast',
      start_url: '/',
      display: 'standalone',
      background_color: theme.phone,
      theme_color: theme.phone,
      icons: ICON_SIZES.map((s) => ({ src: `/icons/${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
    });
  });

  return app;
}
