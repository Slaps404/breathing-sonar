"""One listing through the whole matcher: identify photo -> text shortlist -> vision verdict."""
import re

from . import match, vision
from .recalls import extract_models


def identity_text(ident: dict | None) -> str:
    if not ident:
        return ""
    return " ".join([ident.get("brand", ""), ident.get("product_line", ""), " ".join(ident.get("model_numbers") or []),
                     ident.get("visible_text", "")]).strip()


def shortlist(con, listing: dict, ident: dict | None, k=3) -> list[dict]:
    title = listing["title"] + " " + identity_text(ident)
    return match.text_stage(con, title, listing.get("description") or "", k=k)


def model_check(listing: dict, ident: dict | None, rec: dict) -> tuple[str, list, list]:
    """Deterministic model-number check. Returns (status, listing_models, recalled_models).
    status: 'listed' | 'not_listed' | 'unknown' | 'all_models'."""
    text = listing["title"] + " " + (listing.get("description") or "") + " " + " ".join((ident or {}).get("model_numbers") or [])
    lm = [m for m in extract_models(text) if not m.isdigit() or len(m) >= 5]
    rm = rec["models"].split()
    norm = lambda m: m.replace("-", "").replace(".", "")
    if any(norm(m) in {norm(x) for x in rm} for m in lm):
        return "listed", lm, rm
    if re.search(r"\ball (models|styles)\b", rec["description"] + " " + rec["products"] + " " + rec["title"], re.I):
        return "all_models", lm, rm
    if lm and rm:
        return "not_listed", lm, rm
    return "unknown", lm, rm


def apply_rules(verdict: dict, rec: dict | None, listing: dict | None = None, ident: dict | None = None) -> dict:
    """Guardrails on top of the model. Model numbers are checked by code, not by the LLM."""
    if rec and listing is not None and verdict["verdict"] in ("recalled", "closer_look", "cleared"):
        status, lm, rm = model_check(listing, ident, rec)
        verdict["model_check"] = status
        v = verdict["verdict"]
        if status == "listed" and v != "recalled":
            verdict["verdict"] = "recalled"
            verdict["reason"] = f"Model {', '.join(lm)} appears in the recall's model list. " + verdict["reason"]
        elif status == "not_listed" and v == "recalled":
            verdict["verdict"] = "cleared"
            verdict["reason"] = (f"Same brand, but the listing shows model {', '.join(lm)}, which is not among the "
                                 f"recalled models ({', '.join(rm[:8])}).")
        elif status == "unknown" and rm and v == "cleared":
            verdict["verdict"] = "closer_look"
            verdict["reason"] = ("Only specific models are recalled (" + ", ".join(rm[:6]) + ") and no model number "
                                 "is visible in this listing. " + verdict["reason"])
    if rec and verdict["verdict"] == "recalled" and "repair" in rec["remedy_type"]:
        verdict["verdict"] = "closer_look"
        verdict["reason"] += " The fix for this recall is a repair, so this unit may already be fixed."
    return verdict


async def judge_listing(con, http, listing: dict, ident: dict | None) -> dict:
    cands = shortlist(con, listing, ident)
    if not cands:
        return {"verdict": "no_match", "recall_id": 0, "stage": "text", "reason": "No recall shares a brand or model."}
    if not vision.available():
        c = cands[0]
        if not c["rule"]:
            return {"verdict": "no_match", "recall_id": 0, "stage": "text", "reason": "Weak text overlap only."}
        v, why = c["rule"]
        return {"verdict": v, "recall_id": c["recall"]["recall_id"], "stage": "text", "reason": why,
                "listing_evidence": ", ".join(c["ev"]["brand_hit"] + c["ev"]["model_hit"]), "recall_evidence": "",
                "confidence": 0.5, "photo_index": 0}
    out = await vision.judge(http, listing, cands)
    out["stage"] = "vision"
    out["candidates"] = [c["recall"]["recall_id"] for c in cands]
    rec = next((c["recall"] for c in cands if c["recall"]["recall_id"] == out.get("recall_id")), None)
    if out["verdict"] != "no_match" and not rec:
        rec = cands[0]["recall"]; out["recall_id"] = rec["recall_id"]
    return apply_rules(out, rec, listing, ident)
