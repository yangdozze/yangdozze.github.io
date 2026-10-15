/*
 * Scalable HUD for the authentic METHOD Caustic tracker state.
 * Detection, IDs, persistence and coordinates are owned solely by CAUSTIC.Ref.
 * Styling retains the original five earth-tone inks and X###Y### captions.
 * Unlike the original 540px raster, captions are composed at export resolution
 * to remain readable on phone-sized previews without fabricating targets.
 */
const PAL=[
 {ink:[214,104,28],fill:'#ffdeb8',back:[44,22,6]},
 {ink:[240,236,228],fill:'#f0ece4',back:[30,26,22]},
 {ink:[196,32,26],fill:'#ffcec6',back:[40,10,8]},
 {ink:[156,176,132],fill:'#d6e4c4',back:[26,34,22]},
 {ink:[138,152,166],fill:'#dce4ec',back:[22,28,34]}
];
const rgba=(a,t=1)=>'rgba('+a[0]+','+a[1]+','+a[2]+','+t+')';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export function drawMethodTrackerHUD(ctx,w,h,tracker){
 if(!tracker?.tracks?.length)return 0;
 const tracks=tracker.tracks.filter(t=>t.hit||t.age>=1).slice(0,10);
 if(!tracks.length)return 0;
 const sx=w/tracker.GW,sy=h/tracker.GH;
 const font=clamp(Math.round(w*.033),16,37);
 const pad=clamp(Math.round(w*.012),7,18);
 const line=clamp(w*.002,1.2,3.2);
 const used=[];
 ctx.save();ctx.font='600 '+font+'px "IBM Plex Mono","Menlo","Consolas",monospace';
 ctx.textBaseline='middle';
 const boxW=Math.ceil(ctx.measureText('X000Y000').width+pad*2);
 const boxH=Math.ceil(font*1.48);
 const tcol=t=>PAL[t.pal%PAL.length]||PAL[0];
 if(tracks.length>1){
   const linked=new Set();
   for(const t of tracks){
     let closest=null,best=Infinity;
     for(const b of tracks){if(b===t)continue;const d=Math.hypot(t.x-b.x,t.y-b.y);if(d<best){best=d;closest=b;}}
     if(!closest)continue;
     const key=[t.id,closest.id].sort((a,b)=>a-b).join('-');if(linked.has(key))continue;linked.add(key);
     const col=tcol(t).ink;ctx.beginPath();ctx.moveTo(t.x*sx,t.y*sy);ctx.lineTo(closest.x*sx,closest.y*sy);
     ctx.lineWidth=line+3;ctx.strokeStyle='rgba(0,0,0,.8)';ctx.stroke();
     ctx.lineWidth=line;ctx.strokeStyle=rgba(col,.85);ctx.stroke();
   }
 }
 for(const t of tracks){
   const c=tcol(t),x=t.x*sx,y=t.y*sy;
   let bx=clamp(x+(t.dx>0?16:-boxW-16),pad,Math.max(pad,w-boxW-pad));
   let by=clamp(y+(t.dy>0?16:-boxH-16),pad,Math.max(pad,h-boxH-pad));
   for(let k=0;k<6;k++){
     if(!used.some(r=>bx<r.x+r.w+4&&bx+boxW+4>r.x&&by<r.y+r.h+4&&by+boxH+4>r.y))break;
     by=clamp(by+boxH+6,pad,Math.max(pad,h-boxH-pad));
   }
   used.push({x:bx,y:by,w:boxW,h:boxH});
   ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(clamp(bx+boxW/2,0,w),clamp(by+boxH/2,0,h));
   ctx.strokeStyle='#050607';ctx.lineWidth=line+3;ctx.stroke();
   ctx.strokeStyle=rgba(c.ink,.94);ctx.lineWidth=line;ctx.stroke();
   const m=Math.max(8,w*.014);
   ctx.beginPath();ctx.moveTo(x-m,y);ctx.lineTo(x+m,y);ctx.moveTo(x,y-m);ctx.lineTo(x,y+m);
   ctx.strokeStyle='#000';ctx.lineWidth=line+4;ctx.stroke();
   ctx.strokeStyle=rgba(c.ink,1);ctx.lineWidth=line+1;ctx.stroke();
   ctx.fillStyle='rgba(9,10,12,.93)';ctx.fillRect(bx,by,boxW,boxH);
   ctx.fillStyle=rgba(c.back,.45);ctx.fillRect(bx,by,boxW,boxH);
   ctx.strokeStyle=rgba(c.ink,1);ctx.lineWidth=Math.max(1.5,line*.8);
   ctx.strokeRect(bx+.75,by+.75,boxW-1.5,boxH-1.5);
   ctx.fillStyle=c.fill;
   ctx.fillText('X'+String(Math.round(t.x)).padStart(3,'0')+'Y'+String(Math.round(t.y)).padStart(3,'0'),bx+pad,by+boxH/2+.5);
 }
 ctx.restore();
 return tracks.length;
}