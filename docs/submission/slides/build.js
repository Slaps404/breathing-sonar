const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const IMG='/Users/zeke/projects/breathing-sonar/docs/img/';
const uri=(f,t)=>`data:${t};base64,`+fs.readFileSync(IMG+f).toString('base64');
const png=f=>uri(f,'image/png'), svg=f=>uri(f,'image/svg+xml');
const slides=[
`<div class="row" style="gap:100px">
  <div style="flex:1">
    <h1 style="font-size:180px;margin:0 0 50px">BreathBuddy</h1>
    <p class="body" style="font-size:56px;max-width:1000px">Listens for your breathing with sound. Phones a friend if it stops.</p>
    <p class="small" style="margin-top:70px"><span class="red">breathbuddy.us</span> &nbsp;&middot;&nbsp; SanD Hacks 2026</p>
  </div>
  <img class="phone" src="${png('screen-3-breathe.png')}" style="height:860px">
</div>`,
`<div>
  <div class="red" style="font-size:300px;font-weight:700;line-height:1;letter-spacing:-6px">75.5%</div>
  <p class="body" style="font-size:60px;margin-top:30px;max-width:1660px;font-size:56px">of US overdose deaths happen with no one else present.</p>
  <p class="small" style="margin-top:20px">CDC SUDORS, 2022-2024, 191,577 deaths</p>
  <p class="body" style="margin-top:80px;max-width:1660px">An overdose slows breathing, then stops it. If nobody is there, nobody knows.</p>
</div>`,
`<div style="text-align:center;width:100%">
  <h2 style="margin:0 auto 40px;max-width:1500px">A sound you cannot hear, bounced off your chest</h2>
  <img class="card" src="${svg('how-it-works.svg')}" style="height:500px">
  <p class="body" style="margin-top:36px">Runs in the browser. No wearable, nothing to install.</p>
</div>`,
`<div style="width:100%">
  <h2 style="margin:0 0 50px">From link to phone call</h2>
  <div style="display:flex;justify-content:space-between">
  ${[['screen-3-breathe.png','Breathe with the cloud (26 s)'],['screen-4-watching.png','It watches'],['screen-5-are-you-okay.png','Breathing stops: it asks, 6 s to answer'],['screen-6-calling.png','It phones your friend']].map(([f,l])=>`
    <div style="width:380px;text-align:center"><img class="phone" src="${png(f)}" style="height:580px"><p style="font-size:38px;line-height:1.2;margin:24px 0 0">${l}</p></div>`).join('')}
  </div>
</div>`,
`<div style="width:100%">
  <h2 style="margin:0 0 50px">Does it work?</h2>
  <div class="row" style="gap:70px;align-items:center">
    <div style="width:640px;flex:none">
      <div class="big">11 of 11</div><p class="cap">breath holds caught live this morning</p>
      <div class="big" style="margin-top:50px">23 of 29</div><p class="cap">on harder recordings with movement</p>
    </div>
    <img class="card" src="${svg('detector-run.svg')}" style="width:970px">
  </div>
  <p class="small" style="margin-top:50px">One person, one laptop, quiet room. Alarm 5 to 12 seconds into the hold.</p>
</div>`,
`<div style="width:100%">
  <h2 style="margin:0 0 50px">Honest limits</h2>
  <p class="body">Detects breathing that stops. Slowing is not reliable yet.</p>
  <p class="body">Tested on one person and one laptop.</p>
  <p class="body">Prototype. Not a medical device.</p>
  <p class="body" style="margin-top:60px"><span class="red" style="font-weight:700">Next:</span> more people, more devices, phones.</p>
  <p class="small" style="margin-top:60px">Built with: Web Audio (JavaScript), Twilio, ElevenLabs, Vultr.</p>
  <p class="small" style="margin-top:14px"><span class="red">breathbuddy.us</span> &nbsp;&middot;&nbsp; github.com/Slaps404/breathing-sonar</p>
</div>`];
const css=`@page{size:1920px 1080px;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#F4EFE6}
body{font-family:Helvetica,Arial,sans-serif;color:#1A1A1A}
.slide{width:1920px;height:1080px;padding:100px 130px;display:flex;align-items:center;position:relative;overflow:hidden;page-break-after:always;break-after:page;background:#F4EFE6}
.slide:last-child{page-break-after:auto;break-after:auto}
h1,h2{font-weight:700;letter-spacing:-2px;line-height:1.05}h2{font-size:96px}
.body{font-size:48px;line-height:1.3;margin:0 0 22px}.small{font-size:34px;color:#555;margin:0}
.red{color:#8E2330}.row{display:flex;align-items:center;width:100%}
.big{font-size:150px;font-weight:700;color:#8E2330;line-height:1;letter-spacing:-3px}.cap{font-size:42px;line-height:1.25;margin:14px 0 0}
.phone{border-radius:36px;border:3px solid #1A1A1A;display:block;margin:0 auto}.card{border:2px solid #d9d1c3;border-radius:12px;display:block;margin:0 auto}
.num{position:absolute;right:60px;bottom:44px;font-size:32px;color:#8a8478}`;
const html=s=>`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${s}</body></html>`;
const all=slides.map((s,i)=>`<section class="slide">${s}<div class="num">${i+1} / 6</div></section>`);
fs.writeFileSync('deck.html',html(all.join('\n')));
(async()=>{
 const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
 const p=await b.newPage();await p.setViewport({width:1920,height:1080});
 await p.goto('file://'+path.resolve('deck.html'),{waitUntil:'load'});
 await p.pdf({path:'/Users/zeke/Desktop/BreathBuddy-slides.pdf',width:'1920px',height:'1080px',printBackground:true,preferCSSPageSize:true});
 for(let i=0;i<6;i++){fs.writeFileSync('s.html',html(all[i]));await p.goto('file://'+path.resolve('s.html'),{waitUntil:'load'});await p.screenshot({path:`slide-${i+1}.png`});}
 await b.close();
})();
