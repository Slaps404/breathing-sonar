// dsp.js: all signal processing. Loaded by index.html (browser) and by tools/*.js (node sim),
// so the simulator runs exactly the code the page runs.
//
// Two sonar modes share one "channel" pipeline:
//   ToneSonar : 3 steady tones. Each tone gives one I/Q channel holding ALL echoes mixed together.
//   RangeSonar: a repeating 18-20 kHz probe. Each frame is turned into ~6 cm range slices
//               ("taps"); each tap is its own I/Q channel, so we can watch only the chest's slice.
// Channel pipeline: I/Q history -> fit circle -> angle around center -> displacement in mm
//                   -> breathing rate (DFT 6-42/min) + breath-hold detector.
(function () {
const C = 343;     // speed of sound, m/s
const SR = 48000;  // audio sample rate

// ---------- Audio-thread code (strings, loaded as AudioWorklet modules) ----------
// Tones: play the tones and I/Q-demodulate the mic at each tone (and at silent noise references).
const TONE_WORKLET = `
class Sonar extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const p = opts.processorOptions;
    this.freqs = p.freqs; this.emit = p.emit; this.dec = p.dec; this.amp = p.amp;
    this.gain = 0; this.n = 0;
    const K = this.freqs.length;
    this.w = this.freqs.map(f => 2 * Math.PI * f / sampleRate);
    this.ph = new Float64Array(K); this.I = new Float64Array(K); this.Q = new Float64Array(K);
    this.nEmit = this.emit.filter(Boolean).length;
    this.port.onmessage = e => { if (e.data.amp !== undefined) this.amp = e.data.amp; };
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0];
    const N = out[0].length, K = this.freqs.length;
    for (let s = 0; s < N; s++) {
      this.gain += (this.amp - this.gain) * 0.0005; // fade in/out to avoid clicks
      const x = inp ? inp[s] : 0;
      let y = 0;
      for (let k = 0; k < K; k++) {
        const c = Math.cos(this.ph[k]), sn = Math.sin(this.ph[k]);
        if (this.emit[k]) y += c;
        this.I[k] += x * c; this.Q[k] -= x * sn;
        this.ph[k] += this.w[k];
        if (this.ph[k] > 2 * Math.PI) this.ph[k] -= 2 * Math.PI;
      }
      y *= this.gain / this.nEmit;
      for (let ch = 0; ch < out.length; ch++) out[ch][s] = y;
      if (++this.n === this.dec) {
        this.n = 0;
        this.port.postMessage({ I: Array.from(this.I, v => v / this.dec), Q: Array.from(this.Q, v => v / this.dec) });
        this.I.fill(0); this.Q.fill(0);
      }
    }
    return true;
  }
}
registerProcessor('sonar', Sonar);
`;

// Probe: loop one period of the probe signal and hand the mic back one period at a time.
// Because output and input share one sample clock, every frame lines up with the probe.
const PROBE_WORKLET = `
class Probe extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const p = opts.processorOptions;
    this.sig = p.signal; this.P = this.sig.length; this.amp = p.amp;
    this.gain = 0; this.i = 0; this.buf = new Float32Array(this.P);
    this.port.onmessage = e => { if (e.data.amp !== undefined) this.amp = e.data.amp; };
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0];
    const N = out[0].length;
    for (let s = 0; s < N; s++) {
      this.gain += (this.amp - this.gain) * 0.0005;
      const y = this.sig[this.i] * this.gain;
      for (let ch = 0; ch < out.length; ch++) out[ch][s] = y;
      this.buf[this.i] = inp ? inp[s] : 0;
      if (++this.i === this.P) { this.i = 0; this.port.postMessage(this.buf.slice()); }
    }
    return true;
  }
}
registerProcessor('probe', Probe);
`;

// ---------- small math helpers ----------
function std(x, a = 0, b = x.length) {
  const n = b - a; if (n <= 0) return 0;
  let m = 0; for (let i = a; i < b; i++) m += x[i]; m /= n;
  let s = 0; for (let i = a; i < b; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / n);
}
function movingAvg(x, n) {
  const out = new Array(x.length); let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i]; if (i >= n) sum -= x[i - n];
    out[i] = sum / Math.min(i + 1, n);
  }
  return out;
}
function detrend(x) {
  const n = x.length, mx = (n - 1) / 2;
  let my = 0; for (const v of x) my += v; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (x[i] - my); den += (i - mx) ** 2; }
  const b = num / den;
  return x.map((v, i) => v - my - b * (i - mx));
}
// In-place radix-2 FFT (forward, e^{-j}). Length must be a power of 2.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const a = i + j, b = a + h;
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// ---------- the channel pipeline ----------
// A reflector moving by d changes the echo's phase by 4*pi*d/lambda, so its I/Q point
// slides around a circle whose center is the sum of all the still echoes.
// Fitting that circle and reading the angle around its center gives displacement directly,
// even when the swing is more than half a turn (the old straight-line projection folded it).
function fitCircle(xs, ys) {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx, y = ys[i] - my, z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z; sz += z;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 0)) return null;
  const D = -(sxz * syy - syz * sxy) / det, E = -(sxx * syz - sxy * sxz) / det, F = -sz / n;
  const cx = -D / 2, cy = -E / 2, R2 = cx * cx + cy * cy - F;
  if (!(R2 > 0)) return null;
  const R = Math.sqrt(R2);
  let rr = 0;
  for (let i = 0; i < n; i++) { const d = Math.hypot(xs[i] - mx - cx, ys[i] - my - cy) - R; rr += d * d; }
  return { cx: cx + mx, cy: cy + my, R, fit: Math.sqrt(rr / n) / R }; // fit = ring thickness / radius
}

