"""ElevenLabs voice readout of one verdict, in English or Spanish. Gemini writes the short spoken script."""
import hashlib
import os

import httpx

from . import vision
from .config import CACHE, ROOT

VOICE = "JBFqnCBsd6RMkjVDRZzb"          # ElevenLabs premade voice; multilingual model handles Spanish
MODEL = "eleven_multilingual_v2"

SCRIPT_SCHEMA = {"type": "object", "properties": {"script": {"type": "string"}}, "required": ["script"]}


async def script(card: dict, lang: str) -> str:
    rec = card.get("recall") or {}
    facts = (f"Listing: {card['title']}, ${card['price']}, {card['city']}. Verdict: {card['verdict']}. "
             f"Reason: {card['reason']}. Recall: {rec.get('title','')}. Remedy: {rec.get('remedy','')[:200]}")
    language = "Spanish" if lang == "es" else "English"
    prompt = (f"Write a spoken alert in {language}, at most 40 words, for a parent or caregiver. Say what the item is, "
              f"where and for how much, that it matches a recalled product (or may match, for 'closer_look'), the "
              f"hazard in plain words, and the remedy. Never accuse the seller. Facts: {facts}")
    try:
        out = await vision._generate(vision.ID_MODELS, [prompt], SCRIPT_SCHEMA,
                                     cache_key=f"speak:{lang}:{card['listing_id']}:{card['verdict']}")
        return out["script"]
    except Exception:
        return f"{card['title']}, {card['price']} dollars, in {card['city']}. {card['reason']}"


async def speak(card: dict, lang: str = "en") -> bytes:
    text = await script(card, lang)
    path = CACHE / ("tts_" + hashlib.sha1((VOICE + text).encode()).hexdigest() + ".mp3")
    if path.exists():
        return path.read_bytes()
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=True)
    async with httpx.AsyncClient() as c:
        r = await c.post(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_64",
                         headers={"xi-api-key": os.getenv("ELEVENLABS_API_KEY", "")},
                         json={"text": text, "model_id": MODEL}, timeout=60)
    r.raise_for_status()
    path.write_bytes(r.content)
    return r.content
