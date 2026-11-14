// Replay a recorded run (sonar-run-*.json from the page) through the current dsp.js code.
// Usage: node tools/replay.js <run.json> [--hold 60,80]
// Range runs are also replayed "without range gating" (the 19 kHz part of the same recording,
// i.e. what a steady tone would have seen) for a side-by-side comparison.
const fs = require('fs');
const D = require('../dsp.js');
const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file));
const hi = process.argv.indexOf('--hold');
const hold = hi > 0 ? process.argv[hi + 1].split(',').map(Number) : null;
const mode = r.mode || 'tones';

function report(label, rate, n, feed, sonar, getCh) {
  const rows = [], events = [];
  const step = Math.round(rate / 5);
  for (let i = 0; i < n; i++) {
    feed(i);
    if (i % step) continue;
    const t = i / rate, res = sonar.analyze ? sonar.analyze(t * 1000) : null;
    const ch = getCh(res);
    if (res && res.event) events.push(`${t.toFixed(1)}s ${res.event}`);
    if (ch && Math.abs(t % 5) < 1 / rate * step * 0.99) {
      const nn = ch.disp.length, k = Math.round(4 * rate);
      rows.push({ t: Math.round(t), bpm: ch.quality > 0.25 && nn >= 15 * rate ? ch.bpm.toFixed(1) : '--',
        q: ch.quality.toFixed(2), move4s: D.std(ch.disp, Math.max(0, nn - k), nn).toFixed(2),
        alert: sonar.apnea ? sonar.apnea.alerting : '', lock: sonar.lock != null ? (sonar.lock * sonar.dr).toFixed(2) + 'm' : '' });
    }
  }
  console.log(`\n== ${label} ==`);
  console.log('  t   bpm   quality  motion-last-4s(mm)  alert  watching');
  for (const x of rows) console.log(`${String(x.t).padStart(3)}  ${String(x.bpm).padStart(5)}  ${x.q.padStart(6)}  ${x.move4s.padStart(10)}          ${String(x.alert).padEnd(6)} ${x.lock}`);
  console.log('alert events:', events.join(', ') || 'none');
  if (hold) {
    const st = events.filter(e => e.endsWith('start')).map(e => parseFloat(e));
    const hit = st.find(s => s >= hold[0] && s <= hold[1] + 2);
    console.log(hit !== undefined ? `hold ${hold.join('-')} s caught ${(hit - hold[0]).toFixed(1)} s in` : `hold ${hold.join('-')} s MISSED`,
      `| false alarms: ${st.filter(s => s !== hit).length}`);
  }
}

if (mode === 'tones') {
  const freqs = r.freqs.filter((_, i) => r.emit[i]);
  const s = new D.ToneSonar(freqs, r.rate);
  const n = r.I[0].length;
  report(`tones ${freqs.join('/')} Hz, ${(n / r.rate).toFixed(0)} s`, r.rate, n,
    i => s.ingest({ I: r.I.map(a => a[i]), Q: r.Q.map(a => a[i]) }), s, res => res && res.ch);
  console.log('tone SNR dB:', freqs.map((f, k) => `${f}: ${s.snr(k).toFixed(0)}`).join(', '));
} else {
  const s = new D.RangeSonar({});
  const n = r.re.length;
  report(`range, ${(n / r.rate).toFixed(1)} s`, r.rate, n, i => s.ingestCIR(r.re[i], r.im[i], r.snr[i]), s, res => res && res.ch);
  console.log('probe SNR dB (median):', [...r.snr].sort((a, b) => a - b)[r.snr.length >> 1]);
  // Same recording, no range gating: channel response at the band centre (one frequency).
  const L = r.L, qc = Math.floor(s.p.K / 2);
  const flat = { rate: r.rate, apnea: D.makeApnea(), ch: D.makeChannel(s.p.lambda, r.rate),
    analyze(now) { if (!D.analyzeChannel(this.ch)) return null; return { ch: this.ch, event: D.apneaStep(this.apnea, this.ch.disp, this.rate, now) }; } };
  report('same recording, NO range gating (single frequency)', r.rate, n, i => {
    let re = 0, im = 0;
    for (let m = 0; m < L; m++) { const a = -2 * Math.PI * qc * m / L; re += r.re[i][m] * Math.cos(a) - r.im[i][m] * Math.sin(a); im += r.re[i][m] * Math.sin(a) + r.im[i][m] * Math.cos(a); }
    D.pushIQ(flat.ch, re, im);
  }, flat, res => res && res.ch);
}
