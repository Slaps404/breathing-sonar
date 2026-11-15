// Compare ways of choosing the slice to watch. Truth = zone drop: breathing-speed power summed over the zone the
// detector would watch from a lock at slice r (r-1 .. r+4), normal vs hold (dB). Bigger = holds easier to see.
// Each picker only sees the first still stretch of the take (before any hold), like the live lock-on.
const T = require('../fit/takes.js'), B = require('../fit/bands.js'), R = require('./lib.js');
const R0 = 3, R1 = 21;   // 17-120 cm, the detector's own search range is 20-120 cm
function zoneDrop(fr) {
  const n = Math.round(8 * fr.rate), lv = { normal: [], hold: [] };
  for (const s of fr.m.segs) {
    if (s.label !== 'normal' && s.label !== 'hold') continue;
    for (let t = s.a + (s.label === 'hold' ? 4 : 2); t + 8 <= s.b; t += 2) { const f0 = Math.round(t * fr.rate); if (f0 + n > fr.n) break; const row = []; for (let r = R0 - 1; r <= R1 + 4; r++) row[r] = B.bandPower(fr, r, f0, n).breath; lv[s.label].push(row); }
  }
  if (lv.hold.length < 2 || lv.normal.length < 4) return null;
  const z = (rows, r) => B.med(rows.map(x => { let s = 0; for (let k = r - 1; k <= r + 4; k++) s += x[k]; return s; }));
  const out = []; for (let r = R0; r <= R1; r++) out[r] = B.dB(z(lv.normal, r) / z(lv.hold, r));
  return out;
}
// features per slice from the first still stretch [a, a+n)
function features(fr, a, n) {
  const f = [];
  for (let r = R0; r <= R1; r++) {
    const bp = B.bandPower(fr, r, a, n), ln = R.smooth(R.line(fr, r, a, n), Math.round(0.6 * fr.rate)), ac = R.autocorr(ln, fr.rate);
    // rhythm in breathing range only: best repeat between 2.5 s and 7.5 s (8-24 breaths/min)
    let rb = 0; for (let l = Math.round(2.5 * fr.rate); l <= Math.round(7.5 * fr.rate); l++) if (ac.ac[l] > ac.ac[l - 1] && ac.ac[l] >= ac.ac[l + 1]) rb = Math.max(rb, ac.ac[l]);
    f[r] = { rhythm: rb, breath: B.dB(bp.breath), overFast: B.dB(bp.breath / bp.fast), overDrift: B.dB(bp.breath / bp.drift), overNoise: B.dB(bp.breath / bp.noise) };
  }
  return f;
}
const argmax = (fn) => { let b = R0; for (let r = R0; r <= R1; r++) if (fn(r) > fn(b)) b = r; return b; };
// closest run of slices within `near` of the best score; inside it the slice with the best tie-break
function closestRun(f, key, near, tie) {
  const top = Math.max(...f.slice(R0).map(x => x[key])), ok = r => f[r][key] >= top - near; let r = R0, b = null;
  while (r <= R1 && !ok(r)) r++; for (; r <= R1 && ok(r); r++) if (b === null || f[r][tie] > f[b][tie]) b = r; return b;
}
const PICKERS = {
  'most rhythmic': f => argmax(r => f[r].rhythm),
  'closest rhythmic run': f => closestRun(f, 'rhythm', 0.1, 'overFast'),
  'breathing over fast': f => argmax(r => f[r].overFast),
  'breathing over noise': f => argmax(r => f[r].overNoise),
  'breathing over drift': f => argmax(r => f[r].overDrift),
  'rhythm x over-noise': f => argmax(r => f[r].rhythm * Math.max(0, f[r].overNoise)),
  'closest strong (over-noise within 6 dB of best)': f => closestRun(f, 'overNoise', 6, 'rhythm'),
  'closest strong (over-noise within 10 dB of best)': f => closestRun(f, 'overNoise', 10, 'rhythm'),
};
module.exports = { zoneDrop, features, PICKERS, R0, R1 };
if (require.main === module) {
  const tot = {}, list = [];
  for (const id of T.ids()) {
    const fr = T.load(id); if (!fr) continue; const z = zoneDrop(fr); if (!z) continue;
    const snr = [...fr.snr].sort((a, b) => a - b)[fr.n >> 1]; if (snr < 20) continue;
    const first = fr.m.segs[0], end = Math.min(first.label === 'normal' ? first.b : 40, 45), a = Math.round(5 * fr.rate), n = Math.round((end - 5) * fr.rate);
    const f = features(fr, a, n), best = Math.max(...z.slice(R0)), det = T.detect(fr), lock = det.locks[0] ? Math.min(R1, Math.max(R0, Math.round(det.locks[0].cm / 100 / fr.dr))) : null;
    const cm = r => Math.round(r * fr.dr * 100), row = { id: id.slice(16, 24), best, live: lock === null ? null : z[lock] };
    let line = `${row.id} best zone ${best.toFixed(1).padStart(5)} dB | live lock ${lock === null ? 'none' : cm(lock) + 'cm ' + z[lock].toFixed(1)}`;
    for (const name in PICKERS) { const r = PICKERS[name](f); row[name] = z[r]; (tot[name] ??= []).push(best - z[r]); }
    (tot['LIVE detector'] ??= []).push(lock === null ? best : best - z[lock]);
    list.push(row); console.log(line, '| zone drop by lock slice:', z.slice(R0).map(v => v.toFixed(0)).join(' '));
  }
  console.log('\nShortfall vs the best possible zone (dB lost, lower is better): mean | worst | takes within 3 dB');
  for (const name of Object.keys(tot).sort((a, b) => B.med(tot[a]) - B.med(tot[b]))) { const v = tot[name]; console.log(' ', name.padEnd(50), (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).padStart(5), Math.max(...v).toFixed(1).padStart(6), `${v.filter(x => x <= 3).length}/${v.length}`.padStart(6), ' per take:', v.map(x => x.toFixed(0)).join(' ')); }
}
