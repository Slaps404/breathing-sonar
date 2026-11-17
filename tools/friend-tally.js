// Tally the takes friends recorded with the friend test link (app/?test=<code>, source 'app-test'; older takes from the
// retired friend/ page have source 'friend-link'): per person and device, how many breath holds they marked and
// whether the detector caught each one.
// Usage: node tools/friend-tally.js                 (detector = dsp.js as it is now, the live app's code once pushed)
//        node tools/friend-tally.js --at <commit>   (detector = dsp.js at that commit, to freeze it for a fair count)
//        node tools/friend-tally.js --dir <folder>  (takes in another folder; default data/)
// Rules, fixed here so the count cannot be tuned per take:
//   - A take counts if it came from a friend test (source 'app-test' or 'friend-link'). Every such take is listed.
//   - Probe heard = median probe SNR over the recording, recomputed from the audio, >= 20 dB (the app's own line;
//     below it the app shows "can't hear" and never alarms). Takes not heard are listed as device failures and
//     their holds are not scored: the app would not have been watching.
//   - A hold is the stretch between the person's two presses (or the 45 s cap). It is caught if an alarm starts
//     inside it or up to 2 s after it (same rule as tools/replay-take.js and tools/final-test.js).
//   - A false alarm is an alarm start anywhere else, counted against minutes of non-hold recording.
const { execSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.join(__dirname, '..');
let detector = 'dsp.js (working copy)';
const at = arg('at');
if (at) {
  const file = path.join(os.tmpdir(), `dsp-${at}.js`);
  fs.writeFileSync(file, execSync(`git show ${at}:dsp.js`, { cwd: repo }));
  process.env.DSP = file; detector = `dsp.js at ${at}`;
} else {
  const head = execSync('git log -1 --format=%h -- dsp.js', { cwd: repo }).toString().trim();
  const dirty = execSync('git status --porcelain -- dsp.js', { cwd: repo }).toString().trim();
  detector = `dsp.js at ${head}${dirty ? ' + uncommitted edits' : ''}`;
}
if (arg('dir')) process.env.TAKES_DIR = path.resolve(arg('dir'));
const T = require('./fit/takes.js');
const HEARD_DB = 20, SHORT_HOLD = 8;

// "iPhone Safari", "Mac Chrome", "Android Chrome", ...: enough to tell devices apart in a table.
function device(m) {
  const ua = m.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && m.touch > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux' : 'other';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  return `${os} ${br}`;
}
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / 2 / n, w = z * Math.sqrt(p * (1 - p) / n + z * z / 4 / n / n); return [(c - w) / d, (c + w) / d]; };
const pct = x => (100 * x).toFixed(0) + '%';

const rows = [];
for (const id of T.ids()) {
  const got = T.meta(id);
  if (!got || !['app-test', 'friend-link'].includes(got.m.source)) continue;
  const fr = T.load(id), m = fr.m;
  const snr = [...fr.snr].sort((a, b) => a - b)[fr.n >> 1];
  const person = m.nickname || `(no name, device ${m.deviceId || '?'})`;
  const holds = m.segs.filter(s => s.label === 'hold');
  const auto = m.labels.filter((l, i) => i > 0 && m.labels[i - 1].label === 'hold' && l.by && l.by !== 'key' && l.by !== 'tap' && l.by !== 'click').length;
  const row = { id, person, deviceId: m.deviceId || id, device: device(m), band: `${m.f0 / 1000}-${m.f1 / 1000} kHz`, snr, heard: snr >= HEARD_DB,
    secs: fr.n / fr.rate, holds, auto, short: holds.filter(h => h.b - h.a < SHORT_HOLD).length, stoppedEarly: !!m.stoppedEarly };
  if (row.heard) {
    const sc = T.score(T.detect(fr).events, m.segs);
    row.per = sc.holds; row.caught = sc.caught; row.fa = sc.false.length;
    row.quietMin = m.segs.filter(s => s.label !== 'hold').reduce((a, s) => a + s.b - s.a, 0) / 60;
  }
  rows.push(row);
}

