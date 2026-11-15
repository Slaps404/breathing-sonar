# app: onboarding UI

Phone first, one thought per screen: who to call, your name, where to sit (Start), then watch, alarm, called.
A returning person lands on the sit screen, so it is one tap to Start. On a laptop the same column sits centred.
Wording and the sit picture switch between "phone" and "laptop" by user agent. Colours follow the system light or dark setting.

Run: `python3 -m http.server` in the repo root, open `http://localhost:8000/app/`.

## How it connects

```
app.js (screens)  --startMonitoring()-->  sonar        (../dsp.js, range mode)
                  --callFriend()------->  phone call   (call/server.py on 127.0.0.1:8788)
```

Both hooks live in `hooks.js` with their contracts in comments; `app.js` only talks to them.

Judge view: on the watch screen, "Show the sonar" (or the s key) opens `judge.js`, a live panel of what the sonar sees
(distance heatmap with the chest boxed, the breathing line, the detectors' state). It is fed by `onDebug` in `hooks.js` and stays up during the alarm.
For the call, run `python3 call/server.py` first (needs the keys in `.env`).

- `COUNTDOWN_S` in `app.js`: seconds to tap the screen before the friend is phoned (6).
- Contact details are kept in this browser's localStorage only. "Forget these details" clears them.
