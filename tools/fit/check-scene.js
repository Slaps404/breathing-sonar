// Check: the fast echo-profile maths in scene.js equals the slow real path (play the probe, add delayed
// copies, run the page's own cir()). One reflector at a fractional delay; prints the worst difference.
const D = require('../../dsp.js'), S = require('./scene.js');
const p = D.makeProbe(), U = 8, per = p.P * U, tbl = new Float64Array(per + 1);
for (let q = 0; q < p.K; q++) { const w = 2 * Math.PI * (p.k0 + q) / per; for (let n = 0; n < per; n++) tbl[n] += p.scale * Math.cos(w * n + p.phi[q]); }
tbl[per] = tbl[0];
let worst = 0;
for (const [a, tau] of [[0.3, 320.0], [0.01, 421.37], [0.02, 333.9]]) {
  const frame = new Float64Array(p.P);
  for (let n = 0; n < p.P; n++) { let pos = ((n - tau) * U) % per; if (pos < 0) pos += per; const i = Math.floor(pos), fr = pos - i; frame[n] = a * (tbl[i] + fr * (tbl[i + 1] - tbl[i])); }
  const c = D.cir(p, frame), i0 = 15, psf = S.makePsf(p, i0, 30), re = new Float64Array(30), im = new Float64Array(30);
  psf.add(re, im, 0, a, tau);
  let err = 0, peak = 0; for (let m = 0; m < 30; m++) { err = Math.max(err, Math.hypot(re[m] - c.re[m + i0], im[m] - c.im[m + i0])); peak = Math.max(peak, Math.hypot(c.re[m + i0], c.im[m + i0])); }
  console.log(`reflector a=${a} delay=${tau} samples: peak ${peak.toFixed(4)}, worst difference ${(20 * Math.log10(err / peak)).toFixed(1)} dB below the peak`);
  worst = Math.max(worst, err / peak);
}
if (worst > 0.01) { console.error('FAIL: fast path differs from the audio path'); process.exit(1); }
console.log('ok');
