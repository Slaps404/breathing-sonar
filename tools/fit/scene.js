// Calibrated simulator. Makes the echo profiles (what dsp.js computes from each mic frame) directly,
// about 100x faster than synthesizing audio, so it can be fitted to recordings and run thousands of times.
//
// How a scene is built:
//   1. Empty room: per slice, still echo + coloured fluctuation with the levels MEASURED in the empty-room
//      takes (docs/sim/measured.json). Nothing is assumed about why the room fluctuates.
//   2. A person: a few point reflectors (chest, belly/lap, shoulders, later bounces). Each moves by
//      breathing x its share + body sway + heartbeat + events (twitch, shift, walk away). A reflector at
//      distance d moving by x changes the echo phase by 4*pi*x/lambda; the probe's own blur across slices
//      (point spread) is computed exactly from the probe definition.
//   3. Events from the plan: hold (breathing stops, sway continues), moving, empty room, twitch, hand.
// Exactness check against the audio path: node tools/fit/check-scene.js
const D = require('../../dsp.js');
const C = D.C, SR = D.SR;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

// Default person. Distances in m from the direct path, motion in mm, strengths in dB relative to the
// direct speaker->mic sound. Values here are the starting guess; tools/fit/fit.js replaces them per take.
const PERSON = {
  d: 0.36,            // chest distance
  aDb: -40,           // chest echo strength
  depth: 2.0,         // breathing: chest moves +-depth mm
  bpm: 14, rateWobble: 0.06, depthWobble: 0.2,
  parts: [            // [offset m, strength dB re chest, share of breathing, share of sway]
    [-0.07, -3, 0.5, 1.0],   // belly / lap / hands, nearer than the chest
    [0.0, 0, 1.0, 1.0],      // chest
    [0.09, -4, 0.35, 1.0],   // shoulders / neck
    [0.22, -9, 0.6, 1.0],    // later bounce of the chest echo
  ],
  sway: 0.25, swayTau: 2.5,      // body sway, mm rms and time scale (s); goes on during a hold
  drift: 1.0, driftTau: 25,      // slow posture drift, mm rms
  heart: 0.08,                   // heartbeat at the chest, mm
  tremor: 0.03,                  // fast small motion, mm rms (1-6 Hz)
  holdSway: 1.0,                 // sway multiplier while holding breath
  holdSettle: 1.0,               // mm the chest sinks over a hold (slow exhale leak)
  far: { d: 0.86, aDb: -47, sway: 0.5, tau: 4 },   // something behind (chair back / torso edge): sways, does not breathe
  moveSpeed: 40,                 // mm/s rms body speed while "moving"
};

// Point spread: echo profile of one reflector with round-trip delay tau (samples) and amplitude a.
function makePsf(p, i0, nTap) {
  const K = p.K, L = p.L, er = new Float64Array(K * nTap), ei = new Float64Array(K * nTap);
  for (let q = 0; q < K; q++) for (let m = 0; m < nTap; m++) { const a = 2 * Math.PI * q * (m + i0) / L; er[q * nTap + m] = Math.cos(a) * p.win[q]; ei[q * nTap + m] = Math.sin(a) * p.win[q]; }
  let peak = 0; for (let q = 0; q < K; q++) peak += p.win[q];
  return { nTap, peak, add(re, im, off, a, tau) {     // adds into re/im[off .. off+nTap)
    const w = -2 * Math.PI * tau / p.P, cw = Math.cos(w), sw = Math.sin(w);
    let cr = a * Math.cos(w * p.k0), ci = a * Math.sin(w * p.k0);
    for (let q = 0; q < K; q++) {
      const b = q * nTap;
      for (let m = 0; m < nTap; m++) { re[off + m] += cr * er[b + m] - ci * ei[b + m]; im[off + m] += cr * ei[b + m] + ci * er[b + m]; }
      const t = cr * cw - ci * sw; ci = cr * sw + ci * cw; cr = t;
    }
  } };
}

// Coloured noise with a given level per band (dB, power per component), by shaping white noise in frequency.
function coloured(n, rate, levels, bands, r) {
  let N = 1; while (N < n) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { re[i] = gauss(r); im[i] = gauss(r); }
  D.fft(re, im);
  const names = Object.keys(bands), fc = names.map(k => Math.log(Math.sqrt(bands[k][0] * bands[k][1]))), lv = names.map(k => levels[k]);
  for (let k = 0; k < N; k++) {
    const f = Math.max(Math.min(k, N - k) * rate / N, 1e-3), x = Math.log(f);
    let v; if (x <= fc[0]) v = lv[0]; else if (x >= fc[fc.length - 1]) v = lv[lv.length - 1];
    else { let j = 0; while (x > fc[j + 1]) j++; v = lv[j] + (lv[j + 1] - lv[j]) * (x - fc[j]) / (fc[j + 1] - fc[j]); }
    const g = Math.pow(10, v / 20) / N; re[k] *= g; im[k] = -im[k] * g;   // conj for the inverse transform
  }
  D.fft(re, im);
  return { re, im: im.map(v => -v) };
}