// Strongest rhythm between 0.1 and 0.7 Hz, plus the share of signal power in that band.
function breathingSpectrum(x, rate) {
  const n = x.length, df = 0.01;
  let best = 0, bestF = 0, band = 0, total = 0;
  for (const v of x) total += v * v;
  for (let f = 0.1; f <= 0.7001; f += df) {
    const w = 2 * Math.PI * f / rate, cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, s = 0, re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * c; im -= x[i] * s;
      const t = c * cw - s * sw; s = c * sw + s * cw; c = t;
    }
    const p = re * re + im * im;
    band += p;
    if (p > best) { best = p; bestF = f; }
  }
  band *= 2 * df / rate; // Parseval: convert summed DFT power to time-domain power
  return { bestF, quality: total > 0 ? Math.min(1, band / total) : 0 };
}

function makeChannel(lambda, rate, histSec = 30) {
  return { lambda, rate, hist: Math.round(histSec * rate), I: [], Q: [], center: null, disp: [], quality: 0, bpm: null };
}
function pushIQ(ch, i, q) {
  ch.I.push(i); ch.Q.push(q);
  if (ch.I.length > ch.hist) { ch.I.shift(); ch.Q.shift(); }
}

// Turn the last winSec of I/Q into a displacement waveform (mm), rate and quality.
function analyzeChannel(ch, winSec = 20) {
  const rate = ch.rate, n = Math.min(ch.I.length, Math.round(winSec * rate));
  if (n < 8 * rate) return false;
  const xs = ch.I.slice(-n), ys = ch.Q.slice(-n);
  const c = fitCircle(xs, ys);
  // Accept a new center only when the points really form a clean ring. During a long
  // breath hold the points are just a noise blob, so we keep the last good center.
  if (c && c.fit < 0.25) ch.center = c;
  const k = -ch.lambda / (4 * Math.PI) * 1000; // radians -> mm (path gets longer = phase falls)
  let disp = new Array(n);
  if (ch.center) {
    const { cx, cy } = ch.center;
    let prev = 0, off = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ys[i] - cy, xs[i] - cx);
      if (i) { const d = a - prev; if (d > Math.PI) off -= 2 * Math.PI; else if (d < -Math.PI) off += 2 * Math.PI; }
      prev = a; disp[i] = (a + off) * k;
    }
  } else {
    // No clean ring yet: straight-line (PCA) projection, converted to an angle relative to the
    // whole echo in this channel (|mean|). A small wobble on a big still echo is a small angle,
    // so noise reads as ~0 mm instead of being blown up to a fixed size.
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
    let cxx = 0, cxy = 0, cyy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cxx += dx * dx; cxy += dx * dy; cyy += dy * dy; }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), R = Math.hypot(mx, my) || 1;
    for (let i = 0; i < n; i++) disp[i] = ((xs[i] - mx) * Math.cos(th) + (ys[i] - my) * Math.sin(th)) / R * k;
  }
  disp = detrend(movingAvg(disp, Math.max(1, Math.round(rate / 4)))); // drop jitter faster than ~4 Hz
  const spec = breathingSpectrum(disp, rate);
  ch.disp = disp; ch.quality = spec.quality; ch.bpm = spec.bestF * 60;
  return true;
}

