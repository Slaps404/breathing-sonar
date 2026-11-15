# Video prototypes

Three short silent clips (1280x720, 30 fps) in different styles, to pick a direction for the 3-minute video.
Each is one HTML page that draws frame `t` on a canvas. Open the page in a browser to watch it loop.

| Clip | Style | Use |
|---|---|---|
| `a-how-it-works.mp4` (16 s) | line diagram on dark | the "how it works" part |
| `b-why.mp4` (15.5 s) | big type on cream | the opening: the problem in one number |
| `c-real-recording.mp4` (14.5 s) | chart of a real take | proof: the detector's own level and alarm on take `02-54-00` |

Render: `npm i puppeteer-core` here, then `node render.js a-how-it-works.html a-how-it-works.mp4` (needs Chrome and ffmpeg).
Clip C's data: `take-data.js`, written from the recording by the live `dsp.js`. Nothing in it is drawn by hand.
Number in clip B: 75.5% (CDC SUDORS 2022-2024, n = 191,577), see `sandhacks/research/reports/08_vitals_need.md` line 31.
