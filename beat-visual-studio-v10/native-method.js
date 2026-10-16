/* Beat Visual Studio integration bridge (new). The instrument engines/adapters belong to METHOD / HiveGlobal, loaded without altering their implementations. */
const cache=new WeakMap(),monoCache=new WeakMap();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const METHOD_FAMILIES=['retro','contour','dust','spatial','volume'];
export const nativeMethodRegistry=()=>window.BVS_NATIVE_METHOD||{};
const pcmFor=(buffer)=>{let x=monoCache.get(buffer);if(x)return x;let pcm=buffer.numberOfChannels===1?buffer.getChannelData(0):new Float32Array(buffer.length);if(buffer.numberOfChannels>1){for(let c=0;c<buffer.numberOfChannels;c++){const d=buffer.getChannelData(c);for(let i=0;i<buffer.length;i++)pcm[i]+=d[i]/buffer.numberOfChannels;}}monoCache.set(buffer,pcm);return pcm;};
export function renderMethod(ctx,w,h,t,s,data={},thumb=false){
 const reg=nativeMethodRegistry(),info=reg[s.mode],look=s.methodLook||info?.defaultLook;
 ctx.save();
 if(thumb){
  const L=info?.looks?.find(l=>l.k===look)||info?.looks?.[0];
  ctx.fillStyle=L?.bg||'#101010';ctx.fillRect(0,0,w,h);
  ctx.fillStyle=L?.fg||'#c8c8c8';ctx.font='700 '+Math.max(16,Math.round(w*.16))+'px system-ui';
  ctx.textAlign='center';ctx.fillText((info?.num||'METHOD'),w/2,h*.51);
  ctx.restore();return;
 }
 const b=data.decodedAudio;if(!b){
  ctx.fillStyle='#111218';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#f5f2f3';ctx.textAlign='center';ctx.font='700 '+Math.max(16,w*.035)+'px system-ui';
  ctx.fillText('ДОБАВЬ АУДИО',w/2,h/2);ctx.restore();return;
 }
 if(!info){ctx.fillStyle='#121212';ctx.fillRect(0,0,w,h);ctx.restore();return;}
 try{
  let p=cache.get(ctx.canvas);
  if(!p||p.id!==s.mode){
   const instance=info.create();
   p={id:s.mode,instance,b:null,look:'',variant:'',paramKeys:new Map(),time:null,land:null,hq:null};
   cache.set(ctx.canvas,p);
  }
  const inst=p.instance,land=w>h;
  if(p.land!==land){inst.setAspect?.(land?'16:9':'9:16');p.land=land;p.time=null;}
  // Playback uses the adapter's original native size. HQ is optional only during export.
  const hq=!!(s.exportMode&&Math.min(w,h)>=1080);
  if(p.hq!==hq){inst.setHQ?.(hq);p.hq=hq;p.time=null;}
  if(p.b!==b){inst.setAudio(pcmFor(b),b.sampleRate);p.b=b;p.time=null;}
  if(p.look!==look){inst.setLook(look);p.look=look;p.time=null;}
  const variant=s.methodVariant||info.modes?.def;
  if(variant!==p.variant){inst.setMode?.(variant);p.variant=variant;p.time=null;}
  for(const knob of info.params||[]){
    const val=s.methodParams?.[knob.k]??(typeof knob.def==='object'?(knob.def[variant]??Object.values(knob.def)[0]):knob.def);
    if(val==null)continue;
    if(p.paramKeys.get(knob.k)!==val){inst.set(knob.k,Number(val));p.paramKeys.set(knob.k,val);p.time=null;}
  }
  const at=data.audioLoop?((t%b.duration+b.duration)%b.duration):clamp(t,0,Math.max(0,b.duration-.001));
  const changed=p.time==null||at<p.time||at-p.time>=(s.exportMode?0:1/30);
  if(changed){inst.frame(at,p.time==null?1/30:clamp(at-p.time,1/240,.1),true);p.time=at;}
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(inst.canvas,0,0,w,h);
  if(typeof window!=='undefined')window.__NATIVE_METHOD_QA__={style:s.mode,look,frameTime:at,width:inst.canvas.width,height:inst.canvas.height,updated:changed};
 }catch(error){
  console.error('METHOD '+s.mode+' renderer error',error);
  ctx.fillStyle='#121319';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f5e8e2';
  ctx.font='600 '+Math.max(16,w*.03)+'px system-ui';ctx.textAlign='center';ctx.fillText('METHOD: ошибка '+s.mode,w/2,h/2);
  if(typeof window!=='undefined')window.__NATIVE_METHOD_QA__={style:s.mode,error:String(error?.stack||error)};
 }
 ctx.restore();
}
