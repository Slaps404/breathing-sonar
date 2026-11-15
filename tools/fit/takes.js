// Shared loader for recorded takes: reads data/take-*.wav (+ labels), turns the audio into echo
// profiles (one complex value per ~2.8 cm slice per frame, 23.4 frames/s) and caches them, so
// measuring and replaying is fast. Cache: data/.cir/<id>.bin (data/ is not committed).
const fs = require('fs'), path = require('path');
const D = require('../../dsp.js');
const ROOT = path.join(__dirname, '..', '..'), DATA = path.join(ROOT, 'data'), CACHE = path.join(DATA, '.cir');

function meta(id) {
  const base = path.join(DATA, id), wav = fs.readFileSync(base + '.wav'), bytes = wav.readUInt32LE(40), at = 44 + bytes + (bytes % 2);
  let m;   // labels: <id>.json (collectors) or the json chunk after the audio (app takes)
  try { m = fs.existsSync(base + '.json') ? JSON.parse(fs.readFileSync(base + '.json')) : JSON.parse(wav.toString('utf8', at + 8, at + 8 + wav.readUInt32LE(at + 4))); }
  catch { return null; }
  m.id ??= id;
  m.seconds ??= bytes / 2 / 48000;
  m.segs = m.labels.map((l, i) => ({ label: l.label, a: l.t, b: m.labels[i + 1]?.t ?? m.seconds }));
  return { m, wav, bytes };
}
function ids() { return fs.readdirSync(DATA).filter(f => /^take-.*\.wav$/.test(f)).map(f => f.slice(0, -4)).sort(); }

// -> { m (metadata + segs), p (probe), rate, dr, n (frames), re, im (Float32Array n*L), snr (Float32Array n), i0 (direct-path tap) }
function load(id) {
  const got = meta(id); if (!got) return null;
  const { m, wav, bytes } = got, p = D.makeProbe({ P: m.P, f0: m.f0, f1: m.f1 }), L = p.L;
  const n = Math.floor((bytes >> 1) / m.P), file = path.join(CACHE, id + '.bin');
  let buf;
  if (fs.existsSync(file) && fs.statSync(file).size === n * (2 * L + 1) * 4) buf = new Float32Array(new Uint8Array(fs.readFileSync(file)).buffer);
  else {
    const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + 44 + (bytes >> 1) * 2));
    buf = new Float32Array(n * (2 * L + 1));
    const frame = new Float64Array(m.P);
    for (let f = 0; f < n; f++) {
      for (let i = 0; i < m.P; i++) frame[i] = pcm[f * m.P + i] / 32767;
      const c = D.cir(p, frame);
      buf.set(c.re, f * L); buf.set(c.im, n * L + f * L); buf[2 * n * L + f] = c.snr;
    }
    fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, Buffer.from(buf.buffer));
  }
  const re = buf.subarray(0, n * L), im = buf.subarray(n * L, 2 * n * L), snr = buf.subarray(2 * n * L);
  for (let f = 0; f < n; f++) if (!Number.isFinite(snr[f])) snr[f] = -300;   // silent frame (old cache entries hold -Infinity)
  // direct path = strongest tap at frame 12, exactly as RangeSonar picks it
  let i0 = 0, bm = 0; for (let k = 0; k < L; k++) { const v = Math.hypot(re[11 * L + k], im[11 * L + k]); if (v > bm) { bm = v; i0 = k; } }
  return { m, p, rate: p.rate, dr: p.dr, L, n, re, im, snr, i0 };
}

// Run frames (real or simulated) through the live detector. frames: { n, L, re, im, snr, p }.
// Returns alert events, lock history and a per-tick trace of the detector's own features.
function detect(fr, { trace = false, opts = {} } = {}) {
  const s = new D.RangeSonar(opts); s.p = fr.p; s.chs.forEach(c => c.lambda = fr.p.lambda);
  const L = fr.L, rate = fr.p.rate, events = [], locks = [], tr = [];
  let lastLock = null;
  for (let f = 0; f < fr.n; f++) {
    s.ingestCIR(fr.re.subarray(f * L, f * L + L), fr.im.subarray(f * L, f * L + L), fr.snr[f]);
    if (f % 5) continue;
    const t = (f + 1) / rate, res = s.analyze(t * 1000);
    if (res?.event) events.push({ t, type: res.event, why: res.why });
    if (s.lock !== lastLock) { lastLock = s.lock; locks.push({ t, cm: Math.round(s.lock * s.dr * 100) }); }
    if (trace) tr.push({ t, B: s.apnea.level, base: s.apnea.base, moving: s.apnea.moving === true, alert: s.alerting, lock: s.lock, q: res?.ch.quality ?? null, bpm: res?.ch.bpm ?? null });
  }
  return { events, locks, trace: tr, sonar: s };
}

// Score alert events against labels, the way tools/replay-take.js does (a hold is caught by an alarm
// that starts inside it or up to 2 s after it).
function score(events, segs) {
  const starts = events.filter(e => e.type === 'start'), holds = segs.filter(l => l.label === 'hold');
  const per = holds.map(h => { const hit = starts.find(e => e.t >= h.a && e.t <= h.b + 2); return { a: h.a, b: h.b, latency: hit ? +(hit.t - h.a).toFixed(1) : null }; });
  const fa = starts.filter(e => !holds.some(h => e.t >= h.a && e.t <= h.b + 2)).map(e => ({ t: +e.t.toFixed(1), label: (segs.find(l => e.t >= l.a && e.t < l.b) || {}).label }));
  return { holds: per, caught: per.filter(h => h.latency !== null).length, false: fa };
}
module.exports = { D, ROOT, DATA, ids, meta, load, detect, score };
