"""POST /api/translate: bounded English → Vietnamese translation batches.

Uses Bing's public translator with a fresh session. Google's key-free endpoint
and MyMemory provide fallbacks. An optional GOOGLE_TRANSLATE_API_KEY selects
Google's official Cloud Translation API instead.
No source text is logged. Translation failures never prevent creating a lesson.
"""
import asyncio
import html
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler

import aiohttp

MAX_BODY = 64_000
MAX_ITEMS = 20
MAX_TEXT = 2000
MAX_TOTAL = 12_000
TIMEOUT = 45
_cache = {}


class InputError(ValueError):
    pass


def validate(payload):
    if not isinstance(payload, dict) or payload.get("source", "en") != "en" or payload.get("target", "vi") != "vi":
        raise InputError("Chỉ hỗ trợ dịch tiếng Anh sang tiếng Việt.")
    items = payload.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise InputError("Mỗi lượt dịch cần từ 1 đến 20 đoạn.")
    clean, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            raise InputError("Đoạn dịch không hợp lệ.")
        key, text = item.get("id"), item.get("text")
        if not isinstance(key, str) or not key or len(key) > 100 or key in seen:
            raise InputError("ID đoạn dịch trống hoặc trùng lặp.")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT or "\x00" in text:
            raise InputError("Mỗi đoạn dịch tối đa 2.000 ký tự.")
        seen.add(key)
        clean.append({"id": key, "text": text})
    if sum(len(item["text"]) for item in clean) > MAX_TOTAL:
        raise InputError("Một lượt dịch tối đa 12.000 ký tự.")
    return clean


def decoded_translation(data):
    if isinstance(data, list) and data and isinstance(data[0], list):
        parts = [row[0] for row in data[0] if isinstance(row, list) and row and isinstance(row[0], str)]
        value = "".join(parts)
    elif isinstance(data, dict) and isinstance(data.get("sentences"), list):
        value = "".join(row.get("trans", "") for row in data["sentences"] if isinstance(row, dict))
    else:
        raise ValueError("Invalid translation response")
    if not value.strip() or len(value) > 8000:
        raise ValueError("Empty or oversized translation response")
    return value.strip()


async def fetch_json(session, url, **kwargs):
    async with session.request(kwargs.pop("method", "GET"), url, **kwargs) as response:
        response.raise_for_status()
        raw = await read_bounded(response, 1_000_000)
        return json.loads(raw)


async def read_bounded(response, limit):
    parts, size = [], 0
    async for chunk in response.content.iter_chunked(65536):
        size += len(chunk)
        if size > limit:
            raise ValueError("Oversized provider response")
        parts.append(chunk)
    return b"".join(parts)


def byte_chunks(text, limit=480):
    """MyMemory's documented limit is bytes, not Unicode characters."""
    chunks, current = [], ""
    for char in text:
        if len((current + char).encode("utf-8")) > limit:
            split = max(current.rfind(" "), current.rfind("\n"))
            if split > len(current) // 2:
                chunks.append(current[:split])
                current = current[split:].lstrip() + char
            else:
                chunks.append(current)
                current = char
        else:
            current += char
    if current.strip():
        chunks.append(current.strip())
    return chunks


def provider_chunks(text, limit=900):
    chunks = []
    rest = text.strip()
    while len(rest) > limit:
        head = rest[:limit + 1]
        stops = list(re.finditer(r'[.!?]["\'”’]?\s+|\n+', head))
        end = stops[-1].end() if stops and stops[-1].end() > limit // 3 else head.rfind(" ")
        if end < limit // 3:
            end = limit
        chunks.append(rest[:end].strip())
        rest = rest[end:].strip()
    if rest:
        chunks.append(rest)
    return chunks


class BingClient:
    """One authenticated public web session per batch; no user account."""
    def __init__(self, session):
        self.session = session
        self.lock = asyncio.Lock()
        self.state = None
        self.unavailable = False

    async def initialize(self, refresh=False):
        async with self.lock:
            if self.state and not refresh:
                return
            if self.unavailable:
                raise ValueError("Translator session unavailable")
            try:
                async with self.session.get("https://www.bing.com/translator",
                                            params={"fresh": str(time.time_ns())},
                                            headers={"Cache-Control": "no-cache"}) as response:
                    response.raise_for_status()
                    page = (await read_bounded(response, 2_000_000)).decode("utf-8")
                token = re.search(r"params_AbusePreventionHelper\s*=\s*(\[[^;]+\])", page)
                ig = re.search(r'IG:"([^"]+)"', page)
                if not token or not ig:
                    raise ValueError("Translator session unavailable")
                values = json.loads(token.group(1))
                if len(values) < 2 or not isinstance(values[1], str):
                    raise ValueError("Invalid translator session")
                self.state = (str(values[0]), values[1], ig.group(1))
            except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, UnicodeError):
                self.unavailable = True
                raise

    async def translate(self, text):
        if len(text) > 900:
            parts = []
            for chunk in provider_chunks(text):
                parts.append(await self.translate(chunk))
            return "\n".join(parts)
        for attempt in range(2):
            await self.initialize()
            key, token, ig = self.state
            try:
                data = await fetch_json(self.session, "https://www.bing.com/ttranslatev3",
                                        method="POST", params={"isVertical": "1", "IG": ig, "IID": "translator.5028"},
                                        data={"fromLang": "en", "to": "vi", "text": text, "token": token, "key": key},
                                        headers={"Referer": "https://www.bing.com/translator", "Origin": "https://www.bing.com"})
                value = data[0]["translations"][0]["text"].strip()
                if not value or len(value) > 8000:
                    raise ValueError("Invalid translator response")
                return value
            except aiohttp.ClientResponseError as error:
                if error.status != 401 or attempt:
                    raise
                await self.initialize(refresh=True)
        raise ValueError("Translator session expired")


