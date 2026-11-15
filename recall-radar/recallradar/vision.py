"""Gemini vision. Two jobs:
1. identify(): read one listing thumbnail + title -> what is this (brand, product line, model text on the label).
   Cheap and fast, so the sweep runs it on EVERY listing. This is how "Baby Bassinet" listings get a brand.
2. judge(): full listing photos + description vs up to 3 candidate recalls (their text and photos) ->
   verdict (recalled / closer_look / cleared / no_match), a reason, and the exact detail that matched.
"""
import asyncio
import hashlib
import json
import os
import re
import time

import httpx
from google import genai
from google.genai import types

from .config import CACHE, gemini_key
from .offerup import fetch_image

ID_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"]
JUDGE_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]

_exhausted: set = set()   # models that hit their daily cap this process; skip them

_client = None


def client():
    global _client
    if _client is None:
        key = gemini_key()
        if not key:
            raise RuntimeError("GEMINI_API_KEY missing in .env")
        _client = genai.Client(api_key=key)
    return _client


def available() -> bool:
    return bool(gemini_key())


RPM = int(os.getenv("GEMINI_RPM", "14"))   # free tier is ~15 requests/minute; raise once billing is on
_window: list = []
_lock = asyncio.Lock()


async def _rate_slot():
    """Wait until a request fits under RPM requests per rolling minute."""
    while True:
        async with _lock:
            now = time.time()
            while _window and now - _window[0] > 60:
                _window.pop(0)
            if len(_window) < RPM:
                _window.append(now)
                return
            wait = 60 - (now - _window[0]) + 0.1
        await asyncio.sleep(wait)


def _retry_delay(e) -> float:
    m = re.search(r"retryDelay'?: '(\d+)s", str(e))
    return min(float(m.group(1)), 65) if m else 0


async def _generate(models, contents, schema, cache_key=None):
    path = CACHE / ("gem_" + hashlib.sha1(cache_key.encode()).hexdigest() + ".json") if cache_key else None
    if path and path.exists():
        return json.loads(path.read_text())
    last = None
    for model in [m for m in models if m not in _exhausted] or models:
        for attempt in range(3):
            try:
                await _rate_slot()
                r = await asyncio.wait_for(client().aio.models.generate_content(
                    model=model, contents=contents,
                    config=types.GenerateContentConfig(response_mime_type="application/json",
                                                       response_schema=schema, temperature=0)), timeout=60)
                out = json.loads(r.text)
                out["_model"] = model
                if path:
                    path.write_text(json.dumps(out))
                return out
            except Exception as e:  # 503 busy, 429 rate limit, timeout: retry then fall back
                last = e
                msg = str(e)
                print(f"[gemini] {model} attempt {attempt}: {type(e).__name__} {msg[:90]}", flush=True)
                if "PerDay" in msg:
                    _exhausted.add(model)
                    break                                   # daily cap: try the next model
                await asyncio.sleep(_retry_delay(e) or 2 * (attempt + 1))
    raise RuntimeError(f"Gemini failed: {str(last)[:200]}")


def _img(data: bytes) -> types.Part:
    mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return types.Part.from_bytes(data=data, mime_type=mime)


ID_SCHEMA = {
    "type": "object",
    "properties": {
        "product_type": {"type": "string", "description": "generic type, e.g. 'infant rocking sleeper', 'power bank'"},
        "brand": {"type": "string", "description": "brand visible on product/box or in title; empty if unknown"},
        "product_line": {"type": "string", "description": "product/model name visible, e.g. 'Playtime to Bedtime Rocking Sleeper'"},
        "model_numbers": {"type": "array", "items": {"type": "string"}, "description": "model/style numbers printed in the photo"},
        "visible_text": {"type": "string", "description": "other readable label or box text, verbatim, short"},
        "category": {"type": "string", "enum": ["infant_sleep", "infant_other", "bed_rail", "battery_device",
                                                 "e_mobility", "exercise", "furniture", "appliance", "toy", "other"]},
    },
    "required": ["product_type", "brand", "product_line", "model_numbers", "visible_text", "category"],
}


