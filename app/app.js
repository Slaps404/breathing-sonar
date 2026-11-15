// Onboarding UI. One thought per screen, one visible at a time:
//   who -> you -> sit -> watch -> alarm (countdown) -> called
// A returning person starts at "sit", so it is one tap to Start.
// It talks to the rest of the project only through window.SonarHooks (hooks.js).
(function () {
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'breathing-sonar.contact';
  const COUNTDOWN_S = 6;    // time to tap "I'm okay" before the friend is phoned. 15 s gave resumed breathing time to clear the alarm by itself (1.5-4 s), but was too slow for the demo: tap to cancel

  let contact = null;       // { friendName, friendPhone, userName, place, homeAddress }
  let session = null;       // what startMonitoring returned: { stop() }
  let countTimer = null;
  let beeper = null;
  let voice = null;         // the alarm voice clip while it plays
  let wakeLock = null;
  // Quiet mode: the alarm only shows on screen (no beep, no voice), so a demo room is not disturbed.
  const QUIET_KEY = 'breathing-sonar.quiet';
  // ElevenLabs voice for both the alarm on this screen and the phone call. One clip per voice in voices/<id>.mp3.
  const VOICE_KEY = 'breathing-sonar.voice';
  try { const v = localStorage.getItem(VOICE_KEY); if (v && $('voice').querySelector(`option[value="${v}"]`)) $('voice').value = v; } catch (e) { /* no storage */ }
  $('voice').addEventListener('change', () => { try { localStorage.setItem(VOICE_KEY, $('voice').value); } catch (e) { /* no storage */ } });
  $('hearVoice').addEventListener('click', () => { try { new Audio(`voices/${$('voice').value}.mp3`).play(); } catch (e) { /* no audio */ } });
  let quiet = false;
  try { quiet = localStorage.getItem(QUIET_KEY) === '1'; } catch (e) { /* no storage */ }
  if (new URLSearchParams(location.search).has('quiet')) quiet = true;   // app/?quiet opens with sound off
  function setQuiet(on) {
    quiet = on;
    try { localStorage.setItem(QUIET_KEY, on ? '1' : '0'); } catch (e) { /* no storage */ }
    $('soundBtn').setAttribute('aria-pressed', !on);
    $('soundBtn').textContent = on ? 'Sound off (m)' : 'Sound on (m)';
  }
  let judgeOpen = false;    // judge view (judge.js) toggled on from the watch screen

  // Wording and the sit picture follow the device.
  const DEVICE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'phone' : 'laptop';
  document.body.classList.add('is-' + DEVICE);
  for (const el of document.querySelectorAll('.dev')) el.textContent = DEVICE;

  function show(name) {
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 's-' + name;
    document.body.classList.toggle('alarming', name === 'alarm' || name === 'called');
    showJudge(name);
    const firstEmpty = [...$('s-' + name).querySelectorAll('input')].find(i => !i.value);
    if (firstEmpty && DEVICE === 'laptop') firstEmpty.focus(); // on phones this would pop the keyboard over the question
    window.scrollTo(0, 0);
  }

  // ---------- Setup: who, you, sit ----------

  // Accepts "619 555 0123", "(619) 555-0123", "+44 20 7946 0958". Returns "+16195550123" style, or null.
  function toE164(raw) {
    const digits = raw.replace(/\D/g, '');
    if (raw.trim().startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return null;
  }

  // Shows the first problem on a screen, or clears it. Returns true when the screen is fine.
  function check(errId, problems) {
    for (const [id] of problems) $(id).classList.remove('bad');
    const hit = problems.find(([, bad]) => bad);
    $(errId).hidden = !hit;
    if (!hit) return true;
    $(hit[0]).classList.add('bad');
    $(hit[0]).focus();
    $(errId).textContent = hit[2];
    return false;
  }

  function setFriendName() {
    const n = $('friendName').value.trim();
    for (const el of document.querySelectorAll('.fname')) el.textContent = n || 'your friend';
  }

  function onWho(e) {
    e.preventDefault();
    const ok = check('whoErr', [
      ['friendName', !$('friendName').value.trim(), 'Add their name.'],
      ['friendPhone', !toE164($('friendPhone').value), 'That number does not look complete. Include the area code.'],
    ]);
    if (!ok) return;
    setFriendName();
    show($('userName').value.trim() ? 'sit' : 'you');
  }

  function onYou(e) {
    e.preventDefault();
    if (!check('youErr', [['userName', !$('userName').value.trim(), 'Add your name, so they know who the call is about.']])) return;
    show('sit');
  }

  // Details stay in this browser only, so next time it is one tap.
  function loadSaved() {
    try {
      const c = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!c) return false;
      $('friendName').value = c.friendName || '';
      $('friendPhone').value = c.friendPhoneRaw || '';
      $('userName').value = c.userName || '';
      $('place').value = c.place || '';
      $('homeAddress').value = c.homeAddress || '';
      $('forget').hidden = false;
      return Boolean(c.friendName && toE164(c.friendPhoneRaw || '') && c.userName);
    } catch (e) { return false; /* nothing saved, or storage blocked */ }
  }
  function save(c) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...c, friendPhoneRaw: $('friendPhone').value.trim() }));
      $('forget').hidden = false;
    } catch (e) { /* storage blocked: still works for this session */ }
  }
  function forget(e) {
    e.preventDefault();
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
    for (const id of ['friendName', 'friendPhone', 'userName', 'place', 'homeAddress']) $(id).value = '';
    $('forget').hidden = true;
    setFriendName();
  }

  async function onStart(e) {
    e.preventDefault();
    contact = {
      friendName: $('friendName').value.trim(),
      friendPhone: toE164($('friendPhone').value),
      userName: $('userName').value.trim(),
      voiceId: $('voice').value,
      place: $('place').value.trim(),
      homeAddress: $('homeAddress').value.trim(),   // optional; the call compares it with GPS to say "at home"
    };
    save(contact);
    // Ask for GPS now, while the person is here to allow it; the call says where that is (and the text, when on, gets a map link).
    // Not saved with the contact, so it is fresh each session. Fails quietly (the typed place still goes).
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
      pos => { contact.lat = pos.coords.latitude; contact.lng = pos.coords.longitude; },
      () => {}, { enableHighAccuracy: true, timeout: 15000 });
    $('start').disabled = true;
    $('sitErr').hidden = true;
    try {
      session = await SonarHooks.startMonitoring({
        onStatus: setStatus,
        onBreathingStopped: startAlarm,
        onBreathingResumed: cancelAlarm,
        onWave: drawWave,
        onDebug: JudgeView.update,
        onWarmup: setWarmup,
      });
    } catch (err) {
      $('sitErr').textContent = 'Could not start: ' + (err && err.message ? err.message : 'microphone not available') +
        '. Allow the microphone and try again.';
      $('sitErr').hidden = false;
      $('start').disabled = false;
      return;
    }
    $('start').disabled = false;
    setWarmup(0);
    drawWave([], 1);
    keepAwake();
    show('watch');
  }

  // ---------- Watching ----------

  const STATUS = {
    searching: ['Finding your breathing.', 'Sit still for a few seconds.', ''],
    watching: ['Watching your breathing.', () => `${contact.friendName} gets a call only if it stops.`, 'on'],
    lost: ["Can't find you.", 'Sit back in front of the screen, chest facing it.', 'lost'],
  };
  function setStatus(s) {
    const [title, sub, dot] = STATUS[s] || STATUS.searching;
    $('watchTitle').textContent = title;
    $('watchSub').textContent = typeof sub === 'function' ? sub() : sub;
    $('dot').className = 'dot ' + dot;
    status = s;
    $('warm').hidden = s !== 'searching';
    if (s === 'searching') setWarmup(warm);
  }

  // Warm-up bar while searching. The first 15 s are a fixed wait (the sonar needs that much data), so
  // show seconds left. After that it still needs a still moment to lock on, which has no fixed length.
  let status = 'searching', warm = 0;
  function setWarmup(f) {
    warm = f;
    if (status !== 'searching') return;
    $('warmFill').style.width = Math.round(f * 100) + '%';
    $('warm').setAttribute('aria-valuenow', Math.round(f * 100));
    $('warm').classList.toggle('full', f >= 1);
    $('watchSub').textContent = f < 1 ? `Sit still. About ${Math.ceil(15 * (1 - f))} s left.` : 'Almost there. Keep still.';
  }

  // Breathing line: chest movement over the last 20 s, newest on the right. Like the test page,
  // the scale has a floor, so a held breath draws flat instead of zooming in on noise. The floor is
  // +-1 mm here (test page: +-3 mm on a taller plot): on a recorded take, breathing moved 1-3 mm
  // peak to peak and a hold about 0.5 mm, so 3 mm made breathing a small ripple on this short line.
  const WAVE_FLOOR_MM = 1;
  function drawWave(mm, rate) {
    const c = $('wave'), g = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;                       // screen hidden (alarm showing): skip
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (mm.length < 2) return;
    const N = Math.round(20 * rate), scale = Math.max(WAVE_FLOOR_MM, 1.1 * Math.max(...mm.map(Math.abs)));
    g.strokeStyle = getComputedStyle(c).color;  // follows the light / dark theme
    g.lineWidth = 1.5; g.lineJoin = 'round';
    g.beginPath();
    mm.forEach((v, i) => {
      const x = ((N - mm.length + i) / (N - 1)) * w, y = h / 2 - (v / scale) * (h * 0.45);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }

  // Judge view: what the sonar sees (judge.js). It stays up through the alarm and call screens,
  // so the moment of detection shows next to "Are you okay?".
  function showJudge(name = [...document.querySelectorAll('.screen')].find(el => !el.hidden).id.slice(2)) {
    const on = judgeOpen && ['watch', 'alarm', 'called'].includes(name);
    $('judge').hidden = !on;
    document.body.classList.toggle('judge-open', on);
    $('judgeBtn').textContent = judgeOpen ? 'Hide the sonar' : 'Show the sonar';
    $('judgeBtn').setAttribute('aria-expanded', String(judgeOpen));
  }
  function toggleJudge() { judgeOpen = !judgeOpen; showJudge(); }

  // A sleeping device cannot watch anything, so ask the browser to keep the screen on.
  async function keepAwake() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (session && document.visibilityState === 'visible') keepAwake(); // the lock drops when the tab is hidden
  });

  function stopAll() {
    stopAlarmNoise();
    setHolding(false);
    if (session) session.stop();
    session = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    show('sit');
  }

  // ---------- Alarm: breathing stopped ----------

  function startAlarm() {
    if (!session || countTimer) return;
    let left = COUNTDOWN_S;
    session.mark('alarm: countdown');
    $('count').textContent = left;
    show('alarm');
    startAlarmNoise();
    countTimer = setInterval(() => {
      left -= 1;
      $('count').textContent = Math.max(left, 0);
      if (left <= 0) placeCall();
    }, 1000);
  }

  // Recording ground truth: the person marks when they hold their breath, so the saved take can be scored.
  let holding = false;
  function setHolding(on) {
    if (on === holding) return;
    holding = on;
    if (session) session.label(on ? 'hold' : 'normal');
    $('holdBtn').setAttribute('aria-pressed', on);
    $('holdBtn').textContent = on ? "Holding. Mark: I'm breathing again (h)" : "Mark: I'm holding my breath (h)";
  }

  function cancelAlarm(e) {
    if (!countTimer) return;
    if (session) session.mark(e ? "user: I'm okay" : 'alarm cleared');
    if (e) setHolding(false);                 // answering the alarm means breathing again
    stopAlarmNoise();
    show('watch');
  }

  // Loud on purpose: the first job of the alarm is to wake the person up.
  function startAlarmNoise() {
    if (quiet) return;                        // screen-only alarm
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = () => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.5, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.start(); o.stop(ctx.currentTime + 0.4);
      };
      beep();
      beeper = { ctx, id: setInterval(beep, 700) };
    } catch (e) { /* no audio: the screen still shows the alarm */ }
    try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) { /* no vibration */ }
    // Recorded voice (ElevenLabs clip). If it cannot play, the browser's own voice says the line instead.
    const say = () => { try { speechSynthesis.speak(new SpeechSynthesisUtterance('Are you okay? Tap the screen.')); } catch (e) { /* no speech */ } };
    try {
      voice = new Audio(`voices/${$('voice').value}.mp3`);
      voice.play().catch(() => { if (voice) say(); });
    } catch (e) { say(); }
  }
  function stopAlarmNoise() {
    clearInterval(countTimer); countTimer = null;
    if (beeper) { clearInterval(beeper.id); beeper.ctx.close(); beeper = null; }
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* no vibration */ }
    if (voice) { voice.pause(); voice = null; }
    try { speechSynthesis.cancel(); } catch (e) { /* no speech */ }
  }

  // ---------- Called ----------

  async function placeCall() {
    if (session) session.mark('call: friend phoned');
    stopAlarmNoise();
    $('calledTitle').textContent = `Calling ${contact.friendName}.`;
    $('calledSub').textContent = '';
    $('calledPhone').textContent = '';
    show('called');
    try {
      await SonarHooks.callFriend(contact);
      $('calledTitle').textContent = `${contact.friendName} is being called.`;
      $('calledSub').textContent = 'If you are okay, call them back so they know.';
    } catch (err) {
      // Nobody is being reached. Show the number big, for the person or anyone who walks in.
      $('calledTitle').textContent = 'The call did not go through.';
      $('calledSub').textContent = `Call ${contact.friendName} yourself:`;
      $('calledPhone').textContent = contact.friendPhone;
      $('calledPhone').href = 'tel:' + contact.friendPhone;
    }
  }

  // ---------- Wiring ----------

  $('s-who').addEventListener('submit', onWho);
  $('s-you').addEventListener('submit', onYou);
  $('s-sit').addEventListener('submit', onStart);
  $('forget').addEventListener('click', forget);
  $('stop').addEventListener('click', stopAll);
  $('stop2').addEventListener('click', stopAll);
  $('s-alarm').addEventListener('click', cancelAlarm);          // tap anywhere
  // During the countdown any key means "I'm okay", so "s" must not also toggle the judge view there.
  document.addEventListener('keydown', e => {
    if (countTimer) { cancelAlarm(e); return; }
    if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey && !$('s-watch').hidden) setHolding(!holding);
    if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey && !$('s-watch').hidden) setQuiet(!quiet);
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !$('s-watch').hidden) toggleJudge();
  });
  $('judgeBtn').addEventListener('click', toggleJudge);
  $('soundBtn').addEventListener('click', () => setQuiet(!quiet));
  setQuiet(quiet);
  $('holdBtn').addEventListener('click', () => setHolding(!holding));
  $('resume').addEventListener('click', () => show('watch'));
  for (const el of document.querySelectorAll('[data-go]')) {
    el.addEventListener('click', e => { e.preventDefault(); show(el.dataset.go); });
  }

  // While hooks.js is a stub, show links that fire its callbacks by hand.
  if (SonarHooks.isStub) {
    $('stub').hidden = false;
    $('stub').addEventListener('click', e => {
      const sim = e.target.dataset && e.target.dataset.sim;
      if (!sim) return;
      e.preventDefault();
      e.stopPropagation();
      if (!SonarHooks._simulate) return;
      if (sim === 'stopped') SonarHooks._simulate.stopped();
      else if (sim === 'resumed') SonarHooks._simulate.resumed();
      else SonarHooks._simulate.status(sim);
    });
  }

  const known = loadSaved();
  setFriendName();
  show(known ? 'sit' : 'who');
})();
