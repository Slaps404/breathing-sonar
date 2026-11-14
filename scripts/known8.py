"""The 8 hand-verified listings from Nov 14 and the verdict each should get. Used as a regression check."""
import asyncio, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
from recallradar import offerup
from recallradar.config import DATA

KNOWN = [  # (listing_id or None, search query, title must contain, expected verdict, expected recall title contains)
    ("e07bcc07-8e32-3ee8-870f-5c2e46ff8e1f", None, "rock and play", "recalled", "Rocking Sleeper"),
    ("60db01d7-c860-3983-8626-54eb5397db9b", None, "Ingenuity", "recalled", "Rocking Sleeper"),
    ("9dd21465-51a3-3d1f-ae19-281cdb9d2367", None, "Rock N Soothe", "recalled", "Rocking Sleeper"),
    ("5c736bde-0508-3d09-ae63-3a627e480a8e", None, "WEHWUPE", "recalled", "WeHwupe"),
    (None, "onewheel pint", "pint", "closer_look", "Onewheel"),
    (None, "peloton bike", "original peloton", "closer_look", "Peloton"),
    (None, "anker powercore", "powercore+", "closer_look", "Anker"),
    (None, "ocoopa", "ut2", "cleared", "OCOOPA"),
]
OUT = DATA / "known8.json"

async def main():
    async with httpx.AsyncClient() as c:
        items = []
        for lid, q, must, exp, rtitle in KNOWN:
            if not lid:
                res = await offerup.search(c, q)
                hit = next((r for r in res if must.lower() in r["title"].lower()), None)
                if not hit:
                    print("NOT FOUND in search:", q, must, [r["title"] for r in res[:8]]); continue
                lid = hit["listing_id"]
            items.append({"listing_id": lid, "expect": exp, "expect_recall": rtitle})
        async def get(it):
            try:
                it.update(await offerup.detail(c, it["listing_id"]))
            except Exception as e:
                it["error"] = str(e)
            return it
        items = await asyncio.gather(*[get(i) for i in items])
    OUT.write_text(json.dumps(items, indent=1))
    for it in items:
        print(it.get("title") or it.get("error"), "|", (it.get("description") or "")[:120].replace("\n", " "))
asyncio.run(main())
