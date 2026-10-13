import {uiClick,uiCheck} from "./ui-controls.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url)),
  config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"))),
  live = JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/tts.json")),
  );
const outputDir = path.resolve(
  process.env.TEST_OUTPUT_DIR || path.join(root, "test-output"),
);
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = (name) => path.join(outputDir, name);
let calls = [],
  mode = "normal";
const server = http.createServer(async (req, res) => {
  for (const h of config.headers[0].headers) res.setHeader(h.key, h.value);
  if (req.url === '/api/translate') {
    let body = ''; for await (const chunk of req) body += chunk;
    const items = JSON.parse(body).items;
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({translations:items.map(item=>({...item,translation:'Bản dịch fixture: '+item.text,provider:'fixture'})),failed:[]}));
  }
  if (req.url === "/api/tts") {
    let text = "";
    for await (const b of req) text += b;
    const payload = JSON.parse(text);
    calls.push(payload);
    if (mode === "slow") await new Promise((r) => setTimeout(r, 1500));
    if (mode === "error" || mode === "offline") {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end('{"error":"Service unavailable"}');
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(live));
  }
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  const types = {
    ".html": "text/html",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
  };
  try {
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "text/plain",
    });
    res.end(fs.readFileSync(path.join(root, "public", file)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
  headless: true,
});
const newContext = browser.newContext.bind(browser);
browser.newContext = async (options) => {
  const context = await newContext(options);
  await context.route("**/firebase-adapter.mjs", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function createTransport(){return {list:async()=>{throw Error('Offline fixture')},watch:()=>()=>{}};}",
    }),
  );
  return context;
};
const report = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 1365, height: 1000 },
  permissions: ["microphone"],
  acceptDownloads: true,
});
await context.addInitScript(() => {
  window.__streams = [];
  const original = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (args) => {
    const s = await original(args);
    window.__streams.push(s);
    return s;
  };
  class Recognition {
    start() {
      if (window.__lateASR) return;
      setTimeout(() => {
        const row = [
          {
            transcript:
              window.__asrText ||
              "Good morning. Could I have a cup of tea, please?",
          },
        ];
        row.isFinal = true;
        this.onresult?.({ resultIndex: 0, results: [row] });
      }, 250);
    }
    stop() {
      if (window.__lateASR)
        setTimeout(() => {
          const row = [
            { transcript: "Good morning. Could I have a cup of tea, please?" },
          ];
          row.isFinal = true;
          this.onresult?.({ resultIndex: 0, results: [row] });
          this.onend?.();
        }, 650);
      else this.onend?.();
    }
    abort() {}
  }
  window.SpeechRecognition = Recognition;
});
let page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const check = (name, details = {}) =>
  report.push({ name, status: "passed", ...details });
