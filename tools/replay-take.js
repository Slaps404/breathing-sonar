// Run a recorded take (data/take-*.wav + .json from the collectors) through the live detector in dsp.js
// and score it against the take's labels.
// Usage: node tools/replay-take.js data/take-<id> (app takes: the .wav alone holds the labels) [--skip frames.json] [--minR 0.2 --maxR 1.2] [--lock 0.34]
//   --skip: JSON list of frame numbers with audio dropouts; the previous frame is repeated for those.
const fs = require('fs');
const D = require('../dsp.js');
const base = process.argv[2];
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const wav = fs.readFileSync(base + '.wav');
const dataBytes = wav.readUInt32LE(40), jsonAt = 44 + dataBytes + (dataBytes % 2);
// Labels: base.json from the collectors, or the 'json' chunk the app puts after the audio.
const meta = fs.existsSync(base + '.json') ? JSON.parse(fs.readFileSync(base + '.json'))
  : JSON.parse(wav.toString('utf8', jsonAt + 8, jsonAt + 8 + wav.readUInt32LE(jsonAt + 4)));
const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, dataBytes >> 1);
const skip = new Set(arg('skip') ? JSON.parse(fs.readFileSync(arg('skip'))) : []);

const s = new D.RangeSonar({ minR: +arg('minR', 0.2), maxR: +arg('maxR', 1.2) });
s.p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 });   // the take's probe band, not the page default
s.chs.forEach(ch => { ch.lambda = s.p.lambda; });
if (arg('lock')) s.setLock(+arg('lock'));                       // --lock 0.34: watch a fixed distance (metres)
const P = meta.P, rate = s.rate, nF = Math.floor(pcm.length / P);
const labels = meta.labels.map((l, i) => ({ label: l.label, a: l.t, b: i + 1 < meta.labels.length ? meta.labels[i + 1].t : meta.seconds }));
const labelAt = t => (labels.find(l => t >= l.a && t < l.b) || {}).label;

const frame = new Float64Array(P), events = [], rows = [];
let last = null;
for (let f = 0; f < nF; f++) {
  const t = (f + 1) / rate;
  if (skip.has(f) && last) s.ingestCIR(last.re, last.im, last.snr);
  else {
    for (let i = 0; i < P; i++) frame[i] = pcm[f * P + i] / 32767;
    last = D.cir(s.p, frame); s.ingestCIR(last.re, last.im, last.snr);
  }
  if (f % 5) continue;                      // analyse ~5 times a second, like the page
  const res = s.analyze(t * 1000);
  if (res && res.event) events.push({ t, type: res.event, why: res.why, label: labelAt(t) });
  if (res && Math.floor(t) % 5 === 0 && Math.floor(t) !== Math.floor(t - 5 / rate)) {
    const ch = res.ch, n = ch.disp.length, k = Math.round(4 * rate);
    rows.push(`${String(Math.floor(t)).padStart(4)}  ${(labelAt(t) || '').padEnd(7)} ${(s.lock * s.dr * 100).toFixed(0).padStart(4)} cm  q ${ch.quality.toFixed(2)}  ${ch.quality > 0.25 ? ch.bpm.toFixed(0).padStart(3) : ' --'} bpm  move4s ${D.std(ch.disp, Math.max(0, n - k), n).toFixed(2).padStart(6)} mm  ${s.alerting ? 'ALERT ' + s.why : ''}`);
  }
}
console.log(`${meta.id}: ${meta.seconds} s, plan "${meta.plan || ''}", skipped ${skip.size} dropout frames`);
console.log('   t  label   watching  quality  rate   motion          alert');
console.log(rows.join('\n'));
console.log('\nalert events:');
for (const e of events) console.log(`  ${e.t.toFixed(1).padStart(6)} s  ${e.type.padEnd(5)} ${e.why || ''} during "${e.label}"`);
const starts = events.filter(e => e.type === 'start');
console.log('\nper hold:');
for (const h of labels.filter(l => l.label === 'hold')) {
  const hit = starts.find(e => e.t >= h.a && e.t <= h.b + 2);
  console.log(`  hold ${h.a.toFixed(0).padStart(4)}-${h.b.toFixed(0)} s: ${hit ? 'caught ' + (hit.t - h.a).toFixed(1) + ' s in' : 'MISSED'}`);
}
const fa = starts.filter(e => !labels.some(h => h.label === 'hold' && e.t >= h.a && e.t <= h.b + 2));
console.log(`false alarms: ${fa.length}` + (fa.length ? ' (' + fa.map(e => `${e.t.toFixed(0)} s in "${e.label}"`).join(', ') + ')' : ''));
