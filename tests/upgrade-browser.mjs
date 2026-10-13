import {uiClick,uiCheck} from "./ui-controls.mjs";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url)),
  out = process.env.TEST_OUTPUT_DIR || "/tmp/shadow-upgrade-qa";
fs.mkdirSync(out, { recursive: true });
const fixtures = ["paragraph", "reply"].map((name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/" + name + ".json")),
  ),
);
const fallback = JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/tts.json")),
  ),
  headers = JSON.parse(fs.readFileSync(path.join(root, "vercel.json")))
    .headers[0].headers;
const databases = new Map(),
  calls = [];
let offline = false,
  ttsDelay = 0;
const adapter = `export function createTransport(scope){const call=async(action,id,value,expected)=>{const r=await fetch('/test-cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,action,id,value,expected})});const v=await r.json();if(!r.ok){const e=Error(v.error);e.code=v.code;throw e;}return v;};return{list:()=>call('list'),get:id=>call('get',id),chunk:id=>call('chunk',id),putChunk:(id,v)=>call('put',id,v),removeChunk:id=>call('delete',id),commit:(id,expected,v)=>call('commit',id,v,expected),watch(fn,error){let signature='',busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const rows=await call('list'),key=JSON.stringify(rows.map(r=>r.id+':'+r.revision));if(signature!==key){signature=key;fn(rows);}}catch(e){error(e);}finally{busy=false;}},300);return()=>clearInterval(timer);}};}`;
const server = http.createServer(async (req, res) => {
  for (const h of headers) res.setHeader(h.key, h.value);
  if (req.url === "/test-cloud") {
    let body = "";
    for await (const b of req) body += b;
    const p = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    if (offline) {
      res.writeHead(503);
      return res.end(JSON.stringify({ error: "Offline" }));
    }
    if (!databases.has(p.scope))
      databases.set(p.scope, { entries: new Map(), chunks: new Map() });
    const db = databases.get(p.scope);
    let value = null;
    switch (p.action) {
      case "list":
        value = [...db.entries.values()];
        break;
      case "get":
        value = db.entries.get(p.id) || null;
        break;
      case "chunk":
        value = db.chunks.get(p.id);
        break;
      case "put":
        db.chunks.set(p.id, p.value);
        break;
      case "delete":
        db.chunks.delete(p.id);
        break;
      case "commit":
        if ((db.entries.get(p.id)?.revision || null) !== p.expected) {
          res.writeHead(409);
          return res.end(
            JSON.stringify({ code: "sync/conflict", error: "Conflict" }),
          );
        }
        db.entries.set(p.id, { id: p.id, ...p.value });
        break;
    }
    return res.end(JSON.stringify(value));
  }
  if (req.url === '/api/translate') {
    let body = ''; for await (const chunk of req) body += chunk;
    const items = JSON.parse(body).items;
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({translations:items.map(item=>({...item,translation:'Bản dịch fixture: '+item.text,provider:'fixture'})),failed:[]}));
  }
  if (req.url === "/api/tts") {
    let body = "";
    for await (const b of req) body += b;
    const p = JSON.parse(body);
    calls.push(p);
    if (ttsDelay) await new Promise((r) => setTimeout(r, ttsDelay));
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify(fixtures.find((f) => f.text === p.text) || fallback),
    );
  }
  const name = req.url === "/" ? "index.html" : req.url.slice(1),
    types = {
      ".html": "text/html",
      ".mjs": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
  try {
    res.setHeader("Content-Type", types[path.extname(name)] || "text/plain");
    res.end(fs.readFileSync(path.join(root, "public", name)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const contexts = [],
  errors = [],
  report = [];
const create = async () => {
  const c = await browser.newContext({
    viewport: { width: 1365, height: 850 },
    acceptDownloads: true,
  });
  contexts.push(c);
  await c.route("**/firebase-adapter.mjs", (route) =>
    route.fulfill({ contentType: "application/javascript", body: adapter }),
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
let page = await create();
const check = (name) => report.push({ name, status: "passed" });
try {
  await page.goto(url);
  await page.waitForFunction(() =>
    document.querySelector("#save-state").textContent.includes("Đã đồng bộ"),
  );
  assert.equal(await page.locator(".sidebar").count(), 0);
  await uiClick(page, "#new");
  await page.locator("#new-title").fill("Morning practice");
  await page.locator("#new-text").fill(fixtures[0].text);
  await uiClick(page, "#analyse");
  await uiClick(page, "#create-confirm");
  await page.waitForFunction(() =>
    document.querySelector("#audio-status").textContent.includes("sẵn sàng"),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, fixtures[0].text);
  check("automatic preload synthesizes a paragraph with one request");
  await uiClick(page, "#show-settings");
  assert.equal(await page.locator(".reader-row").count(), 1);
  assert(
    (await page.locator(".reader-row small").innerText()).includes("2 câu"),
  );
  await page
    .locator('[data-reader="__reader__"][data-profile="voice"]')
    .selectOption("en-GB-LibbyNeural");
  await page
    .locator('[data-reader="__reader__"][data-profile="rate"]')
    .fill("-15");
  await page
    .locator('[data-reader="__reader__"][data-profile="rate"]')
    .dispatchEvent("change");
  await page
    .locator('[data-reader="__reader__"][data-profile="pitch"]')
    .fill("10");
  await page
    .locator('[data-reader="__reader__"][data-profile="pitch"]')
    .dispatchEvent("change");
  await uiClick(page, '[data-close="settings-dialog"]');
  await page.waitForFunction(() =>
    document.querySelector("#audio-status").textContent.includes("sẵn sàng"),
  );
  assert.deepEqual(
    [calls.at(-1).voice, calls.at(-1).rate, calls.at(-1).pitch],
    ["en-GB-LibbyNeural", -15, 10],
  );
  await uiClick(page, "#listen-all");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  const src = await page.locator("#model").evaluate((e) => e.src),
    before = calls.length;
  await page.locator("#speed").selectOption("1.5");
  assert.equal(
    await page.locator("#model").evaluate((e) => e.playbackRate),
    1.5,
  );
  await page.waitForFunction(() =>
    document.querySelector("#sentence-position").textContent.includes("2 / 2"),
  );
  assert.equal(await page.locator("#model").evaluate((e) => e.src), src);
  assert.equal(calls.length, before);
  await page.waitForFunction(
    () => document.querySelector("#listen-all").disabled === false,
  );
  check(
    "continuous audio, sentence captions and live speed use the same loaded file",
  );
  await uiClick(page, "#show-notes");
  await page.locator("#notes").fill("Listen for connected speech.");
  await page.locator("#lesson-notes").fill("Review tomorrow.");
  await uiClick(page, '[data-close="notes-dialog"]');
  await uiClick(page, "#change-lesson");
  assert(await page.locator("#empty").isVisible());
  assert.equal(await page.locator("[data-lesson]").count(), 1);
  await uiClick(page, "[data-lesson]");
  await uiClick(page, "#show-notes");
  assert.equal(
    await page.locator("#lesson-notes").inputValue(),
    "Review tomorrow.",
  );
  await uiClick(page, '[data-close="notes-dialog"]');
  check("change lesson saves automatically and opens the lesson picker");
  await uiClick(page, "#sync-settings");
  const syncLink = await page.locator("#sync-link").inputValue();
  await uiClick(page, "#retry-sync");
  await page.waitForFunction(() =>
    document.querySelector("#save-state").textContent.includes("Đã đồng bộ"),
  );
  await uiClick(page, '[data-close="sync-dialog"]');
  const second = await create();
  await second.goto(syncLink);
  await second.waitForSelector("[data-lesson]");
  await uiClick(second, "[data-lesson]");
  await uiClick(second, "#show-settings");
  assert.equal(
    await second
      .locator('[data-reader="__reader__"][data-profile="rate"]')
      .inputValue(),
    "-15",
  );
  assert.equal(
    await second
      .locator('[data-reader="__reader__"][data-profile="pitch"]')
      .inputValue(),
    "10",
  );
  await uiClick(second, '[data-close="settings-dialog"]');
  await uiClick(second, "#show-notes");
  assert.equal(
    await second.locator("#lesson-notes").inputValue(),
    "Review tomorrow.",
  );
  await uiClick(second, '[data-close="notes-dialog"]');
  assert.equal(await second.locator("#speed").inputValue(), "1.5");
  const cachedBefore = calls.length;
  await uiClick(second, "#play");
  await second.waitForFunction(() => !document.querySelector("#model").paused);
  await uiClick(second, "#stop");
  assert.equal(calls.length, cachedBefore);
  check(
    "another device restores profiles, notes, speed and cached MP3 from encrypted cloud data",
  );
  await uiClick(page, "#tts-tab");
  await page.locator("#tts-title").fill("My first MP3");
  await page.locator("#tts-text").fill(fixtures[0].text);
  await page.locator("#tts-rate").fill("-10");
  await page.locator("#tts-pitch").fill("5");
  await uiClick(page, "#tts-generate");
  await page.waitForSelector("#tts-output:not([hidden])");
  assert.equal(await page.locator("[data-conversion]").count(), 1);
  assert.deepEqual([calls.at(-1).rate, calls.at(-1).pitch], [-10, 5]);
  await page.locator("#tts-speed").selectOption("1.25");
  assert.equal(
    await page.locator("#tts-player").evaluate((e) => e.playbackRate),
    1.25,
  );
  const [mp3] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#tts-download").click(),
  ]);
  await mp3.saveAs(path.join(out, "converter.mp3"));
  assert(fs.statSync(path.join(out, "converter.mp3")).size > 1000);
  check(
    "Text → MP3 synthesizes with pitch/rate, saves history and downloads a real MP3",
  );
  await uiClick(page, "#sync-settings");
  await uiClick(page, "#retry-sync");
  await page.waitForFunction(() =>
    document.querySelector("#save-state").textContent.includes("Đã đồng bộ"),
  );
  await uiClick(page, '[data-close="sync-dialog"]');
  await uiClick(second, "#tts-tab");
  await second.waitForSelector("[data-conversion]");
  await uiClick(second, "[data-conversion]");
  await second.waitForSelector("#tts-output:not([hidden])");
  assert.equal(await second.locator("#tts-speed").inputValue(), "1.25");
  check("conversion history and playback settings synchronize across devices");
  await page.screenshot({ path: path.join(out, "converter-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert(
    await page.evaluate(
      () => document.querySelector("#tts-generate").getBoundingClientRect().bottom <= innerHeight,
    ),
  );
  await page.screenshot({ path: path.join(out, "converter-mobile.png") });
  await uiClick(page, "#tts-study");
  await page.waitForSelector("#workspace:not([hidden])");
  assert.equal(await page.locator("#lesson-title").innerText(), "My first MP3");
  await page.screenshot({ path: path.join(out, "practice-mobile.png") });
  check("MP3 conversion becomes a study lesson; mobile keeps primary action accessible without horizontal overflow");
  await page.setViewportSize({ width: 1365, height: 850 });
  await page.screenshot({ path: path.join(out, "practice-desktop.png") });
  const raw = JSON.stringify(
    [...databases.values()].map((db) => [
      ...db.entries.values(),
      ...db.chunks.values(),
    ]),
  );
  assert(!raw.includes("Review tomorrow"));
  assert(!raw.includes("Good morning"));
  check("cloud records contain ciphertext rather than lesson text");
  offline = true;
  await uiClick(page, "#show-notes");
  await page.locator("#lesson-notes").fill("Saved while offline");
  await uiClick(page, '[data-close="notes-dialog"]');
  await uiClick(page, "#change-lesson");
  assert(await page.locator("#empty").isVisible());
  offline = false;
  await uiClick(page, "#sync-settings");
  await uiClick(page, "#retry-sync");
  await page.waitForFunction(() =>
    document.querySelector("#save-state").textContent.includes("Đã đồng bộ"),
  );
  await uiClick(page, '[data-close="sync-dialog"]');
  check("offline edits survive changing lessons and retry successfully");
  await uiClick(page, "#tts-tab");
  await uiClick(page, "#tts-clear");
  await page.locator("#tts-text").fill(fixtures[1].text);
  ttsDelay = 1200;
  await uiClick(page, "#tts-generate");
  await uiClick(page, "#new");
  await page.locator("#new-title").fill("Created during conversion");
  await page.locator("#new-text").fill("Good morning.");
  await uiClick(page, "#analyse");
  await uiClick(page, "#create-confirm");
  await page.waitForSelector("#workspace:not([hidden])");
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal(
    await page.locator("#lesson-title").innerText(),
    "Created during conversion",
  );
  assert(await page.locator("#workspace").isVisible());
  ttsDelay = 0;
  check(
    "creating a study lesson cancels an unfinished MP3 conversion without replacing the active lesson",
  );
  const invalid = await create();
  await invalid.goto(url + "/#sync=broken");
  await invalid.waitForSelector("#demo");
  assert(
    (await invalid.locator("#global-status").innerText()).includes(
      "không hợp lệ",
    ),
  );
  await uiClick(invalid, "#demo");
  await invalid.waitForSelector("#workspace:not([hidden])");
  check("a malformed sync link reports an error and the app remains usable");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "upgrade-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page.screenshot({ path: path.join(out, "upgrade-failure.png") });
  console.error(
    "PASSED",
    report,
    "ERRORS",
    errors,
    "CALLS",
    calls.map((c) => [c.voice, c.rate, c.pitch]),
  );
  throw e;
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  server.close();
}
