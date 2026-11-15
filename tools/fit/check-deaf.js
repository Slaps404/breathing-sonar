// Check for the app's "can't hear my own sound" guard (app/hooks.js, DEAF_DB = 20): replays every take and
// reports how long the running probe SNR (sonar.snr, the number the app tests) sits under 20 dB after the
// first 2 s. Expected: the no-signal take 05-44-51 is under it the whole time, every other take never.
const T = require('./takes.js'), D = T.D;
let bad = 0;
for (const id of T.ids()) {
  const fr = T.load(id); if (!fr) continue;
  const s = new D.RangeSonar(); let under = 0, n = 0, min = Infinity;
  for (let f = 0; f < fr.n; f++) { s.ingestCIR(fr.re.subarray(f * fr.L, (f + 1) * fr.L), fr.im.subarray(f * fr.L, (f + 1) * fr.L), fr.snr[f]); if (s.frames > 2 * s.rate) { n++; if (s.snr < 20) under++; min = Math.min(min, s.snr); } }
  const expectDeaf = id.includes('05-44-51'), isDeaf = under / n > 0.9, ok = expectDeaf ? isDeaf : under === 0; if (!ok) bad++;
  console.log(id.slice(16, 24), `lowest ${min.toFixed(0)} dB, under 20 dB ${(100 * under / n).toFixed(0)}% of the time`, ok ? 'ok' : 'UNEXPECTED');
}
process.exit(bad ? 1 : 0);
