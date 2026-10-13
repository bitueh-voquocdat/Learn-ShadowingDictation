// YouTube lessons use imported time-coded captions and the official visible player.
export const YOUTUBE_VERSION = 1;
const wordRE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;
const words = text => String(text).match(wordRE) || [];
const key = text => text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'");
const round = value => Math.round(value * 1000) / 1000;
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400;

export function youtubeVideoID(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw Error('Hãy dán đường dẫn video YouTube hợp lệ.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw Error('Đường dẫn phải là video trên youtube.com hoặc youtu.be.');
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  let id = '';
  if (['youtu.be', 'www.youtu.be'].includes(host)) id = parts.length === 1 ? parts[0] : '';
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live'].includes(parts[0]) && parts.length === 2) id = parts[1];
  }
  if (!/^[\w-]{11}$/.test(id)) throw Error('Không tìm được ID video trong link YouTube. Hãy dùng link của một video.');
  return id;
}
export const youtubeURL = id => `https://www.youtube.com/watch?v=${id}`;

export function sanitizeYouTubeSource(value) {
  if (!value || typeof value !== 'object' || value.version !== YOUTUBE_VERSION ||
    !/^[\w-]{11}$/.test(value.videoId || '')) return null;
  return {
    version: YOUTUBE_VERSION, videoId: value.videoId, url: youtubeURL(value.videoId),
    format: ['srt', 'vtt', 'youtube'].includes(value.format) ? value.format : 'youtube',
    transcript: typeof value.transcript === 'string' ? value.transcript.slice(0, 30000) : '',
    importedAt: typeof value.importedAt === 'number' && Number.isFinite(value.importedAt) &&
      value.importedAt >= 0 && value.importedAt <= Date.now() + 86400000 ? value.importedAt : 0,
    wordTiming: 'estimated',
  };
}

export function sanitizeSubtitleTiming(value, sentence) {
  if (!value || value.text !== sentence.text || !validTime(sentence.start) ||
    !validTime(sentence.end) || sentence.end <= sentence.start || !Array.isArray(value.words) ||
    value.words.length !== words(sentence.text).length || value.words.length > 180) return null;
  let previous = sentence.start;
  const result = [];
  for (let i = 0; i < value.words.length; i++) {
    const w = value.words[i];
    if (!w || !validTime(w.start) || !validTime(w.end) || w.end <= w.start ||
      w.start < sentence.start - .001 || w.end > sentence.end + .001 || w.start < previous - .001) return null;
    result.push({index: i, start: w.start, end: w.end, exact: false});
    previous = w.end;
  }
  return {text: sentence.text, words: result};
}

function timecode(text) {
  if (!/^(?:\d{1,3}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?$/.test(text)) return null;
  const parts = text.replace(',', '.').split(':').map(Number);
  if (parts.at(-1) >= 60 || parts.length === 3 && parts[1] >= 60) return null;
  const value = parts.reduce((a, b) => a * 60 + b, 0);
  return validTime(value) ? value : null;
}
function decode(text) {
  return text.replace(/<v\s+([^>]+)>/gi, '$1: ').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, s => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s])
    .replace(/&#(x[\da-f]+|\d+);/gi, (all, n) => {
      const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    }).replace(/[\u200b\uFEFF]/g, '').trim();
}
function bodyText(text) {
  return decode(text).split('\n').filter(line => !/^\s*[[(](?:music|applause|laughter|laughing|silence|inaudible|cheering)[\])]\s*$/i.test(line))
    .join('\n').trim();
}

export function readYouTubeCues(raw, {lastEnd = null} = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw Error('Hãy dán transcript hoặc nhập file SRT/VTT.');
  if (raw.length > 30000) throw Error('Transcript tối đa 30.000 ký tự. Hãy chia video thành bài nhỏ hơn.');
  if (lastEnd !== null && (!validTime(lastEnd) || lastEnd === 0)) throw Error('Mốc kết thúc cuối phải lớn hơn 0 và không quá 24 giờ.');
  raw = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n'), cues = [], isVTT = /^WEBVTT\b/.test(raw), arrows = raw.includes('-->');
  if (arrows) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(NOTE|STYLE|REGION)\b/.test(lines[i])) { while (i + 1 < lines.length && lines[i + 1].trim()) i++; continue; }
      if (!lines[i].includes('-->')) continue;
      const m = lines[i].trim().match(/^((?:\d{1,3}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,3}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?)(?:\s+.*)?$/);
      if (!m) throw Error('Có dòng thời gian SRT/VTT không hợp lệ.');
      const start = timecode(m[1]), end = timecode(m[2]), body = [];
      if (start === null || end === null || end <= start) throw Error('Mốc cuối phụ đề phải lớn hơn mốc đầu.');
      while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].includes('-->')) body.push(lines[++i]);
      // Support contiguous cues without a blank separator or optional SRT numbers.
      if (i + 1 < lines.length && lines[i + 1].includes('-->') && /^\d+$/.test(body.at(-1) || '')) body.pop();
      const text = bodyText(body.join('\n'));
      if (words(text).length) cues.push({start, end, text, estimated: false});
    }
  } else {
    let pending = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^\[?((?:\d{1,3}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/);
      if (m) {
        const start = timecode(m[1]);
        if (start === null) throw Error('Có mốc transcript không hợp lệ.');
        pending = {start, end: null, text: m[2], estimated: true};
        cues.push(pending);
      } else if (pending) pending.text += '\n' + line;
      else if (!/^(?:Transcript|English(?:\s*\(.*\))?|Search in video|Bản chép lời)$/i.test(trimmed))
        throw Error('Transcript YouTube cần mốc thời gian. Hãy bật mốc trong bản chép lời hoặc nhập SRT/VTT.');
    }
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]; c.text = bodyText(c.text);
      if (i + 1 < cues.length) c.end = cues[i + 1].start;
      else c.end = lastEnd ?? round(c.start + Math.max(1, words(c.text).length / 2.5));
      if (c.end <= c.start) throw Error('Các mốc transcript phải tăng dần.');
    }
  }
  if (!cues.length) throw Error('Không tìm thấy phụ đề có mốc thời gian để tạo bài YouTube.');
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (!validTime(c.end) || c.end <= c.start || i && c.start < cues[i - 1].start)
      throw Error('Mốc phụ đề phải tăng dần và nằm trong 24 giờ.');
  }
  return {cues: cues.filter(c => words(c.text).length), format: isVTT ? 'vtt' : arrows ? 'srt' : 'youtube'};
}

