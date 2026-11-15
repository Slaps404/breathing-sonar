// Regression for three app takes from 2026-11-15 (pass their paths without .wav):
//   1. the watched distance is the closest breathing body, not someone or something behind (dad, dog, bed at ~0.8-1.1 m)
//   2. the breathing line (whole 20 s window, once it holds no body movement) has no fake jumps while the breath is held (angle flips when the echo jitters across the
//      ring centre; one shows as a 3+ mm step between neighbouring samples)
// Usage: node tools/check-pick-and-line.js <take> [<take> ...]  e.g. ~/Downloads/take-2026-11-15T05-52-13-414Z
// The clock starts at 60 s like the app's (performance.now counts from page load, not from Start).
const fs = require('fs');
const D = require('../dsp.js');
const MAX_R = 0.6, MAX_JUMP_MM = 1;
let fail = 0;
for (const base of process.argv.slice(2)) {
  const wav = fs.readFileSync(base + '.wav'), bytes = wav.readUInt32LE(40);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, bytes >> 1);
  const s = new D.RangeSonar(), P = s.p.P, frame = new Float64Array(P);
  const locks = new Set(); let jump = 0, jumpT = 0, lastMove = -Infinity;
  for (let f = 0; f < Math.floor(pcm.length / P); f++) {
    for (let i = 0; i < P; i++) frame[i] = pcm[f * P + i] / 32767;
    s.ingestFrame(frame);
    if (f % 5) continue;
    const t = (f + 1) / s.rate, res = s.analyze(60000 + t * 1000);
    if (s.lock !== null) locks.add(Math.round(s.lock * s.dr * 100));
    if (s.apnea.moving === true) lastMove = t;
    if (!res || t - lastMove < 20) continue;   // real movement still inside the 20 s window
    const d = res.ch.disp;
    for (let i = 1; i < d.length; i++) { const j = Math.abs(d[i] - d[i - 1]); if (j > jump) { jump = j; jumpT = t; } }
  }
  const far = [...locks].filter(cm => cm > MAX_R * 100);
  const ok1 = locks.size > 0 && far.length === 0, ok2 = jump <= MAX_JUMP_MM;
  console.log(`${base.split('/').pop()}: watched ${[...locks].join(', ') || 'nothing'} cm ${ok1 ? 'ok' : 'FAIL'}; ` +
    `biggest line jump ${jump.toFixed(2)} mm at ${jumpT.toFixed(0)} s ${ok2 ? 'ok' : 'FAIL'}`);
  if (!ok1 || !ok2) fail++;
}
process.exit(fail ? 1 : 0);
