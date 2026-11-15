# Twitch recovery replay

Recording: `data/take-2026-11-15T03-09-51-923Z` (180.18 s, no recorder dropouts). User reports following the three-hold protocol exactly: still first hold, one midpoint twitch second hold, two midpoint twitches third hold. Actual twitch instants are approximate protocol annotations, not separately timestamped labels.

Reproduction: `node tools/replay-take.js data/take-2026-11-15T03-09-51-923Z`. Sweep: run `node tools/check-recovery-sweep.js <seconds> <output.json>` for -1 (current behavior), 0, 0.4, 0.8, 1, 1.5, 2, 3. This replays all available recordings; extract this take from the result. Saved per-setting results: `twitch-recovery.json`. Runtime unchanged.

Current behavior starts alerts at 72.36, 108.84 and 150.23 seconds. The second alert ends at 115.88 seconds, during the labeled hold (105.045-120.064 s), after the expected midpoint twitch near 112.55 s. It then starts another alert during normal breathing at 123.14 s. The third onset is only 0.17 s after its label: scoring all three holds as caught overstates useful detection, because the eight-second feature window is mostly pre-hold audio at that instant.

A targeted trace through holdStep found movement false throughout 110.12-120.79 s. Breathing-band level rose from about 6.6 dB at 113.11 s to 15.1 dB at the 115.88 s cancellation, crossing the approximately 14.9 dB recovery threshold. It remained elevated until about the end of the hold. Thus the immediate cause is the breathing-power recovery condition, not movement-based clearing. Its timing is consistent with the protocol twitch contaminating the eight-second spectral window; a repeated take with precise twitch timestamps is needed to strengthen that attribution.

Every still-recovery confirmation from zero through three seconds still cancels prematurely in hold two. Three seconds moves the cancellation to 118.87 s, still before normal breathing resumes at 120.064 s. The 0.4-second candidate therefore does not solve this reproduction. Increasing duration also delays genuine recovery after the first, still hold.

Review next:
- Recovery evidence: distinguish resumed breathing from a single jolt spread across the analysis window.
- Detection timing: investigate the near-instant third-hold alert and post-hold false alert separately.
- Repeatability: repeat with precise twitch markers before tuning or claiming a robust fix.

No runtime policy was changed. These are detector replays, not a live app or call test. One take does not establish general twitch tolerance.
