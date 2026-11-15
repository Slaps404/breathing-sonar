// Final accuracy test. The rules are fixed here BEFORE the takes are recorded, so the number cannot be tuned.
//   Run: .venv/bin/python collect/cued.py   (30 s of guided deep breaths like the app's start, then three 20 s holds)
//   Counts: every take with that plan started after CUTOFF. Dropped only if the probe was not heard or the take was cut short.
//   Detector: dsp.js frozen at commit FROZEN, whatever the working copy is by then.
// Usage: node tools/final-test.js
const { execSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const PLAN = 'cued: deep 30, normal 30, hold 20, normal 30, hold 20, normal 30, hold 20, normal 15', CUTOFF = '2026-11-15T17-25', FROZEN = '4da096a';
const frozen = path.join(os.tmpdir(), `dsp-${FROZEN}.js`);
fs.writeFileSync(frozen, execSync(`git show ${FROZEN}:dsp.js`, { cwd: path.join(__dirname, '..') }));
process.env.DSP = frozen;
const T = require('./fit/takes.js');

const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / 2 / n, w = z * Math.sqrt(p * (1 - p) / n + z * z / 4 / n / n); return [(c - w) / d, (c + w) / d]; };
let caught = 0, holds = 0, falseAlarms = 0, quietMin = 0, runs = 0; const lat = [];
for (const id of T.ids()) {
  if (id.slice(5) < CUTOFF) continue;
  const fr = T.load(id); if (!fr || norm(fr.m.plan) !== PLAN) continue;
  const snr = [...fr.snr].sort((a, b) => a - b)[fr.n >> 1], secs = fr.n / fr.rate;
  if (snr < 20) { console.log(id.slice(16, 24), 'DROPPED: probe not heard'); continue; }
  if (secs < 190) { console.log(id.slice(16, 24), 'DROPPED: cut short'); continue; }
  const sc = T.score(T.detect(fr).events, fr.m.segs);
  runs++; holds += sc.holds.length; caught += sc.caught; falseAlarms += sc.false.length;
  quietMin += fr.m.segs.filter(s => s.label !== 'hold').reduce((a, s) => a + s.b - s.a, 0) / 60;
  sc.holds.forEach(h => h.latency !== null && lat.push(h.latency));
  console.log(id.slice(16, 24), 'holds', sc.holds.map(h => h.latency === null ? 'MISS' : h.latency + 's').join(' '), '| false alarms', sc.false.length);
}
if (!holds) { console.log('No test takes yet. Plan must be exactly:', PLAN); process.exit(); }
const [lo, hi] = wilson(caught, holds); lat.sort((a, b) => a - b);
console.log(`\n${runs} runs. Caught ${caught} of ${holds} holds (${(100 * caught / holds).toFixed(0)}%, 95% range ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%).`);
console.log(`Time to alarm: median ${lat[lat.length >> 1] ?? '-'} s. False alarms: ${falseAlarms} in ${quietMin.toFixed(1)} min of normal breathing.`);
