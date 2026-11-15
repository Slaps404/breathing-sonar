// Fit the simulated person to each clean guided take, one take at a time.
// Target: that take's own measured table (still echo + motion level in 4 speed bands, per distance slice,
// for normal breathing and for breath holds; see measure.js). The simulation runs the take's own plan and
// is measured the same way. Search: random steps, keep a step when the mismatch shrinks.
// NOT in the target: anything the detector outputs (alarms, lock distance). Those are checked afterwards
// by validate.js, so that check is a real test and not a fit.
// Usage: node tools/fit/fit.js [iterations=300]   -> docs/sim/fitted.json
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const T = require('./takes.js'), M = require('./measure.js'), S = require('./scene.js'), { BANDS, med } = require('./bands.js');
const OUT = path.join(T.ROOT, 'docs', 'sim');
// Clean guided takes with a seated person and labeled holds. Left out: 23-20-21 (125 audio dropouts),
// 22-17-05 and the two app takes (labels pressed by hand: the hand shows in the echo), takes without holds.
const TAKES = ['take-2026-11-14T22-41-04-642Z', 'take-2026-11-15T00-15-23-440Z', 'take-2026-11-15T02-54-00-030Z', 'take-2026-11-15T03-09-51-923Z', 'take-2026-11-15T03-40-26-237Z'];
// Train/test split inside each take: the fit sees only the take up to TRAIN_END (seconds); the later holds
// are never measured by the fit and are scored separately by validate.js.
const TRAIN_END = { 'take-2026-11-14T22-41-04-642Z': 150, 'take-2026-11-15T00-15-23-440Z': 100, 'take-2026-11-15T02-54-00-030Z': 150, 'take-2026-11-15T03-09-51-923Z': 120, 'take-2026-11-15T03-40-26-237Z': 166 };
const SL = [4, 20], FITBANDS = ['drift', 'breath', 'mid', 'fast'];
// name, low, high, step
const SPACE = [['d', 0.22, 0.6, 0.03], ['aDb', -56, -28, 2], ['depth', 0.3, 6, 0.4], ['sway', 0, 1, 0.1], ['swayTau', 0.8, 8, 0.6], ['drift', 0, 1, 0.1], ['tremor', 0, 0.1, 0.01],
  ['heart', 0, 0.3, 0.03], ['bgWander', 0, 8, 0.6], ['bodyWander', 0, 8, 0.6], ['wanderTau', 3, 30, 3], ['rateWobble', 0.01, 0.15, 0.015], ['depthWobble', 0, 0.5, 0.05],
  ['g0', -15, 6, 1.5], ['g2', -15, 6, 1.5], ['g3', -20, 3, 1.5], ['k0', 0, 1.2, 0.12], ['k2', 0, 1.2, 0.12], ['k3', 0, 1.2, 0.12], ['moveSpeed', 5, 150, 10]];
