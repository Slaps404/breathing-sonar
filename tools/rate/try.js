const R = require('./lib.js'), T = R.T;
const id = process.argv[2] || T.ids().at(-1), fr = T.load(id);
const parts = fr.m.segs.map(s => ({ a: s.a, b: s.b, bpm: s.label === 'slow' ? 6 : 15 }));
const sm = Math.round(0.6 * fr.rate);
const show = (name, o) => { const rows = R.score(fr, parts, name, o), by = b => rows.filter(r => r.truth === b), pc = b => `${by(b).filter(r => r.ok).length}/${by(b).length}`;
  console.log(name.padEnd(42), JSON.stringify(o).padEnd(26), '15/min right', pc(15).padEnd(6), '6/min right', pc(6).padEnd(6), '| reads in fast:', by(15).map(r => r.bpm?.toFixed(0) ?? '-').join(' '), '| slow:', by(6).map(r => r.bpm?.toFixed(0) ?? '-').join(' ')); };
console.log(id);
for (const rr of [2, 3, 4, 5]) { show('one slice, strongest repeat', { rr }); show('one slice, shortest strong repeat', { rr, sm }); }
for (const [r0, r1] of [[2, 4], [2, 6], [3, 6], [2, 8], [4, 8]]) show('slices averaged, shortest strong repeat', { r0, r1, sm });
