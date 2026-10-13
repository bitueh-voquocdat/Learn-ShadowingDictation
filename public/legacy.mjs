import {validateLesson} from './core.mjs';
import {sanitizeExperience} from './preferences.mjs';

// Read-only, one-time import. No new lesson or preference data is written here.
export function legacyStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
export function readLegacy(identity, storage = legacyStorage()) {
  const result = {lessons: [], pending: {}, preferences: null, keys: [], storage, error: ''};
  if (!storage) return result;
  try {
    const previous = storage.getItem('shadowlab-private-sync');
    const ownsOldWorkspace = identity.migrate || previous === identity.token;
    const keys = ['shadowlab-library-' + identity.scope];
    if (ownsOldWorkspace) keys.push('shadow-dictation-library-v2');
    const lessons = new Map();
    for (const usedKey of keys) {
      const raw = storage.getItem(usedKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.lessons)) throw Error('Thư viện cũ không hợp lệ.');
      for (const lesson of parsed.lessons.map(validateLesson)) {
        const known = lessons.get(lesson.id);
        if (!known || lesson.updatedAt > known.updatedAt) lessons.set(lesson.id, lesson);
      }
      result.lessons = [...lessons.values()]; result.keys.push(usedKey);
    }
    const queueKey = 'shadowlab-pending-' + identity.scope, queue = storage.getItem(queueKey);
    if (queue) {
      const parsed = JSON.parse(queue);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Hàng đợi cũ không hợp lệ.');
      result.pending = parsed; result.keys.push(queueKey);
    }
    const preferences = !previous || ownsOldWorkspace ? storage.getItem('shadowlab-experience-v1') : null;
    if (preferences) {
      result.preferences = sanitizeExperience(JSON.parse(preferences));
      result.keys.push('shadowlab-experience-v1');
    }
    if (storage.getItem('shadowlab-private-sync') === identity.token)
      result.keys.push('shadowlab-private-sync');
  } catch (error) { result.error = 'Chưa nhập được dữ liệu cũ: ' + error.message; result.keys = []; }
  return result;
}
export function clearLegacy(result) {
  if (result.error) return;
  for (const key of result.keys) { try { result.storage?.removeItem(key); } catch {} }
  result.keys = [];
}
