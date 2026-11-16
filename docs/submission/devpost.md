# BreathBuddy

## Tagline

A web app that listens for your breathing with sound, and phones a friend if it stops.

## Inspiration

About 75.5% of US overdose deaths in 2022-2024 happened with no one else present (CDC SUDORS 2022-2024, 191,577 deaths). An overdose slows breathing and then stops it. If no one is there, no one can give naloxone or call 911.

I wanted something a person could turn on in seconds with a laptop. It builds on the University of Washington "Second Chance" project (2019), a phone sonar app for the same problem.

## What it does

A friend sets BreathBuddy up on their phone and texts a personal link. The person opens it on a laptop, presses Start, and breathes with an on-screen cloud for about 26 seconds while it finds their chest. Then it watches.

If breathing-speed chest movement drops to a quarter of that person's normal level for 2 seconds while they are still, it asks "Are you okay?" out loud with a 6 second countdown. Any tap or key cancels. If nobody answers, a voice agent phones the friend. It says who the call is about, that their breathing appears to have stopped, where they are, and to call 911 if they cannot reach them. The friend can ask it questions.

## How we built it

The laptop speaker plays a repeating 20-22 kHz probe, too high for most adults to hear. The mic records the echoes. Dividing the received spectrum by the probe's gives echo strength by distance, in slices of about 6 cm, 23 times a second.

A breathing chest moves a few millimetres, which shifts the phase of its echo at 0.15-0.6 Hz. The app finds the closest slices within 80 cm that have a breathing rhythm, then compares their breathing-band movement over the last 8 seconds with the person's own baseline. Probe loudness sets itself: quiet first, louder only until the mic hears it clearly.

All signal processing is plain JavaScript in the browser (AudioWorklet). No ML model, and no audio leaves the device. A small Python server on Vultr places the call with Twilio and an ElevenLabs voice agent. The app is hosted on GitHub Pages.

## Challenges we ran into

- **Silent failure.** With the speaker muted, the app said "watching" while hearing nothing. Now it says the mic cannot hear the probe.
- **Audible leak.** At high volume the probe could be heard. Automatic loudness fixed it.
- **It locked onto a dog** breathing at 114 cm. I limited the search to 80 cm.
- **Slow lock-on.** I cut it from 32 to about 26 seconds.
- **Breathing rate did not work.** A paced test at 15 and 6 breaths per minute could not tell them apart reliably. So I do not claim it catches slowing breathing.
- **The simulator fell short.** I built one, calibrated from my recordings, but it does not reproduce the detector well enough to quote accuracy from.

## Accomplishments that we're proud of

This morning in the live app, 11 of 11 breath holds raised the alarm and placed the call. Where the hold was marked, the alarm came 5 to 12 seconds in. One person, one MacBook, a quiet room, deliberate holds. A friend also tried it on their own MacBook and it worked for them too; that run was not recorded, so it is not counted.

On older labelled recordings that include moving and fidgeting, replay caught 23 of 29 holds with 12 false alarms. I tuned the detector on those same recordings, so this is not a held-out result.

The whole chain works: a held breath at a laptop ends with a real phone ringing and a voice explaining why.

## What we learned

- A laptop speaker and mic can sense millimetre chest movement at arm's length.
- "Does it repeat like a breath" finds the chest better than "what moves most".
- The hard part is not seeing a stop. It is not raising alarms when someone moves.

## Limits

This is a prototype, not a medical device. It was measured on one person and one laptop, plus one friend's MacBook, never on a real overdose or during sleep. It cannot reliably catch breathing that only slows. Phones cut the probe band; an 18-20 kHz option exists but is unproven. A person or pet breathing closer than the user can be picked instead. Lock-on takes about 26 seconds, and movement makes it start over.

## What's next for BreathBuddy

- Test on more people, laptops and rooms, with held-out recordings.
- Make breathing-rate reading work, to catch slowing breathing.
- Prove the 18-20 kHz band on phones.

## Built with

JavaScript, Web Audio API, AudioWorklet, Python, Twilio, ElevenLabs, Vultr, GitHub Pages, HTML/CSS

## Links

- App: https://breathbuddy.us/app/
- Code: https://github.com/Slaps404/breathing-sonar

## Tracks to enter

- **Best Overall:** a working end-to-end safety tool for people who use alone, with honest test results.
- **UCSD Basement Most Innovative:** sonar from a laptop's own speaker and mic in a web page, with no extra hardware.
- **ElevenLabs Best Project:** the ElevenLabs voice agent is how the alarm reaches a person; it explains the situation and answers the friend's questions.
- **MLH Best Use of Vultr:** the call server runs on a Vultr machine and is the link between the web app and the phone call.
