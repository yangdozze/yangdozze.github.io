/**
 * Beat Visual Studio v10 — independent METHOD engine host.
 * Native METHOD source: method-native-engines.js (six full audio families).
 * No Audio-to-MIDI; .mid files are parsed as actual Standard MIDI Files.
 */
import {METHOD_AUDIO_ENGINES} from './method-native-engines.js';
import {render as renderBVS} from '../beat-visual-studio-v9/render.js';
import {parseMidi} from '../beat-visual-studio-v9/midi.js';
import {audioFrame} from '../beat-visual-studio-v9/audio-frame.js';
import {exportFrameAccurate} from '../beat-visual-studio-v9/frame-export.js';

const $=id=>document.getElementById(id),stage=$('visual'),ctx=stage.getContext('2d',{alpha:false});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),fmt=n=>Math.floor(Math.max(0,n)/60)+':'+String(Math.floor(Math.max(0,n)%60)).padStart(2,'0');
const catalog=[{id:'strip',num:'00',name:'STRIP',tag:'MIDI',native:false,looks:[{k:'original',label:'Light',bg:'#faf9f3',fg:'#9876cd'}]},
{id:'night',num:'00',name:'NIGHT',tag:'MIDI + Audio',native:false,looks:[{k:'original',label:'Dark',bg:'#111018',fg:'#c79bfd'}]},
...METHOD_AUDIO_ENGINES.map(e=>({...e,native:true}))];
let activeId='strip',selectedLook='original',subMode='',params={},inst=null,instId='',instAspect='',sourceVersion=0,instSourceVersion=-1;
let midi=null,decoded=null,pcm=null,demo=null,sourceName='DEMO',ac=null,source=null,gain=null,playing=false,started=0,offset=0;
let lastDraw=0,lastClock=0,lastRenderAt=-1,renderError='',exporting=false,exportURL=null;
const catalogMap=new Map(catalog.map(x=>[x.id,x]));
const settingsKey='beat-visual-studio-v10-settings';
const saved=(()=>{try{return JSON.parse(localStorage.getItem(settingsKey))||{};}catch{return {};}})();
const getEngine=()=>catalogMap.get(activeId);
const defaults=e=>Object.fromEntries((e.params||[]).map(p=>[p.k,typeof p.def==='object'?p.def[subMode]??Object.values(p.def)[0]:p.def]));
const loadSaved=e=>{let v=saved[e.id]||{};subMode=v.subMode||e.modes?.def||'';params={...defaults(e),...v.params};selectedLook=v.look||e.defaultLook||e.looks?.[0]?.k||'original';if(!e.looks?.some(l=>l.k===selectedLook))selectedLook=e.defaultLook||e.looks?.[0]?.k||'original';};
const persist=()=>{saved[activeId]={look:selectedLook,params:{...params},subMode};try{localStorage.setItem(settingsKey,JSON.stringify(saved));}catch{}};
function status(msg,bad=false){$('status').textContent=msg;$('status').classList.toggle('error',bad);}
function getAspect(){return $('aspect').value;}
function bufferDuration(){return decoded?.duration||midi?.duration||demo.duration;}
function pcmForEngine(){return decoded?pcm:!midi?demo.getChannelData(0):null;}
function lengthForEngine(){return decoded?.duration||(!midi?demo.duration:midi.duration);}
function displayTime(){return playing?(ac?Math.min(bufferDuration(),offset+Math.max(0,ac.currentTime-started)):offset):offset;}
function demoAudio(){
 const sr=44100,dur=12,b=new AudioBuffer({numberOfChannels:1,sampleRate:sr,length:sr*dur});
 const p=b.getChannelData(0);let seed=19003;
 for(let i=0;i<p.length;i++){
  const t=i/sr,k=t%(.5),sn=(t+.25)%(.5),h=t%(.125);
  seed=(Math.imul(seed,1664525)+1013904223)|0;
  const noise=((seed>>>8)&65535)/32768-1;
  const kick=.76*Math.sin(2*Math.PI*(50+45*Math.exp(-k*26))*k)*Math.exp(-k*17);
  const snare=.22*noise*Math.exp(-sn*52);
  const hat=.055*noise*Math.exp(-h*115);
  const bass=.13*Math.sin(2*Math.PI*110*t);
  p[i]=Math.tanh((kick+snare+hat+bass)*1.4);
 }
 return b;
}
demo=demoAudio();
function stop(reset=false){
 if(source){try{source.stop();}catch{}source.disconnect();source=null;}
 if(playing){offset=displayTime();playing=false;}
 if(reset)offset=0;
 $('play').textContent='▶';
}
async function audioContext(){if(!ac){ac=new (window.AudioContext||window.webkitAudioContext)();gain=ac.createGain();gain.connect(ac.destination);}if(ac.state==='suspended')await ac.resume();return ac;}
async function play(){
 if(exporting)return;
 if(playing){stop();return;}
 if(offset>=bufferDuration()-.01)offset=0;
 const b=decoded||(!midi?demo:null);
 if(b){
  const context=await audioContext();
  source=context.createBufferSource();source.buffer=b;source.connect(gain);
  started=context.currentTime;source.start(0,Math.max(0,Math.min(offset,b.duration-.001)));
 }else started=performance.now()/1000;
 playing=true;$('play').textContent='Ⅱ';
}
function timeNow(){
 if(!playing)return offset;
 if(ac&&source)return offset+Math.max(0,ac.currentTime-started);
 return offset+Math.max(0,performance.now()/1000-started);
}
function dispose(){
 // Native instances can own large WebGL buffers. Release their context
 // when changing engines rather than retaining multiple GPU scenes.
 if(inst){
  try{const gl=inst.canvas.getContext('webgl2');if(gl){const ext=gl.getExtension('WEBGL_lose_context');ext?.loseContext();}}catch{}
 }
 inst=null;instId='';instSourceVersion=-1;lastRenderAt=-1;
}
function setSourceToInstance(instance){
 const p=pcmForEngine();
 if(!p){return false;}
 instance.setAudio?.(p,decoded?decoded.sampleRate:demo.sampleRate);
 return true;
}
function setupInstance(forExport=false){
 const e=getEngine();if(!e.native)return null;
 let engine;
 try{
  engine=e.create();
  if(engine.setAspect)engine.setAspect(getAspect());
  setSourceToInstance(engine);
  if(engine.setHQ)engine.setHQ(false);
  for(const p of e.params||[]){
   if(!(p.k in params))continue;
   try{engine.set(p.k,params[p.k]);}catch(error){console.warn('METHOD parameter',e.id,p.k,error);}
  }
  engine.setLook?.(selectedLook);
  if(e.modes&&subMode)engine.setMode?.(subMode);
 }catch(error){
  console.error('METHOD initialization',e.id,error);
  if(!forExport)status('Не удалось запустить '+e.name+': '+(error?.message||error),true);
  try{engine?.canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
  if(forExport)throw error;
  return null;
 }
 return engine;
}
function ensureInstance(){
 const e=getEngine();
 if(!e.native)return null;
 if(!inst||instId!==e.id||instAspect!==getAspect()){
   dispose();inst=setupInstance();instId=e.id;instAspect=getAspect();instSourceVersion=sourceVersion;
 }
 if(inst&&instSourceVersion!==sourceVersion){setSourceToInstance(inst);instSourceVersion=sourceVersion;lastRenderAt=-1;}
 return inst;
}
function settingsBVS(){
 const night=activeId==='night';
 return {mode:activeId,bpm:midi?.bpm||120,key:'A minor',title:'BEAT VISUAL STUDIO',artist:'yangdozze',
  accent:night?'#b084ea':'#9571d8',background:night?'#111018':'#faf7ef',ink:night?'#e6dcf7':'#202025',
  scale:1,noteFocus:0,safeProfile:'creator',react:1,offset:0,midiLoop:8,loopMidi:true,labels:false};
}
function bvsData(t){
 let a;if(decoded||!midi){try{a=audioFrame(decoded||demo,t,false);}catch{a=null;}}
 return {...(a||{freq:new Uint8Array(1024),wave:new Float32Array(2048),waveR:new Float32Array(2048),energy:0}),
   notes:midi?.notes||[],midiDuration:midi?.duration||16,audioDuration:(decoded||demo).duration,
   audioFeatures:null,audioPeaks:null,audioLoop:false};
}
function paintEffects(targetCtx,w,h,img){
 targetCtx.save();
 const bright=Number($('brightness').value),contrast=Number($('contrast').value),negative=$('negative').checked;
 targetCtx.filter='brightness('+bright+'%) contrast('+contrast+'%)'+(negative?' invert(1)':'');
 targetCtx.drawImage(img,0,0,w,h);
 targetCtx.restore();
}
const fxCanvas=document.createElement('canvas'),fxCtx=fxCanvas.getContext('2d',{alpha:false});
function renderFrame(targetCtx,w,h,t,engine=null,dt=1/30){
 const e=getEngine();
 targetCtx.fillStyle='#000';targetCtx.fillRect(0,0,w,h);
 if(!e.native){
  const scratch=document.createElement('canvas');scratch.width=w;scratch.height=h;
  renderBVS(scratch.getContext('2d',{alpha:false}),w,h,t,settingsBVS(),bvsData(t));
  paintEffects(targetCtx,w,h,scratch);return;
 }
 if(!pcmForEngine()){
  targetCtx.fillStyle='#fff';targetCtx.textAlign='center';targetCtx.font=Math.max(16,w*.035)+'px system-ui';
  targetCtx.fillText('ЗАГРУЗИ АУДИО ДЛЯ METHOD',w/2,h/2);return;
 }
 const instRef=engine||ensureInstance();
 if(!instRef)return;
 instRef.frame(t,Math.max(1/240,Math.min(.1,dt)),playing);
 paintEffects(targetCtx,w,h,instRef.canvas);
 if(!engine)window.__BVS_V10_QA__={id:e.id,look:selectedLook,t,canvas:[w,h],
  native:[instRef.canvas.width,instRef.canvas.height],source:decoded?'real-audio':!midi?'synthetic-demo':'midi-only'};
}
function redraw(force=false,tOverride){
 const t=tOverride??timeNow();
 const W=stage.width,H=stage.height;
 if(!force&&Math.abs(t-lastRenderAt)<1/32)return;
 const now=performance.now(),dt=lastRenderAt<0?1/30:Math.abs(t-lastRenderAt)||1/30;
 try{renderFrame(ctx,W,H,t,null,dt);renderError='';}
 catch(e){renderError=String(e);console.error(e);status('Рендер: '+(e.message||e),true);}
 lastRenderAt=t;
 $('clock').textContent=fmt(t)+' / '+fmt(bufferDuration());
 $('seek').max=bufferDuration();$('seek').value=Math.min(bufferDuration(),t);
 if(force||now-lastClock>1000){$('perf').textContent='Preview · '+getEngine().name+' · '+Math.round(now-lastDraw||0)+'ms';lastClock=now;}
 lastDraw=now;
}
function tick(){
 if(!exporting){
  if(playing&&timeNow()>=bufferDuration()){stop();offset=bufferDuration();}
  const t=performance.now();
  if(t-lastDraw>1000/30)redraw(false);
 }
 requestAnimationFrame(tick);
}
function resize(){
 let land=getAspect()==='16:9';
 stage.width=land?960:540;stage.height=land?540:960;
 stage.style.aspectRatio=land?'16/9':'9/16';
 $('canvasSize').textContent=getAspect()+' · '+stage.width+'×'+stage.height;
 instAspect='';redraw(true);
}
function showFamily(){
 const e=getEngine();
 $('modeName').textContent=(e.num||'00')+' / '+e.name.toUpperCase();
 $('controlTitle').textContent=e.name+' — original controls';
 $('engineInfo').textContent=e.native?'METHOD / '+e.tag+' · оригинальная схема параметров':'Существующий режим v9, доступна загрузка MIDI.';
 $('originalPanel').hidden=!e.native;
 $('families').replaceChildren(...catalog.map(x=>{
  const b=document.createElement('button');b.className='family'+(x.id===activeId?' selected':'');
  b.innerHTML='<span class="n">'+x.num+' / '+(x.native?'METHOD':'BVS')+'</span><strong>'+x.name+'</strong><span class="tag">'+x.tag+'</span>';
  b.onclick=()=>{stop();activeId=x.id;loadSaved(x);dispose();showFamily();redraw(true);};return b;
 }));
 $('styleCount').textContent=catalog.length+' engines';
 const looks=e.looks||[];
 $('looks').replaceChildren(...looks.map(l=>{
  const b=document.createElement('button');b.className='look'+(l.k===selectedLook?' selected':'');
  b.innerHTML='<div class="swatch"></div><span></span>';
  b.querySelector('.swatch').style.setProperty('--swbg',l.bg||'#080808');
  b.querySelector('.swatch').style.setProperty('--swfg',l.fg||'#bdbdc5');
  b.querySelector('span').textContent=l.label;
  b.onclick=()=>{selectedLook=l.k;
   if(e.id==='retro'&&e.modes?.looks){const m=Object.entries(e.modes.looks).find(([k,v])=>v===l.k);if(m)subMode=m[0];}
   persist();dispose();showFamily();redraw(true);};
  return b;
 }));
 const modeWrap=$('modeSelectWrap'),select=$('modeSelect');
 modeWrap.hidden=!e.modes;select.replaceChildren();
 if(e.modes){
  $('modeSelectTitle').textContent=e.modes.label;
  for(const opt of e.modes.options||[]){const o=document.createElement('option');o.value=opt.v;o.textContent=opt.label;select.append(o);}
  select.value=subMode||e.modes.def||'';
 }
 buildParams(e);
}
function formatValue(p,val){
 if(typeof val==='string')return val;
 if(p.fmt){try{return p.fmt(val)}catch{}}
 return p.int?String(Math.round(val)):Number(val).toFixed(2);
}
function buildParams(e){
 const major=$('knobs'),advanced=$('advancedKnobs');major.replaceChildren();advanced.replaceChildren();
 let extras=0;
 for(const p of e.params||[]){
  if(p.modes&&p.modes.length&&!p.modes.includes(selectedLook))continue;
  if(typeof params[p.k]!=='number')continue;
  const root=document.createElement('div');root.className='knob';
  const top=document.createElement('div');top.className='knob-line';
  const label=document.createElement('label'),out=document.createElement('output');
  label.textContent=p.label||p.k;out.textContent=formatValue(p,params[p.k]);top.append(label,out);
  const input=document.createElement('input');input.type='range';input.min=p.min??0;input.max=p.max??2;
  input.step=p.int?'1':String(Math.max(.001,(Number(input.max)-Number(input.min))/300));
  input.value=params[p.k];input.setAttribute('aria-label',p.label||p.k);
  input.oninput=()=>{
   const v=p.int?Math.round(+input.value):+input.value;params[p.k]=v;
   out.textContent=formatValue(p,v);persist();
   if(inst){
    try{inst.set(p.k,v);if(e.id==='retro')lastRenderAt=-1;}catch(err){status('Параметр '+p.label+': '+err.message,true);}
   }
   redraw(true);
  };
  root.append(top,input);
  if(p.hint)root.title=p.hint;
  const isMain=!!p.tier;
  (isMain?major:advanced).append(root);if(!isMain)extras++;
 }
 $('advCount').textContent='('+extras+')';
 $('advanced').hidden=!extras;
 if(!major.children.length&&advanced.children.length){const el=advanced.firstElementChild;major.append(el);}
}
function updateSourceInfo(){
 const s=decoded?'АУДИО · '+sourceName+' · '+bufferDuration().toFixed(1)+' сек':midi?'MIDI · '+midi.notes.length+' нот · '+midi.bpm+' BPM':'DEMO · синтетический бит для предпросмотра, не запись твоего аудио';
 status(s,false);$('seek').max=bufferDuration();$('duration').max=bufferDuration();$('duration').value=Math.min(8,Math.round(bufferDuration()));
}
function applyPost(){
 $('brightnessVal').textContent=$('brightness').value+'%';$('contrastVal').textContent=$('contrast').value+'%';
 redraw(true);
}
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function exportVideo(){
 if(exporting)return;
 let buffer=decoded||(!midi?demo:null);
 if(!buffer){status('Для экспорта со звуком загрузи WAV/MP3.',true);return;}
 exporting=true;stop();$('exportVideo').disabled=true;
 $('exportProgress').hidden=false;$('exportProgress').value=0;
 try{
  const e=getEngine(),portrait=getAspect()==='9:16',scale=+$('resolution').value,
   w=portrait?scale:Math.round(scale*16/9),h=portrait?Math.round(scale*16/9):scale;
  const fps=+$('fps').value,dur=Math.min(buffer.duration,Math.max(1,+$('duration').value||8));
  $('exportStatus').textContent='Создаю '+Math.round(dur*fps)+' кадров, без захвата экрана…';
  const originalInstance=inst,origId=instId,origAsp=instAspect,origVersion=instSourceVersion;
  const offline=e.native?setupInstance(true):null;
  try{
   let last=-1;
   const video=await exportFrameAccurate({audioBuffer:buffer,canvasWidth:w,canvasHeight:h,
    fps,start:0,duration:dur,loopAudio:false,volume:1,cancelled:()=>false,
    renderAt:(c,t)=>{renderFrame(c,w,h,t,offline,last<0?1/fps:Math.max(1/240,t-last));last=t;},
    progress:v=>{$('exportProgress').value=Math.round(v*100);$('exportStatus').textContent='Рендер '+Math.round(v*100)+'%';}
   });
   saveBlob(video.blob,'BeatVisual_'+activeId+'_'+selectedLook+'_'+fps+'fps.'+video.ext);
   $('exportStatus').textContent='Готово: '+video.frames+' кадров, '+(video.blob.size/1048576).toFixed(1)+' МБ ('+video.ext.toUpperCase()+').';
  }finally{
   if(offline){try{offline.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()}catch{}}
   inst=originalInstance;instId=origId;instAspect=origAsp;instSourceVersion=origVersion;
  }
 }catch(error){
  console.error(error);$('exportStatus').textContent='Экспорт не удался: '+(error?.message||error);
 }finally{
  exporting=false;$('exportVideo').disabled=false;$('exportProgress').hidden=true;redraw(true);
 }
}
$('play').onclick=()=>play().catch(e=>status('Воспроизведение: '+e.message,true));
$('rewind').onclick=()=>{stop(true);redraw(true);};
$('seek').oninput=()=>{
 const t=+$('seek').value;if(playing){stop();offset=t;play().catch(e=>status(e.message,true));}else offset=t;
 redraw(true);
};
$('audioFile').onchange=async ev=>{
 const f=ev.target.files[0];if(!f)return;stop(true);if(f.size>160*1024*1024){status('Максимальный размер аудио — 160 МБ',true);return;}
 try{
  const c=await audioContext();const b=await c.decodeAudioData(await f.arrayBuffer());
  decoded=b;sourceName=f.name;pcm=b.numberOfChannels===1?b.getChannelData(0):new Float32Array(b.length);
  if(b.numberOfChannels>1)for(let n=0;n<b.numberOfChannels;n++){
   const ch=b.getChannelData(n);for(let i=0;i<pcm.length;i++)pcm[i]+=ch[i]/b.numberOfChannels;
  }
  sourceVersion++;dispose();$('audioName').textContent=f.name;updateSourceInfo();redraw(true);
 }catch(error){status('Ошибка аудио: '+(error?.message||error),true);}
};
$('midiFile').onchange=async ev=>{
 const f=ev.target.files[0];if(!f)return;
 try{midi=parseMidi(await f.arrayBuffer());$('midiName').textContent=f.name;sourceVersion++;
  stop(true);if(!decoded){dispose();}updateSourceInfo();redraw(true);
 }catch(error){status('Ошибка MIDI: '+(error?.message||error),true);}
};
$('aspect').onchange=()=>{dispose();resize();};
$('modeSelect').onchange=()=>{subMode=$('modeSelect').value;persist();dispose();redraw(true);};
$('resetParams').onclick=()=>{params=defaults(getEngine());subMode=getEngine().modes?.def||'';persist();dispose();showFamily();redraw(true);};
for(const id of ['brightness','contrast','negative'])$(id).oninput=applyPost;
$('exportVideo').onclick=exportVideo;
$('exportPNG').onclick=()=>{stage.toBlob(b=>b&&saveBlob(b,'BeatVisual_'+activeId+'_'+fmt(timeNow()).replace(':','-')+'.png'),'image/png');};
$('fullscreen').onclick=()=>{
 $('stage').classList.add('immersive');document.body.classList.add('full-mode');
 $('exitFullscreen').hidden=false;$('fullscreen').hidden=true;
};
$('exitFullscreen').onclick=()=>{
 $('stage').classList.remove('immersive');document.body.classList.remove('full-mode');
 $('exitFullscreen').hidden=true;$('fullscreen').hidden=false;
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('exitFullscreen').click();});
$('presetSave').onclick=()=>{
 const preset={app:'Beat Visual Studio v10',version:1,engine:activeId,look:selectedLook,mode:subMode,params,
  aspect:getAspect(),brightness:+$('brightness').value,contrast:+$('contrast').value,negative:$('negative').checked};
 saveBlob(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}),'BVS10_'+activeId+'.json');
};
$('presetLoad').onchange=async ev=>{
 try{
  const j=JSON.parse(await ev.target.files[0].text());
  if(!catalogMap.has(j.engine)||!j.params||typeof j.params!=='object')throw Error('Неподдерживаемый формат пресета');
  activeId=j.engine;loadSaved(getEngine());
  if(getEngine().looks?.some(x=>x.k===j.look))selectedLook=j.look;
  subMode=j.mode||subMode;
  for(const p of getEngine().params||[])if(typeof j.params[p.k]==='number')
   params[p.k]=clamp(j.params[p.k],p.min??0,p.max??2);
  if(['9:16','16:9'].includes(j.aspect))$('aspect').value=j.aspect;
  if(Number.isFinite(j.brightness))$('brightness').value=j.brightness;
  if(Number.isFinite(j.contrast))$('contrast').value=j.contrast;
  $('negative').checked=!!j.negative;persist();stop(true);dispose();showFamily();resize();applyPost();
  status('Пресет загружен: '+j.engine);
 }catch(error){status('Ошибка JSON: '+error.message,true);}
};
$('canvasSize').textContent='9:16 · 540×960';
loadSaved(getEngine());showFamily();updateSourceInfo();redraw(true);requestAnimationFrame(tick);
