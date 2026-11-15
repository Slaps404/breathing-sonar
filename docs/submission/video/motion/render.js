// Render a prototype page to mp4: node render.js <page.html> <out.mp4> [fps=30]
// Needs: Google Chrome, ffmpeg, and puppeteer-core (npm i puppeteer-core in this folder or set NODE_PATH).
const { spawn } = require('child_process'), path = require('path'), puppeteer = require('puppeteer-core');
(async () => {
  const [page_, out, fps = 30] = process.argv.slice(2);
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--hide-scrollbars'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(page_)); await page.waitForFunction(() => window.DURATION > 0); const dur = await page.evaluate(() => window.DURATION), n = Math.round(dur * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < n; f++) { await page.evaluate(t => window.draw(t), f / fps); ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 95 })); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await browser.close(); console.log(out, n, 'frames', dur, 's');
})();
