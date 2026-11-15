// Measure what the recordings look like, slice by slice, so a simulation can be fitted to it.
// For each label (normal, hold, moving, empty room) and each distance slice: the still echo strength and
// the motion level in five speed bands, all relative to the direct speaker->mic sound of that take.
// Works on real takes or on simulated frames (measureFrames), so both are measured the same way.
// Usage: node tools/fit/measure.js [out.json]
const T = require('./takes.js'), { BANDS, bandPower, dB, med } = require('./bands.js'), fs = require('fs');
const R = 24, W = 8, NAMES = Object.keys(BANDS);
const CLASS = { normal: 'normal', hold: 'hold', moving: 'moving', 'empty room': 'empty' };

// -> { A0, cls: { normal: { n, bands: {breath: [per slice median dB re A0^2], ...}, still: [per slice dB re A0] }, ... } }
function measureFrames(fr, segs) {
  const n = Math.round(W * fr.rate), a0 = [];
  for (let f = 12; f < fr.n; f += 23) a0.push(Math.hypot(fr.re[f * fr.L + fr.i0], fr.im[f * fr.L + fr.i0]));
  const A0 = med(a0), acc = {};
  for (const s of segs) {
    const c = CLASS[s.label]; if (!c) continue;
    // skip the first seconds of a segment (reaction time, and windows straddling two labels)
    const lead = c === 'hold' ? 2 : c === 'moving' ? 0 : 4, a = s.a + lead, b = Math.min(s.b, fr.n / fr.rate);
    const w = c === 'moving' ? Math.min(W, b - a) : W, nn = Math.round(w * fr.rate); if (nn < 4 * fr.rate) continue;
    const A = acc[c] ??= { n: 0, still: Array.from({ length: R }, () => []), bands: Object.fromEntries(NAMES.map(k => [k, Array.from({ length: R }, () => [])])) };
    for (let t = a; t + w <= b + 1e-6; t += 2) {
      const f0 = Math.round(t * fr.rate); if (f0 + nn > fr.n) break;
      A.n++;
      for (let r = 0; r < R; r++) { const p = bandPower(fr, r, f0, nn); A.still[r].push(20 * Math.log10(p.mean / A0 + 1e-15)); for (const k of NAMES) A.bands[k][r].push(dB(p[k] / A0 ** 2)); }
    }
  }
  const cls = {};
  for (const c in acc) cls[c] = { n: acc[c].n, still: acc[c].still.map(med), bands: Object.fromEntries(NAMES.map(k => [k, acc[c].bands[k].map(med)])) };
  return { A0, cls };
}
// median across takes, per class/band/slice
function pool(list) {
  const out = {};
  for (const c of ['normal', 'hold', 'moving', 'empty']) {
    const have = list.filter(m => m.cls[c]); if (!have.length) continue;
    out[c] = { takes: have.length, windows: have.reduce((a, m) => a + m.cls[c].n, 0), still: [], bands: {} };
    for (let r = 0; r < R; r++) out[c].still[r] = +med(have.map(m => m.cls[c].still[r])).toFixed(1);
    for (const k of NAMES) out[c].bands[k] = Array.from({ length: R }, (_, r) => +med(have.map(m => m.cls[c].bands[k][r])).toFixed(1));
  }
  return out;
}
function show(p, title) {
  console.log('\n' + title + '  (dB relative to the direct sound; columns = distance in cm)');
  console.log(' '.repeat(22) + Array.from({ length: R }, (_, r) => String(Math.round(r * 5.72)).padStart(4)).join(''));
  for (const c in p) {
    console.log(`${c} (${p[c].takes} takes, ${p[c].windows} windows)`);
    console.log('  still echo'.padEnd(22) + p[c].still.map(v => v.toFixed(0).padStart(4)).join(''));
    for (const k of NAMES) console.log(`  ${k} ${BANDS[k][0]}-${BANDS[k][1]} Hz`.padEnd(22) + p[c].bands[k].map(v => v.toFixed(0).padStart(4)).join(''));
  }
}
module.exports = { measureFrames, pool, show, R, W, NAMES };
if (require.main === module) {
  const per = [];
  for (const id of T.ids()) { const fr = T.load(id); if (!fr || fr.n / fr.rate < 30) continue; per.push({ id, i0: fr.i0, snr: +med(Array.from(fr.snr)).toFixed(1), ...measureFrames(fr, fr.m.segs) }); }
  console.log('take      direct-path amplitude, probe SNR dB, direct tap');
  for (const m of per) console.log(m.id.slice(16, 24), m.A0.toExponential(2), m.snr, m.i0);
  const p = pool(per); show(p, 'Recorded takes, median across takes');
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ made: new Date().toISOString(), W, sliceCm: 5.72, bands: BANDS, pooled: p, takes: per }, null, 1));
}
