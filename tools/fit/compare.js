// Side by side: a recorded take and its simulated twin, measured the same way.
// Usage: node tools/fit/compare.js <take id suffix, e.g. 02-54-00> [seed] [--start]
const fs = require('fs'), path = require('path');
const T = require('./takes.js'), M = require('./measure.js'), S = require('./scene.js'), F = require('./fit.js'), { BANDS } = require('./bands.js');
const id = T.ids().find(x => x.includes(process.argv[2])), fr = T.load(id), seed = +(process.argv[3] || 99);
const room = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/measured.json'))).pooled.empty;
const fit = JSON.parse(fs.readFileSync(path.join(T.ROOT, 'docs/sim/fitted.json'))).takes.find(t => t.id === id);
const v = process.argv.includes('--start') || !fit ? F.START : fit.v;
const real = M.measureFrames(fr, fr.m.segs), sim = M.measureFrames(S.simulate({ segs: fr.m.segs, T: fr.n / fr.rate, person: F.person(v, fit?.bpm || 15), room, bands: BANDS, seed }), fr.m.segs);
console.log(id, JSON.stringify(v));
console.log(' '.repeat(18) + Array.from({ length: 21 }, (_, r) => String(Math.round(r * 5.72)).padStart(4)).join('') + '  cm');
for (const c of ['normal', 'hold', 'moving']) { if (!real.cls[c]) continue;
  for (const k of ['still', 'drift', 'breath', 'mid', 'fast', 'noise']) {
    const a = k === 'still' ? real.cls[c].still : real.cls[c].bands[k], b = k === 'still' ? sim.cls[c].still : sim.cls[c].bands[k];
    console.log(`${c} ${k} real`.padEnd(18) + a.slice(0, 21).map(x => x.toFixed(0).padStart(4)).join(''));
    console.log(`${' '.repeat(c.length)} ${k} sim `.padEnd(18) + b.slice(0, 21).map(x => x.toFixed(0).padStart(4)).join(''));
  } }
console.log('mismatch', JSON.stringify(F.loss(real, sim)));
