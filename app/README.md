# app: onboarding UI

Phone first, one thought per screen: who to call, your name, where to sit (Start), then watch, alarm, called.
A returning person lands on the sit screen, so it is one tap to Start. On a laptop the same column sits centred.
Wording and the sit picture switch between "phone" and "laptop" by user agent. Colours follow the system light or dark setting.

Run: `python3 -m http.server` in the repo root, open `http://localhost:8000/app/`.

## How it connects

```
app.js (screens)  --startMonitoring()-->  sonar        (stub in hooks.js)
                  --callFriend()------->  phone call   (stub in hooks.js)
```

Both hooks live in `hooks.js` with their contracts in comments. Replace the bodies there; `app.js` should not need changes.
While `SonarHooks.isStub` is true, a small "stub:" bar at the top right has links to fake a breathing stop.

- `COUNTDOWN_S` in `app.js`: seconds to tap the screen before the friend is phoned (15).
- Contact details are kept in this browser's localStorage only. "Forget these details" clears them.
