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
