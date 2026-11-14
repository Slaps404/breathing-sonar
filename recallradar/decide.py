"""Decision-tree judge: a fast, free, explainable replacement for most Gemini judge calls.

Each shortlisted listing becomes a row of plain facts about its best candidate recall (does the brand match the
recalling company? is a readable model number on the recall's list? does the recall cover all models? ...).
A small decision tree, trained on verdicts the Gemini + rules pipeline already produced, maps facts -> verdict.

Used as a cascade: if the tree is confident, its verdict stands; otherwise the listing goes to Gemini.

Train:  python -m recallradar.decide train
"""
import json
import re
import sys
from datetime import date

from . import match
from .config import DATA

MODEL_PATH = DATA / "decision_tree.json"
FEATURES = ["model_listed", "model_not_listed", "model_unknown", "all_models", "brand_is_recaller",
            "brand_in_recall", "found_by_model", "found_by_title", "type_overlap", "product_phrase",
            "title_phrases", "repair_remedy", "recent_recall", "n_candidates", "photo_brand_read",
            "photo_model_read", "rule_recalled", "rule_closer", "rule_cleared", "infant_category"]


def _cand_facts(listing: dict, ident: dict | None, c: dict, n: int) -> dict:
    from .pipeline import model_check   # local import: pipeline imports this module
    rec = c["recall"]
    ident = ident or {}
    brand = ident.get("brand") or ""
    status, lm, rm = model_check(listing, ident, rec)
    text = " ".join([listing["title"], ident.get("product_type") or "", ident.get("product_line") or ""])
    rule = (c.get("rule") or (None,))[0]
    try:
        age = date.today().year - int(rec["date"][:4])
    except Exception:
        age = 30
    return {
        "model_listed": int(status == "listed"), "model_not_listed": int(status == "not_listed"),
        "model_unknown": int(status == "unknown"), "all_models": int(status == "all_models"),
        "brand_is_recaller": int(match.brand_is_recaller(brand, rec)),
        "brand_in_recall": int(bool(brand) and match._norm_brand(brand) in match._norm_brand(
            rec["title"] + " " + rec["products"] + " " + rec["description"])),
        "found_by_model": int(c.get("why") == "model"), "found_by_title": int(c.get("why") == "title"),
        "type_overlap": len(c.get("type_overlap") or []),
        "product_phrase": len(match.product_phrase_match(rec, text, brand)),
        "title_phrases": len((c.get("ev") or {}).get("phrases") or []),
        "repair_remedy": int("repair" in rec["remedy_type"]), "recent_recall": int(age <= 6), "n_candidates": n,
        "photo_brand_read": int(bool(brand.strip())), "photo_model_read": int(bool(ident.get("model_numbers"))),
        "rule_recalled": int(rule == "recalled"), "rule_closer": int(rule == "closer_look"),
        "rule_cleared": int(rule == "cleared"), "infant_category": int(ident.get("category") in ("infant_sleep", "infant_other")),
    }


def best_candidate(listing: dict, ident: dict | None, cands: list[dict]) -> tuple[dict, dict]:
    """Pick the candidate recall with the strongest evidence; return (candidate, facts)."""
    scored = []
    for c in cands:
        f = _cand_facts(listing, ident, c, len(cands))
        h = (100 * f["model_listed"] + 40 * f["model_not_listed"] + 30 * (f["all_models"] and f["brand_in_recall"])
             + 20 * f["brand_is_recaller"] + 10 * f["product_phrase"] + 5 * f["brand_in_recall"] + f["type_overlap"])
        scored.append((h, c, f))
    scored.sort(key=lambda t: -t[0])
    return scored[0][1], scored[0][2]


# ---------- training ----------

def training_rows(con, sweep_ids: list[str]) -> list[dict]:
    from .pipeline import shortlist
    q = f"""SELECT v.listing_id, v.verdict, v.recall_id, v.created, l.*, i.data AS ident FROM verdicts v
            JOIN listings l USING(listing_id) LEFT JOIN identities i USING(listing_id)
            WHERE v.sweep_id IN ({','.join('?' * len(sweep_ids))}) AND v.verdict != 'error' AND v.stage != 'code'
            ORDER BY v.created"""
    latest = {}
    for r in con.execute(q, sweep_ids).fetchall():
        latest[r["listing_id"]] = dict(r)          # later sweeps overwrite earlier verdicts
    rows = []
    for r in latest.values():
        r["photos"] = json.loads(r["photos"] or "[]")
        ident = json.loads(r["ident"]) if r["ident"] else None
        cands = shortlist(con, r, ident)
        if not cands:
            continue
        c, f = best_candidate(r, ident, cands)
        rows.append({"listing_id": r["listing_id"], "title": r["title"], "label": r["verdict"],
                     "label_recall": r["recall_id"], "tree_recall": c["recall"]["recall_id"], **f})
    return rows