const START = { d: 0.36, aDb: -44, depth: 2, sway: 0.1, swayTau: 2.5, drift: 0.1, tremor: 0.01, heart: 0.05, bgWander: 2, bodyWander: 2, wanderTau: 10, rateWobble: 0.06, depthWobble: 0.2, g0: -3, g2: -4, g3: -9, k0: 0.5, k2: 0.35, k3: 0.6, moveSpeed: 40 };
// The person adds only what breathing adds. Sway, heartbeat, room: already in the background (the take's hold levels).
function person(v, bpm) {
  return { d: v.d, aDb: v.aDb, depth: v.depth, bpm, sway: v.sway, swayTau: v.swayTau, drift: v.drift, tremor: v.tremor, heart: v.heart, rateWobble: v.rateWobble, depthWobble: v.depthWobble, bgWander: v.bgWander, bodyWander: v.bodyWander, wanderTau: v.wanderTau,
    holdSway: 0, holdSettle: 0, moveSpeed: v.moveSpeed, parts: [[-0.07, v.g0, v.k0, 1], [0, 0, 1, 1], [0.09, v.g2, v.k2, 1], [0.22, v.g3, v.k3, 1]], far: null };
}
function loss(target, got) {
  let s = 0, c = 0; const detail = {};
  for (const cls of ['normal', 'hold', 'moving']) {
    if (!target.cls[cls] || !got.cls[cls]) continue;
    const w = cls === 'moving' ? 0.3 : 1; let cs = 0, cc = 0;
    for (const b of FITBANDS) for (let r = SL[0]; r <= SL[1]; r++) { const e = got.cls[cls].bands[b][r] - target.cls[cls].bands[b][r]; cs += e * e; cc++; }
    for (let r = SL[0]; r <= SL[1]; r++) { const e = got.cls[cls].still[r] - target.cls[cls].still[r]; cs += 0.25 * e * e; cc += 0.25; }
    detail[cls] = +Math.sqrt(cs / cc).toFixed(2); s += w * cs; c += w * cc;
  }
  // the hold-vs-normal contrast in the breathing band is what the detector lives on: weight it again
  if (target.cls.hold && got.cls.hold) { let cs = 0, cc = 0; for (let r = SL[0]; r <= SL[1]; r++) { const e = (got.cls.normal.bands.breath[r] - got.cls.hold.bands.breath[r]) - (target.cls.normal.bands.breath[r] - target.cls.hold.bands.breath[r]); cs += e * e; cc++; }
    detail.contrast = +Math.sqrt(cs / cc).toFixed(2); s += 2 * cs; c += 2 * cc; }
  // how much levels swing over time (the detector compares a moment with the top quarter of the last minute)
  for (const [cls, w] of [['normal', 1], ['hold', 0.5]]) { if (!target.cls[cls]?.spread?.[SL[0]] || !got.cls[cls]?.spread?.[SL[0]]) continue; let cs = 0, cc = 0;
    for (let r = SL[0]; r <= SL[1]; r++) { const e = got.cls[cls].spread[r] - target.cls[cls].spread[r]; cs += e * e; cc++; }
    detail['spread_' + cls] = +Math.sqrt(cs / cc).toFixed(2); s += w * cs; c += w * cc; }
  // the zone picker's inputs: repeat score (0.1 counts like 6 dB) and breathing-vs-fast power per slice
  if (target.rhythm && got.rhythm) { let cs = 0, cc = 0; for (let r = SL[0]; r <= SL[1]; r++) { const e = (got.rhythm.p[r] - target.rhythm.p[r]) * 60, e2 = (got.rhythm.snr[r] - target.rhythm.snr[r]) * 0.7; cs += e * e + e2 * e2; cc += 2; }
    detail.rhythm = +Math.sqrt(cs / cc).toFixed(2); s += 2 * cs; c += 2 * cc; }
  return { rms: Math.sqrt(s / c), detail };
}
function fitOne(id, iters, room) {
  const fr = T.load(id), end = TRAIN_END[id], train = fr.m.segs.filter(x => x.b <= end + 1e-6);
  const target = M.measureFrames(fr, train), tr = T.detect(fr, { trace: true }).trace.filter(x => x.t <= end);
  const bpm = med(tr.filter(x => x.q > 0.5 && !x.alert).map(x => x.bpm)) || 15, segs = train, Tsec = end;
  // 1. the modelled chest alone (silent room)  2. excess = measured normal - measured hold - chest alone
  // 3. full scene = hold background + excess (off during holds) + chest
  const SILENT = { still: target.cls.hold.still.map(() => -200), bands: Object.fromEntries(Object.keys(BANDS).map(k => [k, target.cls.hold.still.map(() => -200)])) };
  const lin = x => Math.pow(10, x / 10);
  const excessOf = (v, seed) => { const only = M.measureFrames(S.simulate({ segs, T: Tsec, person: { ...person(v, bpm), bgWander: 0 }, room: SILENT, bands: BANDS, seed }), segs).cls.normal.bands;
    return Object.fromEntries(Object.keys(BANDS).map(k => [k, target.cls.normal.bands[k].map((N, r) => +(10 * Math.log10(Math.max(lin(N) - lin(target.cls.hold.bands[k][r]) - lin(only[k][r]), 1e-20))).toFixed(1))])); };
  const run = (v, seed) => M.measureFrames(S.simulate({ segs, T: Tsec, person: person(v, bpm), room: target.cls.hold, excess: excessOf(v, seed), bands: BANDS, seed }), segs);
  // average over 2 noise seeds so the search does not chase one lucky noise draw
  const f = v => (loss(target, run(v, 11)).rms + loss(target, run(v, 12)).rms) / 2;
  const r = S.rng(id.length * 7919 + 5), g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  // start the chest where the recording repeats best (not where the detector locked: that stays untouched for validate.js)
  let rb = SL[0]; for (let k = SL[0]; k <= 12; k++) if (target.rhythm.p[k] > target.rhythm.p[rb]) rb = k;
  let best = { ...START, d: Math.min(0.6, Math.max(0.22, rb * fr.dr)) }, bl = f(best); const first = bl, hist = [bl];
  for (let it = 0; it < iters; it++) {
    const v = { ...best }, scale = it < iters * 0.6 ? 1.5 : 0.6, k = 1 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) { const [name, lo, hi, st] = SPACE[Math.floor(r() * SPACE.length)]; v[name] = Math.min(hi, Math.max(lo, v[name] + g() * st * scale)); }
    const l = f(v); if (l < bl) { bl = l; best = v; }
    if (it % 25 === 24) hist.push(+bl.toFixed(3));
  }
  const check = loss(target, run(best, 99));   // a noise seed the search never saw
  return { id, trainEnd: end, bpm: +bpm.toFixed(1), background: target.cls.hold, excess: excessOf(best, 99), start: +first.toFixed(2), fit: +bl.toFixed(2), unseen: +check.rms.toFixed(2), detail: check.detail, hist, v: Object.fromEntries(Object.entries(best).map(([k, x]) => [k, +x.toFixed(3)])) };
}
module.exports = { TAKES, TRAIN_END, person, loss, START, SPACE };
if (!isMainThread) parentPort.postMessage(fitOne(workerData.id, workerData.iters, workerData.room));
else if (require.main === module) {
  const iters = +(process.argv[2] || 300), room = JSON.parse(fs.readFileSync(path.join(OUT, 'measured.json'))).pooled.empty, res = [], t0 = Date.now();
  let left = TAKES.length;
  for (const id of TAKES) new Worker(__filename, { workerData: { id, iters, room } }).on('message', m => {
    res.push(m); console.log(m.id.slice(16, 24), `mismatch ${m.start} -> ${m.fit} dB rms (unseen noise seed: ${m.unseen})`, JSON.stringify(m.detail));
    if (!--left) { res.sort((a, b) => a.id < b.id ? -1 : 1);
      fs.writeFileSync(path.join(OUT, 'fitted.json'), JSON.stringify({ made: new Date().toISOString(), iters, slices: SL, bands: FITBANDS, takes: res }, null, 1));
      console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s -> docs/sim/fitted.json`); }
  }).on('error', e => { console.error(id, e); left--; });
}
