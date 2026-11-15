// The real test of the simulation: does the LIVE DETECTOR behave on simulated takes the way it behaves on
// the recorded ones? Detector outputs (alarms, lock distance) were never part of the fit.
// Three levels of honesty, weakest to strongest:
//   seen     holds inside the part of the take the fit measured (echo levels only)
//   held-out holds after trainEnd: same take, but that audio was never measured by the fit
//   LOTO     leave one take out: person + background from the OTHER takes, run on this take's plan
// For each take: replay the recording, then run N simulated twins (same plan, new random noise each).
// Usage: node tools/fit/validate.js [twins=12] [out.json]
const fs = require('fs'), path = require('path');
const T = require('./takes.js'), S = require('./scene.js'), F = require('./fit.js'), { BANDS, med, q } = require('./bands.js');
const N = +(process.argv[2] || 12);
const fitted = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/fitted.json'))).takes;

function summarize(fr, segs) {
  const det = T.detect(fr, { trace: true }), sc = T.score(det.events, segs), holds = segs.filter(s => s.label === 'hold');
  // deepest sustained drop of the detector's level below its own baseline during each hold
  const drops = holds.map(h => { const x = det.trace.filter(v => v.t >= h.a + 4 && v.t < h.b && Number.isFinite(v.base - v.B)).map(v => v.base - v.B); return x.length ? +q(x, 0.9).toFixed(1) : null; });
  return { lat: sc.holds.map(h => h.latency), false: sc.false.map(f => f.t), lock: det.locks[0]?.cm ?? null, lockT: det.locks[0]?.t ?? null, drops };
}
// median person and background of a set of fitted takes (for LOTO)
function pooled(list) {
  const v = {}; for (const k of Object.keys(list[0].v)) v[k] = med(list.map(t => t.v[k]));
  const bg = { still: list[0].background.still.map((_, r) => med(list.map(t => t.background.still[r]))), bands: {} };
  for (const k of Object.keys(list[0].background.bands)) bg.bands[k] = list[0].background.bands[k].map((_, r) => med(list.map(t => t.background.bands[k][r])));
  const ex = {}; for (const k of Object.keys(list[0].excess)) ex[k] = list[0].excess[k].map((_, r) => med(list.map(t => t.excess[k][r])));
  return { v, bg, ex, bpm: med(list.map(t => t.bpm)) };
}
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
const tot = { seen: [0, 0, 0, 0], held: [0, 0, 0, 0], loto: [0, 0, 0, 0] }, rows = [], lockErr = { own: [], loto: [] }, latPairs = { own: [], loto: [] };
let realFalse = 0, simFalse = 0, lotoFalse = 0, minutes = 0;
for (const ft of fitted) {
  const fr = T.load(ft.id), segs = fr.m.segs, Tsec = fr.n / fr.rate, real = summarize(fr, segs), holds = segs.filter(s => s.label === 'hold');
  const own = [], loto = [], others = pooled(fitted.filter(t => t.id !== ft.id));
  for (let s = 1; s <= N; s++) {
    own.push(summarize(S.simulate({ segs, T: Tsec, person: F.person(ft.v, ft.bpm), room: ft.background, excess: ft.excess, bands: BANDS, seed: 1000 + s }), segs));
    loto.push(summarize(S.simulate({ segs, T: Tsec, person: F.person(others.v, others.bpm), room: others.bg, excess: others.ex, bands: BANDS, seed: 3000 + s }), segs));
  }
  rows.push({ id: ft.id, trainEnd: ft.trainEnd, real, own, loto });
  realFalse += real.false.length; simFalse += own.reduce((a, x) => a + x.false.length, 0) / N; lotoFalse += loto.reduce((a, x) => a + x.false.length, 0) / N; minutes += Tsec / 60;
  console.log(`\n${ft.id.slice(16, 24)}  fit on 0-${ft.trainEnd} s (mismatch ${ft.unseen} dB)`);
  console.log('  hold   part      real      twin caught  twin time (s)   LOTO caught   real drop  twin drop  LOTO drop (dB)');
  holds.forEach((h, i) => {
    const part = h.b <= ft.trainEnd + 1e-6 ? 'seen' : 'held', ol = own.map(x => x.lat[i]).filter(v => v !== null), ll = loto.map(x => x.lat[i]).filter(v => v !== null);
    const key = part === 'seen' ? 'seen' : 'held';
    tot[key][0] += real.lat[i] !== null ? 1 : 0; tot[key][1]++; tot[key][2] += ol.length; tot[key][3] += N;
    tot.loto[0] += real.lat[i] !== null ? 1 : 0; tot.loto[1]++; tot.loto[2] += ll.length; tot.loto[3] += N;
    if (real.lat[i] !== null && ol.length) latPairs.own.push([real.lat[i], med(ol)]); if (real.lat[i] !== null && ll.length) latPairs.loto.push([real.lat[i], med(ll)]);
    console.log(`  ${String(Math.round(h.a)).padStart(4)}   ${part.padEnd(8)}  ${String(real.lat[i] ?? 'MISS').padEnd(8)}  ${pct(ol.length, N).padEnd(11)}  ${(ol.length ? med(ol).toFixed(1) : '-').padEnd(14)}  ${pct(ll.length, N).padEnd(12)}  ${String(real.drops[i]).padEnd(9)}  ${med(own.map(x => x.drops[i]).filter(v => v !== null)).toFixed(1).padEnd(9)}  ${med(loto.map(x => x.drops[i]).filter(v => v !== null)).toFixed(1)}`);
  });
  console.log(`  first lock: real ${real.lock} cm | twins ${own.map(x => x.lock).join(' ')} | LOTO ${loto.map(x => x.lock).join(' ')}`);
  console.log(`  false alarms: real ${real.false.length} | twins ${(own.reduce((a, x) => a + x.false.length, 0) / N).toFixed(2)} per take | LOTO ${(loto.reduce((a, x) => a + x.false.length, 0) / N).toFixed(2)}`);
  for (const x of own) if (x.lock !== null) lockErr.own.push(Math.abs(x.lock - real.lock)); for (const x of loto) if (x.lock !== null) lockErr.loto.push(Math.abs(x.lock - real.lock));
}
console.log('\nTOTAL                 real caught     simulated caught');
console.log(`  seen holds          ${tot.seen[0]}/${tot.seen[1]} (${pct(tot.seen[0], tot.seen[1])})`.padEnd(38) + `${pct(tot.seen[2], tot.seen[3])} of ${tot.seen[3]}`);
console.log(`  held-out holds      ${tot.held[0]}/${tot.held[1]} (${pct(tot.held[0], tot.held[1])})`.padEnd(38) + `${pct(tot.held[2], tot.held[3])} of ${tot.held[3]}`);
console.log(`  leave-one-take-out  ${tot.loto[0]}/${tot.loto[1]} (${pct(tot.loto[0], tot.loto[1])})`.padEnd(38) + `${pct(tot.loto[2], tot.loto[3])} of ${tot.loto[3]}`);
console.log(`  first lock within 6 cm of the real one: twins ${pct(lockErr.own.filter(e => e <= 6).length, lockErr.own.length)}, LOTO ${pct(lockErr.loto.filter(e => e <= 6).length, lockErr.loto.length)}`);
console.log(`  time to alarm, |twin median - real| per caught hold: median ${med(latPairs.own.map(p => Math.abs(p[0] - p[1]))).toFixed(1)} s (LOTO ${med(latPairs.loto.map(p => Math.abs(p[0] - p[1]))).toFixed(1)} s)`);
console.log(`  false alarms per minute: real ${(realFalse / minutes).toFixed(2)}, twins ${(simFalse / minutes).toFixed(2)}, LOTO ${(lotoFalse / minutes).toFixed(2)}  (${minutes.toFixed(1)} min of takes)`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ made: new Date().toISOString(), twins: N, totals: tot, lockWithin6cm: { twins: lockErr.own.filter(e => e <= 6).length / lockErr.own.length, loto: lockErr.loto.filter(e => e <= 6).length / lockErr.loto.length }, falsePerMin: { real: realFalse / minutes, twins: simFalse / minutes, loto: lotoFalse / minutes }, rows }, null, 1));
