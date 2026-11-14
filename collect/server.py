"""Collector server: serves the labeling page and saves uploaded recordings to data/.

Run:  python3 collect/server.py          (from the repo root or anywhere)
Then: cloudflared tunnel --url http://127.0.0.1:8787

Only /collect/* and /dsp.js are readable. data/ and .git are never served,
because the tunnel URL is public.
"""
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PORT = 8787
MAX_BYTES = 150 * 1024 * 1024  # ~25 min of 48 kHz 16-bit mono
NAME = re.compile(r"^[A-Za-z0-9_-]{1,80}\.(wav|json)$")
SKIP = ("server.py",)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed(self):
        # Check the file the URL resolves to, not the URL text, so encoded ".." cannot escape.
        target = Path(self.translate_path(self.path)).resolve()
        if target.name in SKIP:
            return False
        return target == ROOT / "dsp.js" or (ROOT / "collect") in (target, *target.parents)

    def do_GET(self):
        if self.path.split("?")[0] == "/":
            self.send_response(302)
            self.send_header("Location", "/collect/")
            self.end_headers()
        elif self.allowed():
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        if self.allowed():
            super().do_HEAD()
        else:
            self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always serve the latest page
        super().end_headers()

    def do_PUT(self):
        name = self.path.removeprefix("/upload/")
        size = int(self.headers.get("Content-Length", 0))
        if not self.path.startswith("/upload/") or not NAME.match(name):
            return self.send_error(400, "bad name")
        if size <= 0 or size > MAX_BYTES:
            return self.send_error(413, "bad size")
        DATA.mkdir(exist_ok=True)
        left = size
        with open(DATA / name, "wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            (DATA / name).unlink(missing_ok=True)
            return self.send_error(400, "upload cut short")
        print(f"saved data/{name} ({size / 1e6:.1f} MB)")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    print(f"collector on http://127.0.0.1:{PORT}/collect/  saving to {DATA}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
