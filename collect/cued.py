"""One-command scripted take: shows silent cues in the browser and records with matching labels.
Run: .venv/bin/python collect/cued.py "deep 30, normal 30, hold 20, normal 30, hold 20, normal 30, hold 20, normal 15"
Labels: deep -> "slow" (deep slow breaths, 4 s in / 6 s out, like the app), normal, hold. 30 s get-ready first.
"""
import subprocess, sys, time
from pathlib import Path
from recorder import Recorder

LEAD = 30
plan = sys.argv[1] if len(sys.argv) > 1 else "deep 30, normal 30, hold 20, normal 30, hold 20, normal 30, hold 20, normal 15"
steps = [(p.split()[0], float(p.split()[1])) for p in plan.split(",")]
url = "file://" + str(Path(__file__).resolve().parent.parent / "tools" / "cue.html") + f"?lead={LEAD}&plan=" + ",".join(f"{k}:{s:g}" for k, s in steps)
r = Recorder(amp=0.15, f0=20000, f1=22000)
r.plan = "cued: " + plan
subprocess.run(["open", url])
time.sleep(LEAD + 1)
r.start()
for k, s in steps:
    r.label({"deep": "slow"}.get(k, k)); time.sleep(s)
m = r.stop()
print({k: m[k] for k in ("id", "seconds", "xruns", "snrMedianDb")})
