import fs from 'node:fs';
import path from 'node:path';
import { DataStore } from 'yt-cast-receiver';

/**
 * Persists the cast receiver's session data (screen IDs, lounge tokens) in a
 * JSON file. Replaces the library's node-persist store, which writes before
 * it has finished initialising and drops the first values.
 */
export default class ReceiverStore extends DataStore {
  constructor(file) {
    super();
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  async get(key) {
    return this.data[key] ?? null;
  }

  async set(key, value) {
    this.data[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.promises.rename(tmp, this.file);
  }

  async clear() {
    this.data = {};
    await fs.promises.rm(this.file, { force: true });
  }
}
