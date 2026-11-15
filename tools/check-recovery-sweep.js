const fs=require('fs'), Module=require('module'), path=require('path');
const root=process.cwd(), source=fs.readFileSync('dsp.js','utf8');
// -1 replays current behavior; nonnegative values require still recovery for that duration.
// Run from the repository root: node tools/check-recovery-sweep.js 0.4
const seconds=Number(process.argv[2]);
if (!Number.isFinite(seconds) || seconds < -1) throw new Error('Provide -1 (baseline) or recovery seconds >= 0');
let code=source;
if(seconds>=0) code=code.replace("} else if (moving || feat.B > base - HOLD.dropDb / 2) { st.alerting = false; st.below = 0; st.holdStart = null; return 'end'; }", `} else { st.recovery = !moving && feat.B > base - HOLD.dropDb / 2 ? (st.recovery || 0) + dt : 0; if (st.recovery >= ${seconds} && !moving && feat.B > base - HOLD.dropDb / 2) { st.alerting = false; st.recovery = 0; st.below = 0; st.holdStart = null; return 'end'; } }`);
const mod=new Module(path.join(root,'dsp.js'));mod._compile(code,path.join(root,'dsp.js'));const D=mod.exports;
const out=[];
for(const file of fs.readdirSync('data').filter(f=>/^take-.*\.wav$/.test(f))) {
const base='data/'+file.slice(0,-4), wav=fs.readFileSync(base+'.wav');
const meta=JSON.parse(fs.readFileSync(base+'.json'));
const pcm=new Int16Array(wav.buffer,wav.byteOffset+44,wav.readUInt32LE(40)/2);
const s=new D.RangeSonar();s.p=D.makeProbe({P:meta.P,f0:meta.f0,f1:meta.f1});s.chs.forEach(c=>c.lambda=s.p.lambda);
const frame=new Float64Array(meta.P),events=[];let falseSeconds=0,holdSeconds=0;
const labels=meta.labels.map((l,i)=>({...l,end:meta.labels[i+1]?.t??meta.seconds}));
for(let f=0;f<Math.floor(pcm.length/meta.P);f++) {
const t=(f+1)/s.rate;for(let i=0;i<meta.P;i++)frame[i]=pcm[f*meta.P+i]/32767;
s.ingestFrame(frame);if(f%5)continue;const res=s.analyze(t*1000),label=labels.find(l=>t>=l.t&&t<l.end)?.label;
if(res?.event)events.push({t,type:res.event,label});
if(s.alerting) {if(label==='hold')holdSeconds+=5/s.rate;else falseSeconds+=5/s.rate;}
}
const holds=labels.filter(l=>l.label==='hold');
const hits=holds.filter(h=>events.some(e=>e.type==='start'&&e.t>=h.t&&e.t<h.end+2)).length;
const premature=events.filter(e=>e.type==='end'&&labels.some(h=>h.label==='hold'&&e.t>=h.t&&e.t<h.end-1)).length;
const recoveries=holds.filter(h=>labels.find(l=>l.t===h.end)?.label==='normal').map(h=>{const end=events.find(e=>e.type==='end'&&e.t>=h.end); return end?Math.min(end.t-h.end,60):60;});
out.push({file,holds:holds.length,hits,premature,falseSeconds,holdSeconds,recoveries,events});
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(JSON.stringify({seconds,hits:out.reduce((a,r)=>a+r.hits,0),premature:out.reduce((a,r)=>a+r.premature,0),falseSeconds:out.reduce((a,r)=>a+r.falseSeconds,0),holdSeconds:out.reduce((a,r)=>a+r.holdSeconds,0),recoveries:out.flatMap(r=>r.recoveries)}));