try {
  await page.goto(url);
  assert(await page.locator("#empty").isVisible());
  await uiClick(page, "#new");
  await page.locator("#new-title").fill("Café conversation");
  await page
    .locator("#new-text")
    .fill(
      "Alice: Good morning. Could I have a cup of tea, please?\nRyan: Yes, of course.",
    );
  await uiClick(page, "#analyse");
  assert.equal(await page.locator(".preview-row").count(), 3);
  await uiClick(page, '[data-merge="1"]');
  assert(
    (await page.locator("#create-error").innerText()).includes(
      "khác người nói",
    ),
  );
  assert.equal(await page.locator(".preview-row").count(), 3);
  check("merging different dialogue roles is rejected");
  await uiClick(page, '[data-merge="0"]');
  assert.equal(await page.locator(".preview-row").count(), 2);
  await uiClick(page, "#create-confirm");
  await page.waitForSelector("#workspace:not([hidden])");
  check("create, split, preview merge, dialogue roles");
  await uiClick(page, "#play");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  await uiClick(page, "#pause");
  assert(await page.locator("#model").evaluate((e) => e.paused));
  await page.locator("#seek").fill("2.3");
  await page.locator("#seek").dispatchEvent("input");
  await page.waitForFunction(() =>
    document
      .querySelector('#caption [data-word="8"]')
      .classList.contains("active"),
  );
  await uiClick(page, '[data-word="8"]');
  await page.waitForFunction(() => document.querySelector("#model").paused);
  assert(await page.locator("#model").evaluate((e) => e.currentTime <= 2.8));
  check("play, pause, seek, actual word timings, word replay");
  await uiClick(page, "#next");
  await uiClick(page, "#play");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  assert.equal(calls.at(-1).voice, "en-GB-RyanNeural");
  await uiClick(page, "#stop");
  await uiClick(page, "#prev");
  check("speaker voice mapping, stop and navigation");
  await uiClick(page, '[data-mode="dict"]');
  assert(await page.locator("#caption").isHidden());
  await page
    .locator("#dict-answer")
    .fill("Good morning. I have a cup of tea, please?");
  await uiClick(page, "#check");
  assert((await page.locator("#dict-result .missing").count()) > 0);
  await uiClick(page, "#hint");
  assert((await page.locator("#hint-text").innerText()).includes("chữ cái"));
  await uiClick(page, "#hint");
  await uiClick(page, "#hint");
  await uiClick(page, "#hint");
  assert((await page.locator("#hint-text").innerText()).includes("Đáp án"));
  await uiClick(page, "#retry");
  await page
    .locator("#dict-answer")
    .fill("Good morning. Could I have a cup of tea, please?");
  await uiClick(page, "#check");
  assert.equal(
    await page.locator("#dict-result .result-score").innerText(),
    "100%",
  );
  check("dictation missing word, four hints, retry, perfect answer");
  await uiCheck(page, "#strict", true);
  await page
    .locator("#dict-answer")
    .fill("good morning could i have a cup of tea please");
  await uiClick(page, "#check");
  assert.notEqual(
    await page.locator("#dict-result .result-score").innerText(),
    "100%",
  );
  await uiCheck(page, "#strict", false);
  await page.locator("#dict-type").selectOption("blanks");
  const answers = ["Could", "a", "tea"];
  const inputs = page.locator("[data-blank]");
  assert.equal(await inputs.count(), 3);
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(answers[i]);
  await uiClick(page, "#check");
  assert.equal(
    await page.locator("#dict-result .result-score").innerText(),
    "100%",
  );
  check("strict grading and fill in blanks");
  await uiClick(page, '[data-mode="shadow"]');
  await uiClick(page, "#record");
  await page.waitForSelector("#finish-record:not([hidden])");
  await page.waitForFunction(() =>
    document.querySelector("#spoken-text").value.includes("tea"),
  );
  await new Promise((r) => setTimeout(r, 800));
  await uiClick(page, "#finish-record");
  await page.waitForSelector("#record-playback:not([hidden])");
  await page.waitForFunction(
    () =>
      document.querySelector("#speech-result .result-score")?.textContent ===
      "100%",
  );
  assert(
    await page.evaluate(() =>
      window.__streams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  );
  check(
    "actual MediaRecorder, mocked recognition, comparison and track cleanup",
  );
  assert.equal(await page.locator('#speech-comparison').getAttribute('open'),null);
  await page.locator('#speech-details > summary').click();
  const originalTranscript = await page.locator('#spoken-text').inputValue();
  await page.locator('#spoken-text').fill('Good morning.');
  assert(await page.locator('#recognition-original').isVisible());
  await page.locator('#recognition-original > summary').click();
  assert.equal(await page.locator('#recognition-original-text').innerText(),originalTranscript);
  assert.equal(await page.locator('#speech-result').getAttribute('data-stale'),'true');
  await page.locator('#spoken-text').fill(originalTranscript);
  assert(await page.locator('#recognition-original').isHidden());
  await page.locator('#speech-details > summary').click();
  check('recognized transcript stays distinguishable from learner edits in the recording session');
  const [rec] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-record").click(),
  ]);
  await rec.saveAs(outputFile("recording.webm"));
  assert(fs.statSync(outputFile("recording.webm")).size > 100);
  check("recording download");
  await page.evaluate(() => (window.__lateASR = true));
  await uiClick(page, "#record");
  await page.waitForSelector("#finish-record:not([hidden])");
  await uiClick(page, "#finish-record");
  await page.waitForSelector("#finish-record", { state: "hidden" });
  assert((await page.locator("#spoken-text").inputValue()).includes("tea"));
  await page.evaluate(() => (window.__lateASR = false));
  check("late final recognition result retained when recording stops");

  await uiClick(page, "#show-settings");
  const [fullMP3] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-all").click(),
  ]);
  await fullMP3.saveAs(outputFile("full-lesson.mp3"));
  assert(fs.statSync(outputFile("full-lesson.mp3")).size > 1000);
  check("download combined MP3 of all dialogue turns");
  await page.locator("#gap").fill("0.2");
  await page.locator("#gap").dispatchEvent("change");
  await uiCheck(page, "#auto-record", false);
  await uiClick(page, '[data-close="settings-dialog"]');
  await page.locator("#shadow-mode").selectOption("delayed");
  await uiClick(page, "#shadow-run");
  await page.waitForFunction(
    () => document.querySelector("#shadow-run").disabled,
  );
  await uiClick(page, "#next");
  await page.waitForFunction(() =>
    document.querySelector("#sentence-position").textContent.includes("2 / 2"),
  );
  assert(await page.locator("#shadow-run").isEnabled());
  check("cancel delayed flow on sentence change without deadlock");
  await page.locator("#shadow-mode").selectOption("simultaneous");
  await uiCheck(page, "#auto-record", true);
  await uiClick(page, "#shadow-run");
  await page.waitForSelector("#finish-record:not([hidden])");
  await uiClick(page, "#stop");
  await page.waitForFunction(
    () => document.querySelector("#shadow-run").disabled === false,
  );
  assert(
    await page.evaluate(() =>
      window.__streams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  );
  check("cancel simultaneous recording, release microphone");
  await uiClick(page, "#prev");
  await page.locator("#speed").selectOption("2");
  await uiCheck(page, "#auto-record", true);
  for (const flow of ["repeat", "simultaneous", "delayed", "continuous"]) {
    await page.locator("#shadow-mode").selectOption(flow);
    await uiClick(page, "#shadow-run");
    await page.waitForFunction(
      () => document.querySelector("#shadow-run").disabled === false,
      null,
      { timeout: 25000 },
    );
    assert(
      await page.evaluate(() =>
        window.__streams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
    );
  }
  check("all four shadowing flows complete and release microphone");
  await page.locator("#speed").selectOption("1");
  // Feed a real WebAudio stream that becomes silent; ASR remains a simulation.
  await page.evaluate(() => {
    window.__beforeSilence = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = (window.__silenceContext = new AudioContext()),
        osc = ctx.createOscillator(),
        dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      setTimeout(() => osc.stop(), 400);
      window.__streams.push(dest.stream);
      return dest.stream;
    };
  });
  await uiClick(page, "#record");
  await page.waitForSelector("#finish-record:not([hidden])");
  await page.waitForSelector("#finish-record", {
    state: "hidden",
    timeout: 7000,
  });
  assert(await page.locator("#record-playback").isVisible());
  await page.evaluate(async () => {
    navigator.mediaDevices.getUserMedia = window.__beforeSilence;
    await window.__silenceContext.close();
  });
  check("automatic recording stop after speech-like signal then silence");

  await uiClick(page, "#prev");
  await uiClick(page, "#show-notes");
  await page.locator("#notes").fill("Practise the word tea.");
  await uiClick(page, '[data-close="notes-dialog"]');
  await uiClick(page, "#star");
  await uiClick(page, '[data-mode="review"]');
  assert((await page.locator(".mistake-row").count()) > 0);
  assert(
    (await page.locator("#due-list").innerText()).includes("Good morning"),
  );
  check("review errors, difficult sentences and notes");
  await uiClick(page, "#export");
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-confirm").click(),
  ]);
  await file.saveAs(outputFile("course.shadow.json"));
  const saved = JSON.parse(fs.readFileSync(outputFile("course.shadow.json")));
  assert(saved.assets.recordings[saved.lesson.sentences[0].id]);
  assert(Object.keys(saved.assets.full || {}).length >= 1);
  assert(saved.lesson.progress[saved.lesson.sentences[0].id].dict.hints >= 4);
  assert(
    saved.lesson.progress[saved.lesson.sentences[0].id].notes ===
      "Practise the word tea.",
  );
  check("export retains audio, recording, progress, errors, notes and hints");
  await context.close();
  const fresh = await browser.newContext({
    viewport: { width: 1365, height: 1000 },
    permissions: ["microphone"],
    acceptDownloads: true,
  });
  page = await fresh.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  assert(await page.locator("#empty").isVisible());
  await page
    .locator("#lesson-file")
    .setInputFiles(outputFile("course.shadow.json"));
  await page.waitForSelector("#workspace:not([hidden])");
  await uiClick(page, '[data-mode="listen"]');
  mode = "offline";
  const before = calls.length;
  await uiClick(page, "#play");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  await uiClick(page, "#stop");
  assert.equal(calls.length, before);
  await uiClick(page, '[data-mode="shadow"]');
  assert(await page.locator("#record-playback").isVisible());
  check("fresh-browser file import and offline cached playback");
  mode = "normal";
  await page.reload();
  await page.locator("[data-lesson]").first().click();
  await uiClick(page, '[data-mode="dict"]');
  assert((await page.locator("#dict-stats").innerText()).includes("Gợi ý 4"));
  check("localStorage restores progress without storing media");
  // Race: navigate while a cold synthesis request is pending.
  await uiClick(page, '[data-mode="listen"]');
  mode = "slow";
  await uiClick(page, "#play");
  await uiClick(page, "#next");
  await page.waitForFunction(() =>
    document.querySelector("#sentence-position").textContent.includes("2 / 2"),
  );
  await new Promise((r) => setTimeout(r, 1800));
  assert(await page.locator("#model").evaluate((e) => e.paused));
  check("cancel in-flight synthesis on navigation");
  mode = "normal";
  // Timed source creation and source-interval stop.
  await uiClick(page, "#new");
  await page.locator("#new-title").fill("Timed source");
  await page
    .locator("#new-text")
    .fill(
      "1\n00:00:00,000 --> 00:00:01,050\nAlice: Good morning.\n\n2\n00:00:01,250 --> 00:00:03,500\nRyan: Could I have a cup of tea, please?",
    );
  await uiClick(page, "#analyse");
  await uiClick(page, "#create-confirm");
  await page.locator("#source-file").setInputFiles({
    name: "source.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(live.audio, "base64"),
  });
  await page.waitForFunction(
    () => document.querySelector("#source").value === "original",
  );
  await uiClick(page, "#play");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  await page.waitForFunction(() => document.querySelector("#model").paused);
  assert(
    await page
      .locator("#model")
      .evaluate((e) => Math.abs(e.currentTime - 1.05) < 0.12),
  );
  await uiClick(page, '[data-word="0"]');
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  await page.waitForFunction(() => document.querySelector("#model").paused);
  assert(
    (await page.locator("#global-status").innerText()).includes(
      "chưa có mốc từng từ",
    ),
  );
  check("original MP3, SRT synchronization, cue stop and honest word replay");
  await page.locator("#source-file").setInputFiles({
    name: "source.mp4",
    mimeType: "video/mp4",
    buffer: fs.readFileSync(path.join(root, "tests/fixtures/source.mp4")),
  });
  await page.waitForSelector("#stage.has-video");
  await uiClick(page, "#play");
  await page.waitForFunction(() => !document.querySelector("#model").paused);
  assert(await page.locator("#model").isVisible());
  await page.waitForFunction(() => document.querySelector("#model").paused);
  assert(
    await page
      .locator("#model")
      .evaluate((e) => Math.abs(e.currentTime - 1.05) < 0.12),
  );
  check("original MP4 video with caption overlay and sentence boundary stop");
  await uiClick(page, "#edit-sentence");
  await page.locator("#edit-start").fill("2");
  await page.locator("#edit-end").fill("1");
  await uiClick(page, '#edit-form button[type="submit"]');
  assert((await page.locator("#edit-error").innerText()).includes("lớn hơn"));
  await uiClick(page, '[data-close="edit-dialog"]');
  await uiClick(page, '#confirm-accept');
  await page.waitForSelector('#edit-dialog:not([open])',{state:'attached'});
  check("reject reversed source timestamps");
  await uiClick(page, "#export");
  const [sourceFile] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-confirm").click(),
  ]);
  await sourceFile.saveAs(outputFile("source-course.shadow.json"));
  assert(
    JSON.parse(fs.readFileSync(outputFile("source-course.shadow.json"))).assets
      .source.data,
  );
  check("source audio included in portable file");
  await page.screenshot({ path: outputFile("desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 920 });
  await uiClick(page, '[data-mode="dict"]');
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: outputFile("mobile.png"), fullPage: true });
  check("desktop and mobile layouts, no horizontal overflow");
  const oldTitle = await page.locator("#lesson-title").innerText();
  await page.locator("#lesson-file").setInputFiles({
    name: "broken.shadow.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#global-status")
      .textContent.includes("không đọc được"),
  );
  assert.equal(await page.locator("#lesson-title").innerText(), oldTitle);
  check("invalid lesson file preserves current lesson");

  // Unsupported ASR remains usable as a recorder.
  await uiClick(page, '[data-mode="shadow"]');
  await page.evaluate(() => {
    delete window.SpeechRecognition;
    window.webkitSpeechRecognition = undefined;
  });
  await uiClick(page, "#record");
  await page.waitForSelector("#finish-record:not([hidden])");
  assert(
    (await page.locator("#record-state").innerText()).includes("chưa hỗ trợ"),
  );
  await new Promise((r) => setTimeout(r, 600));
  await uiClick(page, "#finish-record");
  await page.waitForSelector("#record-playback:not([hidden])");
  check("unsupported recognition still records without fake score");
  // Permission denial is an explicit message, not a stuck recorder.
  await page.evaluate(
    () =>
      (navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Denied", "NotAllowedError");
      }),
  );
  await uiClick(page, "#record");
  await page.waitForFunction(() =>
    document.querySelector("#global-status").classList.contains("error"),
  );
  assert(await page.locator("#finish-record").isHidden());
  check("microphone permission denial handled");
  // Storage failures keep lessons available for explicit file export.
  const blocked = await browser.newContext({ acceptDownloads: true });
  await blocked.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  const blockedPage = await blocked.newPage();
  blockedPage.on("pageerror", (e) => errors.push(e.message));
  await blockedPage.goto(url);
  await uiClick(blockedPage, "#demo");
  await blockedPage.waitForSelector("#workspace:not([hidden])");
  assert(
    (await blockedPage.locator("#global-status").innerText()).includes(
      "xuất bài",
    ),
  );
  await uiClick(blockedPage, "#export");
  const [safeFile] = await Promise.all([
    blockedPage.waitForEvent("download"),
    blockedPage.locator("#export-confirm").click(),
  ]);
  await safeFile.saveAs(outputFile("blocked-storage.shadow.json"));
  assert(
    JSON.parse(fs.readFileSync(outputFile("blocked-storage.shadow.json")))
      .lesson.sentences.length > 0,
  );
  check("blocked localStorage still permits learning and file export");
  await blocked.close();
  const corrupt = await browser.newContext();
  await corrupt.addInitScript(() =>
    localStorage.setItem("shadow-dictation-library-v2", "{broken"),
  );
  const corruptPage = await corrupt.newPage();
  corruptPage.on("pageerror", (e) => errors.push(e.message));
  await corruptPage.goto(url);
  await uiClick(corruptPage, "#demo");
  await corruptPage.waitForSelector("#workspace:not([hidden])");
  assert.equal(
    await corruptPage.evaluate(() =>
      localStorage.getItem("shadow-dictation-library-v2"),
    ),
    "{broken",
  );
  check("corrupt localStorage preserved without silent overwrite");
  await corrupt.close();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    outputFile("ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page.screenshot({ path: outputFile("failure.png"), fullPage: true });
  console.error(
    "COMPLETED",
    report.map((x) => x.name),
  );
  console.error("PAGE_ERRORS", errors);
  throw e;
} finally {
  await browser.close();
  server.close();
}
