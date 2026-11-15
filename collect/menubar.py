"""Menu bar sonar recorder for macOS. Run:  .venv/bin/python collect/menubar.py

Click the icon, start recording, then pick what you are doing. Each pick is logged
with the exact sample it happened at. Recordings land in data/.
"""
import signal
import subprocess
import threading
import time

import rumps
from AppKit import NSAlert, NSAlertFirstButtonReturn, NSApplication, NSFloatingWindowLevel

import notes
import tracks
from guide import CUES, DEFAULT_PLAN, LEAD_IN, Overlay, parse_plan
from recorder import DATA, Recorder

# menu text -> label written to the JSON (same names as the phone collector)
LABELS = {
    "Breathing normally": "normal",
    "Holding breath": "hold",
    "Moving around": "moving",
    "Away from laptop": "empty room",
    "Falling": "fall",
    "Slumping": "slump",
    "Breathing slowly": "slow",
    "Breathing + small moves": "fidget",
    "Breathing + shaking": "shaking",
}
# rough chest-to-laptop distance, menu text -> centimetres
DISTANCES = {"About 20 cm": 20, "About 30 cm": 30, "About 40 cm": 40, "About 50 cm": 50, "About 60 cm": 60,
             "About 80 cm": 80, "About 1 m": 100, "About 1.5 m": 150, "2 m or more": 200}

IDLE = "◌"
MENU_TEXT = {label: text for text, label in LABELS.items()}
PLAN_FILE = DATA / "plan.txt"   # your last intervals, kept between runs


def on_top(nsalert):
    """A menu bar app is never the active app, so its dialogs open behind other windows.
    macOS ignores requests to activate it, so float the dialog above normal windows instead."""
    NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
    nsalert.window().setLevel_(NSFloatingWindowLevel)


def alert(title, message="", ok="OK", cancel=None):
    """Like rumps.alert, but the dialog shows up in front. True if OK was clicked."""
    a = NSAlert.alloc().init()
    a.setMessageText_(title)
    a.setInformativeText_(message)
    a.addButtonWithTitle_(ok)
    if cancel:
        a.addButtonWithTitle_(cancel)
    on_top(a)
    return a.runModal() == NSAlertFirstButtonReturn


