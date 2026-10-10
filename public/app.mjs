import * as C from "./core.mjs";
import { LessonStore } from "./store.mjs";
import {
  AudioEngine,
  delay,
  fromBase64,
  toBase64,
  abortError,
  joinMP3,
} from "./audio.mjs";
import { Capture } from "./capture.mjs";
import { workspaceIdentity } from "./crypto-sync.mjs";
import { MediaStore } from "./media-store.mjs";
import { CloudSync, PREFERENCES_ID } from "./cloud.mjs";
import {SyncMigration} from './sync-migration.mjs';
import {readLegacy, clearLegacy} from './legacy.mjs';
import { Converter } from "./converter.mjs";
import { notify, confirmAction, openPanel, initPresentation, renderLessonUI, syncPlayback, icon, noteRecognition, resetRecognitionView } from "./presentation.mjs";
import { TranslationQueue, paragraphText, translationSignature, hasCurrentTranslation } from "./translation.mjs";
import { initExperience, syncExperience, experiencePreferences, restoreExperience, learningFeedback } from "./experience.mjs";
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let identity,
  identityError = "";
try {
  identity = await workspaceIdentity();
} catch (e) {
  identityError = e.message;
  const clean = new URL(location.href);
  clean.hash = "";
  identity = await workspaceIdentity(undefined, clean);
}
history.replaceState(null, "", identity.resumeURL);
const legacy = readLegacy(identity);
const store = new LessonStore().load(),
  assetLibrary = new Map(),
  media = new MediaStore();
store.lessons = legacy.lessons;
store.storage.setItem('shadowlab-pending-' + identity.scope, JSON.stringify(legacy.pending));
if (legacy.preferences) restoreExperience(legacy.preferences);
store.current = null;
let appTab = "study",
  preloadController = null,
  conflictId = null,
  migration = null;
const savedSnapshots = new Map(),
  assetIds = new WeakMap();
let assetSerial = 0;
function assetIdentity(v) {
  if (!v) return 0;
  if (!assetIds.has(v)) assetIds.set(v, ++assetSerial);
  return assetIds.get(v);
}
function snapshot(id) {
  const l = store.lessons.find((l) => l.id === id);
  if (!l) return "deleted";
  const copy = { ...l };
  delete copy.updatedAt;
  const a = assetLibrary.get(id);
  return JSON.stringify([
    copy,
    a
      ? ["tts", "full", "recordings"]
          .map((type) =>
            Object.entries(a[type] || {}).map(([k, v]) => [
              k,
              assetIdentity(v),
            ]),
          )
          .concat([assetIdentity(a.source)])
      : null,
  ]);
}
const sync = new CloudSync({
  identity,
  store,
  media,
  legacyLessons: legacy.lessons.length > 0,
  initialPreferences: legacy.preferences,
  beforeRemote: id => { if (saveTimers.has(id)) void persist(true, id); },
  onReady: () => migration?.run(),
  onPreferences: value => restoreExperience(value),
  onStatus: (state, text) => {
    if (state === 'synced' && migration?.pending) {
      state = 'pending'; text = 'Đang hợp nhất dữ liệu cũ vào Firebase dùng chung…';
    }
    $("save-state").textContent = state === "synced"
      ? text.includes("xung đột") ? "Cần chọn phiên bản" : "Đã đồng bộ"
      : state === "pending" ? "Chờ đồng bộ" : state === "error" ? "Lỗi đồng bộ" : text;
    $("sync-settings").dataset.state = state;
    $("sync-settings").title = text + " · Đồng bộ Firebase";
    $("sync-detail").textContent = text;
    if (state === 'synced' && !sync.dirty.size && !sync.conflicts.size) clearLegacy(legacy);
  },
  onChange: (id) => {
    renderLibrary();
    converter?.renderHistory();
    if (store.current === id && !(appTab === "tts" && converter?.controller)) {
      safe(async () => {
        await stopAll();
        if (appTab === "tts") {
          if (store.selected()) await converter.open(id);
          else await converter.clear();
        } else await hydrate(id, true);
        render();
        startAutoTranslation(appTab === "study" ? lesson() : null);
      })();
    }
  },
  onConflict: (id) => {
    conflictId = id;
    $("conflict-detail").textContent =
      id === PREFERENCES_ID ? 'Cài đặt giao diện đã thay đổi trên thiết bị khác.'
        : "Bài: " + (store.lessons.find((l) => l.id === id)?.title || "Bài đã xóa");
    if (!$("conflict-dialog").open) $("conflict-dialog").showModal();
  },
});
migration = new SyncMigration({sync, sources: identity.sources,
  onComplete: () => history.replaceState(null, '', identity.url)});
let preview = [],
  runController = null,
  prepareController = null,
  mp3Controller = null,
  saveTimers = new Map(),
  recordOwner = null,
  recordURL = null,
  dictType = "full",
  resultCache = new Map(),
  flowKind = "",
  hintTarget = 0,
  creating = false,
  activeJob = null,
  savingCount = 0,
  recordingStorageWarned = false;
