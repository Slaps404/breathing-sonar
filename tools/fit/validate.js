// The real test of the simulation: does the LIVE DETECTOR behave on simulated takes the way it behaves on
// the recorded ones? Nothing here was used to fit the simulation (fit.js only matched echo motion levels).
// For each fitted take: replay the recording, then run N simulated twins (same plan, different random
// noise/sway) and compare: holds caught, time to alarm, false alarms, locked distance, and the detector's
// own hold feature (drop of the breathing level in the watched zone during each hold).
// Usage: node tools/fit/validate.js [twins=12] [out.json]
const fs = require('fs'), path = require('path');
const T = require('./takes.js'), S = require('./scene.js'), F = require('./fit.js'), { BANDS, med, q } = require('./bands.js');
const N = +(process.argv[2] || 12);
const room = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/measured.json'))).pooled.empty;
const fitted = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/fitted.json'))).takes;

// drop of the detector's level (dB below its own baseline) at the deepest 2 s of each hold, plus first lock
function summarize(fr, segs) {
  const det = T.detect(fr, { trace: true }), sc = T.score(det.events, segs), holds = segs.filter(s => s.label === 'hold');
  const drops = holds.map(h => { const x = det.trace.filter(v => v.t >= h.a + 4 && v.t < h.b && v.B !== undefined && v.base !== undefined).map(v => v.base - v.B); return x.length ? +q(x, 0.9).toFixed(1) : null; });
  const normalTicks = det.trace.filter(v => { const s = segs.find(l => v.t >= l.a && v.t < l.b); return s && s.label === 'normal' && v.q !== null; });
  return { caught: sc.caught, holds: holds.length, lat: sc.holds.map(h => h.latency), false: sc.false.length, lock: det.locks[0]?.cm ?? null, relocks: det.locks.length - 1, drops,
    quality: normalTicks.length ? +med(normalTicks.map(v => v.q)).toFixed(2) : null, bpm: normalTicks.length ? +med(normalTicks.filter(v => v.q > 0.5).map(v => v.bpm)).toFixed(1) : null };
}
const rows = [];
for (const ft of fitted) {
  const fr = T.load(ft.id), segs = fr.m.segs, Tsec = fr.n / fr.rate, real = summarize(fr, segs), sims = [];
  for (let s = 1; s <= N; s++) sims.push(summarize(S.simulate({ segs, T: Tsec, person: F.person(ft.v, ft.bpm), room, bands: BANDS, seed: 1000 + s }), segs));
  rows.push({ id: ft.id, real, sims });
  const lats = sims.flatMap(x => x.lat.filter(v => v !== null)), all = sims.flatMap(x => x.lat);
  console.log(`\n${ft.id.slice(16, 24)}  (fit mismatch ${ft.unseen} dB)`);
  console.log(`  holds caught   real ${real.caught}/${real.holds}   sim ${(100 * sims.reduce((a, x) => a + x.caught, 0) / (N * real.holds)).toFixed(0)}% of ${N * real.holds}  (per twin: ${sims.map(x => x.caught).join(' ')})`);
  console.log(`  per hold       real ${real.lat.map(v => v ?? 'X').join(' ')}   sim caught-rate ${real.lat.map((_, i) => Math.round(100 * sims.filter(x => x.lat[i] !== null).length / N) + '%').join(' ')}`);
  console.log(`  time to alarm  real median ${med(real.lat.filter(v => v !== null)).toFixed(1)} s   sim median ${lats.length ? med(lats).toFixed(1) : '-'} s (10-90%: ${lats.length ? q(lats, 0.1) + '-' + q(lats, 0.9) : '-'})`);
  console.log(`  false alarms   real ${real.false}   sim mean ${(sims.reduce((a, x) => a + x.false, 0) / N).toFixed(2)} per take`);
  console.log(`  first lock     real ${real.lock} cm   sim ${sims.map(x => x.lock).join(' ')} cm`);
  console.log(`  hold drop dB   real ${real.drops.join(' ')}   sim median per hold ${real.drops.map((_, i) => med(sims.map(x => x.drops[i]).filter(v => v !== null)).toFixed(1)).join(' ')}`);
  console.log(`  rhythm quality real ${real.quality} (${real.bpm}/min)   sim ${med(sims.map(x => x.quality)).toFixed(2)} (${med(sims.map(x => x.bpm).filter(Number.isFinite)).toFixed(1)}/min)`);
}
const R = rows.reduce((a, r) => ({ c: a.c + r.real.caught, h: a.h + r.real.holds, f: a.f + r.real.false }), { c: 0, h: 0, f: 0 });
const Sm = rows.reduce((a, r) => ({ c: a.c + r.sims.reduce((x, s) => x + s.caught, 0), h: a.h + N * r.real.holds, f: a.f + r.sims.reduce((x, s) => x + s.false, 0) / N }), { c: 0, h: 0, f: 0 });
console.log(`\nTOTAL  holds caught: real ${R.c}/${R.h} (${(100 * R.c / R.h).toFixed(0)}%)   sim ${(100 * Sm.c / Sm.h).toFixed(0)}%   | false alarms per 5 takes: real ${R.f}   sim ${Sm.f.toFixed(1)}`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ made: new Date().toISOString(), twins: N, rows }, null, 1));
