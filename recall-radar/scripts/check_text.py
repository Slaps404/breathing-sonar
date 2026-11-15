import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recallradar.db import connect
from recallradar.match import text_stage
con = connect()
for it in json.load(open(Path(__file__).resolve().parent.parent / "data/known8.json")):
    if "error" in it: print("SKIP", it["listing_id"], it["error"][:60]); continue
    cs = text_stage(con, it["title"], it["description"])
    got = cs[0] if cs else None
    v = got["rule"][0] if got and got["rule"] else "none"
    ok = v == it["expect"] and got and it["expect_recall"].lower() in got["recall"]["title"].lower()
    print(f"{'OK ' if ok else 'BAD'} expect={it['expect']:11} got={v:11} | {it['title'][:34]:34} -> {(got['recall']['date']+' '+got['recall']['title'][:55] if got else '-')}")
    if got: print("      brand", got["ev"]["brand_hit"], "phr", got["ev"]["phrases"][:3], "model", got["ev"]["model_hit"], "|", got["rule"] and got["rule"][1][:110])
