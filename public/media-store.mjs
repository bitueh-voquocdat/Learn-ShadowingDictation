export class MediaStore {
  constructor() {
    this.memory = new Map();
    this.ready =
      typeof indexedDB === "undefined"
        ? Promise.resolve(null)
        : new Promise((resolve) => {
            const r = indexedDB.open("shadowlab-media-v3", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("assets");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.onblocked = () => resolve(null);
          });
  }
  async get(key) {
    if (this.memory.has(key)) return this.memory.get(key);
    const db = await this.ready;
    if (!db) return null;
    return new Promise((resolve) => {
      const r = db.transaction("assets").objectStore("assets").get(key);
      r.onsuccess = () => {
        const v = r.result || null;
        if (v) this.memory.set(key, v);
        resolve(v);
      };
      r.onerror = () => resolve(null);
    });
  }
  async put(key, value) {
    this.memory.set(key, value);
    const db = await this.ready;
    if (!db) return;
    await new Promise((resolve, reject) => {
      const t = db.transaction("assets", "readwrite");
      t.objectStore("assets").put(value, key);
      t.oncomplete = resolve;
      t.onerror = () => reject(Error("Chưa lưu được cache audio trên máy."));
      t.onabort = t.onerror;
    });
  }
  async remove(key) {
    this.memory.delete(key);
    const db = await this.ready;
    if (!db) return;
    await new Promise((resolve) => {
      const t = db.transaction("assets", "readwrite");
      t.objectStore("assets").delete(key);
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  }
}
