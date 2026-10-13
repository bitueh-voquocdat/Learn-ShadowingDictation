import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../public/core.mjs";
import { LessonStore } from "../public/store.mjs";
test("sentence boundaries, honorifics, decimals and dialogue", () => {
  const s = C.parseTranscript(
    "Alice: Dr. Smith paid 3.5 pounds. It was cheap!\nRyan: Really? I did not know.",
  );
  assert.equal(s.length, 4);
  assert.equal(s[0].speaker, "Alice");
  assert(s[0].text.includes("Dr. Smith"));
  assert(s[0].text.includes("3.5"));
  assert.equal(s[2].speaker, "Ryan");
});
test("long sentence chunks preserve words", () => {
  const text = "Learning English takes time and practice ".repeat(35);
  const s = C.parseTranscript(text, { maxWords: 20 });
  assert(s.every((x) => C.tokens(x.text).length <= 20));
  assert.equal(
    s
      .map((x) => x.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    text.trim(),
  );
});
test("SRT boundaries, multiline and entities", () => {
  const s = C.parseTranscript(
    "1\n00:00:01,000 --> 00:00:03,200\nAlice: Tea &amp; coffee,\nplease.\n\n2\n00:00:04,000 --> 00:00:05,000\nRyan: Sure.",
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].start, 1);
  assert.equal(s[0].end, 3.2);
  assert.equal(s[0].text, "Tea & coffee, please.");
  assert.equal(s[1].speaker, "Ryan");
});
test("VTT speaker tags and long cue timing", () => {
  const s = C.parseTranscript(
    "WEBVTT\n\n00:01.000 --> 00:05.000 align:start\n<v Alice>Hello there. How are you?</v>",
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].speaker, "Alice");
  assert.equal(s[0].timing, "estimated");
  assert.equal(s.at(-1).end, 5);
  assert.equal(s[0].end, s[1].start);
});
test("copied YouTube timestamps marked estimated", () => {
  const s = C.parseTranscript("0:01\nHello there.\n0:04\nHow are you?");
  assert.equal(s[0].start, 1);
  assert.equal(s[0].end, 4);
  assert.equal(s[1].timing, "estimated");
});
test("reject invalid, oversized, empty transcripts", () => {
  for (const text of [
    "",
    "x".repeat(30001),
    "1\n00:00:05,000 --> 00:00:01,000\nHi.",
  ])
    assert.throws(() => C.parseTranscript(text));
});
test("lenient and strict comparisons", () => {
  assert.equal(C.compare("Hello, World!", "hello world").score, 100);
  assert(
    C.compare("Hello, World!", "hello world", { strict: true }).score < 100,
  );
  assert.equal(C.compare("I'm happy.", "I’m happy").score, 100);
});
test("missing, excess and replacement tokens", () => {
  assert(
    C.compare("I have a book", "I have book").ops.some(
      (x) => x.type === "missing" && x.ref === "a",
    ),
  );
  assert(
    C.compare("I have a book", "I have a red book").ops.some(
      (x) => x.type === "extra",
    ),
  );
  assert(
    C.compare("I have a book", "I have a pen").ops.some(
      (x) => x.type === "wrong",
    ),
  );
  assert.equal(C.compare("I have a book", "").score, 0);
  assert.equal(C.compare("I have", "I have a very nice large book").score, 0);
});
test("transpositions are labelled moved", () => {
  assert(
    C.compare("I read books", "I books read").ops.some(
      (x) => x.type === "moved",
    ),
  );
});
test("ASR contraction normalization is isolated from dictation", () => {
  assert.equal(
    C.compare("I don't know", "I do not know", { speech: true }).score,
    100,
  );
  assert(C.compare("I don't know", "I do not know").score < 100);
});
test("error categories are suggestions", () => {
  assert(C.errorKind("books", "book").includes("Đuôi"));
  assert(C.errorKind("at", "in").includes("Giới"));
  assert(C.errorKind("friend", "freind").includes("Chính"));
  assert(C.errorKind("went", "go").includes("động"));
});
test("blanks deterministic, hints progressive", () => {
  assert.deepEqual(C.blankIndices("I have a very nice book"), [2, 5]);
  assert.equal(C.hint("practice", 1), "8 chữ cái");
  assert(C.hint("practice", 2).startsWith("p"));
  assert.equal(C.hint("practice", 4), "practice");
});
test("attempts, review mistakes, hinted answer is not mastered", () => {
  const l = C.createLesson("Example", C.parseTranscript("I have two books."));
  const s = l.sentences[0];
  C.addAttempt(l, s.id, "dict", C.compare(s.text, "I have book"), {
    answer: "I have book",
  });
  assert(l.mistakes.length);
  assert(C.dueSentences(l).length);
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text), { hints: 1 });
  assert.equal(l.progress[s.id].interval, 0);
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text));
  assert.equal(l.progress[s.id].interval, 1);
  C.addAttempt(l, s.id, "shadow", C.compare(s.text, s.text));
  assert(l.progress[s.id].completed);
  assert(l.progress[s.id].dueAt > Date.now());
});
test("attempt history cap", () => {
  const l = C.createLesson("Example", C.parseTranscript("Hello."));
  for (let i = 0; i < 25; i++)
    C.addAttempt(l, l.sentences[0].id, "dict", C.compare("Hello", "Hello"));
  assert.equal(l.progress[l.sentences[0].id].dict.attempts.length, 20);
});
test("portable file round trip retains progress, audio, notes and roles", () => {
  const l = C.createLesson(
    "Practice",
    C.parseTranscript("Alice: Hello there.\nRyan: I am fine."),
  );
  const p = l.progress[l.sentences[0].id];
  p.dict.draft = "hello";
  p.dict.attemptHints = 2;
  p.notes = "a note";
  const a = {
    tts: {
      [C.audioKey(l, l.sentences[0])]: {
        data: "YWJjZA==",
        mime: "audio/mpeg",
        words: [{ text: "Hello", start: 0.1, end: 0.5 }],
        duration: 1,
      },
    },
    recordings: {
      [l.sentences[0].id]: { data: "YWJjZA==", mime: "audio/webm;codecs=opus" },
    },
    source: { data: "YWJjZA==", mime: "video/mp4" },
  };
  const file = C.parseFile(C.serializeFile(l, a));
  assert.equal(file.lesson.progress[l.sentences[0].id].dict.attemptHints, 2);
  assert.equal(file.lesson.progress[l.sentences[0].id].notes, "a note");
  assert.equal(Object.keys(file.lesson.speakers).length, 2);
  assert.deepEqual(file.assets, a);
});
test("invalid import rejects bad versions, duplicate IDs and fake MIME", () => {
  const l = C.createLesson("Example", C.parseTranscript("Hello. Bye."));
  assert.throws(() => C.parseFile("{bad"));
  assert.throws(() =>
    C.parseFile('{"format":"shadow-dictation","version":99}'),
  );
  l.sentences[1].id = l.sentences[0].id;
  assert.throws(() => C.validateLesson(l));
  const fresh = C.createLesson("Test", C.parseTranscript("Hi."));
  assert.throws(() =>
    C.parseFile(
      C.serializeFile(fresh, {
        source: { data: "YWJjZA==", mime: "text/html" },
      }),
    ),
  );
});
test("word timings mapped, absent data explicitly approximate", () => {
  const data = C.wordIndexTimings(
    "Hello there.",
    [
      { text: "Hello", start: 0.1, end: 0.6 },
      { text: "there", start: 0.7, end: 1.1 },
    ],
    1.5,
  );
  assert.equal(data[1].start, 0.7);
  assert(data.every((x) => x.exact));
  assert(C.wordIndexTimings("Hello there.", [], 2).every((x) => !x.exact));
});
test("local store restores lesson without audio", () => {
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) || null,
      setItem: (k, v) => data.set(k, v),
    };
  const st = new LessonStore(storage);
  const l = C.createLesson("Example", C.parseTranscript("Hi."));
  st.upsert(l);
  const again = new LessonStore(storage).load();
  assert.equal(again.selected().id, l.id);
  assert.equal(again.selected().sentences[0].text, "Hi.");
  assert(!JSON.parse([...data.values()][0]).assets);
});
test("storage failure is explicit and previous stored bytes stay intact", () => {
  let old = "previous";
  const storage = {
    getItem: () => old,
    setItem: () => {
      throw Error("quota");
    },
  };
  const st = new LessonStore(storage);
  assert.throws(
    () => st.upsert(C.createLesson("Example", C.parseTranscript("Hi."))),
    /xuất bài/,
  );
  assert.equal(old, "previous");
});
test("multiple subtitle speakers remain distinct and split timing is approximate", () => {
  const s = C.parseTranscript(
    "1\n00:00:01,000 --> 00:00:05,000\nAlice: Hello there.\nRyan: Good morning.",
  );
  assert.equal(s.length, 2);
  assert.deepEqual(
    s.map((x) => x.speaker),
    ["Alice", "Ryan"],
  );
  assert(s.every((x) => x.timing === "estimated"));
  assert.equal(s[0].end, s[1].start);
  assert.equal(s[1].end, 5);
  const v = C.parseTranscript(
    "WEBVTT\n\n00:01.000 --> 00:05.000\n<v Alice>Hello.</v><v Ryan>Good morning.</v>",
  );
  assert.deepEqual(
    v.map((x) => x.speaker),
    ["Alice", "Ryan"],
  );
});
test("copied timestamped text keeps wrapped lines in the same interval", () => {
  const s = C.parseTranscript(
    "0:01\nCould I have a cup of\ntea, please?\n0:04\nOf course.",
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].text, "Could I have a cup of tea, please?");
  assert.equal(s[0].end, 4);
});
test("malformed timing and non-word text are rejected", () => {
  assert.equal(C.timecode("00:01:65"), null);
  assert.equal(C.timecode("00:61:00"), null);
  assert.throws(() => C.parseTranscript("... !!"));
  assert.throws(() =>
    C.parseTranscript(
      "00:01.000 --> 00:02.000\nHello.\n\ninvalid --> time\nBye.",
    ),
  );
  assert.throws(() =>
    C.createLesson("Too long", [
      { id: "x", text: "a ".repeat(181), speaker: "" },
    ]),
  );
});
test("speech contraction errors refer to the original word index", () => {
  const r = C.compare("I don't know why", "I do know why", { speech: true });
  const missing = r.ops.find((x) => x.type === "missing");
  assert.equal(missing.ref, "not");
  assert.equal(missing.index, 1);
});
test("extra words enter review; hinted answers do not resolve mistakes", () => {
  const l = C.createLesson("Review", C.parseTranscript("I have a book.")),
    s = l.sentences[0];
  const bad = C.compare(s.text, "I have a red book");
  C.addAttempt(l, s.id, "dict", bad);
  const m = l.mistakes.find((x) => x.opType === "extra");
  assert(m);
  assert.equal(m.word, "red");
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text), { hints: 1 });
  assert.equal(m.successes, 0);
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text));
  assert.equal(m.resolved, false);
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text));
  assert.equal(m.resolved, true);
  m.dueAt = Date.now() - 1;
  assert(C.dueSentences(l).includes(s));
  C.addAttempt(l, s.id, "dict", bad);
  assert.equal(m.successes, 0);
  assert.equal(m.resolved, false);
});
test("mastery and lifetime attempt counts survive capped history and file reopening", () => {
  const l = C.createLesson("Progress", C.parseTranscript("Hello there.")),
    s = l.sentences[0];
  C.addAttempt(l, s.id, "dict", C.compare(s.text, s.text));
  C.addAttempt(l, s.id, "shadow", C.compare(s.text, s.text));
  for (let i = 0; i < 25; i++)
    C.addAttempt(l, s.id, "dict", C.compare(s.text, ""));
  assert(l.progress[s.id].completed);
  const restored = C.parseFile(C.serializeFile(l)).lesson;
  assert(restored.progress[s.id].dict.mastered);
  assert(restored.progress[s.id].completed);
  assert.equal(restored.progress[s.id].dict.totalAttempts, 26);
  assert.equal(restored.progress[s.id].dict.attempts.length, 20);
});
test("corrupt local data is preserved while a new lesson can still be exported", () => {
  let bytes = "{broken";
  const storage = {
    getItem: () => bytes,
    setItem: (v) => {
      bytes = v;
    },
  };
  const st = new LessonStore(storage).load();
  assert(st.protected);
  const l = C.createLesson("Unsaved", C.parseTranscript("Hello."));
  assert.throws(() => st.upsert(l), /chưa ghi đè/);
  assert.equal(st.selected().id, l.id);
  assert.equal(bytes, "{broken");
  assert.equal(
    C.parseFile(C.serializeFile(st.selected())).lesson.title,
    "Unsaved",
  );
});
