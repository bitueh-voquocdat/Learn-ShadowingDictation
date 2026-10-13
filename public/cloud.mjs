import { Cipher } from "./crypto-sync.mjs";
import { validateLesson, parseFile, serializeFile, uid } from "./core.mjs";
import { toBase64 } from "./audio.mjs";
import {sanitizeExperience, DEFAULT_EXPERIENCE} from './preferences.mjs';
import {SyncOutbox} from './sync-outbox.mjs';
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
    beforeRemote = () => {},
    onReady = async () => {},
    outbox = new SyncOutbox(),
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
      beforeRemote, onReady, outbox,
    });
    this.cipher = new Cipher(identity.token, identity.scope);
    this.records = new Map();
    this.dirty = new Map();
    this.conflicts = new Map();
    this.busy = false;
    this.origins = new Map();
    this.checkpoints = new Map();
    this.checkpointErrors = new Map();
    this.preferenceChanges = new Set();
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
  checkpoint(id) {
    const pending = this.dirty.get(id);
    if (!pending) return Promise.resolve();
    const l = this.store.lessons.find(value => value.id === id), key = this.identity.scope + ':' + id;
    const snapshot = {
      pending: structuredClone(pending),
      lesson: l ? JSON.parse(JSON.stringify(l)) : null,
      preferences: id === PREFERENCES_ID ? {...this.preferences} : null,
      preferenceBase: id === PREFERENCES_ID ? this.records.get(id)?.manifest?.preferences || null : null,
      changes: id === PREFERENCES_ID ? [...this.preferenceChanges] : [],
      origin: this.origins.get(id) || null,
      assets: this.media.memory?.has(key) ? structuredClone({...this.media.memory.get(key), recordings: {}}) : null,
    };
    const job = (this.checkpoints.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (!await this.outbox.save(this.identity.scope, id, snapshot))
        throw Error('Trình duyệt không cho lưu hàng đợi tạm.');
      this.checkpointErrors.delete(id);
    }).catch(error => {
      this.checkpointErrors.set(id, error.message);
      this.onStatus('pending', error.message + ' Giữ trang mở đến khi Firebase xác nhận.');
    });
    this.checkpoints.set(id, job);
    return job;
  }
  async restoreOutbox() {
    if (this.outboxRestored) return;
    const values = await this.outbox.list(this.identity.scope), selection = this.store.current;
    for (const value of values) {
      if (!/^[\w-]{1,80}$/.test(value.id) || !Number.isFinite(value.pending?.sequence))
        throw Error('Hàng đợi đồng bộ không hợp lệ; bản gốc vẫn được giữ.');
      if (this.dirty.has(value.id)) continue;
      if (value.id === PREFERENCES_ID) {
        this.preferences = sanitizeExperience(value.preferences);
        this.preferenceChanges = new Set(value.changes || []);
        if (value.pending.base && value.preferenceBase)
          this.records.set(value.id, {id: value.id, revision: value.pending.base,
            manifest: {preferences: sanitizeExperience(value.preferenceBase)}});
        // Replay explicit intent after the first server read.
        for (const key of Object.keys(DEFAULT_EXPERIENCE))
          if (this.preferenceChanges.has(key)) this.startupPreferences[key] = this.preferences[key];
        this.onPreferences(this.preferences);
      } else if (value.lesson) {
        this.store.upsert(validateLesson(value.lesson));
        if (value.assets) {
          const key = this.identity.scope + ':' + value.id, local = await this.media.get(key);
          await this.media.put(key, {...value.assets, recordings: local?.recordings || {}});
        }
      } else this.store.remove(value.id);
      if (value.origin) this.origins.set(value.id, value.origin);
      this.dirty.set(value.id, value.pending);
      this.store.current = selection;
      this.onChange(value.id);
    }
    this.outboxRestored = true;
    this.persistQueue();
  }
  mark(id) {
    if (!id) return;
    const previous = this.dirty.get(id);
    this.dirty.set(id, {
      base: previous ? previous.base : this.records.get(id)?.revision || null,
      sequence: (previous?.sequence || 0) + 1,
      writing: previous?.writing || null,
      deleted: id !== PREFERENCES_ID && !this.store.lessons.some((l) => l.id === id),
    });
    this.persistQueue();
    void this.checkpoint(id);
    this.onStatus("pending", "Đang gửi thay đổi lên Firebase · giữ trang mở");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  setPreferences(value, changes) {
    const previous = this.preferences || DEFAULT_EXPERIENCE;
    this.preferences = sanitizeExperience(value);
    for (const key of Object.keys(DEFAULT_EXPERIENCE))
      if (changes ? Object.hasOwn(changes, key) : previous[key] !== this.preferences[key]) this.preferenceChanges.add(key);
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
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize();
    try { return await this.startPromise; } finally { this.startPromise = null; }
  }
  async initialize() {
    this.starting = true;
    try {
      await this.restoreOutbox();
      const make =
        this.transportFactory ||
        (await import("./firebase-adapter.mjs")).createTransport;
      this.transport ||= make(this.identity.scope);
      const rows = await timeout(this.transport.list());
      // A control may be changed while the initial request is still loading.
      // Merge only those changed fields into the server preference document.
      const preferenceRow = rows.find(row => row.id === PREFERENCES_ID);
      const preferenceQueue = this.dirty.get(PREFERENCES_ID);
      if (!this.initialized && preferenceRow && preferenceQueue && !preferenceQueue.base && !preferenceQueue.writing && Object.keys(this.startupPreferences).length) {
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
            .then(async () => {
              await this.reconcile(rows);
              this.online = true;
              if (this.dirty.size) await this.flush();
              else this.status();
            })
            .catch((e) => this.fail(e));
          return this.reconciling;
        },
        (e) => this.fail(e),
      );
      await this.flush();
      if (this.online) await this.onReady();
      this.status();
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
      }, 5000);
  }
  status() {
    if (!this.online) return;
    this.onStatus(this.dirty.size || this.busy || this.conflicts.size ? 'pending' : 'synced',
      this.conflicts.size ? 'Có xung đột cần chọn phiên bản' : this.dirty.size || this.busy
        ? 'Đang gửi thay đổi lên Firebase · giữ trang mở' : 'Đã đồng bộ Firebase');
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
    if (record.id === PREFERENCES_ID) return {record, manifest, lesson: null};
    if (record.deleted) return {record, manifest, lesson: null};
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
    return { record, manifest, lesson: l };
  }
  async mergePreferences(row, manifest) {
    const pending = this.dirty.get(PREFERENCES_ID);
    if (!pending) return false;
    const base = sanitizeExperience(this.records.get(PREFERENCES_ID)?.manifest?.preferences || DEFAULT_EXPERIENCE);
    const remote = sanitizeExperience(manifest.preferences), local = sanitizeExperience(this.preferences), merged = {...remote};
    for (const key of Object.keys(DEFAULT_EXPERIENCE)) {
      const changedHere = this.preferenceChanges.has(key) || local[key] !== base[key];
      if (changedHere && remote[key] !== base[key] && local[key] !== remote[key]) return false;
      if (changedHere) merged[key] = local[key];
    }
    this.records.set(row.id, {...row, manifest});
    this.conflicts.delete(row.id);
    this.preferences = merged; this.onPreferences(merged);
    if (JSON.stringify(merged) === JSON.stringify(remote)) {
      this.dirty.delete(row.id); this.preferenceChanges.clear();
      await this.outbox.acknowledge(this.identity.scope, row.id, pending.sequence);
    } else {
      this.dirty.set(row.id, {...pending, base: row.revision, writing: null, sequence: pending.sequence + 1});
      await this.checkpoint(row.id);
    }
    this.persistQueue();
    return true;
  }
  async observePending(row, manifest) {
    const pending = this.dirty.get(row.id);
    if (!pending) return false;
    if (row.revision === pending.writing?.revision) {
      this.records.set(row.id, {...row, manifest});
      if (pending.sequence === pending.writing.sequence) {
        this.dirty.delete(row.id);
        if (row.id === PREFERENCES_ID) this.preferenceChanges.clear();
        await this.outbox.acknowledge(this.identity.scope, row.id, pending.sequence);
      } else {
        this.dirty.set(row.id, {...pending, base: row.revision, writing: null});
        await this.checkpoint(row.id);
      }
    } else if (row.revision !== pending.base) {
      if (row.id === PREFERENCES_ID && await this.mergePreferences(row, manifest)) return true;
      if (this.conflicts.get(row.id)?.revision !== row.revision) this.onConflict(row.id);
      this.conflicts.set(row.id, row);
    } else this.records.set(row.id, {...row, manifest});
    this.persistQueue();
    return true;
  }
  async reconcile(rows, received = new Map()) {
    const errors = [];
    for (const row of rows) {
      try { await this.reconcileRow(row, received.get(row.id)); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
  }
  async reconcileRow(input, preloaded) {
    let row = input;
    this.beforeRemote(row.id);
    let known = this.records.get(row.id);
    if (known?.revision === row.revision) return;
    // A delayed poll must not roll back a more recent acknowledged local write.
    if (known && row.revision !== this.dirty.get(row.id)?.writing?.revision) {
      row = await timeout(this.transport.get(row.id));
      if (!row) return;
      this.beforeRemote(row.id);
      known = this.records.get(row.id);
      if (known?.revision === row.revision) return;
      if (row.revision !== input.revision) preloaded = null;
    }
    let value = preloaded || await this.receive(row);
    row = value.record || row;
    this.beforeRemote(row.id);
    const newestKnown = this.records.get(row.id);
    if (newestKnown?.revision !== known?.revision && newestKnown?.revision !== row.revision) return;
    if (await this.observePending(row, value.manifest)) return;
    const {manifest, lesson} = value;
    this.records.set(row.id, {...row, manifest});
    if (manifest.origin) this.origins.set(row.id, manifest.origin);
    if (row.id === PREFERENCES_ID) {
      this.preferences = sanitizeExperience(manifest.preferences);
      this.preferenceChanges.clear(); this.onPreferences(this.preferences);
      return;
    }
    if (!lesson) {
      this.store.lessons = this.store.lessons.filter(l => l.id !== row.id);
      await this.media.remove(this.identity.scope + ':' + row.id);
    } else {
      const index = this.store.lessons.findIndex(l => l.id === lesson.id);
      if (index < 0) this.store.lessons.unshift(lesson);
      else this.store.lessons[index] = lesson;
    }
    try { this.store.save(); } catch {}
    this.onChange(row.id);
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
    if (this.flushPromise) return this.flushPromise;
    if (!this.transport || !this.online || !this.initialized) return;
    this.flushPromise = this.writePending();
    try { return await this.flushPromise; } finally { this.flushPromise = null; }
  }
  async writePending() {
    this.busy = true;
    let activeId;
    try {
      for (const [id, queuedValue] of [...this.dirty].sort(([a], [b]) => Number(b === PREFERENCES_ID) - Number(a === PREFERENCES_ID))) {
        if (this.conflicts.has(id)) continue;
        const queued = structuredClone(queuedValue);
        activeId = id;
        await this.checkpoints.get(id);
        const preferenceEntry = id === PREFERENCES_ID;
        const cache = preferenceEntry ? null : await this.media.get(this.identity.scope + ':' + id);
        const live = this.store.lessons.find(l => l.id === id),
          l = live ? JSON.parse(JSON.stringify(live)) : null,
          a = cache ? structuredClone({...cache, recordings: {}}) : null,
          preferenceSnapshot = {...this.preferences},
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
        const history = [...new Map([
            ...(oldManifest?.history || []),
            oldManifest?.body,
          ].filter(ref => ref && ref.id !== body?.id).map(ref => [ref.id, ref])).values()],
          manifest = {
            ...(preferenceEntry ? {preferences: preferenceSnapshot} : {}),
            ...((this.origins.get(id) || oldManifest?.origin) ? {origin: this.origins.get(id) || oldManifest.origin} : {}),
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
          await this.checkpoint(id);
        }
        const updatedAt = Date.now();
        await timeout(
          this.transport.commit(id, queued.base, {
            schema: 3,
            revision,
            deleted: !l && !preferenceEntry,
            updatedAt,
            payload,
          }),
          45000,
        );
        this.records.set(id, {
          id,
          schema: 3,
          revision,
          updatedAt,
          deleted: !l && !preferenceEntry,
          payload,
          manifest,
        });
        const latestAssets = await this.media.get(this.identity.scope + ":" + id);
        if (latestAssets && !latestAssets._partial) {
          latestAssets._cloudRevision = revision;
          await this.media.put(this.identity.scope + ":" + id, latestAssets);
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
        await this.outbox.acknowledge(this.identity.scope, id, queued.sequence);
        if (id === PREFERENCES_ID && !this.dirty.has(id)) this.preferenceChanges.clear();
        if (this.dirty.has(id)) await this.checkpoint(id);
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
          const manifest = await this.unpack(row);
          if (activeId !== PREFERENCES_ID || !(await this.mergePreferences(row, manifest))) {
            this.conflicts.set(activeId, row);
            this.onConflict(activeId);
          }
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
      this.records.set(id, {...remote, manifest: await this.unpack(remote)});
      const q = this.dirty.get(id);
      if (q) {
        q.base = remote.revision;
        q.writing = null;
        await this.checkpoint(id);
      }
    } else {
      const sequence = this.dirty.get(id)?.sequence;
      this.dirty.delete(id);
      if (sequence !== undefined) await this.outbox.acknowledge(this.identity.scope, id, sequence);
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
