# Demo and pitch plan: Breathing Sonar

SanD Hacks, final submission Sun Nov 15, 12:00 PM. Judging 12:30-2:30 PM, science fair: 3 min pitch + 2 min questions per judge. The whole team must be at the table or that judge scores zero (source: `sandhacks/research/reports/01_hackathon_identity.md`).

Rubric (01): Idea, Demo ("did it work?"), Technical complexity, Completion ("does it do everything it's advertised to do?"). The last one punishes overclaiming. Every claim below is sized to the measured facts.

---

## 1. Tracks: recommendation

| Track | Enter with Breathing Sonar? | Why |
|---|---|---|
| Best Overall / Runner-Up | Yes | Default. Live physical moment (a phone rings) is the kind of demo judges remember (05, section 2). |
| UCSD Basement: Most Innovative | Yes | Its text: "creative, realistically achievable solution to a real-world problem". Laptop sonar is rare at hackathons (07: 1 Devpost project found). |
| ElevenLabs: Best Project Built with ElevenLabs | Yes | The ElevenLabs voice agent places the call and answers the friend's questions. It is the end of the core flow, not a tag. Show it live: the judge hears it. |
| MLH Best Use of Vultr | Only if the demo call goes through the Vultr server | The hosted call server runs on Vultr (README). If the table demo uses the local `call/server.py`, Vultr is not in the demo and the claim is thin. |
| Bright Data: Data for Good | **No** | See below. |
| Neon, Gemini, Tiger Data, Mastra, Solana | No | Not used. |

### Bright Data "Data for Good"

The track text is one sentence: "Use web data to drive positive social impact" (10, section 1). Breathing Sonar uses no web data. It does not fit. Past Bright Data winners made Bright Data a named, visible step in the pipeline; tag-only entries did not win (10, section 4d).

