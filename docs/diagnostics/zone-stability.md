# Echo distance stability

The picker used relative rhythm scores to move an acquired zone even without detected movement. Three recorded takes reproduced nine such changes. The direct-path distance reference is fixed once at startup, so these jumps came from selection, not a moving reference.

The picker now collects one scoring window plus the existing settling time (about 32 seconds) before acquisition. After acquisition it requires detected body movement before changing zones. Manual selection remains fixed. This stabilizes selection; it does not establish that the selected reflection is the chest.

Verification: `node tools/check-zone-stability.js data/take-2026-11-15T00-15-23-440Z data/take-2026-11-15T02-37-55-422Z data/take-2026-11-14T22-41-04-642Z` fails with nine unprompted changes on the original code and passes on the fix. Two additional walk-side recordings pass, including reselection after movement. Raw recordings are local and ignored by git.

`node tools/sim.js range` preserves the baseline hold alert at 47.4 seconds, 7.4 seconds into the hold. Both versions report zero rateOK, so this simulation does not establish accurate rate measurement. The seated take replay catches one of three holds and produces zero false alarms on both baseline and final code. Initial acquisition and missed holds remain unresolved. No live physical verification was performed.

Review:
- Acquisition: the first echo can still differ from the labeled physical distance.
- Stability: recorded stillness must not trigger zone changes.
- Movement: reselection remains possible after movement and settling.
- Alerts: stability alone does not establish reliable breath-hold detection.

## Fresh movement test and reacquisition repair

The 150.14-second take `take-2026-11-15T02-49-27-995Z` uses normal 80, moving 10, normal 60. Before this repair the fixed zone remained at 34.3 cm throughout. Movement was detected at approximately 83.5 seconds, but an old-zone hold alert beginning at 89 seconds blocked reselection. Old scores also retained the earlier position.

Movement now discards the accumulated ranking. After a full rhythm window plus settling time, the picker commits one fresh selection without letting an old-zone hold veto it. It freezes again after that decision. Manual selection remains fixed.

Regression command: `ZONE_REQUIRE_REACQUIRE=1 node tools/check-zone-stability.js data/take-2026-11-15T02-49-27-995Z`. It fails before the repair and passes after. Replay selects 34.3 cm at 32.3 seconds, then 40.0 cm at 115.5 seconds. No stillness-driven changes. Five older recordings also pass the stability assertion. The range simulation retains its 7.4-second hold-alert delay.

Limits: the intended move was from about 40 to 70 cm, but distances were not saved in the metadata, and the new echo selection is only 40 cm. This proves reselection is no longer blocked, not correct chest localization. One false hold alert remains at 89 seconds, clearing on reacquisition at 115.5 seconds (previously two false alerts). Raw audio replay only; rerun physical validation next.
