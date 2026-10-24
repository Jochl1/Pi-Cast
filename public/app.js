import { ACCENTS, KEY_COLORS, TWITCH_QUALITIES, themeFor } from '/shared/theme.js';
import { LANGUAGES, translator } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
const SOURCE_LABEL = { youtube: 'YouTube', twitch: 'Twitch', instagram: 'Instagram' };
const sourceLabel = (kind) => SOURCE_LABEL[kind] ?? tr('link');
// Texts in the language setting's language (see /shared/i18n.js).
let tr = translator('en');

const state = {
  status: null,
  statusAt: 0, // when `status` arrived, for advancing the progress bar locally
  settings: null,
  connected: false,
  draggingVolume: false,
  recent: [],
  instagram: null,
};

// ---------- API ----------

async function api(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  } catch (e) {
    toast(e.message === 'Failed to fetch' ? tr('cantReach') : e.message);
    throw e;
  }
}
const post = (path, body) => api('POST', path, body).catch(() => {});

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Live updates ----------

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => setConnected(true));
  es.addEventListener('error', () => setConnected(false)); // EventSource reconnects by itself
  es.addEventListener('status', (e) => {
    state.status = JSON.parse(e.data);
    state.statusAt = performance.now();
    renderStatus();
  });
  es.addEventListener('settings', (e) => {
    state.settings = JSON.parse(e.data);
    renderSettings();
  });
  es.addEventListener('recent', (e) => {
    state.recent = JSON.parse(e.data);
    renderRecent();
  });
  es.addEventListener('instagram', (e) => {
    const before = state.instagram;
    state.instagram = JSON.parse(e.data);
    // A login that just failed.
    if (before?.busy && !state.instagram.busy && state.instagram.error) toast(tr(`igErr_${state.instagram.error}`));
    renderInstagram();
  });
}

function setConnected(on) {
  state.connected = on;
  $('tv-pill').classList.toggle('offline', !on);
  renderPill();
}

// ---------- Theme ----------

function applyTheme(settings) {
  const t = themeFor(settings);
  const root = document.documentElement.style;
  root.setProperty('--bg', t.phone);
  root.setProperty('--text', t.text);
  root.setProperty('--muted', t.muted);
  root.setProperty('--surface', t.surface);
  root.setProperty('--line', t.line);
  root.setProperty('--dim', t.dim);
  root.setProperty('--accent', t.accent);
  root.setProperty('--radius', `${t.radius}px`);
  root.setProperty('--small', `${t.small}px`);
  root.setProperty('--pill', `${t.pill}px`);
  document.querySelector('meta[name="theme-color"]').content = t.phone;
}

// ---------- Remote ----------

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function renderPill() {
  const name = state.settings?.deviceName ?? state.status?.deviceName ?? 'pi-cast';
  $('tv-name').textContent = state.connected ? name : tr('deviceOffline', { name });
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  renderPill();
  $('tv-code').textContent = s.pairingCode ?? '—';

  const active = !!s.url;
  let label = tr('nothingPlaying');
  if (active) {
    if (s.loading) label = tr('loadingState');
    else if (s.paused) label = tr('pausedState');
    else label = tr(s.live ? 'liveOnTv' : 'playingOnTv');
  }
  $('state-label').textContent = label;
  $('stop').hidden = !active;
  $('title').textContent = active ? (s.title || s.url) : tr('readyToCast');

  const source = active ? sourceLabel(s.kind) : '';
  const by = s.owner === 'cast' && s.senders.length ? tr('from', { name: s.senders[0] }) : '';
  $('sub').textContent = active
    ? [s.channel, source, by].filter(Boolean).join(' · ')
    : tr('webCastHint', { name: s.deviceName });

  const img = $('thumb-img');
  if (active && s.thumbnail) {
    // Twitch previews change while live; refresh them once a minute.
    const src = s.live ? `${s.thumbnail}?t=${Math.floor(Date.now() / 60000)}` : s.thumbnail;
    if (img.getAttribute('src') !== src) {
      img.hidden = true;
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = src;
    }
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }
  $('thumb').classList.toggle('loading', active && s.loading);

  const play = $('play');
  play.classList.toggle('paused', !active || s.paused);
  play.setAttribute('aria-label', tr(active && !s.paused ? 'pause' : 'play'));
  play.disabled = !active;
  $('back').disabled = $('forward').disabled = !active || s.live;
  $('progress').classList.toggle('live', active && s.live);

  if (!state.draggingVolume) $('volume').value = s.volume;
  $('mute').classList.toggle('muted', s.muted);
  $('mute').setAttribute('aria-label', tr(s.muted ? 'unmute' : 'mute'));

  renderProgress();
}

function renderProgress() {
  const s = state.status;
  const active = !!s?.url;
  if (active && s.live) {
    $('elapsed').textContent = tr('live');
    $('total').textContent = '';
    return;
  }
  let pos = s?.position ?? 0;
  const dur = s?.duration ?? 0;
  if (active && !s.paused && !s.loading) pos += (performance.now() - state.statusAt) / 1000;
  if (dur) pos = Math.min(pos, dur);
  $('elapsed').textContent = fmtTime(active ? pos : 0);
  $('total').textContent = fmtTime(active ? dur : 0);
  $('progress-fill').style.width = active && dur ? `${(pos / dur) * 100}%` : '0';
}

