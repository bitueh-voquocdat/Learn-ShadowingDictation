"""Vercel Python Function: POST /api/tts returns actual MP3 bytes."""
import asyncio
import base64
import json
import logging
from http.server import BaseHTTPRequestHandler
from importlib.metadata import version

import aiohttp
import edge_tts
from edge_tts.exceptions import NoAudioReceived

VOICES = ("en-GB-SoniaNeural", "en-GB-RyanNeural", "en-GB-LibbyNeural", "en-GB-ThomasNeural")
MAX_CHARS = 5000
MAX_BODY = 32_000
MAX_AUDIO = 2_500_000
TIMEOUT = 50


class InputError(ValueError):
    pass


def validate(payload):
    if not isinstance(payload, dict):
        raise InputError("Dữ liệu gửi lên phải là một đối tượng JSON.")
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise InputError("Hãy nhập văn bản tiếng Anh.")
    text = text.strip()
    if len(text) > MAX_CHARS:
        raise InputError(f"Mỗi yêu cầu tối đa {MAX_CHARS} ký tự. Hãy dùng giao diện để tự chia đoạn.")
    voice = payload.get("voice", VOICES[0])
    if voice not in VOICES:
        raise InputError("Giọng đọc không hợp lệ.")
    rate, pitch = payload.get("rate", 0), payload.get("pitch", 0)
    if type(rate) is not int or not -50 <= rate <= 50:
        raise InputError("Tốc độ phải là số nguyên từ -50 đến 50.")
    if type(pitch) is not int or not -50 <= pitch <= 50:
        raise InputError("Cao độ phải là số nguyên từ -50 đến 50 Hz.")
    return text, voice, rate, pitch


async def synthesize(text, voice, rate, pitch):
    stream = edge_tts.Communicate(text, voice, rate=f"{rate:+d}%", pitch=f"{pitch:+d}Hz",
                                  boundary="WordBoundary", connect_timeout=10, receive_timeout=25)
    audio = bytearray()
    words = []
    async for packet in stream.stream():
        if packet["type"] == "audio":
            audio.extend(packet["data"])
            if len(audio) > MAX_AUDIO:
                raise OverflowError("Âm thanh quá lớn. Hãy giảm độ dài văn bản.")
        elif packet["type"] == "WordBoundary":
            words.append({"text": packet["text"], "start": round(packet["offset"] / 10_000_000, 4),
                          "end": round((packet["offset"] + packet["duration"]) / 10_000_000, 4)})
    if not audio:
        raise NoAudioReceived("No audio bytes received")
    return {"audio": bytes(audio), "words": words, "duration": len(audio) * 8 / 48_000}


async def bounded_synthesis(args):
    return await asyncio.wait_for(synthesize(*args), timeout=TIMEOUT)


class handler(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type="application/json; charset=utf-8", filename=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        # Readiness only: this does not claim that Microsoft's service is online.
        self.reply(200, {"ok": True, "engine": "edge-tts", "version": version("edge-tts"),
                         "voices": list(VOICES), "maxCharactersPerRequest": MAX_CHARS})

    def do_POST(self):
        if self.headers.get_content_type() != "application/json":
            return self.reply(415, {"error": "Yêu cầu phải dùng Content-Type: application/json."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self.reply(413, {"error": "Dữ liệu gửi lên quá lớn hoặc trống."})
            payload = json.loads(self.rfile.read(length))
            args = validate(payload)
            output = payload.get("format", "mp3")
            if output not in ("json", "mp3"):
                raise InputError("Định dạng âm thanh không hợp lệ.")
        except InputError as exc:
            return self.reply(400, {"error": str(exc)})
        except (ValueError, UnicodeError):
            return self.reply(400, {"error": "Văn bản hoặc thiết lập không hợp lệ."})
        try:
            audio = asyncio.run(bounded_synthesis(args))
        except (asyncio.TimeoutError, aiohttp.ServerTimeoutError):
            return self.reply(504, {"error": "Dịch vụ giọng đọc phản hồi quá lâu. Hãy thử lại hoặc chia văn bản ngắn hơn."})
        except OverflowError:
            return self.reply(413, {"error": "Âm thanh quá lớn. Hãy chia văn bản ngắn hơn."})
        except NoAudioReceived:
            return self.reply(502, {"error": "Microsoft chưa trả về âm thanh. Hãy thử lại sau."})
        except aiohttp.ClientError as exc:
            logging.warning("TTS connection failed (%s, status=%s)", type(exc).__name__, getattr(exc, "status", None))
            return self.reply(503, {"error": "Chưa kết nối được dịch vụ Microsoft. Hãy thử lại sau; nếu lỗi kéo dài, kiểm tra Vercel Logs."})
        except Exception as exc:
            # Do not log submitted text or request bodies.
            logging.error("TTS failed (%s)", type(exc).__name__)
            return self.reply(502, {"error": "Không tạo được âm thanh. Hãy thử lại; nếu lỗi kéo dài, kiểm tra Vercel Logs."})
        name = args[1].replace("en-GB-", "").replace("Neural", "").lower()
        if output == "json":
            self.reply(200, {"audio": base64.b64encode(audio["audio"]).decode("ascii"),
                             "mime": "audio/mpeg", "words": audio["words"], "duration": audio["duration"]})
        else:
            self.reply(200, audio["audio"], "audio/mpeg", f"uk-{name}.mp3")