// plan: [{label, a, b, ...}] with labels normal | hold | moving | empty room | twitch | hand | shift.
//   twitch: {label:'twitch', a, b, mm}  short body jolt inside any segment (overlay, list in `extra`)
// room: pooled measurement (measured.json .pooled.empty) ; person: see PERSON (null = nobody).
// room      = background table { still[], bands{} }. With a person: that take's own levels DURING HOLDS (everything
//             that moves when breathing does not: sway, heartbeat, room). Then only breathing is added on top.
// emptyRoom = background once the person has walked out (pooled empty-room takes); faded in over 3 s.
// excess    = extra motion per slice and band present while the person breathes normally and absent in holds
//             (measured normal minus measured hold minus what the modelled chest already gives). Not rhythmic.
//             Covers what a few point reflectors cannot: the whole body moves a little more when it breathes.
function simulate({ segs, extra = [], T, person = PERSON, room, emptyRoom = null, excess = null, bands, seed = 1, i0 = 20, A0 = 7 }) {
  const p = D.makeProbe(), rate = p.rate, L = p.L, n = Math.floor(T * rate), nTap = 30;
  const re = new Float32Array(n * L), im = new Float32Array(n * L), snr = new Float32Array(n).fill(68);
  const r = rng(seed * 9973 + 7), rs = rng(seed * 31 + 3);
  // 1. empty room
  const leave = emptyRoom ? segs.find(x => x.label === 'empty room') : null, back = emptyRoom ? segs.find(x => x.label === 'returned') : null;
  const goneW = t => !leave || t < leave.a ? 0 : back && t >= back.a ? 0 : Math.min(1, (t - leave.a) / 3);
  // Levels are not steady in the recordings: the breathing-band level of a slice swings about 10 dB (10th to
  // 90th percentile) within one take, steady noise only about 6. So the background's strength wanders slowly
  // (bgWander dB rms, wanderTau s), the same for all slices: the body is one thing.
  const Pw = { bgWander: 0, bodyWander: 0, wanderTau: 10, ...(person || {}) }, gain = new Float64Array(n).fill(1);
  if (Pw.bgWander > 0) { const rw = rng(seed * 577 + 11); let w = gauss(rw) * Pw.bgWander; for (let f = 0; f < n; f++) { w += -w / (Pw.wanderTau * rate) + gauss(rw) * Math.sqrt(2 / (Pw.wanderTau * rate)) * Pw.bgWander; gain[f] = Math.pow(10, w / 20); } }
  for (let s = 0; s < nTap; s++) {
    const R = Math.min(s, room.still.length - 1), ph = 2 * Math.PI * rs(), tab = [room, ...(leave ? [emptyRoom] : [])].map(rm => ({
      a: A0 * Math.pow(10, rm.still[R] / 20), c: coloured(n, rate, Object.fromEntries(Object.keys(bands).map(k => [k, rm.bands[k][R]])), bands, r) }));
    for (let f = 0; f < n; f++) {
      const w = leave ? goneW((f + 1) / rate) : 0, w0 = Math.sqrt(1 - w), w1 = Math.sqrt(w);   // power crossfade
      let a = tab[0].a * (1 - w), cr = w0 * gain[f] * tab[0].c.re[f], ci = w0 * gain[f] * tab[0].c.im[f];
      if (leave) { a += tab[1].a * w; cr += w1 * tab[1].c.re[f]; ci += w1 * tab[1].c.im[f]; }
      re[f * L + i0 + s] = a * Math.cos(ph) + A0 * cr; im[f * L + i0 + s] = a * Math.sin(ph) + A0 * ci;
    }
  }
  if (excess) {
    const gate = new Float64Array(n), rx = rng(seed * 811 + 13), bw = (person && person.bodyWander) || 0, tau = (person && person.wanderTau) || 10; let g = 1, w = gauss(rx) * bw;
    for (let f = 0; f < n; f++) { const t = (f + 1) / rate, sg = segs.find(x => t >= x.a && t < x.b), on = !sg || (sg.label !== 'hold' && sg.label !== 'empty room');
      g += ((on ? 1 : 0) - g) * Math.min(1, 1 / (1.5 * rate)); w += -w / (tau * rate) + gauss(rx) * Math.sqrt(2 / (tau * rate)) * bw; gate[f] = g * Math.pow(10, w / 20); }
    for (let s = 0; s < nTap; s++) { const R = Math.min(s, excess.breath.length - 1), c = coloured(n, rate, Object.fromEntries(Object.keys(bands).map(k => [k, excess[k][R]])), bands, r);
      for (let f = 0; f < n; f++) { re[f * L + i0 + s] += A0 * gate[f] * c.re[f]; im[f * L + i0 + s] += A0 * gate[f] * c.im[f]; } }
  }
  if (!person) return pack();
  // 2. the person's motion, frame by frame
  const P = { wanderTau: 10, ...PERSON, ...person }, psf = makePsf(p, i0, nTap), dt = 1 / rate;
  const tau = d => i0 * p.P / L + 2 * d / C * SR;   // round-trip delay in samples; the direct path sits at slice i0
  const at = (t, lab) => segs.find(s => t >= s.a && t < s.b && (!lab || s.label === lab));
  let ph = 2 * Math.PI * r(), wob = 0, dep = 1, sway = 0, drift = 0, trem = 0, hph = 0, settle = 0, pos = 0, vel = 0, gone = 0, farS = 0, lastCycle = 0, hand = 0, ksS = 1, wB = 0;
  const hr = (62 + 16 * r()) / 60;
  for (let f = 0; f < n; f++) {
    const t = (f + 1) / rate, seg = at(t), lab = seg ? seg.label : 'normal';
    const holding = lab === 'hold', moving = lab === 'moving', empty = lab === 'empty room';
    wob += -wob * dt / 10 + gauss(r) * Math.sqrt(dt) * P.rateWobble;
    if (!holding && !empty) { ph += 2 * Math.PI * P.bpm / 60 * (1 + wob) * dt; settle += -settle * dt / 3; }
    else settle += (1 - settle) * dt / 12;
    const cyc = Math.floor(ph / (2 * Math.PI)); if (cyc !== lastCycle) { lastCycle = cyc; dep = Math.max(0.4, 1 + P.depthWobble * gauss(r)); }
    // body sway outside holds: people also freeze when they hold their breath. Eases in/out over ~1.5 s.
    ksS += ((holding ? P.holdSway : 1) - ksS) * Math.min(1, dt / 1.5); const ks = ksS;
    sway += -sway * dt / P.swayTau + gauss(r) * Math.sqrt(2 * dt / P.swayTau) * P.sway;
    drift += -drift * dt / P.driftTau + gauss(r) * Math.sqrt(2 * dt / P.driftTau) * P.drift;
    trem += -trem * dt / 0.08 + gauss(r) * Math.sqrt(2 * dt / 0.08) * P.tremor;
    if (P.far) farS += -farS * dt / P.far.tau + gauss(r) * Math.sqrt(2 * dt / P.far.tau) * P.far.sway;
    hph += 2 * Math.PI * hr * dt;
    if (moving) { vel += -vel * dt / 0.5 + gauss(r) * Math.sqrt(2 * dt / 0.5) * P.moveSpeed; pos += vel * dt; pos -= pos * dt / 4; } else vel = 0;
    if (empty) gone += dt; else if (gone > 0 && lab !== 'empty room') gone = 0;
    let jolt = 0; hand = 0;
    for (const e of extra) if (t >= e.a && t < e.b) {
      const u = (t - e.a) / (e.b - e.a);
      if (e.label === 'twitch') jolt += e.mm * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * (e.hz || 1.5) * (t - e.a));
      if (e.label === 'hand') hand = Math.sin(Math.PI * u);       // 0..1 reach towards the keyboard and back
      if (e.label === 'shift') pos = (e.from || 0) + ((e.mm) - (e.from || 0)) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
    wB += -wB * dt / P.wanderTau + gauss(r) * Math.sqrt(2 * dt / P.wanderTau) * (P.bodyWander || 0); const gB = Math.pow(10, wB / 20);
    const breath = gB * P.depth * dep * (Math.sin(ph) + 0.2 * Math.sin(2 * ph)) / 1.1 - (holding ? P.holdSettle * settle : 0);
    const body = ks * gB * (sway + drift) + jolt + pos;                 // mm, shared by every body part
    const walk = empty ? gone * 1000 : 0;                        // leaves at 1 m/s
    const o = f * L + i0;
    for (const [off, gDb, kb, kw] of P.parts) {
      const d = P.d + off + (kb * breath + kw * body + (off === 0 ? P.heart * Math.sin(hph) : 0) + trem + walk) / 1000;
      if (d > 1.6) continue;
      const a = A0 / psf.peak * Math.pow(10, (P.aDb + gDb) / 20) * Math.pow((P.d + off) / d, 2);   // 1/d^2 when moving away
      psf.add(re, im, o, a, tau(d));
    }
    if (P.far && !empty) psf.add(re, im, o, A0 / psf.peak * Math.pow(10, P.far.aDb / 20), tau(P.far.d + (farS + 0.3 * body) / 1000));
    if (hand > 0) { const d = 0.30 - 0.18 * hand; psf.add(re, im, o, A0 / psf.peak * Math.pow(10, -22 / 20) * hand, tau(d)); }
  }
  return pack();
  function pack() { return { n, L, re, im, snr, p, rate, dr: p.dr, i0, m: { segs, seconds: T } }; }
}

// "normal 30, hold 20, x5" -> segments (same plan text the recorder uses)
function parsePlan(text) {
  const parts = text.split(',').map(s => s.trim()), rep = parts.find(s => /^x\d+$/.test(s)), one = parts.filter(s => !/^x\d+$/.test(s));
  const segs = []; let t = 0;
  for (let k = 0; k < (rep ? +rep.slice(1) : 1); k++) for (const s of one) { const [w, sec] = s.split(/\s+/); const label = w === 'away' ? 'empty room' : w; segs.push({ label, a: t, b: t + +sec }); t += +sec; }
  return { segs, T: t };
}
module.exports = { simulate, parsePlan, PERSON, makePsf, coloured, rng };
