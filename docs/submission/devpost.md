# Breathing Sonar

A browser tab that watches your breathing with sound, and phones a friend if it stops or gets too slow.

## Inspiration

Many people who die of an opioid overdose are alone when it happens. An overdose slows breathing and then stops it. If someone is there, they can give naloxone or call 911. If no one is there, no one knows.

We wanted something a person could turn on in a few seconds, with what they already have: a laptop. No wearable, no app store, no account.

Prior work: a University of Washington team built "Second Chance" (2019), a phone app that used sonar to spot breathing stops from opioid overdose. We build on that idea. Our version runs in a browser tab with no install, finds the person's distance by itself, and phones a friend with an AI voice instead of only sounding an alarm.

## What it does

1. You enter a friend's name and phone number, your name, and where you are. These stay in your browser.
2. You sit a forearm's length (30-40 cm) in front of the laptop and press Start.
3. The laptop speaker plays a high-pitched probe sound (18-20 kHz) and the mic listens to the echo.
4. The page finds your chest in the echo and watches it move as you breathe. A live line on the screen shows your chest moving.
5. If your breathing stops, or stays too slow for most of 30 seconds, the screen says "Are you okay?", beeps, and counts down 6 seconds. Tap anywhere or press any key to cancel.
6. If no one taps, a voice agent phones your friend. It says your breathing seems to have stopped (the same words for a slow-breathing alarm), where you are, and to call 911 if they cannot reach you. The friend can ask it questions.

A "Show the sonar" button (or the s key) opens a live view of what the sonar sees: echo motion by distance with your chest boxed, how much each distance repeats like a breath, a large breathing line, and how close each alarm is to going off. It stays up through the alarm, so you can watch the moment it decides.

If the call fails, the screen shows the friend's number in large text so anyone nearby can dial it. If you have no one to call, the first screen points to Never Use Alone (877-696-1996), a hotline that stays on the phone with you.

## How we built it

**Sonar in the browser.** An AudioWorklet (Web Audio code that runs on the audio thread) loops a 42.7 ms probe made of every frequency from 18 to 20 kHz. Speaker and mic share one clock, so each mic frame lines up with the probe. Dividing the echo's spectrum by the probe's spectrum gives the echo at each delay. Delay is distance, so each frame becomes a row of distance slices, about 5.72 cm apart.

**Breathing in a slice.** Each slice is a complex number (strength and phase) over time. Breathing moves the chest a few millimeters, which turns the phase back and forth. We measure how much each slice moves at breathing speed (0.15-0.6 Hz, about 9-36 breaths per minute) over the last 8 seconds.

**Finding the chest without asking.** The first version picked the slice with the most slow motion. On real recordings it picked 91-142 cm, but the chest was at 28-40 cm. Slow drift and fidgeting also have slow motion. What they do not have is repetition. So each second we score every slice from 20 to 120 cm by how well its signal matches itself one breath later (autocorrelation at 1.6-6.7 s lags). That picked 28-40 cm on the same recording. The watched zone is that slice plus the slices just behind it, where the chest's echo bounces off the desk.

**Deciding breathing stopped.** We compare breathing-speed motion now with the same person's level over their last minute of sitting still. If it drops to a quarter (6 dB) for 2 seconds while the person is not moving, that is a stop. Fast motion near the laptop marks "moving", which blocks alerts and is left out of the baseline.

**Deciding breathing is too slow.** An overdose usually slows breathing before it stops. A second check runs on the chest slice: each moment the person is still counts as "slow" if the breathing rate is under 8.5 breaths per minute, or if there is no clear rhythm at all (below about 5 per minute the rate cannot be read). If 80% of the last 30 seconds was slow, it raises the same alarm as a stop. Moments of moving count as not slow. On simulated signals, true rates of 6, 8, 10 and 15 per minute read as 6.0, 7.8, 10.2 and 15.0.

**Showing the work.** The sonar sends a snapshot of its state about 5 times a second. The "Show the sonar" view only draws these snapshots. It decides nothing, so what it shows is what the alarm acts on.

**Calling a friend.** `call/server.py` is a small local server using only the Python standard library. On first run it registers our Twilio number with ElevenLabs and creates a voice agent. When the page posts to `/call`, it starts an ElevenLabs outbound call through Twilio to every friend at once, filling in names and place for that call.

