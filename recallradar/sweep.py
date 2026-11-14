"""The sweep: every listing for a set of searches, through every stage, with live counters.

  search (plain HTTP) -> read every photo (Gemini lite) -> text shortlist (9.5k recalls)
  -> unlock item pages (Bright Data) -> judge (Gemini + code model check) -> verdicts table
"""
import asyncio
import json
import time
import uuid
from datetime import datetime

import httpx

from . import brightdata, offerup, pipeline, vision
from .db import connect

CATEGORIES = {
    "infant_sleep": {"label": "Infant sleep", "queries": [
        "rocking sleeper", "rock n play", "baby bassinet", "infant sleeper", "baby rocker", "newborn bed",
        "baby lounger", "bassinet", "baby sleeper", "cuna para bebe"]},
    "bed_rails": {"label": "Adult bed rails", "queries": ["bed rail", "bed rail elderly", "bed assist rail"]},
    "batteries": {"label": "Power banks & hand warmers", "queries": ["power bank", "portable charger", "hand warmer"]},
    "e_mobility": {"label": "E-skateboards & e-bikes", "queries": ["onewheel", "electric skateboard", "ebike battery"]},
    "exercise": {"label": "Exercise equipment", "queries": ["peloton", "treadmill", "exercise bike"]},
}

STATE: dict = {"running": False}
LIMITS = {"search": 4, "identify": 10, "unlock": 20, "judge": 4}


def _new_state(sweep_id, queries):
    return {"running": True, "sweep_id": sweep_id, "started": time.time(), "stage": "search",
            "queries_total": len(queries), "queries_done": 0, "listings": 0,
            "photos_read": 0, "photo_errors": 0, "shortlisted": 0,
            "bd_total": 0, "bd_done": 0, "bd_live": 0, "bd_cached": 0, "bd_failed": 0,
            "judged": 0, "judge_total": 0, "recalled": 0, "closer_look": 0, "cleared": 0, "no_match": 0, "judge_errors": 0,
            "events": [], "error": None}


def _event(msg, kind="info"):
    STATE["events"].append({"t": round(time.time() - STATE["started"], 1), "msg": msg, "kind": kind})
    STATE["events"] = STATE["events"][-200:]


async def run_sweep(categories: list[str], fresh: bool = False, max_listings: int | None = None,
                    lat: float = 32.7157, lon: float = -117.1611, radius: int = 30, detail_via: str = "api") -> str:
    sweep_id = datetime.now().strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    queries = [q for c in categories for q in CATEGORIES[c]["queries"]]
    STATE.clear(); STATE.update(_new_state(sweep_id, queries))
    brightdata.STATS.update(requests=0, ok=0, failed=0, seconds=0.0)
    STATE["bd"] = brightdata.STATS          # live counters, shared object
    STATE["transport"] = offerup.TRANSPORT
    STATE.update({"lat": lat, "lon": lon, "radius": radius, "detail_via": detail_via})
    con = connect()
    con.execute("INSERT INTO sweeps (sweep_id, started, queries) VALUES (?,?,?)",
                (sweep_id, datetime.now().isoformat(), json.dumps(queries)))
    con.commit()
    try:
        async with httpx.AsyncClient(limits=httpx.Limits(max_connections=60)) as http:
            listings = await _search(http, con, queries, lat, lon, radius)
            if max_listings:
                listings = listings[:max_listings]
            idents = await _identify(http, con, listings)
            short = _shortlist(con, listings, idents)
            await _unlock(http, con, short, fresh, detail_via)
            await _judge(http, con, sweep_id, short, idents)
        STATE["stage"] = "done"
        _event(f"Sweep finished in {time.time() - STATE['started']:.0f}s", "done")
    except Exception as e:
        STATE["error"] = f"{type(e).__name__}: {e}"
        _event("Sweep failed: " + STATE["error"], "error")
        raise
    finally:
        STATE["running"] = False
        stats = {k: v for k, v in STATE.items() if k not in ("events",)}
        con.execute("UPDATE sweeps SET finished=?, stats=? WHERE sweep_id=?",
                    (datetime.now().isoformat(), json.dumps(stats), sweep_id))
        con.commit()
    return sweep_id


async def _search(http, con, queries, lat, lon, radius):
    STATE["stage"] = "search"
    sem = asyncio.Semaphore(LIMITS["search"])
    seen: dict = {}

    async def one(q):
        async with sem:
            try:
                res = await offerup.search(http, q, lat, lon, radius)
            except Exception as e:
                _event(f"Search '{q}' failed: {e}", "error"); res = []
        for r in res:
            seen.setdefault(r["listing_id"], r)
        STATE["queries_done"] += 1
        STATE["listings"] = len(seen)
        via = "Bright Data" if offerup.TRANSPORT["mode"] == "brightdata" or offerup.TRANSPORT["direct_blocked"] else "direct"
        _event(f"OfferUp search '{q}' via {via}: {len(res)} listings ({len(seen)} unique so far)", "bd" if via == "Bright Data" else "info")

    await asyncio.gather(*[one(q) for q in queries])
    for r in seen.values():
        con.execute("""INSERT INTO listings (listing_id,title,price,city,thumb,query) VALUES (?,?,?,?,?,?)
                       ON CONFLICT(listing_id) DO UPDATE SET title=excluded.title, price=excluded.price,
                       city=excluded.city, thumb=excluded.thumb""",
                    (r["listing_id"], r["title"], r["price"], r["city"], r["thumb"], r["query"]))
    con.commit()
    return list(seen.values())


