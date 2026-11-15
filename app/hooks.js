// The two places where the onboarding UI hands off to the rest of the project.
// Both are real now. Keep the shapes and the UI needs no changes.
//
//   UI  --startMonitoring()-->  sonar (dsp.js)   reports status, breathing stopped / resumed
//   UI  --callFriend()------->  phone call (ElevenLabs + Twilio)

window.SonarHooks = {
  // True would show the "simulate" bar in the UI. The real sonar is wired in now.
  isStub: false,

  // HOOK 1. Called once when the person presses Start.
  // Asks for the mic, starts the sonar (dsp.js, range mode, same setup as the test page ../index.html),
  // and reports back through the callbacks:
  //   onStatus('searching')   no steady breathing found yet (the sonar needs ~15 s of data first)
  //   onStatus('watching')    breathing found and being tracked
  //   onStatus('lost')        moving for more than LOST_MS, so breathing cannot be judged
  //   onWarmup(f)             0..1, share of the 15 s of data the sonar needs before it can find breathing
  //   onBreathingStopped()    breathing was there and has now stopped
  //   onBreathingResumed()    breathing came back (cancels a pending call)
  //   onWave(mm, rate)        optional. Chest movement in mm over the last 20 s (rate samples/s),
  //                           the same signal the test page draws (sonar.analyze(...).ch.disp)
  //   onDebug(snapshot)       optional. Everything the judge view draws, ~5 times a second (see snapshot below)
  // Returns { stop(), mark(event), label(name) }. Throws if the mic is refused: the UI shows the message.
  // Records the run: every mic frame, labels (what the person says they are doing: 'normal' / 'hold', set with
  // label(); starts 'normal') and events (status, detector, alarm, taps; set with mark()). stop() downloads
  // take-<time>.wav + .json in the collectors' format, so `node tools/replay-take.js <path>` replays it.
  async startMonitoring({ onStatus, onBreathingStopped, onBreathingResumed, onWave, onDebug, onWarmup }) {
    const LOST_MS = 3000, VOLUME = 0.7;
    // Browsers hide the mic API on plain http pages that are not localhost (e.g. http://192.168.x.x).
    if (!navigator.mediaDevices) {
      throw new Error('this browser blocks the mic on ' + location.origin +
        '. Open http://localhost:8000/app/ on this computer, or use an https link');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = new AudioContext({ sampleRate: DSP.SR, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([DSP.PROBE_WORKLET], { type: 'application/javascript' })));
    const sonar = new DSP.RangeSonar();
    const node = new AudioWorkletNode(ctx, 'probe', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { signal: sonar.p.sig, amp: VOLUME } });
    const take = window.SonarHooks.makeTake(sonar.p, VOLUME);
    node.port.onmessage = e => { take.push(e.data); sonar.ingestFrame(e.data); };
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination);

    let status = null, movingSince = null;
    const setStatus = s => { if (s !== status) { status = s; take.mark('status: ' + s); onStatus(s); } };
    setStatus('searching');
    const timer = setInterval(() => {
      const now = performance.now();
      const res = sonar.analyze(now);
      if (res && res.event === 'start') { take.mark('detector: stopped (' + res.why + ')'); onBreathingStopped(); }
      if (res && res.event === 'end') { take.mark('detector: resumed'); onBreathingResumed(); }
      if (res && onWave) onWave(res.ch.disp, sonar.rate);
      if (onDebug) onDebug(window.SonarHooks.snapshot(sonar, res));
      // Warm-up: analyze() returns nothing until it has 15 s of echoes (dsp.js), so report how far along that is.
      if (onWarmup) onWarmup(Math.min(1, sonar.frames / (15 * sonar.rate)));
      movingSince = sonar.apnea.moving === true ? (movingSince ?? now) : null;
      if (movingSince !== null && now - movingSince > LOST_MS) setStatus('lost');
      else if (res) setStatus('watching');
      else if (status !== 'watching') setStatus('searching');
    }, 200);

    return {
      mark: take.mark,
      label: take.label,
      stop() {
        clearInterval(timer);
        node.disconnect();
        stream.getTracks().forEach(t => t.stop());
        ctx.close();
        take.download();
      },
    };
  },

  // Recording of one run. Frames arrive one probe period (P samples) at a time, starting at probe[0],
  // so WAV sample n lines up with probe[n % P], as in collect/recorder.py.
  makeTake(p, amp) {
    const SR = DSP.SR, P = p.P, started = new Date(), frames = [], labels = [{ label: 'normal', sample: 0, t: 0 }], events = [];
    const id = 'take-' + started.toISOString().replace(/[:.]/g, '-');
    let peak = 0;
    const samples = () => frames.length * P;
    return {
      push(f) {
        const q = new Int16Array(P);
        for (let i = 0; i < P; i++) { const v = f[i]; if (Math.abs(v) > peak) peak = Math.abs(v); q[i] = Math.max(-1, Math.min(1, v)) * 32767; }
        frames.push(q);
      },
      mark(event) { events.push({ event, sample: samples(), t: +(samples() / SR).toFixed(3) }); },
      // Ground truth for tools/replay-take.js, which scores each 'hold' stretch (until the next label).
      label(label) { labels.push({ label, sample: samples(), t: +(samples() / SR).toFixed(3) }); },
      download() {
        const n = samples(), wav = new DataView(new ArrayBuffer(44));
        const str = (o, t) => { for (let i = 0; i < t.length; i++) wav.setUint8(o + i, t.charCodeAt(i)); };
        wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
        wav.setUint32(24, SR, true); wav.setUint32(28, 2 * SR, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
        str(36, 'data'); wav.setUint32(40, 2 * n, true);
        const meta = { id, source: 'app', started: started.toISOString(), sampleRate: SR, P, f0: p.f0, f1: p.f1, amp,
          samples: n, seconds: +(n / SR).toFixed(2), labels, events, peak: +peak.toFixed(4), userAgent: navigator.userAgent };
        const save = (blob, name) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        };
        // One file: the labels ride inside the .wav as a 'json' chunk after the audio, because Chrome
        // blocks a second automatic download. Players skip unknown chunks; tools/replay-take.js reads it.
        let js = new TextEncoder().encode(JSON.stringify(meta));
        if (js.length % 2) js = new Uint8Array([...js, 32]);       // RIFF chunks are padded to even length
        const jh = new DataView(new ArrayBuffer(8));
        'json'.split('').forEach((c, i) => jh.setUint8(i, c.charCodeAt(0))); jh.setUint32(4, js.length, true);
        str(0, 'RIFF'); wav.setUint32(4, 36 + 2 * n + 8 + js.length, true); str(8, 'WAVEfmt ');
        save(new Blob([wav, ...frames, jh, js], { type: 'audio/wav' }), id + '.wav');
      },
    };
  },

  // What the judge view needs, read from the sonar after analyze(). Reads state only, changes nothing.
  // Also used by offline tests (node), which replay a recorded take through the same code.
  //   depth      last 20 s of motion-by-distance columns (each nShow slices of dr metres; the test page's depth view)
  //   lock       chest slice index (null until found); minR/maxR = search range in metres
  //   zscore     breathing-rhythm score per slice (about 0.5 = noise, 0.6-0.8 = a breathing chest); how the chest was picked
  //   wave       chest movement in mm (null until found), bpm and quality of its rhythm
  //   hold       breath-hold detector: still = seconds without movement, below = seconds under the alarm
  //              level, level/base = breathing strength now / normal (dB), ready = has a normal yet
  //   slow       slow-breathing detector: frac = share of the last 30 s that was slow
  //   alerting, why ('hold' | 'slow'), event ('start' | 'end' | null)
  snapshot(sonar, res) {
    const h = sonar.apnea, log = sonar.slow.log;
    return {
      depth: sonar.depth, nShow: sonar.nShow, dr: sonar.dr, rate: sonar.rate,
      lock: sonar.lock, minR: sonar.minR, maxR: sonar.maxR, zscore: sonar.zscore,
      wave: res ? res.ch.disp : null, bpm: res ? res.ch.bpm : null, quality: res ? res.ch.quality : 0,
      hold: { still: h.quiet, below: h.below, moving: h.moving === true, alerting: h.alerting,
        ready: h.B.length >= 45, level: h.level ?? null, base: h.base ?? null },   // 45: same test as holdStep in dsp.js
      HOLD: DSP.HOLD,
      slow: { alerting: sonar.slow.alerting, frac: log.length ? log.filter(x => x[1]).length / log.length : 0 },
      SLOW: DSP.SLOW,
      alerting: sonar.alerting, why: sonar.why, event: res ? res.event : null,
    };
  },

  // HOOK 2. Called when the friend should be phoned: breathing stopped and the person
  // did not press "I'm okay" before the countdown ran out.
  //   contact = { friendName, friendPhone (E.164, e.g. "+16195550123"), userName, place }
  //   place may be an empty string; lat/lng are set only if the browser gave GPS.
  // Returns a promise. Reject (throw) if the call could not be placed: the UI then
  // shows the friend's number so anyone nearby can dial it.
  // Real: call/server.py (run `python3 call/server.py`) texts the friend the location, then ElevenLabs
  // rings them through Twilio.
  // The server takes a list of friends and rings them all at once; the UI has one friend for now.
  async callFriend(contact) {
    const res = await fetch('http://127.0.0.1:8788/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friends: [{ name: contact.friendName, phone: contact.friendPhone }],
        userName: contact.userName,
        place: contact.place,
        voiceId: contact.voiceId,
        lat: contact.lat, lng: contact.lng,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Call failed: ' + JSON.stringify(body.results || body.error || res.status));
    return body;
  },
};
