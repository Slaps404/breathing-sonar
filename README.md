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

## Collect labeled recordings
Raw mic audio plus label timestamps, saved to `data/` (not committed).

- **Mac menu bar:** `.venv/bin/python collect/menubar.py`. Click the `◌ sonar` icon, start, then pick what you are doing (breathing, holding breath, moving, away). Setup once: `python3 -m venv .venv && .venv/bin/pip install rumps sounddevice numpy`.
- **Phone page:** `python3 collect/server.py`, then expose port 8787 over HTTPS (phones only allow mic access on HTTPS pages).

Each take is a `.wav` and a `.json`. The JSON holds the labels as `{label, sample, t}` and one period of the probe; WAV sample `n` lines up with `probe[n % P]`.