class SonarApp(rumps.App):
    def __init__(self):
        # Keep the title tiny: a wide one gets pushed behind the notch and cannot be clicked.
        super().__init__("Sonar", title=IDLE, quit_button=None)
        # 20-22 kHz at low level: above what most people can hear. 18-20 kHz was audible and unpleasant.
        self.rec = Recorder(amp=0.15, f0=20000, f1=22000)
        self.current = None
        self.stop_requested = False
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "stop_requested", True))
        self.toggle = rumps.MenuItem("Start recording", callback=self.on_toggle)
        self.items = {text: rumps.MenuItem(text, callback=self.on_label) for text in LABELS}
        # Came back before the take ended (break, early return from Step away): mark the moment,
        # so the time after it is not counted as an empty room.
        self.back_item = rumps.MenuItem("I'm back (mark it)", callback=self.on_back)
        self.back_at = None
        self.status = rumps.MenuItem("Not recording")
        self.distance = rumps.MenuItem("Distance: not set")
        for text in DISTANCES:
            self.distance.add(rumps.MenuItem(text, callback=self.on_distance))
        self.plan = PLAN_FILE.read_text().strip() if PLAN_FILE.exists() else DEFAULT_PLAN
        self.guide = None       # running guided take: {"steps", "i", "t0" (lead-in start), "ends"}
        self.overlay = None
        self.hide_at = 0
        self.guided = rumps.MenuItem("Start guided take", callback=self.on_guided)
        self.plan_item = rumps.MenuItem("Set intervals: " + self.plan, callback=self.on_plan)
        self.guide_timer = rumps.Timer(self.guide_tick, 0.2)
        # Friend track: a list of set-up takes (tracks.py). The tier picks how many.
        self.track_step = None          # step id of the guided take running now, if it came from the track
        self.next_item = rumps.MenuItem("Next take", callback=self.on_next)
        self.event_item = rumps.MenuItem("Next test event", callback=self.on_next_event)
        self.tier_menu = rumps.MenuItem("How much to help")
        for n in tracks.NAMES:
            self.tier_menu.add(rumps.MenuItem(tracks.label(n), callback=self.on_tier))
        self.refresh_track()
        self.menu = [self.next_item, self.tier_menu, self.event_item, None, self.toggle, self.status, None, self.guided, self.plan_item, None,
                     *self.items.values(), self.back_item, None, self.distance, None,
                     rumps.MenuItem("Open data folder", callback=self.on_open),
                     rumps.MenuItem("Quit", callback=self.on_quit)]

    def on_plan(self, _):
        win = rumps.Window("Intervals in seconds, separated by commas. End with x5 to repeat 5 times.\n"
                           "Words: normal, hold, moving, away.", "Guided take intervals",
                           default_text=self.plan, ok="Save", cancel="Cancel", dimensions=(320, 24))
        on_top(win._alert)
        win = win.run()
        if not win.clicked:
            return
        try:
            parse_plan(win.text)
        except ValueError as err:
            alert("Intervals not saved", str(err))
            return
        self.plan = win.text.strip()
        DATA.mkdir(exist_ok=True)
        PLAN_FILE.write_text(self.plan)
        self.plan_item.title = "Set intervals: " + self.plan

    def refresh_track(self):
        n = tracks.tier() or 1
        for k, item in zip(tracks.NAMES, self.tier_menu.values()):
            item.state = int(k == n)
        left, total = len(tracks.todo(n)), tracks.count(n)
        self.next_item.title = (f"Next take ({total - left + 1} of {total})" if left
                                else f"All {total} takes done, thank you! Quit to save")
        ev_left, ev_total = len(tracks.events_todo()), len(tracks.EVENTS)
        self.event_item.title = (f"Next test event ({ev_total - ev_left + 1} of {ev_total})" if ev_left
                                 else f"All {ev_total} test events done")

    def on_tier(self, sender):
        tracks.set_tier(next(k for k in tracks.NAMES if tracks.label(k) == sender.title))
        self.refresh_track()

    def on_next(self, _):
        if self.guide or self.rec.running:
            alert("Finish the current take first")
            return
        n = tracks.tier() or 1
        todo = tracks.todo(n)
        if not todo:
            alert("All done", "Thank you! Choose Quit to pack the takes into a zip on your Desktop.\n"
                        "Want to help more? Pick a bigger option under How much to help.")
            return
        k = tracks.count(n) - len(todo) + 1
        self.start_step(todo[0], f"Take {k} of {tracks.count(n)}")

    def on_next_event(self, _):
        if self.guide or self.rec.running:
            alert("Finish the current take first")
            return
        todo = tracks.events_todo()
        if not todo:
            alert("All test events done", "Thank you!")
            return
        k = len(tracks.EVENTS) - len(todo) + 1
        self.start_step(todo[0], f"Test event {k} of {len(tracks.EVENTS)}: {todo[0][0]}")

    def start_step(self, step, title):
        step_id, _, cm, plan, setup = step
        if not alert(title, setup + "\n\nAfter you click Start: hands off the laptop, "
                           "and follow the banner at the top of the screen.", ok="Start", cancel="Not now"):
            return
        if cm:
            self.on_distance(next(i for t, i in self.distance.items() if DISTANCES[t] == cm))
        else:                           # nobody in front of the laptop: no chest distance
            self.rec.set_distance(None)
            self.distance.title = "Distance: nobody there"
            for item in self.distance.values():
                item.state = 0
        self.track_step = step_id
        self.on_guided(None, plan)

    def on_guided(self, _, plan=None):
        if self.guide:                  # second click cancels; anything recorded so far is saved
            self.end_guide("Cancelled")
            return
        if self.rec.running:
            alert("Stop the current recording first")
            return
        plan = plan or self.plan
        self.guide = {"plan": plan, "steps": parse_plan(plan), "i": -1, "t0": time.monotonic(), "ends": []}
        near = "Chest 1/2 arm from screen (~40 cm). Sit still and breathe normally."
        back = "Move back to 1 arm (~70 cm). Keep the laptop stationary."
        far = "Stay at 1 arm (~70 cm). Sit still and breathe normally."
        far_hold = "Stay at 1 arm (~70 cm). Hold your breath and stay still."
        if self.guide["steps"] == [("normal", 90), ("moving", 15), ("normal", 90)]:
            self.guide["positions"] = [near, back, far]
        # far-distance hold test: does the alarm catch a breath hold after moving back?
        # 75 s at the new distance first: the zone is re-picked ~32 s after movement, then needs ~10 s of level history
        elif self.guide["steps"] == [("normal", 60), ("moving", 15), ("normal", 75), ("hold", 15), ("normal", 30), ("hold", 15), ("normal", 20)]:
            self.guide["positions"] = [near, back, far, far_hold, far, far_hold, far]
        self.overlay = self.overlay or Overlay()
        self.guided.title = "Cancel guided take"
        self.guide_timer.start()

    def guide_tick(self, _):
        g = self.guide
        if not g:
            return
        steps = g["steps"]
        if g["i"] < 0:                  # lead-in: not recording yet
            left = LEAD_IN - (time.monotonic() - g["t0"])
            if left > 0:
                self.overlay.show(f"GET READY  {left:.0f}", g["positions"][0] if "positions" in g else "first: " + CUES[steps[0][0]].lower())
                return
            try:
                self.rec.plan, self.rec.track = g["plan"], self.track_step
                self.rec.start()
            except Exception as err:    # e.g. no microphone permission
                self.end_guide("Could not start")
                alert("Could not start recording", str(err))
                return
            self.toggle.title = "Stop and save"
            total = 0
            for _, dur in steps:
                total += dur
                g["ends"].append(total)
        # Phases follow the recording's own clock (samples recorded), not the wall clock.
        now = self.rec.seconds()
        i = max(g["i"], 0)
        while i < len(steps) and now >= g["ends"][i]:
            i += 1
        if i >= len(steps):
            self.end_guide("Done")
            return
        if i != g["i"]:
            g["i"] = i
            self.set_label(MENU_TEXT[steps[i][0]])
        nxt = "next: " + CUES[steps[i + 1][0]].lower() if i + 1 < len(steps) else "last one"
        if self.back_at is not None:
            nxt = f"marked back at {self.back_at:.0f} s, " + nxt
        detail = g["positions"][i] if "positions" in g else f"{i + 1} of {len(steps)}, {nxt}"
        self.overlay.show(f"{CUES[steps[i][0]]}  {g['ends'][i] - now:.0f}", detail, steps[i][0])

    def end_guide(self, word):
        self.guide = None
        self.guide_timer.stop()
        self.guided.title = "Start guided take"
        finished = word == "Done"
        if self.rec.running:
            self.save()
            word += ", saved"
        if self.rec.xruns > 5:          # dropped audio leaves holes in the take; say so right away
            word, self.hide_at_extra, finished = f"{self.rec.xruns} audio dropouts: redo", 8, False
        if self.rec.snr is not None and self.rec.snr < 15:   # the probe never reached the mic
            word, self.hide_at_extra, finished = "no echo: unmute, volume up, redo", 8, False
        if self.track_step:             # a bad or cancelled take stays on the list, so Next take repeats it
            if finished:
                tracks.mark_done(self.track_step)
            self.track_step = None
            self.rec.track = None
            self.refresh_track()
        self.overlay.show(word.upper(), self.status.title)
        self.hide_at = time.monotonic() + 4 + getattr(self, "hide_at_extra", 0)   # the 1 s tick hides the banner
        self.hide_at_extra = 0

    def on_toggle(self, _):
        if self.guide:                  # "Stop and save" during a guided take ends the guide too
            self.end_guide("Stopped")
        elif self.rec.running:
            self.save()
        else:
            try:
                self.rec.start()
            except Exception as err:    # e.g. no microphone permission
                alert("Could not start recording", str(err))
                return
            self.toggle.title = "Stop and save"
            self.set_label("Breathing normally")

    def on_label(self, sender):
        if not self.rec.running:
            self.on_toggle(None)        # picking a label also starts a recording
        if self.rec.running:
            self.set_label(sender.title)

    def on_back(self, _):
        if not self.rec.running:
            alert("Not recording", "I'm back marks the moment you returned during a take.")
            return
        self.rec.label("returned")
        self.back_at = self.rec.seconds()

    def on_distance(self, sender):
        # Logged with its sample count, so you can change distance in the middle of a take.
        self.rec.set_distance(DISTANCES[sender.title])
        self.distance.title = "Distance: " + sender.title.lower()
        for item in self.distance.values():
            item.state = int(item is sender)

    def set_label(self, text):
        self.current = text
        self.rec.label(LABELS[text])
        for name, item in self.items.items():
            item.state = int(name == text)

    def save(self):
        self.back_at = None
        meta = self.rec.stop()
        self.toggle.title = "Start recording"
        self.title = IDLE
        self.current = None
        for item in self.items.values():
            item.state = 0
        self.status.title = f"Saved {meta['seconds']:.0f} s, {len(meta['labels'])} labels, SNR {meta['snrMedianDb']} dB"
        if notes.available():           # voice notes: transcribe what you said, in the background
            self.notes_msg = None
            threading.Thread(target=self._notes, args=(DATA / meta["id"],), daemon=True).start()

    def _notes(self, base):
        try:
            n = notes.transcribe(base)
            self.notes_msg = f"{len(n)} voice note(s) saved" if n else "No voice notes"
        except Exception as err:        # notes are extra; never lose or block a take over them
            self.notes_msg = f"Voice notes failed: {err}"

    @rumps.timer(1)
    def tick(self, _):
        if getattr(self, "notes_msg", None):  # set by the notes thread; menu changes belong on this thread
            self.status.title += f", {self.notes_msg}"
            self.notes_msg = None
        if self.stop_requested:         # `kill <pid>` saves the take instead of losing it
            self.on_quit(None)
        if self.overlay and not self.guide and time.monotonic() > self.hide_at:
            self.overlay.hide()
        if not self.rec.running:
            return
        s = int(self.rec.seconds())
        snr = self.rec.snr
        self.title = "●" + LABELS[self.current][0].upper()     # e.g. ●N normal, ●H hold
        head = f"{LABELS[self.current]} {s // 60}:{s % 60:02d}"
        if snr is None:
            self.status.title = head
        elif self.rec.peak == 0:
            self.status.title = head + ", mic is silent: allow microphone access"
        else:
            warn = " (LOW: raise volume)" if snr < 15 else ""
            self.status.title = f"{head}, SNR {snr:.0f} dB{warn}, dropouts {self.rec.xruns}"

    def on_open(self, _):
        DATA.mkdir(exist_ok=True)
        subprocess.run(["open", str(DATA)])

    def on_quit(self, _):
        if self.rec.running:
            self.rec.stop()
        rumps.quit_application()


if __name__ == "__main__":
    SonarApp().run()
