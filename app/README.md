# app: the phone app

Phone first, one thought per screen:
hello → how it works (3 swipeable cards) → who to call → your name → how to sit (Start) → watch → alarm → called.
A returning person lands on the sit screen ("Welcome back"), one tap from Start.
On a laptop the app sits inside a drawn phone frame. Wording and the sit picture switch between "phone" and "laptop" by user agent.
Colours follow the system light or dark setting. Every action is a `<button>`; there are no links.

Run: `python3 -m http.server` in the repo root, open `http://localhost:8000/app/`.

## How it connects

```
app.js (screens)  --startMonitoring()-->  sonar        (../dsp.js, range mode)       } both in hooks.js,
                  --callFriend()------->  phone call   (call/server.py, 127.0.0.1:8788) } contracts in comments
       |
       +--BreathingApp.on(type, detail)-->  dev.js (dev dashboard, only with ?debug)
                                             +-- judge.js (live sonar view, fed by onDebug)
```

## Dev mode: `app/?debug`

Everything that collects data or fakes events lives in the dev dashboard, so the plain app stays a plain app.
`?debug` turns it on and remembers it; `?debug=0` or "Leave dev mode" turns it off.
On a wide screen the dashboard sits beside the phone; narrower, the DEV button opens it as a drawer.

- Sonar view (judge.js): distance heatmap with the chest boxed, the breathing line, the detectors' state.
- Run: fake sonar (no mic: breathes 15/min, stops when you mark a hold), record a take (.wav + labels on Stop), place the real call or fake it, alarm sound.
- Hold marker (h key): labels "holding my breath" in the take.
- Simulate: breathing stopped/resumed, and each sonar status. Go to any screen.
- Event log, and what is saved on this device (the call key is shown as hidden).

Outside dev mode nothing is recorded or downloaded.
Keys in dev mode: h hold, m sound, s show/hide the dashboard. During the alarm countdown any key means "I'm okay".

For a real call, run `python3 call/server.py` first (needs the keys in `.env`).

- `COUNTDOWN_S` in `app.js`: seconds to tap the screen before the friend is phoned (6).
- Partner link: on the first screen, "Setting this up for someone?" lets the friend type their name, number and the
  person's name, then share `app/?friend=Sam&phone=%2B16195550123&name=Alex`. Opening it saves those details and shows one
  screen (optional home address), then Start. The link always points at the public site (`PUBLIC_APP` in `app.js`), even when made on localhost.
  No install: it runs in a browser tab. The link also carries the call passcode from the partner's browser (`&key=`), so
  the person's tab can place the call; the partner needs to have opened the app once with `?key=<passcode>`.
  After the first Start, the sit screen offers "Keep it on your home screen" (optional, also in Settings).
- Location: the app asks for it during setup and takes a fresh GPS fix at Start (there is no typed "where you are" field).
- Contact details are kept in this browser's localStorage only. Settings → "Forget these details" clears them.