async def _identify(http, con, listings, batch=8):
    STATE["stage"] = "photos"
    if not vision.available():
        _event("No Gemini key: skipping photo reading, title text only", "warn")
        return {}
    sem = asyncio.Semaphore(LIMITS["identify"])
    out = {}
    todo = [li for li in listings if li.get("thumb")]
    groups = [todo[i:i + batch] for i in range(0, len(todo), batch)]

    async def one(group):
        async with sem:
            try:
                got = await vision.identify_batch(http, group)
            except Exception as e:
                STATE["photo_errors"] += len(group)
                _event(f"Photo batch failed: {str(e)[:80]}", "error")
                return
        for li in group:
            ident = got.get(li["listing_id"])
            if not ident:
                STATE["photo_errors"] += 1
                continue
            out[li["listing_id"]] = ident
            con.execute("INSERT OR REPLACE INTO identities VALUES (?,?)", (li["listing_id"], json.dumps(ident)))
            STATE["photos_read"] += 1
            brand = (ident.get("brand") or "").strip()
            if ident.get("model_numbers") or (brand and brand.lower() not in li["title"].lower()):
                _event(f"Photo read: '{li['title'][:40]}' -> {pipeline.identity_text(ident)[:70]}")
        con.commit()

    await asyncio.gather(*[one(g) for g in groups])
    con.commit()
    return out


def _shortlist(con, listings, idents):
    STATE["stage"] = "shortlist"
    short = []
    for li in listings:
        ident = idents.get(li["listing_id"])
        cands = pipeline.shortlist(con, li, ident)
        if cands and (ident or cands[0]["rule"] or cands[0]["ev"]["model_hit"]):
            short.append(li)
    STATE["shortlisted"] = len(short)
    _event(f"Text stage: {len(short)} of {len(listings)} listings share a brand or model with a recall")
    return short


async def _unlock(http, con, short, fresh, via):
    STATE["stage"] = "unlock"
    STATE["bd_total"] = len(short)
    sem = asyncio.Semaphore(LIMITS["unlock"])

    async def one(li):
        async with sem:
            try:
                d = (await _detail_fresh(http, li)) if (fresh and via == "brightdata") else await offerup.detail(http, li["listing_id"], via)
                li.update({k: v for k, v in d.items() if k != "from_cache" and v})
                STATE["bd_cached" if d["from_cache"] else "bd_live"] += 1
                con.execute("""UPDATE listings SET description=?, photos=?, lat=?, lon=?, post_date=?, city=?,
                               detail_fetched=1 WHERE listing_id=?""",
                            (d["description"], json.dumps(d["photos"]), d["lat"], d["lon"], d["post_date"],
                             d["city"] or li["city"], li["listing_id"]))
                con.commit()
                _event(("Bright Data unlocked item page: " if via == "brightdata" else "Item details via Bright Data: ") + f" '{li['title'][:45]}' ({len(d['photos'])} photos)"
                       + (" [cache]" if d["from_cache"] else ""), "bd")
            except Exception as e:
                STATE["bd_failed"] += 1
                _event(f"Bright Data failed for '{li['title'][:40]}': {str(e)[:80]}", "error")
            STATE["bd_done"] += 1

    await asyncio.gather(*[one(li) for li in short])


async def _detail_fresh(http, li):
    from .brightdata import unlock
    await unlock(http, offerup.item_url(li["listing_id"]), use_cache=False)
    return await offerup.detail(http, li["listing_id"], "brightdata")


async def _judge(http, con, sweep_id, short, idents):
    STATE["stage"] = "judge"
    STATE["judge_total"] = len(short)
    sem = asyncio.Semaphore(LIMITS["judge"])

    async def one(li):
        async with sem:
            try:
                v = await pipeline.judge_listing(con, http, li, idents.get(li["listing_id"]))
            except Exception as e:
                v = {"verdict": "error", "recall_id": 0, "reason": str(e)[:200], "stage": "error"}
        STATE["judged"] += 1
        key = "judge_errors" if v["verdict"] == "error" else v["verdict"]
        STATE[key] = STATE.get(key, 0) + 1
        ev = {k: v.get(k) for k in ("listing_evidence", "recall_evidence", "photo_index", "model_check", "candidates", "_model")}
        con.execute("""INSERT OR REPLACE INTO verdicts (listing_id, recall_id, sweep_id, verdict, confidence, reason, evidence, stage)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (li["listing_id"], v.get("recall_id") or 0, sweep_id, v["verdict"], v.get("confidence"),
                     v.get("reason"), json.dumps(ev), v.get("stage")))
        con.commit()
        if v["verdict"] in ("recalled", "closer_look", "cleared"):
            _event(f"{v['verdict'].upper()}: '{li['title'][:45]}' {li.get('city','')}", v["verdict"])

    await asyncio.gather(*[one(li) for li in short])


if __name__ == "__main__":
    import sys
    cats = sys.argv[1:] or ["infant_sleep"]
    sid = asyncio.run(run_sweep(cats))
    s = {k: v for k, v in STATE.items() if k != "events"}
    print(json.dumps(s, indent=1))
