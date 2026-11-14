"""Text stage: shortlist recalls for a listing using words, brands and model numbers.

How it works:
1. Keyword search (SQLite FTS5, BM25 ranking) over all recalls using the listing's words -> top candidates.
2. For each candidate, find shared *distinctive* words (rare across all recalls, e.g. "wehwupe", "onewheel")
   and shared model numbers. Common words like "baby" or "bed" do not count as evidence.
3. Rule verdict (used when no vision model is available, and as a pre-check before it):
   - model number match                         -> recalled
   - recall covers "all models" + brand + product -> recalled
   - brand + product, no model, specific models   -> needs a closer look
   - listing names a model the recall does not list -> cleared
   - remedy is a repair                           -> at most "needs a closer look"
"""
import math
import re

from .recalls import extract_models

STOP = set("""a an and the of for with in on to by is it at or as from new used like good great condition
works working only all set sale firm price obo pickup must go great nice clean brand size baby kids""".split())

_df_cache: dict = {}


def _ensure_vocab(con):
    con.execute("CREATE VIRTUAL TABLE IF NOT EXISTS recalls_vocab USING fts5vocab(recalls_fts, 'row')")
    if not _df_cache:
        n = con.execute("SELECT count(*) FROM recalls").fetchone()[0]
        _df_cache["_n"] = n
        for term, doc in con.execute("SELECT term, doc FROM recalls_vocab"):
            _df_cache[term] = doc


def stem(w: str) -> str:
    # tiny stemmer, close enough to FTS porter for plurals
    w = w.lower()
    if w.endswith("ing") and len(w) > 5:
        return w[:-3]
    for suf in ("ies", "es", "s"):
        if w.endswith(suf) and len(w) > 4:
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]


def idf(con, w: str) -> float:
    _ensure_vocab(con)
    n = _df_cache["_n"]
    # vocab terms are porter-stemmed; try both forms
    df = _df_cache.get(w) or _df_cache.get(stem(w)) or 0
    return math.log((n + 1) / (df + 1))


def _fts(con, ws: list[str], limit: int) -> list[dict]:
    if not ws:
        return []
    q = " OR ".join(f'"{w}"' for w in ws[:30])
    rows = con.execute(
        """SELECT r.* FROM recalls_fts JOIN recalls r ON r.recall_id = recalls_fts.rowid
           WHERE recalls_fts MATCH ? ORDER BY bm25(recalls_fts, 5.0, 3.0, 5.0, 8.0, 1.0) LIMIT ?""",
        (q, limit)).fetchall()
    return [dict(r) for r in rows]


def candidates(con, title: str, body: str = "", limit: int = 40) -> list[dict]:
    """Union of three searches: title words, rare words only, and title+description words."""
    tw = list(dict.fromkeys(words(title)))
    rare = [w for w in dict.fromkeys(words(title + " " + body)) if idf(con, w) > 4.0]
    allw = list(dict.fromkeys(words(title + " " + body)))
    seen, out = set(), []
    for rows in (_fts(con, tw, limit), _fts(con, rare, limit), _fts(con, allw, limit)):
        for r in rows:
            if r["recall_id"] not in seen:
                seen.add(r["recall_id"]); out.append(r)
    return out


def bigrams(ws: list[str]) -> set[str]:
    return {f"{a} {b}" for a, b in zip(ws, ws[1:])}


_product_nouns: set = set()


def product_nouns(con) -> set:
    """Words that name product TYPES (bassinet, sleeper, rail...): they appear after 'Recalls' in 5+ recall titles.
    These are not brand evidence even if rare overall."""
    if not _product_nouns:
        from collections import Counter
        cnt = Counter()
        for (t,) in con.execute("SELECT title FROM recalls"):
            m = re.search(r"\bRecall(?:s|ed)?\b(.*?)(\bDue\b|$)", t)
            if m:
                cnt.update({stem(w) for w in words(m.group(1))})
        _product_nouns.update(w for w, n in cnt.items() if n >= 5)
    return _product_nouns


_phrase_df: dict = {}


def phrase_idf(con, phrase: str) -> float:
    """How rare a two-word phrase is across all recalls (uses an FTS phrase query)."""
    _ensure_vocab(con)
    if phrase not in _phrase_df:
        _phrase_df[phrase] = con.execute("SELECT count(*) FROM recalls_fts WHERE recalls_fts MATCH ?",
                                         (f'"{phrase}"',)).fetchone()[0]
    return math.log((_df_cache["_n"] + 1) / (_phrase_df[phrase] + 1))


