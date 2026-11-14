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


class SonarApp(rumps.App):
    def __init__(self):
        super().__init__("Sonar", title="◌ sonar", quit_button=None)
        self.rec = Recorder()
        self.current = None
        self.toggle = rumps.MenuItem("Start recording", callback=self.on_toggle)
        self.items = {text: rumps.MenuItem(text, callback=self.on_label) for text in LABELS}
        self.status = rumps.MenuItem("Not recording")
        self.menu = [self.toggle, self.status, None, *self.items.values(), None,
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