// ---------- breath-hold detector ----------
// "Recent" = motion in the last 4 s. "Before" = motion from 20 s to 6 s ago (normal breathing).
// If recent < 30% of before for 4 s straight, alert. Earliest alert is ~8 s into a hold.
// Clears when recent motion is back to half of the level saved at alert time.
const APNEA = { recentSec: 4, ratio: 0.3, confirmMs: 4000, minBeforeMm: 0.3 };
function makeApnea() { return { alerting: false, holdStart: null, base: 0 }; }
function apneaStep(st, disp, rate, nowMs) {
  const n = disp.length;
  if (n < 15 * rate) return null;
  const recent = std(disp, n - Math.round(APNEA.recentSec * rate), n);
  const before = std(disp, Math.max(0, n - Math.round(20 * rate)), n - Math.round(6 * rate));
  if (!st.alerting) {
    if (before > APNEA.minBeforeMm && recent < APNEA.ratio * before) {
      st.holdStart ??= nowMs;
      if (nowMs - st.holdStart >= APNEA.confirmMs) { st.alerting = true; st.base = before; return 'start'; }
    } else st.holdStart = null;
  } else if (recent > 0.5 * st.base) { st.alerting = false; st.holdStart = null; return 'end'; }
  return null;
}

// ---------- range-mode breath-hold detector (fitted on two real takes) ----------
// Measures breathing-speed motion (0.15-0.6 Hz) of the echoes in a zone of distance slices over
// the last 8 s, and compares it with the person's own level over the last minute of still time.
// Alert when it drops 6 dB (to a quarter) below that level for 2 s, while the person is not
// moving. Movement (fast echo change 10 dB above the quiet floor) blocks alerts, because a
// person who is moving is not in a breath hold.
const HOLD = { winSec: 8, dropDb: 6, confirmSec: 2, quietSec: 3, moveDb: 10, baseSec: 60, floorSec: 120 };
function makeHold() { return { alerting: false, holdStart: null, below: 0, quiet: 0, last: null, B: [], M: [], moving: [] }; }
// IQ = list of channels (each with .I/.Q history) in the zone; fast = channels for movement.
function holdFeatures(zone, fast, rate) {
  const n = Math.round(HOLD.winSec * rate);
  if (zone[0].I.length < n) return null;
  // DFT only at the bins inside 0.15-0.6 Hz, with a Hann window; real and imaginary parts separately
  const bins = []; for (let k = 1; k < n / 2; k++) { const f = k * rate / n; if (f >= 0.15 && f <= 0.6) bins.push(k); }
  let B = 0;
  for (const ch of zone) {
    const a0 = ch.I.length - n;
    for (const part of [ch.I, ch.Q]) {
      let m = 0; for (let i = 0; i < n; i++) m += part[a0 + i]; m /= n;
      for (const k of bins) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
          const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (n + 1)), v = (part[a0 + i] - m) * w, ph = 2 * Math.PI * k * i / n;
          re += v * Math.cos(ph); im -= v * Math.sin(ph);
        }
        B += re * re + im * im;
      }
    }
  }
  const k2 = Math.round(2 * rate); let M = 0, c = 0;
  for (const ch of fast) {
    const L = ch.I.length;
    for (let i = L - k2 + 1; i < L; i++) { M += (ch.I[i] - ch.I[i - 1]) ** 2 + (ch.Q[i] - ch.Q[i - 1]) ** 2; c++; }
  }
  return { B: 10 * Math.log10(B + 1e-30), M: 10 * Math.log10(M / c + 1e-30) };
}
function pct(xs, q) { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; }
function holdStep(st, feat, nowMs) {
  if (!feat) return null;
  const dt = st.last === null ? 0 : (nowMs - st.last) / 1000; st.last = nowMs;
  st.M.push([nowMs, feat.M]); while (st.M[0][0] < nowMs - HOLD.floorSec * 1000) st.M.shift();
  const moving = feat.M > pct(st.M.map(x => x[1]), 0.2) + HOLD.moveDb;
  st.moving = moving;
  if (!moving) st.B.push([nowMs, feat.B]);
  while (st.B.length && st.B[0][0] < nowMs - HOLD.baseSec * 1000) st.B.shift();
  if (moving) { st.quiet = 0; st.below = 0; } else st.quiet += dt;
  if (st.B.length < 45) return null;   // need ~10 s of still history (analyze runs ~5 times a second)
  const base = pct(st.B.map(x => x[1]), 0.75);
  st.base = base; st.level = feat.B;
  if (!st.alerting) {
    if (st.quiet >= HOLD.quietSec && feat.B < base - HOLD.dropDb) { st.below += dt; st.holdStart ??= nowMs; }
    else { st.below = 0; st.holdStart = null; }
    if (st.below >= HOLD.confirmSec) { st.alerting = true; return 'start'; }
  } else if (moving || feat.B > base - HOLD.dropDb / 2) { st.alerting = false; st.below = 0; st.holdStart = null; return 'end'; }
  return null;
}

