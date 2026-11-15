// Does the alarm's own beep confuse the sonar, and would a different beep pitch fix it?
// Recordings show each 880 Hz beep shakes the laptop speaker and smears the 20-22 kHz probe into copies
// 880 Hz above and below it (19-20 and 22-23 kHz jump ~30 dB), part of which lands inside the probe band.
// Model: mic = clean mic * (1 + m * beep envelope * cos(2 pi f t)) + the beep's high harmonics near the band.
//   1. Calibrate m on real app takes: pick m so a simulated 880 Hz beep raises the noise just above the band as
//      much as the real beeps did, then check it also moves the echoes as much (the model's sanity check).
//   2. Add simulated beeps (none / 880 / 3000 Hz, at m and 3m) to the labelled breath holds in data/:
//      A. beeps from alarm start for the 6 s countdown: does the alarm clear while the breath is still held?
//      B. beeps from alarm start until 8 s after the hold ends: how long until the alarm clears once breathing returns?
// Usage (repo root): node tools/beep-backtest.js [app take .wav ...]   (defaults: ~/Downloads app takes with alarms)
const fs = require('fs'), path = require('path');
const D = require('../dsp.js');
const SR = 48000, P = 2048, COUNTDOWN = 6;

function readTake(file) {
  const wav = fs.readFileSync(file), db = wav.readUInt32LE(40), at = 44 + db + (db % 2);
  const jsonFile = file.replace(/\.wav$/, '.json');
  const meta = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile))
    : JSON.parse(wav.toString('utf8', at + 8, at + 8 + wav.readUInt32LE(at + 4)));
  const i16 = new Int16Array(wav.buffer, wav.byteOffset + 44, db >> 1), pcm = new Float64Array(i16.length);
  for (let i = 0; i < i16.length; i++) pcm[i] = i16[i] / 32767;
  return { meta, pcm, p: D.makeProbe({ P: meta.P, f0: meta.f0, f1: meta.f1 }) };
}
// The app's beep: on every 700 ms, gain 0.5 falling to 0.001 over 0.35 s, cut at 0.4 s.
function beepEnv(t) {
  if (t < 0) return 0;
  const u = t % 0.7;
  return u < 0.4 ? Math.min(1, Math.pow(0.002, u / 0.35)) : 0;
}
// Harmonics measured at the mic for the real 880 Hz beep fall ~80 dB below the tone by the 6th-8th; 3 kHz's 7th
// (21 kHz) lands in the band, so it is added at that level (tone ~0.7 at the mic).
const HARM = 0.7 * 1e-4;
function frameWithBeep(pcm, fr, t0, f, m) {
  const x = new Float64Array(P);
  for (let i = 0; i < P; i++) {
    const n = fr * P + i, t = n / SR, e = beepEnv(t - t0);
    let y = pcm[n];
    if (e > 0 && f) {
      y *= 1 + m * e * Math.cos(2 * Math.PI * f * t);
      for (let k = 2; k * f < 24000; k++) if (k * f > 19000) y += HARM * e * Math.cos(2 * Math.PI * k * f * t);
    }
    x[i] = y;
  }
  return x;
}
function noiseDb(p, x) {   // same bins cir() calls noise: just above the probe band
  const re = Float64Array.from(x), im = new Float64Array(P); D.fft(re, im);
  let s = 0, n = 0; for (let k = p.k1 + 10; k < p.k1 + 60; k++) { s += re[k] ** 2 + im[k] ** 2; n++; }
  return 10 * Math.log10(s / n + 1e-30);
}
function changeDb(a, b) {   // frame-to-frame echo change relative to echo strength (what looks like movement)
  let d = 0, e = 0; for (let m = 0; m < a.re.length; m++) { d += (a.re[m] - b.re[m]) ** 2 + (a.im[m] - b.im[m]) ** 2; e += a.re[m] ** 2 + a.im[m] ** 2; }
  return 10 * Math.log10(d / e + 1e-30);
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// ---------- 1. calibrate on real app takes ----------
const appTakes = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(process.env.HOME, 'Downloads')).filter(n => /^take-2026-11-15T1[5-7].*\.wav$/.test(n)).map(n => path.join(process.env.HOME, 'Downloads', n));
const real = { noise: [], change: [] }, sim = {};
const MS = [0.01, 0.03, 0.1, 0.2, 0.3, 0.5];
for (const file of appTakes) {
  const { meta, pcm, p } = readTake(file);
  const ta = meta.events?.find(e => e.event === 'alarm: countdown')?.t; if (!ta) continue;
  const fA = Math.round(ta * SR / P), fB = Math.round((ta + COUNTDOWN) * SR / P), fQ = Math.round((ta - 12) * SR / P);
  const quietNoise = [];
  for (let fr = fQ; fr < fQ + 6 * SR / P; fr++) quietNoise.push(noiseDb(p, pcm.subarray(fr * P, fr * P + P)));
  const q = median(quietNoise);
  let prev = null;
  for (let fr = fA; fr < fB; fr++) {
    const x = pcm.slice(fr * P, fr * P + P), c = D.cir(p, x);
    real.noise.push(noiseDb(p, x) - q); if (prev) real.change.push(changeDb(c, prev)); prev = c;
  }
  // same 6 s of beeps, simulated on the quiet stretch 12 s earlier (breathing, no beeps)
  const t0 = fQ * P / SR;
  for (const m of MS) {
    const s = sim[m] ??= { noise: [], change: [] }; let pv = null;
    for (let fr = fQ; fr < fQ + COUNTDOWN * SR / P; fr++) {
      const x = frameWithBeep(pcm, fr, t0, 880, m), c = D.cir(p, x);
      s.noise.push(noiseDb(p, x) - q); if (pv) s.change.push(changeDb(c, pv)); pv = c;
    }
  }
  // no-beep reference for echo change on that stretch
  const s0 = sim[0] ??= { noise: [], change: [] }; let pv = null;
  for (let fr = fQ; fr < fQ + COUNTDOWN * SR / P; fr++) {
    const x = pcm.slice(fr * P, fr * P + P), c = D.cir(p, x);
    s0.noise.push(noiseDb(p, x) - q); if (pv) s0.change.push(changeDb(c, pv)); pv = c;
  }
}
console.log(`1. Calibration (${appTakes.length} app takes, 6 s of alarm each). Mean over the countdown:`);
console.log(`   real 880 Hz beeps:      noise above band +${mean(real.noise).toFixed(1)} dB   echo change ${mean(real.change).toFixed(1)} dB`);
for (const m of [0, ...MS]) console.log(`   simulated m=${String(m).padEnd(6)} noise above band ${(mean(sim[m].noise) >= 0 ? '+' : '') + mean(sim[m].noise).toFixed(1)} dB   echo change ${mean(sim[m].change).toFixed(1)} dB`);
const mFit = MS.reduce((b, m) => Math.abs(mean(sim[m].noise) - mean(real.noise)) < Math.abs(mean(sim[b].noise) - mean(real.noise)) ? m : b, MS[0]);
console.log(`   -> m = ${mFit} matches the real noise rise\n`);

