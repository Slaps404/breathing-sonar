"""Web server. Run:  .venv/bin/uvicorn recallradar.app:app --port 8000
Routes:
  GET  /                      the page (static/index.html)
  POST /api/sweep             start a sweep in the background
  GET  /api/status            live counters + event feed
  GET  /api/results           verdict cards for a sweep (default: latest with results)
  GET  /api/sweeps            past sweeps
  GET  /api/img?u=            image proxy (OfferUp images need a Referer header)
  GET  /api/report/{id}       draft notices for one match
"""
import asyncio
import json
import re

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from . import offerup, sweep, vision, voice
from .config import ROOT
from .db import connect

app = FastAPI(title="RecallRadar")
con = connect()
_http = httpx.AsyncClient()
_task: asyncio.Task | None = None


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
def config():
    n = con.execute("SELECT count(*) FROM recalls").fetchone()[0]
    latest = con.execute("SELECT max(date) FROM recalls").fetchone()[0]
    return {"categories": {k: v["label"] for k, v in sweep.CATEGORIES.items()},
            "queries": {k: v["queries"] for k, v in sweep.CATEGORIES.items()},
            "recalls_indexed": n, "latest_recall": latest, "gemini": vision.available(),
            "transport": offerup.TRANSPORT["mode"]}


class SweepReq(BaseModel):
    categories: list[str] = ["infant_sleep"]
    lat: float = 32.7157
    lon: float = -117.1611
    radius: int = 30
    max_listings: int | None = None


@app.post("/api/sweep")
async def start(req: SweepReq):
    global _task
    if sweep.STATE.get("running"):
        raise HTTPException(409, "A sweep is already running")
    bad = [c for c in req.categories if c not in sweep.CATEGORIES]
    if bad or not req.categories:
        raise HTTPException(400, f"Unknown categories: {bad}")
    _task = asyncio.create_task(sweep.run_sweep(req.categories, lat=req.lat, lon=req.lon,
                                                radius=req.radius, max_listings=req.max_listings))
    await asyncio.sleep(0.2)
    return {"sweep_id": sweep.STATE.get("sweep_id")}


@app.get("/api/status")
def status(since: float = -1):
    s = dict(sweep.STATE)
    s["events"] = [e for e in s.get("events", []) if e["t"] > since]
    return s


@app.get("/api/sweeps")
def sweeps():
    rows = con.execute("""SELECT s.sweep_id, s.started, s.finished, s.queries, s.stats,
                          (SELECT count(*) FROM verdicts v WHERE v.sweep_id = s.sweep_id) AS n
                          FROM sweeps s ORDER BY s.started DESC LIMIT 30""").fetchall()
    return [dict(r) for r in rows]


def _recall_card(rid: int) -> dict | None:
    r = con.execute("SELECT * FROM recalls WHERE recall_id=?", (rid,)).fetchone()
    if not r:
        return None
    r = dict(r)
    imgs = json.loads(r["images"] or "[]")
    return {"id": r["recall_id"], "title": r["title"], "date": r["date"], "url": r["url"],
            "products": r["products"], "models": r["models"], "units": r["units"],
            "hazard": r["hazard"][:400], "injuries": r["injuries"][:500], "remedy": r["remedy"][:400],
            "remedy_type": r["remedy_type"], "image": imgs[0]["url"] if imgs else None,
            "description": r["description"][:600]}


@app.get("/api/results")
def results(sweep_id: str | None = None, include_no_match: bool = False):
    if not sweep_id:
        row = con.execute("""SELECT sweep_id FROM verdicts WHERE verdict IN ('recalled','closer_look','cleared')
                             GROUP BY sweep_id ORDER BY max(created) DESC LIMIT 1""").fetchone()
        sweep_id = row[0] if row else None
    if sweep.STATE.get("running"):
        sweep_id = sweep.STATE["sweep_id"]
    where = "" if include_no_match else "AND v.verdict IN ('recalled','closer_look','cleared')"
    rows = con.execute(f"""SELECT v.*, l.title, l.price, l.city, l.thumb, l.photos, l.description, l.lat, l.lon,
                           l.post_date, l.query, i.data AS ident
                           FROM verdicts v JOIN listings l USING(listing_id)
                           LEFT JOIN identities i USING(listing_id)
                           WHERE v.sweep_id = ? {where} ORDER BY v.created""", (sweep_id,)).fetchall()
    out = []
    for r in rows:
        r = dict(r)
        ev = json.loads(r["evidence"] or "{}")
        photos = json.loads(r["photos"] or "[]") or [r["thumb"]]
        pi = ev.get("photo_index") or 0
        out.append({
            "listing_id": r["listing_id"], "title": r["title"], "price": r["price"], "city": r["city"],
            "photo": photos[pi] if pi < len(photos) else photos[0], "photos": photos[:6],
            "description": (r["description"] or "")[:500], "lat": r["lat"], "lon": r["lon"],
            "post_date": r["post_date"], "query": r["query"], "url": offerup.item_url(r["listing_id"]),
            "verdict": r["verdict"], "confidence": r["confidence"], "reason": r["reason"],
            "listing_evidence": ev.get("listing_evidence"), "recall_evidence": ev.get("recall_evidence"),
            "model_check": ev.get("model_check"), "stage": r["stage"], "model": ev.get("_model"),
            "photo_read": json.loads(r["ident"]) if r["ident"] else None,
            "recall": _recall_card(r["recall_id"]) if r["recall_id"] else None,
        })
    order = {"recalled": 0, "closer_look": 1, "cleared": 2, "no_match": 3, "error": 4}
    out.sort(key=lambda x: order.get(x["verdict"], 9))
    return {"sweep_id": sweep_id, "results": out}