def train(con, sweep_ids: list[str], depth: int = 4) -> dict:
    from sklearn.model_selection import cross_val_predict, StratifiedKFold
    from sklearn.tree import DecisionTreeClassifier, export_text
    rows = training_rows(con, sweep_ids)
    X = [[r[k] for k in FEATURES] for r in rows]
    y = [r["label"] for r in rows]
    clf = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=6, random_state=0)
    k = min(5, min(y.count(c) for c in set(y)))
    cv = StratifiedKFold(max(2, k), shuffle=True, random_state=0)
    pred = cross_val_predict(clf, X, y, cv=cv)
    proba = cross_val_predict(clf, X, y, cv=cv, method="predict_proba")
    clf.fit(X, y)
    tree = export_text(clf, feature_names=FEATURES)
    model = {"classes": list(clf.classes_), "tree": _dump(clf), "rules": tree, "n": len(rows),
             "cv_accuracy": sum(a == b for a, b in zip(pred, y)) / len(y), "sweeps": sweep_ids}
    MODEL_PATH.write_text(json.dumps(model))
    return {"model": model, "rows": rows, "cv_pred": list(pred), "cv_conf": [max(p) for p in proba]}


def _dump(clf) -> dict:
    """Store the tree as plain lists, so running it needs no sklearn."""
    t = clf.tree_
    return {"left": t.children_left.tolist(), "right": t.children_right.tolist(),
            "feature": t.feature.tolist(), "threshold": t.threshold.tolist(),
            "value": [v[0].tolist() for v in t.value]}


# ---------- inference ----------

_model = None


def load():
    global _model
    if _model is None and MODEL_PATH.exists():
        _model = json.loads(MODEL_PATH.read_text())
    return _model


def predict(facts: dict) -> tuple[str, float, list[str]] | None:
    """Return (verdict, confidence, path of decisions) or None if no model is trained."""
    m = load()
    if not m:
        return None
    t, node, path = m["tree"], 0, []
    while t["left"][node] != -1:
        f = FEATURES[t["feature"][node]]
        thr = t["threshold"][node]
        go_left = facts[f] <= thr
        path.append(f"{f} {'<=' if go_left else '>'} {thr:g}")
        node = t["left"][node] if go_left else t["right"][node]
    counts = t["value"][node]
    total = sum(counts) or 1
    i = max(range(len(counts)), key=lambda j: counts[j])
    return m["classes"][i], counts[i] / total, path


REASONS = {
    "recalled": "Decision rules: {why}.",
    "closer_look": "Decision rules: {why}. Check the label or whether the fix was done.",
    "cleared": "Decision rules: {why}.",
    "no_match": "Decision rules: {why}.",
}


def explain(facts: dict, rec: dict, verdict: str) -> str:
    bits = []
    if facts["model_listed"]:
        bits.append("a readable model number is on the recall's model list")
    if facts["model_not_listed"]:
        bits.append("the readable model number is not on the recall's list")
    if facts["all_models"]:
        bits.append("the recall covers all models")
    if facts["brand_is_recaller"]:
        bits.append("the brand is the recalling company")
    elif facts["brand_in_recall"]:
        bits.append("the brand is named in the recall")
    if facts["product_phrase"] or facts["type_overlap"]:
        bits.append("same product type")
    if facts["model_unknown"]:
        bits.append("no model number is visible")
    if facts["repair_remedy"]:
        bits.append("the remedy is a repair")
    return REASONS.get(verdict, "{why}").format(why="; ".join(bits) or "weak evidence")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "train":
    from .db import connect
    con = connect()
    sweeps = sys.argv[2:] or ["1114-122846-ed52-rj", "1114-130315-861a"]
    out = train(con, sweeps)
    m = out["model"]
    from collections import Counter
    print(f"rows: {m['n']}  labels: {dict(Counter(r['label'] for r in out['rows']))}")
    print(f"cross-validated accuracy vs Gemini pipeline: {m['cv_accuracy']:.1%}")
    from collections import defaultdict
    conf = defaultdict(Counter)
    for r, p in zip(out["rows"], out["cv_pred"]):
        conf[r["label"]][p] += 1
    print("confusion (row = Gemini pipeline, col = tree):")
    cls = m["classes"]
    print(" " * 13 + "".join(f"{c[:11]:>12}" for c in cls))
    for c in cls:
        print(f"{c[:12]:13}" + "".join(f"{conf[c][p]:>12}" for p in cls))
    print("\ncascade (cross-validated): tree decides when its confidence >= t, Gemini decides the rest")
    for t in (0.7, 0.8, 0.9, 0.95, 1.0):
        sel = [(r["label"], p) for r, p, c in zip(out["rows"], out["cv_pred"], out["cv_conf"]) if c >= t]
        acc = sum(a == b for a, b in sel) / len(sel) if sel else 0
        rec_wrong = sum(1 for a, b in sel if b == "recalled" and a != "recalled")
        print(f"  t={t:.2f}: tree decides {len(sel):3}/{len(out['rows'])} ({len(sel)/len(out['rows']):.0%}), agrees {acc:.1%}, "
              f"false 'recalled' {rec_wrong}")
    print("\n" + m["rules"])
