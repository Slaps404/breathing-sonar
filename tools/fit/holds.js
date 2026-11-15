// For every labeled hold: how much does breathing-band motion drop in each distance slice, compared with
// the normal breathing just before it? Answers: when a hold was missed, was the drop visible in SOME slice
// (then the zone picker is the problem) or in none (then the signal is not there)?
// Usage: node tools/fit/holds.js [out.json]
const T = require('./takes.js'), { bandPower, dB, med } = require('./bands.js'), fs = require('fs');
const R = 22, W = 8, rows = [];
for (const id of T.ids()) {
  const fr = T.load(id); if (!fr) continue;
  const holds = fr.m.segs.filter(s => s.label === 'hold' && s.b - s.a >= 12); if (!holds.length) continue;
  const det = T.detect(fr, { trace: true }), sc = T.score(det.events, fr.m.segs), n = Math.round(W * fr.rate);
  const level = (a, b) => {   // median level per slice over 8 s windows fully inside [a, b], stepping 1 s
    const per = Array.from({ length: R }, () => []);
    for (let t = a; t + W <= b + 1e-6; t += 1) { const f0 = Math.round(t * fr.rate); if (f0 + n > fr.n) break; for (let r = 0; r < R; r++) per[r].push(dB(bandPower(fr, r, f0, n).breath)); }
    return per.map(med);
  };
  for (const h of holds) {
    const i = fr.m.segs.indexOf(h), prev = fr.m.segs[i - 1];
    if (!prev || prev.label !== 'normal' || prev.b - prev.a < 15) continue;
    const before = level(Math.max(prev.a + 3, prev.b - 30), prev.b), during = level(h.a + 2, Math.min(h.b, fr.n / fr.rate));
    const drop = before.map((v, r) => +(v - during[r]).toFixed(1));
    const tick = det.trace.filter(x => x.t >= h.a && x.t < h.b), lock = tick.length ? tick[tick.length >> 1].lock : null;
    const moving = tick.filter(x => x.moving).length / (tick.length || 1);
    rows.push({ id: id.slice(16, 24), a: Math.round(h.a), len: Math.round(h.b - h.a), latency: sc.holds.find(x => x.a === h.a).latency, lock, moving: +moving.toFixed(2), drop, before: before.map(v => +v.toFixed(1)) });
  }
}
console.log('slice width 5.7 cm; columns = slices 3..20 (17-114 cm). Values: dB drop of breathing-band motion, hold vs the normal before. [ ] = watched zone start.');
console.log('take      hold  len  caught   move%  ' + Array.from({ length: 18 }, (_, k) => String(Math.round((k + 3) * 5.7)).padStart(4)).join(''));
for (const x of rows) console.log(x.id, String(x.a).padStart(5), String(x.len).padStart(4), String(x.latency ?? 'MISS').padStart(7), String(Math.round(x.moving * 100)).padStart(6), ' ',
  x.drop.slice(3, 21).map((v, k) => (k + 3 === x.lock ? '[' : ' ') + v.toFixed(0).padStart(3)).join(''));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(rows));
