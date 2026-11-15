// Offline candidate check. Uses labels only for scoring, never for detection.
// Usage: node tools/check-departure.js > docs/departure-results.json
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('node:child_process');
const Module = require('node:module');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: path.join(__dirname, '..'), encoding: 'utf8'}).trim();
const source = execFileSync('git', ['show', revision + ':dsp.js'], {cwd: path.join(__dirname, '..'), encoding: 'utf8'});
const detector = new Module(path.join(__dirname, '../dsp.js'));
detector._compile(source, detector.id);
const D = detector.exports;
const data = path.join(__dirname, '../data');
const results = [];
for (const file of fs.readdirSync(data).filter(f => /^take-.*\.json$/.test(f)).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(data, file)));
  const wav = fs.readFileSync(path.join(data, file.replace(/\.json$/, '.wav')));
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2);
  const s = new D.RangeSonar({});
  s.p = D.makeProbe({P: meta.P, f0: meta.f0, f1: meta.f1});
  s.chs.forEach(ch => ch.lambda = s.p.lambda);
  const frame = new Float64Array(meta.P), history = [], events = [];
  for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) {
    const t = (f + 1) / s.rate;
    for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767;
    const c = D.cir(s.p, frame); s.ingestCIR(c.re, c.im, c.snr);
    if (f % 5) continue;
    const r = s.analyze(t * 1000);
    history.push({t, moving: s.apnea.moving === true});
    while (history.length && history[0].t <= t - 20) history.shift();
    if (r && r.event === 'start') {
      const label = [...meta.labels].reverse().find(l => t >= l.t)?.label;
      const movingSec = history.filter(x => x.moving).length * 5 / s.rate;
      events.push({t: +t.toFixed(2), label, movingSec: +movingSec.toFixed(2)});
    }
  }
  results.push({file, track: meta.track || meta.plan || meta.id,
    recordedSeconds: +(pcm.length / (s.rate * meta.P)).toFixed(2), labels: meta.labels, events});
}
const walks = results.filter(r => /^walk/.test(r.track)).flatMap(r => r.events.filter(e => e.label === 'empty room'));
const holds = results.flatMap(r => r.events.filter(e => e.label === 'hold'));
const cutoff = Math.min(...walks.map(e => e.movingSec));
console.log(JSON.stringify({revision, candidate: 'Seconds marked moving in the 20 s before each alarm', results,
  summary: {walkAlarms: walks.length, holdAlarms: holds.length, minimumWalkMovement: cutoff,
    maximumHoldMovement: Math.max(...holds.map(e => e.movingSec)),
    cutoffSweep: [4, 6, 8, cutoff, 10].map(threshold => ({threshold,
      walkAlarmsSuppressed: walks.filter(e => e.movingSec >= threshold).length,
      holdAlarmsSuppressed: holds.filter(e => e.movingSec >= threshold).length}))}}, null, 2));
