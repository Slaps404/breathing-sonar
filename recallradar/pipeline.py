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
    """With a photo reading: brand-first shortlist. Without one (no Gemini): word-overlap text stage."""
    if ident:
        return match.brand_shortlist(con, listing["title"], ident, listing.get("description") or "", k=k)
    return match.text_stage(con, listing["title"], listing.get("description") or "", k=k)


def model_check(listing: dict, ident: dict | None, rec: dict) -> tuple[str, list, list]:
    """Deterministic model-number check. Returns (status, listing_models, recalled_models).
    status: 'listed' | 'not_listed' | 'unknown' | 'all_models'."""
    text = listing["title"] + " " + (listing.get("description") or "") + " " + " ".join((ident or {}).get("model_numbers") or [])
    lm = match.listing_model_numbers(text)
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
    top = cands[0]
    if (out["verdict"] == "no_match" and top.get("why") == "brand+type"
            and match.brand_is_recaller(top.get("brand", ""), top["recall"])
            and model_check(listing, ident, top["recall"])[0] == "unknown" and top["recall"]["models"]):
        # Rule: same brand + same product type, recall covers only some models, none readable -> closer look
        out.update(verdict="closer_look", recall_id=top["recall"]["recall_id"],
                   reason=f"Same brand and product type as this recall, which covers only certain models; "
                          f"no model number is visible. Photo check said: {out['reason']}")
    # Rule: "recalled" needs a named product/model match and agreeing brands; look-alikes are at most "closer look"
    if out["verdict"] == "recalled" and not (out.get("brands_agree") and (out.get("named_product_match") or "").strip()):
        if out.get("brands_agree"):
            out["verdict"] = "closer_look"
            out["reason"] = "Same brand and similar product, but no recalled product name or model is visible. " + out["reason"]
        else:
            out["verdict"] = "no_match"
            out["reason"] = f"Different brand ({out.get('listing_brand') or 'unknown'}). " + out["reason"]
    rec = next((c["recall"] for c in cands if c["recall"]["recall_id"] == out.get("recall_id")), None)
    if out["verdict"] != "no_match" and not rec:
        rec = cands[0]["recall"]; out["recall_id"] = rec["recall_id"]
    return apply_rules(out, rec, listing, ident)
