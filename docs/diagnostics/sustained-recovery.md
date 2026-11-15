# Hold alarm: a twitch must not count as resumed breathing

## What broke

Take `take-2026-11-15T03-09-51-923Z`: three 15 s holds (still, one shoulder twitch, two twitches). In the second hold (105.0-120.1 s) the alarm started at 108.8 s and cleared at 115.9 s, 4 s before breathing resumed.

Cause, from the trace: the movement flag stayed off. The breathing-band level rose from 6.6 dB to 15.1 dB and crossed the "level is back" line (normal minus 3 dB). The raw echoes show why. From about 112 to 117.5 s the chest zone moved as much as it does in normal breathing, then went still again. The level is measured over 8 s, so that one 5.5 s burst reads as "breathing is back" for 4 more seconds. A timer on the level cannot fix this (see `recovery-sweep.md`: even 3 s still cleared inside the hold).

Within the burst, the echo pattern across distances matches normal breathing. Strength and pattern do not separate them. Duration does: breathing keeps going, a twitch stops.

## The fix

Recovery now needs two things: the level is back (as before) AND the motion is sustained.

Sustained motion S (in `holdFeatures`): how far the zone's echoes move per second, taken at the quietest quarter of the last 8 s. It is high only if about 6 of the 8 s had motion. S is compared with its own normal (75th percentile of the last still minute, same as the level). It must be within 4 dB (`HOLD.sustainQ`, `HOLD.sustainDb`). Movement still clears the alarm at once. Alarm starts are untouched.

## How the numbers were chosen

Measured on all 14 takes, old rule, ticks where the person was still:

| Situation | S below its normal (dB) |
|---|---|
| Normal breathing | median 0.5, 90% of ticks under 3.7, 95% under 6.7 |
| Twitch hold, while the level said "back" | at least 7.0 |

The threshold 4 dB sits between: 3 dB of room to the twitch, and normal breathing passes about 90% of the time. With the quietest 15% the twitch gap is 8.2 dB, with the quietest half only 4.4 dB.

Replay of all takes (`node tools/backtest-recovery.js`, 22 labeled holds; full rows in `sustained-recovery.json`):

| Setting | New hold catches | Clears inside a hold | Alarm on during holds (s) | Alarm on during normal breathing (s) | False starts | Recovery after a hold (s) |
|---|---|---|---|---|---|---|
| Old rule | 13/22 | 3 | 111 | 34 | 10 | 4.6 2.0 1.5 3.7 1.4 3.4 3.9 |
| Shipped (quarter, 4 dB) | 13/22 | 2 | 118 | 48 | 9 | 5.0 4.1 2.6 3.7 1.4 5.8 7.7 7.1 |
| quarter, 6 dB | 13/22 | 2 | 118 | 44 | 9 | 4.6 3.2 1.5 3.7 1.4 4.1 7.1 6.9 |
| quarter, 2 dB | 13/22 | 2 | 118 | 57 | 9 | 6.5 5.0 3.4 4.9 3.1 6.2 8.6 7.1 |

All 15 settings tried (quietest 15%, 25%, 33% by 2-6 dB) remove the twitch clear. 6 dB recovers faster but leaves 1 dB of room on the only twitch example, so 4 dB was shipped.

The twitch take: old rule alarms 72.4-78.5, 108.8-115.9 (wrong clear), 123.1-126.8 (false alarm in normal breathing), 150.2-169.0. Now 72.4-80.9, 108.8-127.8, 150.2-172.2: one alarm per hold, none cleared early, no false alarm. Seated take `02-54-00`: unchanged, 3/3 holds, 0 false alarms. Move-back takes (`check-relocation.js`), zone stability checks and `sim.js range` (47.4 start, 62.2 end): unchanged.

## Cost and limits

- Slower recovery: typical 3.4 s to about 5 s after a hold ends, worst 4.6 s to 7.7 s. The 14 extra seconds of alarm during normal breathing are this delay. The call countdown is 15 s from the alarm start, so a hold that ends late in the countdown is more likely to place the call.
- Two clears inside holds remain (takes `22-17-05` at 252 s, `23-20-21` at 275.5 s, the latter 3 s later than before). In `22-17-05`, and in the missed holds of `22-41-04` and `00-15-23`, sustained motion during the hold is as high as in normal breathing: the watched zone does not see the hold at all. This fix cannot help there.
- A movement burst longer than about 6 s will still clear the alarm.
- One twitch example, one person, one MacBook. Twitch times were not marked. 9 of 22 holds are still missed (unchanged).
- Replays only. No live app or call test.

## Checks

- `node tools/check-twitch-recovery.js`: fails on the old rule ("alarm cleared at 115.9 s, inside the hold 105.0-120.1 s"), passes now. Covers made-up signals (jolt vs breathing vs gross movement), the twitch take, and movement clearing on take `23-20-21`.
- `node tools/backtest-recovery.js`: the table above.
- `tools/check-recovery-sweep.js` now stops with an error if the runtime line it replaces is gone.

Review next:
- Recovery delay vs the 15 s countdown: decide if 5-8 s is acceptable in the live app.
- A fresh take with marked twitch times and longer holds (30 s) to test the 3 dB margin.
- Missed holds: the zone, not the recovery rule.
