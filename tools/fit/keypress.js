// Does a hand reaching for the keyboard show up at label times? Hand zone = slices 1-5 (6-29 cm).
// Prints, per label mark, the fast echo change in the hand zone in 1 s steps from -4 to +4 s around the
// mark, in dB above that take's quiet level (20th percentile). Guided takes label themselves (no hand).
const T = require('./takes.js'), { q } = require('./bands.js');
for (const id of T.ids()) {
  const fr = T.load(id); if (!fr || fr.n / fr.rate < 30) continue;
  const k = Math.round(fr.rate), sec = [];
  for (let f = 1; f + k <= fr.n; f += k) { let m = 0; for (let i = f; i < f + k; i++) for (let r = 1; r <= 5; r++) { const a = i * fr.L + (fr.i0 + r) % fr.L, b = a - fr.L; m += (fr.re[a] - fr.re[b]) ** 2 + (fr.im[a] - fr.im[b]) ** 2; } sec.push(10 * Math.log10(m + 1e-30)); }
  const floor = q(sec, 0.2), how = fr.m.plan ? 'guided' : fr.m.events ? 'app' : 'manual';
  console.log(`${id.slice(16, 24)} ${how}`);
  for (const l of fr.m.labels) { if (l.t < 1) continue; const s = Math.round(l.t); console.log(`   ${l.label.padEnd(10)} @${String(s).padStart(4)}s  ` + Array.from({ length: 9 }, (_, j) => { const v = sec[s - 4 + j]; return v === undefined ? '  .' : String(Math.round(v - floor)).padStart(3); }).join(' ')); }
}
