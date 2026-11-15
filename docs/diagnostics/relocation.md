# Moving back while seated: what the two backtests show

Takes: `take-2026-11-15T02-49-27-995Z` (150 s) and `take-2026-11-15T03-06-03-072Z` (195 s). Plan: sit at about half an arm, move back to about one arm, sit. No distances were measured, so "40 cm" and "70 cm" are instructions, not ground truth. Chart: `relocation.html`.

## Findings

1. The body did move. Slow echo motion (0.15-0.6 Hz) is strongest at 40-46 cm before the move and at 75-97 cm after it, in both takes. Frame-to-frame motion and the still echo shift the same way.
2. The strong far echo is not shown to be breathing. Its spectrum has no line at a breathing rate. On four older takes with labeled breath holds, a strong echo at 74-91 cm does not drop during holds (0 to -4 dB), while 29-51 cm drops 5-14 dB. So "strongest slow motion" is not "breathing". A picker that follows power locked onto that echo and added false hold alerts (tested, rejected).
3. After the move, the clearest breathing-rate rhythm is still at 34-46 cm, about 12 dB weaker than before. Take 1: 26/min at 40 cm, 9.4 dB above median (best outside the zone: 6.6 dB). Take 2: 22/min at 34 cm, 11.5 dB (best outside: 9.7 dB at 23 cm). The post-move pick of 40 cm (zone 34-63 cm) contains it.
4. The real defect was the hold alert. The old zone lost about 12 dB after the move, which looked like a breath hold: false alerts 89-115.5 s and 103.1-129.3 s.

## Fix

`dsp.js`: between a body movement and the next pick, a hold alert may not start while any slice outside the watched zone still changes fast (12 dB above its own quiet floor within the last 10 s). Someone who only shifted distance keeps stirring in range. Someone who left does not, so the walk-away alarm stays.

## Results (replay of recorded audio, no live test)

| Take | Before | After |
|---|---|---|
| Backtest 1 | false alert 27 s | no alert, lock 34 then 40 cm |
| Backtest 2 | false alert 26 s | no alert, lock 34 then 40 cm |
| 3 walk-away takes | alarm 77-78 s | alarm 84-85 s (about 7 s later) |
| 4 seated hold takes | | identical |
| 23-20-21 (move, sit, hold x5) | 1 false alert, hold at 190 s caught after 6.7 s | false alert gone, same hold caught after 14.2 s |
| 22-17-05 (12 min mixed) | 10 false alerts, 2 of 3 holds | 3 false alerts, 1 of 3 holds |

`node tools/sim.js range`: unchanged (alert 47.4 s, latency 7.4 s, 0 false alarms).

Check: `node tools/check-relocation.js data/take-2026-11-15T02-49-27-995Z data/take-2026-11-15T03-06-03-072Z`. Fails on the previous code (alert), passes now.

## Limits

- The shown distance is where breathing rhythm is seen, not a measured chest distance. Why the rhythm stays at 34-46 cm after the body moves back is not established (hands, lap or abdomen near the laptop are candidates).
- Rhythm margins are small (2-3 dB), and take 2 shows no clear rhythm anywhere before the move.
- No take has a breath hold after a move. That is the recording needed to prove which echo stops when breathing stops.
- Cost: a real hold that starts within about 32 s after a body movement, while something else stirs in range, alarms late or not at all (one such hold lost in the 12 min take).
- The two new thresholds work for 12-22 dB and 8-15 s on these takes. 6 s fails backtest 1; 9 dB silences walk-away alarms.
