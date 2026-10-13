import {
  planSpeech,
  speechSignature,
  tokens,
  wordIndexTimings,
  audioKey,
} from "./core.mjs";
import { digest, base64, unbase64 } from "./crypto-sync.mjs";

// Keep complete MPEG Layer III frames. Removing only the trailing silence keeps
// the bit reservoir at the beginning intact and avoids a lossy second encoding.
export function mp3Frames(data, keepUntil = Infinity) {
  const b = typeof data === "string" ? unbase64(data) : data;
  let p = 0,
    time = 0,
    end = b.length;
  if (b[0] === 73 && b[1] === 68 && b[2] === 51) {
    if (b.length < 10 || [6, 7, 8, 9].some((i) => b[i] > 127))
      throw Error("Header MP3 không hợp lệ.");
    p =
      10 +
      ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) +
      (b[5] & 16 ? 10 : 0);
  }
  const start = p;
  if (
    end >= 128 &&
    b[end - 128] === 84 &&
    b[end - 127] === 65 &&
    b[end - 126] === 71
  )
    end -= 128;
  while (p + 4 <= end) {
    const ver = (b[p + 1] >> 3) & 3,
      layer = (b[p + 1] >> 1) & 3,
      bi = b[p + 2] >> 4,
      si = (b[p + 2] >> 2) & 3;
    if (
      b[p] !== 255 ||
      (b[p + 1] & 224) !== 224 ||
      ver === 1 ||
      layer !== 1 ||
      bi === 0 ||
      bi === 15 ||
      si === 3
    )
      throw Error("Khung MP3 không hợp lệ. Hãy tạo lại âm thanh.");
    const rate =
      [44100, 48000, 32000][si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
    const kbps = (
      ver === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    )[bi];
    const size =
      Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / rate) +
      ((b[p + 2] >> 1) & 1);
    if (p + size > end) throw Error("Khung MP3 bị thiếu dữ liệu.");
    p += size;
    time += (ver === 3 ? 1152 : 576) / rate;
    if (time >= keepUntil) break;
  }
  if (p === start) throw Error("MP3 không có âm thanh.");
  return { bytes: b.subarray(start, p), duration: time };
}

export const fullKey = (lesson) => digest(speechSignature(lesson));

export async function buildFullAudio(
  lesson,
  cache,
  request,
  signal,
  onProgress = () => {},
) {
  const groups = planSpeech(lesson),
    parts = [],
    units = [];
  let offset = 0;
  for (let g = 0; g < groups.length; g++) {
    if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
    const group = groups[g],
      item = { text: group.text, speaker: group.sentences[0].speaker },
      key = audioKey(lesson, item);
    let audio = cache[key];
    if (!audio) {
      audio = await request(
        group.text,
        group.profile.voice,
        signal,
        group.profile,
      );
      if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
      cache[key] = audio;
    }
    const raw = mp3Frames(audio.data),
      last = audio.words.at(-1)?.end;
    const trimmed =
      Number.isFinite(last) && last > 0 && last < raw.duration
        ? mp3Frames(audio.data, Math.min(raw.duration, last + 0.18))
        : raw;
    parts.push(trimmed.bytes);
    const allWords = wordIndexTimings(
      group.text,
      audio.words,
      trimmed.duration,
    );
    let wordOffset = 0;
    const groupUnits = group.sentences.map((s) => {
      const count = tokens(s.text).length,
        words = allWords
          .slice(wordOffset, wordOffset + count)
          .map((w, index) => ({
            ...w,
            index,
            start: offset + w.start,
            end: Math.min(offset + trimmed.duration, offset + w.end),
          }));
      wordOffset += count;
      return {
        id: s.id,
        start: words[0]?.start ?? offset,
        end: offset + trimmed.duration,
        words,
      };
    });
    groupUnits[0].start = offset;
    for (let i = 0; i < groupUnits.length - 1; i++)
      groupUnits[i].end = groupUnits[i + 1].start;
    units.push(...groupUnits);
    offset += trimmed.duration;
    onProgress(g + 1, groups.length);
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    bytes.set(part, p);
    p += part.length;
  }
  return { data: base64(bytes), mime: "audio/mpeg", duration: offset, units };
}
