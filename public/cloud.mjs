import { Cipher } from "./crypto-sync.mjs";
import { validateLesson, parseFile, serializeFile, uid } from "./core.mjs";
import { toBase64 } from "./audio.mjs";
import {sanitizeExperience, DEFAULT_EXPERIENCE} from './preferences.mjs';
export const PREFERENCES_ID = 'workspace-preferences';
export const timeout = (promise, ms = 30000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(Error("Đang ngoại tuyến hoặc Firebase chưa phản hồi.")),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
export class CloudSync {
  constructor({
    identity,
    store,
    media,
    onStatus = () => {},
    onChange = () => {},
    onConflict = () => {},
    onPreferences = () => {},
    initialPreferences = null,
    legacyLessons = false,
    transportFactory,
  } = {}) {
    Object.assign(this, {
      identity,
      store,
      media,
      onStatus,
      onChange,
      onConflict,
      onPreferences,
      transportFactory,
    });
    this.cipher = new Cipher(identity.token, identity.scope);
    this.records = new Map();
    this.dirty = new Map();
    this.conflicts = new Map();
    this.busy = false;
    this.preferences = initialPreferences ? sanitizeExperience(initialPreferences) : null;
    this.initialized = false;
    this.startupPreferences = {};
    this.legacyLessons = legacyLessons ? [...store.lessons] : null;
    this.online = false;
    this.reconciling = Promise.resolve();
    this.queueKey = "shadowlab-pending-" + identity.scope;
    try {
      const q = JSON.parse(store.storage.getItem(this.queueKey) || "{}");
      for (const [id, v] of Object.entries(q))
        if (/^[\w-]{1,80}$/.test(id) && v && Number.isFinite(v.sequence))
          this.dirty.set(id, v);
    } catch {}
  }
  persistQueue() {
    try {
      this.store.storage.setItem(
        this.queueKey,
        JSON.stringify(Object.fromEntries(this.dirty)),
      );
    } catch {}
  }
  mark(id) {
    if (!id) return;
    const previous = this.dirty.get(id);
    this.dirty.set(id, {
      base: previous ? previous.base : this.records.get(id)?.revision || null,
      sequence: (previous?.sequence || 0) + 1,
      writing: previous?.writing || null,
      deleted: !this.store.lessons.some((l) => l.id === id),
    });
    this.persistQueue();
    this.onStatus("pending", "Đang gửi thay đổi lên Firebase · giữ trang mở");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  setPreferences(value, changes) {
    const previous = this.preferences || DEFAULT_EXPERIENCE;
    this.preferences = sanitizeExperience(value);
    if (!this.initialized) {
      for (const key of Object.keys(DEFAULT_EXPERIENCE))
        if (changes ? Object.hasOwn(changes, key) : previous[key] !== this.preferences[key])
          this.startupPreferences[key] = this.preferences[key];
    }
    this.mark(PREFERENCES_ID);
    this.dirty.get(PREFERENCES_ID).deleted = false;
    this.persistQueue();
  }
  async start() {
    if (this.starting) return;
    this.starting = true;
    try {
      const make =
        this.transportFactory ||
        (await import("./firebase-adapter.mjs")).createTransport;
      this.transport ||= make(this.identity.scope);
      const rows = await timeout(this.transport.list());
      // A control may be changed while the initial request is still loading.
      // Merge only those changed fields into the server preference document.
      const preferenceRow = rows.find(row => row.id === PREFERENCES_ID);
      const preferenceQueue = this.dirty.get(PREFERENCES_ID);
      if (!this.initialized && preferenceRow && preferenceQueue && Object.keys(this.startupPreferences).length) {
        const {manifest} = await this.receive(preferenceRow);
        this.preferences = sanitizeExperience({...manifest.preferences, ...this.startupPreferences});
        this.records.set(PREFERENCES_ID, {...preferenceRow, manifest});
        preferenceQueue.base = preferenceRow.revision;
        preferenceQueue.writing = null;
        this.onPreferences(this.preferences);
        this.persistQueue();
      }
      const received = new Map();
      if (this.legacyLessons) {
        for (const l of this.legacyLessons) {
          const row = rows.find(row => row.id === l.id);
          if (this.dirty.has(l.id)) continue;
          if (!row) this.mark(l.id);
          else if (row.deleted) {
            if (l.updatedAt > row.updatedAt) this.mark(l.id);
          } else {
            const value = await this.receive(row);
            received.set(l.id, value);
            // Compare the lesson's edit time, not a later network commit time.
            if (value.lesson && l.updatedAt >= value.lesson.updatedAt &&
                JSON.stringify(l) !== JSON.stringify(value.lesson)) this.mark(l.id);
          }
        }
        this.legacyLessons = null;
      }
      await this.reconcile(rows, received);
      this.initialized = true;
      this.startupPreferences = {};
      this.online = true;
      if (!this.records.has(PREFERENCES_ID) && !this.dirty.has(PREFERENCES_ID)) {
        this.setPreferences(this.preferences || this.store.lessons.find(l => l.settings.experience)?.settings.experience || DEFAULT_EXPERIENCE);
        this.onPreferences(this.preferences);
      }
      for (const l of this.store.lessons)
        if (!this.records.has(l.id) && !this.dirty.has(l.id)) this.mark(l.id);
      this.unsubscribe?.();
      this.unsubscribe = this.transport.watch(
        (rows) => {
          this.reconciling = this.reconciling
            .then(() => this.reconcile(rows))
            .catch((e) => this.fail(e));
        },
        (e) => this.fail(e),
      );
      await this.flush();
      if (!this.dirty.size) this.onStatus("synced", "Đã đồng bộ Firebase");
    } catch (e) {
      this.online = false;
      this.fail(e);
    } finally {
      this.starting = false;
    }
    if (!this.retry)
      this.retry = setInterval(() => {
        if (!this.online) this.start();
        else if (this.dirty.size) this.flush();
      }, 15000);
  }
  fail(e) {
    this.online = false;
    this.onStatus(
      "error",
      e.code === "permission-denied"
        ? "Firebase chưa cho phép lưu. Kiểm tra firestore.rules."
        : (e.message || "Chưa đồng bộ được Firebase.") + " Chưa lưu lên server; giữ trang mở hoặc xuất file bài.",
    );
  }
  async writeBlob(owner, key, value) {
    const text = JSON.stringify(value),
      id = await this.cipher.id(owner + "|" + key + "|" + text),
      parts = [];
    for (let p = 0; p < text.length; ) {
      let end = Math.min(text.length, p + 120000);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      parts.push(text.slice(p, end));
      p = end;
    }
    if (!parts.length) parts.push("");
    const count = parts.length;
    if (count > 800) throw Error("Audio quá lớn để đồng bộ.");
    const ref = { id, count };
    if (this.knownBlobs?.has(id)) return ref;
    for (let batch = 0; batch < count; batch += 3) {
      await Promise.all(
        parts.slice(batch, batch + 3).map(async (part, j) => {
          const i = batch + j,
            payload = await this.cipher.seal(part, id + "/" + i);
          await timeout(
            this.transport.putChunk(`${id}-${i}`, { schema: 3, ...payload }),
          );
        }),
      );
    }
    this.knownBlobs?.add(id);
    return ref;
  }
  async readBlob(ref) {
    if (
      !ref ||
      !/^[a-f0-9]{64}$/.test(ref.id) ||
      !Number.isInteger(ref.count) ||
      ref.count < 1 ||
      ref.count > 800
    )
      throw Error("Tham chiếu dữ liệu Firebase không hợp lệ.");
    const parts = [];
    for (let batch = 0; batch < ref.count; batch += 3) {
      parts.push(
        ...(await Promise.all(
          Array.from(
            { length: Math.min(3, ref.count - batch) },
            async (_, j) => {
              const i = batch + j,
                data = await timeout(this.transport.chunk(`${ref.id}-${i}`));
              return this.cipher.open(data, ref.id + "/" + i);
            },
          ),
        )),
      );
    }
    return JSON.parse(parts.join(""));
  }
  async unpack(record) {
    if (record.schema !== 3 || typeof record.revision !== "string")
      throw Error("Phiên bản đồng bộ chưa được hỗ trợ.");
    return JSON.parse(
      await this.cipher.open(record.payload, record.id + "/manifest"),
    );
  }
  async receive(record) {
    const manifest = await this.unpack(record);
    if (record.id === PREFERENCES_ID) return {manifest, lesson: null};
    if (record.deleted) return { manifest, lesson: null };
    let l;
    try {
      l = validateLesson(await this.readBlob(manifest.body));
      if (l.id !== record.id) throw Error("ID bài trên Firebase không khớp.");
    } catch (e) {
      const newest = await this.transport.get(record.id);
      if (newest && newest.revision !== record.revision)
        return this.receive(newest);
      throw e;
    }
    return { manifest, lesson: l };
  }
  async reconcile(rows, received = new Map()) {
    for (const row of rows) {
      const known = this.records.get(row.id),
        pending = this.dirty.get(row.id);
      if (known?.revision === row.revision) continue;
      if (pending && row.revision === pending.writing?.revision) {
        this.records.set(row.id, { ...row, manifest: await this.unpack(row) });
        if (pending.sequence === pending.writing.sequence)
          this.dirty.delete(row.id);
        else {
          pending.base = row.revision;
          pending.writing = null;
        }
        this.persistQueue();
        continue;
      }
      if (pending && row.revision !== pending.base) {
        if (
          this.writing?.id === row.id &&
          this.writing.revision === row.revision
        ) {
          this.records.set(row.id, row);
          continue;
        }
        this.conflicts.set(row.id, row);
        this.onConflict(row.id);
        continue;
      }
      const { manifest, lesson } = received.get(row.id) || await this.receive(row);
      this.records.set(row.id, { ...row, manifest });
      if (pending) continue;
      if (row.id === PREFERENCES_ID) {
        this.preferences = sanitizeExperience(manifest.preferences);
        this.onPreferences(this.preferences);
        continue;
      }
      if (!lesson) {
        this.store.lessons = this.store.lessons.filter((l) => l.id !== row.id);
        await this.media.remove(this.identity.scope + ":" + row.id);
      } else {
        const index = this.store.lessons.findIndex((l) => l.id === lesson.id);
        if (index < 0) this.store.lessons.unshift(lesson);
        else this.store.lessons[index] = lesson;
      }
      try {
        this.store.save();
      } catch {}
      this.onChange(row.id);
    }
  }
  async loadAssets(id, retry = true) {
    const record = this.records.get(id);
    if (!record || record.deleted) return null;
    const manifest = record.manifest || (await this.unpack(record));
    record.manifest = manifest;
    let cached = await this.media.get(this.identity.scope + ":" + id);
    if (cached?._cloudRevision === record.revision) return cached;
    const a = { tts: {}, full: {}, recordings: cached?.recordings || {}, source: null };
    try {
      for (const item of (manifest.assets || []).filter(item => item.type !== 'recordings')) {
        const value = await this.readBlob(item.ref);
        if (item.type === "source") a.source = value;
        else if (["tts", "full"].includes(item.type))
          a[item.type][item.key] = value;
      }
    } catch (e) {
      if (retry) {
        const latest = await timeout(this.transport.get(id));
        if (latest && latest.revision !== record.revision) {
          this.records.delete(id);
          await this.reconcile([latest]);
          return this.loadAssets(id, false);
        }
      }
      throw e;
    }
    const l = this.store.lessons.find((l) => l.id === id);
    if (!l) return null;
    const safe = parseFile(serializeFile(l, a)).assets;
    safe._cloudRevision = record.revision;
    await this.media.put(this.identity.scope + ":" + id, safe);
    await this.media.confirmCloud?.(this.identity.scope + ":" + id);
    return safe;
  }
  async flush() {
    if (this.busy || !this.transport || !this.online || !this.initialized) return;
    this.busy = true;
    let activeId;
    try {
      for (const [id, queued] of [...this.dirty].sort(([a], [b]) => Number(b === PREFERENCES_ID) - Number(a === PREFERENCES_ID))) {
        if (this.conflicts.has(id)) continue;
        activeId = id;
        const preferenceEntry = id === PREFERENCES_ID;
        const l = this.store.lessons.find((l) => l.id === id),
          revision = uid(),
          old = this.records.get(id),
          oldManifest = old?.manifest || (old ? await this.unpack(old) : null);
        this.knownBlobs = new Set(
          [oldManifest?.body, ...(oldManifest?.assets || []).map((a) => a.ref)]
            .filter(Boolean)
            .map((r) => r.id),
        );
        const summary = preferenceEntry ? {kind: 'preferences'} : l
          ? { title: l.title, kind: l.kind, sentences: l.sentences.length }
          : { title: "deleted" };
        let body = null,
          refs = [];
        if (l) {
          body = await this.writeBlob(
            id,
            "body",
            JSON.parse(JSON.stringify(l)),
          );
          const a = await this.media.get(this.identity.scope + ":" + id);
          if (!a || a._partial) refs.push(...(oldManifest?.assets || []).filter(item => item.type !== 'recordings'));
          if (a) {
            for (const type of ["full", "tts"])
              for (const [key, value] of Object.entries(a[type] || {})) {
                const v = value.blob
                  ? { ...value, data: await toBase64(value.blob) }
                  : { ...value };
                delete v.blob;
                refs.push({
                  type,
                  key,
                  ref: await this.writeBlob(id, type + "|" + key, v),
                });
              }
            if (a.source) {
              const v = {
                mime: a.source.mime,
                data: a.source.data || (await toBase64(a.source.blob)),
              };
              refs.push({
                type: "source",
                key: "source",
                ref: await this.writeBlob(id, "source", v),
              });
            }
          }
        }
        const history = [
            ...(oldManifest?.history || []),
            oldManifest?.body,
          ].filter(Boolean),
          manifest = {
            ...(preferenceEntry ? {preferences: {...this.preferences}} : {}),
            body,
            assets: [
              ...new Map(refs.map((r) => [r.type + "|" + r.key, r])).values(),
            ],
            summary,
            history: history.slice(-3),
          },
          payload = await this.cipher.seal(
            JSON.stringify(manifest),
            id + "/manifest",
          );
        this.writing = { id, revision };
        const pending = this.dirty.get(id);
        if (pending) {
          pending.writing = { revision, sequence: queued.sequence };
          this.persistQueue();
        }
        await timeout(
          this.transport.commit(id, queued.base, {
            schema: 3,
            revision,
            deleted: !l && !preferenceEntry,
            updatedAt: Date.now(),
            payload,
          }),
          45000,
        );
        this.records.set(id, {
          id,
          schema: 3,
          revision,
          deleted: !l && !preferenceEntry,
          payload,
          manifest,
        });
        const a = await this.media.get(this.identity.scope + ":" + id);
        if (a && !a._partial) {
          a._cloudRevision = revision;
          await this.media.put(this.identity.scope + ":" + id, a);
          if (this.dirty.get(id)?.sequence === queued.sequence)
            await this.media.confirmCloud?.(this.identity.scope + ":" + id);
        }
        this.writing = null;
        const current = this.dirty.get(id);
        if (current?.sequence === queued.sequence) this.dirty.delete(id);
        else if (current) {
          current.base = revision;
          current.writing = null;
        }
        this.persistQueue();
        for (const stale of history.slice(0, -3))
          for (let i = 0; i < stale.count; i++)
            this.transport.removeChunk(`${stale.id}-${i}`).catch(() => {});
      }
      this.online = true;
      this.onStatus(
        this.dirty.size ? "pending" : "synced",
        this.conflicts.size
          ? "Có xung đột cần chọn phiên bản"
          : this.dirty.size
            ? "Chưa gửi xong Firebase · giữ trang mở"
            : "Đã đồng bộ Firebase",
      );
    } catch (e) {
      this.writing = null;
      if (e.code === "sync/conflict" && activeId) {
        const row = await this.transport.get(activeId);
        if (row) {
          this.conflicts.set(activeId, row);
          this.onConflict(activeId);
        }
      } else {
        this.online = false;
        this.fail(e);
      }
    } finally {
      this.busy = false;
      if (this.online && [...this.dirty.keys()].some(id => !this.conflicts.has(id))) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 150);
      }
    }
  }
  async resolve(id, keepLocal) {
    const remote = this.conflicts.get(id);
    if (!remote) return;
    if (keepLocal) {
      this.records.set(id, remote);
      const q = this.dirty.get(id);
      if (q) {
        q.base = remote.revision;
        q.writing = null;
      }
    } else {
      this.dirty.delete(id);
      this.records.delete(id);
      await this.reconcile([remote]);
    }
    this.conflicts.delete(id);
    this.persistQueue();
    await this.flush();
  }
  close() {
    clearTimeout(this.timer);
    clearInterval(this.retry);
    this.unsubscribe?.();
  }
}
