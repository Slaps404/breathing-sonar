"""Settings and secrets. Secrets come from .env or the Bright Data CLI login; never printed."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=True)

DATA = ROOT / "data"
DB_PATH = DATA / "recallradar.db"
CACHE = DATA / "cache"
CACHE.mkdir(parents=True, exist_ok=True)

BRIGHTDATA_ZONE = os.getenv("BRIGHTDATA_ZONE", "cli_unlocker")


def brightdata_key() -> str:
    key = os.getenv("BRIGHTDATA_API_KEY")
    if key:
        return key
    cred = Path.home() / "Library/Application Support/brightdata-cli/credentials.json"
    return json.loads(cred.read_text())["api_key"]


def gemini_key() -> str | None:
    load_dotenv(ROOT / ".env", override=True)  # re-read so a key added while running is picked up
    return os.getenv("GEMINI_API_KEY") or None
