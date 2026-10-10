import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../public/core.mjs";
import { CloudSync } from "../public/cloud.mjs";
import { workspaceIdentity, Cipher } from "../public/crypto-sync.mjs";
import { LessonStore } from "../public/store.mjs";
import { MediaStore } from "../public/media-store.mjs";
import { createRESTTransport } from "../public/rest-firestore.mjs";
import { fullKey, mp3Frames, buildFullAudio } from "../public/full-audio.mjs";
const storage = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
  };
};
const paragraph = () =>
  C.createLesson(
    "A paragraph",
    C.parseTranscript("Good morning. Could I have a cup of tea, please?"),
  );
const clip = JSON.parse(
  fs.readFileSync(new URL("./fixtures/tts.json", import.meta.url)),
);
const audio = {
  data: clip.audio,
  mime: clip.mime,
  duration: clip.duration,
  words: clip.words,
};
function server() {
  const entries = new Map(),
    chunks = new Map();
  return {
    entries,
    chunks,
    offline: false,
    list: async function () {
      if (this.offline) throw Error("Offline");
      return [...entries.values()].map((v) => structuredClone(v));
    },
    watch: () => () => {},
    get: async (id) => structuredClone(entries.get(id)),
    chunk: async (id) => structuredClone(chunks.get(id)),
    putChunk: async (id, v) => {
      chunks.set(id, structuredClone(v));
    },
    removeChunk: async (id) => chunks.delete(id),
    commit: async (id, expected, v) => {
      if ((entries.get(id)?.revision || null) !== expected) {
        const e = Error("Conflict");
        e.code = "sync/conflict";
        throw e;
      }
      entries.set(id, { id, ...structuredClone(v) });
    },
  };
}
async function client(
  t,
  db,
  token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  local = storage(),
) {
  const identity = await workspaceIdentity(
    local,
    new URL("https://shadow.example/#sync=" + token),
  );
  const store = new LessonStore(local, "course-" + identity.scope).load(),
    media = new MediaStore();
  const sync = new CloudSync({
    identity,
    store,
    media,
    transportFactory: () => db,
  });
  t.after(() => sync.close());
  await sync.start();
  return { identity, store, media, sync };
}
test("per-reader profiles, narrator statistics and legacy defaults survive validation", () => {
  const l = paragraph();
  l.notes = "Ôn ngày mai";
  l.settings.dictType = "blanks";
  l.voiceProfiles[C.READER] = { voice: C.VOICES[2], rate: -15, pitch: 10 };
  const safe = C.validateLesson(l);
  assert.deepEqual(C.readerStats(safe)[0], {
    key: C.READER,
    name: "Người đọc",
    sentences: 2,
    words: 10,
    profile: { voice: C.VOICES[2], rate: -15, pitch: 10 },
  });
  assert.equal(safe.notes, l.notes);
  assert.equal(safe.settings.dictType, "blanks");
  delete l.voiceProfiles;
  assert.equal(C.voiceProfile(C.validateLesson(l)).rate, 0);
});
test("paragraphs group into one request, dialogues preserve reader changes", () => {
  assert.equal(C.planSpeech(paragraph()).length, 1);
  const l = C.createLesson(
    "Dialogue",
    C.parseTranscript("Alice: Hello. How are you?\nBob: Fine, thank you."),
  );
  assert.equal(C.planSpeech(l).length, 2);
  l.voiceProfiles.Bob = { ...C.voiceProfile(l, "Alice") };
  assert.equal(C.planSpeech(l).length, 1);
  const long = C.createLesson(
    "Long",
    C.parseTranscript("This is a short sentence for reading. ".repeat(100)),
  );
  assert(
    C.planSpeech(long).every(
      (g) => g.text.length <= 5000 && C.tokens(g.text).length <= 850,
    ),
  );
});
test("playback speed does not regenerate speech; synthesis controls do", async () => {
  const l = paragraph(),
    old = await fullKey(l),
    key = C.audioKey(l, l.sentences[0]);
  l.settings.speed = 1.5;
  assert.equal(await fullKey(l), old);
  l.voiceProfiles[C.READER] = { voice: l.voice, rate: 10, pitch: 5 };
  assert.notEqual(await fullKey(l), old);
  assert.notEqual(C.audioKey(l, l.sentences[0]), key);
});
test("real MP3 frames trim trailing silence without truncating a frame", () => {
  const raw = mp3Frames(clip.audio),
    end = clip.words.at(-1).end + 0.18,
    trimmed = mp3Frames(clip.audio, end);
  assert(trimmed.duration >= end && trimmed.duration < raw.duration);
  assert.equal(mp3Frames(trimmed.bytes).duration, trimmed.duration);
  assert.throws(() => mp3Frames(new Uint8Array([1, 2, 3])));
  assert.throws(() =>
    mp3Frames(trimmed.bytes.subarray(0, trimmed.bytes.length - 1)),
  );
});
test("one paragraph MP3 has sentence and word boundaries; full file round trip", async () => {
  const l = paragraph();
  let requests = 0;
  const a = await buildFullAudio(l, {}, async () => {
    requests++;
    return audio;
  });
  assert.equal(requests, 1);
  assert.equal(a.units.length, l.sentences.length);
  assert.equal(a.units[0].start, 0);
  assert.equal(a.units[0].end, a.units[1].start);
  assert(a.units[1].words.every((w) => w.exact));
  assert.equal(a.units[1].words[0].index, 0);
  const key = await fullKey(l),
    restored = C.parseFile(C.serializeFile(l, { full: { [key]: a } }));
  assert.deepEqual(restored.assets.full[key], a);
});
test("private sync link is stable in the URL, device-independent, and never written to localStorage", async () => {
  const s = storage(),
    a = await workspaceIdentity(s, new URL("https://x.test/"));
  assert(a.migrate);
  assert.equal(a.token.length, 43);
  assert.equal(s.getItem('shadowlab-private-sync'),null);
  const b = await workspaceIdentity(s, new URL(a.url));
  assert.equal(b.scope, a.scope);
  assert(!b.migrate);
  const c = await workspaceIdentity(storage(), new URL(a.url));
  assert.equal(c.token, a.token);
  assert(!c.migrate);
  const fresh = await workspaceIdentity(s,new URL('https://x.test/'));
  assert.notEqual(fresh.scope,a.scope);
  s.setItem('shadowlab-private-sync',a.token);
  assert.equal((await workspaceIdentity(s,new URL('https://x.test/'))).scope,a.scope);
  await assert.rejects(
    workspaceIdentity(s, new URL("https://x.test/#sync=broken")),
  );
});
test("AES-GCM rejects tampering, a wrong private link and swapped contexts", async () => {
  const cipher = new Cipher(
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "scope",
    ),
    v = await cipher.seal("Secret lesson", "lesson/a");
  assert(!JSON.stringify(v).includes("Secret"));
  assert.equal(await cipher.open(v, "lesson/a"), "Secret lesson");
  await assert.rejects(cipher.open(v, "lesson/b"));
  await assert.rejects(
    new Cipher("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "scope").open(
      v,
      "lesson/a",
    ),
  );
  await assert.rejects(
    cipher.open({ ...v, cipher: "A" + v.cipher.slice(1) }, "lesson/a"),
  );
});
test("encrypted Firebase transport round trip retains lesson, notes, progress and audio", async (t) => {
  const db = server(),
    a = await client(t, db),
    l = paragraph();
  l.notes = "Review tomorrow";
  l.progress[l.sentences[0].id].dict.draft = "Good morning";
  l.voiceProfiles[C.READER] = { voice: C.VOICES[1], rate: 10, pitch: -5 };
  a.store.upsert(l);
  await a.media.put(a.identity.scope + ":" + l.id, {
    tts: { [C.audioKey(l, l.sentences[0])]: audio },
    full: {},
    recordings: {},
    source: null,
  });
  a.sync.mark(l.id);
  await a.sync.flush();
  assert.equal(a.sync.dirty.size, 0);
  assert(
    !JSON.stringify([...db.entries.values(), ...db.chunks.values()]).includes(
      "Review tomorrow",
    ),
  );
  const b = await client(t, db);
  assert.equal(b.store.lessons[0].notes, l.notes);
  assert.deepEqual(b.store.lessons[0].voiceProfiles, l.voiceProfiles);
  assert.equal(
    b.store.lessons[0].progress[l.sentences[0].id].dict.draft,
    "Good morning",
  );
  assert((await b.sync.loadAssets(l.id)).tts[C.audioKey(l, l.sentences[0])]);
});
test("legacy adapter queue retries offline changes after reopening", async (t) => {
  const db = server();
  db.offline = true;
  const local = storage(),
    a = await client(t, db, undefined, local),
    l = paragraph();
  a.store.upsert(l);
  a.sync.mark(l.id);
  await a.sync.flush();
  assert.equal(db.entries.size, 0);
  a.sync.close();
  db.offline = false;
  const b = await client(t, db, undefined, local);
  assert.equal(b.sync.dirty.size, 0);
  assert(db.entries.has(l.id));
});
test("simultaneous edits expose a conflict and either version can be chosen", async (t) => {
  const db = server(),
    a = await client(t, db),
    l = paragraph();
  a.store.upsert(l);
  a.sync.mark(l.id);
  await a.sync.flush();
  const b = await client(t, db);
  a.store.lessons[0].notes = "A";
  a.sync.mark(l.id);
  b.store.lessons[0].notes = "B";
  b.sync.mark(l.id);
  await a.sync.flush();
  await b.sync.flush();
  assert(b.sync.conflicts.has(l.id));
  assert.equal(b.store.lessons[0].notes, "B");
  await b.sync.resolve(l.id, false);
  assert.equal(b.store.lessons[0].notes, "A");
  a.store.lessons[0].notes = "A2";
  a.sync.mark(l.id);
  b.store.lessons[0].notes = "B2";
  b.sync.mark(l.id);
  await a.sync.flush();
  await b.sync.flush();
  await b.sync.resolve(l.id, true);
  const c = await client(t, db);
  assert.equal(c.store.lessons[0].notes, "B2");
});
test("changes made during an upload remain queued with the new base revision", async (t) => {
  const db = server(),
    a = await client(t, db),
    l = paragraph();
  a.store.upsert(l);
  a.sync.mark(l.id);
  const original = db.commit;
  let once = true;
  db.commit = async (...args) => {
    if (once) {
      once = false;
      l.notes = "Edited during upload";
      a.store.save();
      a.sync.mark(l.id);
    }
    return original(...args);
  };
  await a.sync.flush();
  assert(a.sync.dirty.has(l.id));
  await a.sync.flush();
  const b = await client(t, db);
  assert.equal(b.store.lessons[0].notes, "Edited during upload");
});
test("a committed write with a lost acknowledgement is recovered, not mistaken for a conflict", async (t) => {
  const db = server(),
    local = storage(),
    a = await client(t, db, undefined, local),
    l = paragraph();
  a.store.upsert(l);
  a.sync.mark(l.id);
  const commit = db.commit;
  db.commit = async (...args) => {
    await commit(...args);
    throw Error("Lost acknowledgement");
  };
  await a.sync.flush();
  assert.equal(a.sync.online, false);
  a.sync.close();
  db.commit = commit;
  const b = await client(t, db, undefined, local);
  assert.equal(b.sync.conflicts.size, 0);
  assert.equal(b.sync.dirty.size, 0);
  assert.equal(b.store.lessons[0].id, l.id);
});
test("Unicode chunks preserve emoji and stay under Firestore document limits", async (t) => {
  const a = await client(t, server()),
    text = "x".repeat(119998) + "😀" + " tiếng Việt 😀".repeat(30000),
    ref = await a.sync.writeBlob("id", "notes", { text });
  assert(ref.count > 1);
  assert.deepEqual(await a.sync.readBlob(ref), { text });
  for (const doc of a.sync.transport.chunks.values())
    assert(Buffer.byteLength(JSON.stringify(doc)) < 1_000_000);
});
test("deletion syncs as a tombstone and does not return on another device", async (t) => {
  const db = server(),
    a = await client(t, db),
    l = paragraph();
  a.store.upsert(l);
  a.sync.mark(l.id);
  await a.sync.flush();
  a.store.remove(l.id);
  a.sync.mark(l.id);
  await a.sync.flush();
  const b = await client(t, db);
  assert.equal(b.store.lessons.length, 0);
  assert(db.entries.get(l.id).deleted);
});
test("missing media retains Firebase audio references while local progress uploads", async (t) => {
  const db = server(),
    a = await client(t, db),
    l = paragraph();
  a.store.upsert(l);
  await a.media.put(a.identity.scope + ":" + l.id, {
    tts: { [C.audioKey(l, l.sentences[0])]: audio },
    full: {},
    recordings: {},
    source: null,
  });
  a.sync.mark(l.id);
  await a.sync.flush();
  const b = await client(t, db);
  b.store.lessons[0].notes = "New notes without downloading media";
  b.sync.mark(l.id);
  await b.sync.flush();
  const c = await client(t, db);
  assert((await c.sync.loadAssets(l.id)).tts[C.audioKey(l, l.sentences[0])]);
  assert.equal(c.store.lessons[0].notes, b.store.lessons[0].notes);
});
test("REST fallback paginates, preserves ciphertext fields and uses server preconditions", async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const calls = [];
  const row = {
    name: "projects/demo/databases/(default)/documents/shadowlab/s/entries/one",
    updateTime: "2026-10-09T10:00:00.000Z",
    fields: {
      schema: { integerValue: "3" },
      revision: { stringValue: "old" },
      deleted: { booleanValue: false },
      updatedAt: { integerValue: "100" },
      payload: {
        mapValue: {
          fields: {
            iv: { stringValue: "AAAAAAAAAAAAAAAA" },
            cipher: { stringValue: "encrypted" },
          },
        },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes(":commit")) return new Response("{}");
    if (url.includes("/entries?"))
      return new Response(
        JSON.stringify(
          url.includes("pageToken=next")
            ? { documents: [] }
            : { documents: [row], nextPageToken: "next" },
        ),
      );
    return new Response(JSON.stringify(row));
  };
  const api = createRESTTransport("s", { projectId: "demo", apiKey: "key" }),
    entries = await api.list();
  assert.equal(calls.length, 2);
  assert.equal(entries[0].schema, 3);
  assert.equal(entries[0].payload.cipher, "encrypted");
  await api.commit("one", "old", {
    schema: 3,
    revision: "new",
    deleted: false,
    updatedAt: 101,
    payload: { iv: "a", cipher: "b" },
  });
  const body = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(body.writes[0].currentDocument, {
    updateTime: row.updateTime,
  });
  assert.equal(
    body.writes[0].update.fields.payload.mapValue.fields.cipher.stringValue,
    "b",
  );
  assert(!calls.at(-1).options.headers.Authorization);
  await assert.rejects(
    api.commit("one", "mismatch", { revision: "new" }),
    (e) => e.code === "sync/conflict",
  );
});
test("REST fallback maps permission errors and distinguishes absent documents", async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const api = createRESTTransport("s", { projectId: "demo", apiKey: "key" });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), {
      status: 404,
    });
  assert.equal(await api.get("missing"), null);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { status: "PERMISSION_DENIED", message: "Denied" },
      }),
      { status: 403 },
    );
  await assert.rejects(api.list(), (e) => e.code === "permission-denied");
});
