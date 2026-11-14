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


GQL = "https://offerup.com/api/graphql"
GQL_HEADERS = {"User-Agent": UA, "Accept": "*/*", "Content-Type": "application/json",
               "Origin": "https://offerup.com", "Referer": "https://offerup.com/"}
FEED_Q = """query GetModularFeed($params: [SearchParam!]) { modularFeed(params: $params) { looseTiles {
  __typename ... on ModularFeedTileListing { listing { listingId title price locationName image { url } } } } } }"""
LISTING_Q = """query GetListing($listingId: ID!) { listing(listingId: $listingId) { listingId title description
  postDate locationDetails { locationName latitude longitude } photos { detailFull { url } detail { url } } } }"""


async def search(client: httpx.AsyncClient, query: str, lat: float = 32.7157, lon: float = -117.1611,
                 radius: int = 30, use_cache=False) -> list[dict]:
    """OfferUp's own GraphQL search (what offerup.com calls). Local pickup listings near lat/lon."""
    path = CACHE / ("search_" + hashlib.sha1(f"{query}|{lat}|{lon}|{radius}".encode()).hexdigest() + ".json")
    if use_cache and path.exists():
        return json.loads(path.read_text())
    params = [{"key": "q", "value": query}, {"key": "lat", "value": str(lat)}, {"key": "lon", "value": str(lon)},
              {"key": "radius", "value": str(radius)}, {"key": "delivery_param", "value": "p"}]
    r = await client.post(GQL, json={"operationName": "GetModularFeed", "query": FEED_Q,
                                     "variables": {"params": params}}, headers=GQL_HEADERS, timeout=30)
    r.raise_for_status()
    tiles = r.json()["data"]["modularFeed"]["looseTiles"]
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


async def detail(client: httpx.AsyncClient, listing_id: str, via: str = "api") -> dict:
    """Item details. via='api': OfferUp GraphQL (0.3 s). via='brightdata': item page through Web Unlocker."""
    if via == "api":
        path = CACHE / f"gql_listing_{listing_id}.json"
        cached = path.exists()
        if cached:
            li = json.loads(path.read_text())
        else:
            r = await client.post(GQL, json={"operationName": "GetListing", "query": LISTING_Q,
                                             "variables": {"listingId": listing_id}}, headers=GQL_HEADERS, timeout=30)
            r.raise_for_status()
            li = (r.json().get("data") or {}).get("listing")
            if not li:
                raise ValueError("listing not found (sold or removed?)")
            path.write_text(json.dumps(li))
        return _detail_fields(li, cached)
    return await detail_brightdata(client, listing_id)


def _detail_fields(li: dict, cached: bool) -> dict:
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


async def detail_brightdata(client: httpx.AsyncClient, listing_id: str) -> dict:
    """Fetch the item page through Bright Data Web Unlocker."""
    html, cached = await unlock(client, item_url(listing_id))
    state = _next_data(html)["props"]["pageProps"]["initialApolloState"]["ROOT_QUERY"]
    li = next((v for k, v in state.items() if k.startswith("listing(") and listing_id in k), None)
    if not li:
        raise ValueError("listing not in page (sold or removed?)")
    return _detail_fields(li, cached)


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
