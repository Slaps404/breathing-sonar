// Measure what the recordings look like, slice by slice, so a simulation can be fitted to it.
// For each label (normal, hold, moving, empty room) and each distance slice: the still echo strength and
// the motion level in five speed bands, all relative to the direct speaker->mic sound of that take.
// Works on real takes or on simulated frames (measureFrames), so both are measured the same way.
// Usage: node tools/fit/measure.js [out.json]
const T = require('./takes.js'), { BANDS, bandPower, dB, med, q } = require('./bands.js'), fs = require('fs');
const D = T.D;
const R = 24, W = 8, NAMES = Object.keys(BANDS);
const CLASS = { normal: 'normal', hold: 'hold', moving: 'moving', 'empty room': 'empty' };

// -> { A0, cls: { normal: { n, bands: {breath: [per slice median dB re A0^2], ...}, still: [per slice dB re A0] }, ... } }
function measureFrames(fr, segs) {
  const n = Math.round(W * fr.rate), a0 = [];
  for (let f = 12; f < fr.n; f += 23) a0.push(Math.hypot(fr.re[f * fr.L + fr.i0], fr.im[f * fr.L + fr.i0]));
  const A0 = med(a0), acc = {};
  for (const s of segs) {
    const c = CLASS[s.label]; if (!c) continue;
    // skip the first seconds of a segment (windows straddling two labels). Holds: 5 s, because after the banner
    // says "hold" the person still finishes a breath; with 2 s the hold levels came out 3-5 dB too high.
    const lead = c === 'hold' ? 5 : c === 'moving' ? 0 : 4, a = s.a + lead, b = Math.min(s.b, fr.n / fr.rate);
    const w = c === 'moving' ? Math.min(W, b - a) : W, nn = Math.round(w * fr.rate); if (nn < 4 * fr.rate) continue;
    const A = acc[c] ??= { n: 0, still: Array.from({ length: R }, () => []), bands: Object.fromEntries(NAMES.map(k => [k, Array.from({ length: R }, () => [])])) };
    for (let t = a; t + w <= b + 1e-6; t += c === 'hold' ? 1 : 2) {
      const f0 = Math.round(t * fr.rate); if (f0 + nn > fr.n) break;
      A.n++;
      for (let r = 0; r < R; r++) { const p = bandPower(fr, r, f0, nn); A.still[r].push(20 * Math.log10(p.mean / A0 + 1e-15)); for (const k of NAMES) A.bands[k][r].push(dB(p[k] / A0 ** 2)); }
    }
  }
  // Rhythm per slice during normal breathing: the detector's own zone score (dsp.js periodicity: how well the
  // slice's breathing-band signal repeats one breath later, and its breathing-band vs 1-5 Hz power in dB).
  // This is what picks the watched distance, so a simulation has to match it, not only motion levels.
  const nz = D.ZONE.n, rp = Array.from({ length: R }, () => []), rs = Array.from({ length: R }, () => []);
  for (const s of segs) {
    if (s.label !== 'normal') continue;
    for (let t = s.a + 4; t + nz / fr.rate <= Math.min(s.b, fr.n / fr.rate) + 1e-6; t += 8) {
      const f0 = Math.round(t * fr.rate); if (f0 + nz > fr.n) break;
      for (let r = 0; r < R; r++) {
        const tap = (fr.i0 + r) % fr.L, ch = { I: new Float64Array(nz), Q: new Float64Array(nz) };
        for (let i = 0; i < nz; i++) { ch.I[i] = fr.re[(f0 + i) * fr.L + tap]; ch.Q[i] = fr.im[(f0 + i) * fr.L + tap]; }
        const z = D.periodicity(ch, fr.rate); rp[r].push(z.p); rs[r].push(z.snr);
      }
    }
  }
  const cls = {};
  const rhythm = rp[0].length ? { n: rp[0].length, p: rp.map(med), snr: rs.map(med) } : null;
  // spread = how much the breathing-band level of a slice swings over the windows (90th minus 10th percentile, dB)
  const sp = a => a.length >= 4 ? q(a, 0.9) - q(a, 0.1) : null;
  for (const c in acc) cls[c] = { n: acc[c].n, still: acc[c].still.map(med), bands: Object.fromEntries(NAMES.map(k => [k, acc[c].bands[k].map(med)])), spread: acc[c].bands.breath.map(sp) };
  return { A0, cls, rhythm };
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
  const hr = list.filter(m => m.rhythm);
  if (hr.length) out.rhythm = { takes: hr.length, p: Array.from({ length: R }, (_, r) => +med(hr.map(m => m.rhythm.p[r])).toFixed(3)), snr: Array.from({ length: R }, (_, r) => +med(hr.map(m => m.rhythm.snr[r])).toFixed(1)) };
  return out;
}
function show(p, title) {
  console.log('\n' + title + '  (dB relative to the direct sound; columns = distance in cm)');
  console.log(' '.repeat(22) + Array.from({ length: R }, (_, r) => String(Math.round(r * 5.72)).padStart(4)).join(''));
  if (p.rhythm) { console.log(`rhythm while breathing normally (${p.rhythm.takes} takes)`);
    console.log('  repeat score x100'.padEnd(22) + p.rhythm.p.map(v => (100 * v).toFixed(0).padStart(4)).join(''));
    console.log('  breath vs 1-5 Hz dB'.padEnd(22) + p.rhythm.snr.map(v => v.toFixed(0).padStart(4)).join('')); }
  for (const c of ['normal', 'hold', 'moving', 'empty']) { if (!p[c]) continue;
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