// ---------- slow-breathing detector ----------
// Opioid overdose usually slows breathing before it stops, and the hold detector above only sees a near-stop.
// Each analyze tick while the person is still counts as "slow" if the measured rate is under SLOW.bpm,
// or if there is no clear rhythm at all (quality <= SLOW.q; below ~5/min the rate cannot be read).
// Alert when SLOW.on of the last SLOW.winSec is slow; clear when it falls under SLOW.off. Ticks while
// moving count as not slow. Simulation: true 6/8/10/15 per min reads 6.0/7.8/10.2/15.0.
const SLOW = { bpm: 8.5, q: 0.25, winSec: 30, on: 0.8, off: 0.5 };
function makeSlow() { return { alerting: false, log: [] }; }
function slowStep(st, ch, moving, nowMs) {
  st.log.push([nowMs, !moving && (ch.quality <= SLOW.q || ch.bpm < SLOW.bpm)]);
  while (st.log[0][0] < nowMs - SLOW.winSec * 1000) st.log.shift();
  if (nowMs - st.log[0][0] < (SLOW.winSec - 1) * 1000) return null;   // need a full window first
  const frac = st.log.filter(x => x[1]).length / st.log.length;
  if (!st.alerting && frac >= SLOW.on) { st.alerting = true; return 'start'; }
  if (st.alerting && frac < SLOW.off) { st.alerting = false; return 'end'; }
  return null;
}

// ---------- automatic zone: find the slices that breathe ----------
// Breathing repeats: a chest slice's breathing-band (0.15-0.6 Hz) I/Q signal looks like itself
// one breath later. Slow drift (far, weak echoes) and fidgeting also put power in that band, but
// they do not repeat, so a power ratio cannot tell them apart and this can.
// Score = best normalised autocorrelation at lags of 1.6-6.7 s (9-37 breaths/min), over the last
// 512 frames (~22 s). Plain noise scores about 0.5, a breathing chest 0.6-0.8.
// Also returns snr = breathing-band power over the slice's own 1-5 Hz power (dB, per Hz). Weak copies
// of the chest's echo can repeat just as well, so ties go to the slice with the best snr. Raw power
// would favour slices next to the direct path, where the speaker's own sound leaks in.
// Offline evidence (2 takes): a breathing-band vs fast-band power ratio picked 91-142 cm on the still
// take (chest at 28-40 cm); this score picked 28-40 cm.
const ZONE = { n: 512, lagMin: 1.6, lagMax: 6.7, tauSec: 30, near: 0.05, back: 0.05, ahead: 0.23 };
function periodicity(ch, rate, n = ZONE.n) {
  if (ch.I.length < n) return null;
  const re = new Float64Array(n), im = new Float64Array(n), a0 = ch.I.length - n;
  for (let i = 0; i < n; i++) { re[i] = ch.I[a0 + i]; im[i] = ch.Q[a0 + i]; }
  fft(re, im);                                   // keep only the breathing band (both signs)
  let pb = 0, nb = 0, pf = 0, nf = 0;
  for (let k = 0; k < n; k++) {
    const f = Math.min(k, n - k) * rate / n, e = re[k] * re[k] + im[k] * im[k];
    if (f >= 1 && f <= 5) { pf += e; nf++; }
    if (f < 0.15 || f > 0.6) re[k] = im[k] = 0; else { pb += e; nb++; }
  }
  for (let k = 0; k < n; k++) im[k] = -im[k];    // inverse FFT = conj(fft(conj)); scale cancels below
  fft(re, im);
  for (let k = 0; k < n; k++) im[k] = -im[k];
  let best = 0;
  for (let L = Math.floor(ZONE.lagMin * rate); L < Math.floor(ZONE.lagMax * rate); L++) {
    let cr = 0, ci = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + L < n; i++) {
      const ar = re[i], ai = im[i], br = re[i + L], bi = im[i + L];
      cr += ar * br + ai * bi; ci += ai * br - ar * bi;      // x[i] * conj(x[i+L])
      e1 += ar * ar + ai * ai; e2 += br * br + bi * bi;
    }
    if (e1 > 0 && e2 > 0) best = Math.max(best, Math.hypot(cr, ci) / Math.sqrt(e1 * e2));
  }
  return { p: best, snr: 10 * Math.log10((pb / nb) / (pf / nf || 1e-30) + 1e-30) };
}

