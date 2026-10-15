import {renderStrip,renderNight} from './akira-scenes.js';
import {renderBleach} from './bleach-scene.js';
export const MODES=[{id:'strip',name:'Светлый STRIP',type:'midi+audio'},{id:'night',name:'Тёмный NIGHT',type:'midi+audio'},{id:'bleach',name:'BLEACH / METHOD',type:'audio'}];

export const SAFE_PROFILES={
 creator:{left:.05,right:.12,top:.08,bottom:.20},
 social:{left:.06,right:.18,top:.14,bottom:.35},
 tiktok:{left:.08,right:.18,top:.14,bottom:.28},
 reels:{left:.06,right:.06,top:.14,bottom:.35},
 none:{left:.045,right:.045,top:.045,bottom:.045}
};

export function safeRegion(w,h,profile='creator'){
 const p=h/w>1.5?(SAFE_PROFILES[profile]||SAFE_PROFILES.creator):SAFE_PROFILES.none;
 return {x:w*p.left,y:h*p.top,width:w*(1-p.left-p.right),height:h*(1-p.top-p.bottom)};
}

const PITCH=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const fmtTime=t=>`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(v,length)=>((v%length)+length)%length;

// Timeline is shared by the displayed playhead and MIDI note highlighting.
// When repetition is disabled, neither may silently wrap back to the beginning.
export function midiTimelineState(t,offset,cycle,loopMidi=true){
 const local=t-offset,looping=loopMidi!==false;
 return {local,looping,time:looping?wrap(local,cycle):clamp(local,0,cycle),visible:local>=0&&(looping||local<=cycle)};
}
export function midiNoteActive(note,local,cycle,loopMidi=true){
 if(local<note.start)return false; // No ghost notes before their first actual onset.
 if(loopMidi===false)return local<note.end;
 const start=wrap(note.start,cycle),duration=Math.min(cycle,Math.max(.015,note.end-note.start));
 return wrap(wrap(local,cycle)-start,cycle)<duration;
}

// Scrolling MIDI: the activation line stays fixed and the real note geometry
// moves through it. Timeline/notes share one canonical time source.
export function noteScreenX(noteStart,local,windowBefore,windowAfter,width){
 return width*windowBefore/(windowBefore+windowAfter)+(noteStart-local)*width/(windowBefore+windowAfter);
}

function pulse(ctx,w,h,t,s,data={},thumb=false){
 const bg=s.background||'#eeeae1',ink=s.ink||'#22241f',accent=s.accent||'#f46b45';
 const zone=safeRegion(w,h,s.safeProfile||'creator');
 ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
 const energy=clamp(Number(data.energy)||0,0,1),react=clamp(Number(s.react)||1,.1,3);
 const live=Boolean(data.audioDuration||data.audioPeaks?.length||data.liveWave?.length);
 const audioDuration=Math.max(.01,Number(data.audioDuration)||0);
 const localTime=live&&audioDuration>0?(data.audioLoop?wrap(t,audioDuration):clamp(t,0,audioDuration)):t;
 const freq=data.freq||[];
 const zoom=clamp(Number(s.scale)||1,.6,1);
 ctx.save();ctx.translate(zone.x+zone.width/2,zone.y+zone.height/2);ctx.scale(zoom,zoom);ctx.translate(-(zone.x+zone.width/2),-(zone.y+zone.height/2));
 const x=zone.x+zone.width*.04,wide=zone.width*.92;
 const centerX=zone.x+zone.width*.5,centerY=zone.y+zone.height*.43;
 const r=Math.min(zone.width*.285,zone.height*.24),bars=64;
 const baseR=r*.79;
 ctx.save();ctx.globalAlpha=.07;ctx.fillStyle=ink;
 for(let i=0;i<6;i++){ctx.beginPath();ctx.arc(centerX,centerY,r*(1.15+i*.16),0,Math.PI*2);ctx.strokeStyle=ink;ctx.lineWidth=Math.max(1,w*.001);ctx.stroke();}
 ctx.restore();
 // The FFT drives the radial bar geometry, not an invented MIDI animation.
 for(let i=0;i<bars;i++){
  const angle=-Math.PI/2+i/bars*Math.PI*2+t*.065;
  const bi=Math.floor(3+Math.pow(i/bars,1.85)*230),f=live?((freq[bi]||0)/255):0;
  const height=r*(.035+Math.pow(f,1.3)*.34*react);
  const inner=baseR+r*.02,outer=inner+height;
  const cx=Math.cos(angle),cy=Math.sin(angle);
  ctx.strokeStyle=(i%4===0)?ink:accent;ctx.globalAlpha=.52+f*.46;
  ctx.lineWidth=Math.max(1.5,w*.003);
  ctx.beginPath();ctx.moveTo(centerX+cx*inner,centerY+cy*inner);ctx.lineTo(centerX+cx*outer,centerY+cy*outer);ctx.stroke();
 }
 ctx.globalAlpha=1;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(2,w*.004);
 ctx.beginPath();ctx.arc(centerX,centerY,baseR*.85,0,Math.PI*2);ctx.stroke();
 ctx.globalAlpha=.12+energy*.30;ctx.fillStyle=accent;
 ctx.beginPath();ctx.arc(centerX,centerY,baseR*(.63+energy*react*.12),0,Math.PI*2);ctx.fill();
 ctx.globalAlpha=1;ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.font=`800 ${Math.max(20,w*.065)}px Arial,sans-serif`;
 ctx.fillText(live?'PULSE':'ADD AUDIO',centerX,centerY-Math.max(4,w*.008));
 ctx.globalAlpha=.68;ctx.font=`${Math.max(9,w*.014)}px monospace`;
 ctx.fillText(live?'REAL AUDIO SIGNAL':'NO FAKE MIDI',centerX,centerY+w*.050);
 ctx.globalAlpha=1;
 // A scrolling audio envelope: original PCM extrema, centred at the playhead.
 const waveformY=zone.y+zone.height*.76,waveH=Math.max(28,zone.height*.13);
 ctx.save();ctx.beginPath();ctx.rect(x,waveformY-waveH*.52,wide,waveH*1.04);ctx.clip();
 ctx.globalAlpha=.08;ctx.fillStyle=ink;ctx.fillRect(x,waveformY-waveH*.52,wide,waveH*1.04);
 if(data.audioPeaks?.length&&data.audioDuration){
  const span=Math.min(8,Math.max(2,audioDuration)),count=data.audioPeaks.length;
  ctx.strokeStyle=accent;ctx.globalAlpha=.82;ctx.lineWidth=Math.max(1.1,w*.0021);
  ctx.beginPath();
  for(let i=0;i<240;i++){
   const sampleTime=localTime+(i/239-.5)*span;
   const timeIndex=data.audioLoop?wrap(sampleTime,audioDuration):clamp(sampleTime,0,audioDuration-.0001);
   const peak=data.audioPeaks[Math.min(count-1,Math.floor(timeIndex/audioDuration*count))];
   const v=Math.max(Math.abs(peak.leftMin),Math.abs(peak.leftMax),Math.abs(peak.rightMin),Math.abs(peak.rightMax));
   const px=x+wide*i/239,amp=v*waveH*.44*react;
   ctx.moveTo(px,waveformY-amp);ctx.lineTo(px,waveformY+amp);
  }
  ctx.stroke();
 }else{
  ctx.strokeStyle=ink;ctx.globalAlpha=.25;ctx.beginPath();ctx.moveTo(x,waveformY);ctx.lineTo(x+wide,waveformY);ctx.stroke();
 }
 ctx.restore();ctx.globalAlpha=1;
 ctx.strokeStyle=ink;ctx.lineWidth=Math.max(1,w*.002);ctx.beginPath();ctx.moveTo(centerX,waveformY-waveH*.57);ctx.lineTo(centerX,waveformY+waveH*.57);ctx.stroke();
 // Header and footer are contained inside safeRegion in both 9:16 and 16:9.
 ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.fillStyle=ink;
 ctx.font=`700 ${Math.max(14,w*.03)}px Arial,sans-serif`;
 ctx.fillText('02 / PULSE · AUDIO',x,zone.y+Math.max(21,w*.045));
 ctx.globalAlpha=.48;ctx.font=`${Math.max(9,w*.016)}px monospace`;
 ctx.textAlign='right';ctx.fillText('NO MIDI REQUIRED',x+wide,zone.y+Math.max(40,w*.077));
 ctx.textAlign='left';ctx.fillText('AUDIO WAVE · LAST / NEXT 4S',x,waveformY-waveH*.72);
 ctx.textAlign='right';ctx.fillText(`${fmtTime(localTime)} / ${fmtTime(audioDuration)}`,x+wide,zone.y+zone.height*.95);
 ctx.globalAlpha=1;
 if(s.labels&&!thumb){
  ctx.fillStyle=ink;ctx.textAlign='left';ctx.font=`700 ${Math.max(14,w*.026)}px Arial,sans-serif`;
  const name=(s.title||'').slice(0,60);ctx.fillText(name,x,zone.y+zone.height*.90,wide);
  ctx.globalAlpha=.62;ctx.font=`${Math.max(9,w*.015)}px monospace`;
  ctx.fillText((s.artist||'').toUpperCase(),x,zone.y+zone.height*.94,wide);
 }
 ctx.restore();ctx.globalAlpha=1;
}


// Phone-first score: a dominant pitch band keeps the actual notes legible while
// the lower register rail keeps every pitch visible (no discarded MIDI events).
export function choosePitchFocus(notes,span=20){
 if(!notes.length)return {low:48,high:48+span};
 const counts=new Map();for(const n of notes){const p=Math.max(0,Math.min(127,Math.round(n.pitch)));counts.set(p,(counts.get(p)||0)+1);}
 const pitches=[...counts.keys()],lowest=Math.min(...pitches),highest=Math.max(...pitches);
 if(highest-lowest<=span)return {low:Math.max(0,lowest-1),high:Math.min(127,lowest-1+Math.max(span,highest-lowest+2))};
 let best=-Infinity,low=lowest;
 for(let start=Math.max(0,lowest-span);start<=Math.min(127-span,highest);start++){
  let score=0,distinct=0;
  for(const [pitch,count] of counts)if(pitch>=start&&pitch<=start+span){score+=Math.sqrt(count);distinct++;}
  // Reward a musically useful spread rather than a repeated one-note row.
  score+=distinct*.075;
  if(score>best){best=score;low=start;}
 }
 return {low,high:low+span};
}
const rgba=(hex,a)=>{const h=/^#[0-9a-f]{6}$/i.test(hex)?hex:'#8c9aff';return `rgba(${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)},${a})`;};
function softRound(ctx,x,y,width,height,r){
 if(width<=0||height<=0)return;
 const rad=Math.min(r,width/2,height/2);
 ctx.beginPath();ctx.roundRect(x,y,width,height,rad);
}
function blendHex(a,b,f){
 const v=clamp(f,0,1),channel=(s,i)=>parseInt(s.slice(i,i+2),16);
 const hex=n=>Math.round(n).toString(16).padStart(2,'0');
 if(!/^#[\da-f]{6}$/i.test(a)||!/^#[\da-f]{6}$/i.test(b))return a;
 return '#'+[1,3,5].map(i=>hex(channel(a,i)*(1-v)+channel(b,i)*v)).join('');
}
function bgAtmosphere(ctx,w,h,t,bg,accent){
 ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
 const horizon=ctx.createLinearGradient(0,0,w*.83,h);
 horizon.addColorStop(0,rgba(accent,.13));horizon.addColorStop(.48,'rgba(0,0,0,0)');horizon.addColorStop(1,rgba(accent,.055));
 ctx.fillStyle=horizon;ctx.fillRect(0,0,w,h);
 for(const [x,y,r,o] of [[.79,.21,.64,.24],[.17,.72,.72,.14]]){
  const a=ctx.createRadialGradient(w*x,h*y,0,w*x,h*y,w*r);
  a.addColorStop(0,rgba(accent,o));a.addColorStop(.54,rgba(accent,.035));a.addColorStop(1,rgba(accent,0));
  ctx.fillStyle=a;ctx.fillRect(0,0,w,h);
 }
 // Layered beams are environmental motion, not fabricated audio feedback.
 ctx.save();ctx.globalAlpha=.07;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(.8,w*.001);
 for(let i=0;i<8;i++){
  const x=w*(.16+i*.14)+Math.sin(t*.15+i)*w*.007;
  ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-w*.07,h);ctx.stroke();
 }
 ctx.restore();
}
function scrollAudio(ctx,box,t,s,data,accent,ink){
 const {x,y,width,height}=box,dur=Number(data.audioDuration)||0,peaks=data.audioPeaks;
 ctx.save();ctx.beginPath();ctx.rect(x,y,width,height);ctx.clip();
 const center=y+height*.51;
 ctx.fillStyle=rgba(accent,.055);softRound(ctx,x,y,width,height,Math.max(5,width*.014));ctx.fill();
 if(peaks?.length&&dur>0){
  const now=data.audioLoop?wrap(t,dur):clamp(t,0,dur),lookBehind=1.1,lookAhead=2.4,span=lookBehind+lookAhead;
  const line=ctx.createLinearGradient(0,center-height*.45,0,center+height*.45);
  line.addColorStop(0,rgba(accent,.97));line.addColorStop(.5,rgba(ink,.72));line.addColorStop(1,rgba(accent,.97));
  ctx.strokeStyle=line;ctx.lineWidth=Math.max(1.6,width*.0024);ctx.globalAlpha=.94;
  ctx.beginPath();for(let i=0;i<260;i++){
   const at=now-lookBehind+i/259*span;if(at<0&&!data.audioLoop)continue;
   const phase=data.audioLoop?wrap(at,dur):clamp(at,0,dur-.00001);
   const p=peaks[Math.min(peaks.length-1,Math.floor(phase/dur*peaks.length))];
   const v=Math.max(Math.abs(p.leftMin),Math.abs(p.leftMax),Math.abs(p.rightMin),Math.abs(p.rightMax));
   const amt=clamp(v*Math.max(.3,+s.react||1),0,1)*height*.44,xx=x+i/259*width;
   ctx.moveTo(xx,center-amt);ctx.lineTo(xx,center+amt);
  }ctx.stroke();
  const playX=x+lookBehind/span*width;ctx.strokeStyle=ink;ctx.lineWidth=Math.max(2,width*.004);ctx.globalAlpha=.95;
  ctx.beginPath();ctx.moveTo(playX,y);ctx.lineTo(playX,y+height);ctx.stroke();
 }else if(data.liveWave?.length){
  const wave=data.liveWave;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1.5,width*.002);ctx.beginPath();
  for(let i=0;i<wave.length;i+=3){const xx=x+i/(wave.length-1)*width,yy=center-wave[i]*height*.36;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.stroke();
 }
 ctx.restore();
}

export function render(ctx,w,h,t,s,data={},thumb=false){
 if(s.mode==='pulse')return pulse(ctx,w,h,t,s,data,thumb);
 if(s.mode==='bleach')return renderBleach(ctx,w,h,t,s,data,thumb);
 if(s.mode==='strip')return renderStrip(ctx,w,h,t,s,data,thumb);
 if(s.mode==='night')return renderNight(ctx,w,h,t,s,data,thumb);
 const bg=s.background||'#080d1b',accent=s.accent||'#8c9aff',ink=s.ink||'#f5f7ff';
 const zone=safeRegion(w,h,s.safeProfile||'creator'),notes=data.notes||[];
 bgAtmosphere(ctx,w,h,t,bg,accent);
 const landscape=w>h,zoom=clamp(Number(s.scale)||1,.6,1);
 ctx.save();const midX=zone.x+zone.width/2,midY=zone.y+zone.height/2;
 ctx.translate(midX,midY);ctx.scale(zoom,zoom);ctx.translate(-midX,-midY);
 const x=zone.x+zone.width*.018,ww=zone.width*.962,right=x+ww;
 const font='Arial, Helvetica, sans-serif',mono='ui-monospace, Consolas, monospace';
 const liveAudio=Boolean((data.audioPeaks?.length&&data.audioDuration)||data.liveWave?.length);
 const headH=landscape?zone.height*.21:Math.max(120,zone.height*.17);
 const headerTop=zone.y+(landscape?14:14),headBaseline=headerTop+Math.min(72,w*.079);
 const title=(s.title||'UNTITLED 001').trim().toUpperCase();
 ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle=ink;
 let size=Math.min(72,w*(landscape?.058:.074));ctx.font=`900 ${size}px ${font}`;
 while(ctx.measureText(title).width>ww*.98&&size>Math.max(21,w*.031))ctx.font=`900 ${--size}px ${font}`;
 if(s.labels!==false){ctx.fillText(title,x,headBaseline);ctx.globalAlpha=.7;ctx.font=`700 ${Math.max(13,w*.020)}px ${mono}`;
 ctx.fillText((s.artist||'').toUpperCase(),x,headBaseline+Math.max(24,w*.042),ww*.65);ctx.globalAlpha=1;}
 ctx.textAlign='right';ctx.font=`700 ${Math.max(14,w*.020)}px ${mono}`;ctx.globalAlpha=.7;
 ctx.fillText(fmtTime(t),right,headBaseline+Math.max(24,w*.042));ctx.globalAlpha=1;
 // One dominant large note field. The supporting register gets a separate rail
 // instead of forcing all octaves into microscopic rows.
 const contentY=zone.y+headH+(landscape?8:12);
 const bottom=zone.y+zone.height-(landscape?6:12),gap=landscape?15:27;
 let mainH=(bottom-contentY)*(liveAudio?.77:.76);
 if(landscape)mainH=(bottom-contentY)*.73;
 let fieldY=contentY+Math.max(24,w*.042), fieldH=Math.max(40,mainH-Math.max(26,w*.05));
 const supportY=fieldY+fieldH+gap, supportH=Math.max(30,bottom-supportY-14);
 const focus=choosePitchFocus(notes,clamp(Math.round(Number(s.noteFocus)||15),12,36)),range=focus.high-focus.low+1;
 const pitchRow=fieldH/range;
 const cycle=Math.max(.25,Number(s.midiLoop)||data.midiDuration||16),offset=Number(s.offset)||0;
 const timeline=midiTimelineState(t,offset,cycle,s.loopMidi),local=timeline.local;
 const secsBehind=clamp(60/(+s.bpm||120)*1.6,.50,1.05),secsAhead=clamp(60/(+s.bpm||120)*4.8,1.5,2.8);
 const window=secsBehind+secsAhead, strikeX=x+ww*secsBehind/window;
 ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.font=`800 ${Math.max(13,w*.023)}px ${mono}`;
 ctx.fillStyle=ink;ctx.globalAlpha=.83;ctx.fillText('01   LIVE MIDI',x,contentY+7);ctx.globalAlpha=1;
 ctx.textAlign='right';ctx.fillStyle=accent;ctx.font=`700 ${Math.max(13,w*.021)}px ${mono}`;
 ctx.fillText(`${Math.round(s.bpm||120)} BPM  ·  ${(s.key||'').toUpperCase()}`,right,contentY+7);
 // Keep low-contrast decorative grid behind bright notes.
 ctx.fillStyle=rgba(accent,.045);softRound(ctx,x,fieldY,ww,fieldH,Math.max(8,w*.012));ctx.fill();
 // An oversized current chord turns the piano roll into a cinematic composition.
 const sounding=notes.filter(n=>midiNoteActive(n,local,cycle,s.loopMidi));
 const keyNames=[...new Set(sounding.map(n=>`${PITCH[n.pitch%12]}${Math.floor(n.pitch/12)-1}`))].slice(-3);
 if(keyNames.length){ctx.save();ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle=accent;ctx.globalAlpha=.09;
  let huge=Math.min(w*.18,fieldH*.19),joined=keyNames.join('  ');ctx.font=`900 ${huge}px Arial,Helvetica,sans-serif`;
  while(ctx.measureText(joined).width>ww*.78&&huge>w*.07){huge-=3;ctx.font=`900 ${huge}px Arial,Helvetica,sans-serif`;}
  ctx.fillText(joined,right-ww*.03,fieldY+fieldH*.28);ctx.restore();}

 ctx.save();ctx.beginPath();ctx.rect(x,fieldY,ww,fieldH);ctx.clip();
 for(let i=0;i<=range;i++){
  const yy=fieldY+i*pitchRow;ctx.strokeStyle=rgba(ink,i%4===0?.10:.036);ctx.lineWidth=i%4===0?1.1:.75;
  ctx.beginPath();ctx.moveTo(x,yy);ctx.lineTo(right,yy);ctx.stroke();
 }
 // Rhythm markers are tied to actual BPM, never to hand-made pseudo notes.
 const beat=60/(+s.bpm||120);
 if(Number.isFinite(beat)&&beat>0){const first=Math.floor((local-secsBehind)/beat),last=Math.ceil((local+secsAhead)/beat);
  for(let k=first;k<=last;k++){
   const xx=noteScreenX(k*beat,local,secsBehind,secsAhead,ww)+x;
   ctx.strokeStyle=rgba(ink,k%4===0?.15:.04);ctx.lineWidth=k%4===0?1.5:1;
   ctx.beginPath();ctx.moveTo(xx,fieldY);ctx.lineTo(xx,fieldY+fieldH);ctx.stroke();
  }
 }
 const pass=(kind)=>{
  for(const n of notes){
   const primary=n.pitch>=focus.low&&n.pitch<=focus.high;
   if(kind==='primary'&&!primary||kind==='support'&&primary)continue;
   const duration=Math.max(.015,Math.min(cycle,n.end-n.start));
   const loops=timeline.looping?Math.ceil(window/cycle)+3:0;
   const from=timeline.looping?Math.max(0,Math.floor((local-secsBehind-n.start-duration)/cycle)):0;
   const to=timeline.looping?Math.max(from,Math.ceil((local+secsAhead-n.start)/cycle)):0;
   for(let k=from;k<=Math.min(to,from+loops);k++){
    const start=n.start+k*cycle,end=start+duration;
    if(end<local-secsBehind||start>local+secsAhead)continue;
    const nx=x+noteScreenX(start,local,secsBehind,secsAhead,ww);
    const nw=Math.max(2.5,duration/window*ww);
    const active=start<=local&&end>local&&timeline.visible;
    if(kind==='primary'){
     const ny=fieldY+fieldH-((n.pitch-focus.low+.5)/range)*fieldH,nh=Math.max(6,pitchRow*.73);
     ctx.save();ctx.globalAlpha=active?1:(start<local?.33:.87);
     // Shift towards icy white/cyan in the higher register for depth, not arbitrary notes.
     const tone=blendHex(accent,'#7de9ff',clamp((n.pitch-focus.low)/range*.33,0,.34));
     ctx.fillStyle=active?blendHex(tone,ink,.22):tone;
     if(active){ctx.shadowBlur=Math.max(16,w*.030);ctx.shadowColor=accent;}
     softRound(ctx,nx,ny-nh/2,nw,nh,Math.min(5,w*.008));ctx.fill();
     if(active&&nw>13){ctx.shadowBlur=0;ctx.fillStyle=ink;ctx.globalAlpha=.65;ctx.fillRect(nx+1,ny-nh*.37,Math.max(2,Math.min(3.5,nw-2)),nh*.73);}
     ctx.restore();
    }
   }
  }
 };
 pass('primary');
 // Real onsets emit deterministic short-lived sparks exactly at the strike plane.
 if(timeline.visible){
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const n of notes){if(n.pitch<focus.low||n.pitch>focus.high)continue;
   const phase=timeline.looping?wrap(local-n.start,cycle):local-n.start;
   if(local<n.start||phase<0||phase>.24)continue;
   const strength=Math.pow(1-phase/.24,2),ny=fieldY+fieldH-((n.pitch-focus.low+.5)/range)*fieldH;
   ctx.strokeStyle=rgba(ink,.75*strength);ctx.lineWidth=Math.max(1,w*.0025);
   ctx.beginPath();ctx.moveTo(strikeX-18*strength,ny);ctx.lineTo(strikeX+25*strength,ny);ctx.moveTo(strikeX,ny-15*strength);ctx.lineTo(strikeX,ny+15*strength);ctx.stroke();
   ctx.fillStyle=rgba(accent,.5*strength);ctx.beginPath();ctx.arc(strikeX,ny,15*strength,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
 }
 // Moving activation line and active-note signal.
 if(timeline.visible){
  ctx.strokeStyle=rgba(accent,.25);ctx.lineWidth=Math.max(12,w*.036);ctx.beginPath();ctx.moveTo(strikeX,fieldY);ctx.lineTo(strikeX,fieldY+fieldH);ctx.stroke();
  ctx.strokeStyle=ink;ctx.lineWidth=Math.max(2,w*.003);ctx.beginPath();ctx.moveTo(strikeX,fieldY);ctx.lineTo(strikeX,fieldY+fieldH);ctx.stroke();
 }
 ctx.restore();
 // The lower lane represents the actual other pitches or the real PCM audio.
 ctx.font=`700 ${Math.max(12,w*.017)}px ${mono}`;ctx.textAlign='left';ctx.fillStyle=ink;ctx.globalAlpha=.75;
 ctx.fillText(liveAudio?'02   AUDIO / LIVE WAVE':'02   OTHER OCTAVES',x,supportY-7);ctx.globalAlpha=1;
 const lowerY=supportY+Math.max(7,w*.010),lowerH=Math.max(20,bottom-lowerY);
 if(liveAudio){scrollAudio(ctx,{x,y:lowerY,width:ww,height:lowerH},t,s,data,accent,ink);}
 else{
  ctx.fillStyle=rgba(accent,.047);softRound(ctx,x,lowerY,ww,lowerH,Math.min(9,w*.014));ctx.fill();
  const outside=notes.filter(n=>n.pitch<focus.low||n.pitch>focus.high);
  if(outside.length){
   const low=Math.min(...outside.map(n=>n.pitch)),high=Math.max(...outside.map(n=>n.pitch)),rr=Math.max(1,high-low);
   ctx.save();ctx.beginPath();ctx.rect(x,lowerY,ww,lowerH);ctx.clip();
   for(const n of outside){
    const d=Math.max(.015,Math.min(cycle,n.end-n.start)),loops=timeline.looping?Math.ceil(window/cycle)+3:0;
    const from=timeline.looping?Math.max(0,Math.floor((local-secsBehind-n.start-d)/cycle)):0;
    const to=timeline.looping?Math.max(from,Math.ceil((local+secsAhead-n.start)/cycle)):0;
    for(let k=from;k<=Math.min(to,from+loops);k++){
     const start=n.start+k*cycle;if(start+d<local-secsBehind||start>local+secsAhead)continue;
     const nx=x+noteScreenX(start,local,secsBehind,secsAhead,ww),width=Math.max(2,d/window*ww);
     const ny=lowerY+lowerH*.9-(n.pitch-low)/rr*lowerH*.79;
     ctx.fillStyle=rgba(accent,n.pitch<focus.low?.57:.86);
     if(start<=local&&start+d>local){ctx.shadowBlur=Math.max(8,w*.012);ctx.shadowColor=accent;}
     softRound(ctx,nx,ny-2,width,Math.max(3,w*.008),2);ctx.fill();ctx.shadowBlur=0;
    }
   }
   ctx.restore();
  }else{
   // Real MIDI velocity bars, not an invented waveform.
   const start=local-secsBehind,end=local+secsAhead;
   ctx.save();ctx.beginPath();ctx.rect(x,lowerY,ww,lowerH);ctx.clip();
   for(const n of notes){for(let k=0;k<(timeline.looping?Math.ceil((end+cycle)/cycle)+1:1);k++){
    const onset=n.start+k*cycle;if(onset<start||onset>end)continue;
    const xx=x+noteScreenX(onset,local,secsBehind,secsAhead,ww);
    ctx.fillStyle=rgba(accent,.25+.55*n.velocity);const hh=lowerH*.7*n.velocity;
    ctx.fillRect(xx,lowerY+lowerH*.92-hh,Math.max(2,w*.006),hh);
   }}ctx.restore();
  }
 }
 // Intentional bottom rhythm marker, still within the export safe region.
 ctx.textAlign='left';ctx.fillStyle=rgba(ink,.48);ctx.font=`700 ${Math.max(10,w*.014)}px ${mono}`;
 ctx.fillText(`${notes.length} NOTE EVENTS  /  ${fmtTime(cycle)} LOOP`,x,bottom+Math.max(9,w*.012));
 ctx.restore();
}
