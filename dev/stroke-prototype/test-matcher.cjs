const fs=require('fs'),path=require('path');const M=require('./matcher.js');
const dir=process.argv[2];let ok=0,tot=0,wo=0,wt=0,noisyOk=0,bw=0,bt=0;const fails=[];
let seed=3;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
for(const f of fs.readdirSync(dir)){const ch=f.replace('.json','');const d=JSON.parse(fs.readFileSync(path.join(dir,f)));
 const med=d.medians.map(m=>m.map(([x,y])=>[x,900-y]));
 for(let i=0;i<med.length;i++){
  // sloppy human-ish: offset, scale, jitter, densified
  const dx=(rnd()-.5)*120,dy=(rnd()-.5)*120,sc=0.85+rnd()*0.25;
  const dense=[];for(let k=0;k<med[i].length-1;k++){for(let s=0;s<6;s++){const a=med[i][k],b=med[i][k+1];dense.push([a[0]+(b[0]-a[0])*s/6,a[1]+(b[1]-a[1])*s/6]);}}dense.push(med[i].at(-1));
  const u=dense.map(([x,y])=>[512+(x-512)*sc+dx+(rnd()-.5)*30,512+(y-512)*sc+dy+(rnd()-.5)*30]);
  tot++;const r=M.grade(u,med,i,1.15);if(r.ok)ok++;else fails.push(ch+i+':'+r.why+':'+Math.round(r.avg));
  bt++;if(!M.grade(u.slice().reverse(),med,i,1.15).ok)bw++;
  for(let j=i+1;j<med.length;j++){wt++;if(!M.grade(med[j],med,i,1.15).ok)wo++;}
 }}
console.log(`sloppy correct accepted ${ok}/${tot}; backwards rejected ${bw}/${bt}; wrong-order rejected ${wo}/${wt}`);console.log(fails.join(' '));