// ---------- Mode 1: steady tones ----------
class ToneSonar {
  constructor(freqs, rate = 100) {
    this.mode = 'tones'; this.rate = rate; this.freqs = freqs;
    this.all = [...freqs, ...freqs.map(f => f + 500)]; // +500 Hz = silent noise reference
    this.emit = this.all.map((_, i) => i < freqs.length);
    this.chs = freqs.map(f => makeChannel(C / f, rate));
    this.mag = this.all.map(() => 0);
    this.apnea = makeApnea(); this.best = null;
  }
  ingest({ I, Q }) {
    this.all.forEach((_, k) => { this.mag[k] += 0.01 * (Math.hypot(I[k], Q[k]) - this.mag[k]); });
    this.chs.forEach((ch, k) => pushIQ(ch, I[k], Q[k]));
  }
  snr(k) { const nz = this.mag[k + this.freqs.length]; return nz > 0 ? 20 * Math.log10(this.mag[k] / nz) : 0; }
  analyze(nowMs) {
    const ok = this.chs.filter(ch => analyzeChannel(ch));
    if (!ok.length) return null;
    this.best = ok.reduce((a, b) => (b.quality > a.quality ? b : a));
    const event = apneaStep(this.apnea, this.best.disp, this.rate, nowMs);
    return { ch: this.best, event };
  }
}

// ---------- Mode 2: range-resolved probe ----------
// The probe is one 2048-sample period (42.7 ms) made of every FFT bin from 18 to 20 kHz,
// with phases chosen (Schroeder) so the sum stays smooth. It repeats exactly, so it has no
// clicks and nothing below 18 kHz. Dividing each received frame's spectrum by the probe's
// spectrum gives the channel; an inverse FFT turns that into echo strength vs delay.
// 2 kHz of bandwidth -> ~9 cm resolution; 42.7 ms period -> echoes up to 7.3 m before wrap-around.
function makeProbe({ P = 2048, f0 = 18000, f1 = 20000, L = 128, sr = SR, rms = 0.408 } = {}) {
  const k0 = Math.ceil(f0 * P / sr), k1 = Math.floor(f1 * P / sr), K = k1 - k0 + 1;
  const phi = new Float64Array(K), cosP = new Float64Array(K), sinP = new Float64Array(K), win = new Float64Array(K);
  for (let q = 0; q < K; q++) {
    phi[q] = -Math.PI * q * q / K;
    cosP[q] = Math.cos(phi[q]); sinP[q] = Math.sin(phi[q]);
    win[q] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (q + 1) / (K + 1)); // Hann: lowers range sidelobes
  }
  const scale = rms / Math.sqrt(K / 2); // same loudness (RMS) as the 3-tone signal
  const sig = new Float32Array(P);
  for (let q = 0; q < K; q++) {
    const w = 2 * Math.PI * (k0 + q) / P;
    for (let n = 0; n < P; n++) sig[n] += scale * Math.cos(w * n + phi[q]);
  }
  return { P, L, k0, k1, K, sr, f0, f1, phi, cosP, sinP, win, scale, sig,
    gain: P / 2 * scale, rate: sr / P, dr: (P / L) / sr * C / 2, lambda: C / ((f0 + f1) / 2) };
}

