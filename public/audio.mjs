import {
  audioKey,
  wordIndexTimings,
  voiceProfile,
  planSpeech,
} from "./core.mjs";
import { buildFullAudio, fullKey } from "./full-audio.mjs";
export const abortError = () => new DOMException("Đã dừng", "AbortError");
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    let t;
    const abort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    t = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export function fromBase64(data, mime = "audio/mpeg") {
  const binary = atob(data),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("Không đọc được tệp âm thanh."));
    reader.readAsDataURL(blob);
  });
}
export function joinMP3(items) {
  const parts = items.map((item) => {
    if (item.mime !== "audio/mpeg")
      throw Error(
        "Audio trong bài không phải MP3 giọng UK. Hãy tạo lại audio trước khi tải toàn bài.",
      );
    const binary = atob(item.data),
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    let start = 0,
      end = bytes.length;
    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      if (bytes.length < 10 || [6, 7, 8, 9].some((i) => bytes[i] > 127))
        throw Error("Header MP3 không hợp lệ.");
      start =
        10 +
        ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) +
        (bytes[5] & 16 ? 10 : 0);
    }
    if (
      end >= 128 &&
      bytes[end - 128] === 84 &&
      bytes[end - 127] === 65 &&
      bytes[end - 126] === 71
    )
      end -= 128;
    if (
      start + 4 > end ||
      bytes[start] !== 255 ||
      (bytes[start + 1] & 224) !== 224 ||
      (bytes[start + 1] & 6) !== 2
    )
      throw Error("Dữ liệu MP3 không hợp lệ. Hãy tạo lại audio.");
    return bytes.subarray(start, end);
  });
  return new Blob(parts, { type: "audio/mpeg" });
}
export async function requestTTS(text, voice, signal, profile = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = new AbortController(),
      abort = () => c.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) c.abort();
    const timer = setTimeout(() => c.abort(), 65000);
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice,
          rate: profile.rate || 0,
          pitch: profile.pitch || 0,
          format: "json",
        }),
        signal: c.signal,
        cache: "no-store",
      });
      if (!r.ok) {
        let error = "";
        try {
          error = (await r.json()).error || "";
        } catch {}
        if ([502, 503, 504].includes(r.status) && !attempt) {
          clearTimeout(timer);
          await delay(1600, signal);
          continue;
        }
        throw Error(
          r.status === 404
            ? "API chưa được triển khai. Hãy tải cả thư mục api lên Vercel."
            : error || `Dịch vụ âm thanh báo lỗi ${r.status}.`,
        );
      }
      let data;
      try {
        data = await r.json();
      } catch {
        throw Error("Phản hồi API không hợp lệ.");
      }
      if (
        data.mime !== "audio/mpeg" ||
        typeof data.audio !== "string" ||
        data.audio.length < 100 ||
        !Number.isFinite(data.duration) ||
        data.duration <= 0
      )
        throw Error("API không trả về MP3 hợp lệ.");
      return {
        data: data.audio,
        mime: data.mime,
        duration: data.duration,
        words: Array.isArray(data.words) ? data.words : [],
      };
    } catch (e) {
      if (c.signal.aborted && !signal?.aborted)
        throw Error("Tạo giọng đọc quá thời gian chờ. Hãy thử lại.");
      if (e instanceof TypeError)
        throw Error("Mất kết nối Internet khi tạo âm thanh.");
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
export class AudioEngine {
  constructor(el, onTime = () => {}) {
    this.el = el;
    this.onTime = onTime;
    this.current = null;
    this.bound = null;
    this.urls = new Map();
    this.cache = {};
    this.source = null;
    this.abort = null;
    this.active = 0;
    this.waiting = false;
    this.anim = 0;
    el.addEventListener("timeupdate", () => this.tick());
    el.addEventListener("play", () => this.animate());
    el.addEventListener("pause", () => cancelAnimationFrame(this.anim));
  }
  tick() {
    if (this.current)
      this.onTime({
        time: this.el.currentTime,
        start: this.current.start,
        end: this.current.end,
        words: this.current.words,
        source: this.current.source,
        playing: !this.el.paused,
      });
  }
  animate() {
    cancelAnimationFrame(this.anim);
    const frame = () => {
      this.tick();
      if (!this.el.paused) this.anim = requestAnimationFrame(frame);
    };
    frame();
  }
  setAssets(assets) {
    this.stop();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.cache = assets.tts || {};
    this.full = assets.full ||= {};
    this.source = assets.source || null;
    this.current = null;
    this.el.removeAttribute("src");
    this.el.load();
  }
  url(key, blob) {
    if (!this.urls.has(key)) this.urls.set(key, URL.createObjectURL(blob));
    return this.urls.get(key);
  }
  async ensure(lesson, sentence, signal) {
    const cache = this.cache,
      key = audioKey(lesson, sentence);
    if (!cache[key]) {
      const data = await requestTTS(
        sentence.text,
        voiceProfile(lesson, sentence.speaker).voice,
        signal,
        voiceProfile(lesson, sentence.speaker),
      );
      if (signal?.aborted) throw abortError();
      cache[key] = data;
    }
    return cache[key];
  }
  async ensureLesson(lesson, signal, onProgress) {
    const full = this.full,
      cache = this.cache,
      key = await fullKey(lesson);
    if (!full[key]) {
      const result = await buildFullAudio(
        lesson,
        cache,
        requestTTS,
        signal,
        onProgress,
      );
      if (signal?.aborted) throw abortError();
      full[key] = result;
      // The bundle contains the same bytes. Do not sync duplicate group clips.
      for (const group of planSpeech(lesson))
        delete cache[
          audioKey(lesson, {
            text: group.text,
            speaker: group.sentences[0].speaker,
          })
        ];
      for (const old of Object.keys(full)) if (old !== key) delete full[old];
    }
    return { key, ...full[key] };
  }
  async prepareLesson(lesson, signal, fromCursor = false, onProgress) {
    let url, start, end, units, source;
    if (lesson.settings.source === "original") {
      if (!this.source) throw Error("Hãy chọn lại file audio/video gốc.");
      if (lesson.sentences.some((s) => s.start === null || s.end === null))
        throw Error(
          "Một số câu chưa có mốc audio gốc. Hãy chỉnh mốc hoặc chọn giọng UK.",
        );
      url = this.url(
        "original",
        this.source.blob || fromBase64(this.source.data, this.source.mime),
      );
      await this.loadURL(url, signal);
      units = lesson.sentences.map((s) => ({
        id: s.id,
        start: s.start,
        end: Math.min(s.end, this.el.duration),
        words: wordIndexTimings(s.text, [], s.end - s.start).map((w) => ({
          ...w,
          start: w.start + s.start,
          end: w.end + s.start,
        })),
      }));
      if (units.some((u) => u.end <= u.start))
        throw Error("Mốc phụ đề nằm ngoài audio gốc.");
      source = "original";
    } else {
      const data = await this.ensureLesson(lesson, signal, onProgress);
      url = this.url("full:" + data.key, fromBase64(data.data, data.mime));
      await this.loadURL(url, signal);
      units = data.units;
      source = "tts";
    }
    start = units[fromCursor ? lesson.cursor : 0].start;
    end = units.at(-1).end;
    if (Number.isFinite(this.el.duration))
      end = Math.min(end, this.el.duration);
    this.current = {
      lessonId: lesson.id,
      units,
      start,
      end,
      source,
      words: [],
    };
    this.el.playbackRate = lesson.settings.speed;
    this.el.currentTime = start;
    this.tick();
    return this.current;
  }
  async loadURL(url, signal) {
    if (this.el.src === url && this.el.readyState >= 1) return;
    this.el.src = url;
    this.el.load();
    await new Promise((resolve, reject) => {
      let timer;
      const clear = () => {
        clearTimeout(timer);
        this.el.removeEventListener("loadedmetadata", loaded);
        this.el.removeEventListener("error", error);
        signal?.removeEventListener("abort", abort);
      };
      const loaded = () => {
        clear();
        resolve();
      };
      const error = () => {
        clear();
        reject(Error("Trình duyệt không đọc được định dạng audio/video này."));
      };
      const abort = () => {
        clear();
        reject(abortError());
      };
      this.el.addEventListener("loadedmetadata", loaded, { once: true });
      this.el.addEventListener("error", error, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(error, 15000);
      if (signal?.aborted) abort();
    });
  }
  async prepare(lesson, sentence, signal) {
    let data, url, start, end, words, source;
    if (lesson.settings.source === "original") {
      if (!this.source)
        throw Error(
          "Hãy chọn lại file audio/video gốc hoặc mở bài có kèm file đó.",
        );
      if (sentence.start === null || sentence.end === null)
        throw Error(
          "Câu này chưa có mốc thời gian. Hãy chỉnh mốc câu hoặc dùng giọng UK.",
        );
      const blob =
        this.source.blob || fromBase64(this.source.data, this.source.mime);
      url = this.url("original", blob);
      await this.loadURL(url, signal);
      start = sentence.start;
      end = Math.min(sentence.end, this.el.duration);
      if (start >= end)
        throw Error(
          "Mốc câu nằm ngoài thời lượng file gốc. Hãy sửa thời gian câu.",
        );
      words = wordIndexTimings(sentence.text, [], end - start).map((w) => ({
        ...w,
        start: w.start + start,
        end: w.end + start,
      }));
      source = "original";
    } else {
      const key = await fullKey(lesson),
        bundle = this.full[key],
        unit = bundle?.units.find(
          (u) =>
            u.id === sentence.id &&
            lesson.sentences.find((s) => s.id === u.id)?.text === sentence.text,
        );
      if (unit) {
        url = this.url("full:" + key, fromBase64(bundle.data, bundle.mime));
        await this.loadURL(url, signal);
        start = unit.start;
        end = unit.end;
        words = unit.words;
        source = "tts";
      } else {
        data = await this.ensure(lesson, sentence, signal);
        url = this.url(
          audioKey(lesson, sentence),
          fromBase64(data.data, data.mime),
        );
        await this.loadURL(url, signal);
        start = 0;
        end = Number.isFinite(this.el.duration)
          ? this.el.duration
          : data.duration;
        words = wordIndexTimings(sentence.text, data.words, end);
        source = "tts";
      }
    }
    if (signal?.aborted) throw abortError();
    this.current = { sentenceId: sentence.id, start, end, words, source };
    this.el.playbackRate = lesson.settings.speed;
    this.el.currentTime = start;
    this.tick();
    return this.current;
  }
  async segment(start, end, signal) {
    if (signal?.aborted) throw abortError();
    this.el.currentTime = start;
    const marker = { start, end };
    this.bound = marker;
    try {
      await this.el.play();
    } catch (e) {
      if (this.bound === marker) this.bound = null;
      throw e;
    }
    await new Promise((resolve, reject) => {
      let interval;
      const clear = () => {
        clearInterval(interval);
        if (this.bound === marker) this.bound = null;
        this.el.removeEventListener("ended", done);
        this.el.removeEventListener("error", error);
        signal?.removeEventListener("abort", abort);
      };
      const done = () => {
        clear();
        this.el.pause();
        this.tick();
        resolve();
      };
      const error = () => {
        clear();
        reject(Error("Không phát được âm thanh."));
      };
      const abort = () => {
        clear();
        this.el.pause();
        reject(abortError());
      };
      this.el.addEventListener("ended", done, { once: true });
      this.el.addEventListener("error", error, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      interval = setInterval(() => {
        if (this.el.currentTime >= end - 0.015) done();
      }, 25);
      if (signal?.aborted) abort();
    });
  }
  stop() {
    this.abort?.abort();
    this.abort = null;
    this.active++;
    this.bound = null;
    this.el.pause();
    cancelAnimationFrame(this.anim);
  }
  seek(value) {
    if (this.current)
      this.el.currentTime = Math.max(
        this.current.start,
        Math.min(this.current.end, value),
      );
    this.tick();
  }
  togglePause() {
    if (!this.current) return;
    if (this.el.paused) {
      if (this.el.currentTime >= this.current.end - 0.05)
        this.el.currentTime = this.current.start;
      return this.el.play();
    }
    this.el.pause();
  }
  async word(lesson, sentence, index, signal, isolated = false) {
    const c = await this.prepare(lesson, sentence, signal),
      w = c.words[index];
    if (!w) return;
    if (isolated) {
      const word = sentence.text.match(
        /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu,
      )?.[index];
      if (!word) return;
      const item = { ...sentence, text: word, id: sentence.id };
      const one = await this.prepare(lesson, item, signal);
      return this.segment(one.start, one.end, signal);
    }
    // No forced alignment for original files: replay the entire cue instead of inventing a precise word location.
    return this.segment(
      w.exact ? Math.max(c.start, w.start - 0.08) : c.start,
      w.exact ? Math.min(c.end, w.end + 0.12) : c.end,
      signal,
    );
  }
  destroy() {
    this.stop();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
