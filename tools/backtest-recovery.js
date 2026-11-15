// Backtest of the hold alarm's recovery rule on every local recording (data/take-*.wav, ignored by git).
// Usage (repo root): node tools/backtest-recovery.js [out.json]
// Each row replays all takes through the live detector with one setting of the sustained-motion test
// (HOLD.sustainQ, HOLD.sustainDb in dsp.js). sustainDb = Infinity turns the test off = the old rule.
// Labels are used for scoring only. Columns:
//   hits       holds with a new alarm start inside the hold (+2 s). An alarm still on from before is not counted.
//   early      alarm ends inside a hold, more than 1 s before the hold ends (wrong clear)
//   cover      seconds of hold with the alarm on
//   normal     seconds of "normal" (breathing) with the alarm on: recovery delay + false alarms
//   other      seconds of "moving" / "empty room" / "returned" with the alarm on (empty room alarms are wanted)
//   false      alarm starts outside holds
//   recovery   for alarms on when a hold ends and normal breathing follows: seconds until the alarm ends
const fs = require('fs');
const D = require('../dsp.js');
const shipped = { q: D.HOLD.sustainQ, db: D.HOLD.sustainDb };
function replayAll() {
  const rows = [];
  for (const file of fs.readdirSync('data').filter(f => /^take-.*\.wav$/.test(f)).sort()) {
    const base = 'data/' + file.slice(0, -4), wav = fs.readFileSync(base + '.wav'), meta = JSON.parse(fs.readFileSync(base + '.json'));
    const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2);
    const s = new D.RangeSonar(); s.p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 }); s.chs.forEach(c => c.lambda = s.p.lambda);
    const labels = meta.labels.map((l, i) => ({ label: l.label, a: l.t, b: meta.labels[i + 1]?.t ?? meta.seconds }));
    const frame = new Float64Array(meta.P), events = [], on = {}, dt = 5 / s.rate;
    for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) {
      const t = (f + 1) / s.rate;
      for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767;
      s.ingestFrame(frame);
      if (f % 5) continue;
      const res = s.analyze(t * 1000), label = labels.find(l => t >= l.a && t < l.b)?.label;
      if (res?.event) events.push({ t: +t.toFixed(1), type: res.event, why: res.why, label });
      if (s.alerting) on[label] = (on[label] || 0) + dt;
    }
    const holds = labels.filter(l => l.label === 'hold'), starts = events.filter(e => e.type === 'start'), ends = events.filter(e => e.type === 'end');
    const recovery = [];
    for (const h of holds) {
      const next = labels.find(l => l.a === h.b), st = starts.filter(e => e.t < h.b).at(-1), en = st && ends.find(e => e.t > st.t);
      if (!st || !next || next.label !== 'normal' || (en && en.t < h.b)) continue;       // alarm not on at the hold's end
      recovery.push(en && en.t < next.b ? +(en.t - h.b).toFixed(1) : null);                  // null = still on when the next phase starts
    }
    rows.push({ take: meta.id, holds: holds.length,
      hits: holds.filter(h => starts.some(e => e.t >= h.a && e.t <= h.b + 2)).length,
      early: ends.filter(e => holds.some(h => e.t >= h.a && e.t < h.b - 1)).map(e => e.t),
      cover: on.hold || 0, normal: on.normal || 0, other: Object.entries(on).filter(([k]) => k !== 'hold' && k !== 'normal').reduce((a, [, v]) => a + v, 0),
      falseStarts: starts.filter(e => !holds.some(h => e.t >= h.a && e.t <= h.b + 2)).length, recovery, events });
  }
  return rows;
}
const settings = [{ q: shipped.q, db: Infinity, name: 'old rule (test off)' }, { ...shipped, name: 'shipped' }];
for (const q of [0.15, 0.25, 0.33]) for (const db of [2, 3, 4, 5, 6]) if (q !== shipped.q || db !== shipped.db) settings.push({ q, db, name: '' });
const out = [];
console.log('sustainQ sustainDb  hits early cover normal other false  recovery (s)');
for (const set of settings) {
  D.HOLD.sustainQ = set.q; D.HOLD.sustainDb = set.db;
  const rows = replayAll(), sum = k => rows.reduce((a, r) => a + r[k], 0);
  const rec = rows.flatMap(r => r.recovery);
  console.log(`${String(set.q).padEnd(8)} ${String(set.db).padEnd(9)} ${sum('hits')}/${sum('holds')} ${String(rows.flatMap(r => r.early).length).padStart(5)} ${sum('cover').toFixed(0).padStart(5)} ${sum('normal').toFixed(0).padStart(6)} ${sum('other').toFixed(0).padStart(5)} ${String(sum('falseStarts')).padStart(5)}  ${rec.map(x => x ?? 'stuck').join(' ')}  ${set.name}`);
  out.push({ ...set, db: Number.isFinite(set.db) ? set.db : 'off', takes: rows });
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
