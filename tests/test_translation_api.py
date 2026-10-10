import asyncio
import http.client
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from api import translate


class TranslationAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), translate.handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        translate._cache.clear()

    def request(self, payload, content_type="application/json", method="POST"):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        body = payload if isinstance(payload, bytes) else json.dumps(payload)
        connection.request(method, "/api/translate", body, {"Content-Type": content_type})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        connection.close()
        return result

    def test_validation_and_transport_limits(self):
        for data in [None, [], {}, {"items": []}, {"items": [{"id": "x", "text": ""}]},
                     {"items": [{"id": "x", "text": "a" * 2001}]}, {"source": "fr", "items": [{"id": "x", "text": "Hi"}]},
                     {"items": [{"id": "x", "text": "Hi"}] * 2}, b'{invalid']:
            self.assertEqual(self.request(data)[0], 400)
        self.assertEqual(self.request(b"x" * 64001)[0], 413)
        self.assertEqual(self.request({}, content_type="text/plain")[0], 415)

    def test_success_returns_real_provider_data_and_cache_control(self):
        async def fake(items):
            return {"translations": [{**items[0], "translation": "Xin chào!", "provider": "fixture"}], "failed": [], "target": "vi"}
        with patch.object(translate, "translate_batch", side_effect=fake):
            status, headers, data = self.request({"items": [{"id": "a", "text": "Hello!"}]})
        self.assertEqual(status, 200)
        self.assertEqual(data["translations"][0]["translation"], "Xin chào!")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_provider_failure_is_an_error_not_a_fake_translation(self):
        async def fake(items):
            return {"translations": [], "failed": [items[0]["id"]], "target": "vi"}
        with patch.object(translate, "translate_batch", side_effect=fake):
            status, _, data = self.request({"items": [{"id": "a", "text": "Hello!"}]})
        self.assertEqual(status, 503)
        self.assertIn("error", data)
        self.assertNotIn("translations", data)

    def test_batch_preserves_successes_if_other_requests_time_out(self):
        async def fake(session, text, bing):
            if text == "slow":
                await asyncio.sleep(0.2)
            return "Dịch " + text, "fixture"
        with patch.object(translate, "translate_one", side_effect=fake), patch.object(translate, "TIMEOUT", 0.03):
            result = asyncio.run(translate.translate_batch([{"id": "a", "text": "ok"}, {"id": "b", "text": "slow"}]))
        self.assertEqual([r["id"] for r in result["translations"]], ["a"])
        self.assertEqual(result["failed"], ["b"])

    def test_whitespace_and_vietnamese_byte_limits(self):
        self.assertEqual(translate.validate({"items": [{"id": "a", "text": " Hello! "}]})[0]["text"], " Hello! ")
        chunks = translate.byte_chunks("Tiếng Việt có dấu. " * 150)
        self.assertTrue(all(len(chunk.encode("utf-8")) <= 480 for chunk in chunks))
        self.assertEqual(" ".join(chunks).split(), ("Tiếng Việt có dấu. " * 150).split())
        long_text = "This is a sentence for the paragraph translation. " * 50
        pieces = translate.provider_chunks(long_text)
        self.assertTrue(all(len(piece) <= 900 for piece in pieces))
        self.assertEqual(" ".join(pieces).split(), long_text.split())

    def test_provider_parsing_rejects_invalid_output(self):
        self.assertEqual(translate.decoded_translation([[["Xin ", "Hi"], ["chào!", "there"]]]), "Xin chào!")
        for data in [[], None, {"sentences": []}, [[[]]]]:
            with self.assertRaises((ValueError, TypeError)):
                translate.decoded_translation(data)

    def test_official_cloud_api_is_optional_and_decodes_entities(self):
        async def fake(*args, **kwargs):
            self.assertEqual(kwargs["json"]["target"], "vi")
            return {"data": {"translations": [{"translatedText": "Trà &amp; bánh"}]}}
        with patch.dict(os.environ, {"GOOGLE_TRANSLATE_API_KEY": "test-only"}), patch.object(translate, "fetch_json", side_effect=fake):
            value, provider = asyncio.run(translate.translate_one(None, "Tea and cake"))
        self.assertEqual(value, "Trà & bánh")
        self.assertEqual(provider, "google-cloud")

    def test_health(self):
        status, _, data = self.request(None, method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(data["target"], "vi")

    def test_streamed_provider_response_is_read_completely(self):
        class Content:
            async def iter_chunked(self, _size):
                for chunk in [b'{"answer":', b'"hello"', b'}']:
                    yield chunk
        class Response:
            content = Content()
        self.assertEqual(asyncio.run(translate.read_bounded(Response(), 100)), b'{"answer":"hello"}')
        with self.assertRaises(ValueError):
            asyncio.run(translate.read_bounded(Response(), 5))


if __name__ == "__main__":
    unittest.main()
