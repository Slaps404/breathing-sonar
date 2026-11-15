# Calibrated simulation: what it is, what it shows, what it cannot show

State: 2026-11-14 night, detector at commit `73febb3`. One person, one MacBook, 19 recorded takes (about 65 min).
An independent review found errors in the first version of this page. They are fixed here and listed under "Corrections".

![How the fit and the test connect](../diagrams/sim-fit.svg)

## The system in one paragraph

Recorded takes are measured (motion level per distance slice, per speed band, per label). A simulated scene
(room + chest + events) is measured the same way, and its settings are changed until the two tables agree.
The detector's alarms are never part of that loop. The test is separate: run the live detector on the recording
and on simulated twins and compare the alarms. If the twins alarm like the recording, the simulation can stand
in for recordings. If not, it cannot.

## Result: closer, still not a stand-in for recordings

`node tools/fit/validate.js 12` (five clean guided takes, 12 twins each, round 9):

| Check | Recordings | Simulated twins |
|---|---|---|
| Echo motion levels (what was fitted) | | 3-6 dB rms off |
| Holds caught, holds the fit never measured (held out) | 10 of 10 | 63% of 120 |
| Holds caught, each take predicted from the other four | 13 of 16 | 60% of 192 |
| Holds before lock-on (seen part) | 3 of 6 | 42% of 72 |
| Watched distance within 6 cm of the recording | | 40% of twins |
| Time to alarm when caught | about 7 s | about 8 s (off by 3.4 s per hold, median) |
| Level drop 8 s into a hold (`hold-shape.js`) | 8 dB | 5 dB |
| False alarms per minute | 0.12 | 0.11 |

Agrees: false alarm rate, time to alarm, missed holds before lock-on. Still short: twins catch about two thirds
of the holds the recordings catch, and lock on the same distance less than half the time.
So: no accuracy number from this simulation may be quoted. It can rank "better or worse" only for changes far
larger than this gap.

What the gap was, and is:
- Rounds 1-7 caught only 33%. Cause: a wrong input, not the model. The twins were told to breathe at about 4
  breaths/min, because that number came from the detector's own rate readout, which is wrong on these takes
  (finding 7). At 4/min the chest moves slower than the 0.15-0.6 Hz band the hold check listens to. Found by the
  review, confirmed here: fixed at 15/min, same everything else, 63%.
- The remaining gap (63% vs 10 of 10) is not explained. The twins' level drops 5 dB where recordings drop 8 dB.
  Candidates, untested: the real breathing rate of each take (15/min is assumed), a deeper breath just before a
  guided hold, motion that is correlated across neighbouring slices.

## What the loop found in the recordings (these stand without the simulation)

| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | The app said "Watching" with no probe sound in the mic (speaker muted). A 27 s hold raised no alarm. | take `05-44-51`: probe -2 dB, all others 32-72 dB | Fixed: status "Can't hear my own sound". `node tools/fit/check-deaf.js` |
| 2 | One silent mic frame turned the running signal strength into NaN for good. | `cir()` returned -Infinity | Fixed in `dsp.js` |
| 3 | App played the probe at 0.7 and carried 17 dB more audible sound (16-19.5 kHz) than recorder takes at 0.15, same probe level in the mic. | spectrum of 3 recorder and 2 app takes | Changed: loudness sets itself at start. Not tried live |
| 4 | Holds that start before or within 10 s of lock-on (32 s): 0 of 3 caught. After lock-on: 17 of 22 on all guided takes, 13 of 14 on the five clean ones (a chosen subset: it leaves out the dropout take, 2 of 5, and the fidget take, 2 of 3). | `node tools/fit/baseline.js`, `holds.js` | Demo rule: hold only well after "Watching" |
| 5 | A hand reaching for the keyboard can show in the echo: one hand-pressed mark has a 28-42 dB burst at 6-29 cm (take `22-17-05`, 430 s). Other hand-pressed marks show 0-14 dB. Guided takes are flat at the marks. | `node tools/fit/keypress.js` | Use guided takes for measuring |
| 6 | Take `23-20-21` has 125 audio dropouts (20 dB one-second spikes). | take metadata `xruns`, `keypress.js` | Leave out of tuning |
| 7 | The breaths-per-minute number reads about 4/min on most takes while breathing normally. | detector trace on 6 takes | Do not show or claim a rate |
| 8 | The uncommitted "pick the closest slice" version at 22:12 cut caught holds from 17 of 27 to 12 of 27 (same 27 holds). The version committed after it does not have that loss. The current 20 of 30 includes a new take (3 holds, 2 caught), so it is not comparable with 17 of 27. | replay of three detector versions | Resolved by `25b3807` |
| 9 | Muting the speaker mid-run looks like breathing stopping. The app alarmed and would have phoned while the screen said "Not watching". | review replay: alarm 8-11 s after a mute, 3 of 3 takes | Fixed in `73febb3`: no alarm while the probe is not heard. Not tried live |
| 10 | Any hand or body movement after lock-on makes the detector pick its distance again about 32 s later and start its "normal level" over. A hold in that window can be missed. | code path `pickZone` / `setZone`; take `23-20-21` (hold 30 s after moving: 2 of 5); review replay with a simulated hand: 13 of 14 falls to 6 of 14 | Demo rule: no movement after Start, hold at least 45 s after the last movement |

