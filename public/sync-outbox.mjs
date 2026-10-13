// Temporary, per-workspace upload journal. Firebase remains the durable library.
// This database contains only unacknowledged writes; recordings stay in MediaStore.
export class SyncOutbox {
  constructor({database} = {}) {
    this.memory = new Map(); this.tasks = new Map();
    this.ready = database !== undefined ? Promise.resolve(database) :
      typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise(resolve => {
        const request = indexedDB.open('shadowlab-sync-outbox-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('writes');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null); request.onblocked = () => resolve(null);
      });
  }
  serial(key, action) {
    const task = (this.tasks.get(key) || Promise.resolve()).catch(() => {}).then(action);
    this.tasks.set(key, task);
    task.finally(() => { if (this.tasks.get(key) === task) this.tasks.delete(key); }).catch(() => {});
    return task;
  }
  save(scope, id, value) {
    const key = scope + ':' + id, copy = structuredClone({...value, id, scope});
    return this.serial(key, async () => {
      this.memory.set(key, copy);
      const db = await this.ready;
      if (!db) return false;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('writes', 'readwrite');tx.objectStore('writes').put(copy, key);
        tx.oncomplete = resolve;tx.onerror = tx.onabort = () => reject(Error('Chưa giữ được hàng đợi đồng bộ trên thiết bị.'));
      });
      return true;
    });
  }
  acknowledge(scope, id, sequence) {
    const key = scope + ':' + id;
    return this.serial(key, async () => {
      if ((this.memory.get(key)?.pending.sequence ?? Infinity) <= sequence) this.memory.delete(key);
      const db = await this.ready;if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('writes', 'readwrite'), store = tx.objectStore('writes'), request = store.get(key);
        request.onsuccess = () => { if (request.result?.pending.sequence <= sequence) store.delete(key); };
        tx.oncomplete = resolve;tx.onerror = tx.onabort = () => reject(Error('Chưa dọn được hàng đợi đã đồng bộ.'));
      });
    });
  }
  async list(scope) {
    await Promise.allSettled([...this.tasks.values()]);
    const values = new Map([...this.memory].filter(([key]) => key.startsWith(scope + ':')));
    const db = await this.ready;
    if (db) await new Promise((resolve, reject) => {
      const tx = db.transaction('writes'), request = tx.objectStore('writes').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;if (!cursor) return;
        if (String(cursor.key).startsWith(scope + ':') && !values.has(cursor.key)) values.set(cursor.key, cursor.value);
        cursor.continue();
      };
      tx.oncomplete = resolve;tx.onerror = tx.onabort = () => reject(Error('Chưa đọc được hàng đợi đồng bộ.'));
    });
    return [...values.values()].map(value => structuredClone(value));
  }
}