// One mic frame -> complex echo profile h[0..L-1] (tap m = delay of m*P/L samples) + band SNR.
function cir(p, frame) {
  const re = Float64Array.from(frame), im = new Float64Array(p.P);
  fft(re, im);
  const hr = new Float64Array(p.L), hi = new Float64Array(p.L);
  let sig = 0, noise = 0, nn = 0;
  for (let q = 0; q < p.K; q++) {
    const Yr = re[p.k0 + q], Yi = im[p.k0 + q];
    sig += Yr * Yr + Yi * Yi;
    const w = p.win[q] / p.gain;
    hr[q] = (Yr * p.cosP[q] + Yi * p.sinP[q]) * w;      // Y / X, then window
    hi[q] = -((Yi * p.cosP[q] - Yr * p.sinP[q]) * w);   // conjugated for inverse FFT
  }
  for (let k = p.k1 + 10; k < p.k1 + 60 && k < p.P / 2; k++) { noise += re[k] ** 2 + im[k] ** 2; nn++; }
  fft(hr, hi);
  for (let m = 0; m < p.L; m++) hi[m] = -hi[m];
  return { re: hr, im: hi, snr: 10 * Math.log10((sig / p.K) / (noise / nn || 1e-30)) };
}

class RangeSonar {
  constructor({ minR = 0.2, maxR = 1.2, showR = 3, zone = [0.29, 0.57] } = {}) {
    this.mode = 'range';
    this.p = makeProbe(); this.rate = this.p.rate; this.dr = this.p.dr;
    this.chs = Array.from({ length: this.p.L }, () => makeChannel(this.p.lambda, this.rate));
    this.emaR = new Float64Array(this.p.L); this.emaI = new Float64Array(this.p.L);
    this.nShow = Math.ceil(showR / this.dr);
    this.depth = [];          // last 20 s of motion-by-range columns, for the depth view
    this.i0 = null; this.frames = 0; this.snr = 0;
    this.minR = minR; this.maxR = maxR;
    this.lock = null; this.manual = false; this.lastPick = -1e9;
    this.zone = zone;   // distances (m) the hold detector watches; until the first auto pick, alerts are off
    this.zscore = null; this.zs = null; this.stillLog = [];  // zone picker state (see pickZone)
    this.apnea = makeHold(); this.best = null;
    this.slow = makeSlow(); this.alerting = false; this.why = null;   // why = 'hold' | 'slow' while alerting
  }
  tap(rel) { return (this.i0 + rel) % this.p.L; }
  ingestFrame(frame) { const c = cir(this.p, frame); this.ingestCIR(c.re, c.im, c.snr); }
  ingestCIR(re, im, snr) {
    this.frames++;
    this.snr += (snr - this.snr) * (this.frames < 10 ? 0.5 : 0.05);
    const L = this.p.L, a = this.frames < 10 ? 0.5 : 1 / (this.rate * 8);
    if (this.i0 === null && this.frames === 12) { // direct speaker->mic sound is the strongest echo = range 0
      let bm = 0; for (let m = 0; m < L; m++) { const v = Math.hypot(re[m], im[m]); if (v > bm) { bm = v; this.i0 = m; } }
    }
    for (let m = 0; m < L; m++) {
      pushIQ(this.chs[m], re[m], im[m]);
      this.emaR[m] += a * (re[m] - this.emaR[m]); this.emaI[m] += a * (im[m] - this.emaI[m]);
    }
    if (this.i0 !== null) { // motion by range = distance from the slow average (the still echoes)
      const col = new Float32Array(this.nShow);
      for (let r = 0; r < this.nShow; r++) { const m = this.tap(r); col[r] = Math.hypot(re[m] - this.emaR[m], im[m] - this.emaI[m]); }
      this.depth.push(col);
      if (this.depth.length > 20 * this.rate) this.depth.shift();
    }
  }
  setLock(rangeM) { this.manual = true; this.setZone(rangeM); }   // user picked the distance: no auto moves
  setZone(rangeM) {
    this.lock = Math.round(rangeM / this.dr);
    this.zone = [Math.max(0.2, rangeM - ZONE.back), rangeM + ZONE.ahead];   // chest echoes plus their later bounces
    const M = this.apnea.M; this.apnea = makeHold(); this.apnea.M = M;     // new zone = new level; keep movement floor
  }
  // Once a second: score every slice in minR..maxR and keep a slow (30 s) average. Each window
  // counts in proportion to how much of it the person was still, so movement barely counts but
  // never starves the picker. The zone goes on the strongest slice among those whose score is
  // within ZONE.near of the best (strongest = best snr). It moves only when the current slice falls
  // out of that group and no hold is suspected. During a hold every slice looks like noise, so the
  // scores sink evenly and the zone stays put.
  pickZone(nowMs) {
    const winMs = ZONE.n / this.rate * 1000, log = this.stillLog;
    log.push([nowMs, this.apnea.moving !== true]);
    while (log[0][0] < nowMs - winMs) log.shift();
    if (this.manual) return;
    const r0 = Math.max(1, Math.ceil(this.minR / this.dr)), r1 = Math.round(this.maxR / this.dr);
    const sc = []; for (let r = r0; r <= r1; r++) sc[r] = periodicity(this.chs[this.tap(r)], this.rate);
    if (sc[r0] === null) return;
    const w = log.filter(x => x[1]).length / log.length, d = 1 - 1 / ZONE.tauSec, z = this.zs ??= { p: [], snr: [], w: 0 };
    z.w = d * z.w + w;
    for (let r = r0; r <= r1; r++) { z.p[r] = d * (z.p[r] ?? 0) + w * sc[r].p; z.snr[r] = d * (z.snr[r] ?? 0) + w * sc[r].snr; }
    if (z.w < 1) return;                                       // not one still window's worth yet
    const S = r => z.p[r] / z.w;
    let top = 0; for (let r = r0; r <= r1; r++) top = Math.max(top, S(r));
    let b = null;
    for (let r = r0; r <= r1; r++) if (S(r) >= top - ZONE.near && (b === null || z.snr[r] > z.snr[b])) b = r;
    this.zscore = Array.from({ length: r1 + 1 }, (_, r) => (r < r0 ? null : S(r)));   // for display / debugging
    if (this.lock === null) return this.setZone(b * this.dr);
    if (S(this.lock) < top - ZONE.near && !this.apnea.alerting && this.apnea.holdStart === null) this.setZone(b * this.dr);
  }
  analyze(nowMs) {
    if (this.i0 === null || this.frames < 15 * this.rate) return null;
    const r0 = Math.round(this.zone[0] / this.dr), r1 = Math.round(this.zone[1] / this.dr);
    const zone = [], fast = [];
    for (let r = r0; r <= r1; r++) zone.push(this.chs[this.tap(r)]);
    for (let r = 1; r <= 12; r++) fast.push(this.chs[this.tap(r)]);
    // runs before the first pick too, so the movement flag is ready to keep movement out of the scores
    holdStep(this.apnea, holdFeatures(zone, fast, this.rate), nowMs);
    if (nowMs - this.lastPick >= 1000) { this.lastPick = nowMs; this.pickZone(nowMs); }
    if (this.lock === null) return null;
    const ch = this.chs[this.tap(this.lock)];
    if (!analyzeChannel(ch)) return null;
    this.best = ch;
    slowStep(this.slow, ch, this.apnea.moving === true, nowMs);
    // one alarm for both detectors: 'start' when the first one fires, 'end' when both have cleared
    const was = this.alerting;
    this.alerting = this.apnea.alerting || this.slow.alerting;
    if (this.alerting) this.why ??= this.apnea.alerting ? 'hold' : 'slow'; else this.why = null;
    return { ch, event: !was && this.alerting ? 'start' : was && !this.alerting ? 'end' : null, why: this.why };
  }
}

const api = { C, SR, TONE_WORKLET, PROBE_WORKLET, APNEA, std, fft, fitCircle, breathingSpectrum,
  makeChannel, pushIQ, analyzeChannel, makeApnea, apneaStep, HOLD, makeHold, holdFeatures, holdStep, SLOW, makeSlow, slowStep, ZONE, periodicity, makeProbe, cir, ToneSonar, RangeSonar };
if (typeof module !== 'undefined') module.exports = api; else window.DSP = api;
})();
