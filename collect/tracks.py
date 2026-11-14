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


def count(n):
    return sum(1 for s in STEPS if s[1] <= n)


def minutes(n):
    """Recording time for tier n, including each take's lead-in."""
    return round(sum(LEAD_IN + sum(d for _, d in parse_plan(s[3])) for s in STEPS if s[1] <= n) / 60)


def label(n):
    return f"{NAMES[n]}: {count(n)} takes, about {minutes(n)} min"
