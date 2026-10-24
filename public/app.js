import { ACCENTS, TWITCH_QUALITIES, themeFor } from '/shared/theme.js';

const $ = (id) => document.getElementById(id);
const SOURCE_LABEL = { youtube: 'YouTube', twitch: 'Twitch', generic: 'Link' };

const state = {
  status: null,
  statusAt: 0, // when `status` arrived, for advancing the progress bar locally
  settings: null,
  connected: false,
  draggingVolume: false,
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
    toast(e.message === 'Failed to fetch' ? "Can't reach Pi-Cast" : e.message);
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
  es.addEventListener('recent', (e) => renderRecent(JSON.parse(e.data)));
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
  const name = state.settings?.deviceName ?? state.status?.deviceName ?? 'Pi-Cast';
  $('tv-name').textContent = state.connected ? name : `${name} · offline`;
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  renderPill();
  $('tv-code').textContent = s.pairingCode ?? '—';

  const active = !!s.url;
  let label = 'Nothing playing';
  if (active) {
    if (s.loading) label = 'Loading…';
    else if (s.paused) label = 'Paused';
    else label = s.live ? 'Live on TV' : 'Playing on TV';
  }
  $('state-label').textContent = label;
  $('stop').hidden = !active;
  $('title').textContent = active ? (s.title || s.url) : 'Ready to cast';

  const source = SOURCE_LABEL[s.kind] ?? '';
  const by = s.owner === 'cast' && s.senders.length ? `from ${s.senders[0]}` : '';
  $('sub').textContent = active
    ? [s.channel, source, by].filter(Boolean).join(' · ')
    : `Open YouTube and tap Cast → ${s.deviceName}`;

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
  play.setAttribute('aria-label', active && !s.paused ? 'Pause' : 'Play');
  play.disabled = !active;
  $('back').disabled = $('forward').disabled = !active || s.live;
  $('progress').classList.toggle('live', active && s.live);

  if (!state.draggingVolume) $('volume').value = s.volume;
  $('mute').classList.toggle('muted', s.muted);
  $('mute').setAttribute('aria-label', s.muted ? 'Unmute' : 'Mute');

  renderProgress();
}

function renderProgress() {
  const s = state.status;
  const active = !!s?.url;
  if (active && s.live) {
    $('elapsed').textContent = 'LIVE';
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

function renderRecent(items) {
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
    source.textContent = SOURCE_LABEL[item.kind] ?? 'Link';
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

  const quality = $('twitch-quality');
  quality.replaceChildren(...TWITCH_QUALITIES.map((q) => new Option(q === '1080p60' ? '1080p60 (may stutter)' : q, q)));
  quality.addEventListener('change', () => change({ twitchQuality: quality.value }));
}

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  applyTheme(s);
  renderPill();
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(s.accent === b.dataset.accent));
  $('custom-color').value = s.accent === 'custom' ? s.customAccent : themeFor(s).accent;
  for (const sw of document.querySelectorAll('.switch[data-setting]')) {
    sw.setAttribute('aria-pressed', String(!!s[sw.dataset.setting]));
  }
  if (document.activeElement !== $('device-name')) $('device-name').value = s.deviceName;
  $('twitch-quality').value = s.twitchQuality;
  $('twitch-quality-value').textContent = s.twitchQuality;
}

// ---------- Navigation ----------

function route() {
  const settings = location.hash === '#settings';
  $('remote').hidden = settings;
  $('settings').hidden = !settings;
  window.scrollTo(0, 0);
}

// ---------- Start ----------

buildSettings();
bindRemote();
window.addEventListener('hashchange', route);
route();
connect();

const error = new URLSearchParams(location.search).get('error');
if (error) {
  toast(error);
  history.replaceState(null, '', location.pathname + location.hash);
}
