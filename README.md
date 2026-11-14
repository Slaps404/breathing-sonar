# breathing-sonar

SanD Hacks (Nov 14-15, 2026) project. Turns a laptop's built-in speaker and mic into a contactless breathing monitor.

## How it works
1. The speaker plays sound above 18 kHz, which most adults cannot hear.
2. The sound bounces off your chest and the mic records the echo.
3. Breathing moves the chest a few millimeters, which shifts the echo's timing (phase).
4. The page tracks that shift to draw a breathing waveform, count breaths per minute, and speak up when breathing stops.

Everything runs in the browser tab. No audio leaves the device.

## Run
```
python3 -m http.server
```
Open `http://localhost:8000` in Chrome. Use the built-in speaker and mic, unmute the speaker, and on macOS set Control Center > Mic Mode to Standard. Sit 30-50 cm from the screen.

Pressing Stop downloads the run as JSON.

## Tools
- `node tools/sim.js`: feeds a simulated echo (15 breaths/min, then a 20 s breath hold) through the real page code.
- `node tools/analyze.js <run.json>`: signal strength and motion per 5 s for a recorded run.

Prototype only. Not a medical device.

---

## Also in this repo: RecallRadar

A second SanD Hacks 2026 project lives in [`recall-radar/`](recall-radar/): it sweeps local resale listings and finds
products under a federal safety recall, with the evidence for each match. See [`recall-radar/README.md`](recall-radar/README.md).
