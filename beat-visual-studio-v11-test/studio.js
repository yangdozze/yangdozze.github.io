import {exportFrameAccurate} from '../beat-visual-studio-v10/frame-export.js';
import {parseMidi} from '../beat-visual-studio-v9/midi.js';
const $=id=>document.getElementById(id), M=window.METHOD_V10;
const state={id:null,instance:null,audioBuffer:null,pcm:null,rate:44100,source:null,clock:0,start:0,started:false,context:null,position:0,duration:0,lastT:0,mode:null,look:null,params:{},aspect:'9:16',busy:false,rendering:false,midiFile:null,midiMeta:null};
const specs=M?.ENGINES||[];
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
 const inst=state.instance;if(!inst?.set)return;
 const v=typeof value==='number'?value:typeof p.min==='number'?Number(value):value;
 state.params[p.k]=v;
 try{inst.set(p.k,v)}catch(e){say(p.label+': '+e.message,true)}
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
async function pickEngine(id){
 if(state.busy)return;
 stop();
 const E=specs.find(x=>x.id===id);if(!E)return;
 state.id=id;window.App.vid=id;state.lastT=0;state.mode=E.modes?.def||null;state.look=E.defaultLook||E.looks?.[0]?.k;
 state.params={};for(const p of E.params||[])state.params[p.k]=M.defOf(p,state.mode);
 $('engineStatus').textContent='Загрузка '+E.name;
 try{
  const inst=E.create();state.instance=inst;
  configureCanvas();
  if(inst.setMode&&state.mode)inst.setMode(state.mode);
  inst.setLook?.(state.look);
  if(inst.set)for(const p of E.params||[])try{applyParam(p,state.params[p.k])}catch{}
  if(state.pcm && id!=='midi') await setAudioOnEngine();
  if(id==='midi' && state.midiFile) await inst.useMidiFile(state.midiFile);
  controls();
  $('overlay').hidden=true;
  $('engineStatus').textContent=E.num+' / '+E.name;
  say('Движок '+E.name+' подключён. '+(state.pcm?'Аудио загружено.':'Добавь WAV/MP3 для реакции на звук.'));
 }catch(err){state.instance=null;$('overlay').hidden=false; $('overlay').textContent='Движок недоступен: '+(err.message||err);say(String(err?.stack||err).slice(0,160),true)}
 for(const el of document.querySelectorAll('.engine'))el.classList.toggle('active',el.dataset.id===id);
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
  state.pcm=mono;M.audio._set(mono,b.sampleRate,b,file.name,true);
  $('fileName').textContent=file.name+' · '+labelTime(b.duration);$('play').disabled=false;
  await setAudioOnEngine();say('Готово · '+file.name+' · '+b.sampleRate+' Гц');
 }catch(e){say('Ошибка файла: '+e.message,true)}
 finally{state.busy=false}
}
async function useDemo(){
 const d=M.makeDemoBeat(),ctx=state.context||new (window.AudioContext||window.webkitAudioContext)();state.context=ctx;
 const b=ctx.createBuffer(1,d.pcm.length,d.sr);b.copyToChannel(d.pcm,0);state.busy=true;
 try{stop();state.audioBuffer=b;state.pcm=d.pcm;state.rate=d.sr;state.duration=b.duration;state.position=0;M.audio._set(d.pcm,d.sr,b,'METHOD demo beat',true);
  $('fileName').textContent='METHOD demo beat · '+labelTime(state.duration);$('play').disabled=false;
  await setAudioOnEngine();say('Загружено демо-аудио METHOD (реальный PCM)')}
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
let frameNo=0;
function loop(){
 requestAnimationFrame(loop);
 if(state.busy&&!state.rendering)return;
 if(state.rendering)return;
 if(++frameNo%(selected()?.cost==='heavy'?8:2)!==0)return; // adaptive preview rate for heavy engines
 const t=current();if(state.duration&&t>=state.duration&&state.started){stop();state.position=state.duration}
 drawAt($('canvas').getContext('2d',{alpha:false}),t);
 $('clock').textContent=labelTime(t)+' / '+labelTime(state.duration);
 $('seek').value=state.duration?Math.round(t/state.duration*1000):0;
}
$('look').onchange=()=>{state.look=$('look').value;try{state.instance?.setLook(state.look)}catch(e){say(e.message,true)}};
$('mode').onchange=()=>{state.mode=$('mode').value;state.instance?.setMode?.(state.mode);controls()};
$('aspect').onchange=()=>{state.aspect=$('aspect').value;configureCanvas()};
$('audio').onchange=e=>{if(e.target.files?.[0])loadAudio(e.target.files[0])};
$('midi').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  const parsed=parseMidi(await file.arrayBuffer()); // true SMF, never audio transcription
  state.midiFile=file;state.midiMeta=parsed;
  if(!state.audioBuffer){stop();state.duration=parsed.duration;state.position=0;$('play').disabled=false;}
  if(!state.instance?.useMidiFile || (!state.audioBuffer&&state.id!=='midi')) await pickEngine('midi');
  else await state.instance.useMidiFile(file);
  $('fileName').textContent=(state.audioBuffer?$('fileName').textContent+' + ':'')+file.name+' · '+parsed.notes.length+' нот';
  say('MIDI: '+file.name+' · '+parsed.notes.length+' настоящих нот · '+parsed.duration.toFixed(2)+' c. Конвертера Audio-to-MIDI нет.');
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
$('restart').onclick=()=>{stop();state.position=0;state.lastT=0};
$('seek').oninput=()=>{let next=state.duration*Number($('seek').value)/1000;stop();state.position=next;state.lastT=0};
$('expand').onclick=async()=>{
 const el=$('stage');
 if(document.fullscreenElement){await document.exitFullscreen();return}
 if(el.classList.contains('immersive')){el.classList.remove('immersive');return}
 try{if(el.requestFullscreen)await el.requestFullscreen();else el.classList.add('immersive')}catch{el.classList.add('immersive')}
};
for(const id of ['brightness','contrast','saturation'])$(id).oninput=()=>$(id+'Out').textContent=$(id).value+'%';
$('export').onclick=async()=>{
 if(state.busy||!state.audioBuffer||!state.instance){say('Для экспорта нужен WAV/MP3. MIDI без аудио можно просматривать, но звук не синтезируется.',true);return}
 const dur=clamp(Number($('duration').value)||10,1,180);
 const fps=Number($('fps').value),res=Number($('resolution').value);
 const land=state.aspect==='16:9',width=land?Math.round(res*16/9):res,height=land?res:Math.round(res*16/9);
 const was=current();stop();state.lastT=0;state.busy=true;state.rendering=true;$('export').disabled=true;
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
 finally{state.rendering=false;state.busy=false;$('export').disabled=false;$('progress').hidden=true;state.lastT=0;state.position=was}
};
function library(){
 $('library').replaceChildren();
 for(const E of specs){
  const b=document.createElement('button');b.className='engine';b.dataset.id=E.id;
  const sw=document.createElement('span');sw.className='swatch';sw.style.background='linear-gradient(110deg,'+(E.looks?.[0]?.bg||'#08090e')+','+(E.looks?.[0]?.fg||'#adb6ca')+')';
  const label=document.createElement('strong');label.textContent=(E.num||'')+' '+E.name;
  const meta=document.createElement('small');meta.textContent=E.looks?.length+' looks · '+(E.params?.length||0)+' controls';
  b.append(sw,label,meta);b.onclick=()=>pickEngine(E.id);$('library').append(b);
 }
 $('count').textContent=specs.length+' семейств';
}
library();
say(specs.length?'Движки METHOD загружены. Выбери семейство и WAV/MP3.':'Движки METHOD не загрузились.',!specs.length);
pickEngine('caustic');requestAnimationFrame(loop);