// ---------- 2. backtest on labelled holds ----------
const holdTakes = fs.readdirSync('data').filter(n => n.endsWith('.json') && n.startsWith('take-')).map(n => 'data/' + n.replace('.json', '.wav'))
  .filter(f => fs.existsSync(f) && JSON.parse(fs.readFileSync(f.replace('.wav', '.json'))).labels.some(l => l.label === 'hold'));
const variants = [['no beep', 0, 0], ['880 Hz', 880, mFit], ['3000 Hz', 3000, mFit], ['880 Hz x3', 880, 3 * mFit], ['3000 Hz x3', 3000, 3 * mFit]];
const tally = Object.fromEntries(variants.map(v => [v[0], { wrongClear: 0, n: 0, delays: [], missed: 0 }]));
for (const file of holdTakes) {
  const { meta, pcm, p } = readTake(file), rate = p.rate, nF = Math.floor(pcm.length / P);
  const clean = []; for (let fr = 0; fr < nF; fr++) clean.push(D.cir(p, pcm.subarray(fr * P, fr * P + P)));
  const labels = meta.labels.map((l, i) => ({ label: l.label, a: l.t, b: meta.labels[i + 1]?.t ?? meta.seconds }));
  const replay = (beep) => {   // beep: { t0, t1, f, m } or null
    const s = new D.RangeSonar(); s.p = p; s.chs.forEach(c => c.lambda = p.lambda); const ev = [];
    for (let fr = 0; fr < nF; fr++) {
      const t = (fr + 1) / rate;
      let c = clean[fr];
      if (beep && beep.f && t > beep.t0 && t - 1 / rate < beep.t1) c = D.cir(p, frameWithBeep(pcm, fr, beep.t0, beep.f, beep.m));
      s.ingestCIR(c.re, c.im, c.snr);
      if (fr % 5) continue;
      const r = s.analyze(t * 1000); if (r?.event) ev.push({ t, type: r.event });
    }
    return ev;
  };
  const base = replay(null);
  for (const h of labels.filter(l => l.label === 'hold')) {
    const st = base.find(e => e.type === 'start' && e.t >= h.a && e.t < h.b); if (!st) continue;
    const line = [`${path.basename(file).slice(16, 24)} hold ${h.a.toFixed(0)}-${h.b.toFixed(0)} s, alarm ${st.t.toFixed(1)} s:`];
    for (const [name, f, m] of variants) {
      const T = tally[name]; T.n++;
      const evA = replay({ t0: st.t, t1: Math.min(st.t + COUNTDOWN, h.b), f, m });
      const wrong = evA.find(e => e.type === 'end' && e.t > st.t && e.t < h.b);
      if (wrong) T.wrongClear++;
      const evB = replay({ t0: st.t, t1: h.b + 8, f, m });
      const back = evB.find(e => e.type === 'end' && e.t >= h.b - 0.5);
      const firstEnd = evB.find(e => e.type === 'end' && e.t > st.t);
      let cell;
      if (firstEnd && firstEnd.t < h.b - 0.5) cell = 'cleared early';
      else if (back && back.t <= h.b + 15) { T.delays.push(back.t - h.b); cell = `back +${(back.t - h.b).toFixed(1)} s`; }
      else { T.missed++; cell = 'never cleared'; }
      line.push(`${name}: ${wrong ? 'CLEARED IN HOLD' : 'held'}, ${cell}`);
    }
    console.log(line.join('\n    '));
  }
}
console.log('\n2. Summary over', tally['no beep'].n, 'alarmed holds');
for (const [name] of variants) {
  const T = tally[name];
  console.log(`   ${name.padEnd(11)} alarm wrongly cleared during countdown: ${T.wrongClear}/${T.n}   clear after breathing returns: median ${T.delays.length ? median(T.delays).toFixed(1) : '-'} s, never ${T.missed}`);
}
