import fs from 'node:fs';
import path from 'node:path';

const MAX = 20;

/** "Recent" list for the web app, newest first, stored in data/recent.json. */
export default class Recent {
  constructor(file) {
    this.file = file;
    try {
      this.items = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  list() {
    return this.items;
  }

  /** Adds or refreshes an entry: { url, kind, title, channel, thumbnail }. */
  async add(entry) {
    this.items = [
      { ...entry, at: Date.now() },
      ...this.items.filter((i) => i.url !== entry.url),
    ].slice(0, MAX);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.items, null, 2));
    await fs.promises.rename(tmp, this.file);
  }
}
