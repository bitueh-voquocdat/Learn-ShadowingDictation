import {CloudSync, PREFERENCES_ID, timeout} from './cloud.mjs';
import {LessonStore} from './store.mjs';
import {SyncOutbox} from './sync-outbox.mjs';
import {readLegacy, clearLegacy} from './legacy.mjs';
import {digest} from './crypto-sync.mjs';
import {DEFAULT_EXPERIENCE, sanitizeExperience} from './preferences.mjs';

export const migratedId = async (scope, id, version = '') =>
  'migrated-' + await digest(scope + '|' + id + (version ? '|' + version : ''));
const signature = lesson => digest(JSON.stringify(lesson));

// Import old device-specific libraries into the stable shared workspace.
// Old cloud records are read-only. Provenance on each destination manifest makes
// retries idempotent and keeps later shared-device edits from being overwritten.
export class SyncMigration {
  constructor({sync, sources = [], onComplete = () => {}}) {
    Object.assign(this, {sync, sources, onComplete});
    this.pending = sources.length > 0; this.running = null;
  }
  async run() {
    if (!this.pending || !this.sync.online || this.sync.conflicts.size) return;
    if (this.running) return this.running;
    this.running = this.importAll();
    try { return await this.running; } finally { this.running = null; }
  }
  async confirm(id) {
    while (this.sync.dirty.has(id) && this.sync.online && !this.sync.conflicts.has(id)) await this.sync.flush();
    if (this.sync.conflicts.has(id)) {
      const row = this.sync.conflicts.get(id), manifest = await this.sync.unpack(row), local = this.sync.origins.get(id);
      if (local && JSON.stringify(manifest.origin) === JSON.stringify(local)) await this.sync.resolve(id, false);
    }
    if (this.sync.dirty.has(id) || !this.sync.online) throw Error('Chưa chuyển xong dữ liệu cũ. Giữ trang mở hoặc mở lại liên kết này để tiếp tục.');
  }
  async target(source, record, body, local) {
    let id = await migratedId(source.scope, body.id), existing = this.sync.records.get(id);
    if (!existing) return {id};
    const manifest = existing.manifest || await this.sync.unpack(existing);
    if (existing.deleted) return {id, skip: true};
    const origin = manifest.origin, content = await signature(body);
    if (origin?.sourceRevision === record?.revision && (!local || origin.sourceContent === content)) return {id, skip: true};
    const current = this.sync.store.lessons.find(l => l.id === id);
    if (current && origin?.signature && await signature(current) === origin.signature) return {id};
    // A changed source and a changed destination are both retained.
    id = await migratedId(source.scope, body.id, (record?.revision || 'local') + '|' + content);
    if (this.sync.records.has(id)) return {id, skip: true};
    return {id, backup: true};
  }
  async importSource(source, make) {
    const local = readLegacy(source);
    if (local.error) throw Error(local.error);
    const reader = new CloudSync({identity: source, store: new LessonStore().load(), media: this.sync.media,
      outbox: new SyncOutbox({database: null}), transportFactory: make});
    reader.transport = make(source.scope);
    const rows = await timeout(reader.transport.list()), byId = new Map(rows.map(row => [row.id, row])),
      locals = new Map(local.lessons.map(l => [l.id, l]));
    const preference = rows.find(row => row.id === PREFERENCES_ID);
    const oldPreferences = local.preferences || (preference ? sanitizeExperience((await reader.unpack(preference)).preferences) : null);
    if (oldPreferences && !this.sync.store.lessons.length && !this.sync.preferenceChanges.size &&
        !this.sync.origins.has(PREFERENCES_ID) && !this.sync.records.get(PREFERENCES_ID)?.manifest?.origin &&
        JSON.stringify(this.sync.preferences) === JSON.stringify(DEFAULT_EXPERIENCE)) {
      this.sync.origins.set(PREFERENCES_ID, {scope: source.scope, sourceId: PREFERENCES_ID,
        sourceRevision: preference?.revision || 'local', signature: await digest(JSON.stringify(oldPreferences))});
      this.sync.setPreferences(oldPreferences); this.sync.onPreferences(oldPreferences);
      await this.confirm(PREFERENCES_ID);
    }
    const ids = new Set([...byId.keys(), ...locals.keys(), ...Object.keys(local.pending)]);
    const errors = [];
    for (const sourceId of ids) {
      if (sourceId === PREFERENCES_ID || !/^[\w-]{1,80}$/.test(sourceId)) continue;
      try {
        const row = byId.get(sourceId), localBody = locals.get(sourceId);
        if (local.pending[sourceId]?.deleted || row?.deleted && !localBody) {
          const id = await migratedId(source.scope, sourceId);
          if (!this.sync.records.get(id)?.deleted) {
            this.sync.origins.set(id, {scope: source.scope, sourceId, sourceRevision: row?.revision || 'local', signature: ''});
            this.sync.store.remove(id); this.sync.mark(id); await this.confirm(id); this.sync.onChange(id);
          }
          continue;
        }
        let remote = null;
        if (row && !row.deleted) {
          try { remote = await reader.receive(row); }
          catch (error) { if (!localBody) throw error; }
        }
        let body = remote?.lesson;
        if (localBody && (!body || local.pending[sourceId] || localBody.updatedAt >= body.updatedAt)) body = localBody;
        if (!body) continue;
        let destination = await this.target(source, row, body, localBody);
        if (destination.skip) continue;
        const sourceKey = source.scope + ':' + sourceId, cache = await this.sync.media.get(sourceKey);
        let audio = null;
        if (row && !row.deleted) {
          reader.store.lessons = [body]; reader.records.set(sourceId, row);
          // Local complete audio can include unuploaded edits from the old app.
          audio = cache && !cache._partial ? cache : await reader.loadAssets(sourceId);
        }
        audio ||= cache || {tts: {}, full: {}, source: null, recordings: {}};
        // Re-evaluate after loading audio so an edit made during that load is retained.
        destination = await this.target(source, row, body, localBody);
        if (destination.skip) continue;
        const lesson = JSON.parse(JSON.stringify(body));lesson.id = destination.id;
        if (destination.backup) lesson.title += ' (Bản lưu cũ)';
        const targetKey = this.sync.identity.scope + ':' + lesson.id, targetCache = await this.sync.media.get(targetKey);
        const assets = {...audio, recordings: {...(audio.recordings || {}), ...(targetCache?.recordings || {})}};
        delete assets._cloudRevision;
        await this.sync.media.put(targetKey, assets);
        this.sync.origins.set(lesson.id, {scope: source.scope, sourceId, sourceRevision: row?.revision || 'local',
          sourceContent: await signature(body), signature: await signature(lesson)});
        const selection = this.sync.store.current;this.sync.store.upsert(lesson);this.sync.store.current = selection;
        this.sync.mark(lesson.id);await this.confirm(lesson.id);this.sync.onChange(lesson.id);
        await this.sync.media.confirmCloud?.(sourceKey);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
    if (this.sync.dirty.size || this.sync.conflicts.size) throw Error('Còn thay đổi cần đồng bộ trước khi hoàn tất chuyển dữ liệu.');
    clearLegacy(local);
  }
  async importAll() {
    const make = this.sync.transportFactory || (await import('./firebase-adapter.mjs')).createTransport;
    for (const source of this.sources) await this.importSource(source, make);
    this.pending = false; this.onComplete(); this.sync.status();
  }
}
