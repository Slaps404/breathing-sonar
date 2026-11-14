# app: onboarding UI

One screen to set up (who to call, where to sit, Start), then watch, alarm, called.

Run: `python3 -m http.server` in the repo root, open `http://localhost:8000/app/`.

## How it connects

```
app.js (screens)  --startMonitoring()-->  sonar        (stub in hooks.js)
                  --callFriend()------->  phone call   (stub in hooks.js)
```

Both hooks live in `hooks.js` with their contracts in comments. Replace the bodies there; `app.js` should not need changes.
While `SonarHooks.isStub` is true, the watch and alarm screens show "Stub controls" links to fake a breathing stop.

- `COUNTDOWN_S` in `app.js`: seconds to press "I'm okay" before the friend is phoned (15).
- Contact details are kept in this browser's localStorage only. "Forget these details" clears them.