console.log(`Friend test takes in ${T.DATA}. Detector: ${detector}.\n`);
if (!rows.length) { console.log('No friend test takes yet.'); process.exit(); }
for (const r of rows) {
  const holds = r.heard
    ? r.per.map(h => `${(h.b - h.a).toFixed(0)}s hold ${h.latency === null ? 'MISSED' : 'caught ' + h.latency + 's in'}`).join('; ') || 'no holds marked'
    : `${r.holds.length} holds marked, not scored`;
  console.log(`${r.person.padEnd(16)} ${r.device.padEnd(16)} ${r.band}  probe ${r.snr.toFixed(0).padStart(3)} dB ${r.heard ? 'heard    ' : 'NOT HEARD'}  ${(r.secs / 60).toFixed(1)} min`);
  console.log(`   ${holds}${r.heard ? ` | false alarms ${r.fa}` : ''}${r.auto ? ` | ${r.auto} hold(s) ended without a press` : ''}${r.short ? ` | ${r.short} hold(s) under ${SHORT_HOLD}s` : ''}${r.stoppedEarly ? ' | stopped early' : ''}`);
}

// Per person and device: one line each.
const groups = new Map();
for (const r of rows) {
  const k = r.person + ' | ' + r.device + ' | ' + r.deviceId;
  const g = groups.get(k) ?? { person: r.person, device: r.device, takes: 0, heard: 0, marked: 0, scored: 0, caught: 0, fa: 0 };
  g.takes++; g.marked += r.holds.length;
  if (r.heard) { g.heard++; g.scored += r.per.length; g.caught += r.caught; g.fa += r.fa; }
  groups.set(k, g);
}
console.log('\nPer person and device:');
console.log('  person           device           takes  probe heard  holds marked  caught        false alarms');
for (const g of groups.values())
  console.log(`  ${g.person.slice(0, 16).padEnd(16)} ${g.device.padEnd(16)} ${String(g.takes).padStart(5)}  ${`${g.heard} of ${g.takes}`.padStart(11)}  ${String(g.marked).padStart(12)}  ${g.scored ? `${g.caught} of ${g.scored}`.padEnd(12) : 'not scored  '}  ${g.scored ? g.fa : '-'}`);

// Totals and the sentence to quote.
const heard = rows.filter(r => r.heard), people = new Set(rows.map(r => r.person)), devices = new Set(rows.map(r => r.deviceId));
const deafDevices = new Set(rows.filter(r => !r.heard).map(r => r.deviceId)), okDevices = new Set(heard.map(r => r.deviceId));
const H = heard.reduce((a, r) => a + r.per.length, 0), C = heard.reduce((a, r) => a + r.caught, 0);
const FA = heard.reduce((a, r) => a + r.fa, 0), QM = heard.reduce((a, r) => a + r.quietMin, 0);
const lat = heard.flatMap(r => r.per.filter(h => h.latency !== null).map(h => h.latency)).sort((a, b) => a - b);
console.log(`\nTotals: ${rows.length} takes from ${people.size} people on ${devices.size} devices.`);
console.log(`  Probe heard on ${okDevices.size} of ${devices.size} devices (${[...new Set(rows.filter(r => !r.heard).map(r => r.device))].join(', ') || 'none'} could not hear it).`);
console.log(`  Holds marked: ${rows.reduce((a, r) => a + r.holds.length, 0)} in all; ${H} on devices that heard the probe.`);
if (H) {
  const [lo, hi] = wilson(C, H);
  console.log(`  Caught ${C} of ${H} (${pct(C / H)}, 95% range ${pct(lo)}-${pct(hi)}). Median time to alarm ${lat[lat.length >> 1] ?? '-'} s.`);
  console.log(`  False alarms: ${FA} in ${QM.toFixed(1)} min of normal breathing.`);
  console.log(`\nQuote: "In recordings by ${people.size} ${people.size === 1 ? "person" : "people"} on ${devices.size} of their own devices, the probe was heard on ${okDevices.size}.` +
    ` On those, BreathBuddy's detector caught ${C} of ${H} marked breath holds, with ${FA} false alarm${FA === 1 ? '' : 's'} in ${QM.toFixed(0)} minutes of normal breathing` +
    ` (holds marked by the person; detector replayed on the recordings afterward, not live)."`);
}
if (deafDevices.size && !H) console.log('\nNo holds could be scored: no device heard the probe.');
