// Replay recorded audio and assert that stillness cannot move an acquired zone.
const fs = require('fs');
const assert = require('node:assert/strict');
const D = require('../dsp.js');
const bases = process.argv.slice(2);
let failures = 0;
const results = [];
for (const base of bases) {
  const meta = JSON.parse(fs.readFileSync(base + '.json'));
  const wav = fs.readFileSync(base + '.wav');
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2);
  const s = new D.RangeSonar();
  s.p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 });
  s.chs.forEach(c => c.lambda = s.p.lambda);
  const frame = new Float64Array(meta.P), moves = [], trace = [];
  let previous = null, movement = false;
  for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) {
    const t = (f + 1) / s.rate;
    for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767;
    s.ingestFrame(frame);
    if (f % 5) continue;
    s.analyze(t * 1000);
    movement ||= s.apnea.moving === true;
    if (s.lock !== previous) {
      if (previous !== null && !movement) failures++;
      moves.push({ t, cm: s.lock * s.dr * 100, movement });
      previous = s.lock; movement = false;
    }
    if (s.lock !== null && f % 25 === 0) trace.push([t, s.lock * s.dr * 100]);
  }
  results.push({ take: meta.id || base, moves, trace });
  console.log(base, JSON.stringify(moves));
}
if (process.env.ZONE_OUTPUT) fs.writeFileSync(process.env.ZONE_OUTPUT, JSON.stringify(results));
assert.equal(failures, 0, `${failures} distance changes without detected body movement`);
