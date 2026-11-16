// Onboarding UI. One thought per screen, one visible at a time:
//   hello -> how -> who -> you -> sit -> watch -> alarm (countdown) -> called
// From a partner's link: ready -> sit (the link carries the partner's name and number and the person's name).
// The partner makes that link on: hello -> invite -> share.
// hello and how show on a first visit only. A returning person starts at "sit", so it is one tap to Start.
// It talks to the rest of the project only through window.SonarHooks (hooks.js).
// With ?debug, dev.js adds the dev dashboard through window.BreathingApp (bottom of this file).
(function () {
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'breathing-sonar.contact';
  const COUNTDOWN_S = 6;    // time to tap "I'm okay" before the friend is phoned. 15 s gave resumed breathing time to clear the alarm by itself (1.5-4 s), but was too slow for the demo: tap to cancel
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };

  // Dev mode: app/?debug turns it on and this device remembers it; app/?debug=0 turns it off.
  const DEBUG_KEY = 'breathing-sonar.debug';
  const params = new URLSearchParams(location.search);
  if (params.has('debug')) store.set(DEBUG_KEY, params.get('debug') === '0' ? null : '1');
  const DEBUG = store.get(DEBUG_KEY) === '1';
  document.body.classList.toggle('debug', DEBUG);

  // Dev options (set from the dashboard). Off the dashboard, nothing is recorded and the call is real.
  const dev = { fake: false, record: true, realCall: true };

  let contact = null;       // { friendName, friendPhone, userName, place, homeAddress, voiceId }
  let session = null;       // what startMonitoring returned: { stop(), mark(), label() }
  let countTimer = null;
  let beeper = null;
  let voice = null;         // the alarm voice clip while it plays
  let wakeLock = null;
  let screen = null;

  // Small event bus so the dev dashboard can follow along: emit('screen' | 'status' | 'mark' | ..., detail)
  const listeners = [];
  const emit = (type, detail) => { for (const f of listeners) f(type, detail); };

  // Quiet mode: the alarm only shows on screen (no beep, no voice), so a demo room is not disturbed.
  const QUIET_KEY = 'breathing-sonar.quiet';
  let quiet = store.get(QUIET_KEY) === '1' || params.has('quiet');   // app/?quiet opens with sound off
  function setQuiet(on) { quiet = on; store.set(QUIET_KEY, on ? '1' : '0'); emit('quiet', on); }

  // ElevenLabs voice for both the alarm on this screen and the phone call. One clip per voice in voices/<id>.mp3.
  const VOICE_KEY = 'breathing-sonar.voice';
  const savedVoice = store.get(VOICE_KEY);
  if (savedVoice && $('voice').querySelector(`option[value="${savedVoice}"]`)) $('voice').value = savedVoice;
  $('voice').addEventListener('change', () => store.set(VOICE_KEY, $('voice').value));
  // How far the chest search looks (read by hooks.js when a run starts). Past 80 cm it can lock onto someone
  // else breathing, e.g. a dog at 114 cm (take 15-46-24), so the default stays 80 cm and the choice explains that.
  const REACH_KEY = 'breathing-sonar.reach';
  const savedReach = store.get(REACH_KEY);
  if (savedReach && $('reach').querySelector(`option[value="${savedReach}"]`)) $('reach').value = savedReach;
  const reachNote = () => { $('reachNote').hidden = $('reach').value === '0.8'; };
  reachNote();
  $('reach').addEventListener('change', () => { store.set(REACH_KEY, $('reach').value === '0.8' ? null : $('reach').value); reachNote(); });
  $('hearVoice').addEventListener('click', () => { try { new Audio(`voices/${$('voice').value}.mp3`).play(); } catch (e) { /* no audio */ } });

  // Wording and the sit picture follow the device.
  const DEVICE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'phone' : 'laptop';
  document.body.classList.add('is-' + DEVICE);
  for (const el of document.querySelectorAll('.devword')) el.textContent = DEVICE;

  function show(name) {
    closeSheet();
    for (const el of document.querySelectorAll('.screen')) {
      const on = el.id === 's-' + name;
      el.hidden = !on;
      // Re-run the entrance animation (fade up, one element after another) each time a screen opens.
      if (on && name !== screen) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
    }
    screen = name;
    document.body.classList.toggle('alarming', name === 'alarm' || name === 'called');
    if (name === 'how') setSlide(0);
    if (name === 'sit') offerInstall();
    if (name === 'who') $('whoBack').dataset.go = loadSavedComplete() ? 'sit' : 'how';
    const firstEmpty = [...$('s-' + name).querySelectorAll('input')].find(i => !i.value);
    if (firstEmpty && DEVICE === 'laptop') setTimeout(() => firstEmpty.focus({ preventScroll: true }), 450); // after the entrance; on phones this would pop the keyboard over the question
    $('s-' + name).scrollTop = 0;
    emit('screen', name);
  }

  // ---------- Bottom sheets ----------

  function openSheet(id) {
    $('scrim').hidden = false;
    $(id).hidden = false;
    $(id).querySelector('button').focus({ preventScroll: true });
  }
  function closeSheet() {
    $('scrim').hidden = true;
    for (const el of document.querySelectorAll('.sheet')) el.hidden = true;
  }

  // ---------- How it works: three cards, swipe or Next ----------

  let slide = 0;
  const SLIDES = 3;
  function setSlide(i) {
    slide = Math.max(0, Math.min(SLIDES - 1, i));
    $('slideTrack').style.transform = `translateX(${-100 * slide}%)`;
    [...$('dots').children].forEach((d, k) => d.classList.toggle('on', k === slide));
    [...$('slideTrack').children].forEach((s, k) => s.setAttribute('aria-hidden', String(k !== slide)));
    $('howNext').textContent = slide === SLIDES - 1 ? 'Set it up' : 'Next';
  }
  $('howNext').addEventListener('click', () => (slide === SLIDES - 1 ? show('who') : setSlide(slide + 1)));
  let swipeX = null;
  $('slides').addEventListener('pointerdown', e => { swipeX = e.clientX; });
  $('slides').addEventListener('pointerup', e => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX; swipeX = null;
    if (Math.abs(dx) > 40) setSlide(slide + (dx < 0 ? 1 : -1));
  });

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
    const u = $('userName').value.trim();
    $('welcomeBack').textContent = loadSavedComplete() && u ? `Welcome back, ${u}` : 'Last step';
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
    setFriendName();
    askLocation();
    show('sit');
  }

  // Asks for location now, while the person is setting up, so the fix at Start comes without a prompt.
  // The position itself is thrown away here; onStart takes a fresh one.
  function askLocation() {
    try { navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 15000 }); } catch (e) { /* no geolocation */ }
  }

  // ---------- Partner link ----------
  // The partner (the one who gets called) makes a link with their name and number and the person's name:
  //   app/?friend=Sam&phone=%2B16195550123&name=Alex
  // Opening it fills those in and saves them, so the person only sees the ready screen, then Start.

  const LINK_KEYS = ['friend', 'phone', 'name'];
  function readLink() {
    const friend = (params.get('friend') || '').trim(), phone = toE164(params.get('phone') || ''), name = (params.get('name') || '').trim();
    if (!friend || !phone) return false;
    $('friendName').value = friend.slice(0, 40);
    $('friendPhone').value = phone;
    if (name) $('userName').value = name.slice(0, 40);
    // Take the details out of the address bar, so a reload or a shared screenshot does not carry them.
    for (const k of LINK_KEYS) params.delete(k);
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
    return true;
  }

  // "+16195550123" -> "(619) 555-0123". Other countries stay as they are.
  const prettyPhone = e164 => /^\+1\d{10}$/.test(e164) ? `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}` : e164;

  function onReady(e) {
    e.preventDefault();
    $('homeAddress').value = $('readyHome').value.trim();
    save(readContact());
    askLocation();
    show('sit');
  }

  // Links always point at the public site, so one made while testing on localhost still opens on their phone.
  const PUBLIC_APP = 'https://breathbuddy.us/app/';
  let inviteLink = '';
  function onInvite(e) {
    e.preventDefault();
    const ok = check('invErr', [
      ['invMyName', !$('invMyName').value.trim(), 'Add your name.'],
      ['invMyPhone', !toE164($('invMyPhone').value), 'That number does not look complete. Include the area code.'],
      ['invTheirName', !$('invTheirName').value.trim(), 'Add their name, so the app can greet them.'],
    ]);
    if (!ok) return;
    const q = new URLSearchParams({ friend: $('invMyName').value.trim(), phone: toE164($('invMyPhone').value), name: $('invTheirName').value.trim() });
    // The hosted call server only places calls for browsers that send its passcode (hooks.js keeps it from ?key=).
    // The person opens this link in a plain browser tab, so the link carries the partner's passcode to their browser.
    const key = store.get('sonar.callKey') || '';
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    if (key) q.set('key', key);
    inviteLink = (local ? PUBLIC_APP : location.origin + location.pathname) + '?' + q;
    $('shareLink').value = inviteLink;
    $('shareName').textContent = $('invTheirName').value.trim();
    $('shareWarn').textContent = key ? '' : "This browser has no call passcode, so the link can't place calls. Open the app once with ?key=<passcode>, then make the link again.";
    $('shareWarn').hidden = !$('shareWarn').textContent;
    $('copyBtn').textContent = 'Copy link';
    show('share');
  }

  // Phones open the share menu (Messages, WhatsApp...). Without one, open a text message with the link in it.
  async function shareLink() {
    const text = `I set this up for you. If your breathing stops, it calls me. Nothing to install, just open it and press Start:`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Breathing watch', text, url: inviteLink }); } catch (e) { /* closed the menu */ }
      return;
    }
    location.href = 'sms:?&body=' + encodeURIComponent(text + ' ' + inviteLink);
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(inviteLink); }
    catch (e) { $('shareLink').select(); document.execCommand('copy'); }   // older browsers, or no clipboard permission
    $('copyBtn').textContent = 'Copied';
  }

  // Details stay in this browser only, so next time it is one tap.
  function loadSaved() {
    try {
      const c = JSON.parse(store.get(STORE_KEY));
      if (!c) return false;
      $('friendName').value = c.friendName || '';
      $('friendPhone').value = c.friendPhoneRaw || '';
      $('userName').value = c.userName || '';
      $('homeAddress').value = c.homeAddress || '';
      return loadSavedComplete();
    } catch (e) { return false; /* nothing saved */ }
  }
  function loadSavedComplete() {
    try { const c = JSON.parse(store.get(STORE_KEY)); return Boolean(c && c.friendName && toE164(c.friendPhoneRaw || '') && c.userName); } catch (e) { return false; }
  }
  function save(c) { store.set(STORE_KEY, JSON.stringify({ ...c, friendPhoneRaw: $('friendPhone').value.trim() })); emit('stored'); }
  function forget() {
    store.set(STORE_KEY, null);
    for (const id of ['friendName', 'friendPhone', 'userName', 'homeAddress', 'readyHome']) $(id).value = '';
    setFriendName();
    emit('stored');
    show('hello');
  }

  function readContact() {
    return {
      friendName: $('friendName').value.trim(),
      friendPhone: toE164($('friendPhone').value),
      userName: $('userName').value.trim(),
      voiceId: $('voice').value,
      place: '',                                    // the GPS fix says where; the call server turns it into words
      homeAddress: $('homeAddress').value.trim(),   // optional; the call compares it with GPS to say "at home"
    };
  }

  async function onStart(e) {
    if (e) e.preventDefault();
    if (session) return;
    contact = readContact();
    if (!contact.friendName || !contact.friendPhone) { show('who'); return; }
    if (!contact.userName) { show('you'); return; }
    save(contact);
    setFriendName();
    // Ask for GPS now, while the person is here to allow it; the call says where that is (and the text, when on, gets a map link).
    // Not saved with the contact, so it is fresh each session. Fails quietly: the call then goes out without a location.
    if (navigator.geolocation && !(DEBUG && dev.fake)) navigator.geolocation.getCurrentPosition(
      pos => { contact.lat = pos.coords.latitude; contact.lng = pos.coords.longitude; },
      () => {}, { enableHighAccuracy: true, timeout: 15000 });
    $('start').disabled = true;
    $('sitErr').hidden = true;
    try {
      session = await SonarHooks.startMonitoring({
        onStatus: setStatus,
        onBreathingStopped: startAlarm,
        onBreathingResumed: cancelAlarm,
        onWave: followBreath,
        onWarmup: setWarmup,
        onDebug: DEBUG ? JudgeView.update : null,      // the sonar view lives in the dev dashboard
        onMark: ev => emit('mark', ev),
        record: DEBUG && dev.record,                     // keep the raw audio only for dev runs (visitors should not get a file download on Stop)
        fake: DEBUG && dev.fake,
      });
    } catch (err) {
      $('sitErr').textContent = 'Could not start: ' + (err && err.message ? err.message : 'microphone not available') +
        '. Allow the microphone and try again.';
      $('sitErr').hidden = false;
      $('start').disabled = false;
      show('sit');
      return;
    }
    $('start').disabled = false;
    store.set(USED_KEY, '1');
    status = null;
    setStatus('searching');
    setWarmup(0);
    $('orb').style.removeProperty('--s');
    keepAwake();
    emit('session', true);
    show('watch');
  }

  // ---------- Home screen, later ----------
  // The link works in a plain browser tab. Once they have used it, the sit screen offers an icon (it is already a PWA).
  // Chrome on Android hands us an install prompt; Safari on iPhone has none, so the sheet says where the menu item is.
  const USED_KEY = 'breathing-sonar.used';
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); installPrompt = e;
    $('installNow').hidden = false; $('instHow').hidden = true;
  });
  window.addEventListener('appinstalled', () => { for (const el of document.querySelectorAll('.installbtn')) el.hidden = true; });
  function offerInstall() {
    const sit = document.querySelector('#s-sit .installbtn'), row = document.querySelector('#sh-settings .installbtn');
    row.hidden = installed;
    sit.hidden = installed || store.get(USED_KEY) !== '1';
  }
  $('installNow').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null; closeSheet();
  });

  // ---------- Watching ----------

  const STATUS = {
    searching: ['Getting to know your breathing.', 'Sit still for a few seconds.', ''],
    watching: ['Breathing with you.', () => `I'm right here. ${contact.friendName} gets a call only if your breathing stops.`, 'on'],
    lost: ['Where did you go?', 'Sit back in front of the screen, chest facing it, so I can see you.', 'lost'],
    deaf: ["Can't hear my own sound.", 'Not watching. Unmute the speaker and turn it up. No headphones. Mic Mode: Standard.', 'lost'],
  };
  let status = null, warm = 0, warmTotal = 15;
  function setStatus(s) {
    if (!STATUS[s]) s = 'searching';
    const [title, sub, tone] = STATUS[s];
    $('watchTitle').textContent = title;
    $('watchSub').textContent = typeof sub === 'function' ? sub() : sub;
    const changed = s !== status;
    status = s;
    $('warm').classList.toggle('done', s !== 'searching');
    $('orb').classList.toggle('live', s === 'watching');
    $('orb').classList.toggle('lost', tone === 'lost');
    guide(s === 'searching');
    if (s === 'searching') setWarmup(warm, warmTotal);
    if (changed) emit('status', s);
  }

  // While it looks for the chest, the cloud paces breathing: in for 4 s, out for 6 s. The cloud's size
  // and the "in" / "out" words share one CSS timeline (.guiding in style.css), so they cannot drift apart.
  function guide(on) {
    $('warm').classList.toggle('guiding', on);
  }

  // While searching, the first 15 s are a fixed wait (the sonar needs that much sound); after that it
  // still needs a still moment to lock on, which has no fixed length. No progress bar: it could only
  // show the first part, so just say which part we're in.
  function setWarmup(f, total = 15) {
    warm = f; warmTotal = total;
    if (status !== 'searching') return;
    $('watchSub').textContent = f < 1 ? 'Sit still while I listen.' : 'Almost there. Keep still.';
  }

  // The cloud breathes with you: its size follows the newest chest position, 0.95 at the middle of a
  // breath, bigger as you breathe in, smaller as you breathe out. mm is the last 20 s of chest movement.
  // The scale has a floor of +-1 mm, so a held breath (about 0.5 mm of noise) leaves the cloud still
  // instead of zooming in on noise; real breaths move 1-3 mm peak to peak.
  const BREATH_FLOOR_MM = 1;
  function followBreath(mm) {
    if (status !== 'watching' || !mm.length) return;
    const scale = Math.max(BREATH_FLOOR_MM, 1.1 * Math.max(...mm.map(Math.abs)));
    $('orb').style.setProperty('--s', (0.95 + 0.11 * (mm[mm.length - 1] / scale)).toFixed(3));
  }

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
    if (session) session.stop();              // dev runs with "Record take" on download the .wav here
    session = null;
    guide(false);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    emit('session', false);
    show('sit');
  }

  // ---------- Alarm: breathing stopped ----------

  function startAlarm() {
    if (!session || countTimer) return;
    let left = COUNTDOWN_S;
    session.mark('alarm: countdown');
    $('count').textContent = left;
    const d = $('drain');
    d.style.setProperty('--t', COUNTDOWN_S + 's');
    d.classList.remove('run'); void d.getBoundingClientRect(); d.classList.add('run');
    show('alarm');
    startAlarmNoise();
    countTimer = setInterval(() => {
      left -= 1;
      $('count').textContent = Math.max(left, 0);
      if (left <= 0) placeCall();
    }, 1000);
  }

  // Recording ground truth (dev only): the person marks when they hold their breath, so the saved take can be scored.
  let holding = false;
  function setHolding(on) {
    if (on === holding) return;
    holding = on;
    if (session) session.label(on ? 'hold' : 'normal');
    emit('holding', on);
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
    $('callYourself').hidden = true;
    show('called');
    try {
      if (DEBUG && !dev.realCall) {             // dev: pretend the call went through
        emit('mark', 'call: simulated (real call off)');
        await new Promise(r => setTimeout(r, 1200));
      } else {
        await SonarHooks.callFriend(contact);
      }
      $('calledTitle').textContent = `${contact.friendName} is being called.`;
      $('calledSub').textContent = 'If you are okay, call them back so they know.';
    } catch (err) {
      // Nobody is being reached. Show the number big, for the person or anyone who walks in.
      emit('mark', 'call failed: ' + (err && err.message));
      $('calledTitle').textContent = 'The call did not go through.';
      $('calledSub').textContent = `Call ${contact.friendName} yourself:`;
      $('callYourself').textContent = 'Call ' + contact.friendPhone;
      $('callYourself').hidden = false;
    }
  }
  const dial = number => { location.href = 'tel:' + number; };

  // ---------- Wiring ----------

  $('s-who').addEventListener('submit', onWho);
  $('s-you').addEventListener('submit', onYou);
  $('s-ready').addEventListener('submit', onReady);
  $('s-invite').addEventListener('submit', onInvite);
  $('shareBtn').addEventListener('click', shareLink);
  $('copyBtn').addEventListener('click', copyLink);
  $('s-sit').addEventListener('submit', onStart);
  $('forget').addEventListener('click', forget);
  $('stop').addEventListener('click', stopAll);
  $('stop2').addEventListener('click', stopAll);
  $('s-alarm').addEventListener('click', cancelAlarm);          // tap anywhere
  $('resume').addEventListener('click', () => show('watch'));
  $('callYourself').addEventListener('click', () => dial(contact.friendPhone));
  $('callNUA').addEventListener('click', () => dial('+18776961996'));
  $('scrim').addEventListener('click', closeSheet);
  // During the countdown any key means "I'm okay". Escape closes a sheet.
  document.addEventListener('keydown', e => {
    if (countTimer) { e.preventDefault(); cancelAlarm(e); return; }
    if (e.key === 'Escape') closeSheet();
  });
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'), sheet = e.target.closest('[data-sheet]'), close = e.target.closest('[data-close]');
    if (go) { e.preventDefault(); show(go.dataset.go); }
    else if (sheet) openSheet(sheet.dataset.sheet);
    else if (close) closeSheet();
  });

  // Phone frame clock (laptop view only)
  const tick = () => { $('sbarTime').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, ''); };
  tick(); setInterval(tick, 20000);

  const known = loadSaved();
  const fromLink = readLink();        // after loadSaved: the link's details win, a saved home address stays
  if (fromLink) {
    save(readContact());
    $('readyUser').textContent = $('userName').value.trim();
    $('readyPhone').textContent = prettyPhone(toE164($('friendPhone').value));
    $('readyHome').value = $('homeAddress').value;
    $('sitBack').dataset.go = 'ready';
  }
  setFriendName();
  show(fromLink ? ($('userName').value.trim() ? 'ready' : 'you') : known ? 'sit' : 'hello');

  // ---------- For the dev dashboard (dev.js) ----------
  window.BreathingApp = {
    DEBUG, dev, COUNTDOWN_S,
    on: f => listeners.push(f),
    screens: ['hello', 'how', 'invite', 'share', 'ready', 'who', 'you', 'sit', 'watch', 'alarm', 'called'],
    show(name) { if (!contact) contact = readContact(); if (!contact.friendName) contact.friendName = 'your friend'; show(name); },
    start: () => onStart(),
    stop: stopAll,
    // Simulated detector events. "stopped" starts a fake run first if nothing is running.
    async stopped() { if (!session) { dev.fake = true; emit('fake', true); await onStart(); } startAlarm(); },
    resumed: () => cancelAlarm(),
    setStatus: s => { if (session) setStatus(s); },
    toggleHolding: () => setHolding(!holding),
    get holding() { return holding; },
    get quiet() { return quiet; },
    setQuiet,
    get counting() { return Boolean(countTimer); },
    get screen() { return screen; },
    get status() { return session ? status : null; },
    fillDemo() {
      $('friendName').value = 'Sam'; $('friendPhone').value = '(619) 555-0123'; $('userName').value = 'Alex';
      save(readContact()); setFriendName(); show('sit');
    },
    reset() { if (session) stopAll(); for (const k of [STORE_KEY, QUIET_KEY, VOICE_KEY]) store.set(k, null); forget(); },
    leave() { store.set(DEBUG_KEY, null); location.replace(location.pathname); },
  };
})();
