"""Re-run only the verdict stage for a past sweep (cached listings, photo readings and details) into a new sweep id.
Usage: python scripts/rejudge.py <sweep_id>"""
import asyncio, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
from recallradar import sweep
from recallradar.db import connect

async def main(old):
    con = connect()
    rows = con.execute("""SELECT l.*, i.data AS ident FROM verdicts v JOIN listings l USING(listing_id)
                          LEFT JOIN identities i USING(listing_id) WHERE v.sweep_id=?""", (old,)).fetchall()
    short, idents = [], {}
    for r in rows:
        r = dict(r); r["photos"] = json.loads(r["photos"] or "[]")
        if r["ident"]: idents[r["listing_id"]] = json.loads(r["ident"])
        short.append(r)
    new = old + "-rj"
    sweep.STATE.clear(); sweep.STATE.update(sweep._new_state(new, []))
    con.execute("INSERT OR REPLACE INTO sweeps (sweep_id, started, queries) VALUES (?, datetime('now'), ?)", (new, json.dumps({"rejudge_of": old})))
    async with httpx.AsyncClient() as http:
        await sweep._judge(http, con, new, short, idents)
    con.execute("UPDATE sweeps SET finished=datetime('now'), stats=? WHERE sweep_id=?",
                (json.dumps({k: v for k, v in sweep.STATE.items() if k != "events"}), new)); con.commit()
    print(new, {k: sweep.STATE[k] for k in ("judged", "recalled", "closer_look", "cleared", "no_match", "judge_errors")})

asyncio.run(main(sys.argv[1]))