async def translate_one(session, text, bing=None):
    cached = _cache.get(text)
    if cached and cached[0] > time.time():
        return cached[1], cached[2]
    api_key = os.environ.get("GOOGLE_TRANSLATE_API_KEY")
    if api_key:
        data = await fetch_json(session, "https://translation.googleapis.com/language/translate/v2",
                                method="POST", params={"key": api_key},
                                json={"q": text, "source": "en", "target": "vi", "format": "text"})
        value = html.unescape(data["data"]["translations"][0]["translatedText"]).strip()
        if not value or len(value) > 8000:
            raise ValueError("Invalid Cloud Translation response")
        provider = "google-cloud"
    else:
        value, provider = "", "bing"
        if bing:
            try:
                value = await bing.translate(text)
            except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError, TypeError, IndexError):
                pass
        if not value:
            provider = "google"
            for attempt in range(2):
                try:
                    data = await fetch_json(session, "https://translate.googleapis.com/translate_a/single",
                                            params={"client": "gtx", "sl": "en", "tl": "vi", "dt": "t", "q": text})
                    value = decoded_translation(data)
                    break
                except aiohttp.ClientResponseError as error:
                    if error.status in (403, 429) or attempt:
                        break
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
                    if attempt == 0:
                        await asyncio.sleep(0.3)
        if not value:
            parts = []
            for chunk in byte_chunks(text):
                data = await fetch_json(session, "https://api.mymemory.translated.net/get",
                                        params={"q": chunk, "langpair": "en|vi"})
                if str(data.get("responseStatus")) != "200" or data.get("quotaFinished"):
                    raise ValueError("Translation fallback unavailable")
                translated = data.get("responseData", {}).get("translatedText", "")
                if not isinstance(translated, str) or not translated.strip() or len(translated) > 8000:
                    raise ValueError("Invalid fallback response")
                parts.append(html.unescape(translated).strip())
            value, provider = " ".join(parts), "mymemory"
    if len(_cache) >= 256:
        _cache.pop(next(iter(_cache)))
    _cache[text] = (time.time() + 3600, value, provider)
    return value, provider


async def translate_batch(items):
    semaphore = asyncio.Semaphore(4)
    results, errors = [], []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), trust_env=True,
                                     headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}) as session:
        bing = BingClient(session)
        async def work(item):
            async with semaphore:
                try:
                    value, provider = await translate_one(session, item["text"], bing)
                    results.append({**item, "translation": value, "provider": provider})
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError, TypeError, IndexError):
                    errors.append(item["id"])
        tasks = [asyncio.create_task(work(item)) for item in items]
        _, pending = await asyncio.wait(tasks, timeout=TIMEOUT)
        for task in pending:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        completed = {item["id"] for item in results}
        failed = [item["id"] for item in items if item["id"] not in completed]
        return {"translations": results, "failed": failed, "target": "vi"}


class handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200, {"ok": True, "source": "en", "target": "vi", "maxItems": MAX_ITEMS})

    def do_POST(self):
        try:
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.reply(415, {"error": "Hãy gửi dữ liệu JSON."})
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"error": "Yêu cầu dịch vượt giới hạn dung lượng."})
            items = validate(json.loads(self.rfile.read(length)))
        except (InputError, ValueError, UnicodeDecodeError):
            return self.reply(400, {"error": "Nội dung dịch không hợp lệ. Hãy thử lại với đoạn ngắn hơn."})
        try:
            result = asyncio.run(translate_batch(items))
            self.reply(200 if result["translations"] else 503,
                       result if result["translations"] else {"error": "Dịch tự động tạm chưa kết nối được. Bài đã lưu; bạn có thể thử lại trong Bản dịch."})
        except (TimeoutError, aiohttp.ClientError, ValueError):
            self.reply(503, {"error": "Dịch tự động tạm chưa kết nối được. Hãy thử lại sau."})

    def log_message(self, *_args):
        pass
