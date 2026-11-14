"""Contact sheet for manual precision checks: seller photo | recall photo | verdict text, one row per match.
Usage: python scripts/contact_sheet.py <sweep_id> [verdicts=recalled,closer_look] [out=/tmp/sheet]"""
import hashlib, io, json, sys, textwrap
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image, ImageDraw
from recallradar.config import CACHE
from recallradar.db import connect

sid = sys.argv[1]
verdicts = (sys.argv[2] if len(sys.argv) > 2 else "recalled,closer_look").split(",")
out = Path(sys.argv[3] if len(sys.argv) > 3 else "/tmp/sheet")
out.mkdir(parents=True, exist_ok=True)
con = connect()
rows = con.execute(f"""SELECT v.*, l.title, l.price, l.photos, l.thumb, r.title rt, r.images FROM verdicts v
    JOIN listings l USING(listing_id) LEFT JOIN recalls r ON r.recall_id=v.recall_id
    WHERE v.sweep_id=? AND v.verdict IN ({','.join('?'*len(verdicts))}) ORDER BY v.verdict DESC""", (sid, *verdicts)).fetchall()

def load(u, size=220):
    p = CACHE / ("img_" + hashlib.sha1(u.encode()).hexdigest()) if u else None
    try:
        im = Image.open(io.BytesIO(p.read_bytes())).convert("RGB"); im.thumbnail((size, size)); return im
    except Exception:
        return Image.new("RGB", (size, size), (40, 40, 40))

H, per = 230, 6
for page in range(0, len(rows), per):
    sheet = Image.new("RGB", (1200, H * per), (255, 255, 255)); d = ImageDraw.Draw(sheet)
    for k, r in enumerate(rows[page:page + per]):
        y = k * H
        ev = json.loads(r["evidence"] or "{}"); ph = json.loads(r["photos"] or "[]") or [r["thumb"]]
        pi = ev.get("photo_index") or 0
        sheet.paste(load(ph[pi] if pi < len(ph) else ph[0]), (5, y + 5))
        im = json.loads(r["images"] or "[]")
        sheet.paste(load(im[0]["url"] if im else None), (230, y + 5))
        txt = f"#{page + k} [{r['verdict']}] {r['title'][:60]} ${r['price']}\nRECALL: {r['rt'] or '-'}\nWHY: {r['reason']}"
        d.multiline_text((460, y + 8), "\n".join(textwrap.fill(t, 95) for t in txt.split("\n"))[:900], fill=(0, 0, 0))
        d.line((0, y + H - 2, 1200, y + H - 2), fill=(200, 200, 200))
    f = out / f"{sid}_{page // per}.png"; sheet.save(f); print(f)
print(len(rows), "rows")
