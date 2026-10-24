// Builds the Plymouth boot splash from the current settings into data/plymouth/.
// Used by deploy/install.sh; the app rebuilds it itself when the look changes.
import path from 'node:path';
import { DATA_DIR } from '../src/config.js';
import Settings from '../src/settings.js';
import { buildSplash, SPLASH_DIR } from '../src/boot.js';

const settings = new Settings(path.join(DATA_DIR, 'settings.json'));
await buildSplash(settings.get(), process.argv[2] ?? SPLASH_DIR);
console.log('boot splash written to', process.argv[2] ?? SPLASH_DIR);