async def identify(http: httpx.AsyncClient, listing: dict) -> dict:
    img = listing.get("photo_bytes") or await fetch_image(http, listing["thumb"])
    prompt = (f"Marketplace listing titled: {listing['title']!r}. Identify the product in the photo. "
              "Read any brand, product name and model/style number printed on the item or its box. "
              "Only report text you can actually read or that is in the title; do not guess model numbers.")
    key = "id2:" + (listing["thumb"] if not listing.get("photo_bytes") else hashlib.sha1(img).hexdigest())
    return await _generate(ID_MODELS, [_img(img), prompt], ID_SCHEMA, cache_key=key)


JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "recall_id": {"type": "integer", "description": "id of the best-matching recall, or 0 if none match"},
        "verdict": {"type": "string", "enum": ["recalled", "closer_look", "cleared", "no_match"]},
        "confidence": {"type": "number"},
        "reason": {"type": "string", "description": "one or two plain sentences a parent could understand"},
        "listing_evidence": {"type": "string", "description": "exact text quoted from listing, or the photo detail (e.g. 'box in photo 2 reads ...')"},
        "recall_evidence": {"type": "string", "description": "exact words from the recall record that match"},
        "photo_index": {"type": "integer", "description": "which listing photo (0-based) shows the evidence"},
        "listing_brand": {"type": "string", "description": "brand readable in the listing photo or text, empty if none"},
        "brands_agree": {"type": "boolean", "description": "listing brand is the recalled brand (or no brand visible but the product name matches)"},
        "named_product_match": {"type": "string", "description": "the specific product name or model number from the recall that the listing shows by name, label, or model. Empty if it is only a similar-looking design"},
    },
    "required": ["recall_id", "verdict", "confidence", "reason", "listing_evidence", "recall_evidence", "photo_index",
                 "listing_brand", "brands_agree", "named_product_match"],
}

JUDGE_RULES = """You check whether a used item for sale matches a product under a U.S. CPSC safety recall.
Verdicts:
- recalled: the listing clearly shows a product the recall covers (named product, listed model number, or the recall covers all models of that brand's product and this is that product).
- closer_look: likely the same brand and product, but you cannot confirm the model (recall covers only some models and none is readable), OR the recall's remedy is a repair/firmware/part fix so this unit may already be fixed.
- cleared: same brand/type, but the listing shows a model or version the recall does NOT include.
- no_match: different product or brand.
"recalled" requires BOTH: the brands agree, AND the listing shows a recalled product by its name, label or model number
(or the recall covers all models of that exact product type from that brand). A similar shape or color alone is not enough.
Judge only the main item for sale. Ignore objects in the background of the photo.
Be strict: a look-alike of a generic shape (e.g. any bassinet) is not a match without a brand, name or design cue that the recall describes.
Quote evidence exactly. Neutral wording: say "matches a recalled product", never accuse the seller."""


async def recall_image(http: httpx.AsyncClient, rec: dict) -> bytes | None:
    imgs = json.loads(rec.get("images") or "[]")
    for im in imgs[:1]:
        try:
            return await fetch_image(http, im["url"])
        except Exception:
            return None
    return None


async def judge(http: httpx.AsyncClient, listing: dict, cands: list[dict]) -> dict:
    parts = []
    photos = (listing.get("photos") or [listing["thumb"]])[:3]
    if listing.get("photo_bytes"):
        parts += ["Listing photo 0:", _img(listing["photo_bytes"])]
        photos = []
    for i, u in enumerate(photos):
        try:
            parts += [f"Listing photo {i}:", _img(await fetch_image(http, u))]
        except Exception:
            pass
    parts.append(f"LISTING title: {listing['title']!r}\nLISTING description: {(listing.get('description') or '')[:1500]!r}")
    for c in cands:
        rec = c["recall"]
        parts.append(
            f"--- RECALL id={rec['recall_id']} date={rec['date']}\nTitle: {rec['title']}\nProducts: {rec['products']}\n"
            f"Description: {rec['description'][:2000]}\nRecalled model numbers: {rec['models'][:300]}\n"
            f"Remedy ({rec['remedy_type']}): {rec['remedy'][:400]}")
        ri = await recall_image(http, rec)
        if ri:
            parts += [f"Photo of recalled product (recall id={rec['recall_id']}):", _img(ri)]
    parts.append(JUDGE_RULES)
    key = "judge6:" + listing["listing_id"] + ":" + ",".join(str(c["recall"]["recall_id"]) for c in cands) + ":" + str(len(photos))
    return await _generate(JUDGE_MODELS, parts, JUDGE_SCHEMA, cache_key=key)


