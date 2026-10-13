// Additive lesson deletion: uses the app's existing confirmation and Firebase queue.
import {icon} from './presentation.mjs';
const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderLessonCard(lesson, active, content) {
  const id = escape(lesson.id), label = escape('Xóa bài học: ' + lesson.title);
  // Separate sibling buttons preserve native keyboard navigation. Never nest
  // the delete button inside the button used to open a lesson.
  return `<div class="lesson-card-entry"><button type="button" class="lesson-card ${active ? 'active' : ''}" data-lesson="${id}">${content}</button><button type="button" class="icon-button lesson-card-delete" data-delete-lesson="${id}" title="${label}" aria-label="${label}">${icon('trash')}</button></div>`;
}

export function installLessonDeletionStyles(doc = document) {
  if (doc.getElementById('lesson-delete-styles')) return;
  const link = doc.createElement('link');
  link.id = 'lesson-delete-styles';link.rel = 'stylesheet';
  link.href = new URL('./lesson-delete.css', import.meta.url).href;
  doc.head.append(link);
}

export function createLessonDeletion({store, sync, media, scope, confirm,
  beforeRemove = async () => {}, onRemove = () => {}, notify = () => {}}) {
  const running = new Set();
  return async function deleteLesson(id) {
    const lesson = store.lessons.find(l => l.id === id);
    if (!lesson || lesson.kind === 'tts' || running.has(id)) return false;
    running.add(id);
    try {
      if (!await confirm(`Xóa bài “${lesson.title}” khỏi danh sách và Firebase? Bản ghi trên thiết bị cũng được dọn. File bài đã xuất vẫn được giữ.`,
        {title: 'Xóa bài học này?', confirmLabel: 'Xóa bài', danger: true})) return false;
      // A remote deletion may arrive while the confirmation dialog is open.
      if (!store.lessons.some(l => l.id === id && l.kind !== 'tts')) return false;
      await beforeRemove(id, store.current === id);
      if (!store.lessons.some(l => l.id === id && l.kind !== 'tts')) return false;
      const active = store.current === id;
      const previous = store.lessons, selection = store.current;
      try {
        store.remove(id);
        store.current = active ? null : selection;
        store.save();
      } catch (error) {
        store.lessons = previous;store.current = selection;
        throw error;
      }
      // MediaStore.remove clears its RAM cache synchronously, then removes disk
      // data. Catch cleanup errors immediately; the cloud deletion must still queue.
      let cleanup;
      try { cleanup = Promise.resolve(media.remove(scope + ':' + id)).then(() => null, error => error); }
      catch (error) { cleanup = Promise.resolve(error); }
      sync.mark(id); // Queue the tombstone before awaiting disk/network activity.
      onRemove(id, active);
      await sync.checkpoints?.get(id);
      const cleanupError = await cleanup;
      await sync.flush();
      const confirmed = !sync.dirty.has(id) && sync.records.get(id)?.deleted;
      notify(confirmed ? 'Đã xóa bài học và đồng bộ Firebase.'
        : 'Đã xóa trên thiết bị. Thao tác xóa đang chờ đồng bộ Firebase.', confirmed ? 'success' : 'info');
      if (cleanupError) notify('Bài đã được xóa; chưa dọn được bản ghi trên thiết bị: ' + cleanupError.message, 'error');
      return true;
    } finally { running.delete(id); }
  };
}