def evidence(con, title: str, body: str, rec: dict) -> dict:
    """Compare one listing to one recall. Brand evidence comes from the listing TITLE only
    (sellers put the brand there; descriptions are noisy). Product evidence may come from either."""
    rec_text = " ".join([rec["title"], rec["products"], rec["brands"], rec["description"]])
    rw_raw = re.findall(r"[a-z0-9]+", rec_text.lower())
    rw = set(rw_raw) | {stem(w) for w in rw_raw}
    rbig = bigrams(rw_raw) | bigrams([stem(w) for w in rw_raw])

    t_raw = re.findall(r"[a-z0-9]+", title.lower())
    tw = [w for w in dict.fromkeys(words(title)) if not w.isdigit()]
    # brand: a rare title word, or a rare title phrase, that appears in the recall
    pn = product_nouns(con)
    brand_hit = [w for w in tw if (w in rw or stem(w) in rw) and idf(con, w) > 4.0 and stem(w) not in pn]
    tbig = [p for p in dict.fromkeys(bigrams(t_raw)) if not set(p.split()) & STOP and not any(x.isdigit() for x in p.split())]
    phrases = [p for p in tbig if p in rbig or " ".join(stem(x) for x in p.split()) in rbig]
    brand_hit += [p for p in phrases if phrase_idf(con, p) > 4.5 and not any(x in brand_hit for x in p.split())
                  and not all(stem(x) in pn for x in p.split())]

    a_raw = re.findall(r"[a-z0-9]+", (title + " " + body).lower())
    aw = set(words(title + " " + body))
    prod_words = set(words(rec["products"] + " " + rec["title"]))
    prod_words |= {stem(w) for w in prod_words}
    product_hit = [w for w in aw if (w in prod_words or stem(w) in prod_words)
                   and w not in brand_hit and idf(con, w) > 2.0 and not w.isdigit()]
    body_phr = [p for p in bigrams(a_raw) if (p in rbig) and not set(p.split()) & STOP
                and not any(x.isdigit() for x in p.split()) and phrase_idf(con, p) > 3.5]

    rec_models = {m.replace("-", "") for m in rec["models"].split()}
    listing_models = listing_model_numbers(title + " " + body)
    model_hit = [m for m in listing_models if m.replace("-", "") in rec_models and not m.isdigit()]
    other_models = [m for m in listing_model_numbers(title) if m not in model_hit and not m.isdigit()]
    all_models = bool(re.search(r"\ball (models|styles)\b", rec["description"] + " " + rec["products"] + " " + rec["title"], re.I))
    score = (2 * sum(idf(con, w) for w in brand_hit if " " not in w)
             + sum(phrase_idf(con, p) for p in phrases) + 0.5 * sum(phrase_idf(con, p) for p in body_phr)
             + sum(idf(con, w) for w in product_hit) * 0.3 + 15 * len(model_hit))
    return {"brand_hit": brand_hit, "product_hit": sorted(product_hit, key=lambda w: -idf(con, w))[:5],
            "phrases": sorted(set(phrases) | set(body_phr))[:6], "model_hit": model_hit,
            "other_models": other_models, "all_models": all_models, "score": round(score, 1)}


def rule_verdict(rec: dict, ev: dict) -> tuple[str, str] | None:
    """Return (verdict, reason) or None if this recall is not a plausible match."""
    repair = "repair" in rec["remedy_type"]
    if ev["model_hit"]:
        v = "closer_look" if repair else "recalled"
        why = f"Model {', '.join(ev['model_hit'])} is listed in the recall."
        return v, why + (" Remedy is a repair, so this unit may already be fixed." if repair else "")
    if not ev["brand_hit"] or not (ev["product_hit"] or ev["phrases"]):
        return None
    if ev["other_models"] and rec["models"] and not ev["all_models"]:
        return "cleared", (f"Same brand, but the listing names model {', '.join(ev['other_models'])}, "
                           f"which is not among the recalled models ({rec['models'][:80]}).")
    if ev["all_models"] and not repair:
        return "recalled", f"Recall covers all models of this {', '.join(ev['product_hit'][:2])} from {ev['brand_hit'][0]}."
    why = f"Brand ({', '.join(ev['brand_hit'])}) and product ({', '.join(ev['product_hit'][:3])}) match"
    if repair:
        return "closer_look", why + "; the remedy is a repair, so check whether it was done."
    return "closer_look", why + ", but no model number is visible. Check the label."


def listing_model_numbers(text: str) -> list[str]:
    """Model numbers in seller text. Stricter than for recall text: sellers write zip codes, sizes ('NEWBORN-3')
    and brand names with digits ('4moms'). Keep tokens with a digit and at most 3 letters in a row; pure numbers
    only when the seller says 'model' or 'style' right before them."""
    out = []
    for m in extract_models(text):
        if m.isdigit():
            if re.search(r"(model|style|item|mod)\s*(#|no\.?|number)?\s*:?\s*" + m, text, re.I):
                out.append(m)
            continue
        if re.search(r"[A-Z]{4,}", m) or re.match(r"^\d+-?IN-?\d+$", m) or re.match(r"^(\d+-)?\d+(M|T|Y|MO|MOS|PC|PCS|X)$", m):
            continue
        out.append(m)
    return out


