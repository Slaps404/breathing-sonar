# Hold alarm: a twitch must not count as resumed breathing

## What broke

Take `take-2026-11-15T03-09-51-923Z`: three 15 s holds (still, one shoulder twitch, two twitches). In the second hold (105.0-120.1 s) the alarm started at 108.8 s and cleared at 115.9 s, 4 s before breathing resumed.

Cause, from the trace: the movement flag stayed off. The breathing-band level rose from 6.6 dB to 15.1 dB and crossed the "level is back" line (normal minus 3 dB). The raw echoes show why. From about 112 to 117.5 s the chest zone moved as much as it does in normal breathing, then went still again. The level is measured over 8 s, so that one 5.5 s burst reads as "breathing is back" for 4 more seconds. A timer on the level cannot fix this (see `recovery-sweep.md`: even 3 s still cleared inside the hold).

Within the burst, the echo pattern across distances matches normal breathing. Strength and pattern do not separate them. Duration does: breathing keeps going, a twitch stops.

## The fix

Recovery now needs two things: the level is back (as before) AND the motion is sustained.

Sustained motion S (in `holdFeatures`): how far the zone's echoes move per second, taken at the quietest quarter of the last 8 s. It is high only if about 6 of the 8 s had motion. S is compared with its own normal (75th percentile of the last still minute, same as the level). It must be within 3 dB (`HOLD.sustainQ`, `HOLD.sustainDb`). Movement still clears the alarm at once. Alarm starts are untouched.

## How the numbers were chosen

Measured on the first 14 takes, old rule, ticks where the person was still:

| Situation | S below its normal (dB) |
|---|---|
| Normal breathing | median 0.5, 90% of ticks under 3.7, 95% under 6.7 |
| Twitch hold, while the level said "back" | at least 7.0 |

Every threshold from 2 to 6 dB removes the twitch clear. First commit used 4 dB. The generalization checks below moved it to 3 dB: about 1 s slower recovery, bursts tolerated 1-2 s longer, 4 dB of room on the twitch.

Replay of all 17 takes (`node tools/backtest-recovery.js`, 26 labeled holds; full rows in `sustained-recovery.json`):

| Setting | New hold catches | Clears inside a hold | Alarm on during holds (s) | Alarm on during normal breathing (s) | False starts | Recovery after a hold (s) |
|---|---|---|---|---|---|---|
| Old rule | 17/26 | 7 | 132 | 96 | 14 | 4.6 2.0 1.5 3.7 1.4 3.4 3.9 3.5 3.9 |
| Shipped (quarter, 3 dB) | 17/26 | 5 | 149 | 123 | 12 | 6.1 4.3 3.2 3.7 1.8 6.0 7.9 7.1 7.1 3.9 |
| quarter, 4 dB | 17/26 | 5 | 147 | 119 | 12 | 5.0 4.1 2.6 3.7 1.4 5.8 7.7 7.1 6.5 3.9 |
| quarter, 6 dB | 17/26 | 5 | 144 | 108 | 13 | 4.6 3.2 1.5 3.7 1.4 4.1 7.1 6.9 5.0 3.9 |

The twitch take: old rule alarms 72.4-78.5, 108.8-115.9 (wrong clear), 123.1-126.8 (false alarm in normal breathing), 150.2-169.0. Now 72.4-81.1, 108.8-128.0, 150.2-172.2: one alarm per hold, none cleared early, no false alarm. Seated take `02-54-00`: 3/3 holds, 0 false alarms, as before. Move-back takes (`check-relocation.js`), zone stability checks and `sim.js range` (47.4 start, 62.2 end): unchanged.

## Does it generalize

Four checks beyond the take it was fitted on.

1. A take recorded after the setting was fixed (`03-40-26`, far distance, no twitch asked). Old rule: second hold alarms at 202.3 s and clears at 204.6 s, inside the hold. New rule: one alarm, 202.3-214.0 s, cleared 3.9 s after the hold ended. Not tuned on this take.
2. Simulator (`tools/simlib.js`), chest 5 mm at 15/min, twitch 12 s into a hold: 48 twitches (bump or lasting shift, 1-5 mm, 0.5-8 s). Old rule clears early on 16, new rule on 2. Those 2 are fast 5 mm jerks that trip the movement flag, which clears by design.
3. Simulator, true recovery at 6 to 30 breaths/min and 1 to 5 mm: the alarm clears in every case, 0-3.8 s later than the old rule.
4. Transplanted bursts (`node tools/inject-burst.js`): d seconds of the take's own breathing motion added to five real, alarmed holds in two other takes. Longest burst the alarm survives, burst placed 0.5 s / 3 s into the alarm:

