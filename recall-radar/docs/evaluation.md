# Evaluation (measured Nov 14, 2026)

All numbers are from real sweeps of OfferUp, San Diego, 30-mile radius. Labels are one person's reading of the
seller photos against the recall record (contact sheets: `scripts/contact_sheet.py`). Small samples; treat as rough.

## Regression set: 8 hand-verified listings (`scripts/check_batch.py`)

| Listing | Expected | Result |
|---|---|---|
| Bright Starts rocking sleeper (box) | recalled, Kids II | correct |
| Ingenuity Soothing Light sleeper | recalled, Kids II | correct |
| Automatic Rock N Soothe (no label) | recalled, Kids II | correct |
| WeHwupe bed rail, "MODEL: BRX-8002" on box | recalled | correct, decided by code (model read from photo) |
| Onewheel Pint | closer look (firmware fix) | correct |
| Original Peloton Bike | closer look (repair) | correct |
| Anker PowerCore+ (no model visible) | closer look | correct |
| Ocoopa UT2s (model not on list) | cleared | correct, decided by code |

**8 / 8.** Text matching alone gets 7 / 8 (misses WeHwupe, whose model number is only on the photo).

## Precision of "matches a recall"

| Sweep | Listings | Shortlisted | "Recalled" | Correct (my read) |
|---|---|---|---|---|
| Infant sleep, first rules | 304 | 64 | 6 | 3 (Graco swing, unicorn ride-on, Minnie bouncer were look-alikes) |
| Infant sleep, current rules | 304 | 64 | 5 | 5 (Graco Rock 'n Grow is borderline: recall covers only its sleeper accessory) |
| Bed rails, batteries, e-mobility, exercise | 499 | 160 | 11 | 9; 1 bug (Sole E25 elliptical vs Braun E25 espresso, fixed); 1 unsure (Sublue scooter) |

What changed between the first and current rules:
- "Recalled" now requires the model to name the matching recalled product or model AND the brands to agree.
  A similar shape alone is at most "closer look".
- Model numbers are checked by code against the recall's model list.

## "Needs a closer look"

Most are true by definition: 38 Onewheels and 32 Peloton bikes, all models recalled, remedy is a repair that a photo
cannot confirm. Known weak ones remain (a VTech unicorn ride-on matched a plush-rocker recall; clothing matched
4moms because the photo reader saw a swing in the background). Treat this bucket as "worth a human look", not a finding.

## Funnel

Infant sleep: 304 listings, 64 share a brand or model with a recall (21%), 14 flagged, 5 matches.
Other four categories: 499 listings, 160 shortlisted (32%), 106 flagged, 11 matches.

## Speed (free-tier Gemini, ~14 requests/minute)

- Photo reading: 8 thumbnails per request.
- Judging: listings sharing a candidate recall go 5 per request; readable recalled model numbers skip the model.
- 499-listing sweep: 4 min 16 s end to end (partly cached). Infant sleep re-judge, 64 listings: 5 min 12 s.
- Paid Gemini tier would remove the rate limit.

## Decision-tree judge (cascade)

A depth-4 decision tree (`recallradar/decide.py`) maps plain facts about the best candidate recall (brand is the
recalling company, readable model on/off the recall's list, recall covers all models, same product phrase, repair
remedy, recent recall, ...) to a verdict. Trained on 207 verdicts from the Gemini + rules pipeline.

| Confidence cutoff | Tree decides | Agrees with Gemini pipeline | False "recalled" |
|---|---|---|---|
| none (tree alone) | 100% | 72% | 8 |
| 0.80 | 64% | 86.5% | 0 |
| **0.90 (used)** | **46%** | **91.7%** | **0** |

Cross-validated. Guard: the tree may say no match / closer look / cleared, never "recalled"; that always needs Gemini
or an exact model-number match. Agreement with Gemini is not ground truth.

Gemini judge requests: 74 -> 46 (four-category sweep, 160 listings; tree decided 90), 32 -> 25 (infant sleep).
Photo reading moved from 8 to 16 thumbnails per request: on 48 listings, brands agree 48/48 (counting Future Motion =
Onewheel, Oculus = Meta), model numbers 44/48.
Known-8 regression: 8/8 (Onewheel and Peloton decided by the tree; not independent, some were training data).

## Full sweep with the new Gemini key (gemini-3.6-flash judge), UCSD / La Jolla, 30 mi

All 5 categories, 790 listings, 96 s end to end, 0 errors (183 of 215 item details cached from earlier
overlapping sweeps). 215 shortlisted; verdicts: 17 recalled, 106 closer look, 11 cleared, 81 no match.
Decided by: tree 96, model-number check 2, Gemini 117.

"Recalled" precision by eye: 17 / 17 plausible, 3 borderline (two Graco Rock 'n Grow playards, where the recall covers
only the inclined-sleeper accessory; one Dream On Me rail with brand and design match but no readable model).
New finds: Fisher-Price Jonathan Adler Deluxe Rock 'n Play ($30), Anker EverFrost battery cooler ($800).
