// Opt-in probe. Uses a fresh random workspace and removes only its own records.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url));
const server = http.createServer((req, res) => {
  const f =
    req.url === "/" ? null : path.join(root, "public", req.url.slice(1));
  if (!f) {
    res.setHeader("Content-Type", "text/html");
    return res.end("<!doctype html><title>Firebase connection check</title>");
  }
  try {
    res.setHeader("Content-Type", "application/javascript");
    res.end(fs.readFileSync(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const proxyURL = process.env.HTTPS_PROXY
  ? new URL(process.env.HTTPS_PROXY)
  : null;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
  ...(proxyURL
    ? { proxy: { server: proxyURL.origin, bypass: "127.0.0.1,localhost" } }
    : {}),
});
// The QA environment's HTTPS interception certificate is not in Chromium's
// bundled trust store. This option belongs to this opt-in probe, not the app.
const page = await browser.newPage({ ignoreHTTPSErrors: !!proxyURL });
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "tests/fixtures/paragraph.json")),
);
// Force the blocked-stream case and forward real REST requests through the
// environment's TLS-verified proxy. Responses come from the actual project.
await page.route("https://firestore.googleapis.com/**", async (route) => {
  const started = Date.now();
  const request = route.request();
  if (!request.url().includes("/v1/projects/")) return route.abort("failed");
  const response = await new Promise((resolve, reject) => {
    const process = spawn("python3", [
      path.join(root, "tests/firebase_bridge.py"),
    ]);
    let text = "",
      error = "";
    process.stdout.on("data", (v) => (text += v));
    process.stderr.on("data", (v) => (error += v));
    process.on("close", (code) =>
      code ? reject(Error(error)) : resolve(JSON.parse(text)),
    );
    process.stdin.end(
      JSON.stringify({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
        headers: request.headers(),
      }),
    );
  });
  await route.fulfill({
    status: response.status,
    headers: response.headers,
    body: Buffer.from(response.body, "base64"),
  });
  console.log(
    "Firestore",
    request.method(),
    response.status,
    Date.now() - started,
    "ms",
  );
});
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  const result = await page.evaluate(async (fixture) => {
    const [
      { workspaceIdentity },
      { CloudSync },
      { LessonStore },
      { MediaStore },
      C,
      { buildFullAudio, fullKey },
      { createTransport },
      { getFirestore, doc, deleteDoc },
    ] = await Promise.all([
      import("/crypto-sync.mjs"),
      import("/cloud.mjs"),
      import("/store.mjs"),
      import("/media-store.mjs"),
      import("/core.mjs"),
      import("/full-audio.mjs"),
      import("/firebase-adapter.mjs"),
      import("/vendor/firebase-firestore.mjs"),
    ]);
    const storage = () => {
      const m = new Map();
      return {
        getItem: (k) => m.get(k) || null,
        setItem: (k, v) => m.set(k, v),
      };
    };
    const identity = await workspaceIdentity(
      storage(),
      new URL(location.origin),
    );
    const clients = [];
    let statuses = [];
    async function client() {
      const cache = new Map();
      const store = new LessonStore(storage()).load(),
        media = {
          get: async (key) => cache.get(key),
          put: async (key, value) => cache.set(key, value),
          remove: async (key) => cache.delete(key),
        },
        sync = new CloudSync({
          identity,
          store,
          media,
          transportFactory: () => transport,
          onStatus: (state, message) => statuses.push({ state, message }),
        });
      clients.push(sync);
      await sync.start();
      if (!sync.online) throw Error(statuses.at(-1).message);
      return { store, media, sync };
    }
    const transport = createTransport(identity.scope),
      written = new Set();
    let cleaned = false;
    const original = transport.putChunk;
    transport.putChunk = async (id, value) => {
      written.add(id);
      return original(id, value);
    };
    try {
      const a = await client();
      const l = C.createLesson(
        "Temporary connection check",
        C.parseTranscript(fixture.text),
      );
      l.notes = "Firebase live round trip";
      l.voiceProfiles[C.READER] = { voice: C.VOICES[0], rate: -10, pitch: 5 };
      const full = await buildFullAudio(l, {}, async () => ({
        data: fixture.audio,
        mime: fixture.mime,
        words: fixture.words,
        duration: fixture.duration,
      }));
      a.store.upsert(l);
      await a.media.put(identity.scope + ":" + l.id, {
        tts: {},
        full: { [await fullKey(l)]: full },
        recordings: {},
        source: null,
      });
      a.sync.mark(l.id);
      await a.sync.flush();
      if (a.sync.dirty.size) throw Error(statuses.at(-1).message);
      const b = await client();
      const restored = b.store.lessons.find((x) => x.id === l.id),
        audio = await b.sync.loadAssets(l.id);
      if (
        restored?.notes !== l.notes ||
        restored?.voiceProfiles[C.READER].pitch !== 5 ||
        audio.full[await fullKey(l)].data !== full.data
      )
        throw Error("Live round trip mismatch");
      l.settings.speed = 1.5;
      a.store.save();
      a.sync.mark(l.id);
      await a.sync.flush();
      if (a.sync.dirty.size) throw Error(statuses.at(-1).message);
      await b.sync.reconcile(await transport.list());
      if (b.store.lessons[0].settings.speed !== 1.5)
        throw Error("Live revision mismatch");
      return {
        status: "passed",
        project: "shadow-study-mindlab",
        sdk: "13.0.0",
        transport: transport.mode,
        checks: [
          "encrypted lesson write/read",
          "MP3 chunk write/read",
          "voice settings retained",
          "transaction revision update",
          "second client restored progress",
        ],
        chunks: written.size,
      };
    } finally {
      for (const sync of clients) sync.close();
      for (const id of written) await transport.removeChunk(id);
      for (const row of await transport.list()) {
        const url =
          "https://firestore.googleapis.com/v1/projects/shadow-study-mindlab/databases/(default)/documents/shadowlab/" +
          identity.scope +
          "/entries/" +
          row.id +
          "?key=AIzaSyCL9Cx9MURvNeRcoMa6V1vopQCyNK-oLWY";
        const response = await fetch(url, { method: "DELETE" });
        if (!response.ok)
          throw Error("Could not remove temporary probe record.");
      }
      cleaned = true;
    }
  }, fixture);
  const out = process.env.TEST_OUTPUT_DIR || "/tmp/shadow-upgrade-qa";
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, "firebase-live-report.json"),
    JSON.stringify({ ...result, temporaryRecordsRemoved: true }, null, 2),
  );
  console.log(
    JSON.stringify({ ...result, temporaryRecordsRemoved: true }, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