function tracked(fn) {
  const p = fn();
  activeJob = p;
  p.finally(() => {
    if (activeJob === p) activeJob = null;
  }).catch(() => {});
  return p;
}
function lesson() {
  return store.selected();
}
function sentence() {
  const l = lesson();
  return l?.sentences[l.cursor];
}
function progress() {
  return lesson()?.progress[sentence()?.id];
}
function assets(id = lesson()?.id) {
  if (!assetLibrary.has(id))
    assetLibrary.set(id, { tts: {}, full: {}, recordings: {}, source: null });
  return assetLibrary.get(id);
}
function say(text, kind = "") {
  notify(text, kind);
}
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e.name !== "AbortError") {
        const text =
          e.name === "NotAllowedError"
            ? "Trình duyệt chưa cho phép phát hoặc dùng microphone. Hãy cấp quyền rồi thử lại."
            : e.message || "Thao tác chưa hoàn thành.";
        const box = document.querySelector("dialog[open] .error-text");
        if (box) box.textContent = text;
        else say(text, "error");
      }
    }
  };
}
function persist(immediate = false, id = store.current) {
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  const save = async () => {
    savingCount++;
    try {
      const signature = id ? snapshot(id) : null,
        changed = id && savedSnapshots.get(id) !== signature;
      if (changed) {
        const l = store.lessons.find((l) => l.id === id);
        if (l) l.updatedAt = Date.now();
      }
      try {
        store.save();
      } catch (e) {
        say(e.message, "error");
      }
      if (id && changed) {
        if (assetLibrary.has(id)) media.memory.set(identity.scope + ':' + id, assets(id));
        sync.mark(id);
        savedSnapshots.set(id, signature);
        try {
          if (assetLibrary.has(id))
            await media.put(identity.scope + ":" + id, assets(id));
        } catch (e) {
          say(e.message, "error");
        }
        if (immediate) void sync.flush();
      }
    } finally { savingCount--; }
  };
  if (immediate) return save();
  else saveTimers.set(id, setTimeout(() => { saveTimers.delete(id); save(); }, 200));
}
function putLesson(l) {
  try {
    store.upsert(l);
    persist();
    return true;
  } catch (e) {
    say(e.message, "error");
    return false;
  }
}
const translationRetryAt = new Map();
const translations = new TranslationQueue({
  save: async (l) => {
    if (store.lessons.includes(l)) await persist(true, l.id);
  },
  change: (l) => {
    if (lesson()?.id !== l.id || appTab !== "study") return;
    if (l.mode !== "review") renderCaption();
    renderTranslationDialog();
  },
  status: (l, state) => {
    if (state === "partial") translationRetryAt.set(l.id, Date.now() + 120000);
    if (lesson()?.id !== l.id || appTab !== "study") return;
    if (state === "complete") say("Đã dịch từng câu và toàn bài. Theo dõi trạng thái đồng bộ Firebase.", "success");
    else if (state === "partial") say(l.translationData?.error || "Bài vẫn được giữ. Mở Bản dịch toàn bài để thử lại.");
  },
});
function startAutoTranslation(l, force = false) {
  if (!l || l.kind === "tts" || !store.lessons.includes(l)) return;
  // A downloaded browser model can translate offline.
  if (!force && Date.now() < (translationRetryAt.get(l.id) || 0)) return;
  return translations.ensure(l);
}
// Warm the model from a real click, before async save/audio work loses user activation.
// Existing controls are reused; creating a lesson never waits for this download.
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("button");
  if (!button || button.disabled) return;
  const action = button.matches("#create-confirm,#demo,#tts-study,#open-file,#show-full-translation,#retry-translation,#edit-form .primary,[data-lesson]");
  const current = appTab === "study" ? lesson() : null;
  const pending = current && current.kind !== "tts" &&
    (!current.translationData?.paragraph || current.translationData.signature !== translationSignature(current) ||
     current.sentences.some(s => !hasCurrentTranslation(s)));
  if (!action && (!pending || translations.browserReady)) return;
  translations.prepare().then(() => {
    startAutoTranslation(appTab === "study" ? lesson() : null, true);
  }).catch(() => { /* The lesson job reports an actionable error without blocking this click. */ });
}, {capture: true});
function renderTranslationDialog() {
  const l = lesson();
  if (!l || l.kind === "tts") return;
  const data = l.translationData;
  const current = data?.signature === translationSignature(l);
  $("paragraph-original").textContent = paragraphText(l);
  $("paragraph-translation").textContent = current && data?.paragraph
    ? data.paragraph : data?.status === "pending" ? "Đang tạo bản dịch toàn bài…" : "Bản dịch toàn bài chưa sẵn sàng. Nhấn Dịch phần còn thiếu.";
  const done = l.sentences.filter(hasCurrentTranslation).length;
  $("translation-state").textContent = data?.status === "pending"
    ? translations.downloadProgress !== null
      ? `Đang tải bộ dịch Anh → Việt · ${translations.downloadProgress}%`
      : `Đang dịch · ${done}/${l.sentences.length} câu`
    : `${done}/${l.sentences.length} câu đã có bản dịch${current && data?.paragraph ? " · Toàn bài đã lưu" : ""}`;
  $("translation-state").title = data?.error || "";
  $("retry-translation").disabled = translations.jobs.has(l.id);
}
function clock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
function voiceOptions(selected) {
  return C.VOICES.map(
    (v) =>
      `<option value="${v}" ${v === selected ? "selected" : ""}>${v.replace("en-GB-", "").replace("Neural", "")} · ${/Sonia|Libby/.test(v) ? "Nữ" : "Nam"}</option>`,
  ).join("");
}
const engine = new AudioEngine($("model"), onTime);
const converter = new Converter({
  store,
  assets,
  hydrate,
  persist,
  download,
  voiceOptions,
  onError: say,
  onSelect: (l) => {
    store.current = l?.id || null;
    render();
  },
  onStudy: selectLesson,
  beforeGenerate: async () => {
    await stopAll();
    await persist(true);
  },
});
const capture = new Capture({
  onText: (text, final) => {
    if (
      recordOwner?.lessonId === lesson()?.id &&
      recordOwner?.sentenceId === sentence()?.id
    ) {
      $("spoken-text").value = text;
      noteRecognition(text);
      $("record-state").textContent = final
        ? "Đã nhận diện xong bản chép."
        : "Đang nghe lời nói…";
    }
  },
  onState: (state, message) => {
    if (state === "asr-error") {
      $("record-state").textContent = message;
      say(message);
    } else if (state === "recording") {
      resetRecognitionView();
      $("record").hidden = true;
      $("finish-record").hidden = false;
      $("record-state").textContent =
        "Đang ghi âm · tự dừng sau khoảng 2 giây im lặng khi đã nói.";
    } else {
      $("record").hidden = false;
      $("finish-record").hidden = true;
    }
  },
  onAutoStop: () => {
    if (capture.active) {
      if (flowKind) capture.stop().catch((e) => say(e.message, "error"));
      else safe(finishRecording)();
    }
  },
});
function bindAssets() {
  engine.setAssets(assets());
}
function renderReaders() {
  $("speaker-voices").innerHTML = C.readerStats(lesson())
    .map(
      (r) =>
        `<div class="reader-row"><div><strong>${esc(r.name)}</strong><small>${r.sentences} câu · ${r.words} từ</small></div><label>Giọng UK<select data-reader="${esc(r.key)}" data-profile="voice">${voiceOptions(r.profile.voice)}</select></label><label>Tốc độ (%)<input data-reader="${esc(r.key)}" data-profile="rate" type="number" min="-50" max="50" step="5" value="${r.profile.rate}"></label><label>Cao độ (Hz)<input data-reader="${esc(r.key)}" data-profile="pitch" type="number" min="-50" max="50" step="5" value="${r.profile.pitch}"></label></div>`,
    )
    .join("");
}
async function hydrate(id, remote = false) {
  let a = await media.get(identity.scope + ":" + id);
  if (
    (remote || !a || a._cloudRevision !== sync.records.get(id)?.revision) &&
    !sync.dirty.has(id) &&
    sync.online
  ) {
    try {
      a = (await sync.loadAssets(id)) || a;
    } catch (e) {
      a ||= { tts: {}, full: {}, recordings: {}, source: null };
      a._partial = true;
      say("Chưa tải đủ audio Firebase: " + e.message, "error");
    }
  }
  if (a) assetLibrary.set(id, a);
  else assets(id);
  if (!sync.dirty.has(id)) savedSnapshots.set(id, snapshot(id));
  if (store.current === id) bindAssets();
  return a;
}
function preload() {
  preloadController?.abort();
  const l = lesson();
  if (!l || l.settings.source === "original") return;
  const ctl = new AbortController();
  preloadController = ctl;
  engine
    .ensureLesson(l, ctl.signal, (n, total) => {
      if (lesson()?.id === l.id)
        $("audio-status").textContent = `Tải trước giọng đọc · ${n}/${total}`;
    })
    .then(async () => {
      if (ctl.signal.aborted) return;
      await persist(true, l.id);
      if (lesson()?.id === l.id)
        $("audio-status").textContent = "Audio toàn bài đã sẵn sàng";
    })
    .catch((e) => {
      if (e.name !== "AbortError" && lesson()?.id === l.id)
        $("audio-status").textContent = "Có thể bấm phát để tạo lại audio";
    })
    .finally(() => {
      if (preloadController === ctl) preloadController = null;
    });
}
async function chooseLesson() {
  await stopAll();
  await persist(true);
  store.current = null;
  store.save();
  appTab = "study";
  render();
  sync.flush();
}
function renderLibrary() {
  const query = $("lesson-search").value.toLocaleLowerCase();
  const all = store.lessons.filter((l) => l.kind !== "tts");
  const list = all.filter((l) => l.title.toLocaleLowerCase().includes(query));
  $("lesson-count").textContent =
    `${all.length} bài học`;
  $("welcome").hidden = !!all.length;
  $("library").innerHTML =
    list
      .map(
        (l) =>
          `<button class="lesson-card ${l.id === store.current ? "active" : ""}" data-lesson="${esc(l.id)}"><strong>${esc(l.title)}</strong><small>${l.sentences.length} câu · ${C.readerStats(l).length} người đọc<br>${Object.values(l.progress).filter((p) => p.completed).length} hoàn tất · ${C.dueSentences(l).length} cần ôn</small><span class="card-footer"><span>Tiếp tục câu ${l.cursor + 1} →</span><span>${new Date(l.updatedAt).toLocaleDateString("vi-VN")}</span></span></button>`,
      )
      .join("") || (query ? '<p class="subtle">Không tìm thấy bài.</p>' : "");
  renderLessonUI(appTab === "study" ? lesson() : null);
}
function render() {
  syncExperience(appTab === "study" ? lesson() : null);
  renderLibrary();
  const l = lesson();
  $("tts-workspace").hidden = appTab !== "tts";
  $("study-tab").classList.toggle("active", appTab === "study");
  $("tts-tab").classList.toggle("active", appTab === "tts");
  $("empty").hidden = appTab !== "study" || !!l;
  $("workspace").hidden = appTab !== "study" || !l || l.kind === "tts";
  $("export").disabled = !l;
  $("show-full-translation").disabled = !l || l.kind === "tts" || l.mode === "dict";
  if ((!l || appTab !== "study" || l.mode === "dict") && $("translation-dialog").open)
    $("translation-dialog").close();
  if (!l || appTab !== "study" || l.kind === "tts") return;
  $("lesson-title").textContent = l.title;
  $("lesson-meta").textContent =
    `${l.sentences.length} câu · ${C.readerStats(l).length} người đọc · Tự lưu Firebase`;
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === l.mode);
    b.setAttribute(
      "aria-current",
      b.dataset.mode === l.mode ? "step" : "false",
    );
  });
  $("study").hidden = l.mode === "review";
  $("review-pane").hidden = l.mode !== "review";
  if (l.mode === "review") {
    renderReview();
    return;
  }
  renderPractice();
}
function renderPractice() {
  const l = lesson(),
    s = sentence(),
    p = progress();
  if (!s) return;
  if ($("speech-details").dataset.sentence !== s.id) {
    $("speech-details").open = false;
    $("speech-details").dataset.sentence = s.id;
    if (!capture.active) $("record-state").textContent = "";
  }
  $("sentence-position").textContent =
    `Câu ${l.cursor + 1} / ${l.sentences.length}`;
  $("speaker").textContent = s.speaker;
  $("timing-tag").textContent =
    s.timing === "estimated"
      ? "Mốc ước lượng"
      : s.start !== null
        ? "Mốc phụ đề"
        : "Giọng UK";
  $("star").textContent = s.star ? "★" : "☆";
  $("star").setAttribute("aria-pressed", String(s.star));
  $("prev").disabled = l.cursor === 0;
  $("next").disabled = l.cursor === l.sentences.length - 1;
  for (const mode of ["listen", "dict", "shadow"])
    $(`${mode}-pane`).hidden = l.mode !== mode;
  $("captions").checked = l.mode === "dict" ? false : l.settings.captions;
  $("show-translation").checked = l.settings.translation;
  $("auto-next").checked = l.settings.autoNext;
  $("strict").checked = l.settings.strict;
  $("speed").value = l.settings.speed;
  $("gap").value = l.settings.gap;
  $("repeat").value = l.settings.repeat;
  $("voice").innerHTML = voiceOptions(l.voice);
  $("source").value = l.settings.source;
  $("shadow-mode").value = l.settings.shadow;
  $("auto-record").checked = l.settings.autoRecord;
  $("role").innerHTML =
    '<option value="">Mọi vai</option>' +
    Object.keys(l.speakers)
      .map(
        (x) =>
          `<option value="${esc(x)}" ${l.settings.role === x ? "selected" : ""}>${esc(x)}</option>`,
      )
      .join("");
  renderReaders();
  $("source-name").textContent = l.sourceName
    ? `${l.sourceName}${assets().source ? "" : " · cần chọn lại file hoặc mở bài có kèm audio"}`
    : "Chưa có file gốc";
  $("dict-answer").value = p.dict.draft;
  dictType = l.settings.dictType || "full";
  $("dict-type").value = dictType;
  $("dict-answer").hidden = dictType === "blanks";
  $("blanks").hidden = dictType !== "blanks";
  renderBlanks();
  $("dict-result").innerHTML = "";
  $("speech-result").innerHTML = "";
  $("hint-text").hidden = true;
  $("spoken-text").value = p.shadow.transcript;
  $("notes").value = p.notes;
  $("lesson-notes").value = l.notes || "";
  const dr = resultCache.get(`${s.id}:dict`),
    sr = resultCache.get(`${s.id}:shadow`);
  if (dr) renderResult("dict-result", dr, false);
  if (sr) renderResult("speech-result", sr, true);
  renderDictStats();
  renderCaption();
  renderShadowDescription();
  renderRecording();
  $("jump").innerHTML = l.sentences
    .map(
      (x, i) =>
        `<option value="${i}" ${i === l.cursor ? "selected" : ""}>${i + 1}. ${esc(x.speaker || "Câu")} ${x.star ? "★" : ""}</option>`,
    )
    .join("");
  const completed = Object.values(l.progress).filter((x) => x.completed).length;
  $("lesson-progress").max = l.sentences.length;
  $("lesson-progress").value = completed;
  $("progress-text").textContent =
    `${completed}/${l.sentences.length} hoàn tất`;
  $("transcript-list").innerHTML = l.sentences
    .map(
      (x, i) =>
        `<button class="transcript-row ${i === l.cursor ? "active" : ""}" data-jump="${i}" aria-current="${i === l.cursor}"><small>${i + 1}${x.speaker ? " · " + esc(x.speaker) : ""}${x.star ? " ★" : ""}${l.progress[x.id].completed ? " ✓" : ""}</small><span>${l.mode === "dict" ? "Nội dung ẩn khi luyện Dictation" : esc(x.text)}</span></button>`,
    )
    .join("");
  $("speaker").textContent = s.speaker || "Người đọc";
  $("audio-status").title = $("audio-status").textContent;
  renderLessonUI(l);
}
function renderCaption() {
  const l = lesson(),
    s = sentence();
  if (!l || !s) return;
  const visible = l.mode !== "dict" && l.settings.captions;
  $("caption").hidden = !visible;
  $("caption-hidden").hidden = visible;
  $("caption-hidden").textContent =
    l.mode === "dict"
      ? "Nghe kỹ và ghi lại những gì bạn nghe."
      : "Phụ đề đang ẩn.";
  let i = 0;
  $("caption").innerHTML = s.text.replace(
    /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu,
    (m) =>
      C.tokens(m).length
        ? `<button data-word="${i++}" title="Nghe lại từ / câu">${esc(m)}</button>`
        : esc(m),
  );
  $("translation").hidden = !(l.settings.translation && l.mode !== "dict");
  $("translation").textContent =
    hasCurrentTranslation(s) ? s.translation
      : l.translationData?.status === "pending" ? "Đang tạo bản dịch tiếng Việt…"
      : "Bản dịch chưa sẵn sàng. Thử lại trong Bản dịch toàn bài.";
  $("stage").classList.toggle(
    "has-video",
    l.settings.source === "original" &&
      (assets().source?.mime || "").startsWith("video/"),
  );
}
function onTime(t) {
  if (!sentence()) return;
  let words = t.words;
  if (engine.current?.units && engine.current.lessonId === lesson().id) {
    const unit =
      [...engine.current.units].reverse().find((u) => t.time >= u.start) ||
      engine.current.units[0];
    const index = lesson().sentences.findIndex((s) => s.id === unit.id);
    if (index >= 0 && lesson().cursor !== index) {
      lesson().cursor = index;
      renderPractice();
      persist();
      const row = $("transcript-list").querySelector(`[data-jump="${index}"]`);
      if (row && lesson().mode === "listen" && $("sentence-dialog").open)
        row.scrollIntoView({ block: "nearest" });
    }
    if (flowKind && !engine.current.listened?.has(unit.id)) {
      engine.current.listened ||= new Set();
      engine.current.listened.add(unit.id);
      markListen(lesson(), sentence());
    }
    words = unit.words;
  } else if (engine.current?.sentenceId !== sentence().id) return;
  const elapsed = Math.max(0, t.time - t.start),
    duration = t.end - t.start;
  $("elapsed").textContent = clock(elapsed);
  $("duration").textContent = clock(duration);
  $("seek").disabled = false;
  $("seek").max = duration;
  $("seek").value = elapsed;
  $("pause").disabled = !engine.bound;
  $("pause").textContent = t.playing ? "Tạm dừng" : "Tiếp tục";
  updatePlaybackUI();
  const word = words.find((w) => t.time >= w.start && t.time < w.end)?.index;
  document
    .querySelectorAll("#caption [data-word]")
    .forEach((el) =>
      el.classList.toggle("active", Number(el.dataset.word) === word),
    );
}
function renderDictStats() {
  const p = progress()?.dict;
  if (p)
    $("dict-stats").textContent =
      `Nghe ${p.listens} lần · Gợi ý ${p.hints} lần · Kiểm tra ${p.totalAttempts} lần · Làm lại ${p.retries} lần · Điểm tốt nhất ${p.best}%`;
}
function renderBlanks() {
  if (!sentence()) return;
  const s = sentence(),
    p = progress().dict,
    indices = C.blankIndices(s.text),
    words = C.tokens(s.text);
  let i = 0;
  $("blanks").innerHTML = s.text.replace(
    /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu,
    (m) => {
      if (!C.tokens(m).length) return esc(m);
      const index = i++;
      return indices.includes(index)
        ? `<input data-blank="${index}" aria-label="Từ cần điền ${index + 1}" value="${esc(p.blanks[index] || "")}" autocomplete="off" spellcheck="false" maxlength="100">`
        : esc(words[index]);
    },
  );
}
function dictAnswer() {
  if (dictType === "full") return $("dict-answer").value;
  let i = 0;
  const blanks = progress().dict.blanks,
    indices = C.blankIndices(sentence().text);
  return sentence().text.replace(
    /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu,
    (m) => {
      const index = i++;
      return indices.includes(index) ? blanks[index] || "___" : m;
    },
  );
}
function renderResult(id, result, speech) {
  const labels = {
    correct: "Đúng",
    wrong: "Thay thế / sai",
    missing: "Thiếu",
    extra: "Thừa",
    moved: "Sai vị trí",
    "moved-extra": "Sai vị trí",
  };
  const tokens = `<div class="result-tokens">${result.ops.map((o) => `<button class="${o.type}" ${o.ref ? `data-error-word="${o.index}"` : "disabled"} aria-label="${esc(labels[o.type] + ': ' + (o.ref || o.actual))}" title="${esc(labels[o.type] + (o.kind ? " · " + o.kind : "") + (o.actual && o.actual !== o.ref ? " · Bạn: " + o.actual : ""))}">${esc(o.ref || o.actual)}${o.type === "missing" ? " ∅" : o.actual && o.actual !== o.ref ? " → " + esc(o.actual) : ""}</button>`).join("")}</div>`;
  const legend = '<details class="result-help"><summary>Cách đọc kết quả</summary><p class="result-legend">✓ Đúng · × Thay thế/sai · ∅ Thiếu · + Thừa · ↔ Sai vị trí. Bấm từ gốc để nghe lại; rê chuột để xem loại lỗi.</p></details>';
  if (speech) $(id).dataset.answer = progress().shadow.attempts.at(-1)?.answer || progress().shadow.transcript;
  $(id).innerHTML =
    `<div class="result-top"><span>${speech ? "Mức khớp bản chép" : "Mức khớp câu gốc"}<br><small>${speech ? "Khớp văn bản, không phải điểm phát âm" : result.strict ? "Có phân biệt chữ hoa và dấu câu" : "Bỏ qua chữ hoa và dấu câu"}</small></span><strong class="result-score">${result.score}%</strong></div>${speech ? `<details id="speech-comparison" class="comparison-details"><summary>Xem đối chiếu từng từ${icon('chevron-down')}</summary><div class="comparison-body">${tokens}${legend}</div></details>` : tokens + legend}`;
}
function renderShadowDescription() {
  const mode = lesson().settings.shadow;
  const text = {
    repeat:
      "Nghe mẫu → khoảng chờ → nói lại. Khi bật tự ghi âm, app ghi riêng lượt bạn nói.",
    simultaneous:
      "Nghe và nói cùng lúc. Dùng tai nghe để microphone không nhận lại giọng mẫu.",
    delayed:
      "Giọng mẫu phát trước; bạn bắt đầu nói sau độ trễ đã chọn và đuổi theo giọng đọc.",
    continuous:
      "Luyện từ câu hiện tại đến cuối bài, nối các câu liên tục. Vai được chọn sẽ có lượt chờ để bạn trả lời.",
  };
  $("shadow-description").textContent = text[mode];
}
function renderRecording() {
  if (recordURL) {
    URL.revokeObjectURL(recordURL);
    recordURL = null;
  }
  const owner = lesson().recordingMeta?.[sentence().id]?.owner || sentence().id;
  const rec = assets().recordings[owner];
  document.querySelector("#record-playback > label").textContent = lesson()
    .recordingMeta?.[sentence().id]?.continuous
    ? "Bản ghi lượt luyện liên tục"
    : "Bản ghi của bạn";
  $("record-playback").hidden = !rec;
  if (rec) {
    recordURL = URL.createObjectURL(rec.blob || fromBase64(rec.data, rec.mime));
    $("recorded").src = recordURL;
  } else {
    $("recorded").removeAttribute("src");
    $("recorded").load();
  }
}
function renderReview() {
  const l = lesson(),
    attempted = l.sentences.filter(
      (s) =>
        l.progress[s.id].dict.attempts.length ||
        l.progress[s.id].shadow.attempts.length,
    ).length,
    unresolved = l.mistakes.filter((m) => !m.resolved || m.dueAt <= Date.now()),
    due = C.dueSentences(l);
  $("review-summary").innerHTML =
    `<div class="review-stat"><strong>${attempted}/${l.sentences.length}</strong><small>Câu đã luyện</small></div><div class="review-stat"><strong>${unresolved.length}</strong><small>Từ cần kiểm tra/luyện</small></div><div class="review-stat"><strong>${due.length}</strong><small>Câu khó / đến hạn</small></div>`;
  $("mistakes").innerHTML =
    unresolved
      .sort((a, b) => b.count - a.count)
      .map((m) => {
        const index = l.sentences.findIndex((s) => s.id === m.sentenceId);
        return `<div class="mistake-row"><div><strong>${esc(m.word)}</strong><p>Câu ${index + 1} · ${m.mode === "shadow" ? "Bản chép lời nói" : esc(m.kind)} · ${m.count} lần · ${m.successes} lượt đúng</p></div><button class="outline" data-review-word="${esc(m.key)}">Nghe</button><button class="outline" data-review-sentence="${index}" data-review-mode="${m.mode}">Luyện câu</button><button class="quiet" data-resolved="${esc(m.key)}">Đã nhớ</button></div>`;
      })
      .join("") ||
    '<p class="subtle">Chưa có từ cần luyện. Hoàn thành một lượt dictation hoặc đối chiếu lời nói để tạo danh sách.</p>';
  $("due-list").innerHTML =
    due
      .map((s) => {
        const i = l.sentences.indexOf(s);
        return `<button class="transcript-row" data-review-sentence="${i}" data-review-mode="dict"><small>${i + 1}${s.star ? " ★" : ""}</small><span>${esc(s.text)}</span></button>`;
      })
      .join("") || '<p class="subtle">Chưa có câu đến hạn.</p>';
  $("review-run").disabled = !due.length;
}
async function stopAll() {
  const previous = activeJob;
  runController?.abort();
  runController = null;
  prepareController?.abort();
  prepareController = null;
  mp3Controller?.abort();
  mp3Controller = null;
  preloadController?.abort();
  preloadController = null;
  $("download-all").textContent = "↓ MP3 toàn bài · giọng UK";
  engine.stop();
  $("recorded").pause();
  if (capture.active || capture.stream) {
    const data = await capture.cancel();
    if (data && recordOwner) await keepRecording(data, false);
    recordOwner = null;
  }
  if (previous) await previous.catch(() => {});
  flowKind = "";
  $("play").disabled = false;
  $("shadow-run").disabled = false;
  $("listen-all").disabled = false;
  $("prepare").textContent = "Chuẩn bị audio";
  $("audio-status").textContent = "Đã dừng";
}
async function selectLesson(id) {
  await stopAll();
  await persist(true);
  await converter?.stop();
  appTab = "study";
  store.current = id;
  say("Đang mở bài và tải audio đã lưu…");
  await hydrate(id);
  if (store.current !== id) return;
  const opened = lesson();
  if (opened && opened.kind !== "tts" && !opened.settings.experience)
    { opened.settings.experience = experiencePreferences(); persist(true, id); }
  bindAssets();
  store.save();
  resultCache.clear();
  render();
  if (!assets(id)._partial) say("Đã mở bài và khôi phục thiết đặt.");
  preload();
  startAutoTranslation(lesson());
}
async function navigate(index, mode = null) {
  await stopAll();
  const l = lesson();
  l.cursor = Math.max(0, Math.min(l.sentences.length - 1, index));
  if (mode) l.mode = mode;
  l.updatedAt = Date.now();
  persist();
  render();
  $("elapsed").textContent = "0:00";
  $("duration").textContent = "0:00";
  $("seek").disabled = true;
  $("pause").disabled = true;
}
function markListen(l, s) {
  const p = l.progress[s.id];
  if (l.mode === "dict") p.dict.listens++;
  else if (l.mode === "shadow") p.shadow.listens++;
  else p.listen++;
  persist();
  if (l.id === lesson()?.id && s.id === sentence()?.id) renderDictStats();
}
async function playSentence() {
  await stopAll();
  const l = lesson(),
    s = sentence(),
    ctl = new AbortController();
  runController = ctl;
  $("play").disabled = true;
  $("audio-status").textContent = "Đang tạo/tải audio…";
  try {
    const c = await engine.prepare(l, s, ctl.signal);
    $("play").disabled = false;
    $("audio-status").textContent = engine.current.words.every((w) => w.exact)
      ? "Mốc từng từ từ dịch vụ giọng đọc"
      : l.settings.source === "original"
        ? "Mốc câu từ phụ đề · chưa căn chỉnh từng từ"
        : "Mốc từng từ có phần ước lượng";
    for (let i = 0; i < l.settings.repeat; i++) {
      markListen(l, s);
      await engine.segment(c.start, c.end, ctl.signal);
      if (i + 1 < l.settings.repeat)
        await delay(l.settings.gap * 1000, ctl.signal);
    }
    if (
      l.settings.autoNext &&
      l.mode === "listen" &&
      l.cursor < l.sentences.length - 1
    ) {
      l.cursor++;
      renderPractice();
      persist();
    }
  } finally {
    if (runController === ctl) {
      runController = null;
      $("play").disabled = false;
      $("audio-status").textContent = "Đã nghe xong";
    }
  }
}
async function hearWord(index, isolated = false) {
  if (capture.active) return say("Dừng ghi âm trước khi nghe từ mẫu.");
  await stopAll();
  const ctl = new AbortController();
  runController = ctl;
  const l = lesson(),
    s = sentence();
  markListen(l, s);
  $("audio-status").textContent = "Nghe lại từ trong câu…";
  try {
    await engine.word(l, s, Number(index), ctl.signal, isolated);
    if (engine.current?.source === "original")
      say("Audio gốc chưa có mốc từng từ: đã phát lại câu chứa từ đó.");
  } finally {
    if (runController === ctl) runController = null;
  }
}
async function startRecording() {
  await stopAll();
  const ctl = new AbortController();
  runController = ctl;
  recordOwner = { lessonId: lesson().id, sentenceId: sentence().id };
  try {
    await capture.start(ctl.signal);
    $("spoken-text").value = "";
  } catch (e) {
    recordOwner = null;
    throw e;
  } finally {
    if (runController === ctl) runController = null;
  }
}
async function keepRecording(data, grade = true) {
  const owner = recordOwner;
  if (!owner) return;
  const l = store.lessons.find((x) => x.id === owner.lessonId),
    s = l?.sentences.find((x) => x.id === owner.sentenceId);
  if (!l || !s) return;
  if (data.blob?.size && !recordingStorageWarned && !(await media.ready)) {
    recordingStorageWarned = true;
    say('Trình duyệt chặn lưu bản ghi âm. Bản ghi chỉ giữ khi trang đang mở; xuất file bài để giữ lại.', 'error');
  }
  const a = assets(l.id);
  if (owner.continuous) {
    detachRecording(l, a, s.id);
    if (data.blob?.size)
      a.recordings[s.id] = {
        data: await toBase64(data.blob),
        mime: data.blob.type,
        createdAt: Date.now(),
      };
    const ids = owner.continuous,
      reference = ids
        .map((id) => l.sentences.find((s) => s.id === id).text)
        .join(" ");
    // Long free-form recordings are kept for listening; bounded transcript
    // alignment avoids freezing the UI on a multi-minute recording.
    if (
      data.text.trim() &&
      C.tokens(reference).length <= 350 &&
      C.tokens(data.text).length <= 700
    ) {
      const summary = C.compare(reference, data.text, {
        speech: true,
        maxWords: 700,
      });
      const ops = summary.ops;
      let offset = 0;
      for (const id of ids) {
        const row = l.sentences.find((s) => s.id === id),
          n = C.tokens(row.text).length,
          answer = ops
            .filter((o) => o.index >= offset && o.index < offset + n)
            .map((o) => o.actual || "")
            .filter(Boolean)
            .join(" ");
        l.progress[id].shadow.transcript = answer;
        l.recordingMeta[id] = { owner: s.id, continuous: true };
        if (grade && answer) {
          const result = C.compare(row.text, answer, {
            speech: true,
            maxWords: 700,
          });
          C.addAttempt(l, id, "shadow", result, { answer });
          resultCache.set(`${id}:shadow`, result);
        }
        offset += n;
      }
      if (grade) learningFeedback(l, summary, "shadow");
    } else {
      l.progress[s.id].shadow.transcript = data.text || "";
      for (const id of ids)
        l.recordingMeta[id] = { owner: s.id, continuous: true };
      say(
        "Đã lưu bản ghi liên tục. Luyện từng câu để đối chiếu bản chép chi tiết.",
      );
    }
    l.updatedAt = Date.now();
    await persist(true, l.id);
    if (lesson()?.id === l.id) renderPractice();
    return;
  }
  detachRecording(l, a, s.id);
  if (data.blob?.size)
    a.recordings[s.id] = {
      data: await toBase64(data.blob),
      mime: data.blob.type,
      createdAt: Date.now(),
    };
  l.progress[s.id].shadow.transcript = data.text || "";
  l.updatedAt = Date.now();
  if (grade && data.text.trim()) {
    const result = C.compare(s.text, data.text, { speech: true });
    C.addAttempt(l, s.id, "shadow", result, { answer: data.text });
    resultCache.set(`${s.id}:shadow`, result);
    learningFeedback(l, result, "shadow");
  }
  await persist(true, l.id);
  if (l.id === lesson()?.id && s.id === sentence()?.id) {
    $("spoken-text").value = data.text;
    renderRecording();
    if (grade && data.text.trim())
      renderResult("speech-result", resultCache.get(`${s.id}:shadow`), true);
    else
      say(
        "Đã giữ bản ghi. Nếu chưa có bản chép, nghe lại rồi nhập thủ công để đối chiếu.",
      );
    renderLibrary();
  }
}
function detachRecording(l, a, id) {
  const members = Object.keys(l.recordingMeta || {}).filter(
    (key) => key !== id && l.recordingMeta[key].owner === id,
  );
  if (members.length && a.recordings[id]) {
    const next = members[0];
    a.recordings[next] = a.recordings[id];
    for (const key of members) l.recordingMeta[key].owner = next;
  }
  delete l.recordingMeta[id];
}
async function finishRecording() {
  if (!capture.active) return;
  const data = await capture.stop();
  if (data) await keepRecording(data);
  recordOwner = null;
}
async function captureTurn(l, s, signal, milliseconds) {
  recordOwner = { lessonId: l.id, sentenceId: s.id };
  await capture.start(signal);
  try {
    await delay(milliseconds, signal);
    const data = await capture.stop();
    if (data && !signal.aborted) await keepRecording(data);
  } finally {
    if (capture.active) await capture.cancel();
    recordOwner = null;
  }
}
async function playWhole(kind = "all") {
  await stopAll();
  const l = lesson(),
    ctl = new AbortController(),
    first = kind === "all" ? 0 : l.cursor;
  runController = ctl;
  flowKind = kind;
  $("listen-all").disabled = true;
  $("shadow-run").disabled = true;
  try {
    $("audio-status").textContent = "Đang tải trước âm thanh toàn bài…";
    const c = await engine.prepareLesson(
      l,
      ctl.signal,
      kind !== "all",
      (n, total) =>
        ($("audio-status").textContent = `Chuẩn bị toàn bài · ${n}/${total}`),
    );
    if (kind === "continuous" && l.settings.autoRecord) {
      recordOwner = {
        lessonId: l.id,
        sentenceId: l.sentences[first].id,
        continuous: l.sentences.slice(first).map((s) => s.id),
      };
      await capture.start(ctl.signal);
    }
    $("audio-status").textContent =
      kind === "all"
        ? "Đang nghe toàn bài · phát liền mạch"
        : "Shadowing liên tục · dùng tai nghe";
    await engine.segment(c.start, c.end, ctl.signal);
    if (recordOwner?.continuous) {
      const data = await capture.stop();
      if (data) await keepRecording(data);
      recordOwner = null;
    }
    await persist(true, l.id);
  } finally {
    if (capture.active || capture.stream) await capture.cancel();
    recordOwner = null;
    if (runController === ctl) {
      runController = null;
      flowKind = "";
      $("listen-all").disabled = false;
      $("shadow-run").disabled = false;
      $("audio-status").textContent = "Đã nghe xong toàn bài";
    }
  }
}
async function runFlow(kind, selectedIds = null) {
  if (kind === "all" || (kind === "continuous" && !lesson().settings.role))
    return playWhole(kind);
  await stopAll();
  const l = lesson(),
    ctl = new AbortController();
  runController = ctl;
  flowKind = kind;
  $("shadow-run").disabled = true;
  $("listen-all").disabled = true;
  const indices = selectedIds
    ? selectedIds
        .map((id) => l.sentences.findIndex((s) => s.id === id))
        .filter((i) => i >= 0)
    : kind === "all"
      ? l.sentences.map((_, i) => i)
      : kind === "continuous"
        ? l.sentences.slice(l.cursor).map((_, i) => i + l.cursor)
        : [l.cursor];
  try {
    if (kind !== "all" && l.settings.autoRecord)
      await capture.acquire(ctl.signal);
    for (const index of indices) {
      if (ctl.signal.aborted) throw abortError();
      l.cursor = index;
      renderPractice();
      persist();
      const s = l.sentences[index],
        estimated = Math.max(
          1500,
          (C.tokens(s.text).length / 2.5 / l.settings.speed) * 1000,
        );
      if (kind !== "all" && l.settings.role && s.speaker === l.settings.role) {
        $("audio-status").textContent = `Lượt của bạn · ${s.speaker}`;
        if (l.settings.autoRecord)
          await captureTurn(
            l,
            s,
            ctl.signal,
            estimated + l.settings.gap * 1000,
          );
        else await delay(estimated + l.settings.gap * 1000, ctl.signal);
        continue;
      }
      const c = await engine.prepare(l, s, ctl.signal),
        duration = ((c.end - c.start) / l.settings.speed) * 1000;
      for (
        let repeat = 0;
        repeat < (kind === "all" ? 1 : l.settings.repeat);
        repeat++
      ) {
        markListen(l, s);
        $("audio-status").textContent = `Đang nghe câu ${index + 1}…`;
        if (
          (kind === "simultaneous" || kind === "continuous") &&
          l.settings.autoRecord
        ) {
          recordOwner = { lessonId: l.id, sentenceId: s.id };
          await capture.start(ctl.signal);
          await engine.segment(c.start, c.end, ctl.signal);
          await delay(300, ctl.signal);
          await keepRecording(await capture.stop());
          recordOwner = null;
        } else if (kind === "delayed") {
          const playing = engine.segment(c.start, c.end, ctl.signal); // Attach a rejection handler immediately while waiting for the delay.
          const settled = playing.then(
            () => ({ ok: true }),
            (error) => ({ error }),
          );
          await delay(l.settings.gap * 1000, ctl.signal);
          $("audio-status").textContent = "Đến lượt bạn · nói đuổi theo";
          if (l.settings.autoRecord) {
            recordOwner = { lessonId: l.id, sentenceId: s.id };
            await capture.start(ctl.signal);
          }
          const outcome = await settled;
          if (outcome.error) throw outcome.error;
          await delay(l.settings.gap * 1000 + 300, ctl.signal);
          if (l.settings.autoRecord) {
            await keepRecording(await capture.stop());
            recordOwner = null;
          }
        } else {
          await engine.segment(c.start, c.end, ctl.signal);
          if (kind === "repeat") {
            if (l.settings.gap) await delay(l.settings.gap * 1000, ctl.signal);
            $("audio-status").textContent =
              "Đến lượt bạn · nói lại câu vừa nghe";
            if (l.settings.autoRecord)
              await captureTurn(l, s, ctl.signal, duration + 1500);
            else await delay(duration + 1500, ctl.signal);
          } else if (kind === "continuous" && l.settings.autoRecord) {
            $("audio-status").textContent = "Nói lại nhanh câu vừa nghe";
            await captureTurn(l, s, ctl.signal, duration + 500);
          }
        }
      }
    }
    say("Đã hoàn thành lượt luyện. Tiến độ đã được giữ.", "success");
  } finally {
    if (capture.active || capture.stream) await capture.cancel();
    recordOwner = null;
    if (runController === ctl) {
      runController = null;
      flowKind = "";
      $("shadow-run").disabled = false;
      $("listen-all").disabled = false;
      $("audio-status").textContent = "Lượt luyện đã kết thúc";
      persist(true);
      renderLibrary();
    }
  }
}
async function checkDict() {
  if (!dictAnswer().trim() || dictAnswer().replace(/[_\s.,!?]/g, "") === "")
    return say("Hãy nhập câu trả lời trước khi kiểm tra.");
  const l = lesson(),
    s = sentence(),
    p = progress(),
    answer = dictAnswer(),
    result = C.compare(s.text, answer, { strict: l.settings.strict });
  C.addAttempt(l, s.id, "dict", result, { hints: p.dict.attemptHints, answer });
  resultCache.set(`${s.id}:dict`, result);
  renderResult("dict-result", result, false);
  learningFeedback(l, result, "dict");
  renderDictStats();
  document
    .querySelectorAll("[data-blank]")
    .forEach(
      (el) =>
        (el.className =
          C.normalize(el.value) ===
          C.normalize(C.tokens(s.text)[el.dataset.blank])
            ? "correct"
            : "wrong"),
    );
  persist(true);
  renderLibrary();
  if (
    result.score === 100 &&
    !p.dict.attemptHints &&
    l.settings.autoNext &&
    l.cursor < l.sentences.length - 1
  ) {
    await delay(700);
    await navigate(l.cursor + 1);
  }
}
function showHint() {
  const p = progress().dict,
    s = sentence(),
    words = C.tokens(s.text),
    r = C.compare(s.text, dictAnswer(), { strict: false });
  hintTarget = r.ops.find((o) => o.ref && o.type !== "correct")?.index ?? 0;
  const word = words[hintTarget] || words[0];
  p.hintLevel = Math.min(4, p.hintLevel + 1);
  p.hints++;
  p.attemptHints++;
  $("hint-text").hidden = false;
  $("hint-text").textContent =
    p.hintLevel === 4
      ? `Đáp án: ${s.text}`
      : `Gợi ý ${p.hintLevel}/4 · từ ${hintTarget + 1}: ${C.hint(word, p.hintLevel)}`;
  renderDictStats();
  persist();
}
function retry() {
  const p = progress().dict;
  p.draft = "";
  p.blanks = {};
  p.hintLevel = 0;
  p.attemptHints = 0;
  p.retries++;
  resultCache.delete(`${sentence().id}:dict`);
  $("dict-answer").value = "";
  $("dict-result").innerHTML = "";
  $("hint-text").hidden = true;
  renderBlanks();
  renderDictStats();
  persist();
}
async function prepareAll() {
  if (prepareController) {
    prepareController.abort();
    return;
  }
  const l = lesson(),
    ctl = new AbortController();
  prepareController = ctl;
  try {
    await engine.ensureLesson(
      l,
      ctl.signal,
      (n, total) => ($("prepare").textContent = `Hủy · ${n}/${total}`),
    );
    await persist(true, l.id);
    say("Audio toàn bài đã sẵn sàng và đang đồng bộ Firebase.", "success");
  } finally {
    if (prepareController === ctl) {
      prepareController = null;
      $("prepare").textContent = "Chuẩn bị audio";
    }
  }
}
async function downloadLessonMP3() {
  if (mp3Controller) {
    mp3Controller.abort();
    return;
  }
  await stopAll();
  const l = lesson(),
    ctl = new AbortController(),
    parts = [];
  mp3Controller = ctl;
  try {
    const audio = await engine.ensureLesson(
      l,
      ctl.signal,
      (n, total) => ($("download-all").textContent = `Hủy tải · ${n}/${total}`),
    );
    if (ctl.signal.aborted) throw abortError();
    download(
      fromBase64(audio.data, audio.mime),
      `${l.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "lesson"}-UK.mp3`,
    );
    say(
      "Đã tải MP3 toàn bài theo giọng, tốc độ và cao độ đã thiết đặt.",
      "success",
    );
    await persist(true, l.id);
  } finally {
    if (mp3Controller === ctl) {
      mp3Controller = null;
      $("download-all").textContent = "↓ MP3 toàn bài · giọng UK";
    }
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportFile() {
  await converter.stop();
  await stopAll();
  persist(true);
  const l = lesson(),
    withAudio = $("include-audio").checked,
    a = assets(),
    data = { tts: {}, full: {}, recordings: {}, source: null };
  $("export-confirm").disabled = true;
  $("export-error").textContent = "Đang đóng gói bài…";
  try {
    if (withAudio) {
      data.tts = a.tts;
      data.full = a.full || {};
      for (const [key, rec] of Object.entries(a.recordings))
        data.recordings[key] = {
          data: rec.data || (await toBase64(rec.blob)),
          mime: rec.mime,
          createdAt: rec.createdAt,
        };
      if (a.source)
        data.source = {
          data: a.source.data || (await toBase64(a.source.blob)),
          mime: a.source.mime,
        };
    }
    const text = C.serializeFile(l, data);
    if (text.length > 90_000_000)
      throw Error(
        "File bài vượt 90 MB. Xuất không kèm audio hoặc dùng file gốc nhỏ hơn.",
      );
    download(
      new Blob([text], { type: "application/json" }),
      `${l.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "lesson"}.shadow.json`,
    );
    $("export-dialog").close();
    say("Đã xuất bài kèm tiến độ. Dùng “Mở bài” để học tiếp.", "success");
  } catch (e) {
    $("export-error").textContent = e.message;
  } finally {
    $("export-confirm").disabled = false;
  }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 90_000_000) throw Error("File bài tối đa 90 MB.");
  const { lesson: l, assets: a } = C.parseFile(await file.text());
  await converter.stop();
  await stopAll();
  if (
    store.lessons.some((x) => x.id === l.id) &&
    !(await confirmAction(
      "Bài này đã có trong danh sách. Mở file sẽ thay phiên bản cục bộ bằng dữ liệu trong file. Tiếp tục?",
      { title: "Thay dữ liệu bài học?", confirmLabel: "Mở phiên bản trong file" },
    ))
  )
    return;
  const saved = putLesson(l);
  assetLibrary.set(l.id, a);
  if (sync.records.has(l.id))
    a._cloudRevision = sync.records.get(l.id).revision;
  appTab = l.kind === "tts" ? "tts" : "study";
  await persist(true, l.id);
  bindAssets();
  resultCache.clear();
  render();
  if (l.kind === "tts") await converter.open(l.id);
  else preload();
  if (saved) say("Đã mở bài, tiến độ và audio có trong file.", "success");
}
function showCreate() {
  creating = true;
  preview = [];
  $("new-title").value = "";
  $("new-text").value = "";
  $("preview").innerHTML = "";
  $("create-error").textContent = "";
  $("create-confirm").disabled = true;
  $("create-dialog").showModal();
}
function renderPreview() {
  $("preview").innerHTML = preview
    .map(
      (s, i) =>
        `<div class="preview-row"><textarea data-preview-text="${i}" aria-label="Câu ${i + 1}" maxlength="1200">${esc(s.text)}</textarea><div><span>${i + 1}</span><input data-preview-speaker="${i}" value="${esc(s.speaker)}" placeholder="Người nói" aria-label="Người nói câu ${i + 1}" maxlength="40"><span>${s.start === null ? "Giọng UK" : `${s.start.toFixed(2)}–${s.end.toFixed(2)}s${s.timing === "estimated" ? " · ước lượng" : ""}`}</span><button type="button" class="quiet" data-merge="${i}" ${i === preview.length - 1 ? "disabled" : ""}>Gộp câu sau</button><button type="button" class="quiet" data-remove="${i}">Xóa</button></div></div>`,
    )
    .join("");
  $("create-confirm").disabled = !preview.length;
}
function analyse() {
  try {
    preview = C.parseTranscript($("new-text").value, {
      maxWords: Number($("segment-size").value),
    });
    renderPreview();
    $("create-error").textContent =
      `${preview.length} đoạn luyện · kiểm tra nội dung và người nói trước khi tạo.`;
  } catch (e) {
    preview = [];
    renderPreview();
    $("create-error").textContent = e.message;
  }
}
async function createNew(event) {
  event.preventDefault();
  if (!preview.length || $("create-confirm").disabled) return;
  try {
    if (
      preview.some(
        (s) =>
          !s.text.trim() ||
          s.text.length > 1200 ||
          C.tokens(s.text).length > 180,
      )
    )
      throw Error("Có câu trống hoặc quá dài. Hãy sửa/chia câu.");
    await converter.stop();
    await stopAll();
    await persist(true);
    const l = C.createLesson($("new-title").value, preview);
    l.settings.experience = experiencePreferences();
    const saved = putLesson(l);
    assetLibrary.set(l.id, { tts: {}, full: {}, recordings: {}, source: null });
    appTab = "study";
    bindAssets();
    resultCache.clear();
    $("create-dialog").close();
    creating = false;
    render();
    await persist(true, l.id);
    preload();
    if (saved)
      say(
        "Bài đã sẵn sàng. Bắt đầu ở Listen hoặc chuyển sang Dictation.",
        "success",
      );
    startAutoTranslation(l);
  } catch (e) {
    $("create-error").textContent = e.message;
  }
}
function editSentence() {
  const s = sentence();
  $("edit-text").value = s.text;
  $("edit-speaker").value = s.speaker;
  $("edit-translation").value = s.translation;
  $("edit-start").value = s.start ?? "";
  $("edit-end").value = s.end ?? "";
  $("edit-error").textContent = "";
  $("edit-dialog").showModal();
}
async function saveSentence(event) {
  event.preventDefault();
  try {
    const l = lesson(),
      s = sentence(),
      text = $("edit-text").value.trim(),
      start =
        $("edit-start").value === "" ? null : Number($("edit-start").value),
      end = $("edit-end").value === "" ? null : Number($("edit-end").value);
    if (
      !C.tokens(text).length ||
      text.length > 1200 ||
      C.tokens(text).length > 180
    )
      throw Error("Câu trống hoặc quá dài.");
    if (
      l.sentences.reduce(
        (n, x) => n + (x.id === s.id ? text.length : x.text.length),
        0,
      ) > C.MAX_TEXT
    )
      throw Error("Bài vượt giới hạn 30.000 ký tự.");
    if (
      (start !== null || end !== null) &&
      (!Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start)
    )
      throw Error("Hãy nhập cả mốc đầu/cuối, với mốc cuối lớn hơn mốc đầu.");
    const textChanged = s.text !== text;
    const translationChanged = s.translation !== $("edit-translation").value.trim();
    await stopAll();
    if (s.text !== text) {
      detachRecording(l, assets(), s.id);
      l.progress[s.id] = C.freshProgress();
      l.mistakes = l.mistakes.filter((m) => m.sentenceId !== s.id);
      resultCache.delete(`${s.id}:dict`);
      resultCache.delete(`${s.id}:shadow`);
    }
    s.text = text;
    s.speaker = $("edit-speaker").value.trim();
    if (translationChanged) {
      s.translation = $("edit-translation").value.trim();
      s.translationOrigin = s.translation ? "manual" : "auto";
      s.translationSource = s.translation ? text : "";
    } else if (textChanged && s.translationOrigin === "auto") {
      s.translation = "";
      s.translationSource = "";
    }
    s.start = start;
    s.end = end;
    s.timing = start === null ? "tts" : "cue";
    if (s.speaker && !Object.hasOwn(l.speakers, s.speaker))
      l.speakers[s.speaker] =
        C.VOICES[Object.keys(l.speakers).length % C.VOICES.length];
    l.updatedAt = Date.now();
    persist(true);
    $("edit-dialog").close();
    render();
    startAutoTranslation(l, true);
    if (textChanged) say(l.settings.source === "original"
      ? "Đã cập nhật câu và gửi đồng bộ. Kiểm tra lại mốc audio gốc để phụ đề khớp nội dung mới."
      : "Đã cập nhật câu và gửi đồng bộ. Audio sẽ được tạo lại khi nghe; có thể chọn Chuẩn bị audio.", "success");
  } catch (e) {
    $("edit-error").textContent = e.message;
  }
}
// Bind all direct controls. Handler wrappers make asynchronous failures visible.
$("new").onclick = showCreate;
$("empty-new").onclick = showCreate;
$("open-file").onclick = () => $("lesson-file").click();
$("lesson-file").onchange = safe(async () => {
  try {
    await importFile($("lesson-file").files[0]);
  } finally {
    $("lesson-file").value = "";
  }
});
$("export").onclick = () => {
  $("export-error").textContent = "";
  $("export-dialog").showModal();
};
$("export-confirm").onclick = safe(exportFile);
$("help").onclick = () => openPanel("help-dialog");
$("show-full-translation").onclick = () => {
  if (!lesson() || lesson().mode === "dict") return;
  renderTranslationDialog();
  openPanel("translation-dialog");
  startAutoTranslation(lesson(), true);
};
$("retry-translation").onclick = () => startAutoTranslation(lesson(), true);
$("change-lesson").onclick = safe(chooseLesson);
$("lesson-search").oninput = renderLibrary;
$("show-settings").onclick = () => {
  openPanel("settings-dialog");
};
$("show-notes").onclick = () => {
  openPanel("notes-dialog");
};
$("study-tab").onclick = safe(async () => {
  await converter.stop();
  await chooseLesson();
});
$("tts-tab").onclick = safe(async () => {
  await stopAll();
  await persist(true);
  appTab = "tts";
  store.current = converter.id;
  render();
  converter.renderHistory();
});
$("sync-settings").onclick = () => {
  $("sync-link").value = identity.url;
  openPanel("sync-dialog");
};
$("copy-sync").onclick = safe(async () => {
  await navigator.clipboard.writeText(identity.url);
  $("sync-detail").textContent = "Đã sao chép liên kết mở ứng dụng.";
});
$("retry-sync").onclick = safe(async () => {
  await persist(true);
  await sync.start();
});
for (const [id, keep] of [
  ["keep-local", true],
  ["keep-cloud", false],
])
  $(id).onclick = safe(async () => {
    await stopAll();
    await sync.resolve(conflictId, keep);
    $("conflict-dialog").close();
    conflictId = null;
    render();
    const next = sync.conflicts.keys().next().value;
    if (next) sync.onConflict(next);
    else await migration.run();
  });
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
$("analyse").onclick = analyse;
$("new-text").oninput = () => {
  if (preview.length) {
    $("create-confirm").disabled = true;
    $("create-error").textContent =
      "Văn bản đã thay đổi. Bấm “Phân tích & chia câu” lại.";
  }
};
$("create-form").onsubmit = safe(createNew);
$("edit-form").onsubmit = safe(saveSentence);
$("edit-sentence").onclick = editSentence;
$("import-text").onclick = () => $("text-file").click();
$("text-file").onchange = safe(async () => {
  const f = $("text-file").files[0];
  try {
    if (f) {
      if (f.size > 200000) throw Error("File văn bản quá lớn.");
      $("new-text").value = await f.text();
      if (!$("new-title").value)
        $("new-title").value = f.name.replace(/\.[^.]+$/, "");
      analyse();
    }
  } finally {
    $("text-file").value = "";
  }
});
$("play").onclick = safe(() => tracked(playSentence));
$("pause").onclick = safe(async () => {
  if (
    engine.current?.sentenceId === sentence()?.id ||
    engine.current?.lessonId === lesson()?.id
  )
    await engine.togglePause();
});
$("stop").onclick = safe(stopAll);
$("prev").onclick = safe(() => navigate(lesson().cursor - 1));
$("next").onclick = safe(() => navigate(lesson().cursor + 1));
$("jump").onchange = safe(() => navigate(Number($("jump").value), lesson().mode === "review" ? "dict" : null));
$("seek").oninput = () => {
  if (engine.current)
    engine.seek(engine.current.start + Number($("seek").value));
};
$("listen-all").onclick = safe(() => tracked(() => runFlow("all")));
$("shadow-run").onclick = safe(() =>
  tracked(() => runFlow(lesson().settings.shadow)),
);
$("record").onclick = safe(startRecording);
$("finish-record").onclick = safe(finishRecording);
$("prepare").onclick = safe(prepareAll);
$("download-all").onclick = safe(downloadLessonMP3);
$("review-run").onclick = safe(async () => {
  const ids = C.dueSentences(lesson()).map((s) => s.id);
  await navigate(
    lesson().sentences.findIndex((s) => s.id === ids[0]),
    "dict",
  );
  say(
    `Có ${ids.length} câu cần ôn. Hoàn thành rồi chọn câu tiếp theo trong Review.`,
  );
});
$("compare-speech").onclick = safe(() => {
  const text = $("spoken-text").value.trim();
  if (!text)
    return say("Chưa có bản chép để đối chiếu. Hãy ghi âm hoặc nhập bản chép.");
  const l = lesson(),
    s = sentence(),
    result = C.compare(s.text, text, { speech: true });
  progress().shadow.transcript = text;
  C.addAttempt(l, s.id, "shadow", result, { answer: text });
  resultCache.set(`${s.id}:shadow`, result);
  renderResult("speech-result", result, true);
  learningFeedback(l, result, "shadow");
  persist(true);
  renderLibrary();
});
$("check").onclick = safe(checkDict);
$("hint").onclick = showHint;
$("retry").onclick = retry;
$("dict-answer").oninput = () => {
  progress().dict.draft = $("dict-answer").value;
  persist();
};
$("spoken-text").oninput = () => {
  progress().shadow.transcript = $("spoken-text").value;
  persist();
};
$("notes").oninput = () => {
  progress().notes = $("notes").value;
  persist();
};
$("lesson-notes").oninput = () => {
  lesson().notes = $("lesson-notes").value;
  persist();
};
$("dict-type").onchange = () => {
  dictType = $("dict-type").value;
  lesson().settings.dictType = dictType;
  retry();
  renderPractice();
};
$("star").onclick = () => {
  sentence().star = !sentence().star;
  persist();
  renderPractice();
  renderLibrary();
};
for (const [id, key] of [
  ["strict", "strict"],
  ["auto-next", "autoNext"],
  ["show-translation", "translation"],
  ["auto-record", "autoRecord"],
])
  $(id).onchange = () => {
    lesson().settings[key] = $(id).checked;
    persist();
    if (id === "show-translation") renderCaption();
  };
$("captions").onchange = () => {
  if (lesson().mode === "dict") {
    progress().dict.hints++;
    progress().dict.attemptHints++;
    progress().dict.hintLevel = 4;
    $("hint-text").hidden = false;
    $("hint-text").textContent = `Đáp án: ${sentence().text}`;
    $("captions").checked = false;
    renderDictStats();
  } else lesson().settings.captions = $("captions").checked;
  persist();
  renderCaption();
};
$("speed").onchange = () => {
  lesson().settings.speed = Number($("speed").value);
  $("model").playbackRate = lesson().settings.speed;
  persist();
};
for (const [id, key] of [
  ["gap", "gap"],
  ["repeat", "repeat"],
])
  $(id).onchange = () => {
    const max = id === "gap" ? 15 : 10,
      n = Number($(id).value);
    if (!Number.isFinite(n) || n < (id === "gap" ? 0 : 1) || n > max) {
      $(id).value = lesson().settings[key];
      return;
    }
    lesson().settings[key] = n;
    persist();
  };
for (const [id, key] of [
  ["role", "role"],
  ["source", "source"],
  ["shadow-mode", "shadow"],
  ["voice", "voice"],
])
  $(id).onchange = safe(async () => {
    const value = $(id).value;
    await stopAll();
    lesson().settings[key] = value;
    if (id === "voice") {
      lesson().voice = value;
      if (lesson().voiceProfiles[C.READER])
        lesson().voiceProfiles[C.READER].voice = value;
      delete lesson().settings.voice;
    }
    persist();
    renderPractice();
    if (id === "voice") preload();
  });
$("attach-source").onclick = () => $("source-file").click();
$("source-file").onchange = safe(async () => {
  const f = $("source-file").files[0];
  try {
    if (!f) return;
    if (f.size > 45 * 1024 * 1024)
      throw Error("Audio/video gốc tối đa 45 MB để có thể xuất cùng bài.");
    if (!/^(audio|video)\//.test(f.type))
      throw Error("Hãy chọn file audio/video được trình duyệt nhận dạng.");
    await stopAll();
    assets().source = { blob: f, mime: f.type };
    lesson().sourceName = f.name;
    lesson().sourceMime = f.type;
    if (lesson().sentences.some((s) => s.start !== null && s.end !== null))
      lesson().settings.source = "original";
    bindAssets();
    persist(true);
    renderPractice();
    say(
      "Đã gắn file gốc. Hãy lưu file bài kèm audio để giữ file này.",
      "success",
    );
  } finally {
    $("source-file").value = "";
  }
});
$("download-audio").onclick = safe(async () => {
  const l = lesson(),
    s = sentence(),
    number = l.cursor + 1,
    ctl = new AbortController();
  say("Đang chuẩn bị MP3 giọng UK của câu…");
  const data = await engine.ensure(l, s, ctl.signal);
  await persist(true, l.id);
  download(fromBase64(data.data, data.mime), `UK-${number}.mp3`);
  say("Đã tải MP3 giọng UK của câu.", "success");
});
$("download-record").onclick = safe(() => {
  const owner = lesson().recordingMeta?.[sentence().id]?.owner || sentence().id;
  const r = assets().recordings[owner];
  if (r)
    download(
      r.blob || fromBase64(r.data, r.mime),
      `recording-${lesson().cursor + 1}.${r.mime.includes("mp4") ? "m4a" : r.mime.includes("ogg") ? "ogg" : "webm"}`,
    );
});
$("delete-lesson").onclick = safe(async () => {
  if (
    !(await confirmAction(
      "Xóa bài này khỏi danh sách và Firebase? File bài đã xuất vẫn được giữ.",
      { title: "Xóa bài học này?", confirmLabel: "Xóa bài", danger: true },
    ))
  )
    return;
  await stopAll();
  const id = lesson().id;
  translations.cancel(id);
  try {
    store.remove(id);
  } catch (e) {
    say(e.message, "error");
  }
  assetLibrary.delete(id);
  await media.remove(identity.scope + ":" + id);
  await persist(true, id);
  store.current = null;
  render();
});
$("demo").onclick = safe(async () => {
  await stopAll();
  const l = C.createLesson(
    "At the café",
    C.parseTranscript(
      "Alice: Good morning! Could I have a cup of tea, please?\nRyan: Of course. Would you like anything to eat?\nAlice: Yes, a sandwich would be lovely.\nRyan: That will be six pounds.\nAlice: Here you are. Thank you very much.\nRyan: You are welcome. Have a nice day!",
    ),
  );
  putLesson(l);
  bindAssets();
  render();
  await persist(true, l.id);
  preload();
  startAutoTranslation(l);
});
document.addEventListener(
  "click",
  safe(async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.lesson) await selectLesson(b.dataset.lesson);
    else if (b.dataset.mode) {
      await stopAll();
      lesson().mode = b.dataset.mode;
      persist();
      render();
    } else if (b.dataset.jump !== undefined)
      await navigate(Number(b.dataset.jump), lesson().mode === "review" ? "dict" : null);
    else if (b.dataset.word !== undefined) await hearWord(b.dataset.word);
    else if (b.dataset.errorWord !== undefined)
      await hearWord(b.dataset.errorWord);
    else if (b.dataset.merge !== undefined) {
      const i = Number(b.dataset.merge),
        a = preview[i],
        next = preview[i + 1];
      if (a && next) {
        if (a.speaker !== next.speaker)
          throw Error("Hai câu khác người nói. Hãy giữ riêng lượt hội thoại.");
        if ((a.start === null) !== (next.start === null))
          throw Error("Hai câu có nguồn thời gian khác nhau; hãy giữ riêng.");
        if (a.text.length + next.text.length + 1 > 1200)
          throw Error("Câu gộp quá dài.");
        a.text += " " + next.text;
        a.end = next.end;
        a.timing =
          a.start === null
            ? "tts"
            : a.timing === "estimated" || next.timing === "estimated"
              ? "estimated"
              : "cue";
        preview.splice(i + 1, 1);
        renderPreview();
      }
    } else if (b.dataset.remove !== undefined) {
      preview.splice(Number(b.dataset.remove), 1);
      renderPreview();
    } else if (b.dataset.reviewSentence !== undefined)
      await navigate(
        Number(b.dataset.reviewSentence),
        b.dataset.reviewMode || "dict",
      );
    else if (b.dataset.reviewWord) {
      const m = lesson().mistakes.find((x) => x.key === b.dataset.reviewWord);
      if (m) {
        await navigate(
          lesson().sentences.findIndex((s) => s.id === m.sentenceId),
          m.mode,
        );
        if (m.opType === "extra") await tracked(playSentence);
        else await hearWord(m.index);
      }
    } else if (b.dataset.resolved) {
      const m = lesson().mistakes.find((x) => x.key === b.dataset.resolved);
      if (m) {
        m.resolved = true;
        m.successes = Math.max(2, m.successes);
        m.dueAt = Date.now() + 3 * 86400000;
        persist(true);
        renderReview();
        renderLibrary();
      }
    }
  }),
);
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.previewText !== undefined)
    preview[Number(el.dataset.previewText)].text = el.value;
  else if (el.dataset.previewSpeaker !== undefined)
    preview[Number(el.dataset.previewSpeaker)].speaker = el.value;
  else if (el.dataset.blank !== undefined) {
    progress().dict.blanks[el.dataset.blank] = el.value;
    persist();
  }
});
document.addEventListener(
  "change",
  safe(async (e) => {
    if (e.target.dataset.reader) {
      const sp = e.target.dataset.reader,
        key = e.target.dataset.profile,
        value = key === "voice" ? e.target.value : Number(e.target.value);
      if (
        key !== "voice" &&
        (!Number.isInteger(value) || Math.abs(value) > 50)
      ) {
        renderReaders();
        throw Error("Tốc độ/cao độ phải từ -50 đến 50.");
      }
      await stopAll();
      const l = lesson();
      l.voiceProfiles[sp] = {
        ...C.voiceProfile(l, sp === C.READER ? "" : sp),
        [key]: value,
      };
      if (key === "voice") {
        if (sp === C.READER) l.voice = value;
        else l.speakers[sp] = value;
      }
      await persist(true);
      renderReaders();
      preload();
    }
  }),
);
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]") || !lesson() || appTab !== "study")
    return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement.tagName,
  );
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "Enter" &&
    lesson().mode === "dict"
  ) {
    e.preventDefault();
    safe(checkDict)();
    return;
  }
  if (typing) return;
  if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    safe(() => navigate(lesson().cursor + 1))();
  } else if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    safe(() => navigate(lesson().cursor - 1))();
  } else if (e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    safe(() => tracked(playSentence))();
  }
});
window.addEventListener("beforeunload", event => {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer); sync.mark(id);
  }
  saveTimers.clear();
  persist(true);
  if (savingCount || sync.dirty.size || sync.conflicts.size || migration.pending || capture.active) {
    event.preventDefault(); event.returnValue = '';
  }
  engine.destroy();
  capture.cleanup();
});
initPresentation();
initExperience((l, preferences, changes) => {
  sync.setPreferences(preferences, changes);
  if (l) persist();
});
const pruneLocalRecordings = () => media.pruneExpired().then(() => {
  if (lesson() && appTab === 'study') renderRecording();
});
void pruneLocalRecordings();
setInterval(pruneLocalRecordings, 60 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void pruneLocalRecordings();
});
function updatePlaybackUI() {
  syncPlayback({playing: !$("model").paused && !!engine.bound, resumable: !!engine.bound, busy: $("play").disabled});
}
$("main-play").onclick = () => {
  if (engine.bound) $("pause").click();
  else $("play").click();
  updatePlaybackUI();
};
for (const event of ["play", "pause", "ended", "loadedmetadata"])
  $("model").addEventListener(event, updatePlaybackUI);
new MutationObserver(updatePlaybackUI).observe($("play"), {attributes: true, attributeFilter: ["disabled"]});
new MutationObserver(() => {
  $("record-state").dataset.recording = String(!$("finish-record").hidden);
  $("audio-status").title = $("audio-status").textContent;
}).observe($("shadow-pane"), {subtree:true, attributes:true, attributeFilter:["hidden"]});
window.addEventListener("resize", () => renderLessonUI(appTab === "study" ? lesson() : null));
updatePlaybackUI();
render();
converter.renderHistory();
sync.start();
window.addEventListener("online", () => sync.start());
window.addEventListener("online", () => startAutoTranslation(appTab === "study" ? lesson() : null, true));
if (store.error) say(store.error, "error");
if (legacy.error) say(legacy.error, 'error');
if (identityError)
  say(identityError + " App đang dùng vùng Firebase chung. Dữ liệu cũ chưa xác định được vẫn được giữ.", "error");
