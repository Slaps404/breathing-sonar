// Shape of a hold as the detector sees it: its level (breathing-band motion in the watched zone, 8 s window)
// second by second around each hold start, relative to that take's median level in normal breathing.
// Real takes vs their simulated twins. Shows what a "median level per state" summary hides.
// Usage: [DSP=<detector version>] node tools/fit/hold-shape.js
const fs = require('fs'), path = require('path');
const T = require('./takes.js'), S = require('./scene.js'), F = require('./fit.js'), { BANDS, med } = require('./bands.js');
const fitted = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/fitted.json'))).takes, OFF = []; for (let o = -14; o <= 18; o += 2) OFF.push(o);
function shape(fr, segs) {
  const tr = T.detect(fr, { trace: true }).trace.filter(x => Number.isFinite(x.B)), lab = t => (segs.find(l => t >= l.a && t < l.b) || {}).label;
  const norm = med(tr.filter(x => lab(x.t) === 'normal' && lab(x.t - 8) === 'normal').map(x => x.B)), rows = [];
  for (const h of segs.filter(s => s.label === 'hold' && s.a > 45)) rows.push(OFF.map(o => { const x = tr.filter(v => Math.abs(v.t - (h.a + o)) < 0.6).map(v => v.B - norm); return x.length ? med(x) : NaN; }));
  return rows;
}
const real = [], sim = [];
for (const ft of fitted) { const fr = T.load(ft.id), segs = fr.m.segs; real.push(...shape(fr, segs));
  for (let s = 1; s <= 4; s++) sim.push(...shape(S.simulate({ segs, T: fr.n / fr.rate, person: F.person(ft.v, ft.bpm), room: ft.background, excess: ft.excess, bands: BANDS, seed: 500 + s }), segs)); }
const col = (rows, i, f) => f(rows.map(r => r[i]).filter(Number.isFinite));
console.log('seconds from the hold label   ' + OFF.map(o => String(o).padStart(5)).join(''));
console.log(`real, median of ${real.length} holds     ` + OFF.map((_, i) => col(real, i, med).toFixed(0).padStart(5)).join(''));
console.log(`sim,  median of ${sim.length} holds     ` + OFF.map((_, i) => col(sim, i, med).toFixed(0).padStart(5)).join(''));
console.log('(dB relative to the median level while breathing normally; the level looks back over 8 s)');