## What we can do now

- Replay any detector change on all takes in 15 s: `node tools/fit/baseline.js` (holds caught, time to alarm, false alarms, lock distance per take). Compare versions: `DSP=/path/to/other-dsp.js node tools/fit/baseline.js`.
- Per hold, see whether the drop is visible at any distance: `node tools/fit/holds.js`.
- Check a take for no-signal, dropouts, hand bursts before trusting it.
- Use the simulation for plumbing only: does an alarm fire at all on an ideal scene, does a new status or guard behave, timing of lock-on.
- State with evidence: 20 of 30 labeled holds caught on recordings; 17 of 22 guided holds after lock-on; about 7 s to alarm (0.2 to 21 s); 2 false alarms in 17 min of sitting still on the five clean takes. Always add: same recordings the thresholds were tuned on, one person, one laptop.

## What needs more data (and which recording answers it)

| Question | Why current data cannot answer | Recording needed |
|---|---|---|
| Does it work on another person or laptop? | 1 person, 1 MacBook | 3+ people, 2+ laptops, guided plan `normal 60, hold 20, x4` |
| Noisy hall, people walking past? | all takes in quiet rooms | same plan at the venue, with a walker at 1 m and 2 m |
| What separates a caught hold from a missed one after lock-on? | 1 unexplained miss on clean takes, more on messy ones | 20+ guided holds of 20 s, hold starting after 60 s, hands in lap |
| Is a hold seen as "breathing stopped" or as "body froze"? | every hold so far is also a freeze | holds while slightly fidgeting (the new `fidget` label), and stillness while breathing shallowly |
| Slow breathing (the overdose pattern)? | no slow-breathing take exists | paced takes at 6 and 4 breaths/min |
| Real hold after moving back? | no take has one | `normal 60, moving 10, normal 45, hold 20` |
| Sleep, lying down, real overdose | never recorded | out of reach for this weekend. Say so |
| Why twins still miss a third of the holds recordings catch | the real breathing rate of each take is unknown (15/min assumed) | guided takes where breaths are counted out loud or marked, plus the 20+ guided holds above |
| What is the real breathing rate? | the rate readout is wrong, no ground truth exists | one take breathing to a metronome at 12/min and one at 20/min |

## Rounds (what changed and why)

| Round | Change | Reason | Held-out holds caught by twins |
|---|---|---|---|
| 1 | point reflectors + empty-room background | first model | 33% (no split yet) |
| 2 | added the detector's rhythm score per slice to the target | twins locked at 46-114 cm, real 23-34 | 40% |
| 3 | background = each take's own hold levels, breathing added on top | shared body sway kept the chest noisy in holds | 46% |
| 4 | train/test split inside takes, leave-one-take-out; sway stops in holds | fit and test used the same audio | 33% |
| 5 | hold levels measured from 5 s after the label | first seconds still contain a breath | 33% |
| 6 | slow swings in level | real levels swing 10 dB, twins 6 | 37% |
| 7 | measured normal-time extra motion per slice | point reflectors could not fill all slices | 33% |
| 8 | breathing rate from the echo's best self-match lag instead of the detector readout | review: twins breathed at 4/min | 20% (estimate pegged at 34-38/min, also wrong) |
| 9 | breathing rate fixed at 15/min | no reliable estimate exists | 63% |

## Files

- `tools/fit/takes.js` loads takes, caches echo profiles, runs the detector. `measure.js`, `bands.js` measure.
- `scene.js` is the simulator (`check-scene.js` proves it equals the audio path). `fit.js` fits, `validate.js` tests.
- `holds.js`, `hold-shape.js`, `keypress.js`, `baseline.js`, `check-deaf.js`, `compare.js` are the diagnostics above.
- `docs/sim/measured.json`, `fitted.json`, `validation.json`, `baseline.json` are their outputs.

## Corrections after review

- The first version blamed the model for the 33%. The cause was the 4 breaths/min input (rounds 1-7). Its
  "candidate causes" section rested on that error.
- "13 of 14 after lock-on" was quoted without saying it is five chosen takes. All guided takes: 17 of 22.
- "17 of 27 to 20 of 30" compared different sets of holds.
- All seven rounds were tuned while looking at the held-out results, so "held out" is weaker than it sounds.
  The leave-one-take-out row is the more honest one.
- The 17 dB audible-sound figure (finding 3) is the top of a 9-17 dB range across takes, system volume unknown.

## Assumptions

- The simulated person breathes at 15/min. Not measured.

- Hold labels are when the banner changed, not when breathing stopped.
- Non-breathing motion is the same in holds and in normal breathing (round 3). Round 4 showed this is doubtful.
- Background fluctuation is independent between slices. Real slices are correlated.
- Five takes, one sitting each. A fit to five takes of one person is a description, not a model of people.
