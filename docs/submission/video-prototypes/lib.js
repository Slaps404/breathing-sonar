// Shared helpers for the video prototypes. Every clip is a pure function of time: window.draw(t) paints the
// frame at t seconds on a 1280x720 canvas, so render.js can step through it frame by frame.
// Opened in a browser, the page plays itself in a loop.
const W = 1280, H = 720;
const DARK = { bg: '#1c1917', text: '#f1e9de', soft: '#a3978a', line: '#3a342f', warn: '#c98a2b', good: '#7fb08a', alarm: '#d9603b' };
const LIGHT = { bg: '#f4ede3', text: '#2a2420', soft: '#7d7166', line: '#d9cdbd', warn: '#c98a2b', good: '#4f8a5c', alarm: '#c2472a' };
const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif', SANS = 'system-ui, -apple-system, "Helvetica Neue", sans-serif';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => ease((t - a) / (b - a));                       // 0 -> 1 between a and b
const show = (t, a, b, f = 0.5) => Math.min(seg(t, a, a + f), 1 - seg(t, b - f, b));   // fade in at a, out at b
function text(c, s, x, y, { size = 40, color = '#fff', font = SERIF, align = 'center', alpha = 1, weight = 400, maxW = 0, lh = 1.25 } = {}) {
  if (alpha <= 0) return; c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.font = `${weight} ${size}px ${font}`;
  let lines = [s];
  if (maxW) { lines = []; let cur = ''; for (const w of s.split(' ')) { const tr = cur ? cur + ' ' + w : w; if (c.measureText(tr).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tr; } lines.push(cur); }
  lines.forEach((l, i) => c.fillText(l, x, y + (i - (lines.length - 1) / 2) * size * lh)); c.restore();
}
function setup(draw, duration) {
  if (!document.body) return addEventListener('DOMContentLoaded', () => setup(draw, duration));   // scripts sit in <head>
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'display:block;width:100vw;height:56.25vw;max-height:100vh;max-width:177.78vh;margin:auto';
  document.body.style.cssText = 'margin:0;background:#000'; document.body.appendChild(cv);
  const c = cv.getContext('2d'); window.DURATION = duration; window.draw = t => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; draw(c, t); };
  if (!navigator.webdriver) { const t0 = performance.now(); const loop = () => { window.draw(((performance.now() - t0) / 1000) % duration); requestAnimationFrame(loop); }; loop(); } else window.draw(0);
}
