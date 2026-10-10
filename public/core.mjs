import { sanitizeExperience } from './preferences.mjs';
export const APP_VERSION = 2;
export const MAX_TEXT = 30000,
  MAX_SENTENCES = 400;
export const VOICES = [
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
  "en-GB-LibbyNeural",
  "en-GB-ThomasNeural",
];
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const tokens = (text) =>
  String(text).match(
    /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu,
  ) || [];
export const normalize = (s) =>
  String(s)
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, "");
export function timecode(s) {
  const a = String(s).trim().replace(",", ".").split(":").map(Number);
  if (
    a.some((x) => !Number.isFinite(x) || x < 0) ||
    a.length < 2 ||
    a.length > 3 ||
    a.at(-1) >= 60 ||
    (a.length === 3 && a[1] >= 60)
  )
    return null;
  return a.reduce((t, n) => t * 60 + n, 0);
}
function clean(s) {
  return s
    .replace(/<v\s+([^>]+)>/gi, "$1: ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u200b/g, "")
    .trim();
}
function turn(text) {
  const m = text.match(
    /^\s*(?:[-–—]\s*)?([\p{L}\p{N}][\p{L}\p{N} ._-]{0,30}):\s*(.*)$/u,
  );
  return m && !/^\d/.test(m[1])
    ? { speaker: m[1].trim(), text: m[2].trim() }
    : { speaker: "", text: text.replace(/^[-–—]\s*/, "").trim() };
}
export function splitSentences(text, maxWords = 32) {
  let pieces;
  if (globalThis.Intl?.Segmenter)
    pieces = [
      ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text),
    ].map((s) => s.segment.trim());
  else pieces = text.match(/[^.!?]+(?:[.!?]+["')]*|$)/g) || [text];
  const result = [];
  for (let piece of pieces) {
    // Protect honorifics and short initials when Segmenter treats them as sentences.
    if (
      result.length &&
      /\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.$/i.test(result.at(-1))
    )
      piece = result.pop() + " " + piece;
    let words = piece.split(/\s+/).filter(Boolean);
    while (words.length > maxWords) {
      let cut = maxWords;
      for (let i = maxWords - 1; i >= Math.floor(maxWords * 0.5); i--)
        if (
          /[,;:]$/.test(words[i]) ||
          /^(?:but|because|although|however|therefore|while)$/i.test(
            words[i + 1] || "",
          )
        ) {
          cut = i + 1;
          break;
        }
      result.push(words.splice(0, cut).join(" "));
    }
    if (words.length) result.push(words.join(" "));
  }
  return result;
}
export function parseTranscript(raw, { maxWords = 32 } = {}) {
  if (typeof raw !== "string" || !raw.trim())
    throw Error("Hãy dán văn bản hoặc phụ đề.");
  if (raw.length > MAX_TEXT)
    throw Error(`Văn bản tối đa ${MAX_TEXT.toLocaleString("vi-VN")} ký tự.`);
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n"),
    units = [];
  function push(text, start = null, end = null) {
    const turns = [];
    for (const line of text.replace(/<v\s+/gi, "\n<v ").split("\n")) {
      const t = turn(clean(line));
      if (!t.text) continue;
      if (t.speaker || !turns.length || /^\s*[-–—]\s/.test(line)) turns.push(t);
      else turns.at(-1).text += " " + t.text;
    }
    const segments = turns.flatMap((t) =>
      splitSentences(t.text, maxWords)
        .filter((s) => tokens(s).length)
        .map((s) => ({ text: s, speaker: t.speaker })),
    );
    let offset = start;
    const total = segments.reduce((n, s) => n + s.text.length, 0);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i],
        next =
          start === null
            ? null
            : i === segments.length - 1
              ? end
              : offset + ((end - start) * s.text.length) / total;
      units.push({
        id: uid(),
        ...s,
        translation: "",
        start: offset,
        end: next,
        timing:
          start === null ? "tts" : segments.length === 1 ? "cue" : "estimated",
        star: false,
      });
      offset = next;
    }
  }
  const timed = lines.some((l) => l.includes("-->"));
  if (timed) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/,
      );
      if (!m) {
        if (lines[i].includes("-->"))
          throw Error("Có dòng thời gian phụ đề không đọc được.");
        continue;
      }
      const start = timecode(m[1]),
        end = timecode(m[2]);
      let body = [];
      while (
        i + 1 < lines.length &&
        lines[i + 1].trim() &&
        !lines[i + 1].includes("-->")
      )
        body.push(lines[++i]);
      if (start === null || end === null || end <= start)
        throw Error("Có mốc thời gian phụ đề không hợp lệ.");
      const combined = body.join("\n"); // Preserve speaker turns; split intervals are labelled estimated.
      push(combined, start, end);
    }
    if (!units.length)
      throw Error("Không đọc được SRT/VTT. Hãy kiểm tra các dòng thời gian.");
  } else {
    // Copied YouTube transcripts with timestamp lines or [mm:ss] prefixes.
    const rows = [];
    let pending = null,
      sawTimestamp = false;
    for (const l of lines) {
      const m = l
        .trim()
        .match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/);
      if (m) {
        pending = timecode(m[1]);
        if (pending === null)
          throw Error("Có mốc thời gian phụ đề không hợp lệ.");
        sawTimestamp = true;
        if (m[2]) {
          rows.push({ text: m[2], start: pending });
          pending = null;
        }
      } else if (l.trim()) {
        if (sawTimestamp && pending === null && rows.length)
          rows.at(-1).text += "\n" + l;
        else rows.push({ text: l, start: pending });
        pending = null;
      }
    }
    const hasTimes = rows.some((r) => r.start !== null);
    if (hasTimes) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const next = rows.slice(i + 1).find((x) => x.start !== null)?.start;
        const end =
          r.start !== null
            ? next > r.start
              ? next
              : r.start + Math.max(1, tokens(r.text).length / 2.5)
            : null;
        push(r.text, r.start, end);
        if (units.length) units.at(-1).timing = "estimated";
      }
    } else for (const row of rows) push(row.text);
  }
  if (!units.length) throw Error("Không có câu tiếng Anh để luyện.");
  if (units.length > MAX_SENTENCES)
    throw Error(`Bài tối đa ${MAX_SENTENCES} câu; hãy chia bài nhỏ hơn.`);
  return units;
}
const contractions = {
  "don't": "do not",
  "doesn't": "does not",
  "didn't": "did not",
  "can't": "cannot",
  "won't": "will not",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "i'm": "i am",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "it's": "it is",
  "i've": "i have",
  "we've": "we have",
  "they've": "they have",
  "i'll": "i will",
  "you'll": "you will",
  "we'll": "we will",
  "let's": "let us",
};
const PREPS = new Set(
  "in on at to for from with without of about into over under between through by during before after".split(
    " ",
  ),
);
function stem(s) {
  const map = {
    went: "go",
    gone: "go",
    goes: "go",
    was: "be",
    were: "be",
    is: "be",
    am: "be",
    are: "be",
    has: "have",
    had: "have",
    did: "do",
    does: "do",
    made: "make",
    took: "take",
    taken: "take",
    bought: "buy",
  };
  return map[s] || s.replace(/(?:ing|ed|es|s)$/, "");
}
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
export function errorKind(ref, actual) {
  const r = normalize(ref),
    a = normalize(actual);
  if (r === a) return "Chữ hoa / dấu câu";
  if (PREPS.has(r)) return "Giới từ (gợi ý)";
  if (stem(r) === stem(a))
    return /s$/.test(r) || /s$/.test(a)
      ? "Đuôi -s / dạng từ (gợi ý)"
      : "Dạng động từ (gợi ý)";
  if (a && distance(r, a) <= Math.max(1, Math.floor(r.length / 4)))
    return "Chính tả (gợi ý)";
  return "Thay thế từ";
}
function comparable(text, strict, speech) {
  let s = String(text).replace(/[’‘]/g, "'");
  if (speech)
    s = s.replace(
      /[\p{L}]+(?:'[\p{L}]+)+/gu,
      (m) => contractions[m.toLowerCase()] || m,
    );
  return strict
    ? s.trim().split(/\s+/).filter(Boolean)
    : tokens(s).map(normalize);
}
export function compare(
  reference,
  answer,
  { strict = false, speech = false, maxWords = 200 } = {},
) {
  const r = comparable(reference, strict, speech),
    a = comparable(answer, strict, speech);
  const limit = Math.min(700, Math.max(200, maxWords));
  if (r.length > limit || a.length > Math.max(400, limit * 2))
    throw Error("Câu trả lời quá dài.");
  const dp = Array.from(
    { length: r.length + 1 },
    () => new Uint16Array(a.length + 1),
  );
  for (let i = 0; i <= r.length; i++) dp[i][0] = i;
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= a.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + (r[i - 1] === a[j - 1] ? 0 : 1),
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
      );
  let i = r.length,
    j = a.length;
  const ops = [];
  while (i || j) {
    if (i && j && r[i - 1] === a[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      ops.push({ type: "correct", ref: r[--i], actual: a[--j], index: i });
    } else if (i && j && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({
        type: "wrong",
        ref: r[--i],
        actual: a[--j],
        index: i,
        kind: errorKind(r[i], a[j]),
      });
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({
        type: "missing",
        ref: r[--i],
        actual: "",
        index: i,
        kind: "Thiếu từ",
      });
    } else {
      ops.push({
        type: "extra",
        ref: "",
        actual: a[--j],
        index: Math.max(0, i - 1),
        kind: "Thừa từ",
      });
    }
  }
  ops.reverse();
  const missing = ops.filter((x) => x.type === "missing"),
    extra = ops.filter((x) => x.type === "extra");
  for (const m of missing) {
    const e = extra.find(
      (x) => x.type === "extra" && normalize(x.actual) === normalize(m.ref),
    );
    if (e) {
      m.type = "moved";
      e.type = "moved-extra";
      m.kind = e.kind = "Sai vị trí";
    }
  }
  // Adjacent transpositions often align as two substitutions.
  for (let k = 0; k < ops.length - 1; k++) {
    const x = ops[k],
      y = ops[k + 1];
    if (
      x.type === "wrong" &&
      y.type === "wrong" &&
      normalize(x.ref) === normalize(y.actual) &&
      normalize(y.ref) === normalize(x.actual)
    ) {
      x.type = y.type = "moved";
      x.kind = y.kind = "Sai vị trí";
    }
  }
  if (speech) {
    const origins = tokens(reference).flatMap((w, index) =>
      (contractions[w.toLowerCase().replace(/[’‘]/g, "'")] || w)
        .split(/\s+/)
        .map(() => index),
    );
    for (const o of ops) o.index = origins[o.index] ?? o.index;
  }
  return {
    score: Math.round(
      Math.max(0, 1 - dp[r.length][a.length] / Math.max(1, r.length)) * 100,
    ),
    ops,
    strict,
    referenceCount: r.length,
    correct: ops.filter((o) => o.type === "correct").length,
  };
}
export function blankIndices(text, difficulty = 3) {
  const words = tokens(text),
    result = [];
  for (let i = 0; i < words.length; i++)
    if (i % difficulty === difficulty - 1) result.push(i);
  if (!result.length && words.length) result.push(Math.floor(words.length / 2));
  return result;
}
export function hint(word, level) {
  const s = String(word);
  if (level === 1) return `${tokens(s).join("").length} chữ cái`;
  if (level === 2) return s[0] + " " + "·".repeat(Math.max(0, s.length - 1));
  if (level === 3)
    return [...s].map((c, i) => (i % 2 === 0 ? c : "·")).join("");
  return s;
}
export function freshProgress() {
  return {
    dict: {
      draft: "",
      blanks: {},
      attempts: [],
      totalAttempts: 0,
      mastered: false,
      listens: 0,
      hints: 0,
      attemptHints: 0,
      retries: 0,
      hintLevel: 0,
      best: 0,
      last: 0,
    },
    shadow: {
      transcript: "",
      attempts: [],
      totalAttempts: 0,
      mastered: false,
      listens: 0,
      best: 0,
      last: 0,
    },
    listen: 0,
    notes: "",
    completed: false,
    dueAt: 0,
    interval: 0,
  };
}
export function createLesson(title, sentences) {
  if (
    !Array.isArray(sentences) ||
    !sentences.length ||
    sentences.length > MAX_SENTENCES ||
    sentences.some(
      (s) =>
        typeof s.text !== "string" ||
        !tokens(s.text).length ||
        s.text.length > 1200 ||
        tokens(s.text).length > 180,
    )
  )
    throw Error("Có câu trống hoặc quá dài. Hãy sửa/chia câu.");
  if (sentences.reduce((n, s) => n + s.text.length, 0) > MAX_TEXT)
    throw Error("Bài vượt giới hạn 30.000 ký tự.");
  const speakers = [
    ...new Set(sentences.map((s) => s.speaker).filter(Boolean)),
  ];
  return {
    id: uid(),
    kind: "study",
    notes: "",
    title: title.trim() || "Bài luyện mới",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sentences,
    speakers: Object.fromEntries(
      speakers.map((s, i) => [s, VOICES[i % VOICES.length]]),
    ),
    voice: VOICES[0],
    voiceProfiles: {},
    cursor: 0,
    mode: "listen",
    settings: {
      speed: 1,
      gap: 3,
      repeat: 1,
      strict: false,
      shadow: "repeat",
      autoNext: false,
      autoRecord: false,
      role: "",
      captions: true,
      translation: false,
      source: "tts",
      dictType: "full",
    },
    progress: Object.fromEntries(sentences.map((s) => [s.id, freshProgress()])),
    mistakes: [],
    sourceName: "",
    sourceMime: "",
    recordingMeta: {},
  };
}
export function addAttempt(
  lesson,
  sentenceId,
  mode,
  result,
  { hints = 0, answer = "" } = {},
) {
  const p = lesson.progress[sentenceId],
    now = Date.now(),
    m = p[mode];
  m.totalAttempts++;
  m.attempts.push({
    at: now,
    score: result.score,
    hints,
    answer: answer.slice(0, 3000),
  });
  m.attempts = m.attempts.slice(-20);
  m.best = Math.max(m.best, result.score);
  m.last = result.score;
  for (const o of result.ops.filter(
    (o) => o.type !== "correct" && o.type !== "moved-extra",
  )) {
    const key = `${sentenceId}:${mode}:${o.index}${o.type === "extra" ? ":extra:" + normalize(o.actual) : ""}`;
    let row = lesson.mistakes.find((x) => x.key === key);
    if (!row) {
      row = {
        key,
        sentenceId,
        mode,
        index: o.index,
        word: o.ref || o.actual,
        kind: o.kind || o.type,
        opType: o.type,
        count: 0,
        resolved: false,
        dueAt: now,
        successes: 0,
      };
      lesson.mistakes.push(row);
    }
    row.count++;
    row.successes = 0;
    row.resolved = false;
    row.lastSeen = now;
    row.dueAt = now;
  }
  const correctIndices = [
    ...new Set(
      result.ops
        .filter(
          (o) =>
            o.type === "correct" &&
            !result.ops.some(
              (x) => x.index === o.index && x.type !== "correct",
            ),
        )
        .map((o) => o.index),
    ),
  ];
  if (!hints)
    for (const index of correctIndices) {
      const key = `${sentenceId}:${mode}:${index}`,
        row = lesson.mistakes.find((x) => x.key === key);
      if (row) {
        row.successes++;
        row.resolved = row.successes >= 2;
        row.dueAt = now + (row.resolved ? 3 : 1) * 86400000;
      }
    }
  if (result.score === 100 && !hints)
    for (const row of lesson.mistakes.filter(
      (m) =>
        m.sentenceId === sentenceId && m.mode === mode && m.opType === "extra",
    )) {
      row.successes++;
      row.resolved = row.successes >= 2;
      row.dueAt = now + (row.resolved ? 3 : 1) * 86400000;
    }
  if (result.score === 100 && !hints) {
    p.interval = Math.min(30, p.interval ? p.interval * 2 : 1);
    p.dueAt = now + p.interval * 86400000;
  } else p.dueAt = now + 86400000;
  if (result.score >= (mode === "dict" ? 100 : 90) && !hints) m.mastered = true;
  p.completed = p.dict.mastered && p.shadow.mastered;
  lesson.updatedAt = now;
}
export const dueSentences = (lesson) =>
  lesson.sentences.filter(
    (s) =>
      s.star ||
      (lesson.progress[s.id].dueAt &&
        lesson.progress[s.id].dueAt <= Date.now()) ||
      lesson.mistakes.some(
        (m) => m.sentenceId === s.id && (!m.resolved || m.dueAt <= Date.now()),
      ),
  );
export function audioKey(lesson, sentence) {
  const p = voiceProfile(lesson, sentence.speaker);
  return `${p.voice}${p.rate || p.pitch ? `@${p.rate}:${p.pitch}` : ""}|${sentence.text}`;
}
export const READER = "__reader__";
export function voiceProfile(lesson, speaker = "") {
  const p = lesson.voiceProfiles?.[speaker || READER] || {};
  return {
    voice: VOICES.includes(p.voice)
      ? p.voice
      : lesson.speakers[speaker] || lesson.voice,
    rate: Math.round(finite(p.rate, -50, 50, 0)),
    pitch: Math.round(finite(p.pitch, -50, 50, 0)),
  };
}
export function readerStats(lesson) {
  const rows = new Map();
  for (const s of lesson.sentences) {
    const key = s.speaker || READER;
    if (!rows.has(key))
      rows.set(key, {
        key,
        name: s.speaker || "Người đọc",
        sentences: 0,
        words: 0,
        profile: voiceProfile(lesson, s.speaker),
      });
    const row = rows.get(key);
    row.sentences++;
    row.words += tokens(s.text).length;
  }
  return [...rows.values()];
}
export function planSpeech(lesson, maxChars = 5000) {
  const result = [];
  for (const s of lesson.sentences) {
    const profile = voiceProfile(lesson, s.speaker),
      key = JSON.stringify(profile),
      last = result.at(-1);
    if (
      last &&
      last.key === key &&
      last.text.length + s.text.length + 1 <= maxChars &&
      tokens(last.text).length + tokens(s.text).length <= 850
    ) {
      last.text += " " + s.text;
      last.sentences.push(s);
    } else result.push({ key, profile, text: s.text, sentences: [s] });
  }
  return result;
}
export const speechSignature = (lesson) =>
  JSON.stringify(
    lesson.sentences.map((s) => [
      s.id,
      s.text,
      voiceProfile(lesson, s.speaker),
    ]),
  );
export function wordIndexTimings(text, words, duration) {
  const list = tokens(text);
  let index = 0;
  const mapped = [];
  for (const w of words || []) {
    const wt = tokens(w.text);
    for (const token of wt) {
      while (index < list.length && normalize(list[index]) !== normalize(token))
        index++;
      if (index < list.length)
        mapped.push({
          index: index++,
          start: w.start,
          end: w.end,
          exact: true,
        });
    }
  }
  return list.map(
    (_, i) =>
      mapped.find((m) => m.index === i) || {
        index: i,
        start: (duration * i) / Math.max(1, list.length),
        end: (duration * (i + 1)) / Math.max(1, list.length),
        exact: false,
      },
  );
}
function finite(n, min, max, fallback) {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max
    ? n
    : fallback;
}
export function validateLesson(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.sentences) ||
    !input.sentences.length ||
    input.sentences.length > MAX_SENTENCES
  )
    throw Error("File không có cấu trúc bài học hợp lệ.");
  const seen = new Set(),
    sentences = input.sentences.map((s) => {
      if (
        !s ||
        typeof s.text !== "string" ||
        !s.text.trim() ||
        s.text.length > 1200
      )
        throw Error("Nội dung câu trong file không hợp lệ.");
      const id = typeof s.id === "string" && s.id.length < 100 ? s.id : uid();
      if (seen.has(id)) throw Error("File có ID câu trùng lặp.");
      seen.add(id);
      const start = s.start === null ? null : finite(s.start, 0, 86400, null),
        end = s.end === null ? null : finite(s.end, 0, 86400, null);
      return {
        id,
        text: s.text,
        speaker: String(s.speaker || "").slice(0, 40),
        translation: String(s.translation || "").slice(0, 8000),
        ...(s.translationOrigin === "auto" || s.translationOrigin === "manual"
          ? { translationOrigin: s.translationOrigin,
              translationSource: typeof s.translationSource === "string" ? s.translationSource.slice(0, 1200) : "" }
          : {}),
        start,
        end: end !== null && start !== null && end > start ? end : null,
        timing: ["tts", "cue", "estimated"].includes(s.timing)
          ? s.timing
          : "tts",
        star: !!s.star,
      };
    });
  if (sentences.reduce((n, s) => n + s.text.length, 0) > MAX_TEXT)
    throw Error("Bài vượt giới hạn văn bản.");
  const lesson = createLesson(
    String(input.title || "Bài đã mở").slice(0, 120),
    sentences,
  );
  if (typeof input.id === "string" && input.id.length < 100)
    lesson.id = input.id;
  lesson.kind = input.kind === "tts" ? "tts" : "study";
  lesson.notes = String(input.notes || "").slice(0, 10000);
  lesson.createdAt = finite(
    input.createdAt,
    0,
    Date.now() + 86400000,
    Date.now(),
  );
  lesson.updatedAt = finite(
    input.updatedAt,
    0,
    Date.now() + 86400000,
    Date.now(),
  );
  lesson.cursor = Math.floor(finite(input.cursor, 0, sentences.length - 1, 0));
  lesson.mode = ["listen", "dict", "shadow", "review"].includes(input.mode)
    ? input.mode
    : "listen";
  if (VOICES.includes(input.voice)) lesson.voice = input.voice;
  for (const speaker of Object.keys(lesson.speakers))
    if (VOICES.includes(input.speakers?.[speaker]))
      lesson.speakers[speaker] = input.speakers[speaker];
  for (const key of [...Object.keys(lesson.speakers), READER]) {
    const p = input.voiceProfiles?.[key];
    if (p && typeof p === "object")
      lesson.voiceProfiles[key] = {
        voice: VOICES.includes(p.voice)
          ? p.voice
          : key === READER
            ? lesson.voice
            : lesson.speakers[key],
        rate: Math.round(finite(p.rate, -50, 50, 0)),
        pitch: Math.round(finite(p.pitch, -50, 50, 0)),
      };
  }
  const t = input.settings || {},
    s = lesson.settings;
  s.speed = finite(t.speed, 0.5, 2, 1);
  s.gap = finite(t.gap, 0, 15, 3);
  s.repeat = Math.floor(finite(t.repeat, 1, 10, 1));
  s.strict = !!t.strict;
  s.autoNext = !!t.autoNext;
  s.autoRecord = !!t.autoRecord;
  s.captions = t.captions !== false;
  s.translation = !!t.translation;
  if (t.experience && typeof t.experience === "object")
    s.experience = sanitizeExperience(t.experience);
  if (input.translationData && typeof input.translationData === "object") {
    const data = input.translationData;
    lesson.translationData = {
      language: "vi",
      paragraph: typeof data.paragraph === "string" ? data.paragraph.slice(0, 80000) : "",
      signature: typeof data.signature === "string" ? data.signature.slice(0, 100) : "",
      partSignature: typeof data.partSignature === "string" ? data.partSignature.slice(0, 100) : "",
      parts: Array.isArray(data.parts) ? data.parts.slice(0, 64).map(p => typeof p === "string" ? p.slice(0, 8000) : "") : [],
      status: ["pending", "partial", "complete"].includes(data.status) ? data.status : "partial",
      error: typeof data.error === "string" ? data.error.slice(0, 400) : "",
      updatedAt: finite(data.updatedAt, 0, Date.now() + 86400000, 0),
    };
  }
  s.role = Object.hasOwn(lesson.speakers, t.role) ? t.role : "";
  s.source = t.source === "original" ? "original" : "tts";
  s.dictType = t.dictType === "blanks" ? "blanks" : "full";
  if (["repeat", "simultaneous", "delayed", "continuous"].includes(t.shadow))
    s.shadow = t.shadow;
  for (const sentence of sentences) {
    const p = lesson.progress[sentence.id],
      old = input.progress?.[sentence.id];
    if (!old) continue;
    for (const mode of ["dict", "shadow"]) {
      const q = old[mode] || {},
        m = p[mode];
      for (const k of [
        "totalAttempts",
        "listens",
        "hints",
        "attemptHints",
        "retries",
        "hintLevel",
        "best",
        "last",
      ])
        if (k in m)
          m[k] = finite(
            q[k],
            0,
            k === "best" || k === "last" ? 100 : 100000,
            0,
          );
      if (Array.isArray(q.attempts))
        m.attempts = q.attempts.slice(-20).map((a) => ({
          at: finite(a.at, 0, Date.now() + 86400000, Date.now()),
          score: finite(a.score, 0, 100, 0),
          hints: finite(a.hints, 0, 100000, 0),
          answer: String(a.answer || "").slice(0, 3000),
        }));
      m.totalAttempts = Math.max(m.totalAttempts, m.attempts.length);
      m.mastered =
        !!q.mastered ||
        m.attempts.some(
          (a) => a.score >= (mode === "dict" ? 100 : 90) && !a.hints,
        );
    }
    p.dict.draft = String(old.dict?.draft || "").slice(0, 3000);
    const b = old.dict?.blanks || {};
    for (const k of Object.keys(b))
      if (/^\d+$/.test(k) && Number(k) < 200)
        p.dict.blanks[k] = String(b[k]).slice(0, 100);
    p.shadow.transcript = String(old.shadow?.transcript || "").slice(0, 3000);
    p.listen = finite(old.listen, 0, 100000, 0);
    p.notes = String(old.notes || "").slice(0, 2000);
    p.completed = !!old.completed;
    p.dueAt = finite(old.dueAt, 0, Date.now() + 366 * 86400000, 0);
    p.interval = finite(old.interval, 0, 30, 0);
  }
  lesson.mistakes = (Array.isArray(input.mistakes) ? input.mistakes : [])
    .slice(0, 10000)
    .filter(
      (m) => seen.has(m.sentenceId) && ["dict", "shadow"].includes(m.mode),
    )
    .map((m) => ({
      key: String(m.key || "").slice(0, 200),
      sentenceId: m.sentenceId,
      mode: m.mode,
      index: Math.floor(finite(m.index, 0, 200, 0)),
      word: String(m.word || "").slice(0, 100),
      kind: String(m.kind || "").slice(0, 100),
      opType: ["wrong", "missing", "extra", "moved"].includes(m.opType)
        ? m.opType
        : "wrong",
      count: finite(m.count, 0, 100000, 0),
      resolved: !!m.resolved,
      dueAt: finite(m.dueAt, 0, Date.now() + 366 * 86400000, 0),
      successes: finite(m.successes, 0, 100000, 0),
      lastSeen: finite(m.lastSeen, 0, Date.now() + 86400000, 0),
    }));
  lesson.sourceName = String(input.sourceName || "").slice(0, 200);
  lesson.sourceMime = /^(audio|video)\/[\w.+-]+$/.test(input.sourceMime)
    ? input.sourceMime
    : "";
  for (const [id, meta] of Object.entries(input.recordingMeta || {}))
    if (seen.has(id) && seen.has(meta?.owner))
      lesson.recordingMeta[id] = {
        owner: meta.owner,
        continuous: !!meta.continuous,
      };
  return lesson;
}
export function serializeFile(lesson, assets = {}) {
  return JSON.stringify({
    format: "shadow-dictation",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    lesson,
    assets,
  });
}
export function parseFile(text) {
  if (text.length > 90_000_000)
    throw Error("File bài học quá lớn (tối đa 90 MB).");
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw Error("File JSON không đọc được.");
  }
  if (file.format !== "shadow-dictation" || file.version !== APP_VERSION)
    throw Error("Định dạng hoặc phiên bản bài học chưa được hỗ trợ.");
  const lesson = validateLesson(file.lesson),
    assets = file.assets || {};
  const safe = { tts: {}, recordings: {}, source: null };
  function media(a) {
    if (
      !a ||
      typeof a.data !== "string" ||
      !a.data.length ||
      a.data.length % 4 ||
      a.data.length > 70_000_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) ||
      !/^(audio|video)\/[\w.+-]+(?:;\s*codecs=[\w.,'" -]+)?$/.test(a.mime)
    )
      throw Error("Dữ liệu âm thanh trong file không hợp lệ.");
    return { data: a.data, mime: a.mime };
  }
  const ids = new Set(lesson.sentences.map((s) => s.id));
  for (const [k, v] of Object.entries(assets.tts || {})) {
    if (k.length > 5200) throw Error("Cache âm thanh không hợp lệ.");
    const a = media(v);
    safe.tts[k] = {
      data: a.data,
      mime: a.mime,
      words: Array.isArray(v.words)
        ? v.words
            .slice(0, 1000)
            .filter(
              (w) =>
                typeof w.text === "string" &&
                Number.isFinite(w.start) &&
                Number.isFinite(w.end) &&
                w.start >= 0 &&
                w.end > w.start,
            )
            .map((w) => ({
              text: w.text.slice(0, 200),
              start: w.start,
              end: w.end,
            }))
        : [],
      duration: finite(v.duration, 0, 3600, 0),
    };
  }
  for (const [k, v] of Object.entries(assets.recordings || {}))
    if (ids.has(k)) safe.recordings[k] = {...media(v),
      ...(Number.isFinite(v.createdAt) && v.createdAt > 0 ? {createdAt: v.createdAt} : {})};
  if (assets.source) safe.source = media(assets.source);
  if (assets.full) {
    safe.full = {};
    for (const [k, v] of Object.entries(assets.full)) {
      if (!/^[a-f0-9]{64}$/.test(k))
        throw Error("Audio toàn bài không hợp lệ.");
      const a = media(v);
      if (
        a.mime !== "audio/mpeg" ||
        !Array.isArray(v.units) ||
        v.units.length > 400
      )
        throw Error("Mốc audio toàn bài không hợp lệ.");
      safe.full[k] = {
        ...a,
        duration: finite(v.duration, 0, 20000, 0),
        units: v.units.map((u) => {
          if (
            !ids.has(u.id) ||
            !Number.isFinite(u.start) ||
            !Number.isFinite(u.end) ||
            u.start < 0 ||
            u.end <= u.start
          )
            throw Error("Mốc câu trong audio toàn bài không hợp lệ.");
          return {
            id: u.id,
            start: u.start,
            end: u.end,
            words: (u.words || [])
              .slice(0, 200)
              .filter(
                (w) =>
                  Number.isInteger(w.index) &&
                  w.index >= 0 &&
                  Number.isFinite(w.start) &&
                  Number.isFinite(w.end) &&
                  w.end > w.start,
              )
              .map((w) => ({
                index: w.index,
                start: w.start,
                end: w.end,
                exact: !!w.exact,
              })),
          };
        }),
      };
    }
  }
  return { lesson, assets: safe };
}
