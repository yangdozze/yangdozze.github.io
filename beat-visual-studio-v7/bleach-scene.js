/**
 * BLEACH / Caustic source integration.
 * The original METHOD engine is used with the author's permission as stated by
 * the project owner. Its core is in ./caustic-core.js (METHOD attribution).
 * This adapter only manages decoded PCM, resizing, and the existing editor API.
 */
import {CAUSTIC} from './caustic-core.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const registry=new WeakMap();
let audio=null;
let sourceVersion=0;

export function setBleachAudioSource(decoded) {
  if (audio?.original===decoded || (!decoded&&!audio)) return;
  if (!decoded) {audio=null;sourceVersion++;return;}
  const channels=decoded.numberOfChannels;
  let pcm;
  if(channels===1){pcm=decoded.getChannelData(0)}
  else {
    const n=decoded.length;
    pcm=new Float32Array(n);
    for(let ch=0;ch<channels;ch++){
      const samples=decoded.getChannelData(ch);
      for(let i=0;i<n;i++) pcm[i]+=samples[i]/channels;
    }
  }
  audio={original:decoded,pcm,sr:decoded.sampleRate,duration:decoded.duration};
  sourceVersion++;
}

function rasterFor(canvas,w,h,thumb){
  let v=registry.get(canvas);
  const maxWidth=thumb?118:(typeof window!=='undefined'&&window.innerWidth<700?216:288);
  // METHOD's raster engine has quadratic CPU cost. Keep the film 9:16 without
  // changing the engine's original displacement, tracking and audio math.
  const aspect=w/h;
  const rw=Math.round(Math.min(maxWidth,Math.max(100,Math.min(w,h*aspect))));
  const rh=Math.max(1,Math.round(rw/aspect));
  if(!v||v.rw!==rw||v.rh!==rh){
    const layer=document.createElement('canvas');layer.width=rw;layer.height=rh;
    v={layer,ctx:layer.getContext('2d',{alpha:false}),renderer:new CAUSTIC.Ref(rw,rh),rw,rh,sourceVersion:-1,last:-1};
    registry.set(canvas,v);
  }
  return v;
}

export function renderBleach(ctx,w,h,t,settings={},data={},thumb=false){
  ctx.save();ctx.fillStyle='#08090c';ctx.fillRect(0,0,w,h);
  if(!audio){
    if(!thumb){
      ctx.fillStyle='#e5e5e3';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font=`600 ${Math.max(17,w*.041)}px system-ui`;
      ctx.fillText('ДОБАВЬ АУДИО',w/2,h*.49);
      ctx.font=`${Math.max(13,w*.024)}px system-ui`;
      ctx.fillStyle='#aaaab5';ctx.fillText('WAV · MP3 · M4A',w/2,h*.53);
    }
    ctx.restore();return;
  }
  const obj=rasterFor(ctx.canvas,w,h,thumb);
  if(obj.sourceVersion!==sourceVersion){obj.renderer.clear();obj.sourceVersion=sourceVersion;obj.last=-1;}
  // DEFAULTS ARE THE ORIGINAL METHOD CAUSTIC CONTROLS, not our old sinusoid approximation.
  CAUSTIC.U.stage=settings.bleachLook==='thermal'?'out':'disp';
  CAUSTIC.U.tracker=.65;
  CAUSTIC.U.low=CAUSTIC.U.mid=CAUSTIC.U.high=clamp(Number(settings.react)||1,.15,2);
  CAUSTIC.applyUser();
  const duration=audio.duration;
  const frameTime=data.audioLoop?((t%duration)+duration)%duration:clamp(t,0,Math.max(0,duration-.001));
  // The original CPU raster is not intended to run 60 times a second in a
  // mobile Chromium/Safari UI loop. Draw cached canvas between real updates.
  // Scrubbing backwards or to another part of the beat always forces a frame.
  const minStep=thumb?0.22:(typeof window!=='undefined'&&window.innerWidth<700?1/12:1/18);
  if(obj.last>=0 && frameTime>=obj.last && frameTime-obj.last<minStep){
    ctx.drawImage(obj.layer,0,0,w,h);
    ctx.restore();return;
  }
  const dt=obj.last>=0?frameTime-obj.last:1/30;
  obj.last=frameTime;
  try{
    obj.renderer.render(obj.ctx,obj.rw,obj.rh,frameTime,audio.pcm,audio.sr,dt);
    ctx.drawImage(obj.layer,0,0,w,h);
    if(!thumb&&typeof window!=='undefined'){
      window.__BLEACH_FRAME_DEBUG__={engine:'METHOD Caustic original',time:frameTime,sourceVersion,hasAudio:true,trackerCount:obj.renderer.trk?.tracks?.length||0,size:[obj.rw,obj.rh]};
    }
  }catch(error){
    console.error('METHOD Caustic renderer failed',error);
    ctx.fillStyle='#f4eeee';ctx.textAlign='center';ctx.font=`${Math.max(15,w*.029)}px sans-serif`;
    ctx.fillText('Ошибка рендера Caustic',w/2,h/2);
  }
  ctx.restore();
}
