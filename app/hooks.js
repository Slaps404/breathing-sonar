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
  //   onBreathingStopped()    breathing was there and has now stopped
  //   onBreathingResumed()    breathing came back (cancels a pending call)
  // Returns { stop() }. Throws if the mic is refused: the UI shows the message.
  async startMonitoring({ onStatus, onBreathingStopped, onBreathingResumed }) {
    const LOST_MS = 3000, VOLUME = 0.7;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = new AudioContext({ sampleRate: DSP.SR, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([DSP.PROBE_WORKLET], { type: 'application/javascript' })));
    const sonar = new DSP.RangeSonar();
    const node = new AudioWorkletNode(ctx, 'probe', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { signal: sonar.p.sig, amp: VOLUME } });
    node.port.onmessage = e => sonar.ingestFrame(e.data);
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination);

    let status = null, movingSince = null;
    const setStatus = s => { if (s !== status) { status = s; onStatus(s); } };
    setStatus('searching');
    const timer = setInterval(() => {
      const now = performance.now();
      const res = sonar.analyze(now);
      if (res && res.event === 'start') onBreathingStopped();
      if (res && res.event === 'end') onBreathingResumed();
      movingSince = sonar.apnea.moving === true ? (movingSince ?? now) : null;
      if (movingSince !== null && now - movingSince > LOST_MS) setStatus('lost');
      else if (res) setStatus('watching');
      else if (status !== 'watching') setStatus('searching');
    }, 200);

    return {
      stop() {
        clearInterval(timer);
        node.disconnect();
        stream.getTracks().forEach(t => t.stop());
        ctx.close();
      },
    };
  },

  // HOOK 2. Called when the friend should be phoned: breathing stopped and the person
  // did not press "I'm okay" before the countdown ran out.
  //   contact = { friendName, friendPhone (E.164, e.g. "+16195550123"), userName, place }
  //   place may be an empty string.
  // Returns a promise. Reject (throw) if the call could not be placed: the UI then
  // shows the friend's number so anyone nearby can dial it.
  // Real: call/server.py (run `python3 call/server.py`) has ElevenLabs ring the friend through Twilio.
  // The server takes a list of friends and rings them all at once; the UI has one friend for now.
  async callFriend(contact) {
    const res = await fetch('http://127.0.0.1:8788/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friends: [{ name: contact.friendName, phone: contact.friendPhone }],
        userName: contact.userName,
        place: contact.place,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Call failed: ' + JSON.stringify(body.results || body.error || res.status));
    return body;
  },
};
