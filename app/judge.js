// Judge view: draws what the sonar sees, from the snapshots hooks.js sends (onDebug, ~5 per second).
//   1. heatmap of echo motion by distance (the test page's depth view), chest slice boxed
//   2. the breathing line, large
//   3. the detectors' state: a ring that fills as a stop is confirmed, a breathing-strength bar
//      with the alarm line, and the slow-breathing rate
// Only draws. Does not decide anything: every value comes from dsp.js through the snapshot.
(function () {
  const $ = id => document.getElementById(id);
  const SHOW_M = 1.5;          // heatmap shows 0-1.5 m; the chest search range is 0.2-1.2 m
  const LEVEL_DB = [-15, 5];   // breathing-strength bar spans this many dB around the normal level
  let wasAlerting = false;

  function update(s) {
    const alerting = Boolean(s.alerting);
    if (alerting && !wasAlerting) pulse();
    wasAlerting = alerting;
    $('judge').classList.toggle('red', alerting);
    if ($('judge').hidden) return;
    drawDepth(s, alerting);
    drawWave(s, alerting);
    setState(s);
  }

  // Short pulse when the alarm fires. Restarting a CSS animation needs a reflow between remove and add.
  function pulse() {
    const el = $('jState');
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }

  // ---------- 3. detector state ----------
  // Ring states, in the order holdStep in dsp.js checks them:
  //   no chest yet / no normal level yet -> moving -> settling (still < quietSec) -> breathing
  //   -> below the alarm line (below toward confirmSec) -> alarm
  function setState(s) {
    const h = s.hold, H = s.HOLD;
    let state, label, sub, fill;
    if (s.alerting) {
      state = 'alarm'; fill = 1;
      label = s.why === 'slow' ? 'Breathing too slow' : 'Breathing stopped';
      sub = s.why === 'slow' ? `Slow for ${Math.round(s.SLOW.on * 100)}% of the last ${s.SLOW.winSec} s` : `Below the line for ${H.confirmSec} s while still`;
    } else if (s.lock === null) {
      state = 'wait'; fill = 0; label = 'Finding your chest'; sub = 'Sit still. It needs about 15 s of echoes.';
    } else if (h.moving) {
      state = 'moving'; fill = 0; label = "Moving: can't judge"; sub = 'Breathing is only judged while you are still';
    } else if (!h.ready) {
      state = 'wait'; fill = 0; label = 'Learning your normal'; sub = 'About 10 s of still breathing first';
    } else if (h.still < H.quietSec) {
      state = 'settle'; fill = h.still / H.quietSec;
      label = `Still ${h.still.toFixed(1)} / ${H.quietSec} s`; sub = 'Waiting for you to settle';
    } else if (h.below > 0) {
      state = 'below'; fill = Math.min(1, h.below / H.confirmSec);
      label = `Stopped? ${h.below.toFixed(1)} / ${H.confirmSec} s`; sub = 'Breathing is under the alarm line';
    } else {
      state = 'ok'; fill = 0; label = 'Breathing'; sub = `Alarm if it stays under the line for ${H.confirmSec} s`;
    }
    $('jState').dataset.state = state;
    $('jArc').setAttribute('stroke-dasharray', `${(fill * 100).toFixed(1)} 100`);
    $('jArc').style.opacity = fill > 0 ? 1 : 0;   // a round cap draws a dot even at length 0
    $('jLabel').textContent = label;
    $('jSub').textContent = sub;

    // Breathing strength: this 8 s window's breathing-band power minus the normal level (dB). The mark is the alarm line.
    const pos = db => 100 * (Math.min(LEVEL_DB[1], Math.max(LEVEL_DB[0], db)) - LEVEL_DB[0]) / (LEVEL_DB[1] - LEVEL_DB[0]);
    const d = h.level !== null && h.base !== null ? h.level - h.base : null;
    $('jMark').style.left = pos(-H.dropDb) + '%';
    $('jLevel').style.width = d === null ? '0' : pos(d) + '%';
    $('jLevel').className = d !== null && d < -H.dropDb ? 'low' : '';
    $('jLevelTxt').textContent = d === null ? 'learning' : `${d >= 0 ? '+' : ''}${d.toFixed(1)} dB · alarm line ${-H.dropDb} dB`;

    // Slow breathing: rate vs SLOW.bpm, and the share of the last 30 s that counted as slow vs SLOW.on.
    const S = s.SLOW, clear = s.wave && s.quality > S.q;
    $('jRate').textContent = !s.wave ? 'Rate: --' : clear ? `Rate ${s.bpm.toFixed(1)} / min · alarm under ${S.bpm}` : `Rate: no clear rhythm · alarm under ${S.bpm} / min`;
    $('jSlowMark').style.left = S.on * 100 + '%';
    $('jSlow').style.width = s.slow.frac * 100 + '%';
    $('jSlow').className = s.slow.alerting ? 'low' : '';
    $('jSlowTxt').textContent = `Slow ${Math.round(s.slow.frac * 100)}% of the last ${S.winSec} s · alarm at ${Math.round(S.on * 100)}%`;
  }

  // Canvas at the element's CSS size times the screen's pixel ratio. Returns null while hidden.
  function fit(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  const css = name => getComputedStyle(document.body).getPropertyValue(name).trim();

  // ---------- 1. heatmap ----------
  // Ported from drawDepth() in ../index.html: x = time, y = distance, brightness = motion (log, 60 dB range).
  function drawDepth(s, alerting) {
    const f = fit($('jDepth')); if (!f) return;
    const { g, w, h } = f, cols = s.depth, L = 54, R = 78;   // L = distance labels, R = rhythm strip
    const X1 = w - R;                                           // right edge of the heatmap
    g.fillStyle = '#0f1620'; g.fillRect(0, 0, w, h);
    if (!cols.length) return;
    const nR = Math.min(s.nShow, Math.ceil(SHOW_M / s.dr)), W = Math.round(20 * s.rate), maxR = nR * s.dr;
    let peak = 1e-12; for (const col of cols) for (let r = 1; r < nR; r++) if (col[r] > peak) peak = col[r];
    const img = new ImageData(W, nR);
    cols.forEach((col, i) => {
      const x = W - cols.length + i; if (x < 0) return;
      for (let r = 0; r < nR; r++) {
        const v = Math.max(0, Math.min(1, 1 + Math.log10(col[r] / peak + 1e-9) / 3));
        const o = ((nR - 1 - r) * W + x) * 4;
        img.data[o] = 40 + 215 * v * v; img.data[o + 1] = 60 + 160 * v; img.data[o + 2] = 90 + 120 * v; img.data[o + 3] = 255;
      }
    });
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = nR;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, L, 0, X1 - L, h);
    const yOf = m => h * (1 - m / maxR);
    g.fillStyle = '#9fb0c2'; g.font = '12px system-ui'; g.textBaseline = 'middle';
    for (const m of [0.25, 0.5, 0.75, 1, 1.25]) if (m < maxR) g.fillText(Math.round(m * 100) + ' cm', 4, yOf(m));
    g.strokeStyle = 'rgba(159,176,194,0.45)'; g.setLineDash([4, 4]); g.lineWidth = 1;
    for (const m of [s.minR, s.maxR]) { g.beginPath(); g.moveTo(L, yOf(m)); g.lineTo(X1, yOf(m)); g.stroke(); }
    g.setLineDash([]);
    // Rhythm strip: how much each slice repeats like breathing (sonar.zscore). The chest is where it peaks.
    const rh = h / nR;
    g.fillStyle = '#9fb0c2'; g.font = '11px system-ui'; g.textBaseline = 'top';
    g.fillText('rhythm', X1 + 8, 4);
    if (s.zscore) s.zscore.forEach((z, r) => {
      if (z === null || r >= nR) return;
      const bw = Math.max(0, Math.min(1, (z - 0.4) / 0.45)) * (R - 14);
      g.fillStyle = r === s.lock ? (alerting ? '#ff5a4a' : '#4fd18b') : 'rgba(159,176,194,0.55)';
      g.fillRect(X1 + 8, (nR - 1 - r) * rh + 1, bw, rh - 2);
    });
    if (s.lock !== null && s.lock < nR) {
      const y = (nR - 1 - s.lock) * rh;  // the lock slice's row (top edge)
      const col = alerting ? '#ff5a4a' : '#4fd18b';
      g.strokeStyle = col; g.lineWidth = 2.5;
      g.strokeRect(L + 1, y - 2, w - L - 3, rh + 4);
      const txt = `chest ${Math.round(s.lock * s.dr * 100)} cm`;
      g.font = '600 15px system-ui'; g.textBaseline = 'bottom';
      const tw = g.measureText(txt).width, tx = X1 - tw - 10, ty = y - 6;
      g.fillStyle = 'rgba(15,22,32,0.75)'; g.fillRect(tx - 5, ty - 18, tw + 10, 20);
      g.fillStyle = col; g.fillText(txt, tx, ty);
    }
  }

  // ---------- 2. breathing line ----------
  // Same scale rule as the small line in app.js: never zooms in past +-1 mm, so a held breath draws flat.
  function drawWave(s, alerting) {
    const f = fit($('jWave')); if (!f) return;
    const { g, w, h } = f, mm = s.wave;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = css('--line'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    if (!mm || mm.length < 2) { $('jWaveCap').textContent = 'Chest movement, last 20 s (waiting for the chest)'; return; }
    const N = Math.round(20 * s.rate), scale = Math.max(1, 1.1 * Math.max(...mm.map(Math.abs)));
    g.strokeStyle = alerting ? css('--bad') : css('--accent');
    g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath();
    mm.forEach((v, i) => {
      const x = ((N - mm.length + i) / (N - 1)) * w, y = h / 2 - (v / scale) * (h * 0.45);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
    $('jWaveCap').textContent = `Chest movement, last 20 s · scale ±${scale.toFixed(1)} mm`;
  }

  window.JudgeView = { update };
})();
