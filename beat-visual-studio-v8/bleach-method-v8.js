/**
 * METHOD / 03 Bleach integration for Beat Visual Studio v8.
 * Uses the CausticAdapter and CAUSTIC engine extracted unchanged from
 * https://method.hiveglobal.org/app/ with permission relayed by the
 * Beat Visual Studio project owner. Attribution: METHOD / HiveGlobal.
 *
 * This file handles host audio, mode selection and video canvas scaling.
 * No independently simulated waveforms or fake HUD tracks.
 */
import {CausticAdapter} from './caustic-adapter-method-v8.js';
import {CAUSTIC} from './caustic-core-method-v8.js';
import {drawMethodTrackerHUD} from './hud-method-v8.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const renderers=new WeakMap();
let audio=null,sourceVersion=0;

export function setBleachAudioSource(buffer){
  if(audio?.buffer===buffer || (!buffer&&!audio))return;
  if(!buffer){audio=null;sourceVersion++;return;}
  const n=buffer.length,ch=buffer.numberOfChannels;
  let pcm;
  if(ch===1)pcm=buffer.getChannelData(0);
  else{
    pcm=new Float32Array(n);
    for(let k=0;k<ch;k++){
      const a=buffer.getChannelData(k),f=1/ch;
      for(let i=0;i<n;i++)pcm[i]+=a[i]*f;
    }
  }
  audio={buffer,pcm,sampleRate:buffer.sampleRate,duration:buffer.duration};
  sourceVersion++;
}

function instance(canvas,thumb,landscape){
  let v=renderers.get(canvas);
  if(!v||v.thumb!==thumb||v.landscape!==landscape){
    // Main scene = exactly METHOD's original 540 × 960 CPU raster (960 × 540 landscape).
    // Thumbnails intentionally use a smaller raster only for responsiveness.
    let engine;
    if(!thumb)engine=CausticAdapter.create();
    else {
      const width=landscape?224:126,height=landscape?126:224;
      const c=document.createElement('canvas');c.width=width;c.height=height;
      const cx=c.getContext('2d',{alpha:false,willReadFrequently:true});
      const R=new CAUSTIC.Ref(width,height);
      engine={
        canvas:c,setAudio(){},setLook(k){CAUSTIC.U.stage=k;},
        frame(t,dt){R.render(cx,width,height,t,audio.pcm,audio.sampleRate,dt);},
        set(){},
        setAspect(){},
        getTrackerCount(){return R.trk?.tracks?.length||0}
      };
    }
    if(landscape&&!thumb)engine.setAspect('16:9');
    v={engine,thumb,landscape,sourceVersion:-1,lastTime:-1,look:null,config:null};
    renderers.set(canvas,v);
  }
  return v;
}
export function renderBleach(ctx,w,h,t,settings={},data={},thumb=false){
  const look=settings.mode==='thermal'?'out':'disp';
  ctx.save();
  ctx.fillStyle=look==='out'?'#ff7e02':'#000';
  ctx.fillRect(0,0,w,h);
  // Also receive the decoded source through render data, so playback and export cannot
  // silently use different audio state if a browser cached an older ES module URL.
  if(data.decodedAudio&&audio?.buffer!==data.decodedAudio)setBleachAudioSource(data.decodedAudio);
  if(!audio){
    if(!thumb){
      ctx.fillStyle=look==='out'?'#17100a':'#e7e7e4';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='600 '+Math.round(Math.max(16,w*.035))+'px system-ui,sans-serif';
      ctx.fillText('ЗАГРУЗИ АУДИО',w/2,h*.49);
    }
    ctx.restore();return;
  }
  const landscape=w>h,v=instance(ctx.canvas,thumb,landscape);
  try{
    const cfg=[
      clamp(Number(settings.causticDisplacement??1),0,3),
      clamp(Number(settings.causticSpeed??.97),0,3),
      clamp(Number(settings.causticTracker??.65),0,1),
      clamp(Number(settings.causticCaption??17),10,36),
      clamp(Number(settings.react??1),.1,2)
    ];
    const configKey=cfg.join('/');
    if(v.look!==look || v.config!==configKey){
      v.look=look;v.config=configKey;v.lastTime=-1;
    }
    if(v.sourceVersion!==sourceVersion){
      v.engine.setAudio(audio.pcm,audio.sampleRate);
      v.sourceVersion=sourceVersion;v.lastTime=-1;
    }
    const at=data.audioLoop?((t%audio.duration)+audio.duration)%audio.duration:clamp(t,0,Math.max(0,audio.duration-.001));
    // Audio-clock-driven source; full-quality export draws each and every timestamp.
    // The live preview is not redrawn at duplicate timestamps.
    if(!settings.exportMode && v.lastTime>=0 && Math.abs(at-v.lastTime)<(thumb?1/10:1/40)){
      ctx.drawImage(v.engine.canvas,0,0,w,h);
      if(!thumb&&cfg[2]>.02)drawMethodTrackerHUD(ctx,w,h,v.engine.getTrackerState?.());
      ctx.restore();return;
    }
    // CAUSTIC.U and the original adapter are singleton-scope parameters.
    // The UI thumbnails change the same scope, so restore the exact current look
    // and its controls before EVERY frame (otherwise DISPLACED becomes THERMAL).
    v.engine.setLook(look);
    if(thumb){
      CAUSTIC.U.displacement=cfg[0];
      CAUSTIC.U.speed=cfg[1];
      CAUSTIC.U.tracker=cfg[2];
    }else{
      v.engine.set('displacement',cfg[0]);
      v.engine.set('speed',cfg[1]);
      v.engine.set('tracker',cfg[2]);
    }
    CAUSTIC.TK.cap=cfg[3];
    CAUSTIC.U.low=CAUSTIC.U.mid=CAUSTIC.U.high=cfg[4];
    CAUSTIC.applyUser();
    const dt=v.lastTime>=0?clamp(at-v.lastTime,1/240,.1):1/30;
    v.engine.frame(at,dt);
    v.lastTime=at;
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(v.engine.canvas,0,0,w,h);
    const trackerState=!thumb?v.engine.getTrackerState?.():null;
    const visibleHUD=(!thumb&&cfg[2]>.02)?drawMethodTrackerHUD(ctx,w,h,trackerState):0;
    if(!thumb&&typeof window!=='undefined'){
      window.__BLEACH_FRAME_DEBUG__={
        engine:'METHOD Caustic original adapter',look,sourceVersion,time:at,
        nativeRaster:[v.engine.canvas.width,v.engine.canvas.height],
        tracker:cfg[2],displacement:cfg[0],speed:cfg[1],
        rasterHashSource:'METHOD',
        hasAudio:true,trackerCount:trackerState?.tracks?.length||0,visibleHUD
      };
    }
  }catch(err){
    console.error('METHOD Caustic render failed',err);
    ctx.fillStyle='#eee';ctx.textAlign='center';
    ctx.font='600 '+Math.max(14,Math.floor(w*.034))+'px system-ui';
    ctx.fillText('Не удалось отрисовать METHOD',w/2,h/2);
  }finally{ctx.restore();}
}
