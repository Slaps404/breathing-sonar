# breathing-sonar

SanD Hacks (Nov 14-15, 2026) project. Turns a laptop's built-in speaker and mic into a contactless breathing monitor.

## Run the demo
The app watches your breathing and, if it stops and you do not tap "I'm okay", phones a friend.

**Quick start:** double-click `Start Demo.command`. It starts both servers (steps 1-2) and opens the app in Chrome (step 3). Close its window to stop them.

1. **Call server.** Make a `.env` file in the repo root (it is gitignored):
   ```
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_NUMBER=+1...
   ELEVENLABS_API_KEY=...
   ```
   Then run `python3 call/server.py`. No install needed (standard library only). It prints `Ready: POST http://127.0.0.1:8788/call`. The first run registers your Twilio number with ElevenLabs and creates the voice agent, then saves their ids in `call/state.json`. To test a call by itself: `python3 call/server.py --test +16195550123 --name Sam --user Alex --place "the library"`.
2. **Serve the repo.** In another terminal, in the repo root: `python3 -m http.server`. Ignore the `http://[::]:8000/` link it prints: Chrome blocks the mic there. Use the localhost link below.
SMS alerts include a Google Maps link: coordinates when location permission is allowed, otherwise a search for the typed place. With neither, the text says `unknown`. The sender must be approved for SMS (US local numbers need A2P registration). A `submitted` result means Twilio accepted the request, not that the phone received it. Restart the call server after changing its code.

3. **Open the app.** `http://localhost:8000/app/` in Chrome. Allow the mic.

What to expect: enter a friend's name and number, your name, and where you are. Sit 30-40 cm from the laptop, sound on, no headphones, and press Start. It says "Finding your breathing" for roughly half a minute, then "Watching your breathing". Hold your breath and stay still: after about 7-8 s it shows "Are you okay?" with a countdown and beeps. Tap or press any key to cancel. If not, the screen says the friend is being called and their phone rings with a voice alert. If the call server is not running, the screen shows the friend's number to dial by hand.

## How it works
1. The speaker plays sound at 20-22 kHz, which most adults cannot hear.
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
- **Guided take (hands-free):** in the same menu, `Set intervals` takes a plan like `normal 30, hold 20, x5` (seconds, `x5` repeats it 5 times; words: normal, hold, moving, away). `Start guided take` gives a 5 s get-ready countdown, then a silent banner at the top of the screen shows what to do and counts down. Labels are written automatically and the take saves itself at the end.
- **Phone page:** `python3 collect/server.py`, then expose port 8787 over HTTPS (phones only allow mic access on HTTPS pages).

Each take is a `.wav` and a `.json`. The JSON holds the labels as `{label, sample, t}` and one period of the probe; WAV sample `n` lines up with `probe[n % P]`.

## Friend kit (collect takes on other Macs)
`tools/make-kit.sh` builds `dist/sonar-recorder-kit.zip`: the menu bar recorder, a double-click `Start Recorder.command` (installs on first run, asks the person's name, warns if muted), and `READ ME FIRST.txt`. Quitting packs their takes into `~/Desktop/sonar-takes-<name>.zip` to send back. Takes are named `<name>-take-...` and their JSON records `who` and `machine`. The launcher also asks how much they want to help (Quick 2 takes, Helpful 5, Extra mile 8; steps defined in `collect/tracks.py`). The menu's Next take walks through them with set-up instructions, sets distance and intervals itself, and repeats a take that had dropouts or no echo. Each take's JSON records its `track` step.

---

## Also in this repo: RecallRadar

A second SanD Hacks 2026 project lives in [`recall-radar/`](recall-radar/): it sweeps local resale listings and finds
products under a federal safety recall, with the evidence for each match. See [`recall-radar/README.md`](recall-radar/README.md).
