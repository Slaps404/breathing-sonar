// Viability sweep: same scenes through both modes, several random seeds each.
// Each run: breathe 0-60 s, hold 60-80 s, breathe 80-100 s. Chest +-3 mm at 15/min, 0.45 m away.
// Usage: node tools/viability.js [seeds=4]   -> prints a table, writes tools/viability-results.json
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

const chest = { d: 0.45, mm: 3, bpm: 15 }, hold = [60, 80], T = 100;
const SCENES = {
  'alone, quiet room':             { walls: true },
  'walker passing at 1 m':         { walls: true, walkers: [{ D: 1, every: 12 }] },
  'walker passing at 2 m':         { walls: true, walkers: [{ D: 2, every: 12 }] },
  'walker passing at 3 m':         { walls: true, walkers: [{ D: 3, every: 12 }] },
  'walker passing at 0.7 m (just behind)': { walls: true, walkers: [{ D: 0.7, every: 12 }] },
  'seated person breathing 1.5 m': { walls: true, bystander: { d: 1.5, mm: 3, bpm: 18 } },
  'person standing 1.5 m, fidgeting':      { walls: true, standers: [{ d: 1.5 }] },
  'person standing 1 m, fidgeting':        { walls: true, standers: [{ d: 1.0 }] },
  'person standing 0.7 m, fidgeting':      { walls: true, standers: [{ d: 0.7 }] },
  'demo table (2 standing 1-1.5 m, walkers 1+2 m, x3 noise)':
    { walls: true, standers: [{ d: 1.0 }, { d: 1.5 }], walkers: [{ D: 1, every: 20 }, { D: 2, every: 15 }], noise: 3 },
  'street: walkers 2+3 m, helper kneeling 1 m, wind x10':
    { walls: false, walkers: [{ D: 2, every: 10 }, { D: 3, every: 7 }], standers: [{ d: 1.0 }], noise: 10, gust: true },
  'street: same, wind x30':  { walls: false, walkers: [{ D: 2, every: 10 }, { D: 3, every: 7 }], standers: [{ d: 1.0 }], noise: 30, gust: true },
  'street: same, wind x100': { walls: false, walkers: [{ D: 2, every: 10 }, { D: 3, every: 7 }], standers: [{ d: 1.0 }], noise: 100, gust: true },
  'street: walkers only, wind x30': { walls: false, walkers: [{ D: 2, every: 10 }, { D: 3, every: 7 }], noise: 30, gust: true },
};

if (!isMainThread) {
  const { makeScene, run, score } = require('./simlib.js');
  const { name, mode, seed } = workerData;
  const scene = makeScene({ ...SCENES[name], chest, hold }, seed);
  const res = run(mode, scene, { T });
  const s = score(res, { scene, hold, T });
  // range mode: share of time the watched slice is the chest's (chest is 0.35 m past the direct path)
  const locks = res.timeline.filter(x => x.lock !== null);
  s.onChest = mode === 'range' && locks.length ? locks.filter(x => Math.abs(x.lock - 0.35) <= 0.12).length / locks.length : null;
  parentPort.postMessage({ name, mode, seed, ...s, events: res.events });
} else {
  const seeds = +(process.argv[2] || 4);
  const jobs = [];
  for (const name of Object.keys(SCENES)) for (const mode of ['tones', 'range']) for (let seed = 1; seed <= seeds; seed++) jobs.push({ name, mode, seed });
  const results = [];
  let next = 0, running = 0;
  const par = Math.max(2, os.cpus().length - 2);
  const t0 = Date.now();
  const launch = () => {
    while (running < par && next < jobs.length) {
      const job = jobs[next++]; running++;
      const w = new Worker(__filename, { workerData: job });
      w.on('message', m => results.push(m));
      w.on('error', e => { console.error(job, e); });
      w.on('exit', () => { running--; if (next < jobs.length) launch(); else if (!running) done(); });
    }
  };
  const done = () => {
    require('fs').writeFileSync(__dirname + '/viability-results.json', JSON.stringify({ chest, hold, T, seeds, results }, null, 1));
    const pct = x => (100 * x).toFixed(0).padStart(4) + '%';
    console.log(`${jobs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s. Per scene/mode, ${seeds} seeds:`);
    console.log('scene'.padEnd(52) + 'mode   SNR  rate+-2  holds caught  latency(s)  false alarms/min  on-chest');
    for (const name of Object.keys(SCENES)) for (const mode of ['tones', 'range']) {
      const rs = results.filter(r => r.name === name && r.mode === mode);
      const caught = rs.filter(r => r.latency !== null);
      const lat = caught.length ? (caught.reduce((a, r) => a + r.latency, 0) / caught.length).toFixed(1) : '-';
      const fa = rs.reduce((a, r) => a + r.falseAlarms, 0) / rs.reduce((a, r) => a + r.breathMin, 0);
      const rate = rs.reduce((a, r) => a + r.rateOK, 0) / rs.length;
      const snr = rs.reduce((a, r) => a + r.snr, 0) / rs.length;
      const on = mode === 'range' ? pct(rs.reduce((a, r) => a + r.onChest, 0) / rs.length) : '    -';
      console.log(name.padEnd(52) + mode.padEnd(6) + snr.toFixed(0).padStart(4) + ' ' + pct(rate).padStart(8) +
        `${caught.length}/${rs.length}`.padStart(14) + lat.padStart(12) + fa.toFixed(2).padStart(17) + on.padStart(10));
    }
  };
  launch();
}
