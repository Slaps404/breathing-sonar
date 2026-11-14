// Onboarding UI. Four screens, one visible at a time:
//   setup -> watch -> alarm (countdown) -> called
// It talks to the rest of the project only through window.SonarHooks (hooks.js).
(function () {
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'breathing-sonar.contact';
  const COUNTDOWN_S = 15;   // time to press "I'm okay" before the friend is phoned

  let contact = null;       // { friendName, friendPhone, userName, place }
  let session = null;       // what startMonitoring returned: { stop() }
  let countTimer = null;
  let beeper = null;
  let wakeLock = null;

  function show(name) {
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 's-' + name;
    document.body.classList.toggle('alarming', name === 'alarm' || name === 'called');
  }

  // ---------- Setup ----------

  // Accepts "619 555 0123", "(619) 555-0123", "+44 20 7946 0958". Returns "+16195550123" style, or null.
  function toE164(raw) {
    const digits = raw.replace(/\D/g, '');
    if (raw.trim().startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return null;
  }

  function readForm() {
    const c = {
      friendName: $('friendName').value.trim(),
      friendPhone: toE164($('friendPhone').value),
      userName: $('userName').value.trim(),
      place: $('place').value.trim(),
    };
    const missing = !c.friendName ? ['friendName', "Add your friend's name."]
      : !c.friendPhone ? ['friendPhone', 'That number does not look complete. Include the area code.']
      : !c.userName ? ['userName', 'Add your name, so they know who the call is about.']
      : null;
    for (const id of ['friendName', 'friendPhone', 'userName']) $(id).classList.remove('bad');
    if (missing) {
      $(missing[0]).classList.add('bad');
      $(missing[0]).focus();
      $('formErr').textContent = missing[1];
      $('formErr').hidden = false;
      return null;
    }
    $('formErr').hidden = true;
    return c;
  }

  // Details stay in this browser only, so next time it is one click.
  function loadSaved() {
    try {
      const c = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!c) return;
      $('friendName').value = c.friendName || '';
      $('friendPhone').value = c.friendPhoneRaw || '';
      $('userName').value = c.userName || '';
      $('place').value = c.place || '';
      $('forget').hidden = false;
    } catch (e) { /* nothing saved, or storage blocked */ }
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
    for (const id of ['friendName', 'friendPhone', 'userName', 'place']) $(id).value = '';
    $('forget').hidden = true;
    $('friendName').focus();
  }

  async function onStart(e) {
    e.preventDefault();
    const c = readForm();
    if (!c) return;
    contact = c;
    save(c);
    for (const el of document.querySelectorAll('.fname')) el.textContent = c.friendName;
    $('start').disabled = true;
    try {
      session = await SonarHooks.startMonitoring({
        onStatus: setStatus,
        onBreathingStopped: startAlarm,
        onBreathingResumed: cancelAlarm,
      });
    } catch (err) {
      $('formErr').textContent = 'Could not start: ' + (err && err.message ? err.message : 'microphone not available') +
        '. Allow the microphone and try again.';
      $('formErr').hidden = false;
      $('start').disabled = false;
      return;
    }
    $('start').disabled = false;
    keepAwake();
    show('watch');
  }

  // ---------- Watching ----------

  const STATUS = {
    searching: ['Finding your breathing', 'Sit still for a few seconds.', ''],
    watching: ['Watching your breathing', () => `${contact.friendName} gets a call only if it stops.`, 'on'],
    lost: ["Can't find you", 'Sit back in front of the laptop, chest facing the screen.', 'lost'],
  };
  function setStatus(s) {
    const [title, sub, dot] = STATUS[s] || STATUS.searching;
    $('watchTitle').textContent = title;
    $('watchSub').textContent = typeof sub === 'function' ? sub() : sub;
    $('dot').className = 'dot ' + dot;
  }

  // A sleeping laptop cannot watch anything, so ask the browser to keep the screen on.
  async function keepAwake() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (session && document.visibilityState === 'visible') keepAwake(); // the lock drops when the tab is hidden
  });

  function stopAll() {
    stopAlarmNoise();
    if (session) session.stop();
    session = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    show('setup');
  }

  // ---------- Alarm: breathing stopped ----------

  function startAlarm() {
    if (!session || countTimer) return;
    let left = COUNTDOWN_S;
    $('count').textContent = left;
    show('alarm');
    $('okay').focus();
    startAlarmNoise();
    countTimer = setInterval(() => {
      left -= 1;
      $('count').textContent = Math.max(left, 0);
      if (left <= 0) placeCall();
    }, 1000);
  }

  function cancelAlarm() {
    if (!countTimer) return;
    stopAlarmNoise();
    show('watch');
  }

  // Loud on purpose: the first job of the alarm is to wake the person up.
  function startAlarmNoise() {
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
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('Are you okay? Press any key.')); } catch (e) { /* no speech */ }
  }
  function stopAlarmNoise() {
    clearInterval(countTimer); countTimer = null;
    if (beeper) { clearInterval(beeper.id); beeper.ctx.close(); beeper = null; }
    try { speechSynthesis.cancel(); } catch (e) { /* no speech */ }
  }

  // ---------- Called ----------

  async function placeCall() {
    stopAlarmNoise();
    $('calledTitle').textContent = `Calling ${contact.friendName}`;
    $('calledSub').textContent = '';
    $('calledPhone').textContent = '';
    show('called');
    try {
      await SonarHooks.callFriend(contact);
      $('calledTitle').textContent = `${contact.friendName} is being called`;
      $('calledSub').textContent = 'If you are okay, call them back so they know.';
    } catch (err) {
      // Nobody is being reached. Show the number big, for the person or anyone who walks in.
      $('calledTitle').textContent = 'The call did not go through';
      $('calledSub').textContent = `Call ${contact.friendName} yourself:`;
      $('calledPhone').textContent = contact.friendPhone;
    }
  }

  // ---------- Wiring ----------

  $('form').addEventListener('submit', onStart);
  $('forget').addEventListener('click', forget);
  $('stop').addEventListener('click', stopAll);
  $('stop2').addEventListener('click', stopAll);
  $('okay').addEventListener('click', cancelAlarm);
  $('resume').addEventListener('click', () => show('watch'));
  document.addEventListener('keydown', () => { if (countTimer) cancelAlarm(); });

  // While hooks.js is a stub, show links that fire its callbacks by hand.
  if (SonarHooks.isStub) {
    $('stubWatch').hidden = false;
    $('stubAlarm').hidden = false;
    document.addEventListener('click', e => {
      const sim = e.target.dataset && e.target.dataset.sim;
      if (!sim || !SonarHooks._simulate) return;
      e.preventDefault();
      if (sim === 'stopped') SonarHooks._simulate.stopped();
      else if (sim === 'resumed') SonarHooks._simulate.resumed();
      else SonarHooks._simulate.status(sim);
    });
  }

  loadSaved();
  const firstEmpty = ['friendName', 'friendPhone', 'userName'].find(id => !$(id).value);
  if (firstEmpty) $(firstEmpty).focus(); else $('start').focus();
})();