| Option | Verdict |
|---|---|
| A. Enter RecallRadar in Data for Good instead. It was built for this track: all OfferUp requests go through Bright Data Web Unlocker, and every verdict shows its source. | **Recommended**, if the rules let one solo builder submit two projects and present both (unknown, see Open questions). |
| B. Bolt on web data (scrape the San Diego County CAHAN drug supply alerts to change the call's wording). | Reject. Report 12 scores the fit 2 of 5: the page loads with plain curl, so Bright Data would be decoration, and it costs build hours tonight. |
| C. Enter Breathing Sonar anyway. | Reject. A judge sees no web data. Wastes a judge slot and invites a "claims not backed" mark. |

Note: RecallRadar currently sits in `breathing-sonar/recall-radar/` too. Whether a second Devpost entry needs its own repo link: unknown.

---

## 2. Live demo run-of-show

**Changed after review (2026-11-14 23:30):** no hand or body movement between Start and the hold. Movement makes the detector pick its distance again about 32 s later and restart its "normal level", which can swallow the hold. So: phone handed over before Start, sonar view opened in the first 10 s, hold no earlier than 35 s after "Watching". The `h` label key is also a hand movement: in rehearsal, press it only if you accept that risk. Not tried live.

### Physical setup (do once at the table, check before each judge)

| Item | Setting | Source |
|---|---|---|
| Presenter | Seated, chest square to the screen, 30-40 cm from the laptop. Same spot every run: tape a mark on the table for the laptop and the chair. | README |
| Laptop | Lid at the same angle as tonight's working takes (angle: unknown, measure it tonight and write it here). | |
| Speaker | Unmuted, no headphones, no Bluetooth speaker. System volume: the value used in tonight's good runs (unknown, write it here). The probe loudness now sets itself at start (untested live). | facts |
| Mic Mode | macOS Control Center > Mic Mode > Standard. Re-check after every reboot. | README |
| Sound mode | Alarm sound ON (not quiet mode), so the judge hears the beeps in a noisy hall. | app.js |
| Friend's phone | Builder's own phone, entered as "friend". Ringer on, volume max, Do Not Disturb off, screen unlocked. Hand it to the judge before the hold. | |
| Judge position | To the side of the laptop, behind the screen line, about 1 m or more away. Not behind the presenter. Not measured on real audio: rehearse with a second person tonight. | unknown |
| Table | Ask for a spot against a wall or corner, away from the walkway (availability: unknown). Presenter's back to the wall if possible. | |
| Call path | Local: `Start Demo.command` window shows `Ready: POST http://127.0.0.1:8788/call`. Or hosted Vultr server reachable. Laptop online (venue Wi-Fi, phone hotspot as backup). | README |
| Contact details | Already saved, so the app opens on "Sit like this". Place set to "the Qualcomm Room in Jacobs Hall" or similar. | |
| Backup | 60 s backup clip open in a paused video player on the laptop, and a copy on the phone. | |

### Rule between judges

Do not leave it watching while you stand or talk to passers-by. An empty chair alarms in about 17-22 s (3 of 3 walk-away takes) and would phone you. Press Stop between judges. Start again when a judge arrives.

### Timeline (t = 0 when you press Start)

The 32 s lock-on is covered by the opening lines. You talk while it locks.

Unknown: whether talking during lock-on or during "Watching" hurts the lock or the hold detection. Rehearse this exact script tonight and replay the saved take (checklist item 5). If talking breaks it, switch to Plan B: start, say "It needs half a minute to find me, so I'll stay quiet", sit still for 32 s, then continue.

| t | On screen | Presenter does / says (word for word) |
|---|---|---|
| before | Contact screen | Hand the phone to the judge BEFORE pressing Start: "You're my friend. When this rings, answer on speaker. Please don't touch the laptop, any key cancels." |
| 0:00 | "Sit like this" > press Start > "Finding your breathing." with progress bar | Sit at the tape mark. Press Start, then press **s** (sonar view) within 10 s, then hands in lap and do not move them again. "This laptop is listening for my breathing, using sound. If my breathing stops and I don't answer, it phones a friend." |
| 0:08 | "Finding your breathing." | "Three out of four people who die of an overdose are alone when it happens. No one is there to give naloxone or call 911. This uses only a laptop. No wearable, no install." |
| 0:20 | "Finding your breathing." | "The speaker plays a sound at 20 kilohertz, too high for most adults to hear. The mic hears the echo off my chest. It takes about half a minute to find me." |
| ~0:32 | "Watching your breathing. [Friend] gets a call only if it stops." | Do not touch anything. "Now it's watching. This box is the distance where it found my breathing. This line is my chest moving, about a millimeter." |
| 0:45-1:10 | Sonar view, line moving | Keep still, keep talking (honest limits part of the pitch fits here). Wait until at least 35 s after "Watching" appeared. Then: "I'm going to hold my breath now." |
| ~1:10 | Line goes flat, strength bar falls | Breathe out, hold, stay still, hands in lap. Say nothing. |
| ~1:17 (typical 7 s, seen 0.2-21 s) | "Are you okay? Calling [Friend] in 6", beeps, voice "Are you okay? Tap the screen." | Keep holding. Do not touch anything. |
| ~1:23 | "Calling [Friend]." then "[Friend] is being called." | Breathe again. "It counted down six seconds. Nobody tapped, so it called." |
| ~1:23-1:33 (ring delay: unknown, measure tonight) | Phone rings in the judge's hand | "Go ahead, answer." |
| ~1:33-1:53 | Call on speaker | Let the voice play. It says the name, that breathing seems to have stopped, where, and to call 911 if they can't reach the person. |
| ~1:53 | "[Friend] is being called." | Tap "I'm okay, keep watching" or Stop. Go to the honest-limits part of the pitch (section 4). |

**Abort rule:** if no alarm by 20 s into the hold, breathe and say: "That's a miss. In our recordings it catches two out of three holds. Here's a recorded run." Play the backup clip. Do not retry more than once per judge.

---

## 3. Failure plan

| # | Failure | Sign you'll see | Fallback (say this, do this) |
|---|---|---|---|
| 1 | Speaker muted or too quiet | "Can't hear my own sound." (new, untested live). Older failure: "Watching" with a flat line that does not move when you breathe. | Before each judge: breathe deeply and check the line moves. If not: unmute, volume up, Stop, Start. If the message never appears but the line is flat, trust the line. |
| 2 | No lock | Still "Finding your breathing" after 45 s, or "Can't find you." | Sit square at the tape mark, stay still, Stop and Start once. Second failure: play the backup clip. |
| 3 | False alarm from a passer-by or your own movement | "Are you okay?" while you are breathing | Tap the screen. Say: "That's a false alarm. Someone moved near it. That's exactly why there is a six second 'I'm okay' before any call." Then continue. It is a real behaviour, show it, don't hide it. |
| 4 | Missed hold | No alarm by 20 s into the hold | Abort rule above. Say the miss rate plainly. Play the backup clip. |
| 5 | Call server down or no internet | Screen: "The call did not go through." with the friend's number in large text | "The call failed here, so it shows the number for anyone nearby to dial. Here's a recorded call." Play the backup clip from the ringing part. Fix between judges: check the `Start Demo.command` window, switch to phone hotspot, test with `python3 call/server.py --test <your number> --name Sam --user Alex --place "the hall"`. |
| 6 | Loud hall / crowd | Frequent false alarms, no lock, or a line that jumps | Move the judge to the side, lean closer (30 cm), ask passers-by to step back. If two runs fail in a row, run the rest of the session from the backup clip and say why: "It has not been tested in a crowded room. Here is a run from a quiet room." |

**Backups to prepare tonight:**
- **Backup clip (60 s, one unbroken shot):** Start > Watching > sonar view open > hold > alarm > countdown > phone ringing and the voice playing. Phone visible in frame. Unbroken so it is clearly real.
- **Replay of a recorded take (questions only, not the demo):** `node tools/replay-take.js data/take-<id>` runs a saved recording through the same detector code and prints alarm times. Use it if a judge asks "how did you measure that?". Pick the take tonight. Judges dislike terminals during the pitch (05, section 2), so keep it for the questions.

---

## 4. The pitch

Number used: **75.5% of US overdose deaths in 2022-2024 happened when the person was alone** (CDC SUDORS, n=191,577). Source: `sandhacks/research/reports/08_vitals_need.md`, line 31.

### 30 second version

"Three out of four people who die of an overdose are alone when it happens. Nobody is there to call for help.

Breathing Sonar turns a laptop into a breathing monitor. The speaker plays a sound too high to hear, and the mic listens to the echo off your chest. If your breathing stops and you don't tap 'I'm okay' within six seconds, it phones a friend with a voice message that says where you are.

It runs in a browser tab. No wearable, no install. It's a prototype, tested on breath holds by one person, and it catches two out of three in our own recordings."

### 2-3 minute version (the live demo is section 2; this wraps around it)

**Problem (0:00-0:20)**
"Three out of four people who die of an overdose are alone when it happens. An overdose slows breathing, then stops it. If someone is there, they can give naloxone or call 911. If no one is there, no one knows."

**What it does (0:20-0:35, lock-on is running)**
"This laptop is watching my breathing with sound. If it stops and I don't answer, it phones a friend and tells them where I am. Nothing to buy, nothing to install. You open a web page."

**Live moment (0:35-1:35)**
Follow the run-of-show in section 2: sonar view, hand the phone over, hold, alarm, countdown, phone rings, judge answers.

**How it works (1:35-1:55)**
"The speaker plays a sweep from 20 to 22 kilohertz, and the mic records the echo. We split the echo by distance, find the distance whose motion repeats like breathing, and alarm when that motion drops to a quarter of your normal level for two seconds while you're still."

**Honest limits (1:55-2:25)**
"We recorded about an hour of audio, 19 takes, one person, one MacBook. Replaying those through the live code, it caught 20 of 30 breath holds, typically about 7 seconds after the hold starts. Those are the same recordings we tuned it on. On sitting-still breathing it mostly gave no false alarms, but moving causes them, which is why there's a six second 'I'm okay'. It needs about 30 seconds to find you first. It is not a medical device. We have never tested it on a real overdose, on sleep, or on anyone else."

**What's next (2:25-2:45)**
"Next: recordings from more people and more laptops, a real test of slow breathing, which often comes before breathing stops, and fewer false alarms from movement. A team at the University of Washington showed phone sonar for overdose in 2019. Ours runs in a browser, finds you by itself, and calls a friend."

---

## 5. Honest-claims table

| We can say | We must not say | Fact it rests on |
|---|---|---|
| "Caught 20 of 30 breath holds in replays of our own recordings, the same ones we tuned it on. 17 of 22 guided holds once it had found the person." | "It detects overdoses." / "90% accurate." / any single accuracy % without the denominator / "13 of 14" without saying it is five chosen takes | 19 takes, one person, one MacBook; `node tools/fit/baseline.js` at `73febb3` |
| "Typically about 7 seconds from hold to alarm, sometimes up to 20." | "Alerts in seconds, every time." | Median 7 s, range 0.2-21 s |
| "It needs about 30 seconds after Start to find you, and it starts over if you move." | "Instant." / "Works the moment you open it." | 32 s lock-on; 0 of 3 holds caught before it; movement triggers a new pick 32 s later |
| "Some misses we can't explain yet: the echo at the watched distance doesn't drop." | "Every miss was a setup problem." | Unexplained misses |
| "Few false alarms when sitting still; moving causes more. The 6 s countdown handles that." | "No false alarms." | 0 on 4 of 5 clean takes, 2 on the fifth, more with movement |
| "If you walk away, it treats the empty room as not breathing and alarms after about 17 to 22 s." | "It knows when you leave." | 3 of 3 walk-away takes after lock-on: 16.8, 16.9, 22.0 s |
| "It watches for breathing stopping." | Any breaths-per-minute number. "It measures your breathing rate." | Rate reads about 4/min during normal breathing |
| "A slow-breathing alarm is built but not yet tested on real slow breathing." | "It catches slow breathing before it stops." | Never tested on a real slow-breathing recording |
| "It now warns when it can't hear its own sound." (if tested live tonight; otherwise "we just added a warning") | "It can't fail silently." | Muted-speaker silent failure; fix untested live |
| "It phones a friend with a voice message." | "It texts your friend." / "It calls 911." | Texting off (A2P); call works |
| "Tested on one person, one MacBook, in a quiet room." | "Works on any laptop / any person / anywhere." | Never tested on another person, laptop, noisy hall |
| "Prototype. Not a medical device." | "Prevents overdose deaths." / "Saves lives." | Not a medical device; never tested on an overdose or sleep |
| (none) | Simulated accuracy numbers | Simulator does not yet reproduce the detector |

Note: the sonar view shows a "Rate ... / min" line (`app/judge.js:72`). Do not point at it. If asked, say it's not reliable yet.

---

## 6. Hardest judge questions

| Question | Short answer |
|---|---|
| **How accurate is it?** | "On replays of our own recordings, 20 of 30 breath holds, about 7 seconds to alarm. One person, one laptop, and the same recordings we tuned it on. Some misses are holds before it had found me, some are takes with audio dropouts or hand movement, and some we can't explain yet. That's not enough to rely on; it's enough to show the idea works." |
| **What about false alarms?** | "Sitting still, zero on four of our five clean takes and two on the fifth. Moving causes more. That's why there's a six second 'I'm okay' before any call, and any tap or key cancels." |
| **Privacy: is it recording me?** | "The sonar runs in the browser tab. No audio leaves the laptop. Names and numbers stay in the browser. Only when it calls, it sends the names, numbers, place and location to our call server, which passes them to ElevenLabs and Twilio to make the call." |
| **Why not a wearable, or an existing app?** | "Wearables cost money and have to be worn and charged. Existing tools like Never Use Alone or timer apps need you to call or check in each time. Phone sonar was shown by UW's Second Chance in 2019, but we found no public version (report 12). This runs on a laptop you already have, with nothing to install." |
| **What happens in the real world?** | "Unknown. We haven't tested an overdose, sleep, another person, or a noisy room, and it only works while you stay in front of the laptop. The next step is recordings from more people and laptops, and a real slow-breathing test. It would also need harm reduction groups to say if people would actually use it." |

---

## 7. Checklist (time order)

Times are a proposal. 🎥 = needs the builder to record or film. Hacking space closes 10 PM (9 PM per FAQ), reopens 7 AM (01).

### Tonight

1. Live-test the two new fixes. Mute the speaker, press Start: does "Can't hear my own sound" appear? Unmute: does it lock? Write down the result (pass/fail). Without this, do not claim the fix.
2. Write down the working setup: system volume value, lid angle, distance. Fill in section 2's table.
3. Check Twilio balance and whether it's a trial account (trial calls only reach verified numbers). Place one test call with `--test`.
4. Measure the ring delay: time from "Calling" on screen to the phone ringing.
5. 🎥 Rehearse the exact section 2 script 3 times, talking out loud during lock-on. Press h at the hold start, press Stop after each run (saves the take). Replay each with `node tools/replay-take.js`. This answers "does talking hurt it?".
6. Rehearse once with a second person walking behind you at about 1 m (if anyone is available). Note what happens.
7. 🎥 Record the 60 s backup clip (one unbroken shot, phone in frame). Copy it to the phone.
8. Pick the take for the questions-only replay. Run it once to confirm the output.
9. Decide on Bright Data / RecallRadar after asking organizers (Open question 1).

### Sunday morning

10. **7:00 AM. Hard cut-off for code changes.** After this: no code, only docs, Devpost text and video. If something breaks after 7:00, use the backup clip, don't patch.
11. 7:00-7:30. Re-run the setup checklist (Mic Mode, volume, call server) and one full rehearsal on the final code.
12. 🎥 7:30-9:30. Film the 3-minute video (required). Update `video-script.md` first: replace the old results card (5 of 5, 10 of 16) with 20 of 30 (17 of 22 guided holds after lock-on), and remove the rate claim. Film in a quiet room. Keep the alarm-to-ring part unbroken.
13. 9:30-10:30. Edit, upload video (public), get the link.
14. 10:00-10:45. Update `devpost.md`: results section (old numbers: 10 of 16, 17 false alarms, 6 recordings), remove "count breaths per minute" (README "How it works") and "too slow" as a working feature, add the 32 s lock-on and the honest-claims wording. Pick tracks (section 1).
15. **11:00 AM. Initial submission** (required placeholder): title, repo link, video link, tracks.
16. 11:00-11:45. Final text pass against the honest-claims table. Check the repo has no commits after noon and none before Sat 10:30 AM.
17. **11:45 AM. Final submission.** (Deadline 12:00 PM. Devpost header says 1:00 PM, rules say noon: use noon.)
18. 12:00-12:30. Set up the table (section 2), one test call, one dry run, then Stop.
19. 12:30-2:30. Judging. Stop between judges. Charge laptop and phone.

---

## 8. Open questions for the builder

1. **Can one solo builder submit two projects and be at both tables during judging?** If yes, RecallRadar goes in Bright Data. If no, skip Bright Data entirely. Ask the organizers tonight.
2. **Demo call through the local server or the Vultr server?** Vultr enters the Vultr track but adds a network hop. Pick one and rehearse only that path.
3. **May the "Rate" line in the sonar view be hidden before the 7:00 AM cut-off?** It shows an unreliable number on the screen judges look at.
4. **Who films the 3-minute video?** The existing script assumes two people (presenter and voice). If you are alone, it needs a tripod and a voiceover recorded separately.
5. **Will anyone else be at the table?** A second person could hold the phone and stop passers-by walking behind you. Changes the "who stands where" plan.
