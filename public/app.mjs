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
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const store = new LessonStore().load(),
  assetLibrary = new Map();
let preview = [],
  runController = null,
  prepareController = null,
  mp3Controller = null,
  saveTimer,
  recordOwner = null,
  recordURL = null,
  dictType = "full",
  resultCache = new Map(),
  flowKind = "",
  hintTarget = 0,
  creating = false,
  activeJob = null;
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
    assetLibrary.set(id, { tts: {}, recordings: {}, source: null });
  return assetLibrary.get(id);
}
function say(text, kind = "") {
  $("global-status").textContent = text;
  $("global-status").className = `global-status ${kind}`;
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
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const save = () => {
    try {
      store.save();
      $("save-state").textContent = "Đã lưu tiến độ";
    } catch (e) {
      $("save-state").textContent = "Chưa lưu được";
      say(e.message, "error");
    }
  };
  if (immediate) save();
  else saveTimer = setTimeout(save, 200);
}
function putLesson(l) {
  try {
    store.upsert(l);
    return true;
  } catch (e) {
    say(e.message, "error");
    return false;
  }
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
const capture = new Capture({
  onText: (text, final) => {
    if (
      recordOwner?.lessonId === lesson()?.id &&
      recordOwner?.sentenceId === sentence()?.id
    ) {
      $("spoken-text").value = text;
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
function renderLibrary() {
  const list = store.lessons;
  $("lesson-count").textContent = list.length;
  $("library").innerHTML = list
    .map(
      (l) =>
        `<button class="lesson-card ${l.id === store.current ? "active" : ""}" data-lesson="${esc(l.id)}"><strong>${esc(l.title)}</strong><small>${l.sentences.length} câu · ${Object.values(l.progress).filter((p) => p.completed).length} hoàn tất · ${C.dueSentences(l).length} cần ôn</small></button>`,
    )
    .join("");
}
function render() {
  renderLibrary();
  const l = lesson();
  $("empty").hidden = !!l;
  $("workspace").hidden = !l;
  $("export").disabled = !l;
  if (!l) return;
  $("lesson-title").textContent = l.title;
  $("lesson-meta").textContent =
    `${l.sentences.length} câu · ${Object.keys(l.speakers).length || 1} vai · Cập nhật ${new Date(l.updatedAt).toLocaleDateString("vi-VN")}`;
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
  $("speaker-voices").innerHTML = Object.entries(l.speakers)
    .map(
      ([sp, v]) =>
        `<label>${esc(sp)} <select data-speaker-voice="${esc(sp)}">${voiceOptions(v)}</select></label>`,
    )
    .join("");
  $("source-name").textContent = l.sourceName
    ? `${l.sourceName}${assets().source ? "" : " · cần chọn lại file hoặc mở bài có kèm audio"}`
    : "Chưa có file gốc";
  $("dict-answer").value = p.dict.draft;
  $("dict-type").value = dictType;
  $("dict-answer").hidden = dictType === "blanks";
  $("blanks").hidden = dictType !== "blanks";
  renderBlanks();
  $("dict-result").innerHTML = "";
  $("speech-result").innerHTML = "";
  $("hint-text").hidden = true;
  $("spoken-text").value = p.shadow.transcript;
  $("notes").value = p.notes;
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
        `<button class="transcript-row ${i === l.cursor ? "active" : ""}" data-jump="${i}"><small>${i + 1}${x.speaker ? " · " + esc(x.speaker) : ""}</small><span>${esc(x.text)}</span></button>`,
    )
    .join("");
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
    s.translation || "Chưa có bản dịch. Thêm trong “Sửa câu”.";
  $("stage").classList.toggle(
    "has-video",
    l.settings.source === "original" &&
      (assets().source?.mime || "").startsWith("video/"),
  );
}
function onTime(t) {
  if (!sentence() || engine.current?.sentenceId !== sentence().id) return;
  const elapsed = Math.max(0, t.time - t.start),
    duration = t.end - t.start;
  $("elapsed").textContent = clock(elapsed);
  $("duration").textContent = clock(duration);
  $("seek").disabled = false;
  $("seek").max = duration;
  $("seek").value = elapsed;
  $("pause").disabled = !engine.bound;
  $("pause").textContent = t.playing ? "Tạm dừng" : "Tiếp tục";
  const word = t.words.find((w) => t.time >= w.start && t.time < w.end)?.index;
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
  $(id).innerHTML =
    `<div class="result-top"><span>${speech ? "Mức khớp bản chép" : "Mức khớp câu gốc"}<br><small>${speech ? "Không đo chính xác phát âm từng âm" : result.strict ? "Có phân biệt chữ hoa và dấu câu" : "Bỏ qua chữ hoa và dấu câu"}</small></span><strong class="result-score">${result.score}%</strong></div><div class="result-tokens">${result.ops.map((o) => `<button class="${o.type}" ${o.ref ? `data-error-word="${o.index}"` : "disabled"} title="${esc(labels[o.type] + (o.kind ? " · " + o.kind : "") + (o.actual && o.actual !== o.ref ? " · Bạn: " + o.actual : ""))}">${esc(o.ref || o.actual)}${o.type === "missing" ? " ∅" : o.actual && o.actual !== o.ref ? " → " + esc(o.actual) : ""}</button>`).join("")}</div><p class="result-legend">Xanh: đúng · Đỏ: sai/thiếu · Tím: thừa · Vàng: sai vị trí. Bấm từ gốc để nghe lại; xem loại lỗi khi rê chuột.</p>`;
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
  const rec = assets().recordings[sentence().id];
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
  store.current = id;
  bindAssets();
  persist(true);
  resultCache.clear();
  render();
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
  const a = assets(l.id);
  if (data.blob?.size)
    a.recordings[s.id] = {
      data: await toBase64(data.blob),
      mime: data.blob.type,
    };
  l.progress[s.id].shadow.transcript = data.text || "";
  l.updatedAt = Date.now();
  if (grade && data.text.trim()) {
    const result = C.compare(s.text, data.text, { speech: true });
    C.addAttempt(l, s.id, "shadow", result, { answer: data.text });
    resultCache.set(`${s.id}:shadow`, result);
  }
  persist(true);
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
async function runFlow(kind, selectedIds = null) {
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
    for (let i = 0; i < l.sentences.length; i++) {
      if (ctl.signal.aborted) throw abortError();
      $("prepare").textContent = `Hủy · ${i + 1}/${l.sentences.length}`;
      await engine.ensure(l, l.sentences[i], ctl.signal);
    }
    say(
      "Đã chuẩn bị audio UK. Lưu file bài và chọn kèm audio để giữ lại.",
      "success",
    );
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
    for (let i = 0; i < l.sentences.length; i++) {
      if (ctl.signal.aborted) throw abortError();
      $("download-all").textContent =
        `Hủy tải · ${i + 1}/${l.sentences.length}`;
      parts.push(await engine.ensure(l, l.sentences[i], ctl.signal));
    }
    if (ctl.signal.aborted) throw abortError();
    download(
      joinMP3(parts),
      `${l.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "lesson"}-UK.mp3`,
    );
    say(
      "Đã tải MP3 toàn bài với giọng UK của từng vai. File dùng tốc độ gốc.",
      "success",
    );
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
  await stopAll();
  persist(true);
  const l = lesson(),
    withAudio = $("include-audio").checked,
    a = assets(),
    data = { tts: {}, recordings: {}, source: null };
  $("export-confirm").disabled = true;
  $("export-error").textContent = "Đang đóng gói bài…";
  try {
    if (withAudio) {
      data.tts = a.tts;
      for (const [key, rec] of Object.entries(a.recordings))
        data.recordings[key] = {
          data: rec.data || (await toBase64(rec.blob)),
          mime: rec.mime,
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
  await stopAll();
  if (
    store.lessons.some((x) => x.id === l.id) &&
    !confirm(
      "Bài này đã có trong danh sách. Mở file sẽ thay phiên bản cục bộ bằng dữ liệu trong file. Tiếp tục?",
    )
  )
    return;
  const saved = putLesson(l);
  assetLibrary.set(l.id, a);
  bindAssets();
  resultCache.clear();
  render();
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
    await stopAll();
    const l = C.createLesson($("new-title").value, preview),
      saved = putLesson(l);
    assetLibrary.set(l.id, { tts: {}, recordings: {}, source: null });
    bindAssets();
    resultCache.clear();
    $("create-dialog").close();
    creating = false;
    render();
    if (saved)
      say(
        "Bài đã sẵn sàng. Bắt đầu ở Listen hoặc chuyển sang Dictation.",
        "success",
      );
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
    await stopAll();
    if (s.text !== text) {
      l.progress[s.id] = C.freshProgress();
      l.mistakes = l.mistakes.filter((m) => m.sentenceId !== s.id);
      resultCache.delete(`${s.id}:dict`);
      resultCache.delete(`${s.id}:shadow`);
    }
    s.text = text;
    s.speaker = $("edit-speaker").value.trim();
    s.translation = $("edit-translation").value.trim();
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
$("help").onclick = () => $("help-dialog").showModal();
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
  if (engine.current?.sentenceId === sentence()?.id) await engine.togglePause();
});
$("stop").onclick = safe(stopAll);
$("prev").onclick = safe(() => navigate(lesson().cursor - 1));
$("next").onclick = safe(() => navigate(lesson().cursor + 1));
$("jump").onchange = safe(() => navigate(Number($("jump").value)));
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
$("dict-type").onchange = () => {
  dictType = $("dict-type").value;
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
      delete lesson().settings.voice;
    }
    persist();
    renderPractice();
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
  download(fromBase64(data.data, data.mime), `UK-${number}.mp3`);
  say("Đã tải MP3 giọng UK của câu.", "success");
});
$("download-record").onclick = safe(() => {
  const r = assets().recordings[sentence().id];
  if (r)
    download(
      r.blob || fromBase64(r.data, r.mime),
      `recording-${lesson().cursor + 1}.${r.mime.includes("mp4") ? "m4a" : r.mime.includes("ogg") ? "ogg" : "webm"}`,
    );
});
$("delete-lesson").onclick = safe(async () => {
  if (!confirm("Xóa bài khỏi danh sách cục bộ? File bài đã xuất không bị xóa."))
    return;
  await stopAll();
  const id = lesson().id;
  try {
    store.remove(id);
  } catch (e) {
    say(e.message, "error");
  }
  assetLibrary.delete(id);
  if (lesson()) bindAssets();
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
      await navigate(Number(b.dataset.jump));
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
    if (e.target.dataset.speakerVoice) {
      const sp = e.target.dataset.speakerVoice,
        value = e.target.value;
      await stopAll();
      lesson().speakers[sp] = value;
      persist();
    }
  }),
);
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]") || !lesson()) return;
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
window.addEventListener("beforeunload", () => {
  persist(true);
  engine.destroy();
  capture.cleanup();
});
if (lesson()) bindAssets();
render();
if (store.error) say(store.error, "error");
