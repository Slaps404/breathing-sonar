"""Tiered tracks for friends: pick how much to help, then do the takes one by one.

Tiers build on each other: "Helpful" is "Quick" plus more takes, and so on.
Progress is kept in data/track-done.txt, so changing tier later keeps the takes already done.
"""
from guide import LEAD_IN, parse_plan
from recorder import DATA

NAMES = {1: "Quick", 2: "Helpful", 3: "Extra mile"}

BASIC = "normal 30, hold 20, x3"
# id, tier, distance (cm), plan, setup shown before the take
STEPS = [
    ("seated", 1, 40, BASIC,
     "Sit upright facing the screen, chest about 40 cm (an arm's length) away."),
    ("empty", 1, None, "moving 10, away 60",
     "Nobody in front of the laptop: when the banner says MOVE AROUND, get up and leave "
     "(another room is best). Come back after about 1 minute, when the banner says SAVED."),
    ("close", 2, 30, BASIC,
     "Sit closer: chest about 30 cm from the screen."),
    ("far", 2, 80, BASIC,
     "Lean back in your chair: chest about 70-80 cm from the screen."),
    ("moving", 2, 40, "moving 20, normal 30, hold 20, x3",
     "Back to about 40 cm. During MOVE AROUND: shift in your seat, scratch your head, look around, "
     "like you normally would. Do not touch the laptop."),
    ("slouched", 3, 50, BASIC,
     "Slouch like you are watching a video, about 50 cm away."),
    ("noisy", 3, 40, BASIC,
     "Somewhere noisy: turn on music or a TV, or sit where people are around. About 40 cm away."),
    ("lying", 3, 100, BASIC,
     "Lie down (couch or bed) with the laptop on a table about 1 m away, facing you."),
]

# Test events: one continuous take each, you breathing first and then the event, so a detector can be
# checked on the before and after. Separate from the friend tiers; progress shares track-done.txt.
SIT = "Sit upright about 40 cm from the screen. "
EVENTS = [
    *[(f"walkaway{i}", 0, 40, "normal 60, moving 8, away 60",
       SIT + f"When the banner says MOVE AROUND, get up and walk out of the room{via}. "
       "Stay away until it says SAVED. If you come back early, click I'm back in the menu.")
      for i, via in [(1, ""), (2, " a different way"), (3, " a third way, or just to the far side of the room")]],
    *[(f"fall{i}", 0, 40, "normal 60, fall 5, hold 25, slow 30",
       SIT + "Put a cushion or mattress on the floor first. Do NOT really fall. When the banner says SLIDE TO "
       "THE FLOOR, slide out of the chair onto it and go limp. Then hold your breath, then breathe slowly "
       "(about one breath every 10-15 s), lying still.") for i in (1, 2, 3)],
    *[(f"slump{i}", 0, 40, "normal 60, slump 5, hold 25, slow 30",
       SIT + "When the banner says SLUMP IN CHAIR, slump like you are nodding off and stay slumped. "
       "Then hold your breath, then breathe slowly (about one breath every 10-15 s).") for i in (1, 2, 3)],
    *[(f"slow{i}", 0, 40, "slow 90",
       SIT + "Breathe slowly the whole time: about 4-6 breaths a minute, one breath every 10-15 s.")
      for i in (1, 2)],
]

TIER_FILE, DONE_FILE = DATA / "track.txt", DATA / "track-done.txt"


def tier():
    try:
        return max(1, min(3, int(TIER_FILE.read_text().strip())))
    except (OSError, ValueError):
        return None


def set_tier(n):
    DATA.mkdir(exist_ok=True)
    TIER_FILE.write_text(str(n))


def done():
    return set(DONE_FILE.read_text().split()) if DONE_FILE.exists() else set()


def mark_done(step_id):
    DATA.mkdir(exist_ok=True)
    DONE_FILE.write_text("\n".join(sorted(done() | {step_id})))


def todo(n):
    """Steps in tier n (and below) not done yet, in order."""
    d = done()
    return [s for s in STEPS if s[1] <= n and s[0] not in d]


def events_todo():
    d = done()
    return [s for s in EVENTS if s[0] not in d]


def count(n):
    return sum(1 for s in STEPS if s[1] <= n)


def minutes(n):
    """Recording time for tier n, including each take's lead-in."""
    return round(sum(LEAD_IN + sum(d for _, d in parse_plan(s[3])) for s in STEPS if s[1] <= n) / 60)


def label(n):
    return f"{NAMES[n]}: {count(n)} takes, about {minutes(n)} min"
