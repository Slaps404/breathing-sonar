# Leaving versus breath holding

Reproduce: `node tools/check-departure.js > docs/departure-results.json`.
The script replays the committed detector (revision included in output), so unrelated working edits do not change the experiment.

Candidate: suppress an alarm after enough movement in the preceding 20 seconds.
Three leaving recordings have about 9-11 seconds of movement before their empty-room alarm. One detected breath hold has 8.53 seconds. A cutoff tuned between those values separates these examples, but has less than half a second of margin. A cutoff of 8 seconds suppresses a real hold. This is insufficient evidence to use movement as proof of absence. The analysis scores only existing alarm starts; it does not solve missed holds or prove absence throughout the empty segment.

The latest walkaway1 audio lasts 114.82 seconds, including about 47 seconds after the empty-room label. Its early ending limits later analysis but includes the departure and alarm.

Echo distance is not body identity. The range profile contains overlapping echoes from the person and room. The current picker selects breathing-like periodicity and signal strength, not a tracked body reflector. A new distance can therefore mean a different object was selected. Distance-based departure needs a continuous body-echo track, with confidence and an explicit unknown state when that track is lost.

Review next:
- Track continuity: show the same reflector moving away, rather than switching objects.
- Sideways exits: distance may barely change before the echo disappears.
- Fidget then hold: recent motion must not hide a hold.
- Empty-room startup: no prior body track exists to compare against.

No runtime alert behavior was changed by this experiment.
