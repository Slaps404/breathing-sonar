// Breathing-rate experiments on paced takes (known rate). Each method turns a window of echo slices into one
// "chest line" and reads its rate from how often the line repeats. Nothing here is used by the live detector.
const T = require('../fit/takes.js');

// slice -> movement along its main axis in the window, slow drift (12 s average) removed
function line(fr, rr, a, n, driftSec = 12) {
  const L = fr.L, tap = (fr.i0 + rr) % L, x = new Float64Array(n), y = new Float64Array(n); let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { x[k] = fr.re[(a + k) * L + tap]; y[k] = fr.im[(a + k) * L + tap]; mx += x[k]; my += y[k]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0; for (let k = 0; k < n; k++) { x[k] -= mx; y[k] -= my; sxx += x[k] * x[k]; syy += y[k] * y[k]; sxy += x[k] * y[k]; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th), v = new Float64Array(n);
  for (let k = 0; k < n; k++) v[k] = x[k] * c + y[k] * s;
  return detrend(v, Math.round(driftSec * fr.rate));
}
function detrend(v, w) {   // subtract a centred moving average of w samples
  const n = v.length, cs = new Float64Array(n + 1), out = new Float64Array(n);
  for (let k = 0; k < n; k++) cs[k + 1] = cs[k] + v[k];
  for (let k = 0; k < n; k++) { const a = Math.max(0, k - (w >> 1)), b = Math.min(n, k + (w >> 1) + 1); out[k] = v[k] - (cs[b] - cs[a]) / (b - a); }
  return out;
}
function smooth(v, w) { const n = v.length, cs = new Float64Array(n + 1), out = new Float64Array(n); for (let k = 0; k < n; k++) cs[k + 1] = cs[k] + v[k];
  for (let k = 0; k < n; k++) { const a = Math.max(0, k - (w >> 1)), b = Math.min(n, k + (w >> 1) + 1); out[k] = (cs[b] - cs[a]) / (b - a); } return out; }
// how well v matches itself shifted by each lag (1 = perfectly), lags from 36/min to 4/min
function autocorr(v, rate) {
  const n = v.length, lo = Math.round(60 / 36 * rate), hi = Math.min(Math.round(15 * rate), n >> 1), ac = new Float64Array(hi + 2); let e = 0;
  for (const z of v) e += z * z;
  for (let l = lo - 1; l <= hi + 1; l++) { let s = 0; for (let k = 0; k + l < n; k++) s += v[k] * v[k + l]; ac[l] = e ? s / e * n / (n - l) : 0; }
  return { ac, lo, hi };
}
// rate from the repeat curve. first=true: take the shortest repeat that is nearly as strong as the best one
// (a 4 s breath also repeats at 8 and 12 s; taking the strongest alone reads those as slow breathing)
function pick({ ac, lo, hi }, rate, first = true, near = 0.85) {
  const peaks = []; for (let l = lo; l <= hi; l++) if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > 0) peaks.push(l);
  if (!peaks.length) return { bpm: null, r: 0 };
  const top = Math.max(...peaks.map(l => ac[l])), l = first ? peaks.find(l => ac[l] >= near * top) : peaks.find(l => ac[l] === top);
  return { bpm: 60 * rate / l, r: ac[l] };
}
const METHODS = {
  // one slice, strongest repeat (what the table in chat used)
  'one slice, strongest repeat': (fr, a, n, o) => pick(autocorr(line(fr, o.rr, a, n), fr.rate), fr.rate, false),
  'one slice, shortest strong repeat': (fr, a, n, o) => pick(autocorr(smooth(line(fr, o.rr, a, n), o.sm), fr.rate), fr.rate, true),
  // several slices: average their repeat curves, so a rhythm they share adds up and each slice's own noise does not
  'slices averaged, shortest strong repeat': (fr, a, n, o) => {
    let sum = null, meta;
    for (let rr = o.r0; rr <= o.r1; rr++) { const c = autocorr(smooth(line(fr, rr, a, n), o.sm), fr.rate); meta = c; if (!sum) sum = new Float64Array(c.ac.length); for (let i = 0; i < sum.length; i++) sum[i] += c.ac[i] / (o.r1 - o.r0 + 1); }
    return pick({ ac: sum, lo: meta.lo, hi: meta.hi }, fr.rate, true);
  },
};
// score a paced take: windows fully inside one paced part; right = within 20 % of the paced rate
function score(fr, parts, method, o, winSec = 30, step = 5) {
  const n = Math.round(winSec * fr.rate), rows = [];
  for (const p of parts) for (let t = p.a + 4; t + winSec <= p.b - 2; t += step) {
    const q = METHODS[method](fr, Math.round(t * fr.rate), n, o);
    rows.push({ t: t + winSec / 2, truth: p.bpm, bpm: q.bpm, r: q.r, ok: q.bpm !== null && Math.abs(q.bpm - p.bpm) <= 0.2 * p.bpm });
  }
  return rows;
}
module.exports = { T, line, detrend, smooth, autocorr, pick, METHODS, score };
