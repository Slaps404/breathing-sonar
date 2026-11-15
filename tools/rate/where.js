// Where is the breathing really? Truth from the labels, not from the detector: the chest's slices are the ones
// whose breathing-speed movement drops when the person holds their breath. A wall does not change.
// For each take: drop (dB, normal vs hold) per slice, and what the detector's lock got compared with the best slice.
const T = require('../fit/takes.js'), B = require('../fit/bands.js');
const R0 = 2, R1 = 21;
function contrast(fr) {
  const n = Math.round(8 * fr.rate), segs = fr.m.segs, lv = { normal: [], hold: [] };
  for (const s of segs) {
    if (s.label !== 'normal' && s.label !== 'hold') continue;
    for (let t = s.a + (s.label === 'hold' ? 4 : 2); t + 8 <= s.b; t += 2) { const f0 = Math.round(t * fr.rate); if (f0 + n > fr.n) break; const row = []; for (let r = R0; r <= R1; r++) row[r] = B.bandPower(fr, r, f0, n).breath; lv[s.label].push(row); }
  }
  if (lv.hold.length < 2 || lv.normal.length < 4) return null;
  const out = []; for (let r = R0; r <= R1; r++) out[r] = B.dB(B.med(lv.normal.map(x => x[r])) / B.med(lv.hold.map(x => x[r])));
  return out;
}
module.exports = { contrast, R0, R1 };
if (require.main === module) {
  const rows = [];
  for (const id of T.ids()) {
    const fr = T.load(id); if (!fr) continue; const c = contrast(fr); if (!c) continue;
    const det = T.detect(fr), sc = T.score(det.events, fr.m.segs), lock = det.locks[0] ? Math.round(det.locks[0].cm / 100 / fr.dr) : null;
    let best = R0; for (let r = R0; r <= R1; r++) if (c[r] > c[best]) best = r;
    const cm = r => Math.round(r * fr.dr * 100);
    rows.push({ id, best, lock, gap: lock === null ? null : c[best] - c[Math.min(R1, Math.max(R0, lock))] });
    console.log(id.slice(16, 24), (fr.m.source || '').slice(0, 6).padEnd(6), 'best', String(cm(best)).padStart(3) + 'cm', c[best].toFixed(1).padStart(5) + 'dB',
      '| first lock', lock === null ? ' none' : String(cm(lock)).padStart(3) + 'cm ' + (c[lock] ?? NaN).toFixed(1).padStart(5) + 'dB', '| caught', `${sc.caught}/${sc.holds.length}`,
      '| drop by slice:', Array.from({ length: R1 - R0 + 1 }, (_, i) => c[R0 + i].toFixed(0)).join(' '));
  }
}
