"""Voice notes: anything you say during a take is already in its .wav (speech sits far below the
20-22 kHz probe). This finds it with Whisper, on this Mac, and saves it with times:
  - "notes" in the take's .json: [{t0, t1, text}] in seconds from the start of the take
  - <take>-notes.txt next to it, for reading

Talking moves your chest, so the sonar's breathing data is not clean while you speak; the note
times let analysis skip those spans.

Usage: .venv/bin/python collect/notes.py data/take-<id> [more takes...]
Needs: .venv/bin/pip install mlx-whisper (Apple Silicon). Without it, takes still save, just no notes.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL = "mlx-community/whisper-small.en-mlx"   # downloaded once (~250 MB) to ~/.cache/huggingface


def available():
    try:
        import mlx_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def transcribe(base):
    """base = path without extension. Returns the notes list (also written to the .json and -notes.txt)."""
    import mlx_whisper
    base = Path(str(base).removesuffix(".wav").removesuffix(".json"))
    with tempfile.TemporaryDirectory() as tmp:
        # Whisper wants 16 kHz; the low-pass also drops the probe tone
        speech = Path(tmp) / "speech.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f"{base}.wav", "-af", "lowpass=7000",
                        "-ar", "16000", "-ac", "1", str(speech)], check=True)
        out = mlx_whisper.transcribe(str(speech), path_or_hf_repo=MODEL, condition_on_previous_text=False)
    # Whisper invents words in silence ("Thank you."); keep segments it is fairly sure hold speech
    notes = [{"t0": round(s["start"], 1), "t1": round(s["end"], 1), "text": s["text"].strip()}
             for s in out["segments"] if s["no_speech_prob"] < 0.5 and s["avg_logprob"] > -1.0 and s["text"].strip()]
    meta_path = Path(f"{base}.json")
    meta = json.loads(meta_path.read_text())
    meta["notes"] = notes
    meta_path.write_text(json.dumps(meta))
    lines = [f"{n['t0']:6.1f}-{n['t1']:6.1f} s  [{label_at(meta, n['t0'])}]  {n['text']}" for n in notes]
    Path(f"{base}-notes.txt").write_text("\n".join(lines or ["(no speech found)"]) + "\n")
    return notes


def label_at(meta, t):
    """What the take's label was at time t (so you can see which part a note was said in)."""
    now = ""
    for lab in meta.get("labels", []):
        if lab["t"] <= t:
            now = lab["label"]
    return now


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(arg)
        for n in transcribe(arg):
            print(f"  {n['t0']:6.1f}-{n['t1']:6.1f} s  {n['text']}")
