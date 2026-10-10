import { initializeApp } from "./vendor/firebase-app.mjs";
import { createRESTTransport } from "./rest-firestore.mjs";
import {
  getFirestore,
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  disableNetwork,
} from "./vendor/firebase-firestore.mjs";
export const firebaseConfig = {
  apiKey: "AIzaSyCL9Cx9MURvNeRcoMa6V1vopQCyNK-oLWY",
  authDomain: "shadow-study-mindlab.firebaseapp.com",
  projectId: "shadow-study-mindlab",
  storageBucket: "shadow-study-mindlab.firebasestorage.app",
  messagingSenderId: "643727635421",
  appId: "1:643727635421:web:14b5314dda7ca36521fc34",
  measurementId: "G-5XT8WD4FF6",
};
export function createTransport(scope) {
  const db = getFirestore(initializeApp(firebaseConfig)),
    entries = collection(db, "shadowlab", scope, "entries");
  const ref = (id) => doc(entries, id),
    blob = (id) => doc(db, "shadowlab", scope, "blobs", id);
  const sdk = {
    async list() {
      return (await getDocsFromServer(entries)).docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
    },
    watch(fn, error) {
      return onSnapshot(
        entries,
        { includeMetadataChanges: true },
        (s) => {
          if (!s.metadata.fromCache)
            fn(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        error,
      );
    },
    async get(id) {
      const s = await getDocFromServer(ref(id));
      return s.exists() ? { id, ...s.data() } : null;
    },
    async chunk(id) {
      const s = await getDocFromServer(blob(id));
      if (!s.exists())
        throw Error("Audio hoặc phiên bản bài chưa tải đủ. Hãy đồng bộ lại.");
      return s.data();
    },
    putChunk: (id, data) => setDoc(blob(id), data),
    removeChunk: (id) => deleteDoc(blob(id)),
    async commit(id, expected, value) {
      return runTransaction(db, async (t) => {
        const s = await t.get(ref(id)),
          revision = s.exists() ? s.data().revision : null;
        if (revision !== expected) {
          const e = Error("Bài đã thay đổi trên thiết bị khác.");
          e.code = "sync/conflict";
          throw e;
        }
        t.set(ref(id), value);
      });
    },
  };
  const rest = createRESTTransport(scope, firebaseConfig);
  let fallback = false;
  return {
    async list() {
      if (fallback) return rest.list();
      let timer;
      try {
        return await Promise.race([
          sdk.list(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const e = Error("Firebase cần kết nối dự phòng.");
              e.code = "unavailable";
              reject(e);
            }, 6500);
          }),
        ]);
      } catch (e) {
        if (!["unavailable", "deadline-exceeded"].includes(e.code)) throw e;
        fallback = true;
        disableNetwork(db).catch(()=>{});
        return rest.list();
      } finally {
        clearTimeout(timer);
      }
    },
    get: (id) => (fallback ? rest : sdk).get(id),
    chunk: (id) => (fallback ? rest : sdk).chunk(id),
    putChunk: (id, v) => (fallback ? rest : sdk).putChunk(id, v),
    removeChunk: (id) => (fallback ? rest : sdk).removeChunk(id),
    commit: (id, expected, v) =>
      (fallback ? rest : sdk).commit(id, expected, v),
    watch: (fn, error) => (fallback ? rest : sdk).watch(fn, error),
    get mode() {
      return fallback ? "rest" : "sdk";
    },
  };
}
