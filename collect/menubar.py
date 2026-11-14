"""Menu bar sonar recorder for macOS. Run:  .venv/bin/python collect/menubar.py

Click the icon, start recording, then pick what you are doing. Each pick is logged
with the exact sample it happened at. Recordings land in data/.
"""
import signal
import subprocess
import time

import rumps

from guide import CUES, DEFAULT_PLAN, LEAD_IN, Overlay, parse_plan
from recorder import DATA, Recorder

# menu text -> label written to the JSON (same names as the phone collector)
LABELS = {
    "Breathing normally": "normal",
    "Holding breath": "hold",
    "Moving around": "moving",
    "Away from laptop": "empty room",
}
# rough chest-to-laptop distance, menu text -> centimetres
DISTANCES = {"About 20 cm": 20, "About 30 cm": 30, "About 40 cm": 40, "About 50 cm": 50, "About 60 cm": 60,
             "About 80 cm": 80, "About 1 m": 100, "About 1.5 m": 150, "2 m or more": 200}

IDLE = "◌"
MENU_TEXT = {label: text for text, label in LABELS.items()}
PLAN_FILE = DATA / "plan.txt"   # your last intervals, kept between runs


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
        self.menu = [self.toggle, self.status, None, self.guided, self.plan_item, None,
                     *self.items.values(), None, self.distance, None,
                     rumps.MenuItem("Open data folder", callback=self.on_open),
                     rumps.MenuItem("Quit", callback=self.on_quit)]

    def on_plan(self, _):
        win = rumps.Window("Intervals in seconds, separated by commas. End with x5 to repeat 5 times.\n"
                           "Words: normal, hold, moving, away.", "Guided take intervals",
                           default_text=self.plan, ok="Save", cancel="Cancel", dimensions=(320, 24)).run()
        if not win.clicked:
            return
        try:
            parse_plan(win.text)
        except ValueError as err:
            rumps.alert("Intervals not saved", str(err))
            return
        self.plan = win.text.strip()
        DATA.mkdir(exist_ok=True)
        PLAN_FILE.write_text(self.plan)
        self.plan_item.title = "Set intervals: " + self.plan

    def on_guided(self, _):
        if self.guide:                  # second click cancels; anything recorded so far is saved
            self.end_guide("Cancelled")
            return
        if self.rec.running:
            rumps.alert("Stop the current recording first")
            return
        self.guide = {"steps": parse_plan(self.plan), "i": -1, "t0": time.monotonic(), "ends": []}
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
                self.overlay.show(f"GET READY  {left:.0f}", "first: " + CUES[steps[0][0]].lower())
                return
            try:
                self.rec.plan = self.plan
                self.rec.start()
            except Exception as err:    # e.g. no microphone permission
                self.end_guide("Could not start")
                rumps.alert("Could not start recording", str(err))
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
        self.overlay.show(f"{CUES[steps[i][0]]}  {g['ends'][i] - now:.0f}", f"{i + 1} of {len(steps)}, {nxt}", steps[i][0])

    def end_guide(self, word):
        self.guide = None
        self.guide_timer.stop()
        self.guided.title = "Start guided take"
        if self.rec.running:
            self.save()
            word += ", saved"
        if self.rec.xruns > 5:          # dropped audio leaves holes in the take; say so right away
            word, self.hide_at_extra = f"{self.rec.xruns} audio dropouts: redo", 8
        if self.rec.snr is not None and self.rec.snr < 15:   # the probe never reached the mic
            word, self.hide_at_extra = "no echo: unmute, volume up, redo", 8
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
                rumps.alert("Could not start recording", str(err))
                return
            self.toggle.title = "Stop and save"
            self.set_label("Breathing normally")

    def on_label(self, sender):
        if not self.rec.running:
            self.on_toggle(None)        # picking a label also starts a recording
        if self.rec.running:
            self.set_label(sender.title)

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
        meta = self.rec.stop()
        self.toggle.title = "Start recording"
        self.title = IDLE
        self.current = None
        for item in self.items.values():
            item.state = 0
        self.status.title = f"Saved {meta['seconds']:.0f} s, {len(meta['labels'])} labels, SNR {meta['snrMedianDb']} dB"

    @rumps.timer(1)
    def tick(self, _):
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
