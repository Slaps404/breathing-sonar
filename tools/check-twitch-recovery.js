// Regression: a brief body jolt during a breath hold must not clear the hold alarm.
// Usage (repo root): node tools/check-twitch-recovery.js
// Part 1 needs no audio (made-up feature values through holdStep, made-up echoes through holdFeatures).
// Part 2 replays two local recordings (data/ is ignored by git). Set ALLOW_NO_AUDIO=1 to run without them;
// otherwise a missing recording is a failure, so this never passes silently on nothing.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const D = require('../dsp.js');

// ---------- Part 1: synthetic ----------
// holdStep: 30 s of normal breathing levels, then a hold. B = breathing-band power, S = sustained motion.
function alarmed() {
  const st = D.makeHold(); let t = 0; const step = (B, S, M = -30) => D.holdStep(st, { B, S, M }, (t += 200));
  for (let i = 0; i < 150; i++) step(18, -20);
  let ev = null; for (let i = 0; i < 40 && ev !== 'start'; i++) ev = step(8, -32);
  assert.equal(ev, 'start', 'synthetic hold must raise the alarm');
  return { st, step };
}
{ // a jolt: band power is back (the 8 s spectrum smears it) but motion is not sustained
  const { st, step } = alarmed();
  for (let i = 0; i < 25; i++) assert.equal(step(17, -30), null, 'power without sustained motion must not clear');
  assert.equal(st.alerting, true);
}
{ // real recovery: power and sustained motion both back
  const { step } = alarmed();
  assert.equal(step(17, -21), 'end', 'recovered power plus sustained motion must clear');
}
{ // gross movement still clears at once
  const { step } = alarmed();
  assert.equal(step(8, -32, 0), 'end', 'gross movement must clear');
}
{ // holdFeatures: S must separate steady breathing from one 2 s jolt of the same size
  const rate = 48000 / 2048, n = Math.round(30 * rate);
  const chan = fn => { const ch = D.makeChannel(0.016, rate); for (let i = 0; i < n; i++) { const [a, b] = fn(i / rate); D.pushIQ(ch, a, b); } return ch; };
  const breath = chan(t => [Math.cos(0.5 * Math.sin(2 * Math.PI * 0.25 * t)), Math.sin(0.5 * Math.sin(2 * Math.PI * 0.25 * t))]);
  const jolt = chan(t => { const x = t > 25 && t < 27 ? 0.5 * Math.sin(Math.PI * (t - 25) / 2) : 0; return [Math.cos(x), Math.sin(x)]; });
  const fb = D.holdFeatures([breath], [breath], rate), fj = D.holdFeatures([jolt], [jolt], rate);
  assert.ok(Number.isFinite(fb.S) && Number.isFinite(fj.S), 'holdFeatures must report sustained motion S');
  assert.ok(fb.S - fj.S > 20, `sustained motion: breathing ${fb.S.toFixed(1)} dB must be far above a jolt ${fj.S.toFixed(1)} dB`);
  assert.ok(fb.B - fj.B < 15, 'the jolt is only a fair test if it also puts power in the breathing band');
}
console.log('synthetic: ok');

// ---------- Part 2: recordings ----------
function replay(id) {
  const base = path.join(__dirname, '../data', id);
  if (!fs.existsSync(base + '.wav')) {
    if (process.env.ALLOW_NO_AUDIO) { console.log(`SKIPPED ${id}: no audio`); return null; }
    throw new Error(`missing ${base}.wav (set ALLOW_NO_AUDIO=1 to run the synthetic part only)`);
  }
  const meta = JSON.parse(fs.readFileSync(base + '.json')), wav = fs.readFileSync(base + '.wav');
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, wav.readUInt32LE(40) / 2);
  const s = new D.RangeSonar(); s.p = D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 }); s.chs.forEach(c => c.lambda = s.p.lambda);
  const labels = meta.labels.map((l, i) => ({ label: l.label, a: l.t, b: meta.labels[i + 1]?.t ?? meta.seconds }));
  const frame = new Float64Array(meta.P), events = [];
  for (let f = 0; f < Math.floor(pcm.length / meta.P); f++) {
    const t = (f + 1) / s.rate;
    for (let i = 0; i < meta.P; i++) frame[i] = pcm[f * meta.P + i] / 32767;
    s.ingestFrame(frame);
    if (f % 5) continue;
    const res = s.analyze(t * 1000);
    if (res?.event) events.push({ t, type: res.event });
  }
  return { labels, events };
}
const fmt = ev => ev.map(e => `${e.type} ${e.t.toFixed(1)}`).join(', ');

// Three 15 s holds: still, one shoulder twitch, two shoulder twitches (twitch times are approximate).
const tw = replay('take-2026-11-15T03-09-51-923Z');
if (tw) {
  console.log('twitch take:', fmt(tw.events));
  for (const h of tw.labels.filter(l => l.label === 'hold')) {
    const start = tw.events.find(e => e.type === 'start' && e.t >= h.a && e.t < h.b);
    assert.ok(start, `hold at ${h.a.toFixed(0)} s must alarm`);
    const end = tw.events.find(e => e.type === 'end' && e.t > start.t);
    assert.ok(end, `alarm of hold at ${h.a.toFixed(0)} s must clear after breathing resumes`);
    assert.ok(end.t >= h.b - 1, `alarm cleared at ${end.t.toFixed(1)} s, inside the hold ${h.a.toFixed(1)}-${h.b.toFixed(1)} s`);
    assert.ok(end.t <= h.b + 10, `alarm cleared ${(end.t - h.b).toFixed(1)} s after the hold ended (limit 10 s)`);
  }
}
// Gross movement: the person gets up at 210 s while the alarm of the 190-210 s hold is on.
const mv = replay('take-2026-11-14T23-20-21-608Z');
if (mv) {
  console.log('movement take:', fmt(mv.events));
  const start = mv.events.find(e => e.type === 'start' && e.t >= 190 && e.t < 210);
  assert.ok(start, 'hold at 190 s must alarm');
  const end = mv.events.find(e => e.type === 'end' && e.t > start.t);
  assert.ok(end && end.t >= 209 && end.t <= 213, `movement at 210 s must clear the alarm within 3 s (cleared ${end?.t.toFixed(1)})`);
}
console.log('ok');