@app.get("/api/img")
async def img(u: str):
    if not re.match(r"^https://(images\.offerup\.com|www\.cpsc\.gov|cpsc\.gov)/", u):
        raise HTTPException(400, "image host not allowed")
    try:
        data = await offerup.fetch_image(_http, u)
    except Exception as e:
        raise HTTPException(502, str(e)[:100])
    mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return Response(data, media_type=mime, headers={"Cache-Control": "max-age=86400"})


@app.get("/api/report/{listing_id}")
def report(listing_id: str):
    r = con.execute("""SELECT v.*, l.title, l.price, l.city FROM verdicts v JOIN listings l USING(listing_id)
                       WHERE v.listing_id=? ORDER BY v.created DESC LIMIT 1""", (listing_id,)).fetchone()
    if not r:
        raise HTTPException(404)
    r = dict(r)
    rec = _recall_card(r["recall_id"]) or {}
    ev = json.loads(r["evidence"] or "{}")
    url = offerup.item_url(listing_id)
    level = {"recalled": "appears to match", "closer_look": "may match"}.get(r["verdict"], "was checked against")
    facts = (f"Recall: {rec.get('title','')}\nDate: {rec.get('date','')}\nRecall record: {rec.get('url','')}\n"
             f"Units: {rec.get('units','')}\nHazard: {rec.get('hazard','')}\nRemedy: {rec.get('remedy','')}")
    evidence = (f"Listing: \"{r['title']}\", ${r['price']}, {r['city']}\n{url}\n"
                f"What matched in the listing: {ev.get('listing_evidence') or '-'}\n"
                f"What matched in the recall: {ev.get('recall_evidence') or '-'}\n"
                f"Why: {r['reason']}")
    seller = (f"Hi! I saw your listing \"{r['title']}\". It {level} a product under a federal safety recall, "
              f"and many sellers don't know this. The recall notice says: {rec.get('remedy','')[:300]}\n\n"
              f"Details: {rec.get('url','')}\n\nThis was flagged by an automated check, so please compare your "
              f"item's label with the recall notice. Thanks!")
    platform = (f"Subject: Listing that {level} a recalled product\n\nOfferUp Trust & Safety,\n\n"
                f"The listing below {level} a product recalled through the U.S. Consumer Product Safety "
                f"Commission. Federal law (15 U.S.C. 2068) prohibits selling recalled consumer products.\n\n"
                f"{evidence}\n\n{facts}\n\nThis was flagged by RecallRadar, an automated check. "
                f"Please review; we have not inspected the item in person.")
    cpsc = (f"Report to SaferProducts.gov / CPSC Office of Compliance\n\nA product that {level} a recalled product "
            f"is offered for resale online.\n\n{evidence}\n\n{facts}")
    return {"verdict": r["verdict"], "seller": seller, "platform": platform, "regulator": cpsc}


@app.get("/api/speak/{listing_id}")
async def speak(listing_id: str, lang: str = "en"):
    row = con.execute("SELECT sweep_id FROM verdicts WHERE listing_id=? ORDER BY created DESC LIMIT 1", (listing_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    card = next((c for c in results(row[0])["results"] if c["listing_id"] == listing_id), None)
    if not card:
        raise HTTPException(404)
    try:
        audio = await voice.speak(card, "es" if lang == "es" else "en")
    except Exception as e:
        raise HTTPException(502, f"voice failed: {str(e)[:120]}")
    return Response(audio, media_type="audio/mpeg")
