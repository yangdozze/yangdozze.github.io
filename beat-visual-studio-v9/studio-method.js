/* Beat Visual Studio / METHOD library host.
 * Original renderer, adapter, look and effect implementations are loaded from
 * the vendored METHOD scripts. This file is only the local UI / transport bridge.
 * Original creator credit: https://method.hiveglobal.org/app/
 */
(()=>{
'use strict';
const L=window.METHOD_LIBRARY,$=q=>document.querySelector(q);
const status=$('#status'), audio=L?.audio, families=L?.engines||[];
const out=$('#outCanvas'),stage=$('#stageOuter');
let post=null,scene=null,active=null,states={},current='caustic',last=-1,need=true,raf=0;
let audioBuffer=null,midiFile=null,exporting=false,cancelExport=false,downloadURL=null;
let fx=L?.fxDefaults?.()||{},grade=L?.gradeDefaults?.()||{},negative={from:0,to:0,p:0,keepHue:true};
let lastPaint=0,lastError='',badFrames=0,paintCount=0,quality=540;
const fmt=t=>{t=Math.max(0,t||0);return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')};
const tell=(msg,error=false)=>{status.textContent=msg;status.style.background=error?'#ffe9e5':'#edecf6';status.style.color=error?'#923b39':'#45445a'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const def=(p,mode)=>typeof p.def==='object'&&p.def!==null? p.def[mode]??Object.values(p.def)[0]:p.def;
const vis=id=>families.find(e=>e.id===id);
const copy=s=>JSON.parse(JSON.stringify(s));
function config(e){
 if(!states[e.id]){
  const m=e.modes?.def||null,params={};
  for(const p of e.params)params[p.k]=def(p,m);
  states[e.id]={look:e.defaultLook,mode:m,params};
 }
 return states[e.id];
}
function paramName(p){return p.label||p.k}
function setSize(){
 const land=$('#aspect').value==='16:9',w=land?960:540,h=land?540:960;
 if(out.width!==w||out.height!==h){out.width=w;out.height=h}
 stage.style.aspectRatio=land?'16/9':'9/16';
 out.style.aspectRatio=land?'16/9':'9/16';
 if(post)post.resize(w,h);
 if(active?.setAspect){active.setAspect(land?'16:9':'9:16')}
 need=true;last=-1;
}
function postInit(){
 try{post=L.post(out);post.resize(out.width,out.height);}
 catch(err){console.warn('METHOD WebGL2 post fallback',err);post=L.post2d(out);post.resize(out.width,out.height);tell('WebGL2 эффекты недоступны, рендер без FX.');}
}
function engineReady(){
 const E=vis(current);if(!E)return;
 try{
  scene=E;active=E.create();
  setSize();
  if(active.setAudio){
   if(audio?.pcm)active.setAudio(audio.pcm,audio.sr);
   else if(!['midi','strip','night'].includes(E.id))active.setAudio(makeSilentDemo(),22050);
  }
  active.watch=()=>{need=true;};
  applyConfig();
  if(midiFile&&typeof active.useMidiFile==='function')active.useMidiFile(midiFile).catch(e=>console.warn('MIDI',e));
  $('#sceneName').textContent=E.num+' / '+E.name.toUpperCase();
  $('#photoLabel').hidden=E.id!=='dancer';
  last=-1;need=true;
  tell(E.name+' · оригинальный движок METHOD активен'+(audio?.has?' · '+audio.name:' · демо-предпросмотр'));
 }catch(err){
  active=null;console.error('METHOD engine startup',E.id,err);
  tell('Не удалось запустить '+E.name+': '+(err.message||err),true);
 }
}
let demoPCM=null;
function makeSilentDemo(){
 if(demoPCM)return demoPCM;
 const sr=22050,N=sr*8,pcm=demoPCM=new Float32Array(N);
 for(let i=0;i<N;i++){const t=i/sr,k=t%.5,q=t%.25,v=.66*Math.sin(2*Math.PI*69*t)*Math.exp(-k*17)
  +.1*Math.sin(2*Math.PI*380*t)*Math.exp(-q*39);pcm[i]=Math.tanh(v*1.2)}
 return pcm;
}
function applyConfig(){
 if(!scene||!active)return;const c=config(scene);
 try{
  for(const p of scene.params)if(c.params[p.k]!==undefined)active.set(p.k,c.params[p.k]);
  if(scene.modes&&active.setMode)active.setMode(c.mode);
  active.setLook(c.look);
 }catch(e){console.warn('METHOD params',scene.id,e)}
 need=true;
}
function chooseFamily(id){
 if(exporting)return;
 if(audio?.playing)audio.pause();
 if(active?.dispose)try{active.dispose()}catch(e){}
 current=id;
 renderFamilies();engineReady();buildLooks();buildModes();buildParams();
 need=true;
}
function renderFamilies(){
 const root=$('#families');root.replaceChildren();for(const e of families){
  const b=document.createElement('button');b.className='family'+(e.id===current?' active':'');
  b.title=e.name+' / '+e.tag;
  b.innerHTML='<span class="famNum">'+e.num+'</span><span class="famName"></span><span class="famTag"></span>';
  b.querySelector('.famName').textContent=e.name;b.querySelector('.famTag').textContent=e.tag;
  b.onclick=()=>chooseFamily(e.id);root.append(b);
 }
 $('#familyCount').textContent=families.length+' / '+families.length;
}
function buildLooks(){
 const e=scene,r=$('#looks'),c=config(e);r.replaceChildren();$('#lookCount').textContent=e.looks.length+' варианта';
 for(const look of e.looks){
  const b=document.createElement('button');b.className='look'+(c.look===look.k?' active':'');
  const sw=document.createElement('span');sw.className='swatch';sw.style.background=look.bg||'#111';
  sw.style.setProperty('--sw-fg',look.fg||'#ddd');
  const label=document.createElement('span');label.className='look-name';label.textContent=look.label;
  b.append(sw,label);b.onclick=()=>{c.look=look.k;active?.setLook(look.k);buildLooks();need=true;last=-1;};
  r.append(b);
 }
}
function buildModes(){
 const e=scene,root=$('#modes'),b=$('#modesBlock');root.replaceChildren();b.hidden=!e.modes;
 if(!e.modes)return;const c=config(e),row=document.createElement('div');row.className='modechoice';
 for(const op of e.modes.options){
  const btn=document.createElement('button');btn.textContent=op.label;btn.title=op.hint||'';
  btn.className=c.mode===op.v?'active':'';
  btn.onclick=()=>{c.mode=op.v;active?.setMode?.(op.v);buildModes();buildParams();need=true;last=-1};
  row.append(btn);
 }
 root.append(row);
}
function control(p,value,onInput){
 const wrap=document.createElement('div');wrap.className='param';
 const top=document.createElement('div');top.className='paramTop';
 const lab=document.createElement('span');lab.textContent=paramName(p);lab.title=p.hint||'';
 const v=document.createElement('span');v.className='value';top.append(lab,v);wrap.append(top);
 const f=p.fmt||L.format(p),format=q=>{try{return String(f(q))}catch{return String(q)}};
 const options=p.choices||null;
 if(options){
  const select=document.createElement('select');for(const item of options){
   const opt=document.createElement('option');opt.value=item.v;opt.textContent=item.label;select.append(opt);
  }select.value=String(value);v.textContent=options.find(x=>String(x.v)===String(value))?.label||String(value);
  select.onchange=()=>{const q=select.value;v.textContent=select.selectedOptions[0]?.textContent||q;onInput(q)};
  wrap.append(select);
 } else if(typeof value==='number'&&Number.isFinite(+p.min)&&Number.isFinite(+p.max)){
  const range=document.createElement('input');range.type='range';range.min=p.min;range.max=p.max;
  range.step=p.int?1:Math.max(.001,(p.max-p.min)/250);range.value=value;
  v.textContent=format(value);
  range.oninput=()=>{const q=Number(range.value);v.textContent=format(q);onInput(q)};
  wrap.append(range);
 }else{
  const input=document.createElement('input');input.type='text';input.value=value??'';
  v.textContent=String(value??'');input.onchange=()=>{v.textContent=input.value;onInput(input.value)};wrap.append(input);
 }
 return wrap;
}
function buildParams(){
 const e=scene,c=config(e),container=$('#params');container.replaceChildren();let groups=new Map();
 for(const p of e.params){
  if(p.modes&&!p.modes.includes(c.mode)&&!p.modes.includes(c.look))continue;
  const g=p.group|| (p.tier===1?'MAIN':p.tier===2?'CAMERA / VIEW':'MORE');
  if(!groups.has(g))groups.set(g,[]);
  groups.get(g).push(p);
 }
 for(const [name,params] of groups){
  const section=document.createElement('div');section.className='paramGroup';
  const h=document.createElement('h3');h.textContent=name;section.append(h);
  for(const p of params){
   section.append(control(p,c.params[p.k],q=>{
    c.params[p.k]=q;try{active?.set(p.k,q)}catch(e){console.warn(p.k,e)}
    need=true;last=-1;
   }));
  }
  container.append(section);
 }
}
function buildFx(){
 const root=$('#fx');root.replaceChildren();
 for(const spec of L.effects){
  const row=document.createElement('div');row.className='fxrow';
  const top=document.createElement('label');top.className='fxTop';
  const title=document.createElement('span');title.className='fxName';title.textContent=spec.label;
  const chk=document.createElement('input');chk.type='checkbox';chk.className='switch';chk.checked=!!fx[spec.id].on;
  chk.onchange=()=>{fx[spec.id].on=chk.checked;details.hidden=!chk.checked;need=true};
  top.append(title,chk);row.append(top);
  const details=document.createElement('div');details.className='fxparams';details.hidden=!fx[spec.id].on;
  for(const p of spec.params)details.append(control(p,fx[spec.id][p.k],q=>{fx[spec.id][p.k]=q;need=true}));
  row.append(details);root.append(row);
 }
}
function buildGrade(){
 const root=$('#grade');root.replaceChildren();
 for(const p of L.gradeControls)root.append(control(p,grade[p.k],q=>{grade[p.k]=q;need=true}));
 const gr=document.createElement('div');gr.className='fxrow';
 const row=document.createElement('label');row.className='fxTop';row.textContent='Gradient Map';
 const check=document.createElement('input');check.type='checkbox';check.className='switch';check.checked=grade.grad.on;
 check.onchange=()=>{grade.grad.on=check.checked;need=true};row.append(check);gr.append(row);
 for(let i=0;i<3;i++){const label=document.createElement('label');label.style.cssText='display:inline-flex;align-items:center;gap:6px;margin:9px;font-size:11px';
 label.textContent='Color '+(i+1);const col=document.createElement('input');col.type='color';col.value=grade.grad.stops[i].c;
 col.oninput=()=>{grade.grad.stops[i].c=col.value;need=true};label.append(col);gr.append(label);}
 for(const p of [{k:'amount',label:'Amount',min:0,max:1,def:1},{k:'shift',label:'Shift',min:-1,max:1,def:0},{k:'repeat',label:'Repeat',min:0.1,max:5,def:1}])
  gr.append(control(p,grade.grad[p.k],q=>{grade.grad[p.k]=q;need=true}));
 root.append(gr);
 const n=document.createElement('label');n.className='fxTop';n.textContent='Negative';
 const ch=document.createElement('input');ch.type='checkbox';ch.className='switch';ch.checked=negative.p>0;
 ch.onchange=()=>{negative.p=ch.checked?1:0;need=true};n.append(ch);root.append(n);
}
function draw(time,dt,playing,targetPost=post){
 if(!active||!scene||!targetPost)return;
 try{
  active.frame(Math.max(0,time),dt,playing);
  targetPost.render(active.canvas,fx,grade,negative,time,null);
  paintCount++;lastError='';
  $('#stagePlaceholder').hidden=true;
 }catch(e){
  const msg=String(e.message||e);
  if(msg!==lastError){lastError=msg;tell('Ошибка '+scene.name+': '+msg,true);console.error('METHOD renderer',e)}
  badFrames++;
 }
}
function loop(now){
 raf=requestAnimationFrame(loop);
 if(exporting||!active)return;
 if(now-lastPaint<33&&!need&&!active?._dirty)return;
 const t=audio?.time?.()||0;
 const playing=audio?.playing||false;
 if(!playing&&!need&&!active?._dirty&&now-lastPaint<240)return;
 const dt=last<0||t<last?1/30:clamp(t-last,1/240,.10);
 draw(t,dt,playing);
 last=t;lastPaint=now;need=false;if(active)active._dirty=false;
 $('#seek').max=audio?.duration||1;$('#seek').value=String(t);
 $('#clock').textContent=fmt(t)+' / '+fmt(audio?.duration||0);
 $('#play').textContent=playing?'❚❚':'▶';
}
function changeAudio(buf,name){
 audioBuffer=buf;audio.setBuffer(buf,name);
 if(active?.setAudio)active.setAudio(audio.pcm,audio.sr);
 $('#audioName').textContent=name;$('#stagePlaceholder').hidden=true;
 $('#exportDuration').value=Math.min(30,Math.max(1,Math.floor(buf.duration)));
 need=true;last=-1;tell(name+' · '+fmt(buf.duration)+' · аудио декодировано локально');
}
$('#audioFile').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;tell('Декодирую '+f.name+'…');
 try{
  const ctx=audio.ensure();const buf=await ctx.decodeAudioData(await f.arrayBuffer());
  changeAudio(buf,f.name);
 }catch(err){tell('Ошибка аудио: '+err.message,true)}
};
$('#midiFile').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;midiFile=f;
 if(typeof active?.useMidiFile!=='function'){
  tell('MIDI сохранён. Для прямого чтения выбери MIDI / Score, Grid или Pads.');return;
 }
 try{tell('Читаю MIDI: '+f.name+'…');await active.useMidiFile(f);need=true;tell('MIDI подключён: '+f.name)}
 catch(err){tell('MIDI: '+err.message,true)}
};
$('#photoFile').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;if(typeof active?.usePhoto!=='function')return tell('Выбери Dancer для загрузки фотографии.');
 try{tell('Читаю фотографию…');await active.usePhoto(f);need=true;tell('Фотография передана в Dancer');}
 catch(err){tell('Ошибка фото: '+err.message,true)}
};
$('#play').onclick=()=>{if(!audio?.has)return tell('Чтобы воспроизвести звук, загрузи WAV/MP3. Демопревью остаётся без звука.');audio.toggle();need=true};
$('#rewind').onclick=()=>{audio?.seek?.(0);need=true;last=-1};
$('#seek').oninput=()=>{audio?.seek?.(Number($('#seek').value));need=true;last=-1};
$('#fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else stage.requestFullscreen?.()};
$('#aspect').onchange=()=>{setSize();need=true};
$('#resetParams').onclick=()=>{delete states[current];applyConfig();buildParams();buildLooks();buildModes();need=true};
$('#resetFx').onclick=()=>{fx=L.fxDefaults();buildFx();need=true};
$('#resetGrade').onclick=()=>{grade=L.gradeDefaults();negative.p=0;buildGrade();need=true};
$('#imageExport').onclick=()=>{
 if(!active)return;
 try{draw(audio?.time?.()||0,1/30,false);out.toBlob(b=>{
  if(!b)return tell('Не удалось сохранить PNG',true);
  const url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download='BVS_METHOD_'+current+'.png';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
 },'image/png');}catch(e){tell('PNG: '+e.message,true)}
};
$('#videoExport').onclick=async()=>{
 if(exporting||!active)return;
 exporting=true;cancelExport=false;$('#videoExport').disabled=true;
 $('#cancelExport').hidden=false;$('#exportProgress').hidden=false;
 const before=audio?.time?.()||0;const playing=audio?.playing;
 try{
  audio?.pause?.();
  const W=$('#aspect').value==='16:9'?1280:720,H=$('#aspect').value==='16:9'?720:1280;
  const fps=Number($('#fps').value),duration=clamp(Number($('#exportDuration').value)||8,1,180);
  const {exportFrameAccurate}=await import('./frame-export.js');
  // Tracks with MIDI-only notes receive silence, not synthesized or guessed audio.
  const b=audioBuffer||new AudioBuffer({length:44100*Math.ceil(duration),numberOfChannels:1,sampleRate:44100});
  const source=active,afterCanvas=document.createElement('canvas');afterCanvas.width=W;afterCanvas.height=H;
  const fxOutput=L.post(afterCanvas);fxOutput.resize(W,H);
  if(audio?.has&&source.setAudio)source.setAudio(audio.pcm,audio.sr);
  applyConfig();last=-1;
  let prev=-1;
  const result=await exportFrameAccurate({
   audioBuffer:b,canvasWidth:W,canvasHeight:H,fps,start:0,duration,loopAudio:false,volume:1,
   progress:q=>{$('#exportProgress').value=q;tell('Экспорт '+Math.round(q*100)+'% · '+scene.name)},
   cancelled:()=>cancelExport,
   renderAt:(ctx,t)=>{
    if(cancelExport)throw new DOMException('Отменено','AbortError');
    source.frame(t,prev<0?1/fps:clamp(t-prev,1/240,.1),true);
    fxOutput.render(source.canvas,fx,grade,negative,t,null);
    ctx.drawImage(afterCanvas,0,0,W,H);prev=t;
   }
  });
  if(downloadURL)URL.revokeObjectURL(downloadURL);
  downloadURL=URL.createObjectURL(result.blob);
  const a=document.createElement('a');a.href=downloadURL;
  a.download='BVS_METHOD_'+current+'_'+fps+'fps.'+result.ext;
  a.textContent='Скачать готовый '+result.ext.toUpperCase()+' · '+result.frames+' кадров';
  $('#exportNote').replaceChildren(a);a.click();
  tell('Готово: '+result.frames+' кадров; '+(result.blob.size/1048576).toFixed(1)+' MB');
 }catch(err){tell(err?.name==='AbortError'?'Экспорт отменён':'Экспорт: '+err.message,true);console.error(err)}
 finally{
  exporting=false;$('#videoExport').disabled=false;$('#cancelExport').hidden=true;$('#exportProgress').hidden=true;
  if(audio?.has&&active?.setAudio)active.setAudio(audio.pcm,audio.sr);
  applyConfig();audio?.seek?.(before);if(playing)audio.play(before);last=-1;need=true;
 }
};
$('#cancelExport').onclick=()=>{cancelExport=true};
$('#savePreset').onclick=()=>{
 const data={format:'BVS-METHOD-v10',current,states,fx,grade,negative,aspect:$('#aspect').value};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BVS_METHOD_presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
};
$('#loadPreset').onchange=async e=>{
 try{const file=e.target.files[0],data=JSON.parse(await file.text());
  if(data.format!=='BVS-METHOD-v10')throw Error('Неизвестный формат пресета');
  states=data.states||{};fx=data.fx||L.fxDefaults();grade=data.grade||L.gradeDefaults();negative=data.negative||negative;
  $('#aspect').value=data.aspect==='16:9'?'16:9':'9:16';
  chooseFamily(vis(data.current)?data.current:families[0].id);buildFx();buildGrade();need=true;tell('Пресет загружен');
 }catch(err){tell('Пресет: '+err.message,true)}
};
function start(){
 if(!L||families.length<11){tell('Движки METHOD не загрузились. Обнови страницу.',true);return}
 $('#counter').textContent=families.length;
 fx=L.fxDefaults();grade=L.gradeDefaults();postInit();
 renderFamilies();chooseFamily('caustic');buildFx();buildGrade();
 requestAnimationFrame(loop);
 window.__BVS_V10_QA__={get state(){return {families:families.length,active:scene?.id,look:scene&&config(scene).look,hasAudio:!!audio?.pcm,frames:paintCount,badFrames,lastError,fx:!!post?.gl}}};
 tell('В одном редакторе: 11 семейств METHOD, STRIP и NIGHT. Загрузи аудио или MIDI.');
}
Promise.resolve(window.BVS_CLASSICS_READY).then(start).catch(e=>{console.error('BVS classic startup',e);start();});
})();