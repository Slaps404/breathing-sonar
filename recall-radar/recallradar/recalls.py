"""Recall index: download every CPSC recall from saferproducts.gov into SQLite + a keyword index.

Run:  python -m recallradar.recalls
"""
import json
import re
import time

import httpx

from .db import connect

API = "https://www.saferproducts.gov/RestWebServices/Recall"

# A model number: has a digit, 3+ chars, letters/digits with optional - . / inside. Examples:
# BRX-8002, A1263, PL01, 10081, ZLS-118S, UT3053
MODEL_RE = re.compile(r"\b(?=[A-Z0-9\-./]*\d)[A-Z0-9][A-Z0-9\-./]{2,}[A-Z0-9]\b|\b[A-Z]{1,3}\d{2,}\b")
NOT_MODEL = re.compile(r"^(\d{1,3}|\d{4}|19\d\d|20\d\d|\d+(MM|CM|IN|W|V|MAH|LBS?|OZ|FT)|\d+[.,]\d+|\d{3}-\d{3}-\d{4}|\d+-\d+-\d+)$")


def extract_models(text: str) -> list[str]:
    found = []
    for m in MODEL_RE.findall(text.upper()):
        m = m.strip("-./")
        if len(m) < 3 or NOT_MODEL.match(m) or not re.search(r"\d", m):
            continue
        if m not in found:
            found.append(m)
    return found


def extract_brands(rec: dict) -> list[str]:
    brands = []
    # "Kids II Recalls All Rocking Sleepers..." -> "Kids II"
    m = re.match(r"^(.*?)\s+(Recalls?|Recalled|Reannounces|Expands|Announces)\b", rec.get("Title") or "")
    if m:
        brands.append(m.group(1))
    for key in ("Manufacturers", "Importers", "Distributors"):
        for c in rec.get(key) or []:
            name = re.split(r",| of ", c.get("Name") or "")[0].strip()
            if name and name not in brands:
                brands.append(name)
    return brands


def remedy_type(rec: dict) -> str:
    opts = {o.get("Option", "").lower() for o in rec.get("RemedyOptions") or []}
    return ",".join(sorted(o for o in opts if o)) or "other"   # e.g. "refund,repair"


def row_from(rec: dict) -> dict:
    products = " | ".join(p.get("Name") or "" for p in rec.get("Products") or [])
    model_text = " ".join([rec.get("Description") or "", products]
                          + [p.get("Model") or "" for p in rec.get("Products") or []])
    return {
        "recall_id": rec["RecallID"],
        "number": rec.get("RecallNumber"),
        "date": (rec.get("RecallDate") or "")[:10],
        "title": rec.get("Title") or "",
        "description": rec.get("Description") or "",
        "products": products,
        "models": " ".join(extract_models(model_text)),
        "brands": " | ".join(extract_brands(rec)),
        "hazard": " ".join(h.get("Name") or "" for h in rec.get("Hazards") or []),
        "injuries": " ".join(i.get("Name") or "" for i in rec.get("Injuries") or []),
        "remedy": " ".join(r.get("Name") or "" for r in rec.get("Remedies") or []),
        "remedy_type": remedy_type(rec),
        "units": " | ".join(p.get("NumberOfUnits") or "" for p in rec.get("Products") or []),
        "url": rec.get("URL") or "",
        "images": json.dumps([{"url": i.get("URL"), "caption": i.get("Caption")} for i in rec.get("Images") or []]),
        "raw": json.dumps(rec),
    }


def build_index(start="1990-01-01") -> int:
    t = time.time()
    data = httpx.get(API, params={"format": "json", "RecallDateStart": start}, timeout=300).json()
    con = connect()
    rows = [row_from(r) for r in data]
    cols = list(rows[0].keys())
    con.execute("DELETE FROM recalls")
    con.executemany(f"INSERT OR REPLACE INTO recalls ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    [tuple(r[c] for c in cols) for r in rows])
    con.execute("INSERT INTO recalls_fts(recalls_fts) VALUES('rebuild')")
    con.commit()
    print(f"indexed {len(rows)} recalls in {time.time() - t:.1f}s")
    return len(rows)


def get(con, recall_id: int) -> dict:
    r = con.execute("SELECT * FROM recalls WHERE recall_id=?", (recall_id,)).fetchone()
    return dict(r) if r else {}


if __name__ == "__main__":
    build_index()
    con = connect()
    n_models = con.execute("SELECT count(*) FROM recalls WHERE models != ''").fetchone()[0]
    print(f"{n_models} recalls have at least one extracted model number")
    for title_like in ("%WeHwupe%", "%Kids II Recalls All Rocking%", "%OCOOPA%", "%Anker PowerCore%", "%Million Anker%"):
        r = con.execute("SELECT date,title,models,brands,remedy_type FROM recalls WHERE title LIKE ?", (title_like,)).fetchone()
        if r:
            print(dict(r))
