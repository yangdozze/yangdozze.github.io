// Two original visualizer scenes informed by frame-by-frame study of reference
// videos strip.mp4 and rage-night.mp4. Real MIDI events only; no ornamental notes.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(v,c)=>((v%c)+c)%c;
const formatTime=t=>`${Math.floor(Math.max(0,t)/60)}:${Math.floor(Math.max(0,t)%60).toString().padStart(2,'0')}`;
const colors=['#9870d6','#45ab98','#d7a271','#8997d4','#d0a2cf','#94ab6b'];
const rgba=(hex,a)=>{let s=/^#[\da-f]{6}$/i.test(hex)?hex:'#9571d8';return `rgba(${parseInt(s.slice(1,3),16)},${parseInt(s.slice(3,5),16)},${parseInt(s.slice(5,7),16)},${clamp(a,0,1)})`;};
const rr=(c,x,y,w,h,r)=>{if(w>0&&h>0){c.beginPath();c.roundRect(x,y,w,h,Math.min(r,w/2,h/2));}};
const txt=(c,s,x,y,size=16,color='#fff',align='left',weight='400')=>{c.fillStyle=color;c.font=`${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);};
// Keep a large legible label while preventing long uploaded file names from overlapping other UI.
const fitted=(c,s,x,y,size,maxWidth,color,align='left',weight='500')=>{
 c.save();c.font=`${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
 let str=String(s||''),avail=Math.max(15,maxWidth),width=c.measureText(str).width;
 if(width>avail){while(str.length>1&&c.measureText(str+'…').width>avail)str=str.slice(0,-1);str+='…';}
 txt(c,str,x,y,size,color,align,weight);c.restore();
};
function timeline(t,s,data){const cycle=Math.max(.25,Number(s.midiLoop)||Number(data.midiDuration)||16),local=t-(Number(s.offset)||0);return {local,cycle,looping:s.loopMidi!==false,enabled:local>=0&&(s.loopMidi!==false||local<=cycle)};}
// Actual pitch range, with no cropped/hid notes at any point of the cycle.
export function pitchExtent(notes){if(!notes?.length)return {low:48,high:72};let lo=127,hi=0;for(const n of notes){lo=Math.min(lo,n.pitch);hi=Math.max(hi,n.pitch);}return {low:Math.max(0,lo-1),high:Math.min(127,hi+1)};}
export function pitchToY(pitch,area,ext){return area.y+area.h-((pitch-ext.low+.5)/(ext.high-ext.low+1))*area.h;}
// Pitch folding removes only *unused* semitone rows. Every distinct pitch
// stays separately positioned, in ascending order, so dense MIDIs remain legible.
export function compactPitchLayout(notes,area){
 const pitches=[...new Set(notes.map(n=>n.pitch))].sort((a,b)=>a-b);
 if(!pitches.length)return {ys:new Map(),rowHeight:area.h/24,distinct:0};
 const positions=[0];let units=0;
 for(let i=1;i<pitches.length;i++){
  const diff=pitches[i]-pitches[i-1];units+=1+Math.min(.65,Math.max(0,diff-1)*.11);
  positions.push(units);
 }
 const unitH=area.h/(units+2),ys=new Map();
 for(let i=0;i<pitches.length;i++)ys.set(pitches[i],area.y+area.h-(1+positions[i])*unitH);
 return {ys,rowHeight:unitH,distinct:pitches.length};
}
// The time mapping is constant across all parts of both scenes.
export function noteToX(start,t,lineX,pxSecond){return lineX+(start-t)*pxSecond;}
// Frame-independent, data-only active state. A note never plays before its onset.
export function soundingNotes(notes,local,cycle,looping){if(local<0)return [];return notes.filter(n=>{if(!looping)return local>=n.start&&local<n.end;const d=Math.max(.015,n.end-n.start);return local>=n.start&&wrap(local-n.start,cycle)<d;});}
function noteInstances(notes,state,before,after,cb){
 const {local,cycle,looping}=state;
 for(const note of notes){let d=Math.max(.015,note.end-note.start),first=looping?Math.max(0,Math.floor((local-before-note.start-d)/cycle)-1):0,last=looping?Math.max(first,Math.ceil((local+after-note.start)/cycle)):0;
  for(let k=first;k<=Math.min(last,first+64);k++){let st=note.start+k*cycle,en=st+d;if(en<local-before||st>local+after)continue;cb(note,st,en,st<=local&&local<en&&state.enabled);}}
}
function subtleBloom(ctx,x,y,r,col,alpha=.12){let g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,rgba(col,alpha));g.addColorStop(1,rgba(col,0));ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
function layerMap(notes){const ids=[...new Set(notes.map(n=>n.track))].sort((a,b)=>a-b);return new Map(ids.map((id,i)=>[id,i]));}
function useSafeDimensions(w,h){return {left:w*.075,right:w*.925,top:h*.078,bottom:h*.91};}
function drawMIDI(ctx,notes,t,s,data,area,options){
 const ts=timeline(t,s,data),{low,high}=pitchExtent(notes),px=area.pxSecond,after=(area.x+area.w-area.playhead)/px,before=(area.playhead-area.x)/px;
 const compact=compactPitchLayout(notes,area),total=compact.distinct||24,step=compact.rowHeight,map=layerMap(notes),palette=options.palette||colors;
 let hits=0,activeVisible=0;
 ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
 if(options.grid){
  for(const y of compact.ys.values()){ctx.strokeStyle=options.grid;ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(area.x,y+step*.51);ctx.lineTo(area.x+area.w,y+step*.51);ctx.stroke();}
  const beat=60/(Number(s.bpm)||120);
  for(let k=Math.floor((ts.local-before)/beat);k<=Math.ceil((ts.local+after)/beat);k++){
   let x=noteToX(k*beat,ts.local,area.playhead,px);ctx.strokeStyle=k%4===0?options.measure:'rgba(140,120,155,.045)';ctx.lineWidth=k%4===0?1.2:.65;ctx.beginPath();ctx.moveTo(x,area.y);ctx.lineTo(x,area.y+area.h);ctx.stroke();
  }
 }
 noteInstances(notes,ts,before,after,(note,start,end,active)=>{
  const x=noteToX(start,ts.local,area.playhead,px),width=Math.max(3,(end-start)*px),y=compact.ys.get(note.pitch);
  const ht=clamp(step*.74,options.minNote||4,options.maxNote||24);
  const color=palette[(map.get(note.track)||0)%palette.length];
  ctx.save();
  ctx.globalAlpha=active?1:start<ts.local?.70:.96;
  if(options.outline){
   rr(ctx,x,y-ht/2,width,ht,ht*.35);ctx.lineWidth=active?Math.max(2.8,ht*.12):Math.max(1.8,ht*.075);ctx.strokeStyle=active?'#623e8b':color;ctx.stroke();
   ctx.fillStyle=active?rgba(color,.83):rgba(color,.22);ctx.fill();
  }else{
   ctx.fillStyle=active?'#f6cfff':color;
   if(active){ctx.shadowBlur=Math.max(options.glow||13,12);ctx.shadowColor=color;}else{ctx.shadowBlur=3;ctx.shadowColor=color;}
   rr(ctx,x,y-ht/2,width,ht,ht*.20);ctx.fill();
  }
  ctx.restore();
  if(active){activeVisible++;const age=ts.local-start;
   if(age>=0&&age<.16){hits++;
    const k=1-age/.16,rad=(options.hitSize||15)*k;
    ctx.save();ctx.globalAlpha=k*.5;ctx.strokeStyle=color;ctx.lineWidth=Math.max(1,2*k);ctx.beginPath();ctx.arc(area.playhead,y,Math.max(2,rad),0,Math.PI*2);ctx.stroke();ctx.restore();
   }
  }
 });
 ctx.restore();
 // Fixed Akira-like playhead; all geometry scrolls beneath it.
 ctx.save();ctx.strokeStyle=options.playheadColor;ctx.lineWidth=options.playheadWidth||2;ctx.shadowBlur=options.playheadGlow||0;ctx.shadowColor=options.playheadColor;
 ctx.beginPath();ctx.moveTo(area.playhead,area.y);ctx.lineTo(area.playhead,area.y+area.h);ctx.stroke();ctx.restore();
 return {hits,activeVisible,total,low,high};
}
export function renderStrip(ctx,w,h,t,s,data={},thumb=false){
 if(w>h){ctx.fillStyle=s.background||'#faf9f4';ctx.fillRect(0,0,w,h);const narrow=h*9/16;ctx.save();ctx.translate((w-narrow)/2,0);renderStrip(ctx,narrow,h,t,s,data,thumb);ctx.restore();return;}
 const {left,right}=useSafeDimensions(w,h),notes=data.notes||[],n=notes.length;
 ctx.fillStyle=s.background||'#faf9f4';ctx.fillRect(0,0,w,h);
 // Unchanging atmospheric paper glows, no invented audio animation.
 let warm=ctx.createRadialGradient(w*.82,h*.40,0,w*.82,h*.40,w*.87);warm.addColorStop(0,'rgba(245,193,141,.21)');warm.addColorStop(1,'rgba(245,193,141,0)');ctx.fillStyle=warm;ctx.fillRect(0,0,w,h);
 let lavender=ctx.createRadialGradient(w*.12,h*.77,0,w*.12,h*.77,w*.75);lavender.addColorStop(0,'rgba(169,138,234,.23)');lavender.addColorStop(1,'rgba(169,138,234,0)');ctx.fillStyle=lavender;ctx.fillRect(0,0,w,h);
 const title=String(s.title||'YOUR BEAT').toUpperCase(),artist=String(s.artist||'YANGDOZZE').toUpperCase();
 if(s.labels!==false){
  fitted(ctx,title,left,h*.078,Math.max(26,w*.062),w*.59,'#25212b','left','600');
  fitted(ctx,artist,left,h*.117,Math.max(22,w*.034),w*.63,'#53475d','left','500');
 }
 const displayDuration=Number(data.audioDuration)||Number(s.midiLoop)||Number(data.midiDuration)||0;
 fitted(ctx,`${formatTime(t)} / ${formatTime(displayDuration)}`,right,h*.074,Math.max(17,w*.030),w*.33,'#27202c','right','600');
 // The metadata sits on a shared baseline, inside the safe zone; never at the crop edge.
 fitted(ctx,`${Math.round(s.bpm||120)} BPM  ·  ${String(s.key||'—').toUpperCase()}`,left,h*.934,Math.max(18,w*.026),w*.60,'#342b3c','left','600');
 let tr=[...new Set(notes.map(a=>a.track))];
 tr.slice(0,4).forEach((id,i)=>{const xx=left+i*w*.20,yy=h*.161;ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(xx,yy,Math.max(3.2,w*.005),0,Math.PI*2);ctx.fill();txt(ctx,`TRACK ${i+1}`,xx+w*.014,yy+5,Math.max(20,w*.027),'#483956','left','600');});
 const area={x:0,y:h*.203,w:w,h:h*.652,playhead:w*.35,pxSecond:w/(2.55+(clamp(Number(s.noteFocus)||15,12,36)-12)/24*4.3)};
 // Tiny horizontal paper guides only; never a full 'DAW editor' box.
 const out=drawMIDI(ctx,notes,t,s,data,area,{outline:true,palette:[s.accent||'#8051bc','#337e71','#9b598a','#496a9a'],playheadColor:'#201e22',playheadWidth:Math.max(1.5,w*.002),minNote:Math.max(4,w*.006),maxNote:w*.038,hitSize:w*.025});
 if(out.hits>0)subtleBloom(ctx,area.playhead,h*.53,w*.08,'#9870d6',.09);
 // Audio-driven modulation is read from preanalysed PCM at time t. It never
 // creates decorative MIDI notes or shifts the MIDI playhead out of sync.
 const pulse=data.audioFeatures,react=clamp(Number(s.react)||1,.1,3);
 if(pulse&&Number(data.audioDuration)>0){
  const amp=clamp((pulse.kick*.48+pulse.snare*.25+pulse.onset*.27)*react,0,1);
  if(amp>.045)subtleBloom(ctx,area.playhead,h*.58,w*(.04+.13*amp),'#9870d6',.045+.12*amp);
 }
 ctx.fillStyle='#242126';ctx.beginPath();ctx.moveTo(area.playhead-6,area.y);ctx.lineTo(area.playhead+6,area.y);ctx.lineTo(area.playhead,area.y+8);ctx.closePath();ctx.fill();
 if(!n)fitted(ctx,'ЗАГРУЗИ MIDI',w*.5,h*.53,Math.max(21,w*.033),w*.60,'#796783','center','600');
 fitted(ctx,`${n} NOTES  ·  ${tr.length} TRACK${tr.length===1?'':'S'}`,right,h*.934,Math.max(20,w*.026),w*.47,'#51415f','right','600');
}
function panel(ctx,x,y,w,h){ctx.fillStyle='#211e29';rr(ctx,x,y,w,h,Math.min(17,w*.02));ctx.fill();ctx.strokeStyle='rgba(194,164,226,.14)';ctx.lineWidth=1.3;ctx.stroke();}
function topWindow(ctx,x,y,w,h,title){ctx.fillStyle='#282530';rr(ctx,x+1,y+1,w-2,Math.min(h*.13,w*.091),Math.min(13,w*.02));ctx.fill();const rradii=w*.008;['#f36b61','#eac05b','#58bd74'].forEach((c,i)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(x+w*.040+i*w*.030,y+Math.min(h*.065,w*.044),rradii,0,Math.PI*2);ctx.fill();});txt(ctx,title,x+w*.14,y+Math.min(h*.075,w*.052),Math.max(21,w*.030),'#e2d0eb');}
function audioWave(ctx,rect,t,data){
 let {x,y,w,h}=rect;
 ctx.save();ctx.fillStyle='#15131d';rr(ctx,x,y,w,h,Math.min(12,w*.02));ctx.fill();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
 let dur=Number(data.audioDuration)||0,peaks=data.audioPeaks||[];
 if(dur>0&&peaks.length){
  const now=data.audioLoop?wrap(t,dur):clamp(t,0,dur);
  for(let i=0;i<Math.round(w/2);i++){
   let frac=i/Math.round(w/2),p=peaks[Math.min(peaks.length-1,Math.floor(frac*peaks.length))];
   let amp=Math.max(Math.abs(p.leftMin),Math.abs(p.leftMax),Math.abs(p.rightMin),Math.abs(p.rightMax));
   let xx=x+frac*w,H=Math.max(1,amp*h*.445);
   ctx.fillStyle=frac<=now/dur?'#a879de':'#5a4b70';ctx.globalAlpha=frac<=now/dur?.95:.70;
   ctx.fillRect(xx,y+h*.5-H,Math.max(1.3,w/370),2*H);
  }
  const play=x+w*now/dur;
  // Small, measured audio response: real kick/snare/hat bands, no fake waveform.
  const F=data.audioFeatures||{},react=clamp(Number(data.audioReact)||1,.1,3);
  const bars=[F.bass||0,F.mid||0,F.high||0];
  for(let bi=0;bi<3;bi++){
   let v=clamp(bars[bi]*react,0,1),bw=Math.max(3,w*.014),bx=x+w*.022+bi*bw*1.45;
   ctx.fillStyle=['#c08cfa','#ad72d6','#e7b7ff'][bi];ctx.globalAlpha=.65+.35*v;
   ctx.fillRect(bx,y+h*.93-Math.max(3,v*h*.17),bw,Math.max(3,v*h*.17));
  }
  const strike=clamp(((F.kick||0)*.65+(F.snare||0)*.45+(F.onset||0)*.28)*react,0,1);
  if(strike>.05)subtleBloom(ctx,play,y+h*.5,Math.min(w*.18,h*(.22+strike*.42)),'#b788f5',.05+strike*.22);
  ctx.globalAlpha=1;ctx.strokeStyle='#f1d3ff';ctx.lineWidth=Math.max(1.6,w*.002+strike*1.4);ctx.beginPath();ctx.moveTo(play,y);ctx.lineTo(play,y+h);ctx.stroke();ctx.fillStyle='#edd2ff';ctx.beginPath();ctx.arc(play,y,Math.max(3,w*.004),0,2*Math.PI);ctx.fill();
 }else{
  ctx.globalAlpha=.55;txt(ctx,'NO AUDIO — ADD WAV / MP3',x+w*.5,y+h*.55,Math.max(11,w*.015),'#9f90ae','center');
 }
 ctx.restore();
}
export function renderNight(ctx,w,h,t,s,data={},thumb=false){
 if(w>h){ctx.fillStyle=s.background||'#0d0d13';ctx.fillRect(0,0,w,h);const narrow=h*9/16;ctx.save();ctx.translate((w-narrow)/2,0);renderNight(ctx,narrow,h,t,s,data,thumb);ctx.restore();return;}
 const notes=data.notes||[],{left,right}=useSafeDimensions(w,h),title=String(s.title||'YOUR BEAT').toUpperCase(),artist=String(s.artist||'YANGDOZZE').toUpperCase();
 ctx.fillStyle=s.background||'#0d0d13';ctx.fillRect(0,0,w,h);
 let grad=ctx.createRadialGradient(w*.82,h*.16,0,w*.82,h*.16,w*.72);grad.addColorStop(0,'rgba(119,45,188,.21)');grad.addColorStop(1,'rgba(119,45,188,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
 grad=ctx.createRadialGradient(w*.10,h*.87,0,w*.10,h*.87,w*.83);grad.addColorStop(0,'rgba(75,36,99,.19)');grad.addColorStop(1,'rgba(75,36,99,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
 if(s.labels!==false){fitted(ctx,title,left,h*.074,Math.max(27,w*.057),w*.58,'#f0e1ff','left','600');fitted(ctx,artist,left,h*.109,Math.max(24,w*.034),w*.64,'#e0d3ed','left','500');}
 fitted(ctx,`${Math.round(s.bpm||120)} BPM  ·  ${String(s.key||'—').toUpperCase()}`,right,h*.073,Math.max(22,w*.031),w*.37,'#f2ddff','right','600');
 // If no PCM audio is supplied, avoid rendering an empty AUDIO card.
 // Spend that space on actual MIDI notes instead of inventing a waveform.
 const hasAudio=Number(data.audioDuration)>0&&Boolean(data.audioPeaks?.length);
 // Audio-only input: do not display a fictitious/empty MIDI card.
 if(hasAudio&&!notes.length){
  const x=w*.055,y=h*.155,ww=w*.89,hh=h*.73;
  panel(ctx,x,y,ww,hh);topWindow(ctx,x,y,ww,hh,'AUDIO');
  txt(ctx,title,x+ww*.045,y+hh*.20,Math.max(24,w*.043),'#efd7ff','left','600');
  txt(ctx,`${formatTime(t)} / ${formatTime(Number(data.audioDuration)||0)}`,x+ww*.945,y+hh*.20,Math.max(16,w*.023),'#d9c4e7','right');
  audioWave(ctx,{x:x+ww*.043,y:y+hh*.31,w:ww*.914,h:hh*.54},t,{...data,audioReact:s.react});
  txt(ctx,'AUDIO ONLY · MIDI НЕ ЗАГРУЖЕН',x+ww*.045,y+hh*.95,Math.max(14,w*.020),'#d9c8e3');
  return;
 }
 const panelX=w*.055,panelW=w*.89,aY=h*.160,aH=h*.248;
 const mY=hasAudio?h*.430:h*.165,mH=hasAudio?h*.450:h*.714;
 if(hasAudio){
  panel(ctx,panelX,aY,panelW,aH);topWindow(ctx,panelX,aY,panelW,aH,'AUDIO');
  txt(ctx,title,panelX+panelW*.045,aY+aH*.29,Math.max(24,w*.043),'#efd7ff','left','600');
  txt(ctx,`${formatTime(t)} / ${formatTime(Number(data.audioDuration)||0)}`,panelX+panelW*.945,aY+aH*.29,Math.max(16,w*.023),'#d9c4e7','right');
  audioWave(ctx,{x:panelX+panelW*.043,y:aY+aH*.38,w:panelW*.914,h:aH*.425},t,{...data,audioReact:s.react});
  txt(ctx,`${Math.round(s.bpm||120)} BPM  ·  ${String(s.key||'').toUpperCase()}`,panelX+panelW*.045,aY+aH*.93,Math.max(15,w*.022),'#d4bcdf');
 }
 panel(ctx,panelX,mY,panelW,mH);topWindow(ctx,panelX,mY,panelW,mH,'MIDI');
 const trackMap=layerMap(notes),tr=trackMap.size;
 txt(ctx,`${tr} ${tr===1?'LAYER':'LAYERS'}`,panelX+panelW*.042,mY+mH*.175,Math.max(21,w*.037),'#ead1ff','left','600');
 txt(ctx,`${formatTime(Number(s.midiLoop)||Number(data.midiDuration)||16)} LOOP`,panelX+panelW*.96,mY+mH*.175,Math.max(21,w*.028),'#dfc9f2','right');
 const area={x:panelX+panelW*.045,y:mY+mH*(hasAudio?.325:.275),w:panelW*.915,h:mH*(hasAudio?.590:.641),playhead:panelX+panelW*.322,pxSecond:panelW*.915/(2.7+(clamp(Number(s.noteFocus)||15,12,36)-12)/24*4.6)};
 ctx.fillStyle='#15131c';rr(ctx,area.x,area.y,area.w,area.h,Math.max(7,w*.01));ctx.fill();
 const out=drawMIDI(ctx,notes,t,s,data,area,{outline:false,palette:[s.accent||'#a86aeb','#c899ef','#7c6eb0','#d59aca','#6caaa8'],grid:'rgba(161,132,186,.09)',measure:'rgba(161,132,186,.19)',playheadColor:'#e9ccff',playheadWidth:Math.max(1.6,w*.0026),playheadGlow:7,minNote:Math.max(9,w*.012),maxNote:w*.048,glow:w*.018,hitSize:w*.013});
 // The real file's number of tracks, not a decorative list of fake instruments.
 const ids=[...trackMap.keys()];ids.slice(0,5).forEach((id,i)=>{
  const xx=area.x+i*area.w/Math.min(ids.length,5),yy=area.y-Math.max(21,w*.040);
  ctx.fillStyle=['#a86aeb','#c899ef','#7c6eb0','#d59aca','#6caaa8'][i];ctx.fillRect(xx,yy-Math.max(7,w*.010),Math.max(7,w*.010),Math.max(7,w*.010));
  txt(ctx,`TRACK ${i+1}`,xx+Math.max(12,w*.019),yy,Math.max(21,w*.027),'#e2d2f3');
 });
 if(!notes.length)txt(ctx,'ADD MIDI',area.x+area.w*.5,area.y+area.h*.5,Math.max(17,w*.023),'#9a87aa','center');
 fitted(ctx,`${Math.round(s.bpm||120)} BPM · ${String(s.key||'—').toUpperCase()}`,left,h*.938,Math.max(21,w*.027),w*.39,'#e5d1f0','left','600');
 fitted(ctx,`${notes.length} NOTES · ${tr} TRACK${tr===1?'':'S'}`,right,h*.938,Math.max(21,w*.027),w*.47,'#e5d1f0','right','600');
}
