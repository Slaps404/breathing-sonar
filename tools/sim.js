// Simulate: mic = direct path tone + static reflections + chest reflection whose path length
// varies with breathing (5 mm amplitude, 15/min), then a 20 s breath hold. Feed through the
// real worklet + main-thread code and check rate + alert.
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const workletSrc = js.match(/const WORKLET = `([\s\S]*?)`;/)[1];

// --- run worklet in node ---
global.sampleRate = 48000;
let registered;
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: m => this.port.onmsg && this.port.onmsg(m) }; } };
global.registerProcessor = (n, c) => (registered = c);
eval(workletSrc);

// --- stub DOM for main code ---
const els = {};
global.document = { getElementById: id => els[id] ??= { textContent: '', style: {}, className: '', value: id === 'freqs' ? '18500,19500,20500' : '0.7', disabled: false, innerHTML: '', width: 1200, height: 280, getContext: () => new Proxy({}, { get: () => () => {} }) } };
let spoke = [];
global.speechSynthesis = { speak: u => spoke.push([simT, u.text]) };
global.SpeechSynthesisUtterance = function (t) { this.text = t; };
let simT = 0;
global.performance = { now: () => simT * 1000 };
global.alert = console.log;
const main = js.replace(/\$\('start'\)\.onclick[\s\S]*$/, '') + '\n;globalThis.__api={ingest,analyze,makeState,get tones(){return tones},set tones(v){tones=v},get alerting(){return alerting}};';
eval(main.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '));
const api = globalThis.__api;

const freqs = [18500, 19500, 20500];
const all = [...freqs, ...freqs.map(f => f + 500)];
const emit = all.map((_, i) => i < 3);
const proc = new registered({ processorOptions: { freqs: all, emit, dec: 480, amp: 0.7 } });
api.tones = all.map((f, k) => api.makeState(f, emit[k]));
proc.port.onmsg = m => api.ingest(m);

const c = 343, SR = 48000, N = 128;
const hold = [40, 60]; // breath hold window (s)
const TOTAL = 75;
let t = 0, outBuf = [];
const delay = 0.003; // direct path
let lastAnalyze = 0, results = [];
for (let blk = 0; blk < TOTAL * SR / N; blk++) {
  const inp = new Float32Array(N);
  for (let s = 0; s < N; s++) {
    const tt = t + s / SR;
    const breathing = !(tt > hold[0] && tt < hold[1]);
    const chest = 0.6 + (breathing ? 0.005 * Math.sin(2 * Math.PI * 0.25 * tt) : 0); // m
    let x = 0;
    for (const f of freqs) {
      const tone = (d, a) => a * Math.cos(2 * Math.PI * f * (tt - d));
      x += tone(delay, 0.3) + tone(2 * 1.2 / c, 0.05) + tone(2 * chest / c, 0.01);
    }
    x = x / 3 * 0.7 + (Math.random() - 0.5) * 0.02;
    inp[s] = x;
  }
  const out = [new Float32Array(N), new Float32Array(N)];
  proc.process([[inp]], [out]);
  t += N / SR;
  simT = t;
  if (t - lastAnalyze >= 0.2) {
    lastAnalyze = t;
    api.analyze();
    if (Math.abs(t % 5) < 0.2) results.push(`t=${t.toFixed(0)}s bpm=${els.bpm?.textContent} quality=${els.quality?.textContent} tone=${els.tone?.textContent} alert=${api.alerting}`);
  }
}
console.log(results.join('\n'));
console.log('speech events:', spoke.map(([tt, x]) => `${tt.toFixed(1)}s "${x}"`).join('; '));
