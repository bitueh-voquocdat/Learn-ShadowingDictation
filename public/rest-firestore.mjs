// Firestore's authenticated and unauthenticated REST requests use the same
// Security Rules as the web client. No service-account credential is included.
function encode(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(encode) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, encode(v)]),
      ),
    },
  };
}
function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  return Object.fromEntries(
    Object.entries(value.mapValue?.fields || {}).map(([k, v]) => [
      k,
      decode(v),
    ]),
  );
}
const fields = (value) => encode(value).mapValue.fields;
const unpack = (row) =>
  row
    ? {
        id: row.name.split("/").at(-1),
        ...decode({ mapValue: { fields: row.fields || {} } }),
      }
    : null;
export function createRESTTransport(scope, config, {pollInterval = 4000} = {}) {
  const resource = `projects/${config.projectId}/databases/(default)/documents`,
    root = "https://firestore.googleapis.com/v1/" + resource,
    query = "key=" + encodeURIComponent(config.apiKey),
    folder = `shadowlab/${scope}`;
  const entry = (id) => folder + "/entries/" + encodeURIComponent(id),
    blob = (id) => folder + "/blobs/" + encodeURIComponent(id);
  async function request(
    route,
    { method = "GET", body, missing = false, signal } = {},
  ) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const r = await fetch(
        root + route + (route.includes("?") ? "&" : "?") + query,
        {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
          cache: "no-store",
        },
      );
      if (missing && r.status === 404) return null;
      const value = r.status === 204 ? null : await r.json();
      if (!r.ok) {
        const e = Error(value?.error?.message || "Firebase chưa phản hồi.");
        e.code =
          {
            PERMISSION_DENIED: "permission-denied",
            UNAVAILABLE: "unavailable",
            ABORTED: "sync/conflict",
            FAILED_PRECONDITION: "sync/conflict",
            ALREADY_EXISTS: "sync/conflict",
          }[value?.error?.status] || "firebase/rest-error";
        throw e;
      }
      return value;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = Error("Kết nối Firebase quá thời gian chờ.");
        error.code = "unavailable";
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async function list() {
    const result = [];
    let next = "";
    do {
      const page = await request(
        "/" +
          folder +
          "/entries?pageSize=300" +
          (next ? "&pageToken=" + encodeURIComponent(next) : ""),
      );
      result.push(...(page.documents || []).map(unpack));
      next = page.nextPageToken || "";
    } while (next);
    return result;
  }
  return {
    list,
    get: async (id) =>
      unpack(await request("/" + entry(id), { missing: true })),
    chunk: async (id) => {
      const row = await request("/" + blob(id));
      return decode({ mapValue: { fields: row.fields } });
    },
    putChunk: (id, value) =>
      request("/" + blob(id), {
        method: "PATCH",
        body: { fields: fields(value) },
      }),
    removeChunk: (id) =>
      request("/" + blob(id), { method: "DELETE", missing: true }),
    async commit(id, expected, value) {
      const row = await request("/" + entry(id), { missing: true });
      // An earlier SDK attempt may have committed while its response timed out.
      if (row && unpack(row).revision === value.revision) return;
      if ((row ? unpack(row).revision : null) !== expected) {
        const e = Error("Bài đã thay đổi trên thiết bị khác.");
        e.code = "sync/conflict";
        throw e;
      }
      await request(":commit", {
        method: "POST",
        body: {
          writes: [
            {
              update: {
                name: resource + "/" + folder + "/entries/" + id,
                fields: fields(value),
              },
              currentDocument: row
                ? { updateTime: row.updateTime }
                : { exists: false },
            },
          ],
        },
      });
    },
    watch(fn, error) {
      let busy = false,
        closed = false;
      const poll = async () => {
        if (busy || closed || document.visibilityState === 'hidden') return;
        busy = true;
        try {
          const rows = await list();
          // A successful unchanged poll also recovers health after a network error.
          if (!closed) await fn(rows);
        } catch (e) {
          if (!closed) error(e);
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(poll, pollInterval);
      poll();
      const visible = () => {
        if (document.visibilityState === "visible") poll();
      };
      document.addEventListener("visibilitychange", visible);
      globalThis.addEventListener?.('online', poll);
      globalThis.addEventListener?.('focus', visible);
      return () => {
        closed = true;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", visible);
        globalThis.removeEventListener?.('online', poll);
        globalThis.removeEventListener?.('focus', visible);
      };
    },
  };
}
