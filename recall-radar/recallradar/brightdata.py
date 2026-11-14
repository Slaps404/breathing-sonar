"""Bright Data Web Unlocker: fetch pages that block normal requests (OfferUp item pages return 403)."""
import hashlib

import httpx

from .config import CACHE, BRIGHTDATA_ZONE, brightdata_key

API = "https://api.brightdata.com/request"


async def unlock(client: httpx.AsyncClient, url: str, use_cache=True) -> tuple[str, bool]:
    """Return (html, from_cache). Raises on failure."""
    path = CACHE / ("bd_" + hashlib.sha1(url.encode()).hexdigest() + ".html")
    if use_cache and path.exists() and path.stat().st_size > 1000:
        return path.read_text(), True
    last = None
    for _ in range(2):  # one retry: Unlocker sometimes returns an empty body
        r = await client.post(API, json={"zone": BRIGHTDATA_ZONE, "url": url, "format": "json"},
                              headers={"Authorization": "Bearer " + brightdata_key()}, timeout=150)
        r.raise_for_status()
        body = r.json()
        html = body.get("body") or ""
        if body.get("status_code") == 200 and len(html) > 1000:
            path.write_text(html)
            return html, False
        last = f"status {body.get('status_code')}, {len(html)} bytes"
    raise RuntimeError(f"Unlocker failed for {url}: {last}")


STATS = {"requests": 0, "ok": 0, "failed": 0, "seconds": 0.0}


async def post_json(client: httpx.AsyncClient, url: str, payload: dict, headers: dict | None = None) -> dict:
    """Send a JSON POST to a site through Web Unlocker; return the site's parsed JSON reply."""
    import json, time
    t = time.time()
    STATS["requests"] += 1
    last = None
    for _ in range(2):
        try:
            r = await client.post(API, json={"zone": BRIGHTDATA_ZONE, "url": url, "method": "POST",
                                             "body": json.dumps(payload), "format": "json",
                                             "headers": {"Content-Type": "application/json", **(headers or {})}},
                                  headers={"Authorization": "Bearer " + brightdata_key()}, timeout=90)
            r.raise_for_status()
            d = r.json()
            if d.get("status_code") == 200 and d.get("body"):
                STATS["ok"] += 1
                STATS["seconds"] += time.time() - t
                return json.loads(d["body"])
            last = f"site status {d.get('status_code')}"
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
    STATS["failed"] += 1
    raise RuntimeError(f"Bright Data POST failed: {last}")