| Hold | Old rule | Shipped |
|---|---|---|
| `22-41-04` 130-150 s | 1 s / 1 s | 4 s / 4 s |
| `22-41-04` 180-200 s | 2 s / 2 s | 5 s / 4 s |
| `22-41-04` 230-250 s | 3 s / 2 s | 4 s / 4 s |
| `02-54-00` 60-75 s | 1 s / 0 s | 1 s / 1 s |
| `02-54-00` 210-225 s | 6 s / 6 s | 6 s / 6 s |

Reading: never worse than the old rule, usually 2-3 s better. Not immune. A burst as strong as breathing that lasts 5 s or more is one full breath to the sonar, and it clears the alarm. In `02-54-00` 60-75 s the hold is only a few dB quieter than breathing on this measure, so the test adds little there. Tried and rejected: averaging the motion over 1-4 s chunks, other quantiles, longer windows (10, 12 s: recovery up to 16 s), counting only motion after the alarm began. None separated holds from breathing better across takes.

## Live app takes after the fix (HEAD 6523862, 4 dB)

`take-2026-11-15T03-48-33-705Z`, one hold marked at 64.3 s. From the per-tick trace:

- False alert 54.7-58.3 s: the breathing level fell 6-7 dB below normal for 2 s while the person was breathing. No movement. Normal was only 22 s old (zone locked at 32.3 s). Sustained motion was 3.9 dB under normal, so it did not look like a hold on that measure, but only by a hair.
- Late alarm (85.2 s, 20.9 s in): fast echo change rose 9.3 dB above its floor at 60.4-62.5 s, just under the 10 dB "moving" line, so it was not flagged. That motion sat in the 8 s window and kept the level 9-11 dB above normal until 70 s. The level then stayed only 1-4 dB under normal from 71 to 82 s (one 0.4 s dip at 74.9 s). It fell for good at 83 s. Earliest possible alarm given the motion at 60-63 s: about 73 s.
- Cleared at 89.0 s: 0.6 s after the alarm began, fast echo change rose 7-8.5 dB above its floor and stayed there until 90.3 s (again under the "moving" line). A slice outside the zone stirred too. The level went 11 dB above normal, and after 3.8 s the motion counted as sustained. The old rule would have cleared at 86.2 s. This is body movement for 4.5 s, not a twitch.

Shared cause of the late alarm and the clear: body movement a little under the "moving" line. It is not flagged, and it fills the breathing band. The false alert is a different cause: a natural dip in a zone that sees breathing weakly (quality 0.12-0.49, no rate at any tick).

`take-2026-11-15T04-01-44-353Z` (hold label 44-182 s): alarm 50.8 s, cleared 58.9 s after fast echo change rose 3-4.6 dB at 55.5-57.2 s; flagged movement follows at 63.8 s. Same pattern. A 138 s label is not a still breath hold, so this take is weak evidence.

Not known: whether the user moved in reaction to the alarm appearing. Both clears begin 0.6-4.7 s after the alarm starts.

Tried for the false alert: also require low sustained motion to start an alarm. At 4 dB it removes this false alert and one other, keeps all 17 catches, and delays two catches by 2-3 s. It was not shipped: this false alert sits 0.1 dB from that line, and 5 dB loses two catches.

## Cost and limits

- Slower recovery: typical 3.5 s to about 6 s after a hold ends, worst 4.6 s to 7.9 s. `COUNTDOWN_S` in `app/app.js` is now 6 (commit 6523862). An alarm that starts and clears within 6 s never reaches the call. So recovery after a real hold will rarely beat the countdown under either rule, and a wrong clear inside 6 s cancels a call that should happen. The fix removes two such clears (115.9 s is 7.1 s after its alarm, 204.6 s is 2.3 s after).
- Five clears inside holds remain: `22-17-05` 252 s and `23-20-21` 275.5 s (the zone does not see those holds), `03-40-26` 153 s (the slow-breathing alarm ending, not this rule), and the two live takes above (body movement).
- Movement under the "moving" line for about 4 s or more still clears the alarm.
- One person, one MacBook. One real marked twitch. 9 of 26 holds are missed (unchanged).
- Replays and simulation only.

## Checks

- `node tools/check-twitch-recovery.js`: fails on the old rule ("alarm cleared at 115.9 s, inside the hold 105.0-120.1 s"), passes now. Covers made-up signals (jolt vs breathing vs gross movement), the twitch take, and movement clearing on take `23-20-21`.
- `node tools/backtest-recovery.js`: the replay table.
- `node tools/inject-burst.js`: the burst table.
- `tools/check-recovery-sweep.js` stops with an error if the runtime line it replaces is gone.

Review next:
- Movement just under the "moving" line: it delays alarms and clears them. This is the main finding from the live takes.
- A live hold where the person stays still after the alarm appears, to separate "reacted to the alarm" from a detector fault.
- Zone quality: both live takes watched a slice with no readable breathing rate.
