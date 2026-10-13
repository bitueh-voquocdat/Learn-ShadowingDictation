export const RECORDING_TTL = 30 * 86400000;
export function pruneRecordings(value, now = Date.now()) {
  value.recordings ||= {};
  let changed = false;
  for (const [key, recording] of Object.entries(value.recordings)) {
    const createdAt = Number.isFinite(recording?.createdAt) && recording.createdAt > 0
      ? Math.min(recording.createdAt, now) : now;
    if (!recording || createdAt + RECORDING_TTL <= now) {
      delete value.recordings[key]; changed = true; continue;
    }
    if (recording.createdAt !== createdAt || recording.expiresAt !== createdAt + RECORDING_TTL) changed = true;
    recording.createdAt = createdAt; recording.expiresAt = createdAt + RECORDING_TTL;
  }
  return changed;
}
export class MediaStore {
  constructor({now = () => Date.now(), database} = {}) {
    this.memory = new Map(); this.legacy = new Map(); this.now = now;
    this.ready = database !== undefined ? Promise.resolve(database) :
      typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise(resolve => {
        const request = indexedDB.open('shadowlab-media-v3', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('assets');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null); request.onblocked = () => resolve(null);
      });
  }
  async get(key) {
    if (this.memory.has(key)) {
      const value = this.memory.get(key);
      if (pruneRecordings(value, this.now())) await this.put(key, value);
      return value;
    }
    const db = await this.ready;
    if (!db) return null;
    const value = await new Promise(resolve => {
      const request = db.transaction('assets').objectStore('assets').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    if (!value) return null;
    // Keep an old model/source backup until Firebase confirms its migration.
    if (value.source || Object.keys(value.tts || {}).length || Object.keys(value.full || {}).length)
      this.legacy.set(key, {tts: value.tts || {}, full: value.full || {}, source: value.source || null});
    else value._partial = true; // A recordings-only disk row must not erase remote audio references.
    this.memory.set(key, value);
    if (pruneRecordings(value, this.now())) await this.put(key, value);
    return value;
  }
  async put(key, value) {
    pruneRecordings(value, this.now()); this.memory.set(key, value);
    const db = await this.ready;
    if (!db) return;
    // New persistent data is recordings only. Models/source audio live in RAM and Firebase.
    const local = {...(this.legacy.get(key) || {}), recordings: value.recordings || {}};
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      transaction.objectStore('assets').put(local, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(Error('Chưa lưu được bản ghi âm trên máy.'));
      transaction.onabort = transaction.onerror;
    });
  }
  async confirmCloud(key) {
    this.legacy.delete(key);
    const value = this.memory.get(key);
    if (value) await this.put(key, value);
  }
  async pruneExpired() {
    for (const [key, value] of this.memory)
      if (pruneRecordings(value, this.now())) await this.put(key, value);
    const db = await this.ready;
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction('assets', 'readwrite'), request = transaction.objectStore('assets').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        if (pruneRecordings(value, this.now())) cursor.update(value);
        cursor.continue();
      };
      transaction.oncomplete = resolve; transaction.onerror = resolve; transaction.onabort = resolve;
    });
  }
  async remove(key) {
    this.memory.delete(key); this.legacy.delete(key);
    const db = await this.ready;
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction('assets', 'readwrite');
      transaction.objectStore('assets').delete(key);
      transaction.oncomplete = resolve; transaction.onerror = resolve; transaction.onabort = resolve;
    });
  }
}
