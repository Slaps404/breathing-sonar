// Replay app takes (from ~/Downloads, copied into data/) with the current picker and a candidate setting.
// Usage: DSP=<dsp with ZONE.fLow support or plain dsp.js> node tools/rate/apprun.js [since, e.g. 2026-11-15T15-40]
const fs = require('fs'), path = require('path'), os = require('os'), T = require('../fit/takes.js'), B = require('../fit/bands.js');
const since = process.argv[2] || '2026-11-15T15-40', dl = path.join(os.homedir(), 'Downloads');
for (const f of fs.readdirSync(dl)) if (/^take-.*\.wav$/.test(f) && f.slice(5) >= since && !fs.existsSync(path.join(T.DATA, f))) fs.copyFileSync(path.join(dl, f), path.join(T.DATA, f));
const Z = T.D.ZONE, base = Z.lagMax;
for (const id of T.ids()) {
  if (id.slice(5) < since) continue; const fr = T.load(id); if (!fr || !(fr.m.events || []).length) continue;
  const ev = fr.m.events.filter(e => /watching|detector|call|volume/.test(e.event)).map(e => `${e.t.toFixed(0)}s ${e.event.replace('status: ', '').replace('detector: ', '')}`).join(', ');
  console.log(`\n${id.slice(16, 24)}  ${fr.m.seconds.toFixed(0)} s  labels: ${fr.m.labels.map(l => l.label + '@' + l.t.toFixed(0)).join(' ')}\n  live: ${ev}`);
  const holds = fr.m.segs.filter(s => s.label === 'hold' && s.b - s.a > 6);
  if (holds.length) {   // where the holds show up (zone drop by lock distance)
    const n = Math.round(6 * fr.rate), z = (t, r) => { let s = 0; for (let k = r - 1; k <= r + 4; k++) s += B.bandPower(fr, k, Math.round(t * fr.rate), n).breath; return s; };
    const nt = [], ht = []; for (const s of fr.m.segs) for (let t = Math.max(s.a + 3, 34); t + 6 <= s.b; t += 2) (s.label === 'hold' ? ht : s.label === 'normal' ? nt : []).push(t);
    if (nt.length && ht.length) { const row = []; for (let r = 3; r <= 21; r += 1) row.push([Math.round(r * fr.dr * 100), B.dB(B.med(nt.map(t => z(t, r))) / B.med(ht.map(t => z(t, r))))]);
      const best = row.reduce((a, b) => b[1] > a[1] ? b : a); console.log(`  holds show best at ${best[0]} cm (${best[1].toFixed(0)} dB). by distance: ${row.map(x => x[0] + ':' + x[1].toFixed(0)).join(' ')}`); }
  }
  for (const [name, lagMax] of [['now      ', base], ['candidate', 10.5]]) {
    Z.lagMax = lagMax; const d = T.detect(fr), sc = T.score(d.events, fr.m.segs);
    console.log(`  ${name} lock ${d.locks.map(l => l.cm + 'cm@' + l.t.toFixed(0)).join(' ') || 'none'} | holds ${sc.holds.map(h => h.latency === null ? 'MISS' : h.latency + 's').join(' ') || '-'} | alarms outside holds ${sc.false.map(x => x.t + 's').join(' ') || 'none'}`);
  }
  Z.lagMax = base;
}
