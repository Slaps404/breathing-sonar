# Hold alarm recovery experiment

Replay date: 2026-11-14. Eleven local labeled recordings, one person and one MacBook. Runtime unchanged.

Current behavior clears a hold alarm immediately on movement OR recovered breathing-band power. Candidate behavior requires no detected movement AND recovered power continuously for a configurable duration. This changes both the movement policy and duration; the zero-duration candidate separates those effects.

Reproduce from the repo root: `node tools/check-recovery-sweep.js -1` for baseline, then repeat with `0`, `0.4`, `0.8`, `1`, `1.5`, `2`, `3`. An optional second argument saves per-take results. Raw recordings are ignored by git. Saved results: `recovery-sweep.json`.

Premature clearing means an alarm-end event more than one second before a labeled hold ends. Alert time outside hold labels includes movement and empty-room labels, plus normal breathing. It penalizes normal recovery delay too. Hold catches count new alarm starts within each hold or two seconds afterward, matching the existing replay scorer; already-active alarms are not new catches. Recovery arrays are exploratory only: they include missed holds, find a later end event, and cap missing or late ends at 60 seconds. Do not interpret them as a recovery-latency estimate.

Baseline: four premature clears, about 223 seconds alerting outside hold labels. Removing movement-based clearing alone reduces premature clears to two but increases outside-hold alert time to 278 seconds. A 0.4-second confirmation gives two premature clears and 284 seconds outside holds. Longer confirmations do not reduce premature clears; at three seconds outside-hold alert time reaches 435 seconds. The two-second candidate has one additional new hold catch, but also longer false-alert exposure. No duration dominates all metrics.

Conclusion: no demonstrated ideal duration. 0.4 seconds is a short candidate for a labeled twitch experiment, not a validated runtime setting. No twitch timestamps exist in these recordings, so this sweep cannot establish twitch rejection. Sustained breathing-band power can also come from a movement artifact; duration alone does not prove breathing resumed. Collect twitches during holds and real return-to-breathing labels before selecting a runtime policy.
