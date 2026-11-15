"""One-command known-rate take: opens the silent pacer and records while you breathe with it.
30 s get ready, 100 s at 15 breaths/min (label normal), 95 s at 6 breaths/min (label slow).
Run: .venv/bin/python collect/paced.py
"""
import subprocess, time
from pathlib import Path
from recorder import Recorder

r = Recorder(amp=0.15, f0=20000, f1=22000)
r.plan = "paced: normal 100 @15/min, slow 95 @6/min"
subprocess.run(["open", "file://" + str(Path(__file__).resolve().parent.parent / "tools" / "pacer.html") + "?auto"])
time.sleep(31)                      # pacer's get-ready countdown
r.start(); r.label("normal"); time.sleep(100)
r.label("slow"); time.sleep(95)
m = r.stop()
print({k: m[k] for k in ("id", "seconds", "xruns", "snrMedianDb")})
