const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[2]));
const R=r.rate,ne=r.emit.filter(Boolean).length,n=r.I[0].length;
console.log('dur',n/R,'s');
const mag=k=>{let s=0;for(let i=0;i<n;i++)s+=Math.hypot(r.I[k][i],r.Q[k][i]);return s/n};
for(let k=0;k<ne;k++)console.log(r.freqs[k],'mag',mag(k).toExponential(2),'SNR dB',(20*Math.log10(mag(k)/mag(k+ne))).toFixed(1));
function resid(x,w=800){const c=[0];for(const v of x)c.push(c[c.length-1]+v);return x.map((v,i)=>{const a=Math.max(0,i-w/2),b=Math.min(x.length,i+w/2);return v-(c[b]-c[a])/(b-a)})}
const res=[];for(let k=0;k<2*ne;k++)res.push([resid(r.I[k]),resid(r.Q[k])]);
const sd=(k,a,b)=>{let s=0;for(let i=a;i<b;i++)s+=res[k][0][i]**2+res[k][1][i]**2;return Math.sqrt(s/(b-a))};
console.log('window(s) | motion per tone (x1e-5) | noise refs');
for(let t=0;t+5<=n/R;t+=5){let o=String(t).padStart(3)+'-'+String(t+5).padStart(3)+' ';for(let k=0;k<2*ne;k++){if(k==ne)o+=' | ';o+=(sd(k,t*R,(t+5)*R)*1e5).toFixed(2).padStart(9)}console.log(o)}
console.log('snaps t tone bpm q alert');r.snaps.filter((_,i)=>i%25==0).forEach(s=>console.log(Math.round(s.t),s.tone,s.bpm==null?'-':Math.round(s.bpm),s.quality.toFixed(2),s.alerting));
