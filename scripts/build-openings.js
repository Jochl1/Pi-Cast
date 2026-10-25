// Builds src/games/openings.json, the opening names for chess on game night,
// from lichess's chess-openings data (CC0, https://github.com/lichess-org/chess-openings):
//   node scripts/build-openings.js <dir with a.tsv … e.tsv>
// Keyed by position (FEN without the move counters), so a move order that
// transposes into a known opening still finds its name.
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';

const [dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: node scripts/build-openings.js <dir with a.tsv … e.tsv>');
const names = {};
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const rows = fs.readFileSync(path.join(dir, `${file}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const game = new Chess();
    for (const san of pgn.split(/\s+/).filter((t) => !/^\d+\.$/.test(t))) game.move(san);
    const key = game.fen().split(' ').slice(0, 4).join(' ');
    names[key] ??= `${eco} ${name}`;
  }
}
fs.writeFileSync('src/games/openings.json', `${JSON.stringify(names, null, 0)}\n`);
console.log(`${Object.keys(names).length} openings`);
