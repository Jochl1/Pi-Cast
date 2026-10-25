// YouTube's JS challenges for bin/ytdl.py, solved by one Node that stays running.
//
// yt-dlp starts a fresh Node for every video and hands it the whole
// preprocessed player (~4 MB), which takes 4-5 s on a Pi 3 just to compile.
// This keeps each player's compiled n/sig functions, so after the first video
// a challenge is a function call. One JSON message per line on stdin, one
// reply per line on stdout:
//   {"setup": "<yt-dlp's lib and core solver scripts>"}        no reply
//   {"key", "requests", "player"?, "preprocessed"?}           yt-dlp's jsc() output
// "player" comes only when this process hasn't seen the key yet; "preprocessed"
// says whether it already is (otherwise the reply carries the preprocessed one,
// for yt-dlp's cache). It runs with Node's permission model, like yt-dlp's Node.
import readline from 'node:readline';
import vm from 'node:vm';

// Players kept; YouTube rarely serves more than one at a time.
const KEEP = 2;
const players = new Map(); // key -> { n, sig }

function load(key, player, preprocessed) {
  let reply = {};
  if (!preprocessed) {
    reply = globalThis.jsc({ type: 'player', player, requests: [], output_preprocessed: true });
    if (reply.type === 'error') throw new Error(reply.error);
    player = reply.preprocessed_player;
  }
  // The same as jsc() does with a preprocessed player.
  const fns = { n: null, sig: null };
  Function('_result', player)(fns);
  players.set(key, fns);
  if (players.size > KEEP) players.delete(players.keys().next().value);
  return reply.preprocessed_player;
}

function solve({ key, requests, player, preprocessed }) {
  const preprocessedPlayer = player ? load(key, player, preprocessed) : undefined;
  const fns = players.get(key);
  if (!fns) return { type: 'error', error: 'unknown player' };
  const responses = requests.map(({ type, challenges }) => {
    const fn = fns[type];
    if (!fn) return { type: 'error', error: `Failed to extract ${type} function` };
    try {
      return { type: 'result', data: Object.fromEntries(challenges.map((c) => [c, fn(c)])) };
    } catch (e) {
      return { type: 'error', error: e instanceof Error ? `${e.message}\n${e.stack}` : `${e}` };
    }
  });
  return { type: 'result', responses, ...(preprocessedPlayer && { preprocessed_player: preprocessedPlayer }) };
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.setup) {
    vm.runInThisContext(`${msg.setup}\nglobalThis.jsc = jsc;`);
    return;
  }
  let reply;
  try {
    reply = solve(msg);
  } catch (e) {
    reply = { type: 'error', error: e instanceof Error ? e.message : `${e}` };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
});
