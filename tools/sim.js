// Quick check: one person 0.6 m away breathing +-5 mm at 15/min, breath hold 40-60 s.
// Usage: node tools/sim.js [tones|range]
const { makeScene, run, score } = require('./simlib.js');
const mode = process.argv[2] || 'tones';
const hold = [40, 60], T = 75;
const scene = makeScene({ chest: { d: 0.6, mm: 5, bpm: 15 }, hold }, 1);
const t0 = Date.now();
const res = run(mode, scene, { T });
for (const x of res.timeline) if (Math.abs(x.t % 5) < 0.01)
  console.log(`t=${String(x.t).padStart(3)}s bpm=${x.bpm === null ? '--' : x.bpm.toFixed(1)} quality=${x.q.toFixed(2)} alert=${x.alert}` +
    (x.lock !== null ? ` chest@${x.lock}m` : '') + ` snr=${x.snr.toFixed(0)}dB`);
console.log('alert events:', res.events.map(e => e.join(' ')).join(', ') || 'none');
console.log('score:', JSON.stringify(score(res, { scene, hold, T })), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
