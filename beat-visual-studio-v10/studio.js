/* Beat Visual Studio v10 host — no original METHOD account or payment code. */
(()=>{
'use strict';
const $=id=>document.getElementById(id), ENG=window.METHOD_AUDIO_ENGINES||[];
const state={engine:null,adapter:null,instance:null,params:{},mode:'',look:'',audio:null,pcm:null,audioContext:null,source:null,started:0,paused:0,playing:false,raf:0,lastDraw:-1,aspect:'9:16',rendering:false};
const ctx=$('stage').getContext('2d',{alpha:false}),wave=$('wave'),wctx=wave.getContext('2d');
function error(e){console.error('[Beat Visual Studio v10]',e);$('error').hidden=false;$('error').textContent=(e?.message||String(e));$('exportMsg').textContent='Ошибка: '+(e?.message||String(e));}
function ready(){return !!(state.pcm&&state.instance)}
function duration(){return state.audio?.duration||0}
function now(){return state.playing?Math.min(duration(),state.paused+Math.max(0,state.audioContext.currentTime-state.started)):state.paused}
function pause(){if(state.playing){state.paused=now();state.playing=false;state.source?.stop();state.source?.disconnect();state.source=null;}$('play').textContent='▶'}
function format(t){return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')}
async function play(){if(!ready())return;try{
 if(!state.audioContext)state.audioContext=new(window.AudioContext||window.webkitAudioContext)();
 await state.audioContext.resume();if(state.playing){pause();return}
 if(state.paused>=duration()-.05)state.paused=0;
 let src=state.audioContext.createBufferSource();src.buffer=state.audio;src.connect(state.audioContext.destination);
 state.started=state.audioContext.currentTime;src.start(0,state.paused);state.playing=true;state.source=src;$('play').textContent='Ⅱ';
 src.onended=()=>{if(state.source===src){state.paused=duration();state.source=null;state.playing=false;$('play').textContent='▶'}};
}catch(e){error(e)}}
function seek(t){const was=state.playing;if(was)pause();state.paused=Math.min(duration(),Math.max(0,t));state.lastDraw=-1;if(was)play()}
function mono(a){if(a.numberOfChannels===1)return a.getChannelData(0);const v=new Float32Array(a.length);for(let ch=0;ch<a.numberOfChannels;ch++){const p=a.getChannelData(ch);for(let i=0;i<v.length;i++)v[i]+=p[i]/a.numberOfChannels}return v}
function drawWave(){const r=wave.getBoundingClientRect(),W=wave.width=Math.max(1,Math.round(r.width)),H=wave.height=60;wctx.fillStyle='#ebe8ef';wctx.fillRect(0,0,W,H);
 if(!state.pcm)return;wctx.fillStyle='#8c72ac';const arr=state.pcm;for(let x=0;x<W;x++){let a=Math.floor(x*arr.length/W),b=Math.min(arr.length,Math.floor((x+1)*arr.length/W)),mx=0;for(let j=a;j<b;j+=5)mx=Math.max(mx,Math.abs(arr[j]));let h=Math.max(1,Math.round(mx*H*.85));wctx.fillRect(x,Math.round((H-h)/2),1,h)}}
function setStatus(){const t=now();$('clock').textContent=format(t)+' / '+format(duration());$('seek').max=duration()||1;$('seek').value=Math.min(duration(),t)}
function configure(sel){const p=state.params;
 for(const option of sel.params||[]){let value=option.def;if(value&&typeof value==='object')value=Object.values(value)[0];if(value===undefined)continue;p[option.k]=value;try{state.instance?.set(option.k,value)}catch(e){console.warn('Setting failed',option.k,e)}}}
function initEngine(id){const engine=ENG.find(e=>e.id===id);if(!engine)return;pause();state.engine=id;state.adapter=engine;state.instance=null;state.params={};state.lastDraw=-1;$('error').hidden=true;
 try{const inst=engine.create();state.instance=inst; if(inst.setAspect)inst.setAspect(state.aspect);configure(engine);state.look=engine.defaultLook||engine.looks?.[0]?.k||'';if(inst.setLook)inst.setLook(state.look);
 state.mode=engine.modes?.def||'';if(inst.setMode&&state.mode)inst.setMode(state.mode);if(state.pcm)inst.setAudio(state.pcm,state.audio.sampleRate);
 $('engineName').textContent=engine.name;$('engineTag').textContent=engine.tag+' · METHOD';$('lookName').textContent=engine.name.toUpperCase();$('empty').hidden=!!state.pcm;
 $('play').disabled=!state.pcm;$('export').disabled=!state.pcm;
 buildControls();buildStyles();drawOnce(now(),1/30,true);
 }catch(e){error(e)}}
function buildStyles(){const root=$('styles');root.replaceChildren();for(const e of ENG){const b=document.createElement('button');b.className='style'+(state.engine===e.id?' selected':'');b.type='button';b.setAttribute('aria-pressed',String(state.engine===e.id));
 const l=e.looks?.find(v=>v.k===e.defaultLook)||e.looks?.[0]||{},sw=document.createElement('div');sw.className='swatch';sw.style.background=l.bg||'#000';sw.style.color=l.fg||'#fff';const mark=document.createElement('i');mark.style.background='currentColor';sw.append(mark);b.append(sw);
 const name=document.createElement('b');name.textContent=e.name;b.append(name);const t=document.createElement('small');t.textContent=(e.looks?.length||1)+' looks · '+e.tag;b.append(t);
 b.onclick=()=>initEngine(e.id);root.append(b)}$('styleCount').textContent=ENG.length+' ORIGINAL'}
function makeSection(name,root){const h=document.createElement('h3');h.textContent=name;root.append(h)}
function buildControls(){const eng=state.adapter,root=$('controls');root.replaceChildren();
 if(!eng)return;
 makeSection('Палитра / Look',root);const group=document.createElement('div');group.className='look-choices';
 for(const l of eng.looks||[]){const b=document.createElement('button');b.type='button';b.className='choice'+(l.k===state.look?' sel':'');
 const c=document.createElement('div');c.className='color';c.style.background='linear-gradient(135deg,'+(l.bg||'#000')+','+(l.g||l.fg||'#999')+')';b.append(c);
 const n=document.createElement('span');n.textContent=l.label||l.k;b.append(n);b.onclick=()=>{state.look=l.k;state.instance.setLook(l.k);state.lastDraw=-1;buildControls()};group.append(b)}
 root.append(group);
 if(eng.modes?.options?.length){makeSection(eng.modes.label||'Mode',root);const wrap=document.createElement('div');wrap.className='control';
 const select=document.createElement('select');for(const opt of eng.modes.options){const item=document.createElement('option');item.value=opt.v;item.textContent=opt.label;select.append(item)}select.value=state.mode;select.onchange=()=>{state.mode=select.value;state.instance.setMode?.(state.mode);state.lastDraw=-1};wrap.append(select);root.append(wrap)}
 const grouped=new Map();for(const p of eng.params||[]){const group=p.group||'Основные параметры';if(!grouped.has(group))grouped.set(group,[]);grouped.get(group).push(p)}
 for(const [group,parameters] of grouped){makeSection(group,root);for(const p of parameters){const box=document.createElement('div');box.className='control',hd=document.createElement('div');hd.className='head';
 const title=document.createElement('span');title.textContent=p.label||p.k;const output=document.createElement('output');hd.append(title,output);
 const input=document.createElement('input');input.type='range';input.min=p.min??0;input.max=p.max??1;input.step=p.int?'1':String((Number(input.max)-Number(input.min))/250);
 input.value=state.params[p.k]??p.def??0;const renderValue=()=>{let v=+input.value;let txt;try{txt=p.fmt?p.fmt(v):p.int?String(Math.round(v)):v.toFixed(2)}catch{txt=v.toFixed(2)}output.textContent=txt};
 renderValue();input.oninput=()=>{let v=+input.value;state.params[p.k]=v;try{state.instance.set(p.k,v);state.lastDraw=-1}catch(e){error(e)}renderValue()};box.append(hd,input);
 if(p.hint){const small=document.createElement('small');small.textContent=p.hint;box.append(small)}root.append(box)}}}
function drawOnce(t,dt,playing,output=ctx,canvas=$('stage')){if(!ready())return;try{
 state.instance.frame(t,dt,playing);output.fillStyle='#060607';output.fillRect(0,0,canvas.width,canvas.height);output.drawImage(state.instance.canvas,0,0,canvas.width,canvas.height);
 }catch(e){error(e);state.playing=false}}
function tick(){state.raf=requestAnimationFrame(tick);setStatus();if(state.rendering||!ready())return;
 const t=now();if(state.playing&&t>=duration()-.015){pause();state.paused=duration()}
 if(state.lastDraw<0||Math.abs(t-state.lastDraw)>=1/28){const dt=state.lastDraw<0||t<state.lastDraw?1/30:Math.min(.09,t-state.lastDraw);drawOnce(t,dt,state.playing);state.lastDraw=t}}
async function load(file){if(!file)return;pause();$('fileName').textContent='Декодирование: '+file.name;try{
 let c=state.audioContext||new(window.AudioContext||window.webkitAudioContext)();state.audioContext=c;
 const audio=await c.decodeAudioData(await file.arrayBuffer());state.audio=audio;state.pcm=mono(audio);state.paused=0;state.lastDraw=-1;
 $('fileName').textContent=file.name+' · '+format(duration());$('duration').value=Math.min(12,Math.floor(duration()));drawWave();$('empty').hidden=true;
 if(state.adapter){initEngine(state.engine)}else initEngine('retro');
 }catch(e){error(e);$('fileName').textContent='Ошибка декодирования'}}
async function exportVideo(){if(!ready()||state.rendering)return;pause();$('export').disabled=true;state.rendering=true;$('progress').hidden=false;$('progress').value=0;$('download').hidden=true;
 let original=$('stage'),sw=original.width,sh=original.height,dur=Math.max(1,Math.min(duration(),Number($('duration').value)||12)),fps=Number($('fps').value)||30;
 try{
 const {exportFrameAccurate}=await import('./frame-export.js');
 const result=await exportFrameAccurate({audioBuffer:state.audio,canvasWidth:sw,canvasHeight:sh,fps,start:0,duration:dur,loopAudio:false,volume:1,cancelled:()=>false,
 progress:p=>{$('progress').value=p;$('exportMsg').textContent='Экспорт: '+Math.round(100*p)+'%'},renderAt:(target,t)=>{drawOnce(t,1/fps,true,target,original)}});
 const url=URL.createObjectURL(result.blob);const link=$('download');link.href=url;link.download='BVS_METHOD_'+(state.adapter?.id||'style')+'.'+result.ext;
 link.textContent='Скачать '+result.ext.toUpperCase()+' · '+result.frames+' кадров';link.hidden=false;link.click();$('exportMsg').textContent='Видео готово · '+(result.blob.size/1048576).toFixed(1)+' МБ';
 }catch(e){error(e)}finally{$('export').disabled=false;state.rendering=false;$('progress').hidden=true;state.lastDraw=-1}}
function resize(){const land=state.aspect==='16:9';$('stage').width=land?960:540;$('stage').height=land?540:960;document.querySelector('.screen').style.aspectRatio=land?'16/9':'9/16';
 if(state.instance?.setAspect)state.instance.setAspect(state.aspect);state.lastDraw=-1}
$('audio').addEventListener('change',e=>load(e.target.files?.[0]));$('play').onclick=play;
$('seek').oninput=e=>seek(+e.target.value);$('aspect').onchange=e=>{state.aspect=e.target.value;resize()};$('export').onclick=exportVideo;
wave.onclick=e=>{if(state.audio){let r=wave.getBoundingClientRect();seek(((e.clientX-r.left)/r.width)*duration())}};
addEventListener('resize',drawWave);buildStyles();resize();initEngine('retro');tick();
})();