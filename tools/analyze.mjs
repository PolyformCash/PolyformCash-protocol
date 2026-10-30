import fs from 'node:fs';
import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';
const f=process.argv[2];
const b=fs.readFileSync(f);
let w,h,d,info='';
if(b[0]===0x89){const ihdr=b.subarray(16,29);info=`IHDR w=${ihdr.readUInt32BE(0)} h=${ihdr.readUInt32BE(4)} bitdepth=${ihdr[8]} colortype=${ihdr[9]} interlace=${ihdr[12]}`;const p=PNG.sync.read(b);w=p.width;h=p.height;d=p.data;}
else{const j=jpeg.decode(b,{useTArray:true});w=j.width;h=j.height;d=j.data;info='JPEG';}
console.log(f,info,w+'x'+h);
const ah=new Array(8).fill(0);let blackT=0;const cnt=new Map();
for(let i=0;i<d.length;i+=4){const a=d[i+3];ah[a>>5]++;if(a===0&&d[i]+d[i+1]+d[i+2]===0)blackT++;
 if(a>0){const k=(d[i]>>3<<10)|(d[i+1]>>3<<5)|(d[i+2]>>3);cnt.set(k,(cnt.get(k)||0)+1);}}
console.log('alpha hist(8 bins)',ah.join(','),'pure-black transparent px',blackT);
const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n])=>`rgb(${(k>>10)<<3},${((k>>5)&31)<<3},${(k&31)<<3}) x${n}`);
console.log('dominant',top.join(' | '));
// kmeans k=5 on opaque px sample
const pts=[];for(let i=0;i<d.length;i+=4*37){if(d[i+3]>8)pts.push([d[i],d[i+1],d[i+2],i/4]);}
let cs=[];for(let k=0;k<5;k++)cs.push(pts[Math.floor(k*pts.length/5)].slice(0,3));
for(let it=0;it<25;it++){const s=cs.map(()=>[0,0,0,0]);for(const p of pts){let bi=0,bd=1e9;cs.forEach((c,i)=>{const dd=(c[0]-p[0])**2+(c[1]-p[1])**2+(c[2]-p[2])**2;if(dd<bd){bd=dd;bi=i}});s[bi][0]+=p[0];s[bi][1]+=p[1];s[bi][2]+=p[2];s[bi][3]++;}
 cs=s.map((v,i)=>v[3]?[v[0]/v[3],v[1]/v[3],v[2]/v[3]]:cs[i]);}
for(const c of cs){let bp=pts[0],bd=1e9;for(const p of pts){const dd=(c[0]-p[0])**2+(c[1]-p[1])**2+(c[2]-p[2])**2;if(dd<bd){bd=dd;bp=p}}
 const px=bp[3];console.log(`kmeans centre ~(${c.map(Math.round)}) snapped -> #${[bp[0],bp[1],bp[2]].map(v=>v.toString(16).padStart(2,'0')).join('')} at x=${px%w},y=${Math.floor(px/w)}`);}
