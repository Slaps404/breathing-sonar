// The two places where the onboarding UI hands off to the rest of the project.
// Both are stubs. Replace the bodies, keep the shapes, and the UI needs no changes.
//
//   UI  --startMonitoring()-->  sonar (dsp.js)   reports status, breathing stopped / resumed
//   UI  --callFriend()------->  phone call (ElevenLabs + Twilio)

window.SonarHooks = {
  // True while these are stubs. The UI shows a "simulate" link when this is true.
  // Set to false (or delete) once the real code is in.
  isStub: true,

  // HOOK 1. Called once when the person presses Start.
  // Should ask for the mic, start the sonar, and report back through the callbacks:
  //   onStatus('searching')   no steady breathing found yet
  //   onStatus('watching')    breathing found and being tracked
  //   onStatus('lost')        person moved away or signal too weak to tell
  //   onBreathingStopped()    breathing was there and has now stopped
  //   onBreathingResumed()    breathing came back (cancels a pending call)
  // Returns (a promise of) { stop() }. Throw if the mic is refused: the UI shows the message.
  async startMonitoring({ onStatus, onBreathingStopped, onBreathingResumed }) {
    console.log('[stub] startMonitoring');
    onStatus('searching');
    const t = setTimeout(() => onStatus('watching'), 2500);
    // Stub only: lets the UI's "simulate" links fire the callbacks.
    this._simulate = { stopped: onBreathingStopped, resumed: onBreathingResumed, status: onStatus };
    return {
      stop: () => { clearTimeout(t); this._simulate = null; console.log('[stub] stop monitoring'); },
    };
  },

  // HOOK 2. Called when the friend should be phoned: breathing stopped and the person
  // did not press "I'm okay" before the countdown ran out.
  //   contact = { friendName, friendPhone (E.164, e.g. "+16195550123"), userName, place }
  //   place may be an empty string.
  // Returns a promise. Reject (throw) if the call could not be placed: the UI then
  // shows the friend's number so anyone nearby can dial it.
  async callFriend(contact) {
    console.log('[stub] callFriend', contact);
    await new Promise(r => setTimeout(r, 800));
    return { ok: true, stub: true };
  },
};