function renderRecent() {
  const items = state.recent;
  const list = $('recent-list');
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const thumb = document.createElement('span');
    thumb.className = 'r-thumb';
    if (item.thumbnail) thumb.style.backgroundImage = `url("${item.thumbnail.replace(/"/g, '%22')}")`;
    const title = document.createElement('span');
    title.className = 'r-title';
    title.textContent = item.title || item.url;
    const source = document.createElement('span');
    source.className = 'r-source';
    source.textContent = sourceLabel(item.kind);
    btn.append(thumb, title, source);
    btn.addEventListener('click', () => post('/api/play', { url: item.url }));
    li.append(btn);
    return li;
  }));
  $('recent-empty').hidden = items.length > 0;
}

function bindRemote() {
  $('play').addEventListener('click', () => {
    const paused = state.status?.paused;
    // Flip right away; the next status update confirms it.
    if (state.status) state.status.paused = !paused;
    renderStatus();
    post(paused ? '/api/resume' : '/api/pause');
  });
  $('back').addEventListener('click', () => post('/api/seek', { offset: -10 }));
  $('forward').addEventListener('click', () => post('/api/seek', { offset: 10 }));
  $('stop').addEventListener('click', () => post('/api/stop'));
  $('mute').addEventListener('click', () => post('/api/volume', { muted: !state.status?.muted }));

  // Volume: send at most every 200 ms while dragging, and the final value on release.
  const vol = $('volume');
  let volTimer = null;
  const sendVolume = () => {
    volTimer = null;
    post('/api/volume', { level: Number(vol.value), muted: false });
  };
  vol.addEventListener('input', () => {
    state.draggingVolume = true;
    volTimer ??= setTimeout(sendVolume, 200);
  });
  vol.addEventListener('change', () => {
    clearTimeout(volTimer);
    sendVolume();
    setTimeout(() => { state.draggingVolume = false; }, 500);
  });

  $('play-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('link');
    const url = input.value.trim();
    if (!url) return;
    input.blur();
    try {
      await api('POST', '/api/play', { url });
      input.value = '';
    } catch { /* toast shown */ }
  });

  setInterval(renderProgress, 500);
}

// ---------- Settings ----------

async function change(patch) {
  const before = state.settings;
  state.settings = { ...state.settings, ...patch };
  renderSettings();
  try {
    state.settings = await api('PUT', '/api/settings', patch);
  } catch {
    state.settings = before;
  }
  renderSettings();
}