function removeRollingCaptions(cues) {
  let previous = null;
  const output = [];
  for (const source of cues) {
    const c = {...source};
    if (previous && c.start < previous.end) {
      const before = words(previous.text), after = [...c.text.matchAll(wordRE)];
      let overlap = 0;
      for (let n = Math.min(before.length, after.length); n >= 1; n--) {
        if (before.slice(-n).every((w, i) => key(w) === key(after[i][0]))) { overlap = n; break; }
      }
      if (overlap >= 1) {
        const cut = overlap === after.length ? c.text.length : after[overlap].index;
        c.text = c.text.slice(cut).trim();
      }
      const last = output.at(-1);
      if (last && !words(c.text).length) last.end = Math.max(last.end, c.end);
      else if (last && c.start > last.start) last.end = Math.min(last.end, c.start);
    }
    if (words(c.text).length) output.push(c);
    previous = source;
  }
  return output;
}

export function createYouTubeSentences(raw, helpers, {maxWords = 32, lastEnd = null} = {}) {
  const read = readYouTubeCues(raw, {lastEnd}), fragments = [];
  maxWords = [20, 32, 45].includes(maxWords) ? maxWords : 32;
  for (const cue of removeRollingCaptions(read.cues)) {
    const turns = [];
    for (const line of cue.text.split('\n')) {
      const m = line.match(/^\s*(?:[-–—]\s*)?([\p{L}][\p{L}\p{N} ._-]{0,30}):\s*(.*)$/u);
      const t = m ? {speaker: m[1].trim(), text: m[2].trim()} : {speaker: '', text: line.replace(/^\s*[-–—]\s*/, '').trim()};
      if (!t.text) continue;
      if (!turns.length || t.speaker || /^\s*[-–—]\s*/.test(line)) turns.push(t);
      else turns.at(-1).text += ' ' + t.text;
    }
    const pieces = turns.flatMap(t => helpers.splitSentences(t.text, maxWords).map(text => ({text, speaker: t.speaker})))
      .filter(t => words(t.text).length);
    const total = pieces.reduce((sum, t) => sum + words(t.text).length, 0);
    let offset = 0;
    for (const p of pieces) {
      const tokens = words(p.text), start = cue.start + (cue.end - cue.start) * offset / total;
      offset += tokens.length;
      const end = cue.start + (cue.end - cue.start) * offset / total;
      const timed = tokens.map((w, i) => ({start: start + (end - start) * i / tokens.length,
        end: start + (end - start) * (i + 1) / tokens.length}));
      fragments.push({...p, start: round(start), end: round(end), words: timed,
        timing: cue.estimated || pieces.length > 1 ? 'estimated' : 'cue'});
    }
  }
  const sentences = [], maxSeconds = Math.max(8, maxWords / 2.5);
  const terminated = text => /[.!?]["'’”)\]]*$/.test(text) && !/\b(?:Mr|Mrs|Ms|Dr|Prof|St)\.$/i.test(text);
  for (const piece of fragments) {
    const previous = sentences.at(-1);
    if (previous && !terminated(previous.text) && previous.speaker === piece.speaker &&
      piece.start >= previous.end - .002 && piece.start - previous.end <= 1.25 &&
      words(previous.text).length + words(piece.text).length <= maxWords && piece.end - previous.start <= maxSeconds) {
      previous.text += ' ' + piece.text; previous.end = piece.end;
      previous.words.push(...piece.words);
      if (piece.timing === 'estimated') previous.timing = 'estimated';
    } else sentences.push({...piece});
  }
  if (!sentences.length) throw Error('Không có câu tiếng Anh trong phụ đề.');
  if (sentences.length > 400) throw Error('Bài tối đa 400 câu. Hãy chia video thành bài nhỏ hơn.');
  const result = sentences.map(({words: timed, ...s}) => ({id: helpers.uid(), ...s,
    translation: '', star: false, subtitleTiming: {text: s.text, words: timed.map((w, index) =>
      ({index, start: Math.max(s.start, round(w.start)), end: Math.min(s.end, round(w.end)), exact: false}))}}));
  return {sentences: result, format: read.format};
}

export function subtitleWords(sentence) {
  const valid = sanitizeSubtitleTiming(sentence.subtitleTiming, sentence);
  if (valid) return valid.words;
  const tokens = words(sentence.text), duration = sentence.end - sentence.start;
  return tokens.map((word, index) => ({index, start: sentence.start + duration * index / tokens.length,
    end: sentence.start + duration * (index + 1) / tokens.length, exact: false}));
}
