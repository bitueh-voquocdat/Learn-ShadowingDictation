import { createRESTTransport } from "./rest-firestore.mjs";
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
  // A successful REST response confirms the server write; no SDK disk/cache queue.
  const transport = createRESTTransport(scope, firebaseConfig);
  return {...transport, get mode() { return "rest"; }};
}
