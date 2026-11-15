"""Known-8 through the batched judge (judge_many), to compare with one-by-one."""
import asyncio, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
from recallradar import vision, pipeline
from recallradar.db import connect
from recallradar.recalls import get
items = json.loads((Path(__file__).resolve().parent.parent / "data/known8.json").read_text())
async def main():
    con = connect()
    async with httpx.AsyncClient() as http:
        for it in items: it["thumb"] = it["photos"][0]
        idents = await vision.identify_batch(http, items)
        t = time.time()
        res = await pipeline.judge_many(con, http, [(it, idents.get(it["listing_id"])) for it in items])
        print(f"{time.time()-t:.1f}s")
    ok = 0
    for it in items:
        v = res[it["listing_id"]]; rec = get(con, v.get("recall_id")) if v.get("recall_id") else {}
        good = v["verdict"] == it["expect"] and it["expect_recall"].lower() in rec.get("title", "").lower(); ok += good
        print(f"{'OK ' if good else 'BAD'} {it['expect']:11} got={v['verdict']:11} [{v.get('stage')}/{v.get('_model','')}] {it['title'][:35]} -> {rec.get('title','')[:50]}")
    print(f"{ok}/{len(items)}")
asyncio.run(main())