def text_stage(con, title: str, body: str = "", k: int = 3) -> list[dict]:
    """Shortlist: recalls with brand or model evidence, best first."""
    out = []
    listing_text = title + " " + body
    for rec in candidates(con, title, body):
        ev = evidence(con, title, body, rec)
        if not (ev["brand_hit"] or ev["model_hit"]):
            continue
        rv = rule_verdict(rec, ev)
        out.append({"recall": rec, "ev": ev, "rule": rv})
    out.sort(key=lambda c: (c["rule"] is not None, c["ev"]["score"]), reverse=True)
    # same recall re-announced (e.g. Kids II 2019 and 2023): keep both, they are different evidence
    return out[:k]


# ---------- Brand-first shortlist (used when the photo reader gives a brand) ----------
GENERIC_BRANDS = {"", "unknown", "none", "n/a", "generic", "unbranded", "baby", "handmade", "custom", "other"}
TYPE_STOP = {"baby", "infant", "kid", "child", "children", "toddler", "portable", "electric", "adult", "product",
             "set", "with", "and", "for", "the", "of", "a", "new", "used", "seat", "toy"}


def _norm_brand(b: str) -> str:
    b = re.sub(r"[^a-z0-9 &'\-]", " ", b.lower()).replace("-", " ").replace("'", "")
    return re.sub(r"\s+", " ", b).strip()


def recalls_by_brand(con, brand: str, limit=60) -> list[dict]:
    """Recalls whose text contains the brand as an exact phrase (e.g. "bright starts", "fisher price")."""
    b = _norm_brand(brand)
    if b in GENERIC_BRANDS or len(b) < 3:
        return []
    toks = [t for t in re.findall(r"[a-z0-9]+", b)]
    q = '"' + " ".join(toks) + '"'
    rows = con.execute("""SELECT r.* FROM recalls_fts JOIN recalls r ON r.recall_id = recalls_fts.rowid
                          WHERE recalls_fts MATCH ? ORDER BY r.date DESC LIMIT ?""", (q, limit)).fetchall()
    return [dict(r) for r in rows]


def recalls_by_model(con, models: list[str]) -> list[dict]:
    out = []
    for m in models:
        rows = con.execute("""SELECT r.* FROM recalls_fts JOIN recalls r ON r.recall_id = recalls_fts.rowid
                              WHERE recalls_fts MATCH ? LIMIT 20""", (f'models:"{m}"',)).fetchall()
        out += [dict(r) for r in rows if m.replace("-", "") in r["models"].replace("-", "").split()]
    return out


def type_words(text: str) -> set[str]:
    return {stem(w) for w in words(text) if w not in TYPE_STOP and not w.isdigit()}


def brand_shortlist(con, title: str, ident: dict, body: str = "", k: int = 3) -> list[dict]:
    """Brand (from photo or title) + product type overlap, or exact model number. Best first."""
    brand = (ident or {}).get("brand") or ""
    ptype = " ".join([(ident or {}).get("product_type") or "", (ident or {}).get("product_line") or ""])
    lt = type_words(ptype + " " + title)
    models = listing_model_numbers(" ".join([title, body, " ".join((ident or {}).get("model_numbers") or [])]))
    out, seen = [], set()
    for rec in recalls_by_model(con, models):
        if rec["recall_id"] not in seen:
            seen.add(rec["recall_id"])
            out.append({"recall": rec, "why": "model", "type_overlap": [], "score": 100})
    for rec in recalls_by_brand(con, brand):
        if rec["recall_id"] in seen:
            continue
        rt = type_words(rec["title"].split(" Due to")[0] + " " + rec["products"])
        overlap = sorted((lt & rt) - type_words(brand))
        if not overlap:
            continue
        seen.add(rec["recall_id"])
        out.append({"recall": rec, "why": "brand+type", "type_overlap": overlap,
                    "score": 10 * len(overlap) + (5 if re.search(r"\ball (models|styles)\b", rec["description"], re.I) else 0)})
    # also offer strong title-word candidates (the photo reader can name the wrong brand)
    for c in text_stage(con, title, body, k=3):
        if c["recall"]["recall_id"] not in seen and c["rule"] and c["rule"][0] == "recalled":
            seen.add(c["recall"]["recall_id"])
            out.append({"recall": c["recall"], "why": "title", "type_overlap": c["ev"]["product_hit"], "score": 15})
    out.sort(key=lambda c: -c["score"])
    for c in out:
        c["ev"] = evidence(con, title + " " + brand + " " + ptype, body, c["recall"])
        c["rule"] = rule_verdict(c["recall"], c["ev"])
    return out[:k]
