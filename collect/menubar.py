"""Menu bar sonar recorder for macOS. Run:  .venv/bin/python collect/menubar.py

Click the icon, start recording, then pick what you are doing. Each pick is logged
with the exact sample it happened at. Recordings land in data/.
"""
import subprocess

import rumps

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


class SonarApp(rumps.App):
    def __init__(self):
        super().__init__("Sonar", title="◌ sonar", quit_button=None)
        # 20-22 kHz at low level: above what most people can hear. 18-20 kHz was audible and unpleasant.
        self.rec = Recorder(amp=0.15, f0=20000, f1=22000)
        self.current = None
        self.toggle = rumps.MenuItem("Start recording", callback=self.on_toggle)
        self.items = {text: rumps.MenuItem(text, callback=self.on_label) for text in LABELS}
        self.status = rumps.MenuItem("Not recording")
        self.distance = rumps.MenuItem("Distance: not set")
        for text in DISTANCES:
            self.distance.add(rumps.MenuItem(text, callback=self.on_distance))
        self.menu = [self.toggle, self.status, None, *self.items.values(), None, self.distance, None,
                     rumps.MenuItem("Open data folder", callback=self.on_open),
                     rumps.MenuItem("Quit", callback=self.on_quit)]

    def on_toggle(self, _):
        if self.rec.running:
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
        self.title = "◌ sonar"
        self.current = None
        for item in self.items.values():
            item.state = 0
        self.status.title = f"Saved {meta['seconds']:.0f} s, {len(meta['labels'])} labels, SNR {meta['snrMedianDb']} dB"

    @rumps.timer(1)
    def tick(self, _):
        if not self.rec.running:
            return
        s = int(self.rec.seconds())
        snr = self.rec.snr
        self.title = f"● {LABELS[self.current]} {s // 60}:{s % 60:02d}"
        if snr is None:
            self.status.title = "Recording..."
        elif self.rec.peak == 0:
            self.status.title = "Mic is silent: allow microphone access for this app"
        else:
            warn = "  (LOW: raise volume)" if snr < 15 else ""
            self.status.title = f"Probe SNR {snr:.0f} dB{warn}, dropouts {self.rec.xruns}"

    def on_open(self, _):
        DATA.mkdir(exist_ok=True)
        subprocess.run(["open", str(DATA)])

    def on_quit(self, _):
        if self.rec.running:
            self.rec.stop()
        rumps.quit_application()


if __name__ == "__main__":
    SonarApp().run()
