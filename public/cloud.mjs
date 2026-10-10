import { Cipher } from "./crypto-sync.mjs";
import { validateLesson, parseFile, serializeFile, uid } from "./core.mjs";
import { toBase64 } from "./audio.mjs";
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
    transportFactory,
  } = {}) {
    Object.assign(this, {
      identity,
      store,
      media,
      onStatus,
      onChange,
      onConflict,
      transportFactory,
    });
    this.cipher = new Cipher(identity.token, identity.scope);
    this.records = new Map();
    this.dirty = new Map();
    this.conflicts = new Map();
    this.busy = false;
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
    this.onStatus("pending", "Đã giữ trên máy · chờ Firebase");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1100);
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
      this.online = true;
      await this.reconcile(rows);
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
        : e.message || "Chưa đồng bộ được Firebase. Bản trên máy vẫn được giữ.",
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
  async reconcile(rows) {
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
      const { manifest, lesson } = await this.receive(row);
      this.records.set(row.id, { ...row, manifest });
      if (pending) continue;
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
    const a = { tts: {}, full: {}, recordings: {}, source: null };
    try {
      for (const item of manifest.assets || []) {
        const value = await this.readBlob(item.ref);
        if (item.type === "source") a.source = value;
        else if (["tts", "full", "recordings"].includes(item.type))
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
    return safe;
  }
  async flush() {
    if (this.busy || !this.transport || !this.online) return;
    this.busy = true;
    let activeId;
    try {
      for (const [id, queued] of [...this.dirty]) {
        if (this.conflicts.has(id)) continue;
        activeId = id;
        const l = this.store.lessons.find((l) => l.id === id),
          revision = uid(),
          old = this.records.get(id),
          oldManifest = old?.manifest || (old ? await this.unpack(old) : null);
        this.knownBlobs = new Set(
          [oldManifest?.body, ...(oldManifest?.assets || []).map((a) => a.ref)]
            .filter(Boolean)
            .map((r) => r.id),
        );
        const summary = l
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
          if (!a || a._partial) refs.push(...(oldManifest?.assets || []));
          if (a) {
            for (const type of ["full", "tts", "recordings"])
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
            deleted: !l,
            updatedAt: Date.now(),
            payload,
          }),
          45000,
        );
        this.records.set(id, {
          id,
          schema: 3,
          revision,
          deleted: !l,
          payload,
          manifest,
        });
        const a = await this.media.get(this.identity.scope + ":" + id);
        if (a && !a._partial) {
          a._cloudRevision = revision;
          await this.media.put(this.identity.scope + ":" + id, a);
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
            ? "Đã giữ trên máy · chờ Firebase"
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
