"""OfferUp: search pages load with a plain request; item pages need Bright Data."""
import hashlib
import json
import re

import httpx

from .brightdata import unlock
from .config import CACHE

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def item_url(listing_id: str) -> str:
    return f"https://offerup.com/item/detail/{listing_id}"


def _next_data(html: str) -> dict:
    m = NEXT_RE.search(html)
    if not m:
        raise ValueError("no __NEXT_DATA__ in page")
    return json.loads(m.group(1))


async def search(client: httpx.AsyncClient, query: str, use_cache=False) -> list[dict]:
    path = CACHE / ("search_" + hashlib.sha1(query.encode()).hexdigest() + ".json")
    if use_cache and path.exists():
        return json.loads(path.read_text())
    r = await client.get("https://offerup.com/search", params={"q": query},
                         headers={"User-Agent": UA}, timeout=30, follow_redirects=True)
    r.raise_for_status()
    tiles = _next_data(r.text)["props"]["pageProps"]["searchFeedResponse"]["looseTiles"]
    out = []
    for t in tiles:
        li = t.get("listing") if isinstance(t, dict) else None
        if not li or not li.get("listingId"):
            continue
        out.append({
            "listing_id": li["listingId"], "title": li.get("title") or "", "price": li.get("price") or "",
            "city": li.get("locationName") or "", "thumb": (li.get("image") or {}).get("url") or "",
            "query": query,
        })
    path.write_text(json.dumps(out))
    return out


async def detail(client: httpx.AsyncClient, listing_id: str) -> dict:
    """Fetch the item page through Bright Data. Returns description, full photos, lat/lon, post date."""
    html, cached = await unlock(client, item_url(listing_id))
    state = _next_data(html)["props"]["pageProps"]["initialApolloState"]["ROOT_QUERY"]
    li = next((v for k, v in state.items() if k.startswith("listing(") and listing_id in k), None)
    if not li:
        raise ValueError("listing not in page (sold or removed?)")
    photos = []
    for p in li.get("photos") or []:
        u = ((p.get("detailFull") or {}).get("url") or (p.get("detail") or {}).get("url"))
        if u:
            photos.append(u)
    loc = li.get("locationDetails") or {}
    return {
        "title": li.get("title") or "", "description": li.get("description") or "",
        "photos": photos, "lat": float(loc["latitude"]) if loc.get("latitude") else None,
        "lon": float(loc["longitude"]) if loc.get("longitude") else None,
        "city": loc.get("locationName") or "", "post_date": li.get("postDate") or "",
        "from_cache": cached,
    }


async def fetch_image(client: httpx.AsyncClient, url: str) -> bytes:
    path = CACHE / ("img_" + hashlib.sha1(url.encode()).hexdigest())
    if path.exists():
        return path.read_bytes()
    headers = {"User-Agent": UA}
    if "offerup.com" in url:
        headers["Referer"] = "https://offerup.com/"
    r = await client.get(url, headers=headers, timeout=30, follow_redirects=True)
    r.raise_for_status()
    path.write_bytes(r.content)
    return r.content
