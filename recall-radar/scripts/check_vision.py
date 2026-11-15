"""Run the full matcher on the 8 known listings and compare to expected verdicts."""
import asyncio, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
from recallradar import offerup, vision, pipeline
from recallradar.db import connect
from recallradar.recalls import get

P = Path(__file__).resolve().parent.parent / "data/known8.json"

async def main():
    con = connect(); items = json.loads(P.read_text())
    async with httpx.AsyncClient() as http:
        for it in items:
            if "error" in it:
                try:
                    it.update(await offerup.detail(http, it["listing_id"])); it.pop("error")
                except Exception as e:
                    it["error"] = str(e)
        P.write_text(json.dumps(items, indent=1))
        async def run(it):
            if "error" in it: return it, None, None
            it["thumb"] = it["photos"][0]
            ident = await vision.identify(http, it)
            return it, ident, await pipeline.judge_listing(con, http, it, ident)
        res = await asyncio.gather(*[run(i) for i in items])
    ok = 0
    for it, ident, v in res:
        if v is None: print("SKIP", it["listing_id"], it["error"][:70]); continue
        rec = get(con, v["recall_id"]) if v.get("recall_id") else {}
        good = v["verdict"] == it["expect"] and it["expect_recall"].lower() in rec.get("title", "").lower()
        ok += good
        print(f"{'OK ' if good else 'BAD'} expect={it['expect']:11} got={v['verdict']:11} conf={v.get('confidence')} [{v.get('_model','')}] | {it['title'][:38]}")
        print(f"      photo says: {pipeline.identity_text(ident)[:110]}")
        print(f"      recall: {rec.get('date','')} {rec.get('title','')[:70]}")
        print(f"      why: {v['reason'][:220]}")
        print(f"      listing evidence: {v.get('listing_evidence','')[:140]}")
    print(f"\n{ok}/{len(items)} correct")
asyncio.run(main())
