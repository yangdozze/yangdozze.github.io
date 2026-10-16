/**
 * Native METHOD Bleach bridge, no additional HUD, geometry, or post-effects.
 * Source and authorship: METHOD / HiveGlobal
 * https://method.hiveglobal.org/app/#/caustic
 */
import {CausticAdapter} from './caustic-adapter.js';
let audio=null,source=0;
const renderer=new WeakMap(),lim=(v,a,b)=>Math.min(b,Math.max(a,v));
export function setBleachAudioSource(b){
 if(audio?.buffer===b||(!b&&!audio))return;
 if(!b){audio=null;source++;return;}
 const pcm=b.numberOfChannels===1?b.getChannelData(0):new Float32Array(b.length);
 if(b.numberOfChannels>1)for(let k=0;k<b.numberOfChannels;k++){
  const d=b.getChannelData(k);for(let i=0;i<b.length;i++)pcm[i]+=d[i]/b.numberOfChannels;
 }
 audio={buffer:b,pcm,rate:b.sampleRate,duration:b.duration};source++;
}
function get(canvas,landscape){
 let s=renderer.get(canvas);
 if(!s||s.landscape!==landscape){
  const native=CausticAdapter.create();
  if(landscape)native.setAspect('16:9');
  s={native,landscape,source:-1,last:-1,look:''};renderer.set(canvas,s);
 }
 return s;
}
export function renderBleach(ctx,w,h,t,p={},data={},thumb=false){
 const look=p.mode==='thermal'?'out':'disp';
 ctx.save();
 if(thumb){
  // The two original METHOD static style swatches, not extra live renderers.
  ctx.fillStyle=look==='out'?'#ff7e02':'#000';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=look==='out'?'#0b0b0b':'#6d6d6d';ctx.lineWidth=Math.max(2,w*.065);
  ctx.beginPath();ctx.moveTo(w*.06,h*.58);
  ctx.bezierCurveTo(w*.24,h*.34,w*.33,h*.34,w*.51,h*.54);
  ctx.bezierCurveTo(w*.70,h*.77,w*.75,h*.38,w*.94,h*.50);ctx.stroke();
  ctx.restore();return;
 }
 if(data.decodedAudio&&data.decodedAudio!==audio?.buffer)setBleachAudioSource(data.decodedAudio);
 ctx.fillStyle=look==='out'?'#ff7e02':'#000';ctx.fillRect(0,0,w,h);
 if(!audio){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=look==='out'?'#111':'#eee';
  ctx.font='600 '+Math.max(16,Math.round(w*.035))+'px system-ui';
  ctx.fillText('ЗАГРУЗИ АУДИО',w/2,h/2);ctx.restore();return;
 }
 try{
  const s=get(ctx.canvas,w>h);
  if(s.source!==source){s.native.setAudio(audio.pcm,audio.rate);s.source=source;s.last=-1;}
  const at=data.audioLoop?((t%audio.duration)+audio.duration)%audio.duration:lim(t,0,Math.max(0,audio.duration-.001));
  // Native two looks and the native METHOD controls. All visual drawing
  // including the trackers is performed inside CausticAdapter.frame().
  s.native.setLook(look);
  s.native.set('displacement',lim(Number(p.causticDisplacement??1),0,3));
  s.native.set('speed',lim(Number(p.causticSpeed??.97),0,3));
  s.native.set('tracker',lim(Number(p.causticTracker??.65),0,1));
  s.native.set('cap',lim(Number(p.causticCaption??17),10,26));
  if(s.look!==look)s.last=-1;
  s.look=look;
  const advance=s.last<0||at<s.last||at-s.last>=(p.exportMode?0:1/30);
  if(advance){
   s.native.frame(at,s.last<0||at<s.last?1/30:lim(at-s.last,1/240,.10));
   s.last=at;
  }
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(s.native.canvas,0,0,w,h);
  window.__METHOD_NATIVE_QA__={native:true,look,time:at,size:[s.native.canvas.width,s.native.canvas.height],source,advance};
 }catch(err){
  console.error('METHOD native render error',err);
  ctx.fillStyle='#eee';ctx.font='bold 16px system-ui';ctx.fillText('METHOD: ошибка рендера',w*.17,h*.5);
 }
 ctx.restore();
}
