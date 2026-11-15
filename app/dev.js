// Dev dashboard, only with app/?debug. Everything that collects data or fakes events lives here,
// so the app itself stays a plain phone app. Talks to app.js only through window.BreathingApp.
//
//   BreathingApp  --on(type, detail)-->  this panel   (screen, status, mark, holding, quiet, session, stored)
//   this panel    --start/stop/show/...-->  BreathingApp
//
// Keys (not during the alarm countdown, where any key means "I'm okay"): h = mark hold, m = alarm sound, s = show/hide.
(function () {
  const A = window.BreathingApp;
  if (!A || !A.DEBUG) return;
  const $ = id => document.getElementById(id);
  const wide = matchMedia('(min-width: 860px) and (min-height: 560px)');

  // Open beside the phone on a wide screen. Once you close or open it, that choice is remembered.
  const OPEN_KEY = 'breathing-sonar.devOpen';
  let saved = null;
  try { saved = localStorage.getItem(OPEN_KEY); } catch (e) { /* storage blocked */ }
  let open = saved === null ? wide.matches : saved === '1';
  function setOpen(on, remember) {
    open = on;
    if (remember) try { localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
    $('dev').hidden = !on;
    $('devFab').hidden = on;
    document.body.classList.toggle('dev-open', on);
  }
  setOpen(open);
  $('devClose').addEventListener('click', () => setOpen(false, true));
  $('devFab').addEventListener('click', () => setOpen(true, true));

  // ---------- Toggles ----------
  const sw = (id, get, set) => {
    const paint = () => $(id).setAttribute('aria-pressed', String(get()));
    $(id).addEventListener('click', () => { set(!get()); paint(); });
    paint();
    return paint;
  };
  const paintFake = sw('devFake', () => A.dev.fake, v => { A.dev.fake = v; });
  sw('devRecord', () => A.dev.record, v => { A.dev.record = v; });
  sw('devRealCall', () => A.dev.realCall, v => { A.dev.realCall = v; });
  const paintSound = sw('devSound', () => !A.quiet, v => A.setQuiet(!v));

  $('devStart').addEventListener('click', () => A.start());
  $('devStop').addEventListener('click', () => A.stop());
  $('holdBtn').addEventListener('click', () => A.toggleHolding());

  // ---------- Simulate ----------
  for (const b of document.querySelectorAll('[data-sim]')) {
    b.addEventListener('click', () => {
      const s = b.dataset.sim;
      if (s === 'stopped') A.stopped();
      else if (s === 'resumed') A.resumed();
      else if (!A.status) log('no run: start one first');
      else A.setStatus(s);
    });
  }
  for (const name of A.screens) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dbtn'; b.textContent = name; b.dataset.screen = name;
    b.addEventListener('click', () => A.show(name));
    $('devScreens').append(b);
  }

  // ---------- Saved data ----------
  function paintStore() {
    const rows = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^(breathing-sonar|sonar)\./.test(k)) continue;
        let v = localStorage.getItem(k);
        if (k === 'sonar.callKey') v = v ? '(set, hidden)' : '(empty)';
        else try { v = JSON.stringify(JSON.parse(v), null, 2); } catch (e) {}
        rows.push(`${k}\n  ${v.replace(/\n/g, '\n  ')}`);
      }
    } catch (e) { rows.push('storage blocked'); }
    $('devStore').textContent = rows.join('\n') || '(nothing saved)';
  }
  $('devFill').addEventListener('click', () => A.fillDemo());
  $('devReset').addEventListener('click', () => { A.reset(); paintStore(); });
  $('devLeave').addEventListener('click', () => A.leave());

  // ---------- Event log ----------
  const t0 = performance.now();
  function log(text) {
    const li = document.createElement('li');
    li.innerHTML = `${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s <b></b>`;
    li.querySelector('b').textContent = text;
    $('devLog').prepend(li);
    while ($('devLog').children.length > 120) $('devLog').lastChild.remove();
  }

  // ---------- Follow the app ----------
  const STATUS_TONE = { watching: 'ok', searching: '', lost: 'warn', deaf: 'bad' };
  A.on((type, d) => {
    if (type === 'screen') {
      $('devScreen').textContent = d;
      for (const b of $('devScreens').children) b.classList.toggle('on', b.dataset.screen === d);
    }
    if (type === 'status') { $('devStatus').textContent = d; $('devStatus').className = 'chip ' + (STATUS_TONE[d] || ''); log('status: ' + d); }
    if (type === 'session' && !d) { $('devStatus').textContent = 'idle'; $('devStatus').className = 'chip'; }
    if (type === 'session') log(d ? 'run started' + (A.dev.fake ? ' (fake)' : '') : 'run stopped');
    if (type === 'mark' && !/^status: /.test(d)) log(d);
    if (type === 'holding') {
      $('holdBtn').setAttribute('aria-pressed', String(d));
      $('holdBtn').firstChild.textContent = d ? "Holding. Mark: I'm breathing again " : "Mark: I'm holding my breath ";
    }
    if (type === 'quiet') paintSound();
    if (type === 'fake') paintFake();
    if (type === 'stored') paintStore();
  });
  $('devScreen').textContent = A.screen;
  paintStore();
  log('dev mode on (?debug=0 or "Leave dev mode" turns it off)');

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || A.counting || e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'h') A.toggleHolding();
    if (e.key === 'm') A.setQuiet(!A.quiet);
    if (e.key === 's') setOpen(!open, true);
  });
})();
