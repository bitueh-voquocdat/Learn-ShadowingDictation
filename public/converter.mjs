import * as C from "./core.mjs";
import { AudioEngine, fromBase64 } from "./audio.mjs";
import { fullKey } from "./full-audio.mjs";
import { confirmAction } from "./presentation.mjs";
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export class Converter {
  constructor({
    store,
    assets,
    hydrate,
    persist,
    onSelect,
    onStudy,
    onError,
    download,
    voiceOptions,
    beforeGenerate,
  }) {
    Object.assign(this, {
      store,
      assets,
      hydrate,
      persist,
      onSelect,
      onStudy,
      onError,
      download,
      voiceOptions,
      beforeGenerate,
    });
    this.engine = new AudioEngine($("tts-player"), (t) => this.onTime(t));
    this.id = null;
    $("tts-voice").innerHTML = voiceOptions(C.VOICES[0]);
    const safe = (fn) => async () => {
      try {
        await fn();
      } catch (e) {
        if (e.name !== "AbortError") onError(e.message, "error");
      }
    };
    $("tts-generate").onclick = safe(() => this.generate());
    $("tts-cancel").onclick = () => this.stop();
    $("tts-clear").onclick = safe(() => this.clear());
    $("tts-download").onclick = safe(() => this.downloadAudio());
    $("tts-study").onclick = safe(() => this.makeStudy());
    $("tts-delete").onclick = safe(async () => {
      if (!this.id || !(await confirmAction("Xóa đoạn này khỏi lịch sử và Firebase?", {title: "Xóa đoạn MP3 này?", confirmLabel: "Xóa đoạn", danger: true})))
        return;
      await this.stop();
      const id = this.id;
      store.remove(id);
      await persist(true, id);
      await this.clear();
      this.renderHistory();
    });
    $("tts-speed").onchange = () => {
      const l = this.current();
      if (l) {
        l.settings.speed = Number($("tts-speed").value);
        this.engine.el.playbackRate = l.settings.speed;
        persist(false, l.id);
      }
    };
    $("tts-history").onclick = async (e) => {
      const b = e.target.closest("[data-conversion]");
      if (b)
        try {
          await this.open(b.dataset.conversion);
        } catch (e) {
          onError(e.message, "error");
        }
    };
    for (const id of [
      "tts-text",
      "tts-title",
      "tts-voice",
      "tts-rate",
      "tts-pitch",
    ])
      $(id).addEventListener("input", () => {
        $("tts-output").hidden = true;
        this.engine.stop();
      });
  }
  current() {
    return this.store.lessons.find((l) => l.id === this.id);
  }
  renderHistory() {
    const list = this.store.lessons.filter((l) => l.kind === "tts");
    $("tts-count").textContent = list.length + " đoạn";
    $("tts-history").innerHTML =
      list
        .map(
          (l) =>
            `<button class="lesson-card ${l.id === this.id ? "active" : ""}" data-conversion="${esc(l.id)}"><strong>${esc(l.title)}</strong><small>${C.tokens(l.sentences.map((s) => s.text).join(" ")).length} từ · ${C.voiceProfile(l).voice.replace("en-GB-", "").replace("Neural", "")}<br>${new Date(l.createdAt).toLocaleString("vi-VN")}</small></button>`,
        )
        .join("") ||
      '<p class="subtle">Các đoạn đã tạo sẽ tự xuất hiện ở đây.</p>';
  }
  async stop() {
    this.controller?.abort();
    this.engine.stop();
    if (this.job) await this.job.catch(() => {});
  }
  async clear() {
    await this.stop();
    this.id = null;
    this.store.current = null;
    for (const id of ["tts-text", "tts-title"]) $(id).value = "";
    $("tts-rate").value = 0;
    $("tts-pitch").value = 0;
    $("tts-output").hidden = true;
    $("tts-status").textContent = "";
    this.onSelect(null);
    this.renderHistory();
  }
  async open(id) {
    await this.stop();
    await this.persist(true);
    const l = this.store.lessons.find((l) => l.id === id);
    if (!l) return;
    this.id = id;
    this.store.current = id;
    this.onSelect(l);
    $("tts-status").textContent = "Đang tải audio đã lưu…";
    await this.hydrate(id);
    if (this.id !== id) return;
    const p = C.voiceProfile(l);
    $("tts-title").value = l.title;
    $("tts-text").value = l.sentences.map((s) => s.text).join(" ");
    $("tts-voice").value = p.voice;
    $("tts-rate").value = p.rate;
    $("tts-pitch").value = p.pitch;
    await this.showOutput(l);
    this.renderHistory();
  }
  async generate() {
    if (this.controller) return;
    await this.beforeGenerate();
    const text = $("tts-text").value.trim();
    if (!text) throw Error("Hãy dán văn bản tiếng Anh.");
    const rate = Number($("tts-rate").value),
      pitch = Number($("tts-pitch").value);
    if (
      !Number.isInteger(rate) ||
      !Number.isInteger(pitch) ||
      Math.abs(rate) > 50 ||
      Math.abs(pitch) > 50
    )
      throw Error("Tốc độ và cao độ cần là số nguyên từ -50 đến 50.");
    const l = C.createLesson(
      $("tts-title").value.trim() || text.slice(0, 55),
      C.parseTranscript(text, { maxWords: 45 }),
    );
    l.kind = "tts";
    l.voice = $("tts-voice").value;
    l.voiceProfiles[C.READER] = { voice: l.voice, rate, pitch };
    for (const r of C.readerStats(l))
      l.voiceProfiles[r.key] = { voice: l.voice, rate, pitch };
    const a = { tts: {}, full: {}, recordings: {}, source: null },
      ctl = new AbortController();
    this.controller = ctl;
    this.engine.setAssets(a);
    $("tts-generate").disabled = true;
    $("tts-cancel").hidden = false;
    $("tts-status").textContent = "Đang tạo giọng đọc…";
    this.job = (async () => {
      try {
        await this.engine.ensureLesson(
          l,
          ctl.signal,
          (n, total) =>
            ($("tts-status").textContent = `Đang tạo · ${n}/${total}`),
        );
        if (ctl.signal.aborted) throw new DOMException("Đã dừng", "AbortError");
        this.store.upsert(l);
        this.assets(l.id);
        Object.assign(this.assets(l.id), a);
        this.id = l.id;
        this.onSelect(l);
        await this.persist(true, l.id);
        await this.showOutput(l);
        this.renderHistory();
      } finally {
        this.controller = null;
        $("tts-generate").disabled = false;
        $("tts-cancel").hidden = true;
      }
    })();
    try {
      await this.job;
    } finally {
      this.job = null;
    }
  }
  async showOutput(l) {
    this.engine.setAssets(this.assets(l.id));
    await this.engine.prepareLesson(l);
    $("tts-speed").value = l.settings.speed;
    $("tts-output").hidden = false;
    $("tts-status").textContent = "Đã tạo MP3 · lịch sử tự lưu";
    this.engine.tick();
  }
  onTime(t) {
    const l = this.current();
    if (!l) return;
    const units = this.engine.current?.units;
    if (!units) return;
    const u = [...units].reverse().find((u) => t.time >= u.start) || units[0],
      s = l.sentences.find((s) => s.id === u.id);
    if (!s) return;
    let i = 0;
    const active = u.words.find(
      (w) => t.time >= w.start && t.time < w.end,
    )?.index;
    const signature = u.id + ":" + active;
    if (this.captionSignature === signature) return;
    this.captionSignature = signature;
    $("tts-caption").innerHTML = s.text.replace(
      /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu,
      (m) =>
        C.tokens(m).length
          ? `<span class="${i++ === active ? "active" : ""}">${esc(m)}</span>`
          : esc(m),
    );
  }
  async downloadAudio() {
    const l = this.current();
    if (!l || $("tts-output").hidden) throw Error("Hãy tạo MP3 trước.");
    const key = await fullKey(l),
      a = this.assets(l.id).full[key];
    if (!a) throw Error("Audio chưa tải đủ. Hãy mở lại đoạn trong lịch sử.");
    this.download(
      fromBase64(a.data, a.mime),
      (l.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "speech") +
        ".mp3",
    );
  }
  async makeStudy() {
    const old = this.current();
    if (!old || $("tts-output").hidden) return;
    const l = C.createLesson(
      old.title,
      JSON.parse(JSON.stringify(old.sentences)),
    );
    l.voice = old.voice;
    l.voiceProfiles = structuredClone(old.voiceProfiles);
    this.store.upsert(l);
    Object.assign(this.assets(l.id), structuredClone(this.assets(old.id)));
    await this.persist(true, l.id);
    await this.onStudy(l.id);
  }
}
