// Simulator: builds a scene of reflectors (direct path, desk, wall, chest, passers-by, a second
// breathing person), synthesizes what the mic would hear, and runs it through the real dsp.js
// code (the same AudioWorklet + analysis the page uses). Both sonar modes see the same scene.
const D = require('../dsp.js');
const C = D.C, SR = D.SR, BLOCK = 128;

// Deterministic random numbers so every run is reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// Breather: chest distance over time. Rate wanders +-8%, small body sway, freezes during a hold.
function breather({ d, mm, bpm, hold = null, r }) {
  let ph = 0, last = 0, wobble = 0, sway = 0;
  const log = []; // [t, phase] every ~0.1 s, to know the true rate later
  const f = t => {
    const dt = t - last; last = t;
    if (dt > 0) {
      wobble += (-wobble * dt / 10) + gauss(r) * Math.sqrt(dt) * 0.04;
      sway += (-sway * dt / 3) + gauss(r) * Math.sqrt(dt) * 0.0002;
      if (!(hold && t > hold[0] && t < hold[1])) ph += 2 * Math.PI * (bpm / 60) * (1 + wobble) * dt;
      if (!log.length || t - log[log.length - 1][0] >= 0.1) log.push([t, ph]);
    }
    return d + mm / 1000 * (Math.sin(ph) + 0.2 * Math.sin(2 * ph)) / 1.1 + sway;
  };
  // true average rate over [t-win, t] in breaths/min
  f.rate = (t, win = 20) => {
    const at = x => { let i = Math.min(log.length - 1, Math.max(0, Math.round(x / 0.1))); while (i > 0 && log[i][0] > x) i--; return log[i][1]; };
    return (at(t) - at(t - win)) / (2 * Math.PI) / win * 60;
  };
  return f;
}
// Someone standing still-ish: slow random sway/weight shifts (std `cm`, ~2 s time scale),
// plus an arm gesture now and then. This motion is slow, so it lands in the breathing band.
function stander({ d, cm = 2, r }) {
  let x = 0, last = 0, arm = 0, armT = -99;
  return t => {
    const dt = t - last; last = t;
    if (dt > 0) {
      x += -x * dt / 2 + gauss(r) * Math.sqrt(dt) * (cm / 100) ;
      if (r() < dt / 8) armT = t;                       // a gesture every ~8 s
    }
    arm = t - armT < 1.5 ? 0.15 * Math.sin(Math.PI * (t - armT) / 1.5) : 0;
    return { body: d + x, arm: d - 0.1 - arm };
  };
}

// Echo strength falls with distance squared. a0 = strength of a chest at 0.6 m (assumed 0.01
// vs 0.3 for the direct speaker->mic sound, i.e. 30 dB weaker; not measured yet).
const amp = (a0, d) => a0 * (0.6 / d) ** 2;

// Scene options:
//  chest {d, mm, bpm}, hold [t0,t1], walls bool,
//  walkers [{D, every, speed, start}]  person walking past, closest approach D meters
//  bystander {d, mm, bpm}              another seated person breathing
//  noise  multiplier on the base noise floor, gust bool (wind-like slow swells, x0.3..x5)
function makeScene(o, seed = 1) {
  // separate random streams per element, so adding a bystander doesn't change the subject
  const r = rng(seed), rw = rng(seed * 7 + 1);
  const chest = breather({ ...o.chest, hold: o.hold, r: rng(seed * 7 + 2) });
  const by = o.bystander ? breather({ ...o.bystander, r: rng(seed * 7 + 3) }) : null;
  const st = (o.standers || []).map((s, i) => stander({ ...s, r: rng(seed * 7 + 4 + i) }));
  const walkers = (o.walkers || []).map((w, i) => ({ speed: 1.3, start: 3 + 4 * i + rw() * 3, ...w }));
  let g = 0, gLast = 0;
  return {
    opts: o,
    reflectors(t) {
      const out = [{ d: 0.1, a: 0.3 }, { d: 0.35, a: 0.02 }]; // direct path, desk
      if (o.walls !== false) out.push({ d: 1.2, a: 0.05 });
      const c = chest(t); out.push({ d: c, a: amp(0.01, c) });
      if (by) { const b = by(t); out.push({ d: b, a: amp(0.01, b) }); }
      for (const s of st) { const p = s(t); out.push({ d: p.body, a: amp(0.03, p.body) }, { d: p.arm, a: amp(0.005, p.arm) }); }
      for (const w of walkers) {
        const k = Math.floor((t - w.start) / w.every);
        if (k < 0) continue;
        const tt = t - w.start - k * w.every, x = (k % 2 ? 6 : -6) * (1 - 2 * tt * w.speed / 12);
        if (tt * w.speed > 12) continue;                      // off stage until the next pass
        const legs = 0.25 * Math.sin(2 * Math.PI * 0.9 * tt);
        const rt = Math.hypot(w.D, x);
        out.push({ d: rt, a: amp(0.03, rt) });                 // torso (bigger than a chest)
        out.push({ d: Math.hypot(w.D, x + legs), a: amp(0.01, Math.hypot(w.D, x + legs)) });
        out.push({ d: Math.hypot(w.D, x - legs), a: amp(0.01, Math.hypot(w.D, x - legs)) });
      }
      return out;
    },
    noiseStd(t) {
      const base = 0.0012 * (o.noise || 1); // x1 gives ~58 dB tone SNR, matching the measured 57-61 dB
      if (!o.gust) return base;
      const dt = t - gLast; gLast = t;
      g += -g * dt / 1.5 + gauss(r) * Math.sqrt(Math.max(dt, 0)) * 0.9; // slow random swells
      return base * Math.min(5, Math.max(0.3, Math.exp(g)));
    },
    r, truthRate: t => chest.rate(t),
  };
}

