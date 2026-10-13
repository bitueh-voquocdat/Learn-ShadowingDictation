import { validateLesson } from "./core.mjs";
const KEY = "shadow-dictation-library-v2";
export function memoryStorage() {
  const values = new Map();
  return {getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)};
}
export class LessonStore {
  constructor(storage, key = KEY, migrate = false) {
    this.key = key;
    this.migrate = migrate;
    this.lessons = [];
    this.current = null;
    this.error = "";
    this.protected = false;
    this.transient = !storage;
    this.storage = storage || memoryStorage();
  }
  load() {
    try {
      const data = JSON.parse(
        this.storage.getItem(this.key) ||
          (this.migrate ? this.storage.getItem(KEY) : null) ||
          '{"lessons":[]}',
      );
      this.lessons = (data.lessons || []).map(validateLesson);
      this.current = this.lessons.some((l) => l.id === data.current)
        ? data.current
        : this.lessons[0]?.id || null;
    } catch (e) {
      this.error =
        "Không đọc được dữ liệu cục bộ. Bản cũ vẫn được giữ; hãy mở file bài đã xuất.";
      this.protected = true;
      this.lessons = [];
    }
    return this;
  }
  save() {
    // Runtime state stays in RAM. CloudSync is the durable store.
    if (this.transient) return;
    if (this.protected)
      throw Error(
        "Dữ liệu cục bộ cũ đang lỗi nên chưa ghi đè. Bạn vẫn có thể xuất bài đang học thành file.",
      );
    const data = JSON.stringify({
      version: 2,
      current: this.current,
      lessons: this.lessons,
    });
    if (data.length > 2_500_000)
      throw Error(
        "Dữ liệu cục bộ đã lớn. Hãy xuất bài rồi xóa bớt bài trong danh sách.",
      );
    try {
      this.storage.setItem(this.key, data);
    } catch {
      throw Error(
        "Trình duyệt không lưu được tiến độ cục bộ. Hãy xuất bài thành file để giữ tiến độ.",
      );
    }
  }
  upsert(lesson) {
    const i = this.lessons.findIndex((l) => l.id === lesson.id);
    if (i < 0) this.lessons.unshift(lesson);
    else this.lessons[i] = lesson;
    this.current = lesson.id;
    this.save();
  }
  selected() {
    return this.lessons.find((l) => l.id === this.current) || null;
  }
  remove(id) {
    this.lessons = this.lessons.filter((l) => l.id !== id);
    if (this.current === id) this.current = this.lessons[0]?.id || null;
    this.save();
  }
}
