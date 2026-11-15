"""Guided takes: a preset list of timed intervals plus a silent on-screen cue with a countdown.

Plan text looks like "normal 30, hold 20, x5": breathe normally 30 s, hold 20 s, repeat 5 times.
"""
import re

from AppKit import (NSBackingStoreBuffered, NSColor, NSFont, NSPanel, NSScreen, NSStatusWindowLevel,
                    NSTextAlignmentCenter, NSTextField, NSWindowCollectionBehaviorCanJoinAllSpaces,
                    NSWindowCollectionBehaviorFullScreenAuxiliary, NSWindowStyleMaskBorderless,
                    NSWindowStyleMaskNonactivatingPanel)

DEFAULT_PLAN = "normal 30, hold 20, x5"
LEAD_IN = 5  # seconds of "get ready" before recording starts, so your hand is off the laptop

# word typed in the plan -> label written to the JSON
WORDS = {"normal": "normal", "breathe": "normal", "hold": "hold", "moving": "moving", "move": "moving",
         "away": "empty room", "empty": "empty room", "fall": "fall", "slump": "slump", "slow": "slow"}
CUES = {"normal": "BREATHE NORMALLY", "hold": "HOLD BREATH", "moving": "MOVE AROUND", "empty room": "STEP AWAY",
        "fall": "SLIDE TO THE FLOOR", "slump": "SLUMP IN CHAIR", "slow": "BREATHE SLOWLY"}
# cue background colours (red, green, blue)
COLORS = {"normal": (0.16, 0.62, 0.56), "hold": (0.15, 0.27, 0.33), "moving": (0.91, 0.44, 0.32),
          "empty room": (0.45, 0.45, 0.45), "fall": (0.75, 0.2, 0.25), "slump": (0.55, 0.3, 0.6),
          "slow": (0.2, 0.45, 0.7), None: (0.2, 0.2, 0.2)}


def parse_plan(text):
    """'normal 30, hold 20, x5' -> [(label, seconds), ...] with the repeats written out."""
    steps, repeats = [], 1
    for part in filter(None, (p.strip().lower() for p in text.split(","))):
        rep = re.fullmatch(r"x\s*(\d+)", part)
        step = re.fullmatch(r"([a-z]+)\s+(\d+(?:\.\d+)?)\s*s?", part)
        if rep:
            repeats = int(rep.group(1))
        elif step and step.group(1) in WORDS and float(step.group(2)) > 0:
            steps.append((WORDS[step.group(1)], float(step.group(2))))
        else:
            raise ValueError(f'Could not read "{part}". Use e.g. "normal 30, hold 20, x5". '
                             f'Words: normal, hold, moving, away, fall, slump, slow.')
    if not steps or repeats < 1:
        raise ValueError("The plan needs at least one interval, e.g. normal 30")
    return steps * repeats


class Overlay:
    """Small always-on-top banner at the top of the screen. Never takes focus or clicks."""
    W, H = 520, 150

    def __init__(self):
        screen = NSScreen.mainScreen().visibleFrame()
        rect = ((screen.origin.x + (screen.size.width - self.W) / 2, screen.origin.y + screen.size.height - self.H - 20),
                (self.W, self.H))
        self.panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect, NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel, NSBackingStoreBuffered, False)
        self.panel.setLevel_(NSStatusWindowLevel)
        self.panel.setOpaque_(False)
        self.panel.setHidesOnDeactivate_(False)     # this app is never "active", so do not hide
        self.panel.setIgnoresMouseEvents_(True)
        self.panel.setCollectionBehavior_(NSWindowCollectionBehaviorCanJoinAllSpaces |
                                          NSWindowCollectionBehaviorFullScreenAuxiliary)
        self.big = self._text(((10, 55), (self.W - 20, 80)), 44)
        self.small = self._text(((10, 14), (self.W - 20, 30)), 18)

    def _text(self, frame, size):
        field = NSTextField.labelWithString_("")
        field.setFrame_(frame)
        field.setFont_(NSFont.monospacedDigitSystemFontOfSize_weight_(size, 0.4))
        field.setTextColor_(NSColor.whiteColor())
        field.setAlignment_(NSTextAlignmentCenter)
        self.panel.contentView().addSubview_(field)
        return field

    def show(self, big, small, label=None):
        r, g, b = COLORS[label]
        self.panel.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(r, g, b, 0.93))
        self.big.setStringValue_(big)
        self.small.setStringValue_(small)
        self.panel.orderFrontRegardless()

    def hide(self):
        self.panel.orderOut_(None)