function buildSettings() {
  $('swatches').replaceChildren(...Object.entries(ACCENTS).map(([id, a]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.accent = id;
    b.style.background = a.hex;
    b.setAttribute('aria-label', a.label);
    b.addEventListener('click', () => change({ accent: id }));
    return b;
  }));

  // Color pickers fire 'input' continuously; only save the final pick.
  $('custom-color').addEventListener('change', (e) => change({ accent: 'custom', customAccent: e.target.value.toUpperCase() }));

  for (const sw of document.querySelectorAll('.switch[data-setting]')) {
    sw.addEventListener('click', () => change({ [sw.dataset.setting]: !state.settings?.[sw.dataset.setting] }));
  }

  const name = $('device-name');
  const saveName = () => {
    const value = name.value.trim();
    if (!value) name.value = state.settings.deviceName;
    else if (value !== state.settings.deviceName) change({ deviceName: value });
  };
  name.addEventListener('change', saveName);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

  $('twitch-quality').addEventListener('change', (e) => change({ twitchQuality: e.target.value }));

  $('shortcuts').replaceChildren(...Object.entries(KEY_COLORS).map(([color, hex]) => {
    const row = document.createElement('div');
    row.className = 'shortcut';
    row.dataset.color = color;
    const dot = document.createElement('span');
    dot.className = 'key-dot';
    dot.style.background = hex;
    const fields = document.createElement('div');
    fields.className = 'shortcut-fields';
    const name = document.createElement('input');
    name.className = 'sc-name';
    name.type = 'text';
    name.maxLength = 30;
    name.dataset.i18nPlaceholder = 'shortcutName';
    const url = document.createElement('input');
    url.className = 'sc-url';
    url.type = 'url';
    url.inputMode = 'url';
    url.autocapitalize = 'off';
    url.spellcheck = false;
    url.dataset.i18nPlaceholder = 'shortcutLink';
    for (const input of [name, url]) {
      input.autocomplete = 'off';
      input.enterKeyHint = 'done';
      input.addEventListener('change', () => saveShortcut(color, name.value, url.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    }
    fields.append(name, url);
    row.append(dot, fields);
    return row;
  }));

  const language = $('language');
  language.replaceChildren(...Object.entries(LANGUAGES).map(([id, l]) => new Option(l.label, id)));
  language.addEventListener('change', () => change({ language: language.value }));
}

/** A readable default name for a link: the Twitch channel, else the site. */
function nameFor(link) {
  try {
    const u = new URL(link);
    const channel = /(^|\.)twitch\.tv$/.test(u.hostname) && u.pathname.split('/')[1];
    if (channel) return channel[0].toUpperCase() + channel.slice(1);
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) return 'YouTube';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function saveShortcut(color, name, link) {
  link = link.trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  const shortcut = link ? { name: (name.trim() || nameFor(link)).slice(0, 30), url: link } : null;
  change({ shortcuts: { ...state.settings.shortcuts, [color]: shortcut } });
}

/** Puts every fixed text in the current language; the rest is rendered with tr(). */
function applyLanguage(lang) {
  if (tr.lang === lang && document.documentElement.dataset.lang) return;
  tr = translator(lang);
  document.documentElement.lang = tr.lang;
  document.documentElement.dataset.lang = tr.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', tr(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = tr(el.dataset.i18nPlaceholder);
  $('twitch-quality').replaceChildren(...TWITCH_QUALITIES.map((q) => new Option(q === '1080p60' ? `1080p60 ${tr('mayStutter')}` : q, q)));
  renderStatus();
  renderRecent();
  renderInstagram();
}

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  applyTheme(s);
  applyLanguage(s.language);
  renderPill();
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(s.accent === b.dataset.accent));
  $('custom-color').value = s.accent === 'custom' ? s.customAccent : themeFor(s).accent;
  for (const sw of document.querySelectorAll('.switch[data-setting]')) {
    sw.setAttribute('aria-pressed', String(!!s[sw.dataset.setting]));
  }
  if (document.activeElement !== $('device-name')) $('device-name').value = s.deviceName;
  $('twitch-quality').value = s.twitchQuality;
  $('twitch-quality-value').textContent = s.twitchQuality;
  for (const row of $('shortcuts').children) {
    const sc = s.shortcuts?.[row.dataset.color];
    const [name, url] = row.querySelectorAll('input');
    if (document.activeElement !== name) name.value = sc?.name ?? '';
    if (document.activeElement !== url) url.value = sc?.url ?? '';
  }
  $('language').value = s.language;
  $('language-value').textContent = LANGUAGES[s.language]?.label ?? s.language;
}

// ---------- Instagram ----------

function renderInstagram() {
  const ig = state.instagram;
  if (!ig) return;
  const loggedIn = !!ig.user;
  $('ig-login').hidden = loggedIn || !!ig.code || !ig.available;
  $('ig-session').hidden = $('ig-login').hidden;
  $('ig-session-btn').disabled = ig.busy;
  $('ig-code').hidden = !ig.code;
  $('ig-account').hidden = !loggedIn;
  $('ig-user').textContent = loggedIn ? `@${ig.user}` : '';
  const btn = $('ig-login-btn');
  btn.disabled = ig.busy;
  btn.textContent = tr(ig.busy ? 'igLoggingIn' : 'igLogin');
  let hint = tr('igHint');
  if (!ig.available) hint = tr('igUnavailable');
  else if (ig.code) hint = tr({ email: 'igCodeEmail', sms: 'igCodeSms' }[ig.code] ?? 'igCode2fa');
  else if (loggedIn) hint = tr('igTvHint');
  $('ig-hint').textContent = hint;
}

function bindInstagram() {
  $('ig-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('ig-username').value.trim();
    const password = $('ig-password').value;
    if (!username || !password) return;
    document.activeElement?.blur();
    try {
      await api('POST', '/api/instagram/login', { username, password });
      $('ig-password').value = '';
    } catch { /* toast shown */ }
  });
  $('ig-session-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sessionid = $('ig-sessionid').value.trim();
    if (!sessionid) return;
    document.activeElement?.blur();
    try {
      await api('POST', '/api/instagram/login', { sessionid });
      $('ig-sessionid').value = '';
    } catch { /* toast shown */ }
  });
  $('ig-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('ig-code-input').value.replace(/\s/g, '');
    if (!code) return;
    document.activeElement?.blur();
    $('ig-code-input').value = '';
    post('/api/instagram/code', { code });
  });
  $('ig-code-cancel').addEventListener('click', () => post('/api/instagram/code', { code: null }));
  $('ig-logout').addEventListener('click', () => post('/api/instagram/logout'));
}

// ---------- Navigation ----------

// #instagram (the TV's QR code for logging in) is a section of the settings.
function route() {
  const section = location.hash === '#instagram' ? $('instagram') : null;
  const settings = location.hash === '#settings' || !!section;
  $('remote').hidden = settings;
  $('settings').hidden = !settings;
  if (section) section.scrollIntoView();
  else window.scrollTo(0, 0);
}

// ---------- Start ----------

buildSettings();
bindRemote();
bindInstagram();
window.addEventListener('hashchange', route);
route();
connect();

const error = new URLSearchParams(location.search).get('error');
if (error) {
  toast(error);
  history.replaceState(null, '', location.pathname + location.hash);
}
