// Draws docs/sim/lock-map.svg (where holds show up vs where the detector locked) and docs/sim/paced-rate.svg.
const fs = require('fs'), path = require('path'), T = require('../fit/takes.js'), P = require('./pickers.js'), R = require('./lib.js');
const OUT = path.join(T.ROOT, 'docs', 'sim'), INK = '#1f2933', SOFT = '#7b8794', GRID = '#e4e7eb', BLUE = '#2f6fb0', RED = '#c8372d', BG = '#ffffff';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${o.size || 12}" fill="${o.fill || INK}" text-anchor="${o.anchor || 'start'}" font-weight="${o.bold ? 600 : 400}">${esc(s)}</text>`;

// ---- chart 1: small multiples ----
{
  const takes = [];
  for (const id of T.ids()) {
    const fr = T.load(id); if (!fr) continue; const z = P.zoneDrop(fr); if (!z) continue;
    if ([...fr.snr].sort((a, b) => a - b)[fr.n >> 1] < 20) continue;
    const det = T.detect(fr), sc = T.score(det.events, fr.m.segs);
    takes.push({ id: id.slice(16, 21).replace('-', ':'), z, dr: fr.dr, lock: det.locks[0]?.cm ?? null, caught: `${sc.caught} of ${sc.holds.length}`, app: fr.m.source !== 'mac-menubar' });
  }
  const cols = 5, pw = 200, ph = 130, gx = 34, gy = 58, W = cols * (pw + gx) + 30, H = 70 + Math.ceil(takes.length / cols) * (ph + gy);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += txt(20, 26, 'Where a breath hold shows up, by distance, in each recording', { size: 17, bold: true });
  s += txt(20, 46, 'Blue line: how much breathing-speed movement drops during a hold if the detector watched from that distance (dB, higher is better). Red line: where it actually locked.', { size: 12, fill: SOFT });
  takes.forEach((t, i) => {
    const x0 = 30 + (i % cols) * (pw + gx), y0 = 84 + Math.floor(i / cols) * (ph + gy), X = cm => x0 + (cm - 15) / 110 * pw, Y = d => y0 + ph - (Math.max(-4, Math.min(12, d)) + 4) / 16 * ph;
    for (const d of [0, 6, 12]) s += `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(d)}" y2="${Y(d)}" stroke="${d === 0 ? SOFT : GRID}" stroke-width="1"/>` + txt(x0 - 5, Y(d) + 4, d, { size: 10, fill: SOFT, anchor: 'end' });
    for (const c of [20, 40, 60, 80, 100, 120]) s += txt(X(c), y0 + ph + 13, c, { size: 10, fill: SOFT, anchor: 'middle' });
    let d = ''; for (let r = P.R0; r <= P.R1; r++) d += (d ? 'L' : 'M') + X(r * t.dr * 100).toFixed(1) + ' ' + Y(t.z[r]).toFixed(1);
    s += `<path d="${d}" fill="none" stroke="${BLUE}" stroke-width="2"/>`;
    if (t.lock !== null) s += `<line x1="${X(t.lock)}" x2="${X(t.lock)}" y1="${y0}" y2="${y0 + ph}" stroke="${RED}" stroke-width="2"/>`;
    s += txt(x0, y0 - 8, `${t.id}${t.app ? ' (app)' : ''}`, { size: 12, bold: true }) + txt(x0 + pw, y0 - 8, `holds caught: ${t.caught}`, { size: 11, fill: SOFT, anchor: 'end' });
    if (i % cols === 0) s += txt(x0, y0 + ph + 30, 'distance from laptop (cm)', { size: 10, fill: SOFT });
  });
  fs.writeFileSync(path.join(OUT, 'lock-map.svg'), s + '</svg>');
}
// ---- chart 2: paced take, rate read vs truth ----
{
  const id = T.ids().filter(i => T.meta(i)?.m.plan?.startsWith('paced')).at(-1), fr = T.load(id);
  const parts = fr.m.segs.map(s => ({ a: s.a, b: s.b, bpm: s.label === 'slow' ? 6 : 15 }));
  const W = 900, H = 360, x0 = 60, y0 = 70, pw = 800, ph = 230, X = t => x0 + t / 195 * pw, Y = b => y0 + ph - Math.min(24, b) / 24 * ph;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += txt(20, 26, 'Breathing rate read from the paced recording, against the rate you actually breathed', { size: 17, bold: true });
  s += txt(20, 46, 'Grey: paced rate (15 per minute, then 6). Dots: rate read from each 30 s window, at 11 cm (blue) and 17 cm (red).', { size: 12, fill: SOFT });
  for (const b of [0, 6, 12, 15, 18, 24]) s += `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(b)}" y2="${Y(b)}" stroke="${GRID}"/>` + txt(x0 - 8, Y(b) + 4, b, { size: 11, fill: SOFT, anchor: 'end' });
  for (let t = 0; t <= 180; t += 30) s += txt(X(t), y0 + ph + 16, t + ' s', { size: 11, fill: SOFT, anchor: 'middle' });
  s += `<path d="M${X(0)} ${Y(15)}L${X(parts[1].a)} ${Y(15)}L${X(parts[1].a)} ${Y(6)}L${X(195)} ${Y(6)}" fill="none" stroke="${SOFT}" stroke-width="6" stroke-opacity="0.45"/>`;
  for (const [rr, col] of [[2, BLUE], [3, RED]]) for (const r of R.score(fr, parts, 'one slice, shortest strong repeat', { rr, sm: Math.round(0.6 * fr.rate) })) if (r.bpm) s += `<circle cx="${X(r.t)}" cy="${Y(r.bpm)}" r="5" fill="${col}" stroke="${BG}" stroke-width="2"/>`;
  s += txt(x0, y0 + ph + 40, 'time in the recording (centre of each window)', { size: 11, fill: SOFT }) + txt(20, y0 - 8, 'breaths per minute', { size: 11, fill: SOFT });
  fs.writeFileSync(path.join(OUT, 'paced-rate.svg'), s + '</svg>');
}
console.log('written');
