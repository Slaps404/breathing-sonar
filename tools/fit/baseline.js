// What the live detector does on every recorded take. Usage: node tools/fit/baseline.js [out.json]
const T = require('./takes.js'), fs = require('fs');
const out = [];
for (const id of T.ids()) {
  const fr = T.load(id); if (!fr) { console.log(id, 'no labels'); continue; }
  const r = T.detect(fr), sc = T.score(r.events, fr.m.segs);
  out.push({ id, seconds: +(fr.n / fr.rate).toFixed(1), plan: fr.m.plan, track: fr.m.track, locks: r.locks, events: r.events.map(e => ({ t: +e.t.toFixed(1), type: e.type, why: e.why })), ...sc });
  console.log(id.slice(16, 24), `${(fr.n / fr.rate).toFixed(0)}s`.padStart(5), `i0=${fr.i0}`, 'locks', r.locks.map(l => `${l.cm}cm@${l.t.toFixed(0)}`).join(' ') || '-',
    '| holds', sc.holds.map(h => h.latency ?? 'X').join(' ') || '-', '| false', sc.false.map(f => `${f.t}(${f.label})`).join(' ') || '-');
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
