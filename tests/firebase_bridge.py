"""TLS-verified QA relay for this environment's restricted browser networking."""
import sys, json, base64, urllib.request, urllib.error
p = json.load(sys.stdin)
if not p['url'].startswith('https://firestore.googleapis.com/v1/projects/shadow-study-mindlab/'):
    raise ValueError('The live probe only targets its configured Firestore project')
headers = {k: v for k, v in p.get('headers', {}).items()
           if k.lower() in ('content-type', 'origin', 'x-goog-api-client', 'x-goog-api-key')}
data = p.get('body')
req = urllib.request.Request(p['url'], data=data.encode() if data else None,
                             method=p['method'], headers=headers)
try:
    r = urllib.request.urlopen(req, timeout=15)
except urllib.error.HTTPError as e:
    r = e
with r:
    result = {'status': r.status, 'body': base64.b64encode(r.read()).decode(),
              'headers': {k: v for k, v in r.headers.items()
                          if k.lower() in ('content-type', 'access-control-allow-origin')}}
print(json.dumps(result))
