import {legacyStorage} from './legacy.mjs';
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export const digest = async (text) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
export function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
export const unbase64 = (text) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export async function workspaceIdentity(storage, url = new URL(location.href)) {
  // Existing identity is read once for migration. New identity lives only in the URL.
  if (!storage) storage = legacyStorage();
  const incoming = new URLSearchParams(url.hash.slice(1)).get("sync");
  let previous;
  try {
    previous = storage?.getItem("shadowlab-private-sync");
  } catch {}
  if (incoming && !/^[A-Za-z0-9_-]{43}$/.test(incoming))
    throw Error("Liên kết đồng bộ không hợp lệ.");
  if (previous && !/^[A-Za-z0-9_-]{43}$/.test(previous)) previous = null;
  const token =
    incoming ||
    previous ||
    base64(crypto.getRandomValues(new Uint8Array(32)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    token,
    scope: await digest(token),
    migrate: !incoming && !previous,
    url: `${url.origin}${url.pathname}${url.search}#sync=${token}`,
  };
}
export class Cipher {
  constructor(token, scope) {
    this.token = token;
    this.scope = scope;
    this.ready = crypto.subtle.importKey(
      "raw",
      unbase64(token.replace(/-/g, "+").replace(/_/g, "/") + "="),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }
  async seal(text, context) {
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      key = await this.ready;
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(this.scope + "/" + context),
      },
      key,
      encoder.encode(text),
    );
    return { iv: base64(iv), cipher: base64(new Uint8Array(encrypted)) };
  }
  async open(data, context) {
    if (
      !data ||
      typeof data.cipher !== "string" ||
      data.cipher.length > 800000 ||
      typeof data.iv !== "string" ||
      data.iv.length !== 16
    )
      throw Error("Dữ liệu đồng bộ không hợp lệ.");
    try {
      return decoder.decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: unbase64(data.iv),
            additionalData: encoder.encode(this.scope + "/" + context),
          },
          await this.ready,
          unbase64(data.cipher),
        ),
      );
    } catch {
      throw Error(
        "Không giải mã được dữ liệu. Hãy kiểm tra đúng liên kết đồng bộ.",
      );
    }
  }
  async id(text) {
    return digest(this.token + "|" + text);
  }
}
