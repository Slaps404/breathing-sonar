"""Gemini vision. Two jobs:
1. identify(): read one listing thumbnail + title -> what is this (brand, product line, model text on the label).
   Cheap and fast, so the sweep runs it on EVERY listing. This is how "Baby Bassinet" listings get a brand.
2. judge(): full listing photos + description vs up to 3 candidate recalls (their text and photos) ->
   verdict (recalled / closer_look / cleared / no_match), a reason, and the exact detail that matched.
"""
import asyncio
import hashlib
import json

import httpx
from google import genai
from google.genai import types

from .config import CACHE, gemini_key
from .offerup import fetch_image

ID_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"]
JUDGE_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"]

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


async def _generate(models, contents, schema, cache_key=None):
    path = CACHE / ("gem_" + hashlib.sha1(cache_key.encode()).hexdigest() + ".json") if cache_key else None
    if path and path.exists():
        return json.loads(path.read_text())
    last = None
    for model in models:
        for attempt in range(2):
            try:
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
                print(f"[gemini] {model} attempt {attempt}: {type(e).__name__} {str(e)[:90]}", flush=True)
                await asyncio.sleep(1.5 * (attempt + 1))
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
    img = await fetch_image(http, listing["thumb"])
    prompt = (f"Marketplace listing titled: {listing['title']!r}. Identify the product in the photo. "
              "Read any brand, product name and model/style number printed on the item or its box. "
              "Only report text you can actually read or that is in the title; do not guess model numbers.")
    return await _generate(ID_MODELS, [_img(img), prompt], ID_SCHEMA, cache_key="id2:" + listing["thumb"])


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
    },
    "required": ["recall_id", "verdict", "confidence", "reason", "listing_evidence", "recall_evidence", "photo_index"],
}

JUDGE_RULES = """You check whether a used item for sale matches a product under a U.S. CPSC safety recall.
Verdicts:
- recalled: the listing clearly shows a product the recall covers (named product, listed model number, or the recall covers all models of that brand's product and this is that product).
- closer_look: likely the same brand and product, but you cannot confirm the model (recall covers only some models and none is readable), OR the recall's remedy is a repair/firmware/part fix so this unit may already be fixed.
- cleared: same brand/type, but the listing shows a model or version the recall does NOT include.
- no_match: different product or brand.
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
    key = "judge3:" + listing["listing_id"] + ":" + ",".join(str(c["recall"]["recall_id"]) for c in cands) + ":" + str(len(photos))
    return await _generate(JUDGE_MODELS, parts, JUDGE_SCHEMA, cache_key=key)
