import asyncio, base64, http.client, json, threading, unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
import aiohttp
from api import tts
class Quiet(tts.handler):
    def log_message(self,*args): pass
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Quiet);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.port=cls.server.server_address[1]
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def req(self,body,method='POST',mime='application/json'):
        c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5);c.request(method,'/api/tts',body if isinstance(body,bytes) else json.dumps(body),{'Content-Type':mime});r=c.getresponse();v=(r.status,dict(r.getheaders()),r.read());c.close();return v
    def test_validation(self):
        for data in [None,[],{'text':''},{'text':'x'*5001},{'text':'Hi','voice':'invalid'},{'text':'Hi','rate':True},{'text':'Hi','pitch':60},{'text':'Hi','format':'wav'},b'{invalid']:
            self.assertEqual(self.req(data)[0],400)
    def test_transport_bounds(self):
        self.assertEqual(self.req(b'x'*32001)[0],413);self.assertEqual(self.req({},mime='text/plain')[0],415)
    def test_four_voices_and_metadata(self):
        fixture={'audio':b'\xff\xfb'+b'fixture'*100,'words':[{'text':'Hello','start':.1,'end':.4}],'duration':1.3}
        async def fake(*args): return fixture
        with patch.object(tts,'synthesize',side_effect=fake):
            for voice in tts.VOICES:
                status,h,b=self.req({'text':'Hello','voice':voice,'format':'json'});data=json.loads(b);self.assertEqual(status,200);self.assertEqual(base64.b64decode(data['audio']),fixture['audio']);self.assertEqual(data['words'],fixture['words']);self.assertEqual(h['Cache-Control'],'no-store')
    def test_raw_mp3_remains_available(self):
        async def fake(*args): return {'audio':b'fake-audio','words':[],'duration':1}
        with patch.object(tts,'synthesize',side_effect=fake):
            status,h,b=self.req({'text':'Hello'});self.assertEqual(status,200);self.assertEqual(h['Content-Type'],'audio/mpeg');self.assertEqual(b,b'fake-audio')
    def test_errors_not_fake_audio(self):
        for error,status in [(TimeoutError(),504),(tts.NoAudioReceived('empty'),502),(aiohttp.ClientConnectionError(),503),(OverflowError(),413)]:
            async def fake(*args): raise error
            with patch.object(tts,'synthesize',side_effect=fake):
                actual,h,b=self.req({'text':'Hi','format':'json'});self.assertEqual(actual,status);self.assertIn('error',json.loads(b))
    def test_whole_request_timeout(self):
        async def fake(*args): await asyncio.sleep(1)
        with patch.object(tts,'TIMEOUT',.01),patch.object(tts,'synthesize',side_effect=fake):self.assertEqual(self.req({'text':'Hi'})[0],504)
    def test_health(self): self.assertEqual(self.req(None,method='GET')[0],200)
if __name__=='__main__':unittest.main()
