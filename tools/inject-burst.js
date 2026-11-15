// Generalization check for the hold alarm's recovery rule: how long a burst of breathing-strength motion
// can a real, alarmed hold take before the alarm clears inside the hold?
// The burst is the take's own normal breathing (d seconds from 12 s before the hold: each echo's change
// around its mean, faded in and out over 0.3 s), added to the hold's echoes, starting 0.5 s or 3 s after the
// alarm starts. This is the hardest twitch there is: it looks exactly like breathing, only short.
// Usage (repo root): node tools/inject-burst.js      (needs the local recordings in data/)
// Output per hold: the longest burst (s, of 1 2 3 4 5 6) the alarm survived. "+" = the hold ended first.
const fs = require('fs');
const D = require('../dsp.js');
const shipped = D.HOLD.sustainDb;
const cases = [['take-2026-11-14T22-41-04-642Z', [130, 180, 230]], ['take-2026-11-15T02-54-00-030Z', [60, 210]]];
for (const [id, holdStarts] of cases) {
  const base = 'data/' + id, wav = fs.readFileSync(base + '.wav'), meta = JSON.parse(fs.readFileSync(base + '.json'));
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2), p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 });
  const frames = [], frame = new Float64Array(meta.P), rate = p.rate;
  for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) { for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767; frames.push(D.cir(p, frame)); }
  const labels = meta.labels.map((l, i) => ({ label: l.label, a: l.t, b: meta.labels[i + 1]?.t ?? meta.seconds }));
  function replay(inj) {
    const s = new D.RangeSonar(); s.p = p; s.chs.forEach(c => c.lambda = p.lambda); const ev = [];
    for (let f = 0; f < frames.length; f++) {
      let c = frames[f];
      if (inj && f >= inj.f0 && f < inj.f0 + inj.n) {
        const k = f - inj.f0, e = Math.min(1, (k + 1) / inj.fade, (inj.n - k) / inj.fade), w = 0.5 - 0.5 * Math.cos(Math.PI * e), src = frames[inj.s0 + k];
        const re = new Float64Array(p.L), im = new Float64Array(p.L);
        for (let m = 0; m < p.L; m++) { re[m] = c.re[m] + w * (src.re[m] - inj.mr[m]); im[m] = c.im[m] + w * (src.im[m] - inj.mi[m]); }
        c = { re, im, snr: c.snr };
      }
      s.ingestCIR(c.re, c.im, c.snr);
      if (f % 5) continue;
      const res = s.analyze((f + 1) / rate * 1000); if (res?.event) ev.push({ t: (f + 1) / rate, type: res.event });
    }
    return ev;
  }
  for (const h0 of holdStarts) {
    const h = labels.find(l => l.label === 'hold' && Math.abs(l.a - h0) < 2);
    let line = `${id.slice(16, 24)} hold ${h.a.toFixed(0)}-${h.b.toFixed(0)} s:`;
    for (const [name, db] of [['old rule', Infinity], ['shipped', shipped]]) {
      D.HOLD.sustainDb = db;
      const st = replay(null).find(e => e.type === 'start' && e.t >= h.a && e.t < h.b);
      line += `  ${name}`;
      for (const off of [0.5, 3]) {
        let best = '0';
        for (const d of [1, 2, 3, 4, 5, 6]) {
          if (d + off + 1 > h.b - st.t) { best += '+'; break; }
          const n = Math.round(d * rate), f0 = Math.round((st.t + off) * rate), s0 = Math.round((h.a - 12) * rate), mr = new Float64Array(p.L), mi = new Float64Array(p.L);
          for (let k = 0; k < n; k++) for (let m = 0; m < p.L; m++) { mr[m] += frames[s0 + k].re[m] / n; mi[m] += frames[s0 + k].im[m] / n; }
          const en = replay({ f0, n, s0, mr, mi, fade: Math.round(0.3 * rate) }).find(e => e.type === 'end' && e.t > st.t);
          if (en && en.t < h.b - 1) break;
          best = String(d);
        }
        line += ` ${best} s (burst ${off} s into the alarm)`;
      }
    }
    console.log(line);
  }
}
