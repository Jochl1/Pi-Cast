// Syntax-checks every .js file in src/ and public/ (no build step to catch typos).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = ['src', 'public']
  .flatMap((dir) => fs.readdirSync(dir, { recursive: true }).map((f) => `${dir}/${f}`))
  .filter((f) => f.endsWith('.js'));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`${files.length} files OK`);
