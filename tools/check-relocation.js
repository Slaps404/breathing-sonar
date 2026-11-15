// Acceptance check for "sit, move to another distance, sit" takes (labels: normal, moving, normal).
// Replays the audio through dsp.js and asserts, for each take:
//   1. the watched distance never changes without detected body movement,
//   2. no alert at all (nobody held their breath or left in these takes),
//   3. after the move, the watched zone contains the slice with the clearest breathing-rate rhythm.
// Check 3 is independent of the picker: for every slice it takes the spectrum of the raw echo over the whole
// last "normal" part and measures how far the tallest line at 12-36 breaths/min stands above the slice's
// median (dB). Labels are used for scoring only. It shows where the breathing rhythm is seen, not how far
// away the chest is: the takes carry no measured distances.
// Usage: node tools/check-relocation.js data/take-<id> [...]
const fs = require('fs');
const assert = require('node:assert/strict');
const D = require('../dsp.js');
// Per slice r (index from the direct path), line height in dB between seconds a and b.
function rhythmByRange(iq, rate, a, b, r0, r1) {
  const i0 = Math.round(a * rate), n = Math.round(b * rate) - i0, out = [];
  for (let r = r0; r <= r1; r++) {
    let mr = 0, mi = 0; for (let i = 0; i < n; i++) { mr += iq[r].I[i0 + i]; mi += iq[r].Q[i0 + i]; } mr /= n; mi /= n;
    const P = [], F = [];
    for (let f = 0.15; f <= 0.7001; f += 0.5 / (n / rate)) {            // both rotation directions, Hann window
      let e = 0;
      for (const sign of [1, -1]) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
          const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (n + 1)), ph = sign * 2 * Math.PI * f * i / rate;
          const x = (iq[r].I[i0 + i] - mr) * w, y = (iq[r].Q[i0 + i] - mi) * w, c = Math.cos(ph), s = Math.sin(ph);
          re += x * c + y * s; im += y * c - x * s;
        }
        e += re * re + im * im;
      }
      P.push(e); F.push(f);
    }
    const med = [...P].sort((x, y) => x - y)[P.length >> 1];
    let k = -1; for (let j = 0; j < P.length; j++) if (F[j] >= 0.2 && F[j] <= 0.6 && (k < 0 || P[j] > P[k])) k = j;
    out[r] = { db: 10 * Math.log10(P[k] / med), perMin: F[k] * 60 };
  }
  return out;
}
const results = [];
for (const base of process.argv.slice(2)) {
  const meta = JSON.parse(fs.readFileSync(base + '.json'));
  const wav = fs.readFileSync(base + '.wav');
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2);
  const s = new D.RangeSonar();
  s.p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 });
  s.chs.forEach(c => c.lambda = s.p.lambda);
  const r0 = Math.ceil(s.minR / s.dr), r1 = Math.round(s.maxR / s.dr);
  const frame = new Float64Array(meta.P), moves = [], alerts = [], iq = [];
  for (let r = r0; r <= r1; r++) iq[r] = { I: [], Q: [] };
  let previous = null, movement = false, unprompted = 0;
  for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) {
    const t = (f + 1) / s.rate;
    for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767;
    s.ingestFrame(frame);
    if (s.i0 !== null) for (let r = r0; r <= r1; r++) { const ch = s.chs[s.tap(r)]; iq[r].I[f] = ch.I[ch.I.length - 1]; iq[r].Q[f] = ch.Q[ch.Q.length - 1]; }
    if (f % 5) continue;
    const res = s.analyze(t * 1000);
    if (res && res.event === 'start') alerts.push({ t: +t.toFixed(1), why: res.why });
    movement ||= s.apnea.moving === true;
    if (s.lock !== previous) {
      if (previous !== null && !movement) unprompted++;
      moves.push({ t: +t.toFixed(1), cm: +(s.lock * s.dr * 100).toFixed(0), movement });
      previous = s.lock; movement = false;
    }
  }
  const cm = r => +(r * s.dr * 100).toFixed(0);
  const zone = [Math.round(s.zone[0] / s.dr), Math.round(s.zone[1] / s.dr)];
  const parts = meta.labels.map((l, i) => ({ ...l, end: i + 1 < meta.labels.length ? meta.labels[i + 1].t : meta.seconds }));
  const normals = parts.filter(l => l.label === 'normal');
  const rhythm = normals.map(l => rhythmByRange(iq, s.rate, l.t + 10, l.end, r0, r1));   // skip 10 s of settling
  const best = rhythm.map(x => { let b = r0; for (let r = r0; r <= r1; r++) if (x[r].db > x[b].db) b = r; return b; });
  const last = rhythm[rhythm.length - 1], bLast = best[best.length - 1];
  let outside = null; for (let r = r0; r <= r1; r++) if ((r < zone[0] || r > zone[1]) && (outside === null || last[r].db > last[outside].db)) outside = r;
  const out = { take: meta.id, moves, alerts, zoneCm: zone.map(cm),
    rhythm: normals.map((l, i) => ({ seconds: [+(l.t + 10).toFixed(0), +l.end.toFixed(0)], clearestCm: cm(best[i]),
      lineDb: +rhythm[i][best[i]].db.toFixed(1), perMin: +rhythm[i][best[i]].perMin.toFixed(0),
      byRange: Object.fromEntries(rhythm[i].map((x, r) => [cm(r), +x.db.toFixed(1)]).filter(Boolean)) })),
    clearestOutsideZone: { cm: cm(outside), lineDb: +last[outside].db.toFixed(1) } };
  results.push(out);
  console.log(`${meta.id} (${meta.plan})`);
  console.log(`  watched distance: ${moves.map(m => `${m.cm} cm at ${m.t} s${m.movement ? ' (after movement)' : ''}`).join(', ')}; final zone ${out.zoneCm[0]}-${out.zoneCm[1]} cm`);
  console.log(`  alerts: ${alerts.length ? alerts.map(a => `${a.why} at ${a.t} s`).join(', ') : 'none'}`);
  for (const x of out.rhythm) console.log(`  rhythm ${x.seconds[0]}-${x.seconds[1]} s: clearest at ${x.clearestCm} cm, ${x.lineDb} dB above median, ${x.perMin}/min`);
  console.log(`  clearest rhythm outside the final zone: ${out.clearestOutsideZone.cm} cm, ${out.clearestOutsideZone.lineDb} dB`);
  assert.equal(unprompted, 0, 'distance changed without detected body movement');
  assert.ok(moves.some(m => m.movement), 'no fresh pick after the labeled movement');
  assert.equal(alerts.length, 0, 'alert during normal breathing or an in-range move');
  assert.ok(bLast >= zone[0] && bLast <= zone[1], `clearest breathing rhythm (${cm(bLast)} cm) is outside the watched zone`);
}
if (process.env.RELOCATION_OUTPUT) fs.writeFileSync(process.env.RELOCATION_OUTPUT, JSON.stringify(results, null, 1));
