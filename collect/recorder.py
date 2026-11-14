"""Laptop sonar recorder: plays the 18-20 kHz probe and writes raw mic audio + labels to data/.

Output matches the phone collector: take-<time>.wav (16-bit mono) and take-<time>.json.
Sample n of the WAV lines up with probe[n % P] (plus a fixed speaker-to-mic delay),
because the speaker and mic run in one audio stream.
"""
import json
import queue
import threading
import wave
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sounddevice as sd

SR = 48000
DATA = Path(__file__).resolve().parent.parent / "data"


def make_probe(P=2048, f0=18000, f1=20000, sr=SR, rms=0.408):
    """Same signal as makeProbe() in dsp.js: every FFT bin from f0 to f1, Schroeder phases."""
    k0, k1 = int(np.ceil(f0 * P / sr)), int(np.floor(f1 * P / sr))
    K = k1 - k0 + 1
    q = np.arange(K)
    phi = -np.pi * q * q / K
    n = np.arange(P)
    sig = (rms / np.sqrt(K / 2)) * np.cos(2 * np.pi * np.outer(k0 + q, n) / P + phi[:, None]).sum(axis=0)
    return sig.astype(np.float32), k0, k1


def probe_snr_db(frame, k0, k1):
    """Probe band power vs the quiet band just above it (same idea as cir() in dsp.js)."""
    power = np.abs(np.fft.rfft(frame)) ** 2
    noise = power[k1 + 10:k1 + 60].mean()
    return float(10 * np.log10(max(power[k0:k1 + 1].mean(), 1e-30) / max(noise, 1e-30)))


class Recorder:
    def __init__(self, amp=0.7, f0=18000, f1=20000):
        self.amp, self.f0, self.f1 = amp, f0, f1
        self.probe, self.k0, self.k1 = make_probe(f0=f0, f1=f1)
        self.P = len(self.probe)
        self.running = False
        self.distance_cm = None  # rough chest-to-laptop distance; kept between takes
        self.plan = None         # guided-take interval text, if the take was guided

    def start(self):
        DATA.mkdir(exist_ok=True)
        self.started = datetime.now(timezone.utc)
        self.id = "take-" + self.started.strftime("%Y-%m-%dT%H-%M-%S-") + f"{self.started.microsecond // 1000:03d}Z"
        self.pos = 0            # samples played and recorded so far
        self.labels, self.snrs = [], []
        self.distances = [] if self.distance_cm is None else [{"cm": self.distance_cm, "sample": 0, "t": 0.0}]
        self.peak, self.xruns, self.snr = 0.0, 0, None
        self.q = queue.Queue()
        self.wav = wave.open(str(DATA / (self.id + ".wav")), "wb")
        self.wav.setnchannels(1); self.wav.setsampwidth(2); self.wav.setframerate(SR)
        self.writer = threading.Thread(target=self._write, daemon=True)
        self.writer.start()
        # blocksize = one probe period, so every mic block lines up with the probe.
        self.stream = sd.Stream(samplerate=SR, blocksize=self.P, channels=(1, 2), dtype="float32", callback=self._audio)
        self.stream.start()
        self.running = True

    def _audio(self, indata, outdata, frames, time, status):
        if status:
            self.xruns += 1     # dropped audio breaks the probe alignment; counted in the JSON
        idx = self.pos + np.arange(frames)
        fade = np.minimum(1.0, idx / (0.1 * SR))            # 0.1 s fade-in, avoids a click
        outdata[:] = (self.probe[idx % self.P] * fade * self.amp)[:, None]
        self.pos += frames
        self.q.put(indata[:, 0].copy())

    def _write(self):
        n = 0
        while True:
            block = self.q.get()
            if block is None:
                return
            self.peak = max(self.peak, float(np.abs(block).max()))
            self.wav.writeframes((np.clip(block, -1, 1) * 32767).astype("<i2").tobytes())
            n += 1
            if n % 12 == 0 and len(block) == self.P:        # about twice a second
                self.snr = probe_snr_db(block, self.k0, self.k1)
                self.snrs.append(round(self.snr, 1))

    def label(self, name):
        self.labels.append({"label": name, "sample": self.pos, "t": round(self.pos / SR, 3)})

    def set_distance(self, cm):
        self.distance_cm = cm
        if self.running:
            self.distances.append({"cm": cm, "sample": self.pos, "t": round(self.pos / SR, 3)})

    def seconds(self):
        return self.pos / SR

    def stop(self):
        self.running = False
        self.stream.stop(); self.stream.close()
        self.q.put(None); self.writer.join()
        samples = self.wav.getnframes()
        self.wav.close()
        meta = {
            "id": self.id, "source": "mac-menubar", "started": self.started.isoformat(),
            "sampleRate": SR, "P": self.P, "f0": self.f0, "f1": self.f1, "amp": self.amp,
            "samples": samples, "seconds": round(samples / SR, 2), "labels": self.labels,
            "distances": self.distances, "plan": self.plan,
            "peak": round(self.peak, 4), "xruns": self.xruns,
            "snrMedianDb": round(float(np.median(self.snrs)), 1) if self.snrs else None,
            "input": sd.query_devices(kind="input")["name"], "output": sd.query_devices(kind="output")["name"],
            "probe": [round(float(v), 6) for v in self.probe],
        }
        (DATA / (self.id + ".json")).write_text(json.dumps(meta))
        return meta


if __name__ == "__main__":  # quick self-test: python collect/recorder.py [seconds]
    import sys, time
    r = Recorder()
    r.start(); r.label("normal")
    time.sleep(float(sys.argv[1]) if len(sys.argv) > 1 else 4)
    m = r.stop()
    print({k: m[k] for k in ("id", "seconds", "peak", "xruns", "snrMedianDb", "input", "output", "labels")})
