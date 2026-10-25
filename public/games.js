import { PLAYER_COLORS } from '/shared/theme.js';

// Game night on the phone (#games): join with a name and colour, the lobby
// (the host adds pi·cast, picks and starts a game) and the controllers.
// The server's party state arrives over SSE as 'party' (see games/party.js).

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'picast-player';
const C4_COLS = 7;

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.filter((c) => c != null && c !== false));
  return e;
}

export function playerToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function saveToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: this tab only */ }
}

/**
 * `api(method, path, body)` posts with the player token; `getTr()` is the
 * current translator; `reconnect()` reopens the event stream after joining,
 * so the server knows who this phone is.
 */
export function createGames({ api, getTr, reconnect }) {
  let view = null;
  let pickedColor = null;
  let column = null; // Vier gewinnt: the column tapped, before "Drop"

  const post = (path, body) => api('POST', path, body).catch(() => {});

  // --- Join ---

  function renderSwatches() {
    const taken = new Set((view?.players ?? []).map((p) => p.color));
    pickedColor ??= PLAYER_COLORS.find((c) => !taken.has(c));
    $('g-colors').replaceChildren(...PLAYER_COLORS.map((c) => el('button', {
      type: 'button', class: 'swatch', style: { background: c }, 'aria-pressed': String(c === pickedColor),
      disabled: taken.has(c), 'aria-label': c, onclick: () => { pickedColor = c; renderSwatches(); },
    })));
  }

  $('g-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('g-name').value.trim();
    if (!name) { $('g-name').focus(); return; }
    document.activeElement?.blur();
    try {
      const res = await api('POST', '/api/party/join', { name, color: pickedColor });
      saveToken(res.token);
      try { localStorage.setItem('picast-name', name); } catch { /* fine */ }
      reconnect();
    } catch { /* toast shown */ }
  });
  try { $('g-name').value = localStorage.getItem('picast-name') ?? ''; } catch { /* fine */ }

  // --- Lobby ---

  function avatar(p) {
    if (p.bot) return el('span', { class: 'avatar bot' }, 'pi·');
    return el('span', { class: 'avatar', style: { background: p.color } }, [...p.name][0]?.toUpperCase() ?? '?');
  }

  function renderLobby(tr) {
    const me = view.me;
    const host = view.players.find((p) => p.id === view.hostId);
    $('g-players').replaceChildren(...view.players.map((p) => {
      let sub = p.id === me.id ? tr('gamesYou') : '';
      if (p.id === view.hostId) sub = [sub, tr('gamesHost')].filter(Boolean).join(' · ');
      const row = el('div', { class: 'player' }, avatar(p), el('div', { class: 'p-name' }, p.name, el('small', {}, sub || ' ')));
      if (p.bot) {
        const level = el('select', { class: 'level', 'aria-label': tr('gamesLevel', { n: '' }), disabled: !me.host },
          ...[1, 2, 3, 4, 5].map((n) => new Option(tr('gamesLevel', { n }), n)));
        level.value = String(p.bot);
        level.addEventListener('change', () => post('/api/party/bot', { id: p.id, level: Number(level.value) }));
        row.append(level);
        if (me.host) row.append(el('button', { type: 'button', class: 'text-btn', onclick: () => post('/api/party/bot', { id: p.id }) }, tr('gamesRemove')));
      }
      return row;
    }));
    $('g-add-bot').hidden = !me.host || view.players.length >= 6;
    $('g-list').replaceChildren(...view.games.map((g) => el('button', {
      type: 'button', class: 'game', 'aria-pressed': String(g.id === view.selected), disabled: !me.host,
      onclick: () => post('/api/party/select', { game: g.id }),
    }, tr(`game_${g.id}`), el('small', {}, g.min === g.max ? tr('gamesPlayers', { n: g.max }) : tr('gamesPlayersRange', { min: g.min, max: g.max })))));
    $('g-start').hidden = !me.host;
    $('g-start').textContent = tr('gamesStartGame', { game: tr(`game_${view.selected}`) });
    $('g-wait').hidden = me.host;
    $('g-wait').textContent = tr('gamesWaitHost', { name: host?.name ?? '' });
    $('g-close').hidden = !me.host;
  }

  // --- Playing ---

  function renderPlay(tr) {
    const g = view.game;
    const s = g.state;
    const seat = g.seats.indexOf(view.me.id);
    const players = g.seats.map((id) => view.players.find((p) => p.id === id) ?? { name: '?', color: '#888' });
    const mine = seat >= 0 && g.turn === seat;
    if (!mine) column = null;

    let status;
    if (s.over) status = s.winner == null ? tr('gamesDraw') : s.winner === seat ? tr('gamesYouWon') : tr('gamesWinner', { name: players[s.winner].name });
    else if (seat < 0) status = tr('gamesWatching');
    else status = mine ? tr('gamesYourTurn') : tr('gamesTheirTurn', { name: players[g.turn].name });
    const dot = seat >= 0 ? el('span', { class: 'dot', style: { background: players[seat].color } }) : null;
    $('g-status').replaceChildren(...[dot, status].filter(Boolean));
    $('g-status').classList.toggle('mine', mine);
    $('g-title').textContent = tr(`game_${g.id}`);

    const board = $('g-board');
    board.className = `board-${g.id}`;
    if (g.id === 'connect4') {
      board.replaceChildren(...s.cells.map((c, i) => el('button', {
        type: 'button', class: `cell${c != null ? ' filled' : ''}${column === i % C4_COLS ? ' col' : ''}`,
        style: c != null ? { background: players[c].color } : {}, disabled: !mine, 'aria-label': String((i % C4_COLS) + 1),
        onclick: () => {
          column = i % C4_COLS;
          post('/api/party/point', { value: column });
          renderPlay(tr);
        },
      })));
      $('g-hint').textContent = mine ? tr('gamesC4Hint') : '';
      $('g-act').hidden = !mine;
      $('g-act').disabled = column == null;
      $('g-act').textContent = tr('gamesDrop');
      $('g-act').onclick = () => {
        if (column == null) return;
        const col = column;
        column = null;
        post('/api/party/move', { action: { col } });
      };
    } else if (g.id === 'tictactoe') {
      board.replaceChildren(...s.cells.map((c, i) => el('button', {
        type: 'button', class: 'cell', disabled: !mine || c != null, 'aria-label': String(i + 1),
        onclick: () => post('/api/party/move', { action: { cell: i } }),
      }, c == null ? null : el('span', { class: c === 0 ? 'mark-x' : 'mark-o', style: { '--c': players[c].color } }))));
      $('g-hint').textContent = mine ? tr('gamesTttHint') : '';
      $('g-act').hidden = true;
    }

    const wins = view.wins[g.id] ?? {};
    $('g-score').replaceChildren(...players.map((p) => el('div', { class: 'score' },
      el('span', { class: 'dot', style: { background: p.color } }), p.name, el('b', {}, String(wins[p.id] ?? 0)))));
    $('g-again').hidden = !(s.over && view.me.host);
    $('g-again').textContent = tr('gamesAgain');
    $('g-end').hidden = !view.me.host;
    $('g-end').textContent = tr(s.over ? 'gamesBackToLobby' : 'gamesEnd');
  }

  // --- Buttons that don't change ---
  $('g-add-bot').addEventListener('click', () => post('/api/party/bot', {}));
  $('g-start').addEventListener('click', () => post('/api/party/start'));
  $('g-again').addEventListener('click', () => post('/api/party/start'));
  $('g-end').addEventListener('click', () => post('/api/party/end'));
  $('g-close').addEventListener('click', () => post('/api/party/close'));
  $('g-leave').addEventListener('click', async () => {
    await post('/api/party/leave');
    saveToken('');
    reconnect();
  });

  function render() {
    if (!view) return;
    const tr = getTr();
    const joined = !!view.me;
    $('g-join').hidden = joined;
    $('g-lobby').hidden = !joined || !!view.game;
    $('g-play').hidden = !joined || !view.game;
    $('g-leave').hidden = !joined;
    if (!view.game) $('g-title').textContent = tr('gamesNight');
    if (!joined) renderSwatches();
    else if (view.game) renderPlay(tr);
    else renderLobby(tr);
  }

  return {
    /** The party state from the server. */
    update(v) {
      // Our token is stale (the game night was closed or we left): forget it.
      if (!v.me && playerToken()) saveToken('');
      view = v;
      render();
    },
    render,
  };
}
