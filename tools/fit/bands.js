// Per-slice band levels of a frame stream, in windows. Used by measure.js (real takes) and by the fit
// (simulated frames), so both are measured the same way.
// bandPower(fr, r, f0, nWin): for slice r (relative to the direct path), window of nWin frames starting
// at f0 -> power in each band, summed over I and Q, Hann window, mean removed (same recipe as holdFeatures).
const BANDS = { drift: [0.03, 0.15], breath: [0.15, 0.6], mid: [0.6, 2], fast: [2, 6], noise: [6, 11.7] };
const cache = new Map();
function plan(n, rate) {
  const key = n + ':' + rate; if (cache.has(key)) return cache.get(key);
  const win = new Float64Array(n); let w2 = 0; for (let i = 0; i < n; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (n + 1)); w2 += win[i] ** 2; }
  const bins = {}, nb = {};
  for (const [name, [a, b]] of Object.entries(BANDS)) { bins[name] = []; for (let k = 1; k <= n / 2; k++) { const f = k * rate / n; if (f >= a && f < b) bins[name].push(k); } nb[name] = bins[name].length; }
  const pl = { win, w2, bins, nb, cos: new Float64Array(n), sin: new Float64Array(n) };
  for (let i = 0; i < n; i++) { pl.cos[i] = Math.cos(2 * Math.PI * i / n); pl.sin[i] = Math.sin(2 * Math.PI * i / n); }
  cache.set(key, pl); return pl;
}
// Returns per-band power DENSITY (per bin, normalised so white noise of variance v per component gives v
// in every band): comparable across bands and window lengths.
function bandPower(fr, r, f0, n) {
  const pl = plan(n, fr.rate), L = fr.L, tap = (fr.i0 + r) % L, out = {};
  const x = new Float64Array(n), y = new Float64Array(n); let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { x[i] = fr.re[(f0 + i) * L + tap]; y[i] = fr.im[(f0 + i) * L + tap]; mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  for (let i = 0; i < n; i++) { x[i] = (x[i] - mx) * pl.win[i]; y[i] = (y[i] - my) * pl.win[i]; }
  for (const name in pl.bins) {
    let p = 0;
    for (const k of pl.bins[name]) {
      let ar = 0, ai = 0, br = 0, bi = 0;
      for (let i = 0; i < n; i++) { const j = (k * i) % n, c = pl.cos[j], s = pl.sin[j]; ar += x[i] * c; ai -= x[i] * s; br += y[i] * c; bi -= y[i] * s; }
      p += ar * ar + ai * ai + br * br + bi * bi;
    }
    out[name] = p / (pl.nb[name] || 1) / pl.w2 / 2;   // /2: average of I and Q components
  }
  out.mean = Math.hypot(mx, my);
  return out;
}
const dB = v => 10 * Math.log10(v + 1e-30);
const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
module.exports = { BANDS, bandPower, dB, med, q };
