"""Optional developer server; deployment on Vercel does not use this file."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from api.tts import handler as TTSHandler
from api.translate import handler as TranslateHandler

PUBLIC = Path(__file__).parent / "public"


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == "/api/tts":
            return TTSHandler.do_GET(self)
        if urlsplit(self.path).path == "/api/translate":
            return TranslateHandler.do_GET(self)
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/tts":
            return TTSHandler.do_POST(self)
        if path == "/api/translate":
            return TranslateHandler.do_POST(self)
        return self.send_error(404)

    reply = TTSHandler.reply


if __name__ == "__main__":
    print("Developer preview: http://127.0.0.1:8000", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8000), LocalHandler).serve_forever()