**Testing on real takes.** A Mac menu bar recorder plays the same probe, saves raw mic audio, and lets us label each stretch (normal, hold, moving). A replay tool runs a saved take through the exact `dsp.js` the browser runs and scores it. The app records too: every run saves a .wav and .json on Stop, in the same format, and a "Mark: I'm holding my breath" button (or the h key) saves when you hold, so any demo run can be replayed and scored. A simulator tests made-up scenes (people walking behind, fidgeting, street noise).

## Challenges we ran into

- **Our first chest picker failed on real data.** It looked for a clean circle in each slice's signal. Real chests never make one, so it locked onto the laptop edge. The periodicity score above replaced it.
- **The probe was audible.** At full volume 18-20 kHz was uncomfortable to sit next to. The recorder moved to a quieter 20-22 kHz probe, which the MacBook mic still picked up clearly.
- **Moving looks like breathing changes.** Shifting in your seat changes the echo a lot. We made movement block alerts, but movement still causes false alarms. That is why there is a countdown before any call.
- **Audio dropouts.** Some recordings had gaps from a small audio buffer. We made the buffer larger and added a dropout warning.
- **The speaker drowns out the first 20 cm.** The sound going straight from speaker to mic is far louder than any echo, so we only look at 20 cm and beyond.

## Accomplishments that we're proud of

Results from replaying two labeled recordings through the live detector (`node tools/replay-take.js`), one person at a MacBook, breath holds of 20 seconds:

| Take | Holds caught | False alarms | Time to alert |
|---|---|---|---|
| Sitting still, 5 holds | 5 of 5 | 0 | 6.8-8.2 s (4 holds); 15.8 s (1 hold, caught by the slow-breathing alarm) |
| Moving between holds, 5 holds | 3 of 5 | 2 | 5.9-14.7 s |
| Sitting still, 3 holds (second session) | 1 of 3 | 0 | 16.0 s |
| Free-form, mostly moving, 3 holds | 1 of 3 | 12 | 6.9 s |
| Walked away, empty room | no holds | 1 | n/a |
| Normal breathing only, 100 s | no holds | 2 | n/a |

Total: 10 of 16 holds caught, 17 false alarms, across all 6 recordings we have (one person, one MacBook). Sitting still works best. Movement is the main source of false alarms, and the 6 s countdown is there for that reason. Before the slow-breathing alarm, the first take was 4 of 5; it now catches the fifth hold through that alarm. The rate it reads is not reliable yet: in the second session it read 6-9 breaths per minute during normal breathing.

Other things we are proud of:
- The whole sonar runs in a browser tab. No install, and no audio leaves the device.
- It finds the chest's distance on its own.
- You can see what it sees. The live sonar view shows the chest it picked and why the alarm fires.
- The full chain works end to end: a held breath on a laptop ends with a real phone ringing and a voice explaining why.

## What we learned

- A laptop speaker and mic can measure millimeter chest motion at arm's length.
- The obvious feature (slow motion power) picks the wrong thing. The right feature was "does it repeat like a breath".
- Testing on recorded, labeled takes beat tuning by feel. The replay tool runs the same code as the page, so a change shows up as a number.
- The hard part is not seeing a stop. It is not raising alarms when someone just moves.

## What's next

- **Test the slow-breathing alarm on real slow breathing.** We tested with full breath holds, because holding your breath is a safe stand-in for an overdose. A real overdose often starts with slow, shallow breathing before it stops. The slow-breathing alarm is built, but so far it is checked only on simulated signals, not on real slow-breathing recordings. Our recorder already has a slow-breathing test step. Shallow breathing at a normal rate only sets off the alarm if it drops to the stop level (a quarter of normal).
- **Fewer false alarms from movement.** Record more takes with people moving, slumping, and walking away, and tune on those. Our recorder already has those test steps.
- **Quieter probe in the app.** Move the browser app to the 20-22 kHz probe the recorder uses.
- **More people and laptops.** Every number above is from one person and one laptop. We built a recorder kit so friends can record takes on their own Macs.
- **Phones.** The page already adjusts its wording for phones. Phone speakers and mics need testing.

This is a prototype, not a medical device. It can miss a stop, and it only works while you stay in front of the laptop.

## Built with

- JavaScript, Web Audio API (AudioWorklet), HTML, CSS
- Python (standard library server; numpy, sounddevice, rumps for the recorder)
- ElevenLabs Conversational AI (voice agent, outbound calls)
- Twilio (phone number)
- Node.js (replay and simulation tools)
