// Render text overlays/cards to 1920x1080 PNGs with headless Chrome (this ffmpeg has no drawtext).
// node render_text.js jobs.json   jobs = [{out, html, bg?}]  (bg omitted = transparent)
const fs = require('fs'), puppeteer = require('puppeteer-core');
(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  const css = `html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1d1b18}
  .sub{position:absolute;left:0;right:0;text-align:center;padding:0 150px}
  .sub.bottom{bottom:36px} .sub.top{top:36px}
  .sub span{display:inline-block;max-width:1560px;font-size:46px;line-height:1.3;font-weight:600;background:rgba(18,16,14,.78);color:#fff;padding:10px 26px;border-radius:8px;text-wrap:balance}
  .cap{position:absolute;font-size:36px;font-weight:600;background:rgba(18,16,14,.78);color:#fff;padding:8px 20px;border-radius:8px}
  .card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:86px 154px}`;
  for (const j of jobs) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body style="background:${j.bg || 'transparent'}">${j.html}</body>`);
    await page.screenshot({ path: j.out, omitBackground: !j.bg });
  }
  await browser.close(); console.log('rendered', jobs.length);
})();