BATCH_SCHEMA = {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {"index": {"type": "integer"}, **ID_SCHEMA["properties"]},
    "required": ["index"] + ID_SCHEMA["required"]}}}, "required": ["items"]}


async def identify_batch(http: httpx.AsyncClient, listings: list[dict]) -> dict:
    """Read several listing thumbnails in ONE request (8x fewer calls than one-by-one). Returns {listing_id: identity}."""
    out, todo = {}, []
    for li in listings:  # reuse single-item cache if present
        p = CACHE / ("gem_" + hashlib.sha1(("id2:" + li["thumb"]).encode()).hexdigest() + ".json")
        if p.exists():
            out[li["listing_id"]] = json.loads(p.read_text())
        else:
            todo.append(li)
    if not todo:
        return out
    parts, idx = [], []
    for li in todo:
        try:
            data = await fetch_image(http, li["thumb"])
        except Exception:
            continue
        parts += [f"Item {len(idx)}: listing titled {li['title']!r}", _img(data)]
        idx.append(li)
    parts.append("For EACH item above, identify the product in its photo. Read any brand, product name and "
                 "model/style number printed on the item or its box. Only report text you can actually read or "
                 "that is in the title; do not guess model numbers. Return one entry per item with its index.")
    key = "idb1:" + "|".join(li["thumb"] for li in idx)
    res = await _generate(ID_MODELS, parts, BATCH_SCHEMA, cache_key=key)
    for it in res.get("items", []):
        i = it.pop("index", -1)
        if 0 <= i < len(idx):
            it["_model"] = res.get("_model")
            out[idx[i]["listing_id"]] = it
            p = CACHE / ("gem_" + hashlib.sha1(("id2:" + idx[i]["thumb"]).encode()).hexdigest() + ".json")
            p.write_text(json.dumps(it))
    return out


JUDGE_BATCH_SCHEMA = {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {"index": {"type": "integer"}, **JUDGE_SCHEMA["properties"]},
    "required": ["index"] + JUDGE_SCHEMA["required"]}}}, "required": ["items"]}


async def judge_batch(http: httpx.AsyncClient, listings: list[dict], cands: list[dict]) -> list[dict | None]:
    """Judge several listings against the same candidate recalls in ONE request.
    The recall texts and photos are sent once; each listing gets up to 2 photos."""
    parts = ["CANDIDATE RECALLS:"]
    for c in cands:
        rec = c["recall"]
        parts.append(
            f"--- RECALL id={rec['recall_id']} date={rec['date']}\nTitle: {rec['title']}\nProducts: {rec['products']}\n"
            f"Description: {rec['description'][:1500]}\nRecalled model numbers: {rec['models'][:300]}\n"
            f"Remedy ({rec['remedy_type']}): {rec['remedy'][:300]}")
        ri = await recall_image(http, rec)
        if ri:
            parts += [f"Photo of recalled product (recall id={rec['recall_id']}):", _img(ri)]
    parts.append("LISTINGS TO JUDGE (each independently):")
    for i, li in enumerate(listings):
        parts.append(f"=== LISTING index={i}\ntitle: {li['title']!r}\ndescription: {(li.get('description') or '')[:800]!r}")
        for j, u in enumerate((li.get("photos") or [li["thumb"]])[:2]):
            try:
                parts += [f"listing {i} photo {j}:", _img(await fetch_image(http, u))]
            except Exception:
                pass
    parts.append(JUDGE_RULES + "\nReturn one item per listing, with its index. photo_index refers to that listing's photos.")
    key = "judgeb2:" + ",".join(li["listing_id"] for li in listings) + ":" + ",".join(str(c["recall"]["recall_id"]) for c in cands)
    res = await _generate(JUDGE_MODELS, parts, JUDGE_BATCH_SCHEMA, cache_key=key)
    out: list = [None] * len(listings)
    for it in res.get("items", []):
        i = it.pop("index", -1)
        if 0 <= i < len(listings):
            it["_model"] = res.get("_model")
            out[i] = it
    return out
