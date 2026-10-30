// Snap each target colour to the nearest real pixel of a source asset; emit src/tokens.json with provenance.
import fs from 'node:fs';
import jpeg from 'jpeg-js';
const load=f=>{const j=jpeg.decode(fs.readFileSync(f),{useTArray:true});return j;};
const S={
 cover:load('reference/SAMPUL POLYFORM JPG.jpg.jpeg'),
 scene:load('reference/POLYFORM 1.jpg.jpeg'),
 mark:load('brand/LOGO POLYFORM JPG.jpg.jpeg'),
};
const snap=(src,t)=>{const j=S[src];let best=1e18,bx=0,by=0;
 for(let y=0;y<j.height;y++)for(let x=0;x<j.width;x++){const i=(y*j.width+x)*4;const d=(j.data[i]-t[0])**2+(j.data[i+1]-t[1])**2+(j.data[i+2]-t[2])**2;if(d<best){best=d;bx=x;by=y;}}
 const i=(by*j.width+bx)*4;return {hex:'#'+[0,1,2].map(k=>j.data[i+k].toString(16).padStart(2,'0')).join(''),x:bx,y:by,src};};
// targets are k-means centres / dominant bins measured in tools/analyze.mjs
const T={
 bg:['scene',[1,6,28]], surface:['cover',[0,16,64]], card:['cover',[0,28,83]], cardHover:['cover',[0,32,104]],
 border:['cover',[0,32,96]], borderStrong:['cover',[1,47,134]], navy:['mark',[2,40,103]],
 accentDeep:['cover',[2,84,201]], accent:['scene',[26,137,244]], accentBright:['cover',[146,220,251]],
 text:['mark',[253,253,253]], muted:['mark',[201,207,219]], faint:['mark',[120,137,166]],
};
const out={};for(const[k,[s,t]]of Object.entries(T))out[k]=snap(s,t);
fs.writeFileSync('src/tokens.json',JSON.stringify(out,null,1));console.log(out);
