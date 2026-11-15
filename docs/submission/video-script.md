# Video script (3:00 max)

Two people: **Presenter** sits at the laptop and does the breathing and the hold. **Voice** reads all narration (recorded live off camera, or as voiceover added after). The presenter does not talk during the demo.

A phone for the friend sits in view (or a second camera on it), with the friend's number entered in the app.

## Before recording

- `python3 call/server.py` running and showing `Ready: POST http://127.0.0.1:8788/call`.
- `python3 -m http.server` in the repo root. App open at `http://localhost:8000/app/` in Chrome, details already entered so it opens on the "Sit like this" screen.
- Laptop sound on, no headphones. Room quiet. No one moving behind the presenter.
- Countdown set to 6 s (from the other branch).
- Do a full dry run once. The call costs Twilio and ElevenLabs credit.

Timing to plan around (from the code and replays):
- After Start, the page needs about 25-30 s of normal breathing before it says "Watching your breathing." (15 s of data, then the chest picker and a still baseline.) Press Start early, under the problem section.
- After the hold starts, the alert came 6.8-8.2 s in on our still recording. Then 6 s of countdown. So hold for about 15 s.
- Keep holding and stay still until the "Calling" screen. If breathing or movement shows up during the countdown, the alarm cancels itself. Do not touch the keyboard: any key cancels too.

## Script

| Time | On screen | Voice |
|---|---|---|
| 0:00-0:10 | Title card: "Breathing Sonar". Then the presenter sitting at a laptop. | "This is a browser tab that watches your breathing using sound. If your breathing stops, it phones a friend." |
| 0:10-0:35 | Presenter presses Start. Screen: "Finding your breathing." Presenter breathes normally, still. | "Many people who die of an opioid overdose are alone. An overdose stops breathing. If no one is there, no one knows. This needs nothing but a laptop. No install, no wearable." |
| 0:35-0:48 | Screen changes to "Watching your breathing. [Friend] gets a call only if it stops." Close-up of the green dot. | "The laptop speaker plays a sound too high for most adults to hear. The mic listens to the echo off the chest. It has found the presenter and is now watching." |
| 0:48-0:50 | Presenter visibly takes a breath and holds it. Optional caption: "Holding breath (safe stand-in for an overdose)". | "Now we hold our breath." |
| 0:50-0:58 | Same screen, presenter still and holding. | (silence, or) "Holding a breath is our safe stand-in for breathing stopping." |
| 0:58-1:04 | Alarm screen: "Are you okay?" with the 6 s countdown, beeping, browser voice says "Are you okay? Tap the screen." | "It noticed. It beeps and gives six seconds to tap 'I'm okay'. Nobody taps." |
| 1:04-1:10 | "Calling [Friend]." then "[Friend] is being called." Presenter can breathe now. Cut to the friend's phone. | "So it calls." |
| 1:10-1:30 | Phone rings. Friend answers on speaker. The agent says: "Hi [Friend]. This is an automated safety alert for [Name]. Their breathing appears to have stopped at [place]..." Friend replies "I'll check on them." | (no voiceover, let the call play) |
| 1:30-1:40 | Quick cut: a second clip where the alarm comes up and the presenter taps the screen. Back to "Watching your breathing." | "If you are fine, one tap cancels it. Moving can set off false alarms, so the countdown is there on purpose." |
| 1:40-2:10 | Open `docs/how-it-tells.html`. Click case 1 (Breathing), then 2 (Holding breath), then 3 (You move). Point at the outlined slice and the trace below it. | "How it works. The echo is split by distance, into slices about six centimeters wide. Each column here is one slice. Breathing makes the chest's slice wiggle slowly and regularly. A held breath makes it go flat. Moving makes everything jump, so movement blocks the alarm. The app finds the chest slice by itself, by looking for the slice that repeats like a breath." |
| 2:10-2:20 | Click case 4 (Person walks behind you). | "Someone walking behind you is at a different distance, so their echo lands in a different slice." |
| 2:20-2:40 | Results card: still take, 4 of 5 holds caught, 0 false alarms. Take with movement, 2 of 3 caught, 2 false alarms. | "We tested by replaying labeled recordings through the same code. Sitting still: four of five holds caught, no false alarms. With movement: two of three, and two false alarms. One person, one laptop so far." |
| 2:40-2:52 | Card: "Not a medical device. Tested on breath holds. Slow, shallow breathing needs a rate check: next." Then "Builds on UW Second Chance (2019)." | "It is a prototype. Real overdoses often start with slow, shallow breathing, and catching that is our next step. Phone sonar for overdose was shown by the University of Washington's Second Chance. Ours runs in a browser, finds you by itself, and calls a friend." |
| 2:52-3:00 | Back to the presenter at the laptop, "Watching your breathing." Repo URL on screen. | "Breathing Sonar. So no one has to be alone when their breathing stops." |

## If the live run fails on camera

- No alarm after 15 s of holding: breathe, wait for "Watching" again, retry. Check nobody is moving behind the presenter.
- "The call did not go through": check the terminal running `call/server.py` for the error. Most often a missing key in `.env` or an unverified "to" number on a Twilio trial account.
- Record the demo section separately from the narration if needed, and cut them together. Keep the alarm-to-ring part as one unbroken shot so it is clearly real.
