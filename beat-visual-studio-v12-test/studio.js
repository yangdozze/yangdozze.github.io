import {exportFrameAccurate} from '../beat-visual-studio-v10/frame-export.js';
import {parseMidi} from '../beat-visual-studio-v9/midi.js';
import {render as renderClassic} from '../beat-visual-studio-v9/render.js';
const $=id=>document.getElementById(id), M=window.METHOD_V10;
const state={id:null,instance:null,audioBuffer:null,pcm:null,rate:44100,source:null,clock:0,start:0,started:false,context:null,position:0,duration:0,lastT:0,mode:null,look:null,params:{},aspect:'9:16',busy:false,rendering:false,midiFile:null,midiMeta:null,peaks:null,renderErr:null};
// Existing VISUALZI v9 scenes stay available next to original METHOD adapters.
const costOf=id=>['contour','dust','spatial','volume','scope'].includes(id)?'heavy':id==='dancer'?'medium':'light';
const classicPresets={
 strip:{background:'#faf9f4',accent:'#8051bc',ink:'#342b3c'},
 night:{background:'#0d0d13',accent:'#b987f0',ink:'#f0e1ff'}
};
const classicSpecs=['strip','night'].map((id,i)=>({
 id,num:'V'+(i+1),name:id.toUpperCase(),tag:'MIDI + AUDIO',source:'VISUALZI v9',cost:'light',
 looks:[{k:'original',label:id==='strip'?'Paper / Lavender':'Dark / Purple',bg:classicPresets[id].background,fg:classicPresets[id].accent}],
 defaultLook:'original',params:[
  {k:'react',label:'Реакция аудио',min:0.2,max:2.5,def:1,tier:1},
  {k:'noteFocus',label:'Ширина MIDI области',min:12,max:36,def:20,tier:1,int:true},
  {k:'scale',label:'Масштаб',min:0.7,max:1.4,def:1,tier:1}
 ],
 create(){
  const c=document.createElement('canvas');c.width=540;c.height=960;
  const g=c.getContext('2d',{alpha:false});
  let settings={...classicPresets[id],mode:id,react:1,noteFocus:20,scale:1,midiLoop:16,loopMidi:true,safeProfile:'creator',labels:true,artist:'',title:'BEAT',bpm:120,key:'—'};
  let pcm=null,rate=44100;
  return {canvas:c,setAudio(p,r){pcm=p;rate=r;},
   useMidiFile:async f=>{const info=parseMidi(await f.arrayBuffer());state.midiMeta=info;settings.bpm=info.bpm;settings.midiLoop=info.duration;},
   setAspect(a){c.width=a==='16:9'?960:540;c.height=a==='16:9'?540:960;},
   set(k,v){settings[k]=v;},setLook(){},
   frame(t){const m=state.midiMeta;
    const data={notes:m?.notes||[],midiDuration:m?.duration||0,audioPeaks:state.peaks||[],audioDuration:state.audioBuffer?.duration||0,audioLoop:false,energy:0};
    renderClassic(g,c.width,c.height,t,settings,data);
   },
   dispose(){c.width=1;c.height=1}
  };
 }
}));
const specs=[...classicSpecs,...(M?.ENGINES||[])];
const classifications={strip:['midi','audio'],night:['midi','audio'],midi:['midi'],retro:['audio'],caustic:['audio'],contour:['audio'],dust:['audio'],spatial:['audio'],volume:['audio'],dancer:['audio'],grid:['audio','midi'],pads:['audio','midi'],scope:['audio']};
const engineNote={strip:'MIDI и звук',night:'MIDI и звук',midi:'Ноты из .mid',retro:'Глифы и линии',caustic:'Displaced / Thermal',contour:'Ткань и движение',dust:'Частицы',spatial:'Тяжёлая 3D-сцена',volume:'Тяжёлая 3D-сцена',dancer:'3D персонаж',grid:'Ритм / MIDI + звук',pads:'MPC / MIDI + звук',scope:'Осциллограф'};
let activeFilter='audio',previewLastPaint=0,lastPaintPosition=-1,manualDraw=false,renderSlowWarning=false,previewBlocked=false,autoReductionMs=0;
function markDirty(){previewLastPaint=0;lastPaintPosition=-1;if(state.instance)state.instance._dirty=true;}
function setPerfNote(msg){$('previewAlert').textContent=msg;}
function buildPeaks(pcm,blocks=1400){
 const result=new Array(blocks),chunk=Math.max(1,Math.ceil(pcm.length/blocks));
 for(let n=0;n<blocks;n++){let lo=0,hi=0;for(let i=n*chunk;i<Math.min(pcm.length,(n+1)*chunk);i+=3){let x=pcm[i];if(x<lo)lo=x;if(x>hi)hi=x;}
  result[n]={leftMin:lo,leftMax:hi,rightMin:lo,rightMax:hi};}
 return result;
}
function releasePrevious(inst){if(!inst)return;try{inst.dispose?.()}catch(e){console.warn(e)}
 // Releasing an abandoned WebGL context avoids accumulation after switching effects.
 try{const gl=inst.canvas?.getContext('webgl2');gl?.getExtension('WEBGL_lose_context')?.loseContext()}catch(e){}
}
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const say=(msg,isError=false)=>{$('message').textContent=msg;$('message').style.color=isError?'#a33636':'#7a7381'};
const labelTime=n=>{n=Math.max(0,n||0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0')};
const current=()=>state.started?clamp(state.position+((state.audioBuffer&&state.context)?state.context.currentTime:performance.now()/1000)-state.start,0,state.duration):state.position;
const selected=()=>specs.find(x=>x.id===state.id);
function configureCanvas(){
 const land=state.aspect==='16:9',w=land?960:540,h=land?540:960;
 const c=$('canvas');c.width=w;c.height=h;
 $('stage').style.aspectRatio=land?'16/9':'9/16';
 if(state.instance?.setAspect)try{state.instance.setAspect(state.aspect)}catch(e){say('Формат: '+e.message,true)}
}
function applyParam(p,value){
 const inst=state.instance;
 const v=typeof value==='number'?value:typeof p.min==='number'?Number(value):value;
 state.params[p.k]=v;if(!inst?.set){markDirty();return;}
 try{inst.set(p.k,v);markDirty()}catch(e){say(p.label+': '+e.message,true)}
}
function fillSelect(select,options,value){select.replaceChildren();for(const p of options){const o=document.createElement('option');o.value=p.v??p.k;o.textContent=p.label||p.name||o.value;select.append(o)}select.value=value}
function controls(){
 const spec=selected();if(!spec)return;
 $('settingTitle').textContent=spec.name+' / '+(spec.num||'');
 fillSelect($('look'),spec.looks||[],state.look);
 const mode=spec.modes; $('modeRow').hidden=!mode;
 if(mode)fillSelect($('mode'),mode.options||[],state.mode);
 const host=$('params');host.replaceChildren();
 const groups=new Map();
 for(const p of spec.params||[]){
  if(p.modes&&state.mode&&!p.modes.includes(state.mode)&&!p.modes.includes(state.look))continue;
  const key=p.group||((p.tier===1||p.tier===2)?'Основные':'Дополнительно');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 for(const [name,ps] of groups){
  const section=document.createElement('section');section.className='param-group';
  const head=document.createElement('h3');head.textContent=name;section.append(head);
  for(const p of ps){
   const wrap=document.createElement('label');wrap.className='control';wrap.textContent=p.label||p.k;
   const choices=p.choices||(p.options||null);
   const def=state.params[p.k];
   if(choices||typeof def==='string'){
    const sel=document.createElement('select');
    const opts=choices||[{v:def,label:def}];
    fillSelect(sel,opts,def);sel.onchange=()=>applyParam(p,sel.value);wrap.append(sel);
   }else if(typeof p.min==='number'&&typeof p.max==='number'){
    const out=document.createElement('output');wrap.append(out);
    const input=document.createElement('input');input.type='range';input.min=p.min;input.max=p.max;
    input.step=p.int?'1':Math.max(.001,(p.max-p.min)/300);input.value=Number(def)||0;
    const fmt=v=>{try{return p.fmt?p.fmt(Number(v)):Number(v).toFixed(p.int?0:2)}catch{return String(v)}};
    out.textContent=fmt(input.value);
    input.oninput=()=>{out.textContent=fmt(input.value);applyParam(p,Number(input.value))};wrap.append(input);
   }else{const info=document.createElement('small');info.textContent=String(def??'');wrap.append(info)}
   if(p.hint)wrap.title=p.hint;
   section.append(wrap);
  }
  host.append(section);
 }
}
function stop(){
 if(state.source){try{state.source.stop()}catch{}state.source.disconnect();state.source=null}
 state.position=current();state.started=false;$('play').textContent='▶'
}
async function pickEngine(id,force=false){
 if(state.busy)return;
 stop();
 const E=specs.find(x=>x.id===id);if(!E)return;
 const priorParams=force&&state.id===id?{...state.params}:null;
 releasePrevious(state.instance);state.instance=null;state.id=id;window.App.vid=id;state.lastT=0;state.renderErr=null;previewBlocked=false;renderSlowWarning=false;autoReductionMs=0;state.mode=E.modes?.def||null;state.look=E.defaultLook||E.looks?.[0]?.k;
 state.params={};for(const p of E.params||[])state.params[p.k]=M.defOf(p,state.mode);
 if(priorParams)Object.assign(state.params,priorParams);
 $('engineStatus').textContent='Загрузка '+E.name;
 if(costOf(id)==='heavy'&&!force){
  configureCanvas();controls();$('overlay').hidden=false;
  $('overlay').textContent='Тяжёлый стиль. Нажми «Обновить кадр» для разовой отрисовки.';
  $('engineStatus').textContent=E.num+' / '+E.name;
  say(E.name+': предпросмотр отключён до ручного запроса, чтобы не подвешивать сайт.');
  setPerfNote('ТЯЖЁЛЫЙ ЭФФЕКТ · кадр по запросу');
  for(const el of document.querySelectorAll('.engine'))el.classList.toggle('active',el.dataset.id===id);
  return;
 }
 try{
  const inst=E.create();state.instance=inst;markDirty();
  configureCanvas();
  if(inst.setMode&&state.mode)inst.setMode(state.mode);
  inst.setLook?.(state.look);
  if(inst.set)for(const p of E.params||[])try{applyParam(p,state.params[p.k])}catch{}
  if(state.pcm && id!=='midi') await setAudioOnEngine();
  if(state.midiFile && inst.useMidiFile && (id==='midi'||id==='strip'||id==='night'||(state.pcm&&['grid','pads'].includes(id)))) await inst.useMidiFile(state.midiFile);
  if(costOf(id)==='heavy')setPerfNote('3D · для защиты от зависаний включи кадр вручную');else setPerfNote('ЭКО · предпросмотр без лишней нагрузки');
  controls();
  $('overlay').hidden=true;
  $('engineStatus').textContent=E.num+' / '+E.name;
  say('Движок '+E.name+' подключён. '+(state.pcm?'Аудио загружено.':'Добавь WAV/MP3 для реакции на звук.'));
 }catch(err){state.instance=null;$('overlay').hidden=false; $('overlay').textContent='Движок недоступен: '+(err.message||err);say(String(err?.stack||err).slice(0,160),true)}
 for(const el of document.querySelectorAll('.engine'))el.classList.toggle('active',el.dataset.id===id);markDirty();
}
async function setAudioOnEngine(){
 if(!state.instance||!state.pcm||state.id==='midi')return;
 $('engineStatus').textContent='Анализ аудио…';
 try{await state.instance.setAudio(state.pcm,state.rate)}
 catch(e){say('Ошибка анализа: '+e.message,true)}
 $('engineStatus').textContent=selected()?.num+' / '+selected()?.name;
}
async function loadAudio(file){
 stop();state.busy=true;say('Декодирование '+file.name+'…');
 try{
  const ctx=state.context||new (window.AudioContext||window.webkitAudioContext)();
  state.context=ctx;const b=await ctx.decodeAudioData(await file.arrayBuffer());
  state.audioBuffer=b;state.rate=b.sampleRate;state.duration=b.duration;state.position=0;
  const mono=new Float32Array(b.length);
  for(let ch=0;ch<b.numberOfChannels;ch++){const samples=b.getChannelData(ch);for(let i=0;i<mono.length;i++)mono[i]+=samples[i]/b.numberOfChannels}
  state.pcm=mono;state.peaks=buildPeaks(mono);M.audio._set(mono,b.sampleRate,b,file.name,true);
  $('fileName').textContent=file.name+' · '+labelTime(b.duration);$('play').disabled=false;
  await setAudioOnEngine();markDirty();say('Готово · '+file.name+' · '+b.sampleRate+' Гц');
 }catch(e){say('Ошибка файла: '+e.message,true)}
 finally{state.busy=false}
}
async function useDemo(){
 const d=M.makeDemoBeat(),ctx=state.context||new (window.AudioContext||window.webkitAudioContext)();state.context=ctx;
 const b=ctx.createBuffer(1,d.pcm.length,d.sr);b.copyToChannel(d.pcm,0);state.busy=true;
 try{stop();state.audioBuffer=b;state.pcm=d.pcm;state.rate=d.sr;state.duration=b.duration;state.position=0;state.peaks=buildPeaks(d.pcm);M.audio._set(d.pcm,d.sr,b,'METHOD demo beat',true);
  $('fileName').textContent='METHOD demo beat · '+labelTime(state.duration);$('play').disabled=false;
  await setAudioOnEngine();markDirty();say('Загружено демо-аудио METHOD (реальный PCM)')}
 finally{state.busy=false}
}
function drawAt(ctx,t,preview=true){
 const W=ctx.canvas.width,H=ctx.canvas.height;
 ctx.save();ctx.fillStyle='#08080a';ctx.fillRect(0,0,W,H);
 if(state.instance){
  try{
   const dt=state.lastT&&t>=state.lastT?clamp(t-state.lastT,1/240,.1):1/30;
   state.instance.frame(t,dt,state.id==='midi'?false:(state.started||!preview));
   const brightness=$('brightness').value,contrast=$('contrast').value,saturation=$('saturation').value;
   ctx.filter='brightness('+brightness+'%) contrast('+contrast+'%) saturate('+saturation+'%)';
   const c=state.instance.canvas;if(c?.width&&c?.height)ctx.drawImage(c,0,0,W,H);
   ctx.filter='none';
   if(preview)state.lastT=t;
  }catch(e){if(!state.renderErr||state.renderErr!==String(e)){state.renderErr=String(e);say('Движок: '+e.message,true);console.error(e)}}
 }
 ctx.restore();
}
// Only draw when the picture can actually change; no 60 Hz heavy rendering while paused.
function loop(wallTime){
 requestAnimationFrame(loop);
 const t=current(),hasMedia=!!(state.audioBuffer||state.midiMeta);
 if(state.duration&&t>=state.duration&&state.started){stop();state.position=state.duration;}
 $('clock').textContent=labelTime(t)+' / '+labelTime(state.duration);
 $('seek').value=state.duration?Math.round(t/state.duration*1000):0;
 if(document.hidden||state.busy||state.rendering||!state.instance||(!hasMedia&&!manualDraw))return;
 const cost=costOf(state.id),mode=$('previewMode').value;
 if(cost==='heavy'&&!manualDraw)return; // Never auto-render known slow engines, even on Balanced.
 if((mode==='still'||cost==='heavy'||previewBlocked)&&!manualDraw)return;
 const nativeDirty=!!state.instance._dirty;
 if(!state.started&&!manualDraw&&!nativeDirty&&lastPaintPosition===t)return;
 const baseRate=mode==='balanced'?{light:30,medium:12,heavy:1}:{light:20,medium:5,heavy:0.25};
 let interval=Math.max(1000/baseRate[cost],autoReductionMs);
 if(!manualDraw&&wallTime-previewLastPaint<interval)return;
 const start=performance.now();
 drawAt($('canvas').getContext('2d',{alpha:false}),t);
 const elapsed=performance.now()-start;
 $('performanceMs').textContent=Math.round(elapsed)+' мс / кадр';
 state.instance._dirty=false;lastPaintPosition=t;previewLastPaint=performance.now();manualDraw=false;
 if(elapsed>180){
  autoReductionMs=Math.min(2500,Math.max(380,elapsed*3));
  if(cost==='heavy'&&elapsed>450){previewBlocked=true;setPerfNote('Этот 3D-движок нагружает устройство · автообновление остановлено');}
  else setPerfNote('Автоснижение FPS: кадр '+Math.round(elapsed)+' мс');
 }else if(!previewBlocked){autoReductionMs=Math.max(0,autoReductionMs*.8);setPerfNote('ЭКО · кадр '+Math.round(elapsed)+' мс');}
}
$('renderNow').onclick=async()=>{
 if(!state.instance&&state.id&&costOf(state.id)==='heavy'){
  say('Загрузка 3D-движка · может занять несколько секунд…');await pickEngine(state.id,true);
 }
 if(!state.instance){say('Сначала выбери движок и загрузи аудио.',true);return;}
 manualDraw=true;previewBlocked=false;previewLastPaint=0;markDirty();
};
$('previewMode').onchange=()=>{previewBlocked=false;autoReductionMs=0;markDirty();if(costOf(state.id)==='heavy')setPerfNote('3D-движок · один кадр может занимать несколько секунд');};
$('look').onchange=()=>{state.look=$('look').value;try{state.instance?.setLook(state.look);markDirty()}catch(e){say(e.message,true)}};
$('mode').onchange=()=>{state.mode=$('mode').value;state.instance?.setMode?.(state.mode);controls();markDirty()};
$('aspect').onchange=()=>{state.aspect=$('aspect').value;configureCanvas();markDirty()};
$('audio').onchange=e=>{if(e.target.files?.[0])loadAudio(e.target.files[0])};
$('midi').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  const parsed=parseMidi(await file.arrayBuffer()); // true SMF, never audio transcription
  state.midiFile=file;state.midiMeta=parsed;markDirty();
  if(!state.audioBuffer){stop();state.duration=parsed.duration;state.position=0;$('play').disabled=false;}
  if(!state.instance?.useMidiFile || (!state.audioBuffer&&!['midi','strip','night'].includes(state.id))) await pickEngine('midi');
  else await state.instance.useMidiFile(file);
  $('fileName').textContent=(state.audioBuffer?$('fileName').textContent+' + ':'')+file.name+' · '+parsed.notes.length+' нот';
  markDirty();say('MIDI: '+file.name+' · '+parsed.notes.length+' настоящих нот · '+parsed.duration.toFixed(2)+' c. Конвертера Audio-to-MIDI нет.');
 }catch(err){say('Ошибка MIDI: '+err.message,true)}
};
$('demo').onclick=()=>useDemo();
$('play').onclick=async()=>{
 if(state.started){stop();return}
 if(!state.audioBuffer && !state.midiMeta)return;
 if(!state.audioBuffer){if(state.position>=state.duration-.02)state.position=0;state.start=performance.now()/1000;state.started=true;$('play').textContent='Ⅱ';return;}
 const ctx=state.context;await ctx.resume();
 if(state.position>=state.duration-.02)state.position=0;
 const source=ctx.createBufferSource();source.buffer=state.audioBuffer;source.connect(ctx.destination);
 source.onended=()=>{if(source===state.source){state.source=null;state.position=state.duration;state.started=false;$('play').textContent='▶'}};
 source.start(0,state.position);state.source=source;state.start=ctx.currentTime;state.started=true;$('play').textContent='Ⅱ';
};
$('restart').onclick=()=>{stop();state.position=0;state.lastT=0;markDirty()};
$('seek').oninput=()=>{let next=state.duration*Number($('seek').value)/1000;stop();state.position=next;state.lastT=0;markDirty()};
$('expand').onclick=async()=>{
 const el=$('stage');
 if(document.fullscreenElement){await document.exitFullscreen();return}
 if(el.classList.contains('immersive')){el.classList.remove('immersive');return}
 try{if(el.requestFullscreen)await el.requestFullscreen();else el.classList.add('immersive')}catch{el.classList.add('immersive')}
};
for(const id of ['brightness','contrast','saturation'])$(id).oninput=()=>{$(id+'Out').textContent=$(id).value+'%';markDirty()};
$('export').onclick=async()=>{
 if(!state.instance&&state.audioBuffer&&costOf(state.id)==='heavy'){await pickEngine(state.id,true);}
 if(state.busy||!state.audioBuffer||!state.instance){say('Для экспорта нужен WAV/MP3. MIDI без аудио можно просматривать, но звук не синтезируется.',true);return}
 const dur=clamp(Number($('duration').value)||10,1,180);
 const fps=Number($('fps').value),res=Number($('resolution').value);
 const land=state.aspect==='16:9',width=land?Math.round(res*16/9):res,height=land?res:Math.round(res*16/9);
 const was=current();stop();state.lastT=0;state.busy=true;state.rendering=true;$('export').disabled=true;try{state.instance.setHQ?.(true)}catch(e){console.warn('HQ:',e)}
 $('progress').hidden=false;$('progress').value=0;
 try{
  const out=await exportFrameAccurate({audioBuffer:state.audioBuffer,canvasWidth:width,canvasHeight:height,fps,start:0,
   duration:Math.min(dur,state.duration),loopAudio:false,volume:1,cancelled:()=>false,
   progress:x=>{$('progress').value=x;say('Экспорт '+Math.round(x*100)+'%')},
   renderAt:(ctx,t)=>drawAt(ctx,t,false)});
  const href=URL.createObjectURL(out.blob);
  const a=document.createElement('a');a.href=href;a.download='bvs_method_'+state.id+'.'+out.ext;
  a.textContent='Скачать '+out.ext.toUpperCase()+' · '+out.frames+' кадров';$('download').replaceChildren(a);a.click();
  say('Готово: '+out.frames+' кадров. Экспорт покадровый.');
 }catch(e){console.error(e);say('Не удалось экспортировать: '+e.message,true)}
 finally{try{state.instance?.setHQ?.(false)}catch(e){}state.rendering=false;state.busy=false;$('export').disabled=false;$('progress').hidden=true;state.lastT=0;state.position=was;markDirty()}
};
function library(){
 const host=$('library');host.replaceChildren();
 const visible=specs.filter(e=>activeFilter==='all'||classifications[e.id]?.includes(activeFilter));
 for(const E of visible){
  const b=document.createElement('button');b.type='button';b.className='engine';b.dataset.id=E.id;
  const sw=document.createElement('span');sw.className='swatch';sw.style.background='linear-gradient(135deg,'+(E.looks?.[0]?.bg||'#151518')+','+(E.looks?.[0]?.fg||'#bbb0dc')+')';
  const copy=document.createElement('span');copy.className='engine-copy';
  const label=document.createElement('strong');label.textContent=(E.num||'')+' '+E.name;
  const meta=document.createElement('small');meta.textContent=engineNote[E.id]||((E.looks?.length||0)+' looks');
  copy.append(label,meta);
  if(costOf(E.id)==='heavy'){const hint=document.createElement('span');hint.className='cost';hint.textContent='ТЯЖЁЛЫЙ · ВРУЧНУЮ';copy.append(hint)}
  b.append(sw,copy);b.onclick=()=>pickEngine(E.id);b.classList.toggle('active',E.id===state.id);host.append(b);
 }
 $('count').textContent=visible.length+' / '+specs.length;
}
for(const tab of document.querySelectorAll('.tab')){
 tab.onclick=()=>{
  activeFilter=tab.dataset.filter;
  for(const el of document.querySelectorAll('.tab')){const active=el===tab;el.classList.toggle('is-active',active);el.setAttribute('aria-pressed',String(active))}
  $('categoryHint').textContent=activeFilter==='audio'?'Движки реагируют на реальный PCM из WAV / MP3.':activeFilter==='midi'?'Настоящие ноты .MID · Grid и Pads работают вместе с аудио.':'Все оригинальные METHOD и VISUALZI Classic стили.';
  library();
 };
}
library();
say('Каталог загружен. Выбери стиль и загрузи WAV / MP3 / MIDI.');
pickEngine('caustic');
requestAnimationFrame(loop);
