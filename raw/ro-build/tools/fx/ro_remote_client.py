"""Local roBrowser "Remote Client" backed by the scRO GRFs (read-only, 127.0.0.1 only).

roBrowser FileManager protocol: GET <base>/<url-encoded path>, POST <base>batch {"files": [...]} -> {path: base64},
POST <base> "filter=<regex>" -> newline-separated file list. Paths may be Unicode Korean or CP949 bytes shown as Latin-1.
Every served path is logged to --log, so a capture's provenance lists exactly which client files were used.
"""
import argparse, base64, json, re, sys, threading, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from grf import GRF

g = GRF()
lock = threading.Lock()
served = {}
misses = set()


def normalize(path):
    path = urllib.parse.unquote(path).lstrip('/').replace('/', '\\')
    try:
        path = path.encode('latin-1').decode('cp949')   # mojibake form used in roBrowser tables
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return path


def fetch(path):
    name = normalize(path)
    if not g.has(name):
        with lock:
            misses.add(name)
        return None
    data = g.read(name)
    with lock:
        served[name] = g.locate(name)[0]
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_GET(self):
        data = fetch(self.path.split('?')[0])
        if data is None:
            self.send_response(404); self.cors(); self.end_headers(); return
        self.send_response(200); self.cors()
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(data))); self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path.rstrip('/').endswith('batch'):
            files = json.loads(body or b'{}').get('files', [])
            out = {}
            for f in files:
                d = fetch(f)
                if d is not None:
                    out[f] = base64.b64encode(d).decode()
            payload = json.dumps(out).encode(); ctype = 'application/json'
        else:
            q = urllib.parse.parse_qs(body.decode('latin-1')).get('filter', [''])[0]
            rx = re.compile(q, re.I)
            names = [e['raw'].decode('latin-1') for _, e in g.index.values()]
            payload = '\n'.join(n.replace('\\', '/') for n in names if rx.search(n.replace('\\', '/'))).encode('latin-1')
            ctype = 'text/plain; charset=ISO-8859-1'
        self.send_response(200); self.cors()
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(payload))); self.end_headers()
        self.wfile.write(payload)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--log', default=None, help='write served/missing paths as JSON on SIGTERM/exit')
    a = ap.parse_args()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print(f'serving scRO GRF on http://127.0.0.1:{a.port}/ ({len(g.index)} files)', flush=True)
    import signal

    def dump(*_):
        if a.log:
            with lock, open(a.log, 'w', encoding='utf-8') as f:
                json.dump(dict(served=served, missing=sorted(misses)), f, ensure_ascii=False, indent=1)
        sys.exit(0)
    signal.signal(signal.SIGTERM, dump); signal.signal(signal.SIGINT, dump)
    try:
        srv.serve_forever()
    finally:
        dump()


if __name__ == '__main__':
    main()
