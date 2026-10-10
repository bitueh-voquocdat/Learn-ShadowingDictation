// Translation jobs never switch the active lesson, stop audio, or replace drafts.
export function paragraphText(lesson) {
  const dialogue = lesson.sentences.some(s => s.speaker);
  return lesson.sentences.map(s => (s.speaker ? `${s.speaker}: ` : '') + s.text).join(dialogue ? '\n' : ' ');
}

export function translationSignature(lesson) {
  const source = JSON.stringify(lesson.sentences.map(s => [s.id, s.speaker || '', s.text]));
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${source.length}:${(hash >>> 0).toString(16)}`;
}

export function paragraphChunks(text, limit = 1800) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const head = rest.slice(0, limit + 1);
    const boundaries = [...head.matchAll(/[.!?]["'”’]?\s+|\n+/g)];
    let end = boundaries.at(-1)?.index;
    if (end != null && end >= limit / 3) end += boundaries.at(-1)[0].length;
    else end = head.lastIndexOf(' ');
    if (end < limit / 3) end = limit;
    if (/^[\uDC00-\uDFFF]$/.test(rest[end])) end--;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function hasCurrentTranslation(sentence) {
  return !!sentence.translation?.trim() &&
    (sentence.translationOrigin !== 'auto' || sentence.translationSource === sentence.text);
}

export function translationPlan(lesson) {
  const signature = translationSignature(lesson);
  const items = lesson.sentences.flatMap((s, index) => hasCurrentTranslation(s) ? [] : [{
    id: `sentence:${index}`, sentenceId: s.id, text: s.text, previous: s.translation || '', type: 'sentence',
  }]);
  const chunks = paragraphChunks(paragraphText(lesson));
  const cached = lesson.translationData?.partSignature === signature && Array.isArray(lesson.translationData?.parts)
    ? lesson.translationData.parts : [];
  if (!lesson.translationData?.paragraph || lesson.translationData.signature !== signature)
    chunks.forEach((text, i) => { if (!cached[i]) items.push({id: `paragraph:${i}`, text, type: 'paragraph', index: i}); });
  return {items, chunks, signature, cached};
}

export function translationBatches(items) {
  const batches = [];
  let batch = [], chars = 0;
  for (const item of items) {
    if (batch.length && (batch.length >= 8 || chars + item.text.length > 10000)) {
      batches.push(batch); batch = []; chars = 0;
    }
    batch.push(item); chars += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export class TranslationQueue {
  constructor({fetcher = globalThis.fetch, save = async () => {}, change = () => {}, status = () => {}} = {}) {
    this.fetcher = fetcher; this.save = save; this.change = change; this.status = status;
    this.jobs = new Map();
  }
  ensure(lesson) {
    if (!lesson || lesson.kind === 'tts') return Promise.resolve(false);
    const existing = this.jobs.get(lesson.id);
    if (existing && existing.lesson === lesson) { existing.changed = translationSignature(lesson) !== existing.signature; return existing.promise; }
    if (existing) this.cancel(lesson.id);
    const plan = translationPlan(lesson);
    if (!plan.items.length) {
      if (!lesson.translationData?.paragraph && plan.cached.length === plan.chunks.length && plan.cached.every(Boolean)) {
        Object.assign(lesson.translationData, {paragraph: plan.cached.join('\n\n'), signature: plan.signature, status: 'complete'});
        return this.save(lesson).then(() => { this.change(lesson); return true; });
      }
      return Promise.resolve(true);
    }
    const job = {controller: new AbortController(), signature: plan.signature, changed: false, lesson};
    this.jobs.set(lesson.id, job);
    job.promise = this.run(lesson, plan, job).finally(() => {
      if (this.jobs.get(lesson.id) === job) this.jobs.delete(lesson.id);
      this.change(lesson);
      // Editing during translation schedules the new text, not stale results.
      if (job.changed && !job.controller.signal.aborted) this.ensure(lesson);
    });
    return job.promise;
  }
  cancel(id) { this.jobs.get(id)?.controller.abort(); this.jobs.delete(id); }
  async request(batch, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, 55000);
    try {
      if (signal.aborted) throw new DOMException('Đã dừng', 'AbortError');
      const response = await this.fetcher('/api/translate', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({source: 'en', target: 'vi', items: batch.map(({id, text}) => ({id, text}))}),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.translations))
        throw Error(data.error || 'Dịch tự động chưa kết nối được.');
      return data.translations;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async run(lesson, plan, job) {
    const old = lesson.translationData || {};
    lesson.translationData = {...old, language: 'vi', status: 'pending', error: ''};
    this.status(lesson, 'pending'); this.change(lesson);
    const paragraph = new Map(plan.cached.flatMap((value, i) => value ? [[i, value]] : []));
    let failure = '', processed = 0;
    try {
      for (const batch of translationBatches(plan.items)) {
        if (job.controller.signal.aborted) break;
        try {
          const replies = await this.request(batch, job.controller.signal);
          if (job.controller.signal.aborted) break;
          for (const item of batch) {
            const reply = replies.find(r => r.id === item.id && r.text === item.text);
            if (!reply || typeof reply.translation !== 'string' || !reply.translation.trim() || reply.translation.length > 8000) {
              failure ||= 'Một số đoạn chưa dịch được. Bạn có thể thử lại.'; continue;
            }
            if (item.type === 'paragraph') paragraph.set(item.index, reply.translation.trim());
            else {
              const sentence = lesson.sentences.find(s => s.id === item.sentenceId);
              if (sentence && sentence.text === item.text && (sentence.translation || '') === item.previous) {
                sentence.translation = reply.translation.trim();
                sentence.translationOrigin = 'auto'; sentence.translationSource = item.text;
              }
            }
            processed++;
          }
        } catch (e) {
          if (job.controller.signal.aborted) break;
          failure = e.name === 'AbortError' ? 'Dịch tự động quá thời gian chờ. Hãy thử lại.' : e.message;
          // Save completed batches and avoid hammering an unavailable provider.
          break;
        }
        if (translationSignature(lesson) === plan.signature && paragraph.size === plan.chunks.length) {
          lesson.translationData.paragraph = plan.chunks.map((_, i) => paragraph.get(i)).join('\n\n');
          lesson.translationData.signature = plan.signature;
        }
        if (translationSignature(lesson) === plan.signature) {
          lesson.translationData.parts = plan.chunks.map((_, i) => paragraph.get(i) || '');
          lesson.translationData.partSignature = plan.signature;
        }
        await this.save(lesson); this.change(lesson);
      }
      if (!job.controller.signal.aborted) {
        if (translationSignature(lesson) === plan.signature && paragraph.size === plan.chunks.length) {
          lesson.translationData.paragraph = plan.chunks.map((_, i) => paragraph.get(i)).join('\n\n');
          lesson.translationData.signature = plan.signature;
        }
        const complete = !translationPlan(lesson).items.length;
        lesson.translationData.status = complete ? 'complete' : 'partial';
        lesson.translationData.updatedAt = Date.now();
        lesson.translationData.error = complete ? '' : failure || 'Nội dung vừa thay đổi; bản dịch sẽ được cập nhật.';
        await this.save(lesson); this.change(lesson);
        this.status(lesson, complete ? 'complete' : 'partial', processed);
        return complete;
      }
    } catch (e) {
      if (!job.controller.signal.aborted) {
        lesson.translationData.status = 'partial'; lesson.translationData.error = e.message;
        this.change(lesson); this.status(lesson, 'partial', processed);
      }
    }
    return false;
  }
}