// Load a worklet class from its source string.
function loadWorklet(src) {
  let cls;
  const g = globalThis;
  g.sampleRate = SR;
  g.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: m => this.port.onmsg && this.port.onmsg(m) }; } };
  g.registerProcessor = (_, c) => (cls = c);
  new Function(src)();
  return cls;
}

// Run one scene through one mode. Returns a timeline (every 0.2 s) and alert events.
function run(mode, scene, { T = 100, lat = 0.004 } = {}) {
  const AMP = 0.7;
  let sonar, proc, synth;
  if (mode === 'tones') {
    const freqs = [18500, 19500, 20500];
    sonar = new D.ToneSonar(freqs);
    const W = loadWorklet(D.TONE_WORKLET);
    proc = new W({ processorOptions: { freqs: sonar.all, emit: sonar.emit, dec: SR / sonar.rate, amp: AMP } });
    proc.gain = AMP;
    proc.port.onmsg = m => sonar.ingest(m);
    synth = (t, refl) => { let x = 0;
      for (const f of freqs) for (const { d, a } of refl) x += a * Math.cos(2 * Math.PI * f * (t - 2 * d / C - lat));
      return x * AMP / freqs.length; };
  } else {
    sonar = new D.RangeSonar(scene.opts.range || {});
    const p = sonar.p, U = 8, tbl = new Float64Array(p.P * U + 1); // probe sampled 8x finer
    for (let q = 0; q < p.K; q++) { const w = 2 * Math.PI * (p.k0 + q) / (p.P * U);
      for (let n = 0; n < p.P * U; n++) tbl[n] += p.scale * Math.cos(w * n + p.phi[q]); }
    tbl[p.P * U] = tbl[0];
    const W = loadWorklet(D.PROBE_WORKLET);
    proc = new W({ processorOptions: { signal: p.sig, amp: AMP } });
    proc.gain = AMP;
    proc.port.onmsg = f => sonar.ingestFrame(f);
    const per = p.P * U;
    synth = (t, refl) => { let x = 0;
      for (const { d, a } of refl) {
        let pos = ((t - 2 * d / C - lat) * SR * U) % per; if (pos < 0) pos += per;
        const i = Math.floor(pos), fr = pos - i; x += a * (tbl[i] + fr * (tbl[i + 1] - tbl[i]));
      }
      return x * AMP; };
  }
  const timeline = [], events = [];
  const inp = new Float32Array(BLOCK), out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  let nextA = 0.2;
  const nBlocks = Math.floor(T * SR / BLOCK);
  for (let b = 0; b < nBlocks; b++) {
    const t0 = b * BLOCK / SR, t1 = (b + 1) * BLOCK / SR;
    const r0 = scene.reflectors(t0), r1 = scene.reflectors(t1), ns = scene.noiseStd(t0);
    for (let s = 0; s < BLOCK; s++) {
      const t = t0 + s / SR, f = s / BLOCK;
      // reflector lists can differ in length when a walker enters/leaves; lerp where they match
      const refl = r0.length === r1.length ? r0.map((q, i) => ({ d: q.d + f * (r1[i].d - q.d), a: q.a })) : r0;
      inp[s] = synth(t, refl) + ns * gauss(scene.r);
    }
    proc.process([[inp]], [out]);
    if (t1 >= nextA) {
      nextA += 0.2;
      const res = sonar.analyze(t1 * 1000);
      if (res && res.event) events.push([+t1.toFixed(1), res.event]);
      const ch = res && res.ch;
      timeline.push({ t: +t1.toFixed(1),
        bpm: ch && ch.quality > D.SLOW.q && ch.disp.length >= 15 * sonar.rate ? ch.bpm : null,
        q: ch ? ch.quality : 0, alert: sonar.apnea.alerting,
        lock: mode === 'range' && sonar.lock !== null ? +(sonar.lock * sonar.dr).toFixed(2) : null,
        snr: mode === 'tones' ? sonar.snr(1) : sonar.snr });
    }
  }
  return { timeline, events, sonar };
}

// Score a run. Breathing judged from 25 s (window full) until the hold, and 15 s after it.
function score(res, { scene, hold, T }) {
  const tl = res.timeline;
  // judge rate only when the 20 s window holds no breath hold
  const breathing = tl.filter(x => x.t >= 25 && (!hold || x.t < hold[0] || x.t > hold[1] + 20));
  const good = breathing.filter(x => x.bpm !== null && Math.abs(x.bpm - scene.truthRate(x.t)) <= 2).length;
  const starts = res.events.filter(e => e[1] === 'start').map(e => e[0]);
  let latency = null, fa = 0;
  for (const s of starts) {
    if (hold && s >= hold[0] && s <= hold[1] + 2 && latency === null) latency = +(s - hold[0]).toFixed(1);
    else fa++;
  }
  const breathMin = breathing.length * 0.2 / 60;
  return { rateOK: breathing.length ? good / breathing.length : 0, latency, falseAlarms: fa, breathMin,
    snr: tl.length ? tl[tl.length - 1].snr : null };
}

module.exports = { makeScene, run, score, rng };
