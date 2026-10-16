/* METHOD / HiveGlobal original adapter registry, source https://method.hiveglobal.org/app/; authorization per site owner's report. Account/payment/backend intentionally excluded. */

'use strict';
/* ===========================================================================
   HIVE VISUALISER — product shell
   ---------------------------------------------------------------------------
   VYRAL
   ├── Registry ............ ENGINES: one adapter per visual engine
   ├── Audio engine ........ AudioEngine: decode, play, heard-time clock, record tap
   ├── Post pipeline ....... Post: shared effects (FX registry) + colour grade + Negative
   ├── Recorder ............ Recorder: canvas + audio -> MediaRecorder, ends with the track
   └── Engines (unchanged) . RETRO, CAUSTIC, makeContour  (injected above, logic untouched)

   Every engine is PCM-indexed: it reads the decoded audio at time t itself.
   So the shell only has to hand each engine (pcm, sampleRate) and a clock -
   no AnalyserNode, and previews can run silently on any window of the track.

   Adapter contract (see RetroAdapter below):
     { id, num, name, tag, looks[], defaultLook, modes?, params[],
       create() -> instance }   (one instance per visualizer, shared by the home card and the workspace)
     instance: { canvas, setAudio(pcm,sr), frame(t,dt,playing), set(k,v),
                 setLook(k), setMode?(v), setHQ?(bool), setAspect('9:16' | '16:9') }
   setAspect re-plans the engine for the composition (canvas size, camera, layout); setHQ keeps working in either.
     param: { k, label, min, max, def, tier:1 = primary knob | group:'…' = Advanced,
              fmt?, hint?, int?, modes? }
   =========================================================================== */

const $=s=>document.querySelector(s);
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false) continue;
    if(k==='class') e.className=v; else if(k==='style') e.style.cssText=v; else if(k==='html') e.innerHTML=v;
    else if(k.startsWith('on')&&typeof v==='function') e.addEventListener(k.slice(2),v);
    else e.setAttribute(k,v===true?(k.startsWith('aria-')?'true':''):v);
  }
  for(const c of kids.flat(3)){ if(c==null||c===false) continue; e.append(c.nodeType?c:document.createTextNode(String(c))); }
  return e;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtT=t=>{ t=Math.max(0,t||0); return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0'); };
const fmtT2=t=>{ t=Math.max(0,t||0); return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0'); };
const f2=v=>v.toFixed(2);

const ICON={
  back:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3 5 8l5 5"/></svg>',
  reset:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3"/><path d="M4.5 2.2v2.7h2.7"/></svg>',
  shuffle:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h2.5c3 0 4 7 7 7H14"/><path d="M2 11.5h2.5c1.3 0 2.2-1.3 3-2.8M9.6 6.2c.6-1 1.3-1.7 1.9-1.7H14"/><path d="m12.3 2.8 1.7 1.7-1.7 1.7M12.3 9.8l1.7 1.7-1.7 1.7"/></svg>',
  play:'<svg viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9.5-5.5z"/></svg>',
  pause:'<svg viewBox="0 0 14 14" fill="currentColor"><rect x="2.5" y="1.5" width="3.2" height="11" rx=".6"/><rect x="8.3" y="1.5" width="3.2" height="11" rx=".6"/></svg>',
  restart:'<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="1.6" height="10" rx=".5"/><path d="M13 3.2v9.6L5.8 8z"/></svg>',
  chev:'<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4"/></svg>',
  chevL:'<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m10 4-4 4 4 4"/></svg>',
  close:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  frame:'<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="1.5" width="8" height="13" rx="1.5"/><circle cx="8" cy="8" r="1.8"/></svg>',
};

/* ------------------------------------------------------- preview signal ---
   Nothing is ever loaded for the user: the workspace waits for their track.
   This synthetic loop only animates the library cards (silently) and gives a
   waiting workspace one still frame to show the look.
   A 15.5 s loop (124 bpm, 8 bars) that builds: pad -> kick + hats -> clap +
   bass -> 16th hats + arp. Never played, never recorded. */
function makeDemoBeat(){
  const sr=44100, bpm=124, beat=60/bpm, bars=8, n=Math.floor(bars*4*beat*sr), x=new Float32Array(n);
  let s=4242; const rnd=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff*2-1);
  // note frequencies from a table filled with the same formula (the same numbers, bit for bit, without a pow per note per sample)
  const FQ=new Float64Array(128); for(let m=0;m<128;m++) FQ[m]=440*Math.pow(2,(m-69)/12);
  const f=m=>FQ[m], TAU=Math.PI*2;
  const chords=[[57,60,64,67],[53,57,60,65],[48,52,55,60],[55,59,62,67]], arp=[69,72,76,79,81,79,76,72];
  for(let i=0;i<n;i++){
    const t=i/sr, bar=Math.floor(t/(4*beat)), b=t%beat, bi=Math.floor(t/beat), ch=chords[bar%4];
    let v=0, pad=0;
    for(let k=0;k<ch.length;k++){ const fr=f(ch[k]); pad+=Math.sin(TAU*fr*t)+0.35*Math.sin(TAU*fr*2.003*t)+0.18*Math.sin(TAU*fr*3.01*t); }
    v+=0.055*pad*(0.7+0.3*Math.sin(TAU*t/5));
    if(bar>=1) v+=0.95*Math.sin(TAU*(48*b+120*(1-Math.exp(-b*30))/30))*Math.exp(-b*7.5);
    if(bar>=2){ const ob=((t-beat/2)%beat+beat)%beat; v+=0.34*Math.sin(TAU*f(ch[0]-24)*t)*Math.exp(-ob/0.22)*Math.min(1,ob*80); }
    if(bar>=2&&bi%2===1&&b<0.25) v+=0.5*rnd()*Math.exp(-b/0.045)+0.22*Math.sin(TAU*190*b)*Math.exp(-b/0.03);
    const sub=bar>=4?beat/4:beat/2, hb=t%sub; v+=(bar>=1?0.13:0.04)*rnd()*Math.exp(-hb/0.011);
    if(bar>=4){ const st=Math.floor(t/(beat/4))%8, lb=t%(beat/4); v+=0.10*Math.sin(TAU*f(arp[st])*t)*Math.exp(-lb/0.08); }
    x[i]=Math.tanh(v*0.9);
  }
  return {pcm:x,sr};
}
let _preview=null;
const PREVIEW=()=>_preview||(_preview=(()=>{ const d=makeDemoBeat(); return {pcm:d.pcm,sr:d.sr,duration:d.pcm.length/d.sr}; })());
function computePeaks(pcm,bins){
  const p=new Float32Array(bins), n=pcm.length; let mx=1e-6;
  for(let i=0;i<bins;i++){ const a=Math.floor(i*n/bins), b=Math.floor((i+1)*n/bins); let m=0;
    for(let k=a;k<b;k+=2){ const v=pcm[k]<0?-pcm[k]:pcm[k]; if(v>m)m=v; } p[i]=m; if(m>mx)mx=m; }
  for(let i=0;i<bins;i++) p[i]/=mx; return p;
}

/* --------------------------------------------------------- audio engine ---
   One AudioContext for the whole product. Everything plays through `gain`,
   which feeds both the speakers and a MediaStreamDestination that the
   Recorder taps. time() is the position actually being HEARD (output
   latency included), interpolated between audio callbacks and monotonic,
   so the picture stays locked to the sound on any display rate. */
const AudioEngine={
  ctx:null, gain:null, dest:null, buf:null, pcm:null, sr:44100, peaks:null, name:'', duration:0, user:false, ver:0, alt:null,
  playing:false, offset:0, from:0, until:0, startedAt:0, heardLast:0, src:null, subs:new Set(),
  on(fn){ this.subs.add(fn); }, emit(e){ this.subs.forEach(fn=>fn(e)); },
  ensure(){
    if(!this.ctx){ const C=window.AudioContext||window.webkitAudioContext; this.ctx=new C({latencyHint:'interactive'});
      this.gain=this.ctx.createGain(); this.gain.connect(this.ctx.destination);
      this.dest=this.ctx.createMediaStreamDestination(); this.gain.connect(this.dest); }
    if(this.ctx.state==='suspended') this.ctx.resume();
    return this.ctx;
  },
  setBuffer(buf,name){
    const n=buf.length, ch=buf.numberOfChannels, a=new Float32Array(n);
    for(let c=0;c<ch;c++){ const d=buf.getChannelData(c); for(let i=0;i<n;i++) a[i]+=d[i]/ch; }
    this._set(a,buf.sampleRate,buf,name,true);
  },
  _set(pcm,sr,buf,name,user){ this.stop(); this.alt=null; this.pcm=pcm; this.sr=sr; this.buf=buf; this.name=name; this.user=user;
    this.duration=pcm.length/sr; this.offset=0; this.peaks=computePeaks(pcm,1600); this.ver++; this.emit('track'); },
  buffer(){ if(!this.buf){ const b=this.ctx.createBuffer(1,this.pcm.length,this.sr); b.copyToChannel(this.pcm,0); this.buf=b; } return this.buf; },
  play(from=this.offset,until=null){
    if(!this.pcm) return;
    const ctx=this.ensure(); this._kill();
    if(from>=this.duration-0.03) from=0;
    until=until==null?this.duration:Math.min(this.duration,until);
    const s=ctx.createBufferSource(); s.buffer=this.alt||this.buffer(); s.connect(this.gain);
    s.start(0,from,Math.max(0.05,until-from));
    s.onended=()=>{ if(this.src!==s) return; this.src=null; this.playing=false; this.offset=until>=this.duration-0.05?this.duration:until; this.emit('ended'); this.emit('state'); };
    this.src=s; this.from=from; this.until=until; this.startedAt=ctx.currentTime; this.heardLast=from; this.playing=true; this.emit('state');
  },
  heard(){ const c=this.ctx.currentTime;
    if(this.ctx.getOutputTimestamp){ const ts=this.ctx.getOutputTimestamp();
      if(ts&&ts.contextTime>0&&ts.performanceTime>0) return Math.min(c,ts.contextTime+(performance.now()-ts.performanceTime)/1000); }
    return c; },
  time(){ if(!this.playing) return this.offset;
    const p=Math.max(this.heardLast,this.from+Math.max(0,this.heard()-this.startedAt)); this.heardLast=p; return Math.min(this.until,p); },
  pause(){ if(!this.playing) return; this.offset=this.time(); this._kill(); this.playing=false; this.emit('state'); },
  stop(){ this._kill(); this.playing=false; },
  _kill(){ if(this.src){ const s=this.src; this.src=null; s.onended=null; try{s.stop()}catch(e){} } },
  seek(t){ t=clamp(t,0,this.duration); if(this.playing) this.play(t); else { this.offset=t; this.emit('state'); } },
  toggle(){ this.playing?this.pause():this.play(); },
  // play another buffer of the same track on the same clock (a stem instead of the mix); null = the mix
  setAlt(b){ if(this.alt===b) return; this.alt=b; if(this.playing){ const t=this.time(), u=this.until; this.play(t,u); } },
  get has(){ return !!this.pcm; },
};

/* ================================================================ ADAPTERS */

/* ---- 02 RETRO: character-cell engine (canvas 2D) ---- */
const RetroAdapter={
  id:'retro', num:'02', name:'Retro', tag:'Glyph',
  looks:Object.entries(RETRO.LOOKS).map(([k,L])=>({k,label:L.label,bg:L.base,fg:L.ink1,g:L.ink0})),
  defaultLook:'mono',
  modes:{label:'Style',def:'r1',looks:{r1:'mono',r3:'raster'},options:[
    {v:'r1',label:'Trace',hint:'Bright characters on an open field'},
    {v:'r3',label:'Raster',hint:'The trace carved out of a solid wall of blocks'}]},
  params:[
    {k:'density',label:'Density',min:0,max:1,def:0.5,tier:1,hint:'How many characters light up around the trace'},
    {k:'scale',label:'Size',min:0.6,max:1.6,def:1,tier:1,fmt:v=>Math.round(44/v)+' cols',hint:'Character size: fewer, bigger cells to the right'},
    {k:'response',label:'Reaction',min:0,max:2,def:1,tier:1,hint:'How strongly the audio drives the picture'},
    {k:'motion',label:'Redraw rate',group:'Motion',min:0.5,max:1.5,def:1,fmt:v=>(21.6*v).toFixed(1)+' / s',hint:'How many new states per second'},
    {k:'persistence',label:'Persistence',group:'Motion',min:0,max:1,def:0,fmt:v=>v?f2(v):'Off',hint:'Characters linger for a state or two'},
    {k:'contrast',label:'Contrast',group:'Tone',min:0,max:1,def:{r1:0.4,r3:0.5}},
    {k:'bloom',label:'Bloom',group:'Tone',min:0,max:1.5,def:0.6,modes:['r1'],fmt:v=>v?f2(v):'Off',hint:'Coloured light around lit cells'},
    {k:'noise',label:'Field noise',group:'Tone',min:0,max:1.5,def:0.5,modes:['r3'],fmt:v=>v?f2(v):'Off',hint:'Stray glyphs scattered through the wall'},
  ],
  create(){
    const c=document.createElement('canvas'); c.width=540; c.height=960;
    const ctx=c.getContext('2d',{alpha:false}), eng=new RETRO.Engine(), S=structuredClone(RETRO.DEFAULTS);
    let pcm=null, sr=44100, ver=1, hq=false, land=false;
    const size=()=>{ const sh=hq?1080:540, lg=hq?1920:960; c.width=land?lg:sh; c.height=land?sh:lg; ver++; };
    return { canvas:c,
      setAudio(p,r){ pcm=p; sr=r; ver++; },
      frame(t){ eng.render(ctx,c.width,c.height,t,S,pcm,sr,ver); },
      set(k,v){ S.r1[k]=v; S.r3[k]=v; ver++; },
      setLook(k){ S.r1.look=S.r3.look=k; ver++; },
      setMode(v){ S.preset=v; ver++; },
      setHQ(on){ hq=!!on; size(); },
      setAspect(a){ land=a==='16:9'; size(); },
    };
  }
};

/* ---- 03 CAUSTIC: CPU raster pipeline (input ribbon -> displacement -> thermal -> tracker) ---- */
const CausticAdapter={
  id:'caustic', num:'03', name:'Bleach', tag:'Field', cost:'cpu',   // CPU raster: fixed 540 x 960, no HQ step
  looks:[{k:'disp',label:'Displaced',bg:'#000000',fg:'#e8e8e8',g:'#6d6d6d'},{k:'out',label:'Thermal',bg:'#ff7e02',fg:'#0b0b0b',g:'#f00a05'}],
  defaultLook:'disp',
  params:[
    {k:'displacement',o:'U',label:'Displace',min:0,max:3,def:1,tier:1,hint:'How far the cellular field pushes the ribbon apart'},
    {k:'speed',o:'U',label:'Speed',min:0,max:3,def:0.97,tier:1,hint:'Speed of the form\u2019s own movement'},
    {k:'tracker',o:'U',label:'Tracker',min:0,max:1,def:0.65,tier:1,fmt:v=>v<0.02?'Off':f2(v),hint:'How many shapes the HUD locks on to'},
    {k:'cont',o:'U',label:'Continuous motion',group:'Motion',min:0,max:1,def:0.35,fmt:v=>v<0.12?'Audio-led':v>0.8?'Evolving':f2(v),hint:'Low: moves mostly with the audio. High: keeps evolving on its own'},
    {k:'low',o:'U',label:'Low',group:'Spectral motion',min:0,max:2,def:1,fmt:v=>f2(v)+'\u00d7',hint:'Kick and bass drive the large, slow structure'},
    {k:'mid',o:'U',label:'Mid',group:'Spectral motion',min:0,max:2,def:1,fmt:v=>f2(v)+'\u00d7',hint:'Mid band drives the body of the movement'},
    {k:'high',o:'U',label:'High',group:'Spectral motion',min:0,max:2,def:1,fmt:v=>f2(v)+'\u00d7',hint:'Hats and highs drive the fine, fast detail'},
    {k:'lines',o:'IN',label:'Hairlines',group:'Form',min:2,max:48,def:22,int:true},
    {k:'width',o:'IN',label:'Ribbon width',group:'Form',min:20,max:400,def:150,int:true,fmt:v=>v+' px'},
    {k:'twist',o:'IN',label:'Twist',group:'Form',min:0.25,max:4,def:1.2},
    {k:'glow',o:'IN',label:'Glow',group:'Form',min:0,max:2,def:2},
    {k:'floor',o:'IN',label:'Brightness floor',group:'Form',min:0,max:1,def:0.10,hint:'How bright the ribbon is in silence'},
    {k:'cell',o:'DS',label:'Cell size',group:'Field',min:20,max:400,def:86,int:true,fmt:v=>v+' px'},
    {k:'vein',o:'DS',label:'Vein sharpness',group:'Field',min:0,max:1,def:0.71},
    {k:'seed',o:'DS',label:'Pattern',group:'Field',min:1,max:40,def:8,int:true,fmt:v=>'#'+v},
    {k:'gamma',o:'TH',label:'Thermal gamma',group:'Thermal',min:0.2,max:2,def:0.62,modes:['out']},
    {k:'edge',o:'TH',label:'Edge darkening',group:'Thermal',min:0,max:0.5,def:0.06,modes:['out']},
    {k:'persist',o:'TK',label:'Tracker persistence',group:'Tracker',min:0,max:0.95,def:0.66},
    {k:'cap',o:'TK',label:'Caption size',group:'Tracker',min:10,max:26,def:17,int:true,fmt:v=>v+' px'},
  ],
  create(){
    let W=540, H=960; const c=document.createElement('canvas'); c.width=W; c.height=H;
    const ctx=c.getContext('2d',{alpha:false}); let R=new CAUSTIC.Ref(W,H), pcm=null, sr=44100;
    const OBJ={U:CAUSTIC.U,IN:CAUSTIC.IN,DS:CAUSTIC.DS,TH:CAUSTIC.TH,TK:CAUSTIC.TK};
    return { canvas:c,
      setAudio(p,r){ pcm=p; sr=r; R.clear(); },
      frame(t,dt){ if(pcm) R.render(ctx,W,H,t,pcm,sr,dt); },
      set(k,v){ const p=CausticAdapter.params.find(q=>q.k===k); OBJ[p.o][k]=v; if(p.o==='U') CAUSTIC.applyUser(); },
      setLook(k){ CAUSTIC.U.stage=k; },
      // landscape: the same CPU raster turned on its side (960 x 540); the analysis carries over
      setAspect(a){ const land=a==='16:9'; if((W>H)===land) return; const t=W; W=H; H=t; c.width=W; c.height=H;
        const old=R; R=new CAUSTIC.Ref(W,H); R.an=old.an; R.anPcm=old.anPcm; R.lastT=old.lastT; },
    };
  }
};

/* ---- 04 CONTOUR: WebGL2 cloth renderer ---- */
const contourCache=new WeakMap();   // pcm -> offline analysis, shared by every Contour instance
const ContourAdapter={
  id:'contour', num:'04', name:'Contour', tag:'Cloth',
  looks:Object.entries(CONTOUR_DATA.COLOR_PRESETS).map(([k,p])=>({k,label:p.name,bg:p.swatch.b,fg:p.swatch.f,g:p.swatch.g})),
  defaultLook:CONTOUR_DATA.DEFAULT_PRESET,
  params:(()=>{ const M={
      twist:{label:'Twist',tier:1,hint:'How many half-turns the cloth makes'},
      flow:{label:'Flow',tier:1,hint:'Speed of rotation and the travelling torsion'},
      glow:{label:'Glow',tier:1,hint:'Soft light bleeding off the dense threads'},
      body:{group:'Shape'}, influence:{group:'Shape',label:'Audio influence'}, trails:{group:'Shape',fmt:v=>v?f2(v):'Off'},
      halo:{group:'Shape',fmt:v=>v?f2(v):'Off'}, grit:{group:'Shape'},
      rays:{group:'Light & space'}, depth:{group:'Light & space'}, warp:{group:'Light & space'} };
    return CONTOUR_DATA.CONTROLS.map(c=>({k:c.k,label:c.label,min:c.min,max:c.max,def:c.v,hint:c.hint.charAt(0).toUpperCase()+c.hint.slice(1),...M[c.k]})); })(),
  create(){
    const c=document.createElement('canvas'), E=makeContour(c);
    E.setup(720,1280); let hq=false, land=false;
    const size=()=>{ const sh=hq?1080:720, lg=hq?1920:1280; E.setup(land?lg:sh,land?sh:lg); };
    return { canvas:c,
      setAudio(p,r){ let A=contourCache.get(p); if(!A){ A=E.analyze(p,r); contourCache.set(p,A); } E.A=A; },
      frame(t,dt,playing){ E.frame(t,dt,playing); },
      set(k,v){ E.P[k]=v; },
      setLook(k){ E.setPreset(k); },
      setHQ(on){ hq=!!on; size(); },
      setAspect(a){ land=a==='16:9'; size(); },
    };
  }
};

/* ---- 05 DUST: WebGL2 point sheet (300k points) with camera cuts ---- */
const dustCache=new WeakMap();
const DustAdapter={
  id:'dust', num:'05', name:'Dust', tag:'Particles',
  looks:Object.entries(DUST_DATA.LOOKS).map(([k,L])=>({k,label:L.name,bg:L.sw.b,fg:L.sw.f,g:L.sw.f})),
  defaultLook:'black',
  modes:{label:'Camera',def:'auto',options:[
    {v:'auto',label:'Auto',hint:'Cuts between views on the hits'},{v:'side',label:'Side'},{v:'oblique',label:'Oblique'},
    {v:'vertical',label:'Vertical'},{v:'axis',label:'Axis'}]},
  params:(()=>{ const M={
      complexity:{tier:1,def:0.64,hint:'How many folds the sheet makes'},
      drift:{tier:1,def:1.23,hint:'Speed of the flow through the field'},
      glow:{tier:1,def:0.87,hint:'Near glow and the haze that lifts the black'},
      scale:{group:'Form',def:1.27}, detail:{group:'Form',def:1.38},
      lines:{group:'Light',def:2.03}, brightness:{group:'Light',def:0.76},
      persistence:{group:'Response',def:0.90}, response:{group:'Response',def:1},
      lowResp:{group:'Response',label:'Bass and kick',def:1}, midResp:{group:'Response',label:'Mid and snare',def:1}, highResp:{group:'Response',label:'High and hats',def:0} };
    return DUST_DATA.CONTROLS.map(c=>({k:c.k,label:c.label,min:c.min,max:c.max,def:c.v,hint:c.hint.charAt(0).toUpperCase()+c.hint.slice(1),...M[c.k]})); })(),
  create(){
    const c=document.createElement('canvas'), E=makeDust(c);
    E.setup(720,1280); let hq=false, land=false;
    const size=()=>{ const sh=hq?1080:720, lg=hq?1920:1280; E.setup(land?lg:sh,land?sh:lg); };
    return { canvas:c,
      setAudio(p,r){ let A=dustCache.get(p); if(!A){ A=E.analyze(p,r); dustCache.set(p,A); } E.A=A; },
      frame(t,dt,playing){ E.frame(t,dt,playing); },
      set(k,v){ E.P[k]=v; },
      setLook(k){ E.setLook(k); },
      setMode(v){ E.P.shape=v; },
      setHQ(on){ hq=!!on; size(); },
      setAspect(a){ land=a==='16:9'; size(); },
    };
  }
};

/* ---- 06 SPATIAL: WebGL2 strand field (4096 strands x 48-step trails) + film chain + blob tracker ---- */
const spatialCache=new WeakMap();
const SpatialAdapter={
  id:'spatial', num:'06', name:'Spatial', tag:'Energy', cost:'heavy',
  looks:[{k:'mono',label:'Mono',bg:'#060606',fg:'#ededea',g:'#6b6b68'},{k:'thermal',label:'Thermal',bg:'#1e04d6',fg:'#f5bc41',g:'#ea3e26'},
         {k:'red',label:'Red',bg:'#090202',fg:'#f6ac50',g:'#a51b12'},{k:'orange',label:'Orange',bg:'#f09536',fg:'#590d07',g:'#cc2b1d'}],
  defaultLook:'mono',
  modes:{label:'Camera',def:'static',options:[{v:'static',label:'Static',hint:'Camera locked; the form roams near the centre'},{v:'dynamic',label:'Dynamic',hint:'Camera drifts and the whole frame travels'}]},
  params:(()=>{ const M={
      scale:{hint:'Size of the form in the frame'}, speed:{tier:1,hint:'How fast the field evolves'}, glow:{tier:1,hint:'Glow off the bright core'},
      tAmount:{tier:1,label:'Tracker',fmt:v=>v<0.01?'Off':f2(v),hint:'How many structures the tracker locks on to'} };
    // VYRAL's defaults for Spatial (tuned by hand); Scale, Speed and Glow keep the engine's own values
    const DEF={ structure:.84, turb:.86, drift:.25, density:.65, sep:1, persist:.55, detail:.60, core:.32, haze:.79, bright:.70,
      resp:.80, bass:.52, mid:.90, high:.50, grain:.27, grainSize:.77, grainMove:1, tAmount:.41 };
    const L=SPATIAL_DATA.CONTROLS.map(([k,label,def,sec])=>({k,label,min:0,max:1,def:DEF[k]??def,group:sec,...M[k]}));
    L.unshift(...L.splice(L.findIndex(p=>p.k==='tAmount'),1));   // main knobs: Tracker first (where Scale was), then Speed, Glow; Scale moves to Advanced
    return L; })(),
  create(){
    const c=document.createElement('canvas'), E=makeSpatial(c); let pcm0=null;
    return { canvas:c,
      setAudio(p,r){ let A=spatialCache.get(p); if(!A){ A=E.analyze(p,r); spatialCache.set(p,A); } E.setA(A); pcm0=p; },
      frame(t,dt,playing){ E.frame(t,dt,playing); },
      set(k,v){ E.P[k]=v; E.touch(); },
      setLook(k){ E.setPalette(k); },
      setMode(v){ E.UI.camera=v; E.touch(); },
      setHQ(on){ E.setRes(on?1080:720); },
      setAspect(a){ E.setLand(a==='16:9'); },
    };
  }
};

/* ---- 07 VOLUME: instanced spike sphere (~11k spikes), MSAA, glow chain, gradient-map looks ---- */
const VolumeAdapter={
  id:'volume', num:'07', name:'Volume', tag:'Object', cost:'heavy',
  looks:VOLUME_DATA.LOOKS.map(L=>{ const hx=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''); return L.stops?{k:L.id,label:L.name,bg:hx(L.stops[0]),fg:hx(L.stops[4]),g:hx(L.stops[2])}:{k:L.id,label:L.name,bg:'#050606',fg:'#cfdde1',g:'#5d6c70'}; }),
  defaultLook:'steel',   // the library card and a fresh start: Steel, on black
  params:(()=>{ const M={ shape:{tier:1,hint:'How far the surface folds and swells'}, motion:{tier:1,hint:'How much the audio moves the body'}, glow:{tier:1,hint:'Light bleeding off the lit spikes'},
      density:{int:true,fmt:v=>(v/1000).toFixed(1)+'k spikes'}, lowmid:{label:'Low-mid'}, bright:{label:'Brightness',def:2.5}, contrast:{def:1.14} };   // Artem's Steel settings (Oct 13) as the start
    const out=[]; for(const [g,list] of Object.entries(VOLUME_DATA.UI)) for(const [k,label,min,max] of list)
      out.push({k,label,min,max,def:VOLUME_DATA.DEF[k],group:{gForm:'Form',gMotion:'Motion',gAudio:'Audio',gLight:'Light'}[g],...M[k]});
    return out; })(),
  create(){
    const c=document.createElement('canvas'); c.width=1080; c.height=1920; const E=makeVolume(c);
    return { canvas:c,
      setAudio(p,r){ E.setAudio(p,r); },
      frame(t,dt,playing){ E.frame(t,dt,playing); },
      set(k,v){ E.P[k]=v; if(k==='density') E.rebuildLattice(); },
      setLook(k){ E.setLook(k); },
      setAspect(a){ const land=a==='16:9'; E.setSize(land?1920:1080,land?1080:1920); },
    };
  }
};

/* ---- 01 MIDI / SCORE: the track read as music (stems, notes, chords, drums) and drawn as a score ----
   The approved engine runs unchanged (MIDI_SCORE.Core / Music / Renderer). This adapter only gives it
   VYRAL's audio and clock. Its analysis is offline and asynchronous: once per track and analysis mode,
   cached, with progress on the stage. It starts only when MIDI / Score is opened in the workspace (the
   library card alone never starts one; until then it shows the track's name on the empty score).
   With no track yet it shows the built-in demo score (a_midi_demo.js: the engine's own demo tune, analysed at
   build time), so the library card plays a real score at once; ?midi-demo analyses the demo tune live instead (development).
   The lane key stays 'high' inside; the picture labels it 'upper'. */
/* MIDI analysis off the main thread. Music.analyse is pure computation, so the very same engine code (the source of
   MIDI_SCORE_FACTORY, started from a Blob) runs in a Web Worker: the page keeps drawing and stays responsive while a
   track is read. The worker gets a copy of the audio, reports progress as it goes, and hands the finished analysis
   back with its arrays moved rather than copied. The result is the same object the page would have computed (checked
   by structured clone + refine on the demo tune and real tracks, every analysis mode). If a worker can't be started
   here, or anything goes wrong in it, the analysis simply runs on the page as before. */
const MidiOffThread=(function(){
  let url=null, broken=false;
  // runs inside the worker: `factory` is MIDI_SCORE_FACTORY
  function workerMain(factory){
    // the analysis yields to the event loop often (setTimeout 0); in a worker nothing needs those gaps, so zero-delay
    // timers resolve through a MessageChannel instead of the browser's clamped (4 ms) timers. Results don't depend on timing.
    try{ const queue=[], mc=new MessageChannel(), slow=self.setTimeout.bind(self);
      mc.port1.onmessage=()=>{ const f=queue.shift(); if(f) f(); };
      self.setTimeout=function(f,d){ const a=[].slice.call(arguments,2); if(d>0) return slow.apply(self,arguments); queue.push(()=>f.apply(self,a)); mc.port2.postMessage(0); return 0; };
    }catch(e){}   // no MessageChannel here: the ordinary timers are used, nothing else changes
    const MS=factory();
    self.onmessage=async e=>{
      const m=e.data; let st;
      if(m.type==='midi'){   // a MIDI file to read (Music.readMidi): small, but never on the page's thread either
        try{ self.postMessage({type:'done',state:MS.Music.readMidi(m.bytes)}); }
        catch(err){ self.postMessage({type:'error',midi:!!(err&&err.midi),message:err&&err.midi?err.message:String(err&&err.stack||err)}); }
        return; }
      try{ st=await MS.Music.analyse(m.channels,m.sr,{mode:m.mode,debug:m.debug,onProgress:(label,p)=>self.postMessage({type:'progress',label,p})}); }
      catch(err){ self.postMessage({type:'error',message:String(err&&err.stack||err)}); return; }
      // every typed array in the result moves back to the page instead of being copied
      const bufs=new Set(), seen=new Set();
      const walk=v=>{ if(!v||typeof v!=='object'||seen.has(v)) return; seen.add(v);
        if(ArrayBuffer.isView(v)){ if(v.buffer instanceof ArrayBuffer) bufs.add(v.buffer); return; }
        if(v instanceof Map){ v.forEach((x,k)=>{ walk(k); walk(x); }); return; }
        if(v instanceof Set){ v.forEach(walk); return; }
        for(const k in v) walk(v[k]); };
      walk(st);
      try{ self.postMessage({type:'done',state:st},[...bufs]); }
      catch(err){ self.postMessage({type:'error',message:'the analysis could not be sent back: '+err}); }
    };
  }
  function start(){
    if(broken||typeof Worker!=='function'||typeof MIDI_SCORE_FACTORY!=='function') return null;
    try{
      if(!url) url=URL.createObjectURL(new Blob(['('+workerMain.toString()+')('+MIDI_SCORE_FACTORY.toString()+');'],{type:'text/javascript'}));
      return new Worker(url);
    }catch(e){ broken=true; console.warn('[MIDI / Score] no worker here, the analysis runs on the page',e); return null; }
  }
  /* same contract as Music.analyse(channels,sr,opt): a promise of the analysis state. The promise also has cancel(),
     which stops a worker that is no longer needed (its promise then rejects with {cancelled:true}). */
  function analyse(channels,sr,opt){
    opt=opt||{}; const report=opt.onProgress||(()=>{});
    const onPage=()=>MIDI_SCORE.Music.analyse(channels,sr,opt);
    const W=start(); if(!W){ const p=onPage(); p.cancel=()=>{}; return p; }
    let settled=false, cancel=()=>{};
    const p=new Promise((resolve,reject)=>{
      const end=()=>{ settled=true; try{ W.terminate(); }catch(e){} };
      const fallBack=why=>{ if(settled) return; end(); console.warn('[MIDI / Score] the worker could not finish; analysing on the page instead:',why); onPage().then(resolve,reject); };
      cancel=()=>{ if(settled) return; end(); const e=new Error('cancelled'); e.cancelled=true; reject(e); };
      W.onmessage=e=>{ if(settled) return; const m=e.data||{};
        if(m.type==='progress') report(m.label,m.p);
        else if(m.type==='done'){ end(); resolve(m.state); }
        else fallBack(m.message); };
      W.onerror=e=>{ if(e&&e.preventDefault) e.preventDefault(); fallBack(e&&e.message||'worker error'); };
      W.onmessageerror=()=>fallBack('the analysis could not be received');
      try{ const copies=channels.map(c=>new Float32Array(c));   // the page keeps its own audio; the worker gets a copy
        W.postMessage({channels:copies,sr,mode:opt.mode,debug:opt.debug},copies.map(c=>c.buffer)); }
      catch(e){ fallBack(e); }
    });
    p.cancel=()=>cancel();
    return p;
  }
  /* a MIDI file (Uint8Array) read into the score's parts: the same promise-with-cancel contract. A file that isn't
     MIDI rejects with e.midi = true and a readable message; anything else falls back to reading it on the page. */
  function readMidi(bytes){
    const onPage=()=>new Promise((res,rej)=>setTimeout(()=>{ try{ res(MIDI_SCORE.Music.readMidi(bytes)); }catch(e){ rej(e); } },0));
    const W=start(); if(!W){ const p=onPage(); p.cancel=()=>{}; return p; }
    let settled=false, cancel=()=>{};
    const p=new Promise((resolve,reject)=>{
      const end=()=>{ settled=true; try{ W.terminate(); }catch(e){} };
      const fallBack=()=>{ if(settled) return; end(); onPage().then(resolve,reject); };
      cancel=()=>{ if(settled) return; end(); const e=new Error('cancelled'); e.cancelled=true; reject(e); };
      W.onmessage=e=>{ if(settled) return; const m=e.data||{};
        if(m.type==='done'){ end(); resolve(m.state); }
        else if(m.type==='error'&&m.midi){ end(); const x=new Error(m.message); x.midi=true; reject(x); }
        else if(m.type==='error') fallBack(); };
      W.onerror=e=>{ if(e&&e.preventDefault) e.preventDefault(); fallBack(); };
      W.onmessageerror=fallBack;
      try{ const copy=bytes.slice(); W.postMessage({type:'midi',bytes:copy},[copy.buffer]); }catch(e){ fallBack(); }
    });
    p.cancel=()=>cancel();
    return p;
  }
  return { analyse, readMidi };
})();
const midiCache=new WeakMap();   // audio -> { [analysis mode]: { p:Promise<state>, prog, done, failed } }
let midiDemo=null;
const MIDI_DEV_DEMO=/[?&]midi-demo\b/.test(location.search);
const MIDI_LEAD=0.015;           // the reference's small visual lead so hits land on the beat
const midiPct=v=>String(Math.round(v*100));
/* Tempo & key: the 24 keys, spelled as the score spells them */
const MIDI_KEY_NAMES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const midiKeyLabel=k=>k?MIDI_KEY_NAMES[k.tonic]+' '+k.mode:'';
/* Upload MIDI: one hidden file input, created the first time it is used */
let midiPickFor=null;
function pickMidiFile(inst){
  if(Recorder.busy()) return toast('Stop the recording first.');
  let i=document.getElementById('midiIn');
  if(!i){ i=h('input',{type:'file',id:'midiIn',accept:'.mid,.midi,.rmi,audio/midi,audio/x-midi',hidden:true}); document.body.append(i);
    i.addEventListener('change',()=>{ const f=i.files[0]; i.value=''; if(f&&midiPickFor) midiPickFor.useMidiFile(f); }); }
  midiPickFor=inst; i.click();
}
const isMidiFile=f=>/\.(mid|midi|rmi|smf)$/i.test(f.name)||/^audio\/(x-)?midi$/i.test(f.type||'');
const MidiAdapter={
  id:'midi', num:'01', name:'MIDI / Score', short:'Score', tag:'Score', cost:'cpu', feature:'visualizer.midi-score',
  looks:[
    {k:'graphite',feature:'skin.graphite',label:'Graphite',theme:'dark',ink:'graphite',bg:'#000000',fg:'#ebeae5',g:'#77766f'},
    {k:'forest',feature:'skin.forest',label:'Forest',theme:'dark',ink:'forest',bg:'#121412',fg:'#a8cbb6',g:'#4f6b5b'},
    {k:'paper',feature:'skin.paper',label:'Paper',theme:'light',ink:'graphite',bg:'#efeee9',fg:'#1b1c1a',g:'#a3a29b'},
    {k:'paper-forest',feature:'skin.paperForest',label:'Paper forest',theme:'light',ink:'forest',bg:'#f0efea',fg:'#2c5a44',g:'#98ab9f'}],
  defaultLook:'graphite',   // the library card and a fresh start: Graphite, on black
  clipOptions:[{v:'full',label:'Whole track'},{v:'30',label:'30 s'},{v:'45',label:'45 s'},{v:'60',label:'60 s'}],   // Rec length: MIDI / Score only
  noBrand:true,   // the score writes its own words (Text in its panel); the Branding layouts don't apply to it
  modes:{label:'View',def:'map',options:[
    {v:'map',label:'Map',hint:'Upper, chords, bass and percussion, each on its own band'},
    {v:'blocks',label:'Blocks',hint:'Notes as solid blocks'},
    {v:'flow',label:'Flow',hint:'Notes as flowing light'},
    {v:'staff',label:'Staff',hint:'Written on staves'}]},
  params:[
    {k:'window',label:'Density',min:3,max:16,def:4.5,tier:1,fmt:v=>v.toFixed(1)+' s',hint:'How many seconds of music fit across the frame'},
    {k:'detail',label:'Detail',min:0,max:1,def:0.47,tier:1,fmt:midiPct,hint:'How much secondary detail to show. Weak and uncertain notes stay hidden'},
    {k:'response',label:'Response',min:0,max:1,def:0.5,tier:1,fmt:midiPct,hint:'How strongly the picture reacts to the sound'},
    {k:'analysis',feature:'advanced.analysis',label:'Analysis',group:'Analysis',def:'auto',hint:'Auto decides per track; Fast skips the lead search; Accurate always separates the stems',
     choices:[{v:'auto',label:'Auto'},{v:'fast',label:'Fast'},{v:'accurate',label:'Accurate'}]},
    {k:'listen',feature:'advanced.listen',label:'Listen',group:'Analysis',def:'mix',hint:'Hear the stems the analysis used, in place of the mix',
     choices:[{v:'mix',label:'Mix'},{v:'drums',label:'Drums'},{v:'bass',label:'Bass'},{v:'lead',label:'Lead'},{v:'other',label:'Other'}],
     avail:(inst,v)=>v==='mix'||!!(inst.stems&&inst.stems()[v])},
    {k:'motion',feature:'advanced.motion',label:'Motion',group:'Score',def:'scroll',choices:[{v:'scroll',label:'Scroll',hint:'The score moves under a fixed playhead'},{v:'page',label:'Page',hint:'The playhead moves across a page, then turns it'}]},
    {k:'future',feature:'advanced.future',label:'Future',group:'Score',def:'ghost',hint:'How music that hasn’t played yet is shown',choices:[{v:'ghost',label:'Ghost'},{v:'hide',label:'Hide'},{v:'show',label:'Show'}]},
    {k:'grid',feature:'advanced.grid',label:'Grid',group:'Score',def:'on',choices:[{v:'on',label:'On'},{v:'off',label:'Off'}]},
    {k:'layout',feature:'advanced.layout',label:'Layout',group:'Score',def:'adaptive',choices:[{v:'adaptive',label:'Adaptive',hint:'Lanes sized to their content, kept inside the safe area'},{v:'full',label:'Full',hint:'Lanes stretched over the whole frame'}]},
    {k:'pitchRange',feature:'advanced.pitchRange',label:'Pitch range',group:'Score',def:'fit',choices:[{v:'fit',label:'Fit',hint:'Each lane spans the notes it actually uses'},{v:'full',label:'Full',hint:'Fixed ranges per lane'}]},
  ],
  // the side panel's extra block: MIDI export, what the analysis found (tempo and key, with a way to set them),
  // and, quieter, a MIDI file of your own for the notes
  panel(inst){
    inst.wake&&inst.wake();   // the panel is built when MIDI / Score opens: a track waiting for its analysis starts it now
    const ok=canUse('midi.export'), btn=h('button',{class:'btn',onclick:()=>inst.exportMidi()},'Export MIDI',ok?null:lockMark()), note=h('span',{class:'note'});
    const edit=h('button',{class:'link','data-tip':'Set the tempo or the key yourself',onclick:()=>{ App.advTab='vis'; if(App.advOpen) buildAdv(); else toggleAdv(true); }},'Edit');
    const file=h('div',{class:'mf-row'});
    const sync=()=>{ const s=inst.summary(); btn.disabled=!s||!s.export; note.textContent=s?s.text:inst.progress()?'Analysing…':'Add a track to export MIDI.'; edit.hidden=!s;
      const M=inst.midiFile(); file.innerHTML='';
      if(!M) file.append(h('button',{class:'link','data-tip':'Use your own MIDI file (melody, chords, bass) for the notes. The audio still drives the rest.',onclick:()=>pickMidiFile(inst)},'Upload MIDI'));
      else if(M.status==='reading') file.append(h('span',{class:'note'},`Reading ${M.name}…`));
      else if(M.status==='error') file.append(h('span',{class:'note mf-err'},`Couldn’t use ${M.name}: ${M.msg}.`+(M.using?` Still using ${M.using}.`:'')),
        h('button',{class:'link',onclick:()=>pickMidiFile(inst)},'Try another'),h('button',{class:'link',onclick:()=>inst.dismissMidi()},'Dismiss'));
      else file.append(h('span',{class:'mf-name',title:M.name},M.name),h('span',{class:'note'},M.info),
        h('button',{class:'link',onclick:()=>pickMidiFile(inst)},'Replace'),h('button',{class:'link',onclick:()=>inst.clearMidi()},'Remove')); };
    // Text: the words the score writes at its head, as they are on the picture; type over them, clear a line to hide it
    const row=(part,label,ph)=>{ const inp=h('input',{class:'bin',spellcheck:'false','aria-label':label,maxlength:120});
      const reset=h('button',{class:'ico bx','aria-label':'Back to automatic','data-tip':'Back to automatic',html:ICON.reset,onclick:()=>{ inst.setHeader(part,null); inp.value=inst.header()[part].auto; syncText(); }});
      inp.addEventListener('input',()=>{ const x=inst.header()[part]; inst.setHeader(part,inp.value===x.auto?null:inp.value); syncText(); });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); inp.blur(); } });
      inp.addEventListener('blur',()=>syncText());
      const r=h('div',{class:'brow hdr-row','data-part':part},h('span',{class:'brole'},label),inp,reset); r.inp=inp; r.reset=reset; r.ph=ph; return r; };
    const rows=[row('title','Title','Track name'),row('info','Details','Tempo, key and length')];
    const syncText=()=>{ const H=inst.header();
      for(const r of rows){ const x=H[r.dataset.part];
        if(document.activeElement!==r.inp) r.inp.value=x.text==null?x.auto:x.text;
        r.inp.placeholder=x.text===''?'Not shown':r.ph; r.reset.hidden=x.text==null; } };
    inst.watch=()=>{ sync(); syncText(); }; sync(); syncText();
    const frag=document.createDocumentFragment();
    frag.append(h('div',{class:'blk'},h('span',{class:'lab'},'Score'),h('div',{class:'midi-row'},btn,note,edit),file),
      h('div',{class:'blk'},h('span',{class:'lab'},'Text'),h('div',{class:'brows'},rows),
        h('p',{class:'note'},'The words at the top of the score. Type your own, or clear a line to hide it. Double-click them on the preview to edit.')));
    return frag;
  },
  // Advanced, Score tab: tempo and key, as found in the music (Auto) or set by hand (Manual)
  adv(inst,body){
    const box=h('div');
    const render=()=>{ box.innerHTML=''; const T=inst.tempoKey(), D=T.detected, wait=!T.ready;
      const waitTxt=inst.progress()?'analysing…':'waiting for a track';
      const bMan=T.manual.bpm>0, kMan=!!T.manual.key;
      const bSeg=Seg([{v:'auto',label:'Auto',hint:'The tempo found in the music'},{v:'manual',label:'Manual',hint:'Set the tempo yourself'}],bMan?'manual':'auto',v=>{
        inst.setTempoKey({bpm:v==='manual'?(D.bpm>0?clamp(Math.round(D.bpm),40,240):120):0}); render(); });
      bSeg.buttons.forEach(b=>b.disabled=wait);
      box.append(h('div',{class:'choice'},h('span',{class:'lab'},'BPM'),bSeg));
      if(bMan) box.append(Slider({label:'Tempo',min:40,max:240,int:true,value:T.manual.bpm,def:D.bpm>0?clamp(Math.round(D.bpm),40,240):120,fmt:v=>Math.round(v)+' BPM',
        hint:'Double-click to go back to the detected tempo',onInput:v=>inst.setTempoKey({bpm:v},true)}));
      box.append(h('p',{class:'note'},(D.bpmFrom==='file'?'From the MIDI file: ':'Detected: ')+(wait?waitTxt:D.bpm>0?Math.round(D.bpm)+' BPM':'no steady beat')+(bMan?'. The grid, bars and Export MIDI use yours.':'')));
      const kSeg=Seg([{v:'auto',label:'Auto',hint:'The key found in the music'},{v:'manual',label:'Manual',hint:'Set the key yourself'}],kMan?'manual':'auto',v=>{
        inst.setTempoKey({key:v==='manual'?(D.key||{tonic:0,mode:'major'}):null}); render(); });
      kSeg.buttons.forEach(b=>b.disabled=wait);
      box.append(h('div',{class:'choice'},h('span',{class:'lab'},'Key'),kSeg));
      if(kMan){ const sel=h('select',{class:'bsel wide','aria-label':'Key'},['major','minor'].map(mo=>h('optgroup',{label:mo==='major'?'Major':'Minor'},MIDI_KEY_NAMES.map((n,i)=>h('option',{value:i+' '+mo},n+' '+mo)))));
        sel.value=T.manual.key.tonic+' '+T.manual.key.mode;
        sel.addEventListener('change',()=>{ const [t,mo]=sel.value.split(' '); inst.setTempoKey({key:{tonic:+t,mode:mo}}); });
        box.append(sel); }
      box.append(h('p',{class:'note'},'Detected: '+(wait?waitTxt:D.key?midiKeyLabel(D.key):'no clear key')+(kMan?'. The chords are read in yours.':'')));
    };
    inst.watchTK=()=>{ if(box.isConnected) render(); }; render();
    body.append(Section('Tempo & key',{onReset:()=>{ inst.setTempoKey({bpm:0,key:null}); render(); }},box));
  },
  create(){
    const {Core,Music,Renderer}=MIDI_SCORE;
    const c=document.createElement('canvas'); c.width=Renderer.W; c.height=Renderer.H;
    const R=Renderer.create(c);
    // the engine's own settings object; VYRAL writes into it through set / setMode / setLook
    const S={ mode:'map', window:4.5, detail:0.47, response:0.5, motion:'scroll', future:'ghost', pitchRange:'fit', layout:'adaptive',
              theme:'dark', grid:'on', recLen:'full', message:'', analysis:'auto', ink:'graphite', listen:'mix' };
    let pcm=null, sr=44100, preview=true, state=null, res=null, name='', dur=1, token=0, cur=null, reT=0, stemBufs={}, held=false;
    const inst={ canvas:c };
    /* what the user adds to the analysis, for this track:
       ovr  their own tempo / key (0 / null = Auto, the detected value). Kept while the track stays loaded, so a new
            analysis (another Analysis mode) never overwrites them; a new track starts from Auto again.
       mf   a MIDI file of their own, in use: {name, data (Music.readMidi), id, info}. Its parts replace the ones heard
            in the audio (the audio still gives drums, energy and the rest). With no track yet, it is the score on its own.
       mfTry  a file being read, or one that couldn't be used: {name, status:'reading'|'error', msg}. Read off the page;
            a newer file makes an older read irrelevant (mfTok). Until a new file is ready, the one in use stays.
       Neither touches the cached analysis: Music.retune reads it again (the cheap context step only).            */
    let ovr={bpm:0,key:null}, mf=null, mfTry=null, mfTok=0, mfJob=null, tkT=0, derived=null, autoD=null, fileBase=null, lastRead=null;
    // analyses still running in a worker; one for audio that is no longer loaded can never be shown, so it is stopped
    // (and forgotten, so nothing waits on it) when another track arrives
    const jobs=new Set();
    const dropJobs=keep=>{ for(const e of [...jobs]) if(e.key!==keep){ jobs.delete(e); if(e.per&&e.per[e.mode]===e) delete e.per[e.mode]; e.p.cancel&&e.p.cancel(); } };
    const notify=()=>{ inst.watch&&inst.watch(); inst.watchAdv&&inst.watchAdv(); inst.watchTK&&inst.watchTK(); };
    function source(){   // what to analyse: the user's track (stereo if it has two channels), or the demo tune for previews
      if(preview){ if(!midiDemo){ const d=Core.synthDemo(44100); midiDemo={key:d,ch:[d.mono],sr:d.sr,name:d.name}; } return midiDemo; }
      const A=AudioEngine, ch=[];
      if(A.pcm===pcm&&A.buf) for(let i=0;i<Math.min(2,A.buf.numberOfChannels);i++) ch.push(A.buf.getChannelData(i));
      return {key:pcm,ch:ch.length?ch:[pcm],sr,name:(A.name||'').replace(/\.[^.]+$/,'').toLowerCase()};
    }
    function analyse(){
      const src=source(), mode=S.analysis, tok=++token;
      state=null; res=null; stemBufs={}; R.setData(null); syncListen();
      let per=midiCache.get(src.key); if(!per){ per={}; midiCache.set(src.key,per); }
      const ent=per[mode]||(per[mode]={prog:{label:'reading the audio',p:0},done:false,failed:false,p:null});
      if(!ent.p){
        ent.p=MidiOffThread.analyse(src.ch,src.sr,{mode,onProgress:(label,p)=>{ ent.prog={label,p}; }});
        ent.key=src.key; ent.per=per; ent.mode=mode; jobs.add(ent);
        ent.p.then(()=>{ ent.done=true; jobs.delete(ent); },e=>{ ent.failed=true; ent.err=e; jobs.delete(ent); });
      }
      cur=ent; S.message='analysing '+(src.name||'the music'); notify();
      ent.p.then(st=>{ if(tok!==token) return; cur=null; state=st; name=src.name; S.message=''; refine(); syncListen(); notify(); },
        e=>{ if(tok!==token) return; cur=null; console.error('[MIDI / Score] analysis failed',e); S.message='this track couldn’t be read as music'; notify(); });
    }
    // A track's analysis is the expensive part, so it waits ("held") until MIDI / Score is open in the workspace;
    // if this track already has one for this mode in the cache (done or still running), that one is used right away.
    const opened=()=>App.view==='ws'&&App.vid==='midi';
    function analyseWhenOpen(){
      const src=source(), per=midiCache.get(src.key);
      if(opened()||(per&&per[S.analysis]&&per[S.analysis].p)){ held=false; analyse(); return; }
      held=true; token++; cur=null; state=null; res=null; stemBufs={}; S.message=src.name||' '; R.setData(null); syncListen(); notify();
    }
    function wake(){ if(held&&opened()){ held=false; analyse(); } }
    // the score's own words at its head: its name (the track's name) and a line with tempo · key · length. The user can
    // write either line themselves (hdr: null = automatic, '' = not shown), kept for this track like their tempo and key.
    // (A single space hides the name: the renderer writes 'untitled' for an empty one.)
    let hdr={title:null,info:null};
    const headMeta=()=>({name:hdr.title==null?name:(hdr.title.trim()?hdr.title:' '),info:hdr.info==null?undefined:hdr.info});
    // the music as the score reads it: the analysis (or, with no track, a MIDI file alone), with the user's tempo, key
    // and MIDI notes applied. Nothing is re-analysed: the analysed state is read again (cached per combination).
    const fileData=()=>mf?mf.data:null;
    function baseState(){ const F=fileData();
      if(!preview||(MIDI_DEV_DEMO&&!F)) return state;
      if(!F) return null;
      if(!fileBase||fileBase.id!==mf.id) fileBase={id:mf.id,st:Music.fromNotes(F)};
      return fileBase.st; }
    function readWith(base,bpm,key){ const F=fileData();
      const o={bpm,key,given:F?F.parts:null,tempo:F&&F.tempo&&(preview||F.tempo.explicit)?F.tempo:null};   // a file's tempo counts with audio only when the file states one
      if(!o.bpm&&!o.key&&!o.given&&!o.tempo) return base;
      return Music.retune(base,o); }
    function reading(){ const base=baseState(); if(!base) return null;
      const sig=[ovr.bpm,ovr.key?ovr.key.tonic+ovr.key.mode:'',mf?mf.id:0].join('|');
      if(!derived||derived.base!==base||derived.sig!==sig) derived={base,sig,st:readWith(base,ovr.bpm,ovr.key)};
      return derived.st; }
    function autoReading(){ const base=baseState(); if(!base) return null;   // the same, without the user's tempo and key: the detected values
      const sig=mf?mf.id:0;
      if(!autoD||autoD.base!==base||autoD.sig!==sig) autoD={base,sig,st:readWith(base,0,null)};
      return autoD.st; }
    function refine(){ const st=reading(); if(!st) return; lastRead=st; res=Music.refine(st,S.detail).res; dur=res.duration||dur;
      if(preview) name=(mf&&mf.name||'').replace(/\.[^.]+$/,'').toLowerCase();
      R.setData(res,headMeta()); }
    // no track yet: the user's MIDI file on its own if there is one, otherwise the built-in demo score (nothing analysed)
    function showPreview(){ token++; cur=null; state=null; stemBufs={}; S.message='';
      if(fileData()) refine();
      else { lastRead=null; res=midiDemoScore(); dur=res.duration; name=MIDI_DEMO.name; R.setData(res,headMeta()); }
      syncListen(); notify(); }
    async function useMidiFile(f){
      const id=++mfTok; if(mfJob){ mfJob.cancel&&mfJob.cancel(); mfJob=null; }
      mfTry={name:f.name,status:'reading'}; notify();
      const failed=msg=>{ if(id!==mfTok) return; mfJob=null; mfTry={name:f.name,status:'error',msg}; notify(); };
      if(f.size>16e6) return failed('the file is too large for a MIDI file');
      let bytes; try{ bytes=new Uint8Array(await f.arrayBuffer()); }catch(e){ return failed('the file couldn’t be opened'); }
      if(id!==mfTok) return;
      const job=mfJob=MidiOffThread.readMidi(bytes);
      let data; try{ data=await job; }catch(e){ if(e&&e.cancelled) return; if(!(e&&e.midi)) console.error('[MIDI / Score] MIDI file',e); return failed(e&&e.midi?e.message:'it couldn’t be read'); }
      if(id!==mfTok) return;   // replaced while it was being read
      mfJob=null;
      const P=data.parts, has=[P.high.length?'melody':null,P.chords.length?'chords':null,P.bass.length?'bass':null].filter(Boolean);
      mf={name:f.name,data,id,info:`${data.notes} notes · ${has.join(', ')}`+(data.cut?` · first ${fmtT(data.cut)}`:'')}; mfTry=null;
      if(preview) showPreview(); else refine();
      inst._dirty=true; notify();
    }
    function clearMidi(quiet){
      mfTok++; if(mfJob){ mfJob.cancel&&mfJob.cancel(); mfJob=null; }
      const had=!!mf; mf=null; mfTry=null; fileBase=null;
      if(had){ if(preview) showPreview(); else refine(); inst._dirty=true; }
      if(!quiet) notify();
    }
    // Listen: a stem plays instead of the mix, only while this visualizer is open in the workspace
    function syncListen(){
      const st=state&&state.stems, on=!preview&&App.view==='ws'&&App.vid==='midi'&&S.listen!=='mix'&&st&&st[S.listen];
      let b=null;
      if(on){ b=stemBufs[S.listen]; if(!b){ const x=st[S.listen]; b=AudioEngine.ensure().createBuffer(1,x.length,state.srW); b.getChannelData(0).set(x); stemBufs[S.listen]=b; } }
      AudioEngine.setAlt(b);
    }
    return Object.assign(inst,{
      setAudio(p,r){
        // another track replacing one (not the first track after the preview): it starts from Auto, and a MIDI file
        // made for the last one doesn't carry over to it
        if(p!==pcm&&!preview&&pcm){ ovr={bpm:0,key:null}; hdr={title:null,info:null}; if(mf||mfTry){ const was=!!mf; clearMidi(true); if(was) toast('The MIDI file was for the previous track, so it has been removed.'); } }
        if(p!==pcm) dropJobs(p); pcm=p; sr=r; preview=!(AudioEngine.has&&p===AudioEngine.pcm); held=false;
        // no track yet: the built-in demo score (or the user's MIDI file), ready at once (nothing is analysed in the browser)
        if(preview&&!MIDI_DEV_DEMO){ showPreview(); return; }
        if(preview) analyse(); else analyseWhenOpen(); },
      frame(t,dt,playing){
        wake();
        if(cur&&!cur.done&&!cur.failed) S.message='analysing '+Math.round(Math.min(1,cur.prog.p)*100)+'%';
        // the library card plays the demo's four-bar loop on its own clock (seamless, never cut mid-phrase); a still keeps its time
        if(preview&&res) t=res.loop&&playing?res.loop[0]+(performance.now()/1000)%(res.loop[1]-res.loop[0]):t%Math.max(1,dur);
        R.draw(Math.max(0,Math.min(dur,t+(playing?MIDI_LEAD:0))),S);
      },
      set(k,v){
        if(k==='detail'){ S.detail=v; clearTimeout(reT); reT=setTimeout(()=>{ refine(); inst._dirty=true; notify(); },120); }
        else if(k==='analysis'){ if(S.analysis!==v){ S.analysis=v; if(pcm&&(!preview||MIDI_DEV_DEMO)){ if(preview) analyse(); else analyseWhenOpen(); } } }
        else if(k==='listen'){ S.listen=v; syncListen(); }
        else S[k]=v;   // window · response · motion · future · grid · layout · pitchRange
      },
      setMode(v){ S.mode=v; },
      setLook(k){ const L=MidiAdapter.looks.find(x=>x.k===k)||MidiAdapter.looks[0]; S.theme=L.theme; S.ink=L.ink; },
      setAspect(a){ const land=a==='16:9'; R.setSize(land?1920:1080,land?1080:1920); },
      // for the VYRAL shell
      wake,   // MIDI / Score has been opened: start a waiting track's analysis
      progress(){ return !preview&&cur&&!cur.done&&!cur.failed?'Analysing the music · '+Math.round(Math.min(1,cur.prog.p)*100)+'%':null; },
      ready(){ return cur&&cur.p?cur.p.then(()=>{},()=>{}):Promise.resolve(); },
      stems(){ return (state&&state.stems)||{}; },
      // tempo and key as the score uses them, marked when they are the user's own (or the MIDI file's tempo)
      summary(){
        if(!res||!lastRead||(preview&&!fileData())) return null;
        const t=res.tempo, m=res.music, parts=[], rt=lastRead.retuned||{};
        if(t&&t.bpm>0&&t.confidence>=0.25) parts.push(Math.round(t.bpm)+' BPM'+(rt.tempo==='user'?' (manual)':rt.tempo==='file'?' (MIDI)':''));
        if(m&&m.key) parts.push(m.key.name.charAt(0).toUpperCase()+m.key.name.slice(1)+(rt.key==='user'?' (manual)':''));
        return {text:parts.join(' · '),export:!preview};
      },
      // Tempo & key: what was detected (the analysis, with a MIDI file's notes and tempo) and what the user set
      tempoKey(){ const A=autoReading(), t=A&&A.tempo, k=A&&A.key, F=fileData();
        return { ready:!!A, detected:{ bpm:t&&t.bpm>0&&t.confidence>=0.25?t.bpm:0, bpmFrom:F&&F.tempo&&(preview||F.tempo.explicit)?'file':'audio', key:k?{tonic:k.tonic,mode:k.mode}:null },
          manual:{ bpm:ovr.bpm, key:ovr.key } }; },
      setTempoKey(o,soon){
        if('bpm' in o) ovr.bpm=o.bpm>0?clamp(Math.round(o.bpm),40,240):0;
        if('key' in o) ovr.key=o.key?{tonic:((o.key.tonic|0)%12+12)%12,mode:o.key.mode==='minor'?'minor':'major'}:null;
        clearTimeout(tkT);
        // the score is read again (no new analysis); dragging the tempo only does it once the hand rests (120 ms)
        const go=()=>{ refine(); inst._dirty=true; inst.watch&&inst.watch(); };
        if(soon) tkT=setTimeout(go,120); else go(); },
      // for the panel: a file being read or refused comes first; the one in use (if any) is named with it
      // the header's two lines: what the score writes on its own (auto) and what the user wrote (text; null = automatic)
      header(){ return {title:{auto:name||'',text:hdr.title},info:{auto:R.autoInfo(),text:hdr.info}}; },
      setHeader(part,v){ hdr[part==='title'?'title':'info']=v==null?null:String(v).slice(0,120); if(res) R.setData(res,headMeta()); inst._dirty=true; },
      // which header line is at this point of the composition (for editing it from the preview)
      headerAt(x,y){ const B=R.headerBox(); for(const k of ['name','info']){ const b=B[k]; if(b&&x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1) return k==='name'?'title':'info'; } return null; },
      midiFile(){ if(mfTry) return {name:mfTry.name,status:mfTry.status,msg:mfTry.msg,using:mf&&mf.name};
        return mf&&{name:mf.name,status:'ready',info:mf.info}; },
      useMidiFile, clearMidi:()=>clearMidi(), dismissMidi(){ if(mfTry&&mfTry.status==='error'){ mfTry=null; notify(); } },
      exportMidi(){
        if(!canUse('midi.export')) return LicenseUI.explain();
        if(preview||!res) return;
        const bytes=Core.encodeMidi(res,{minConfidence:0.3});
        const url=URL.createObjectURL(new Blob([bytes],{type:'audio/midi'})), a=h('a',{href:url,download:(name||'score').replace(/\s+/g,'_')+'.mid'});
        document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
      },
    });
  }
};

/* ---- 08 DANCER: a low-poly, PS2-era character that dances to the track (WebGL2) ----
   The engine (window.DancerEngine: engines_dancer.js, the approved dancer_test_8 engine, unchanged) draws the dancer;
   this adapter gives it VYRAL's audio and clock. The beat (tempo, downbeat, loudness) is read once per track from the
   audio the shell already decoded, and kept (dancerCache), so the library card and the workspace share it.
   What the user makes of the character (a photo it is styled from, clothes, colours, a backdrop) and of the track's
   tempo (typed or tapped, ½× / 2×, Sync) lives on the instance, like MIDI / Score's tempo and key: the library card
   shows it too, undo leaves it alone, and another track starts again from the tempo found in it. The knobs, the dance,
   the camera and the picture settings are ordinary params. A photo is read in the browser: the body model (MediaPipe
   Pose, Apache-2.0) loads from jsDelivr the first time; without it the engine reads the face alone. */
const dancerCache=new WeakMap();   // audio -> its beat: { p:Promise<analysis>, a:analysis|null, prog:0..1, failed }
const dncOpts=s=>s.split(',').map(x=>{ const i=x.indexOf(':'); return {v:x.slice(0,i),label:x.slice(i+1)}; });
const DNC_PARTS=[   // the character, part by part, as the approved test page offers it
  ['hat','Head','none:None,beanie:Beanie,cap:Cap,bucket:Bucket,hood:Hood up'],
  ['hairStyle','Hair','short:Short,fade:Fade,spiky:Spiky,messy:Messy,curtains:Curtains,long:Long,shoulder:Shoulder,buzz:Buzz,bun:Bun,afro:Afro,locs:Locs,none:None'],
  ['beard','Face','none:Clean,stubble:Stubble,beard:Beard'],
  ['top','Top','tank:Tank,fitted:Fitted tee,tee:Oversized tee,layered:Layered,long:Long sleeve,hoodie:Zip hoodie,track:Track,jacket:Open jacket'],
  ['bottom','Bottom','baggy:Baggy,straight:Straight,skinny:Skinny,cargo:Cargo,track:Track,flare:Flares,shorts:Shorts'],
  ['shoes','Shoes','chunky:Chunky,skate:Skate,boots:Boots'],
  ['build','Build','slim:Slim,avg:Average,broad:Broad'],
  ['frame','Frame','straight:Straight,curvy:Curvy']].map(([k,label,o])=>({k,label,opts:dncOpts(o)}));
const DNC_WEAR=dncOpts('denim:Denim,print:Tee print,chain:Chain,pendant:Pendant,glasses:Glasses,shades:Shades,phones:Headphones,bag:Bag,belt:Belt,wings:Wings');
const DNC_COLORS=dncOpts('skin:Skin,hairC:Hair,eyeC:Eyes,hatC:Hat,topC:Top,top2C:Top detail,bottomC:Bottom,shoesC:Shoes,soleC:Sole,lensC:Lenses,bagC:Bag');
const DNC_PRESETS=[   // the test page's two starting points; Rooftop sits down (the Chair dance)
  {k:'y2k',label:'Y2K',look:{hairStyle:'spiky',hairC:[112,76,52],hat:'none',beard:'none',skin:[228,186,158],top:'tank',topC:[236,234,228],print:true,bottom:'baggy',denim:true,bottomC:[92,102,118],shoes:'chunky',shoesC:[54,56,62],soleC:[228,226,218],phones:true,chain:false,pendant:false,glasses:false,shades:false,bag:false,build:'avg'}},
  {k:'rooftop',label:'Rooftop',dance:'chair',look:{hairStyle:'shoulder',hairC:[92,60,38],hat:'none',beard:'none',skin:[222,178,150],top:'tank',topC:[24,24,26],print:false,bottom:'baggy',denim:true,bottomC:[128,132,138],shoes:'chunky',shoesC:[22,22,24],soleC:[34,34,36],phones:false,chain:false,pendant:false,glasses:false,shades:false,bag:false,build:'avg'}}];
const DNC_VIEWS=[{v:'34',label:'¾',hint:'Three-quarter view'},{v:'front',label:'Front'},{v:'34r',label:'¾ R',hint:'Three-quarter view from the other side'},
  {v:'close',label:'Close',hint:'Head and shoulders'},{v:'face',label:'Face',hint:'Close on the face'},{v:'low',label:'Low',hint:'From down near the floor'},{v:'orbit',label:'Orbit',hint:'Swings slowly around the dancer'}];
/* a picture the user chose (their photo, a backdrop), decoded */
function dncImage(f){ return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=()=>{ URL.revokeObjectURL(img.src); rej(new Error('decode')); }; img.src=URL.createObjectURL(f); }); }
/* Photo and Backdrop: one hidden file input, created the first time it is used */
let dncPickCb=null;
function dncPick(cb){
  if(Recorder.busy()) return toast('Stop the recording first.');
  let i=document.getElementById('dncIn');
  if(!i){ i=h('input',{type:'file',id:'dncIn',accept:'image/*',hidden:true}); document.body.append(i);
    i.addEventListener('change',()=>{ const f=i.files[0]; i.value=''; if(f&&dncPickCb) dncPickCb(f); }); }
  dncPickCb=cb; i.click();
}
const DancerAdapter={
  id:'dancer', num:'08', name:'Dancer', tag:'Character',
  looks:[   // the engine's scenes
    {k:'grid',label:'Grid',bg:'#3d3d40',fg:'#ececea',g:'#8b8b90'},
    {k:'void',label:'Spotlight',bg:'#050506',fg:'#f3efe6',g:'#6c7386'},
    {k:'haze',label:'Haze',bg:'#c9d0cf',fg:'#1b2020',g:'#6b726c'},
    {k:'studio',label:'Studio',bg:'#dcdad5',fg:'#161616',g:'#8c8a85'},
    {k:'night',label:'Night',bg:'#0c0a1b',fg:'#f3d6ee',g:'#5bbfef'}],
  defaultLook:'void',   // Spotlight
  modes:{label:'Dance',def:'auto',wrap:true,options:[
    {v:'auto',label:'Auto',hint:'A new move every 32 beats'},{v:'vibe',label:'Vibe'},{v:'step',label:'Step'},{v:'free',label:'Freestyle'},
    {v:'groove',label:'Groove'},{v:'floss',label:'Floss'},{v:'shuffle',label:'Shuffle'},{v:'chair',label:'Chair',hint:'Seated on a folding chair, nodding to the beat'}]},
  params:[
    {k:'intensity',label:'Energy',min:0.3,max:1.5,def:1,tier:1,fmt:v=>Math.round(v*100)+'%',hint:'How big the moves are. The loudness of the track still drives them'},
    {k:'camAz',label:'Rotate',min:-180,max:180,def:0,tier:1,int:true,fmt:v=>Math.round(v)+'°',hint:'Turn the camera around the dancer'},
    {k:'camZoom',label:'Zoom',min:0.6,max:2.6,def:1,tier:1,fmt:v=>v.toFixed(2)+'×',hint:'Move the camera in or out'},
    // tier 2: the Camera block in the side panel (not knobs, not in Advanced)
    {k:'camera',label:'View',tier:2,def:'34',choices:DNC_VIEWS},
    {k:'camEl',label:'Tilt',tier:2,min:-15,max:55,def:0,int:true,fmt:v=>Math.round(v)+'°',hint:'Look up at the dancer, or down from above'},
    {k:'camSpin',label:'Spin',tier:2,min:-40,max:40,def:0,int:true,fmt:v=>Math.round(v)?Math.round(v)+'° / s':'Off',hint:'The camera circles the dancer on its own'},
    {k:'res',label:'Pixels',group:'Picture',def:'960',hint:'How many pixels the picture is drawn with along its long side, before it is scaled up: fewer is chunkier',
     choices:[{v:'448',label:'448'},{v:'640',label:'640'},{v:'960',label:'960'},{v:'0',label:'Full'}]},
    {k:'facet',label:'Edges',group:'Picture',min:0,max:1,def:1,hint:'Flat-shaded facets; lower is smoother'},
    {k:'dither',label:'Dither',group:'Picture',min:0,max:1,def:0.55,fmt:v=>v>0.004?f2(v):'Off',hint:'Ordered dither over a reduced palette'},
    {k:'glow',label:'Glow',group:'Picture',min:0,max:2,def:1,fmt:v=>v>0.004?f2(v):'Off',hint:'Light bleeding off the bright parts'},
    {k:'scan',label:'Lines',group:'Picture',min:0,max:0.4,def:0,fmt:v=>v>0.004?f2(v):'Off',hint:'Dark scanlines, like an old TV'},
  ],
  panel(inst){ return dncPanel(inst); },
  create(){
    const D=DancerEngine.create(), c=D.canvas, DEF=D.getLook();
    let land=false, hq=false, W=720, H=1280, pcm=null, preview=true, beat=null, photo=null, photoJob=0, readLook=null, bg=null;
    // the frame the engine draws into: 720 x 1280 on screen, 1080 x 1920 for recording (HQ); turned on its side in 16:9.
    // The pixel look doesn't change with it: the engine draws at Pixels (960 on the long side) and scales up.
    const size=()=>{ const sh=hq?1080:720, lg=hq?1920:1280; W=land?lg:sh; H=land?sh:lg; if(c.width!==W||c.height!==H){ c.width=W; c.height=H; } };
    size();
    const inst={ canvas:c, D, _warm:36 };   // nothing builds up over time here: no silent warm-up frames when it opens
    const notify=()=>{ inst._dirty=true; inst.watch&&inst.watch(); };
    return Object.assign(inst,{
      setAudio(p,r){
        if(p!==pcm&&!preview&&pcm) D.resetTempo();   // another track replacing one: its own tempo again, as found in it
        pcm=p; preview=!(AudioEngine.has&&p===AudioEngine.pcm);
        let e=dancerCache.get(p);
        if(!e){ e={a:null,prog:0,failed:false}; dancerCache.set(p,e);
          e.p=DancerEngine._internals.analyzeAudio({sampleRate:r,length:p.length,numberOfChannels:1,getChannelData:()=>p},v=>{ e.prog=v; })
            .then(a=>{ e.a=a; return a; },err=>{ e.failed=true; console.error('[Dancer] beat analysis failed',err); return null; }); }
        beat=e; D.audio=e.a;
        if(!e.a&&!e.failed) e.p.then(a=>{ if(beat===e&&a){ D.audio=a; notify(); } });
        notify();
      },
      // with no track of yours (the library card, the waiting still) the dancer always dances, settled at once; with yours,
      // it rests while paused and eases between rest and dance in real time
      frame(t,dt,playing){ D.render(Math.max(0,t||0),{width:W,height:H,playing:preview||!!playing,live:!preview}); if(inst.onBeat) inst.onBeat(t); },
      set(k,v){ D.set({[k]:k==='res'?+v:v}); },
      setLook(k){ D.set({scene:k}); },
      setMode(v){ D.set({dance:v}); },
      setHQ(on){ hq=!!on; size(); },
      setAspect(a){ land=a==='16:9'; size(); },
      // for the VYRAL shell: the beat of your track is found before it plays or records (a moment, off the clock)
      progress(){ return !preview&&beat&&!beat.a&&!beat.failed?'Finding the beat · '+Math.round(Math.min(1,beat.prog)*100)+'%':null; },
      ready(){ return beat&&beat.p?beat.p.then(()=>{}):Promise.resolve(); },
      // the character: the engine's look (hair, clothes, colours ...)
      char(){ return D.getLook(); },
      setChar(o,quiet){ D.setLook(o); inst._dirty=true; if(!quiet) notify(); },
      preset(k){ const P=DNC_PRESETS.find(x=>x.k===k); if(P){ D.setLook(structuredClone(P.look)); notify(); } return P; },
      resetChar(){ D.setLook(structuredClone(readLook||DEF)); notify(); },   // back to what the photo gave, or to the default dancer
      // a photo of the user: the character is styled from it (the photo itself never appears in the picture)
      photo(){ return photo&&{...photo}; },
      photoBusy(){ return !!photo&&photo.status==='reading'; },
      async usePhoto(f){
        if(!/^image\//.test(f.type||'')&&!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) return toast(`${f.name} isn’t a picture. Try a JPG or PNG.`);
        const job=++photoJob; let img;
        try{ img=await dncImage(f); }catch(e){ if(job===photoJob) toast(`Couldn’t open ${f.name}.`); return; }
        if(job!==photoJob){ URL.revokeObjectURL(img.src); return; }
        const before=D.getLook(), run=D.setPhoto(img);   // in place at once (shown dimmed while it is read)
        URL.revokeObjectURL(img.src);
        photo={name:f.name,status:'reading',rev:(photo?photo.rev:0)+1}; notify();
        let a=null; try{ a=await run; }catch(e){ console.error('[Dancer] photo',e); }
        if(job!==photoJob) return;   // replaced or removed while it was read
        if(!a){ D.clearPhoto(); D.setLook(before); photo=null; notify(); return toast(`Couldn’t read ${f.name}.`); }
        photo={name:f.name,status:'ready',rev:photo.rev+1}; readLook=D.getLook(); notify();
      },
      clearPhoto(){ photoJob++; D.clearPhoto(); photo=null; readLook=null; notify(); },
      // a joint (or, read from the face alone, the eyes) put right by hand: the photo is read again from there
      fixJoint(i,p){ if(D.setLandmarks({[i]:p})){ readLook=D.getLook(); photo.rev++; } notify(); },
      fixEyes(e){ if(D.setEyes(e)){ readLook=D.getLook(); photo.rev++; } notify(); },
      // a backdrop: a picture of the user's own behind the dancer, in place of the look's set
      backdrop(){ return bg; },
      async useBackdrop(f){ let img; try{ img=await dncImage(f); }catch(e){ return toast(`Couldn’t open ${f.name}.`); }
        const k=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight)), b=document.createElement('canvas');   // at most 2048 px: plenty for a 1920 frame
        b.width=Math.max(1,Math.round(img.naturalWidth*k)); b.height=Math.max(1,Math.round(img.naturalHeight*k)); b.getContext('2d').drawImage(img,0,0,b.width,b.height);
        URL.revokeObjectURL(img.src); D.set({background:b}); bg={name:f.name}; notify(); },
      clearBackdrop(){ D.set({background:null}); bg=null; notify(); },
      // the tempo: found in the track, typed or tapped (the track's tempo), the moves at ½ / 1 / 2 times it, and Sync
      tempo(){ const a=D.audio, o=D.opt, tp=D.tempo();
        return { ready:!!a, failed:!!(beat&&beat.failed), found:a?a.bpmRaw:0, bpm:o.bpm>0?o.bpm:0, tapped:o.bpm>0&&o.phase!=null,
          track:o.bpm>0?o.bpm:a?a.bpmRaw:0, dance:tp.bpm, mul:o.bpmMul||1, offset:o.offset||0 }; },
      setBpm(v){ D.set({bpm:v>=40&&v<=240?Math.round(v*10)/10:0,phase:null}); inst._dirty=true; },
      tap(t){ const r=D.tap(t); inst._dirty=true; return r; },
      autoBpm(){ D.set({bpm:0,phase:null}); inst._dirty=true; },
      setMul(v){ D.set({bpmMul:v}); inst._dirty=true; },
      setOffset(ms){ D.set({offset:ms}); inst._dirty=true; },
      resetTempo(){ D.resetTempo(); inst._dirty=true; },
      beatAt(t){ return D.beatAt(t); },
    });
  }
};
/* the photo as it was read: the person framed, the parts read from it outlined in their colours, and the joints the
   body model found. Drag a joint (read from the face alone: an eye) onto the right spot and the photo is read again. */
function dncPhotoView(inst){
  const D=inst.D, cv=h('canvas',{width:520,height:520,'aria-label':'Your photo, as it was read'}), g=cv.getContext('2d');
  const SKEL=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32],[27,29],[28,30],[29,31],[30,32]];
  const JOINTS=[2,5,11,12,13,14,15,16,23,24,25,26,27,28,31,32];
  const SHOW={head:'hat',top:'top',neck:'neck',kneeL:'bottom',kneeR:'bottom',shoeL:'shoes',shoeR:'shoes',face:'skin'};
  const css=c=>'rgb('+c.map(Math.round).join(',')+')';
  let V=null, drag=null;
  const crop=()=>{   // frame the person, not the whole picture
    const img=D.photo.img, W=img.width, H=img.height, lm=D.getLandmarks(); let x0=0, y0=0, x1=W, y1=H;
    if(lm){ x0=W; y0=H; x1=0; y1=0;
      for(const p of lm){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); }
      const ed=Math.hypot(lm[2][0]-lm[5][0],lm[2][1]-lm[5][1])||10, hh=y1-y0;
      y0-=Math.max(ed*3,hh*0.08); y1+=hh*0.06; const cx=(x0+x1)/2, hw=Math.max((x1-x0)/2+ed*2,(y1-y0)*0.36);
      x0=Math.max(0,cx-hw); x1=Math.min(W,cx+hw); y0=Math.max(0,y0); y1=Math.min(H,y1); }
    return {x0,y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)}; };
  function draw(hl){
    V=null; if(!D.photo) return;
    const img=D.photo.img, c=crop(), w=cv.width, ht=Math.round(clamp(c.h*w/c.w,w*0.75,w*1.45));
    if(cv.height!==ht) cv.height=ht;
    const s=Math.min(w/c.w,ht/c.h), ox=(w-c.w*s)/2, oy=(ht-c.h*s)/2, X=x=>ox+(x-c.x0)*s, Y=y=>oy+(y-c.y0)*s; V={c,s,ox,oy};
    g.fillStyle='#000'; g.fillRect(0,0,w,ht); g.drawImage(img,c.x0,c.y0,c.w,c.h,ox,oy,c.w*s,c.h*s);
    g.fillStyle='rgba(0,0,0,.3)'; g.fillRect(0,0,w,ht);
    if(inst.photoBusy()) return;
    const a=D.analysis, L=D.getLook(), col={hat:L.hat!=='none'?L.hatC:L.hairC,top:L.topC,neck:[200,204,212],bottom:L.bottomC,shoes:L.shoesC,skin:L.skin};
    if(a&&a.regions) for(const [k,r] of Object.entries(a.regions)){ const key=SHOW[k]; if(!key||(key==='neck'&&!a.chain)) continue;
      g.beginPath();
      if(typeof r[0]==='number') g.rect(X(r[0]),Y(r[1]),(r[2]-r[0])*s,(r[3]-r[1])*s); else { r.forEach((p,i)=>i?g.lineTo(X(p[0]),Y(p[1])):g.moveTo(X(p[0]),Y(p[1]))); g.closePath(); }
      g.lineWidth=3; g.strokeStyle='rgba(0,0,0,.6)'; g.stroke(); g.lineWidth=1.5; g.strokeStyle=css(col[key]); g.setLineDash([5,3]); g.stroke(); g.setLineDash([]); }
    const lm=D.getLandmarks();
    if(lm){ g.lineCap='round';
      for(const [i,j] of SKEL){ g.lineWidth=4; g.strokeStyle='rgba(0,0,0,.55)'; g.beginPath(); g.moveTo(X(lm[i][0]),Y(lm[i][1])); g.lineTo(X(lm[j][0]),Y(lm[j][1])); g.stroke(); g.lineWidth=2; g.strokeStyle='rgba(255,255,255,.75)'; g.stroke(); }
      for(const i of JOINTS){ const x=X(lm[i][0]), y=Y(lm[i][1]), sm=i===2||i===5;
        g.fillStyle='#000'; g.beginPath(); g.arc(x,y,sm?4.5:6.5,0,7); g.fill(); g.fillStyle=drag&&drag.i===i?'#ffd60a':'#fff'; g.beginPath(); g.arc(x,y,sm?3:4.5,0,7); g.fill(); }
    } else { const e=D.getEyes();
      if(e) for(const k of ['l','r']){ const x=X(e[k][0]), y=Y(e[k][1]); g.lineWidth=3; g.strokeStyle='#000'; g.beginPath(); g.arc(x,y,8,0,7); g.stroke(); g.lineWidth=2; g.strokeStyle='#fff'; g.beginPath(); g.arc(x,y,8,0,7); g.stroke(); } }
    if(hl){ g.fillStyle=hl.c; g.beginPath(); g.arc(hl.p[0],hl.p[1],hl.r,0,7); g.fill(); }
  }
  const pos=e=>{ const r=cv.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*cv.width,(e.clientY-r.top)/r.height*cv.height]; };
  const toImg=p=>[(p[0]-V.ox)/V.s+V.c.x0,(p[1]-V.oy)/V.s+V.c.y0], toCv=q=>[V.ox+(q[0]-V.c.x0)*V.s,V.oy+(q[1]-V.c.y0)*V.s];
  cv.addEventListener('pointerdown',e=>{ if(!V||inst.photoBusy()) return; const p=pos(e), lm=D.getLandmarks();
    if(lm){ let best=-1, bd=1e9; for(const i of JOINTS){ const q=toCv(lm[i]), d=Math.hypot(q[0]-p[0],q[1]-p[1]); if(d<bd){ bd=d; best=i; } }
      if(bd<22){ drag={i:best,p:toImg(p)}; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); e.preventDefault(); } }
    else { const ey=D.getEyes(); if(!ey) return; let best=null, bd=1e9;
      for(const k of ['l','r']){ const q=toCv(ey[k]), d=Math.hypot(q[0]-p[0],q[1]-p[1]); if(d<bd){ bd=d; best=k; } }
      if(bd<30){ drag={k:best,e:ey}; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); e.preventDefault(); } } });
  cv.addEventListener('pointermove',e=>{ if(!drag||!V) return; const p=pos(e);
    if(drag.i!=null){ drag.p=toImg(p); draw({p,c:'#ffd60a',r:6}); } else { drag.e[drag.k]=toImg(p); draw({p,c:'#fff',r:5}); } });
  const up=()=>{ if(!drag) return; const d=drag; drag=null; cv.classList.remove('drag');
    if(d.i!=null) inst.fixJoint(d.i,d.p); else { const e=d.e; if(e.l[0]>e.r[0]){ const t=e.l; e.l=e.r; e.r=t; } inst.fixEyes(e); } };
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.redraw=()=>draw();
  return cv;
}
/* the Dancer's blocks in the side panel: Photo, Character, Beat, Camera. Each reads the instance (the camera: the
   visualizer's params) whenever it changes, so a panel rebuilt mid-way (a format change, undo, a new track) shows
   where things stand, a photo still being read included. */
function dncPanel(inst){
  const D=inst.D, vs=vsOf('dancer'), P=k=>DancerAdapter.params.find(p=>p.k===k);
  const bind=(k,v)=>{ vs.params[k]=v; inst.set(k,v); };
  const css=c=>'rgb('+c.map(Math.round).join(',')+')';
  const reset=(tip,fn)=>h('button',{class:'ico','data-tip':tip,'aria-label':tip,html:ICON.reset,onclick:fn});
  // Photo
  const pv=dncPhotoView(inst), busyEl=h('div',{class:'dnc-busy'},h('span',{class:'dnc-spin'}),'Reading the photo…');
  const pvBox=h('div',{class:'dnc-photo'},pv,busyEl), readEl=h('div',{class:'dnc-read'}), pNote=h('p',{class:'note'}), pActs=h('div',{class:'dnc-acts'});
  const pickPhoto=()=>dncPick(f=>inst.usePhoto(f));
  const choose=h('div',{class:'dnc-acts'},h('button',{class:'btn',onclick:pickPhoto},'Choose a photo'));
  const intro=h('p',{class:'note'},'A full-body photo, facing the camera. The dancer takes its hair, skin, clothes and shoes from it.');
  let pKey=null;
  const syncPhoto=()=>{ const ph=inst.photo(), key=ph?ph.status+'|'+ph.rev:'';
    if(key===pKey) return; pKey=key;
    choose.hidden=intro.hidden=!!ph; pvBox.hidden=pActs.hidden=pNote.hidden=!ph; readEl.hidden=true; readEl.innerHTML='';
    if(!ph) return;
    const busy=ph.status==='reading'; busyEl.classList.toggle('on',busy); pv.redraw();
    pActs.innerHTML=''; pActs.append(h('span',{class:'mf-name',title:ph.name},ph.name),h('button',{class:'link',onclick:pickPhoto},'Replace'),
      h('button',{class:'link','data-tip':'The dancer goes back to the default character',onclick:()=>inst.clearPhoto()},'Remove'));
    if(busy){ pNote.textContent='The body model loads the first time a photo is read, so this can take a moment.'; return; }
    const a=D.analysis, L=inst.char();
    const sw={Head:[L.hatC],Hair:[L.hairC],Skin:[L.skin],Top:L.top==='jacket'||L.print?[L.topC,L.top2C]:[L.topC],Neck:[L.metal==='gold'?[214,176,92]:[196,200,208]],Bottom:[L.bottomC],Shoes:[L.shoesC,L.soleC]};
    for(const [k,v] of (a&&a.read)||[]) readEl.append(h('div',{class:'dnc-rd'},h('span',{class:'k'},k),h('span',{class:'v'},v),(sw[k]||[]).filter(Boolean).map(c=>h('i',{style:'background:'+css(c)}))));
    readEl.hidden=!readEl.firstChild;
    pNote.textContent=a&&a.method==='pose'?(a.fullBody===false?'Legs or feet are out of frame, so the bottoms and shoes were kept as they were. ':'')+'Drag a joint that’s off and the photo is read again. Everything can be changed below.'
      :'The body model couldn’t be loaded, so only the face was used. Drag the two circles onto the eyes if they’re off.'; };
  const photoBlk=h('div',{class:'blk'},h('span',{class:'lab'},'Photo'),choose,intro,pvBox,readEl,pNote,pActs);
  // Character
  const cells=DNC_PARTS.map(pt=>{ const sel=h('select',{class:'dnc-sel','aria-label':pt.label});
    sel.addEventListener('change',()=>inst.setChar({[pt.k]:sel.value},true));
    const cell=h('label',{class:'dnc-cell'},h('span',{},pt.label),sel);
    cell.upd=L=>{ const v=L[pt.k], opts=pt.opts.some(o=>o.v===v)?pt.opts:[...pt.opts,{v,label:String(v).charAt(0).toUpperCase()+String(v).slice(1)}];   // a read the list doesn't name (jorts) still shows
      if(sel.options.length!==opts.length||opts.some((o,i)=>sel.options[i].value!==o.v)){ sel.innerHTML=''; for(const o of opts) sel.append(h('option',{value:o.v},o.label)); }
      if(document.activeElement!==sel) sel.value=v; };
    return cell; });
  const wear=DNC_WEAR.map(o=>{ const b=h('button',{class:'dnc-chip','aria-pressed':'false',onclick:()=>{ const on=!inst.char()[o.v]; inst.setChar({[o.v]:on},true); b.setAttribute('aria-pressed',on); }},o.label);
    b.upd=L=>b.setAttribute('aria-pressed',!!L[o.v]); return b; });
  const cols=DNC_COLORS.map(o=>{ const inp=h('input',{type:'color',class:'swpick','aria-label':o.label}), sw=h('label',{class:'swc','data-tip':o.label},inp);
    inp.addEventListener('input',()=>{ sw.style.setProperty('--c',inp.value); inst.setChar({[o.v]:hex2rgb(inp.value)},true); });
    sw.upd=L=>{ const c=L[o.v]; if(!c) return; const hx=rgb2hex(c); sw.style.setProperty('--c',hx); if(document.activeElement!==inp) inp.value=hx; };
    return sw; });
  const syncChar=()=>{ const L=inst.char(); for(const x of [...cells,...wear,...cols]) x.upd(L); };
  const presets=h('div',{class:'dnc-acts'},h('span',{class:'note'},'Start from'),DNC_PRESETS.map(p=>h('button',{class:'link',onclick:()=>{
    inst.preset(p.k); if(p.dance&&vs.mode!==p.dance){ setMode(p.dance); if(WS.modeSeg) WS.modeSeg.set(p.dance); } }},p.label)));
  const charBlk=h('div',{class:'blk'},h('div',{class:'lab-row'},h('span',{class:'lab'},'Character'),reset('Back to the photo’s reading, or the default dancer',()=>inst.resetChar())),
    presets,h('div',{class:'dnc-grid'},cells),h('div',{class:'dnc-cell'},h('span',{},'Extras'),h('div',{class:'dnc-chips'},wear)),
    h('div',{class:'dnc-cell'},h('span',{},'Colours'),h('div',{class:'swatches dnc-cols'},cols)));
  // Beat
  const dot=h('i',{class:'dnc-dot'}), bpmT=h('span',{class:'dnc-bpm'}), bpmN=h('span',{class:'note'});
  const bIn=h('input',{class:'bin',type:'number',min:40,max:240,step:'0.1',inputmode:'decimal','aria-label':'The track’s tempo in BPM','data-tip':'Type the track’s tempo'});
  bIn.addEventListener('change',()=>{ inst.setBpm(bIn.value===''?0:+bIn.value); syncBeat(); });
  bIn.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); bIn.blur(); } });
  const tapB=h('button',{class:'btn','data-tip':'Tap along to the beat while the track plays',onclick:()=>{
    if(!AudioEngine.playing) return toast('Play the track, then tap along to the beat.'); inst.tap(AudioEngine.time()); syncBeat(); }},'Tap');
  const autoB=h('button',{class:'link','data-tip':'Back to the tempo found in the track',onclick:()=>{ inst.autoBpm(); syncBeat(); }},'Auto');
  const mul=Seg([{v:'0.5',label:'½×',hint:'Moves at half the tempo'},{v:'1',label:'1×'},{v:'2',label:'2×',hint:'Moves at double the tempo'}],'1',v=>{ inst.setMul(+v); syncBeat(); });
  const sync=Slider({label:'Sync',min:-200,max:200,value:0,def:0,int:true,fmt:v=>(v>0?'+':'')+Math.round(v)+' ms',hint:'Moves earlier or later against the music',onInput:v=>inst.setOffset(v)});
  const beatCtl=h('div',{class:'dnc-ctl'},h('div',{class:'dnc-tempo'},bIn,tapB,autoB),h('div',{class:'choice'},h('span',{class:'lab'},'Moves'),mul),sync);
  const bNote=h('p',{class:'note'});
  const syncBeat=()=>{ const T=inst.tempo(), has=hasTrack();
    bpmT.textContent=has&&T.track?(T.bpm?T.bpm:Math.round(T.track))+' BPM':'–';   // found: whole BPM; yours: as you set it
    const r=T.track?T.dance/T.track:1, fold=Math.abs(r-0.5)<0.02?' · moves at ½':Math.abs(r-2)<0.04?' · moves at 2×':Math.abs(r-0.25)<0.01?' · moves at ¼':Math.abs(r-4)<0.08?' · moves at 4×':'';
    bpmN.textContent=!has?'no track yet':!T.ready?(T.failed?'no steady beat found':'finding the beat…'):(T.bpm?(T.tapped?'tapped':'typed'):'found in the track')+fold;
    if(document.activeElement!==bIn) bIn.value=T.bpm?T.bpm:'';
    bIn.placeholder=T.found?'auto '+Math.round(T.found):'auto'; autoB.hidden=!T.bpm;
    mul.set(String(T.mul)); sync.update(T.offset);
    beatCtl.classList.toggle('off',!has); beatCtl.inert=!has;
    bNote.textContent=has?'The beat and the downbeat are found in the track. Type the BPM or tap along to set it yourself; Sync moves the dance earlier or later.':'Add your track: its beat is found in it, and the dancer moves on it.'; };
  let lastDot='';
  inst.onBeat=t=>{ if(!dot.isConnected){ inst.onBeat=null; return; } const b=inst.beatAt(t), cl=hasTrack()&&b.frac<0.18?(b.inBar===0?'dnc-dot down':'dnc-dot on'):'dnc-dot';
    if(cl!==lastDot){ dot.className=cl; lastDot=cl; } };
  const beatBlk=h('div',{class:'blk'},h('div',{class:'lab-row'},h('span',{class:'lab'},'Beat'),reset('Back to the tempo found in the track',()=>{ inst.resetTempo(); syncBeat(); })),
    h('div',{class:'dnc-beat'},dot,bpmT,bpmN),beatCtl,bNote);
  // Camera (params: undo, Reset everything)
  const view=Seg(P('camera').choices,vs.params.camera,v=>{ bind('camera',v); commit(); }); view.classList.add('wrap');
  const tilt=Slider({...P('camEl'),value:vs.params.camEl,onInput:v=>bind('camEl',v),onCommit:commit});
  const spin=Slider({...P('camSpin'),value:vs.params.camSpin,onInput:v=>bind('camSpin',v),onCommit:commit});
  const bgRow=h('div',{class:'dnc-acts'});
  const pickBg=()=>dncPick(f=>inst.useBackdrop(f));
  const syncBg=()=>{ const b=inst.backdrop(); bgRow.innerHTML='';
    if(!b) bgRow.append(h('button',{class:'link','data-tip':'A picture of your own behind the dancer, in place of the look’s set',onclick:pickBg},'Backdrop image…'));
    else bgRow.append(h('span',{class:'note'},'Backdrop'),h('span',{class:'mf-name',title:b.name},b.name),h('button',{class:'link',onclick:pickBg},'Replace'),h('button',{class:'link',onclick:()=>inst.clearBackdrop()},'Remove')); };
  const camBlk=h('div',{class:'blk'},h('div',{class:'lab-row'},h('span',{class:'lab'},'Camera'),reset('Reset camera',()=>{
      for(const k of ['camera','camEl','camSpin']) bind(k,P(k).def); view.set(vs.params.camera); tilt.update(vs.params.camEl); spin.update(vs.params.camSpin); commit(); })),
    view,tilt,spin,bgRow);
  inst.watch=()=>{ syncPhoto(); syncChar(); syncBeat(); syncBg(); };
  inst.watch();
  const frag=document.createDocumentFragment(); frag.append(photoBlk,charBlk,beatBlk,camBlk);
  return frag;
}

/* ---- 09 GRID · 10 PADS: the beat read like a producer's screen (canvas 2D) ----
   Two concepts of the Readout Lab (readout_lab_test_7; engine in engines_readout.js: window.PULSE), each a visualizer of
   its own: Grid programs the drums into a 16-step grid as the track plays; Pads is an MPC whose sixteen pads light on the
   kick, snare, hats, 808 and notes. Both draw the lab's frame (title and BPM · KEY on top, a readout row, a scrolling panel
   at the bottom) from ONE reading of the track (RD): the analysis runs once per track, and what the user adds to it (a MIDI
   file of the beat, the tempo, beat one, the key, the words at the top) shows in both. Like MIDI / Score, a track's
   analysis waits until Grid or Pads is open in the workspace; until then their library cards play the preview loop.
   The frame writes its own words (noBrand): the Text block edits them. */
const RD={
  cache:new WeakMap(),   // audio -> its reading: { p:Promise, A:analysis|null, prog, failed, loopy, mf, mfTry, mfTok, tempoSet, hdr }
  insts:new Set(),        // the Grid and Pads instances, told when a reading changes
  userPcm:null,
  of(pcm,sr,loopy){
    let e=this.cache.get(pcm);
    if(!e){ e={pcm,loopy:!!loopy,prog:0,failed:false,A:null,mf:null,mfTry:null,mfTok:0,tempoSet:false,hdr:{title:null,artist:null}};
      this.cache.set(pcm,e);
      e.p=PULSE.analyse([pcm],sr,v=>{ e.prog=v; }).then(A=>{ A.loopy=e.loopy; e.A=A; this.tell(e); return A; },
        err=>{ e.failed=true; console.error('[Grid / Pads] the track couldn’t be read',err); this.tell(e); return null; }); }
    return e; },
  tell(e){ for(const I of this.insts) if(I.reading()===e){ I._dirty=true; I.watch&&I.watch(); I.watchTK&&I.watchTK(); } },
};
const RD_LOOKS=[   // the lab's Colour (Black / Paper) and Accent (orange / off)
  {k:'black',label:'Black',paper:false,accent:true,bg:'#000000',fg:'#F1F1EF',g:'#F0641E'},
  {k:'paper',label:'Paper',paper:true,accent:true,bg:'#E9E9E5',fg:'#0B0B0B',g:'#E0531A'},
  {k:'black-mono',label:'Black mono',paper:false,accent:false,bg:'#000000',fg:'#F1F1EF',g:'#8D8D8A'},
  {k:'paper-mono',label:'Paper mono',paper:true,accent:false,bg:'#E9E9E5',fg:'#0B0B0B',g:'#86867F'}];
const rdBpm=v=>String(Math.round(v*10)/10);
function readoutAdapter(o){
  const E={ id:o.id, num:o.num, name:o.name, tag:o.tag,
    noBrand:true,   // the frame writes its own words (Text in its panel); the Branding layouts don't apply to it
    formats:['9:16','16:9','4:5'],   // the lab's frame also composes for a 4:5 post
    looks:RD_LOOKS, defaultLook:'black',
    modes:{label:'Bottom',def:o.bottom,options:[
      {v:'spectro',label:'Spectrum',hint:'A scrolling spectrogram, 35 Hz to 10 kHz'},{v:'wave',label:'Wave',hint:'The waveform scrolling past, with bar numbers'},
      {v:'bars',label:'Bars',hint:'A spectrum analyser'},{v:'off',label:'Off',hint:'Nothing at the bottom: the picture takes the room'}]},
    params:[
      {k:'hold',label:'Hold',min:0.5,max:2,def:1,tier:1,fmt:v=>v.toFixed(2)+'×',hint:'How long a hit stays lit'},
      {k:'span',label:'Window',min:0.5,max:2,def:1,tier:1,fmt:v=>v.toFixed(2)+'×',hint:'How much of the track the panel at the bottom shows'},
    ],
    panel(inst){ return rdPanel(inst); },
    adv(inst,body){ rdAdv(inst,body); },
    create(){
      const c=document.createElement('canvas'); c.width=1080; c.height=1920;
      const g=c.getContext('2d',{alpha:false}), C=PULSE.concepts.find(x=>x.id===o.concept), CON=[C], U=PULSE.U;
      // the lab's frame state: the concept, the bottom panel, colour, accent, and the knobs (no Punch: no zoom on the kick)
      const st={ci:0,bottom:o.bottom,paper:false,accent:true,punch:0,hold:1,span:1,title:'',artist:'',A:null,padY:0};
      let pcm=null, sr=44100, user=false, shown=null;
      const inst={ canvas:c, _warm:36 };   // nothing builds up over time: no warm-up frames when it opens
      const opened=()=>App.view==='ws'&&(App.vid==='grid'||App.vid==='pads');
      const preview=()=>{ const P=PREVIEW(); return RD.of(P.pcm,P.sr,true); };
      // the reading on the picture: the user's track once Grid or Pads has been opened for it (or it was read already),
      // otherwise the preview loop
      const reading=()=>user&&(opened()||RD.cache.has(pcm))?RD.of(pcm,sr,false):preview();
      const words=e=>{   // the words at the top: the user's own, or the track's name (the preview: DEMO)
        const auto=e.loopy?{title:'Demo',artist:''}:parseTrackName(AudioEngine.name||'');
        return {title:{auto:auto.title||'',text:e.hdr.title},artist:{auto:auto.artist||'',text:e.hdr.artist}}; };
      RD.insts.add(inst);
      return Object.assign(inst,{
        setAudio(p,r){
          const mine=AudioEngine.has&&p===AudioEngine.pcm;
          if(mine&&RD.userPcm!==p){ const old=RD.userPcm&&RD.cache.get(RD.userPcm);   // another track: its own reading (said once, for both)
            if(old&&old.mf) toast('The MIDI file was for the previous track, so Grid and Pads read this one from its audio.'); RD.userPcm=p; }
          pcm=p; sr=r; user=mine; inst._dirty=true; },
        frame(t){
          let e=reading();
          if(!e.A&&!e.loopy){ const P=preview(); if(P.A) e=P; }   // the library card keeps the preview loop while the track is read
          if(!e.A){ g.setTransform(1,0,0,1,0,0); g.fillStyle=st.paper?'#E9E9E5':'#000000'; g.fillRect(0,0,c.width,c.height); return; }
          if(shown!==e.A){ shown=e.A; C.cache={}; }
          const W=words(e); st.A=e.A;
          st.padY=opened()?0:Math.round(c.height*0.05);   // on a library card (cover-fit, its top and bottom cropped) the words and the panel sit further in
          st.title=W.title.text==null?W.title.auto:(W.title.text.trim()?W.title.text:' ');   // a cleared title: hidden (the frame writes UNTITLED for none)
          st.artist=W.artist.text==null?W.artist.auto:W.artist.text;
          t=Math.max(0,t||0); if(e.loopy) t=U.mod(t,e.A.dur);
          PULSE.frame.drawFrame(g,st,t,CON);
        },
        set(k,v){ st[k]=v; },   // Hold, Window (no zoom on the kick: the picture holds still)
        setMode(v){ st.bottom=v; },
        setLook(k){ const L=RD_LOOKS.find(x=>x.k===k)||RD_LOOKS[0]; st.paper=L.paper; st.accent=L.accent; },
        setAspect(a){ const f=a==='16:9'?[1920,1080]:a==='4:5'?[1080,1350]:[1080,1920]; c.width=f[0]; c.height=f[1]; },
        // for the VYRAL shell: the track is read before it plays or records
        reading,
        progress(){ if(!user||!opened()) return null; const e=RD.of(pcm,sr,false);
          return !e.A&&!e.failed?'Reading the beat · '+Math.round(Math.min(1,e.prog)*100)+'%':null; },
        ready(){ return user?RD.of(pcm,sr,false).p.then(()=>{}):Promise.resolve(); },
        // the words at the top (null: automatic, '': not shown); kept for this track, in both Grid and Pads
        header(){ return words(reading()); },
        setHeader(part,v){ const e=reading(); e.hdr[part==='artist'?'artist':'title']=v==null?null:String(v).slice(0,40); RD.tell(e); },
        // tempo, beat one and key as found (in the audio, or the MIDI file) and as the user set them
        tempoKey(){ const e=reading(), A=e.A; if(!A||!user) return {ready:false,failed:e.failed};
          return {ready:true,bpm:A.bpm,set:e.tempoSet,key:A.key,keyAuto:A.keyAuto,keySet:A.key!==A.keyAuto,source:A.source||'audio',hasMidi:!!A.midiSet,
            found:A.source==='midi'&&A.midiSet?A.midiSet.bpm:A.bpmAuto}; },
        setBpm(v,beat0){ const e=reading(), A=e.A; if(!A) return; PULSE.setTempo(A,clamp(v,40,250),beat0); e.tempoSet=true; RD.tell(e); },
        autoTempo(){ const e=reading(), A=e.A; if(!A) return; PULSE.applySource(A,A.source||'audio'); e.tempoSet=false; RD.tell(e); },
        setKey(k){ const e=reading(), A=e.A; if(!A) return;
          if(!k) A.key=A.keyAuto;
          else { const sc=k.minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11]; A.key={pc:k.pc,minor:k.minor,r:0,scale:sc.map(i=>(k.pc+i)%12),name:U.pcName(k.pc)+(k.minor?' MIN':' MAJ')}; }
          RD.tell(e); },
        setSource(v){ const e=reading(), A=e.A; if(!A||(v==='midi'&&!A.midiSet)) return; PULSE.applySource(A,v); e.tempoSet=false; RD.tell(e); },
        // a MIDI file of the beat: its drums, 808 and notes replace what was heard (the audio still gives the levels and the panel)
        midiFile(){ const e=reading(); if(e.mfTry) return {name:e.mfTry.name,status:e.mfTry.status,msg:e.mfTry.msg,using:e.mf&&e.mf.name};
          return e.mf&&{name:e.mf.name,status:'ready',info:e.mf.info}; },
        async useMidiFile(f){
          if(!user) return toast('Add your track first: the MIDI file goes with it.');
          const e=RD.of(pcm,sr,false), id=++e.mfTok;
          e.mfTry={name:f.name,status:'reading'}; RD.tell(e);
          const failed=msg=>{ if(id!==e.mfTok) return; e.mfTry={name:f.name,status:'error',msg}; RD.tell(e); };
          if(f.size>16e6) return failed('the file is too large for a MIDI file');
          let buf; try{ buf=await f.arrayBuffer(); }catch(err){ return failed('the file couldn’t be opened'); }
          await e.p;   // the track's own reading first
          if(id!==e.mfTok) return;
          if(!e.A) return failed('the track couldn’t be read');
          let m; try{ m=PULSE.parseMidi(buf); }
          catch(err){ return failed(err&&err.message==='smpte'?'it uses SMPTE timing, which isn’t supported':err&&err.message==='not-midi'?'this isn’t a MIDI file':'it couldn’t be read'); }
          const n=m.kick.length+m.snare.length+m.hat.length+m.perc.length+m.bass.length+m.mel.length;
          if(!n) return failed('it has no notes');
          m.name=f.name.replace(/\.(mid|midi)$/i,'').slice(0,32);
          e.A.midiSet=m; PULSE.applySource(e.A,'midi'); e.tempoSet=false;
          e.mf={name:f.name,info:`${n} notes · ${m.tracks} part${m.tracks===1?'':'s'}`}; e.mfTry=null; RD.tell(e); },
        clearMidi(){ const e=reading(); e.mfTok++; e.mfTry=null; e.mf=null;
          if(e.A&&e.A.midiSet){ e.A.midiSet=null; PULSE.applySource(e.A,'audio'); e.tempoSet=false; } RD.tell(e); },
        dismissMidi(){ const e=reading(); if(e.mfTry&&e.mfTry.status==='error'){ e.mfTry=null; RD.tell(e); } },
      });
    }
  };
  return E;
}
const GridAdapter=readoutAdapter({id:'grid',num:'09',name:'Grid',tag:'Steps',concept:'grid',bottom:'wave'});
const PadsAdapter=readoutAdapter({id:'pads',num:'10',name:'Pads',tag:'MPC',concept:'pads',bottom:'wave'});
/* Grid / Pads, side panel: Notes (from the audio or a MIDI file of the beat; tempo and key, Edit opens Advanced) and Text
   (the words at the top of the frame). Both read the shared reading, so they show what was set in the other one too. */
function rdPanel(inst){
  const src=Seg([{v:'audio',label:'From audio',hint:'The kick, snare, hats, 808 and notes as heard in the track'},
    {v:'midi',label:'From MIDI',hint:'Taken straight from your MIDI file of the beat'}],'audio',v=>{ inst.setSource(v); sync(); });
  const sum=h('span',{class:'note'});
  const edit=h('button',{class:'link','data-tip':'Set the tempo, beat one or the key yourself',onclick:()=>{ App.advTab='vis'; if(App.advOpen) buildAdv(); else toggleAdv(true); }},'Edit');
  const file=h('div',{class:'mf-row'});
  const sync=()=>{ const T=inst.tempoKey(), M=inst.midiFile(), has=hasTrack();
    src.set(T.ready?T.source:'audio'); src.buttons.forEach((b,i)=>{ b.disabled=!T.ready||(i===1&&!T.hasMidi); });
    sum.textContent=!has?'Add a track: its tempo, key and hits are read from it.':!T.ready?(T.failed?'This track couldn’t be read.':'Reading the beat…')
      :`${rdBpm(T.bpm)} BPM · ${T.key.name}`+(T.set||T.keySet?' (manual)':T.source==='midi'?' (MIDI)':'');
    edit.hidden=!T.ready;
    file.innerHTML='';
    if(!has) return;
    if(!M) file.append(h('button',{class:'link','data-tip':'Use your MIDI file of the beat for the drums, the 808 and the notes. The audio still drives the levels and the panel.',onclick:()=>pickMidiFile(inst)},'Upload MIDI'));
    else if(M.status==='reading') file.append(h('span',{class:'note'},`Reading ${M.name}…`));
    else if(M.status==='error') file.append(h('span',{class:'note mf-err'},`Couldn’t use ${M.name}: ${M.msg}.`+(M.using?` Still using ${M.using}.`:'')),
      h('button',{class:'link',onclick:()=>pickMidiFile(inst)},'Try another'),h('button',{class:'link',onclick:()=>inst.dismissMidi()},'Dismiss'));
    else file.append(h('span',{class:'mf-name',title:M.name},M.name),h('span',{class:'note'},M.info),
      h('button',{class:'link',onclick:()=>pickMidiFile(inst)},'Replace'),h('button',{class:'link',onclick:()=>inst.clearMidi()},'Remove')); };
  const row=(part,label,ph)=>{ const inp=h('input',{class:'bin',spellcheck:'false','aria-label':label,maxlength:40});
    const reset=h('button',{class:'ico bx','aria-label':'Back to automatic','data-tip':'Back to automatic',html:ICON.reset,onclick:()=>{ inst.setHeader(part,null); inp.value=inst.header()[part].auto; syncText(); }});
    inp.addEventListener('input',()=>{ const x=inst.header()[part]; inst.setHeader(part,inp.value===x.auto?null:inp.value); syncText(); });
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur',()=>syncText());
    const r=h('div',{class:'brow hdr-row','data-part':part},h('span',{class:'brole'},label),inp,reset); r.inp=inp; r.reset=reset; r.ph=ph; return r; };
  const rows=[row('title','Title','Track name'),row('artist','Artist','Optional')];
  const syncText=()=>{ const H=inst.header();
    for(const r of rows){ const x=H[r.dataset.part];
      if(document.activeElement!==r.inp) r.inp.value=x.text==null?x.auto:x.text;
      r.inp.placeholder=x.text===''?'Not shown':r.ph; r.reset.hidden=x.text==null; } };
  inst.watch=()=>{ sync(); syncText(); }; sync(); syncText();
  const frag=document.createDocumentFragment();
  frag.append(h('div',{class:'blk'},h('span',{class:'lab'},'Notes'),src,h('div',{class:'midi-row'},sum,edit),file),
    h('div',{class:'blk'},h('span',{class:'lab'},'Text'),h('div',{class:'brows'},rows),
      h('p',{class:'note'},'The words at the top of the frame. Type your own, or clear a line to hide it. Grid and Pads share them, with the tempo, key and MIDI file.')));
  return frag;
}
/* Grid / Pads, Advanced: Tempo & key. Found in the track (or the MIDI file), or set here: a BPM, half or double it, move
   beat one by a beat; the key */
function rdAdv(inst,body){
  const box=h('div');
  const render=()=>{ box.innerHTML=''; const T=inst.tempoKey();
    if(!T.ready){ box.append(h('p',{class:'note',style:'padding:8px 0'},hasTrack()?(T.failed?'This track couldn’t be read.':'Reading the beat…'):'Add a track: its tempo and key are read from it.')); return; }
    const bSeg=Seg([{v:'auto',label:'Auto',hint:T.source==='midi'?'The tempo of the MIDI file':'The tempo found in the track'},{v:'manual',label:'Manual',hint:'Set the tempo yourself'}],T.set?'manual':'auto',v=>{
      if(v==='auto') inst.autoTempo(); else inst.setBpm(T.bpm,inst.reading().A.beat0); render(); });
    box.append(h('div',{class:'choice'},h('span',{class:'lab'},'BPM'),bSeg));
    const inp=h('input',{class:'bin',type:'number',min:40,max:250,step:'0.1',inputmode:'decimal','aria-label':'Tempo in BPM',value:rdBpm(T.bpm)});
    inp.addEventListener('change',()=>{ const v=parseFloat(inp.value); if(v>0){ inst.setBpm(v); render(); } });
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); inp.blur(); } });
    const A=()=>inst.reading().A;
    box.append(h('div',{class:'rd-row'},inp,
      h('button',{class:'btn','data-tip':'Half the tempo',onclick:()=>{ inst.setBpm(A().bpm/2); render(); }},'½×'),
      h('button',{class:'btn','data-tip':'Double the tempo',onclick:()=>{ inst.setBpm(A().bpm*2); render(); }},'2×'),
      h('button',{class:'btn','data-tip':'Move beat one forward by a beat',onclick:()=>{ const a=A(); inst.setBpm(a.bpm,a.beat0+a.spb); render(); }},'Beat 1 →')));
    box.append(h('p',{class:'note'},(T.source==='midi'?'From the MIDI file: ':'Detected: ')+rdBpm(T.found)+' BPM'+(T.set?'. The grid, the bars and the beat use yours.':'')));
    const kSeg=Seg([{v:'auto',label:'Auto',hint:'The key found in the notes'},{v:'manual',label:'Manual',hint:'Set the key yourself'}],T.keySet?'manual':'auto',v=>{
      inst.setKey(v==='manual'?{pc:T.keyAuto.pc,minor:T.keyAuto.minor}:null); render(); });
    box.append(h('div',{class:'choice'},h('span',{class:'lab'},'Key'),kSeg));
    if(T.keySet){ const sel=h('select',{class:'bsel wide','aria-label':'Key'},[false,true].map(mi=>h('optgroup',{label:mi?'Minor':'Major'},
        Array.from({length:12},(_,pc)=>h('option',{value:pc+(mi?'m':'M')},PULSE.U.pcName(pc)+(mi?' MIN':' MAJ'))))));
      sel.value=T.key.pc+(T.key.minor?'m':'M');
      sel.addEventListener('change',()=>{ inst.setKey({pc:parseInt(sel.value,10),minor:sel.value.endsWith('m')}); render(); });
      box.append(sel); }
    box.append(h('p',{class:'note'},'Detected: '+T.keyAuto.name+(T.keySet?'. The frame shows yours.':'')));
  };
  inst.watchTK=()=>{ if(box.isConnected) render(); }; render();
  body.append(Section('Tempo & key',{onReset:()=>{ inst.autoTempo(); inst.setKey(null); render(); }},box));
}

/* ---- 11 OSCILLOSCOPE: a 3D phosphor oscilloscope (three.js) whose beam draws the track ----
   The approved test page (oscilloscope_3d_test_7; engine in engines_osc.js: window.OscEngine): a lab instrument built in
   code, lit per shot and rendered as an accumulated plate, with the CRT on top (trigger, timebase, two-component phosphor,
   halation) fed by the track's band-split waveform. The track is read once (bands, loudness, kicks, transients); the
   camera cuts between six shots on its own (Auto) or holds one. The knobs on the instrument turn with the panel's. */
const oscCache=new WeakMap();   // audio -> { p, an, prog, failed, buf }
const OSC_SHOTS=[{v:'auto',label:'Auto',hint:'Cuts between the six shots by itself, on a kick'},{v:'hero',label:'Hero',hint:'Low, looking up at the tube'},
  {v:'macro',label:'Macro',hint:'The faceplate close up'},{v:'tek34',label:'¾',hint:'The screen and the top of the deck from the left'},
  {v:'tekrake',label:'Raking',hint:'From the side, light raking across the knobs'},{v:'tekover',label:'Knobs',hint:'Low over the knobs, up at the tube'},
  {v:'tekcorner',label:'Corner',hint:'High, onto the lower corner of the screen'}];
const OSC_BGS=[{v:'black',label:'Black'},{v:'charcoal',label:'Charcoal'},{v:'warm',label:'Warm'},{v:'cool',label:'Cool'},{v:'paper',label:'Paper'},{v:'studio',label:'Studio'}];
const OSC_SCOPE=['intens','persist','focus','illum','vdiv','tdiv','low','mid','high','trans','scatter'];
const OscAdapter={
  id:'scope', num:'11', name:'Oscilloscope', tag:'Phosphor', cost:'heavy',
  looks:(window.OscEngine?OscEngine.MODES:[{id:'p31',name:'Green',sw:'#6dff8c'}]).map(m=>({k:m.id,label:m.name,bg:'#050606',fg:m.sw,g:m.sw})),   // the phosphors
  defaultLook:'p31',
  modes:{label:'View',def:'scope',options:[{v:'scope',label:'Oscilloscope',hint:'The instrument, its screen drawing the track'},
    {v:'wave',label:'Wave only',hint:'Only the phosphor trace, without the instrument'},{v:'both',label:'Both',hint:'The instrument dimmed, its screen brighter'}]},
  params:[
    {k:'intens',label:'Intensity',min:0,max:1,def:0.55,tier:1,fmt:v=>Math.round(v*100)+'%',hint:'Beam current: how bright the trace burns'},
    {k:'persist',label:'Persistence',min:0,max:1,def:0.5,tier:1,fmt:v=>Math.round(v*100)+'%',hint:'How long the phosphor keeps glowing after the beam'},
    {k:'focus',label:'Focus',min:0,max:1,def:0.7,tier:1,fmt:v=>Math.round(v*100)+'%',hint:'A sharp trace, or a soft, wide one'},
    // tier 2: the Camera and Studio blocks in the side panel
    {k:'shot',label:'Shot',tier:2,def:'auto',choices:OSC_SHOTS},
    {k:'cam',label:'Move',tier:2,def:'cinematic',choices:[{v:'static',label:'Static',hint:'A locked-off camera'},{v:'cinematic',label:'Cinematic',hint:'A slow, drifting move'},{v:'audio',label:'Audio',hint:'The music’s energy over seconds sets how much it moves'}]},
    {k:'motion',label:'Motion',tier:2,min:0,max:1,def:0.3,fmt:v=>Math.round(v*100)+'%',hint:'How far the camera moves'},
    {k:'cut',label:'Cut every',tier:2,min:4,max:20,def:9,int:true,fmt:v=>Math.round(v)+' s',hint:'How often Auto changes shot (it waits for a kick)'},
    {k:'bg',label:'Studio',tier:2,def:'charcoal',choices:OSC_BGS},
    // Advanced
    {k:'illum',label:'Graticule',group:'Screen',min:0,max:1,def:0.2,fmt:v=>Math.round(v*100)+'%',hint:'The scale lamp behind the grid on the screen'},
    {k:'scan',label:'Scanlines',group:'Screen',min:0,max:1,def:0.4,fmt:v=>Math.round(v*100)+'%',hint:'Fine lines across the phosphor'},
    {k:'vdiv',label:'Volts / div',group:'Screen',min:0,max:8,def:4,int:true,fmt:v=>(OscEngine.VDIV_LABELS[Math.round(v)]||'')+(v>=6?' mV':' V'),hint:'Vertical gain: how tall the wave is drawn'},
    {k:'tdiv',label:'Time / div',group:'Screen',min:0,max:8,def:4,int:true,fmt:v=>(OscEngine.TDIV_LABELS[Math.round(v)]||'')+' ms',hint:'Sweep speed: how much of the wave fits on the screen'},
    {k:'low',label:'Body',group:'Signal',min:0,max:1.5,def:1,fmt:v=>Math.round(v*100)+'%',hint:'The low end in the trace'},
    {k:'mid',label:'Mids',group:'Signal',min:0,max:1.5,def:1,fmt:v=>Math.round(v*100)+'%'},
    {k:'high',label:'Highs',group:'Signal',min:0,max:1.5,def:1,fmt:v=>Math.round(v*100)+'%'},
    {k:'trans',label:'Transients',group:'Signal',min:0,max:1.5,def:1,fmt:v=>Math.round(v*100)+'%',hint:'How hard kicks and snares hit the beam'},
    {k:'scatter',label:'Scatter',group:'Signal',min:0,max:1.5,def:0.45,fmt:v=>Math.round(v*100)+'%',hint:'Specks thrown off on the hits'},
    {k:'quality',label:'Quality',group:'Render',def:'auto',hint:'Auto lowers the 3D scene’s resolution while the camera moves, if frames run long',
     choices:[{v:'auto',label:'Auto'},{v:'full',label:'Full'},{v:'fast',label:'Fast'}]},
  ],
  panel(inst){ return oscPanel(inst); },
  create(){
    const E=OscEngine.create(), c=E.canvas;
    let land=false, hq=false, pcm=null, sr=44100, user=false, cur=null;
    const size=()=>{ const s=hq?1080:720, l=hq?1920:1280; E.resize(land?l:s,land?s:l); };
    const inst={ canvas:c, E, _warm:36 };
    const reading=(p,r)=>{ let e=oscCache.get(p);
      if(!e){ const buf={sampleRate:r,length:p.length,duration:p.length/r,numberOfChannels:1,getChannelData:()=>p};
        e={buf,an:null,prog:0,failed:false}; oscCache.set(p,e);
        e.p=OscEngine.analyse(buf,v=>{ e.prog=v; }).then(an=>{ e.an=an; if(cur===e) E.setTrack(e.buf,an,!user); inst._dirty=true; return an; },
          err=>{ e.failed=true; console.error('[Oscilloscope] the track couldn’t be read',err); return null; }); }
      return e; };
    return Object.assign(inst,{
      setAudio(p,r){ pcm=p; sr=r; user=AudioEngine.has&&p===AudioEngine.pcm; cur=reading(p,r); E.setTrack(cur.buf,cur.an,!user); inst._dirty=true; },
      frame(t,dt,playing){ E.frame(t,dt,!!playing); },
      set(k,v){ if(OSC_SCOPE.includes(k)) E.setScope(k,k==='vdiv'||k==='tdiv'?Math.round(v):v); else if(k==='scan') E.setScan(v); else if(k==='shot') E.setShot(v);
        else if(k==='cam') E.setCamMode(v); else if(k==='motion') E.setMotion(v); else if(k==='cut') E.setCut(v); else if(k==='bg') E.setBg(v); else if(k==='quality') E.setQuality(v); },
      setLook(k){ E.setLook(k); },
      setMode(v){ E.setView(v); },
      setHQ(on){ hq=!!on; size(); },
      setAspect(a){ land=a==='16:9'; size(); },
      // for the METHOD shell: the instrument is built and the track read before it plays or records
      progress(){ if(!E.ok) return App.view==='ws'&&App.vid==='scope'?'Building the oscilloscope':null;
        return user&&cur&&!cur.an&&!cur.failed?'Reading the track · '+Math.round(Math.min(1,cur.prog)*100)+'%':null; },
      ready(){ return Promise.all([E.ready,cur&&cur.p]).then(()=>{}); },
    });
  }
};
/* the Oscilloscope's blocks in the side panel: Camera (shot, move, motion, cut timing) and Studio (the backdrop) */
function oscPanel(inst){
  const vs=vsOf('scope'), P=k=>OscAdapter.params.find(p=>p.k===k);
  const bind=(k,v)=>{ vs.params[k]=v; inst.set(k,v); };
  const reset=(tip,fn)=>h('button',{class:'ico','data-tip':tip,'aria-label':tip,html:ICON.reset,onclick:fn});
  const cutS=Slider({...P('cut'),value:vs.params.cut,onInput:v=>bind('cut',v),onCommit:commit});
  const syncCut=()=>{ cutS.hidden=vs.params.shot!=='auto'; };
  const shot=Seg(P('shot').choices,vs.params.shot,v=>{ bind('shot',v); syncCut(); commit(); }); shot.classList.add('wrap');
  const move=Seg(P('cam').choices,vs.params.cam,v=>{ bind('cam',v); commit(); });
  const motion=Slider({...P('motion'),value:vs.params.motion,onInput:v=>bind('motion',v),onCommit:commit});
  syncCut();
  const camBlk=h('div',{class:'blk'},h('div',{class:'lab-row'},h('span',{class:'lab'},'Camera'),reset('Reset camera',()=>{
      for(const k of ['shot','cam','motion','cut']) bind(k,P(k).def); shot.set(vs.params.shot); move.set(vs.params.cam); motion.update(vs.params.motion); cutS.update(vs.params.cut); syncCut(); commit(); })),
    shot,h('div',{class:'choice'},h('span',{class:'lab'},'Move'),move),motion,cutS);
  const bg=Seg(P('bg').choices,vs.params.bg,v=>{ bind('bg',v); commit(); }); bg.classList.add('wrap','w3');
  const bgBlk=h('div',{class:'blk'},h('span',{class:'lab'},'Studio'),bg);
  const frag=document.createDocumentFragment(); frag.append(camBlk,bgBlk); return frag;
}

const ENGINES=[MidiAdapter,RetroAdapter,CausticAdapter,ContourAdapter,DustAdapter,SpatialAdapter,VolumeAdapter,DancerAdapter,GridAdapter,PadsAdapter,OscAdapter];   // MIDI / Score first
const ENG=Object.fromEntries(ENGINES.map(e=>[e.id,e]));
const defOf=(p,mode)=>typeof p.def==='object'?p.def[mode]??Object.values(p.def)[0]:p.def;
const paramFmt=p=>p.fmt||(p.int?(v=>String(Math.round(v))):f2);

/* ---- MIDI / SCORE demo score: what the library card (and a workspace with no track yet) shows ----
   The engine's own demo tune (MIDI_SCORE.Core.synthDemo, 96 bpm, A minor), analysed once by the engine itself at
   build time (Music.analyse 'auto' → Music.refine at the default Detail) and stored here in compact form, so the
   card shows a real score straight away and the visitor's browser never runs an analysis for it.
   Generated by make_midi_demo.js — do not edit by hand.
   Notes: [start ms, length ms, MIDI pitch, velocity ×10⁴, confidence ×10⁴, secondary?, inferred?, next note in voice]
   Hits:  [start ms, 0 kick · 1 snare · 2 hat, velocity ×10⁴]     Signals: 0–255 per 11.6 ms frame, base64 */
const MIDI_DEMO={"name":"demo","duration":21.2,"hopSec":0.011609977324263039,"nF":1827,"loop":[7.5,17.5],"tempo":{"bpm":96.11,"beat0":0.005,"downbeat0":0.005,"confidence":0.56},"key":"a minor","sections":[{"label":"a","start":0,"end":21.2}],"plan":[{"key":"high","w":1.7},{"key":"chords","w":2.3},{"key":"bass","w":1.7},{"key":"perc","w":0.9}],"chords":[{"start":0.005,"end":2.502,"duration":2.497,"root":9,"quality":"m7","name":"am7","pcs":[9,0,4,7],"intervals":[0,3,7,10],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[57,60,64,67]},{"start":2.502,"end":4.999,"duration":2.497,"root":5,"quality":"maj7","name":"fmaj7","pcs":[5,9,0,4],"intervals":[0,4,7,11],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[53,57,60,64]},{"start":4.999,"end":7.496,"duration":2.497,"root":0,"quality":"","name":"c","pcs":[0,4,7],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[60,64,67]},{"start":7.496,"end":9.994,"duration":2.497,"root":7,"quality":"","name":"g","pcs":[7,11,2],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":8,"pitches":[55,59,62]},{"start":9.994,"end":12.491,"duration":2.497,"root":9,"quality":"m7","name":"am7","pcs":[9,0,4,7],"intervals":[0,3,7,10],"diatonic":true,"confidence":1,"transcribed":6,"pitches":[57,60,64,67]},{"start":12.491,"end":14.988,"duration":2.497,"root":5,"quality":"maj7","name":"fmaj7","pcs":[5,9,0,4],"intervals":[0,4,7,11],"diatonic":true,"confidence":1,"transcribed":7,"pitches":[53,57,60,64]},{"start":14.988,"end":17.485,"duration":2.497,"root":0,"quality":"","name":"c","pcs":[0,4,7],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[60,64,67]},{"start":17.485,"end":19.982,"duration":2.497,"root":7,"quality":"","name":"g","pcs":[7,11,2],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":8,"pitches":[55,59,62]}],"pitched":{"high":[[5340,460,74,10000,9775,0,0,-1],[5640,1240,76,8895,8830,0,0,-1],[7520,940,74,10000,10000,0,0,-1],[8160,1220,71,7450,8650,0,0,-1],[9400,720,78,10000,9820,0,0,-1],[10700,560,79,10000,10000,0,0,-1],[10960,420,81,8555,9775,0,0,-1],[11320,1080,79,9065,10000,0,0,-1],[12200,940,76,8725,8650,0,0,-1],[12540,660,77,8385,9685,0,0,-1],[13200,1180,76,8895,10000,0,0,-1],[14080,1240,74,8215,9595,0,0,-1],[15320,480,74,9915,9280,0,0,-1],[15680,1700,76,8980,8875,0,0,-1],[17520,940,74,10000,10000,0,0,-1],[18200,1200,71,7450,8200,0,0,-1],[18820,1040,79,8130,4400,1,0,-1],[19420,700,78,8555,9235,0,0,-1]],"chords":[[20,607,57,7025,8515,0,0,4],[20,1698,60,7620,8830,0,0,6],[20,1698,64,7790,8965,0,0,9],[20,1698,67,7960,9010,0,0,7],[659,630,57,8980,9370,0,0,5],[1320,398,57,7365,8650,0,0,8],[1750,735,60,7450,8740,0,0,10],[1750,735,67,7790,8965,0,0,11],[2249,259,47,6175,3750,1,0,15],[2516,456,64,7280,8380,0,0,12],[2644,352,57,7620,8740,0,0,14],[2644,340,60,6940,8425,0,0,13],[3004,421,64,7535,8605,0,0,18],[3015,410,60,6345,8020,0,0,17],[3027,398,57,7110,8380,0,0,16],[3271,177,53,6940,7525,0,0,19],[3457,1513,57,7705,8695,0,0,24],[3457,317,60,9405,9460,0,0,23],[3457,1524,64,7875,8830,0,0,22],[3480,270,53,10000,9415,0,0,20],[3782,572,53,6770,8155,0,0,21],[4803,235,43,6940,3870,1,0,26],[5012,2441,64,7790,8965,0,0,28],[5012,2476,67,8215,9100,0,0,27],[5628,1222,55,7875,9010,0,0,25],[6881,688,48,10000,9595,0,0,31],[6881,607,55,8130,9055,0,0,29],[7520,2476,67,7875,8920,0,0,35],[7543,1814,62,7110,8560,0,0,36],[7566,549,59,7025,8560,0,0,30],[8135,1199,55,7705,8785,0,0,32],[8147,1234,59,7365,8605,0,0,33],[9401,607,43,10000,9595,0,0,37],[9412,549,59,6600,8290,0,0,34],[10028,2952,60,7280,8605,0,0,44],[10028,2441,67,7705,8920,0,0,47],[10051,897,64,6685,8380,0,0,38],[10074,874,57,6940,8515,0,0,39],[10980,1524,64,7960,9010,0,0,41],[11862,305,54,6515,3720,1,0,40],[12280,212,47,5835,3720,1,0,42],[12536,433,64,7365,8515,0,0,45],[12582,398,57,7450,8605,0,0,43],[13012,1663,57,7620,8650,0,0,49],[13012,1663,60,7025,8290,0,0,53],[13302,154,53,7025,7390,0,0,46],[13488,270,53,10000,9415,0,0,48],[13488,1187,64,7960,8830,0,0,50],[13789,560,53,6770,8155,0,0,51],[14707,247,57,7365,8380,0,0,54],[14707,259,64,7450,8470,0,0,52],[14811,189,43,7195,3900,1,0,57],[14997,1884,64,7535,8830,0,0,56],[15020,2476,67,8215,9100,0,0,59],[15647,1211,55,7875,9010,0,0,55],[16889,665,48,10000,9595,0,0,66],[16889,607,55,8215,9055,0,0,60],[16913,549,64,8215,9145,0,0,58],[17528,421,62,6600,8290,0,0,61],[17528,421,67,7535,8740,0,0,62],[17981,444,55,7280,8650,0,0,63],[17981,444,62,6770,8425,0,0,64],[17981,444,67,7535,8785,0,0,65],[18457,920,55,7790,8785,0,0,67],[18457,920,59,7535,8740,0,0,68],[18457,1559,62,6770,8020,0,0,-1],[18457,1605,67,7535,8650,0,0,-1],[19409,235,43,10000,8920,0,0,69],[19409,630,59,5410,4020,1,0,-1],[19757,375,43,8470,8785,0,0,-1]],"bass":[[22,998,33,7195,8830,0,0,1],[1569,349,33,6430,7615,0,0,2],[1918,619,45,5665,8470,0,0,3],[2617,2395,29,6430,7525,0,0,4],[5300,868,36,5835,8290,0,0,5],[6588,958,36,6005,8470,0,0,6],[7545,1137,31,9150,9055,0,0,7],[9072,918,31,8640,9145,0,0,8],[9990,1028,33,7195,8425,0,0,9],[11566,339,33,6515,7570,0,0,10],[11905,629,45,5665,8470,0,0,11],[12614,1626,29,6430,7795,0,0,12],[14240,768,29,7025,8875,0,0,13],[15298,868,36,5835,8290,0,0,14],[16585,958,36,6005,8470,0,0,15],[17543,1147,31,9150,9145,0,0,16],[19079,579,31,8555,8740,0,0,-1]]},"perc":[[308,2,8000],[621,1,9300],[621,2,7000],[935,2,4100],[1248,0,9600],[1248,2,10000],[1556,2,9600],[1875,1,10000],[1875,2,7500],[2183,2,3700],[2496,0,8900],[2496,2,9500],[2810,2,9300],[3123,2,7400],[3437,2,4900],[3750,0,10000],[3750,2,10000],[4063,2,7600],[4214,2,4700],[4371,1,9100],[4371,2,7300],[4685,2,4500],[4975,0,8000],[4998,2,9300],[5300,2,9500],[5625,1,8400],[5625,2,7700],[5939,2,4000],[6246,0,10000],[6246,2,8200],[6560,2,7800],[6873,1,8200],[6873,2,7500],[7187,2,4800],[7500,0,8900],[7500,2,8800],[7808,2,7900],[8110,1,7800],[8121,2,7300],[8435,2,4100],[8748,0,9600],[8748,2,8900],[9062,2,7700],[9218,2,5400],[9381,1,8400],[9381,2,7600],[9683,2,3800],[9990,0,8000],[9996,2,8300],[10310,2,8600],[10623,1,7800],[10623,2,7600],[10937,2,5300],[11250,0,10000],[11250,2,7900],[11552,2,8400],[11871,0,5400],[11871,2,7400],[12185,2,4200],[12469,0,5700],[12498,2,8900],[12812,2,9100],[13125,1,9700],[13125,2,8100],[13433,2,4000],[13746,0,10000],[13746,2,8900],[14048,2,7900],[14216,0,8500],[14216,2,5200],[14373,1,10000],[14687,2,4900],[15000,0,7700],[15000,2,8700],[15314,2,8500],[15610,1,8600],[15621,2,7200],[15935,2,4100],[16248,0,9600],[16248,2,8700],[16562,2,8800],[16875,1,9100],[16875,2,7400],[17183,2,3500],[17496,0,9000],[17496,2,7800],[17653,2,5400],[17810,2,5400],[17966,2,4800],[18123,1,8200],[18123,2,7100],[18437,2,4700],[18593,2,5200],[18750,0,10000],[18750,2,6000],[18901,2,4800],[19052,2,5600],[19215,0,8300],[19215,2,5900],[19354,1,7900],[19371,2,7400],[19667,0,7700],[19679,2,4300],[19841,2,6400]],"sig":{"amp":"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","energy":"mdbv8u3r6Obm6u/1+vn17eTg3+Pp6Obi2dLR0dXY2NbRycfFx9HRz83IxMPCw8G/wcC+vr2/yM3LysnJx8XEw8LAv768u768uru5uLayrqijnpmSjoqFgX58dnVzcWxsampnaGZlZGdiY2Gv3vL5+Pn39vTz8vDu7Onn5OHf3NnW09HOy8jFwsjR2NjW0czGxczMzMzKx8bExMLBwL24tK6zvsXFxMLCwL++vby7urm4t7e1tbS0s7KysbGxsbCwr6+vrq+urq2trKytrKurrKurqqeinZfN6+/4/Pz7+PPu5+Hc2dXU0tLQ1NLW1djX2tja2dnY2NfX19fW1dXU09PR0c3MyMfFxMLBv8DIysnJxsbGxcPCwMC+vru8uru5uri5tbOuqqSfmZSOioSCfHt0dG9wamppamZlZGZjYmJiYV2+5fH49/f29fPx7+3r6efl4uDd2tjV0s/Myca8trKvrKqoqaiurbKy1e7w+f369fLu7Orp5+bt6+ro6OTk4N/c29jX1NPQz8zLycfGxMPBwb6+vL27uri3trW0tLOysbGxsLCvrq6tqqahm8jj9Pr9/v369fX7+vPw8/Lu6enp5uHg4uHb2N3c2NPY2NTQ0NHPzMvMy8jHxsbFxMPCwsHAwL/My8zMy8rJycjHxcXDwsHBwL++vr68ure0sK2ppqOgnpyZl5aUkpGQj46NjIuLiomIiIeGhMrq9/f5+Pf39fTy8O7r6efk4uDd29jW09HOzMjU1tTP0dLRzczOzsnIzMzJyMfGxMTCv7y4tLrIx8fKyMbGxcPCwb++vby7u7m5ubi3t7e2tbW0tLOzs7OysrKxsbCwsK+vr6+urq6sqaWgmtfv8/H4/P7+//7+/fz59fLs5d7W0M7MzNLS2dnb29vd3NvZ19XQzcnHwsDAv8HAxMPCwcDAvs3LzMzLysnJx8fGxMPBwb/Avr29u7u5t7KvqqeloqCcmpiWlJKRkI6NjIuKiYmHh4aGhYSDveXz+vr6+ff29PPx7+3r6Obj4N7b2dbU0c7MycTDwsbJzdXU2djX1tXu+Pr9/v79/Pr49fTy8PLw7u7q6Obi4N7a2dbV09DPzMvLx8fFw8TBwMC9vLu6ubi3trW1tLOzs7KxsbGwsK+sqKWf1u749/Xx7evq7fL4+Pb18Oji4OLo6ejl3dfS09vc29nW0c3LzM3O0tDMycfFxcPDwsHCwL/Ayc3My8zKysnHxcbEw8LBwcC/wL69v726t7Ovq6mmo6CenJqYlpWTkpCQjo6NjIuKiomIiIeEzuv1+fj49/b08vDv7evp5uTi393a19XSz8zKxsrP1dva1tLMysnM1NPQzszKycjGxcLAu7e2vsXFxcTEw8LBwL++vby7urq5uLe3t7a2tbW0tba2tra2tbe2trW1tbS0tLSzs7Kysa+tqaXO5/b1+/39+vXw6uXg3dnX1dTT0tPS1dXY19nZ2tra2tnZ2djY19fW1dTU0tDNzMrIx8XEw8LFz87NzcvKysjHxcXDw8HBv7++vr2+vLq3tLCtqaWjoJ2bmJeUk5GQj46MjIuKiYmIiIeGhoTJ6fb3+fj39/X08vDt6+nn5OLf3dvY1dPQzsvHwr67uLa0tLOzs7e3yurv+fz++fTx7u3r6ujs6+ro5+bk49/e29vW1tHTztDLzcnKxsfDxcLCv8C+vby7urm4t7a2tbS0s7OysbGwrquno53W7vj8/v/79/X4+fbw7/Xy6Oft6uLg5OPd2trc2NTT2dbQz9XTzszS0MzKysjHxsXEw8LCwcDFzMzLysrKycjHxsXEwsLBwL+/v768u7i1sq6rp6Shn5yamJeVk5KQj46NjIyLiomJiIeGhb7l8/r6+vn39vXz8e/t6+jm4+He29nW1NHPzMnJ2NbS0NbV0c/S0M7My8vKycjGxcXDwb26tbfAwMjHxcjIxcTEwsC/vr28u7q6ubi4t7e2trW1tLSzs7OysrKxsbGwsLCvr6+urq2tqqainNLt+Pb1+/3+//7+/fv59vPu6eLZ08/MzMvS2dnf397e3NzZ2NbTz8vIw8LAwsHBwL/DwcLBwMHIzMvMy8rJx8fFxcPCwL+/vsC+vby7ubWyrKilo6Cdm5mXlZORkI6OjYyKiomIh4aGhYSDgc3r8/j3+fj29PLx7+3r6efk4uDd2tjV0s/NysXDwsfGzM7R1tXZ2Nfr9/f8/v38+/r49vTy8PLw7+7r6ubk493c2tbW09HQzczLyMjFxcPCzuPm9fr5+/j49fT08O/t6unl4+Le3dnX1NDOysbDv7y4tLGtqqajn5uYlJF/cGNXTEM7NC4oIx8bGBUTEA4NCwoJCAcGBQUEBAMDAgICAgEBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","bass":"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","mid":"SIaswcjR0tXV1dTU2dfW1djY1dXV1dTT0tLS0tHQ09LRz8/Pzs7MzMvPzMzLzczJysrIxsXEw8XEwsHBwb69vcC9wcC/vsG+vr7Avby8vru7urq4ubi2tre3sra2trG1tLSytLKxsbOurauyssDN1dXW19XW1dXR1dTU0NPS0c7Qz87Mz8vKyczHx8fHxcTEw8LCwb/AwcC+v7++u7+9vLi3tbSzsa6usbCvrrCwr6+urq2xra6tr66sra2sq6uqqaupqKerqainp6ekpKGfm5eRjYZ+dG97jp6esrq8usLGyMfMy83NzMvMzczLy83KysrLyMfJycXExMjGxMLGxcPAw8PBvbzAv7u5uLe1sbK0tLKwr7Curaywr62rr6+uq6utrKqqqqmoqKupqKeqqailpqanoqKkp6Kho6ekoaGhnp2hrrnGysjIycvJyMfJyMfExcXFwcDDxMC+v8G/vLy9vbu4uLy7t7S0tLGts7Oyr66usK2sqqqpqKalo6Gkqqmop6amo6KipaOioaakoaCjoqCdnZ6empmcoJ2Zmp6cmJeXlpGMhoB3bF9UVIG01ur1+vv9/f7+//3+/v79/v7+/f7+/f38+/j4/Pr5+/z7+fn5+Pf39vb19fT08/Px8O7s6efn7fT39fb29/b29fX19PTz8/Py8vHx8fDw8PDv7u7t7e3s7Ovr6urp6ejo6Ofn5ubl5eTj4OLw+Pv9/v/+//7+/v79/fz8+/v6+vn5+Pf39/b19fTz8/Ly8fDw7+/u7u3t7Ovr6+rq6ejo5+bl5OLh4OHi5OPj4uPi4uLh4eDf397e3t3d3Nzb29va2trZ2djY2NfX19bV1NPS0c/OzMrHxtLm8vn8/f7//v/////+//7+/f79/f3+/f38/Pz7/Pr6+fn5+Pj39vX19PTz8/Lx8PDw7ezp5uTk5ens7O7t7vHx7+7t7Ozs6+rq6unp6Ofm5OPl5urp6eno6Ofn6Ofm5eXk5OXk4+Pj4uDf3uTw9/v9/f39/Pz8/Pv7+vr6+fn5+Pj39vb29fX09PPz8vLx8fDw7+/w7+7u7e3s7Ovq6Obi5OPw8PX09PLy8PDv7u7t7Ozr6+rq6enp6Ofn5ubl5OTj4+Li4eHg397e3d3c29nZ19bTzsa8vtTn7/X4+Pn5+fn4+vj5+Pj3+Pf39vX29fX08/Py8vLx8PDv7+7t6+no5OPi4d/i4uLh393Z2uDm6+7u7u3t7Ozs7ezs7Ozr6+vq6urq6ebj39rW0s7MycfDwcC+vLq6uLe1tLSzsrCvrq2utMfT2dnb2tra2djX2dfX1dfW1NPT0tHQz87OzczLzMvKyMjIxsbFxMTGxMPDxcPCxcrO09jZ29/h4N7c2tfV1dXU09HR0dTW1trb29ra2dbS0M7N1Nnh5ujs6+zs7Ozs7Ovq6ejn5uXk4+Dd2tjY2trZ1dTV1dHP09PRzNLR0czMzM/My8nOzMvIy8rJx8fGxcPDwsHAv7++vry/vby5ube2tLS2uLSztLi1s7G1tLGws7WysLC1tLKvs7OyrrCwr62urbCur66vrq2srKuqqamrqaipqKatuMTCztDPzc7OzcvLysrJyMfGx8bFxcbEw8PDwL/AwLy7ur67ube2tbKvsrSyrq6zs6+srKqppaSlpaGfn6KfnpyhoJ+doqKhn5+fnp2dnp2cm56cm5mcm5qYmZialpaXlpCMh4F5dXuLm6jC3u73+v38/v7+/f7+//3+/v79/v79/fz7+ff39/b6/Pv5+fr5+Pj39vb19fX09PPy8fDu6+nq8vf39vb5+Pf39vX19fX09PPz8/Py8fHx8PDv7+7u7e3s7Ozr6+rq6enp6Ofn5+bm5eTj4uHp9Pr8/v7//v/+/v39/f38+/v7+vn5+Pj39vb19fTz8/Py8fHw8O/u7u3t7Ovr6+rp6eno5+fm5eXk5OPk5OPi4uHh4eDg39/f397e3d3d3Nzb29va2trZ2dnY2NfX1tbW1dPS0dDOzMrIxcna7fb6/f7+/v/+/v7+/f38/v38/Pv9+/39/Pv6+vn5+fj39/b29fX19PPy8/Ly8fDv7u7r6Obp7u/v7+/u7u3t7fHv7u3r6+vr6unp6ejn5OPi4uHh4+Xl5eXl5eTn5ubl5OTj4+Pi4eHf3tzh4Obo8fP5+vn5+fn5+/r6+fn39/f39vb19fX09PPz8vLy8fHw7+7t6+jl4d/e3d7g393a2dnm6e/v8O/v7u/u7u3t7Ozr7Orr6eno6Ofn5eTj4+Li4uHh4ODg39/e3d3c29rZ2NfW1dTSz8nCurGmm4+CdWhbUEc+NzAqJSEdGRYUEQ8NDAoJCAcGBQUEBAMDAwICAgIBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","high":"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","kick":"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","snare":"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","hat":"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","perc":"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"}};
let midiDemoRes=null;
// the same structure Music.refine() hands the renderer (its legacy view), rebuilt once from the compact data
function midiDemoScore(){
  if(midiDemoRes) return midiDemoRes;
  const D=MIDI_DEMO, hz=m=>+(440*Math.pow(2,(m-69)/12)).toFixed(2), PERC={kick:[36,0.25],snare:[38,0.18],hat:[42,0.06]}, SUB=['kick','snare','hat'];
  const note=(a,lane)=>{ const start=a[0]/1000, duration=a[1]/1000;
    return {start,duration,end:start+duration,pitch:a[2],frequency:hz(a[2]),velocity:a[3]/1e4,confidence:a[4]/1e4,tier:a[5]?'secondary':'primary',
      inferred:!!a[6],type:'note',lane,role:lane==='chords'?'chord':lane,representation:'midi',nx:a[7],voice:0}; };
  const perc=D.perc.map(a=>{ const subtype=SUB[a[1]], [pitch,duration]=PERC[subtype], start=a[0]/1000;
    return {type:'percussion',subtype,lane:subtype,start,duration,end:start+duration,pitch,velocity:a[2]/1e4,confidence:1,nx:-1,voice:0}; });
  const mk=ev=>({ev,starts:Float64Array.from(ev.map(e=>e.start)),maxDur:ev.reduce((m,e)=>Math.max(m,e.duration),0)});
  const lanes={};
  for(const k of ['high','chords','bass']) lanes[k]=mk(D.pitched[k].map(a=>note(a,k)));
  for(const k of SUB) lanes[k]=mk(perc.filter(e=>e.subtype===k));
  lanes.perc=mk(perc); lanes.chords.regions=D.chords;
  const all=lanes.high.ev.concat(lanes.chords.ev,lanes.bass.ev,perc).sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
  all.forEach((e,i)=>{ e.id=i; });
  const signals={};
  for(const k in D.sig){ const s=atob(D.sig[k]), a=new Float32Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i)/255; signals[k]=a; }
  return midiDemoRes={ duration:D.duration, hopSec:D.hopSec, nF:D.nF, events:all, lanes, tempo:D.tempo, signals, plan:D.plan, chords:D.chords, key:D.key,
    sections:D.sections, routed:[], notes:lanes.high.ev.concat(lanes.chords.ev,lanes.bass.ev).sort((a,b)=>a.start-b.start), allNotes:[], analysis:{}, stats:{},
    music:{key:D.key?{name:D.key}:null}, loop:D.loop, demo:true };
}
/* ==================================================================== FX
   Shared effects: one registry, every visualizer. To add an effect, add an
   entry - its params become uniforms u_<id>_<param> (+ u_<id>_on), its GLSL
   is spliced into the stage it names, and its UI builds itself.
   Stages run in this order on every frame:
     uv     -> warp the lookup position        (vec2 uv)
     sample -> resample / filter the source    (vec3 col, src(uv))
     light  -> add light                       (uBlur, uGlow, uBloom)
     [ colour grade ]
     color  -> stylise colour
     [ Negative ]
     film   -> lens / film surface             (v = screen uv)
   pass: which pre-pass texture the effect needs ('blur' | 'glow' | 'bloom').  */
const FX=[
  {id:'bloom',label:'Bloom',group:'Light',pass:'bloom',hint:'Bright areas spill light',
   params:[{k:'amount',label:'Amount',min:0,max:2,def:0.7},{k:'threshold',label:'Threshold',min:0,max:1,def:0.7},{k:'radius',label:'Radius',min:0.3,max:2,def:1}],
   light:`col+=texture(uBloom,uv).rgb*u_bloom_amount*1.6;`},
  {id:'glow',label:'Glow',group:'Light',pass:'glow',hint:'Soft diffusion over the whole picture, like a mist filter',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.4},{k:'radius',label:'Radius',min:0.3,max:2,def:1}],
   light:`{ vec3 g=texture(uGlow,uv).rgb*u_glow_amount; col=1.-(1.-col)*(1.-g); }`},
  {id:'blur',label:'Blur',group:'Lens',pass:'blur',hint:'Defocus the picture',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.7},{k:'radius',label:'Radius',min:0.5,max:4,def:1.5}],
   sample:`col=mix(col,texture(uBlur,uv).rgb,u_blur_amount);`},
  {id:'sharpen',label:'Sharpen',group:'Lens',hint:'Crisper edges',
   params:[{k:'amount',label:'Amount',min:0,max:1.5,def:0.5}],
   sample:`{ vec3 n=src(uv+vec2(uSrcPx.x,0.))+src(uv-vec2(uSrcPx.x,0.))+src(uv+vec2(0.,uSrcPx.y))+src(uv-vec2(0.,uSrcPx.y)); col=max(col+(col*4.-n)*u_sharpen_amount*.5,0.); }`},
  {id:'chroma',label:'Chromatic aberration',group:'Lens',hint:'Colour fringes that grow toward the edges',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.35}],
   sample:`{ vec2 d=(uv-.5)*u_chroma_amount*.025; col.r=(src(uv+d).r+src(uv+d*.5).r)*.5; col.b=(src(uv-d).b+src(uv-d*.5).b)*.5; }`},
  {id:'split',label:'RGB split',group:'Lens',hint:'Red and blue channels offset in one direction',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.3},{k:'angle',label:'Angle',min:0,max:360,def:0,fmt:v=>Math.round(v)+'\u00b0'}],
   sample:`{ float a=radians(u_split_angle), M=max(uRes.x,uRes.y); vec2 d=vec2(cos(a)*M/uRes.x,sin(a)*M/uRes.y)*u_split_amount*.012; col.r=src(uv+d).r; col.b=src(uv-d).b; }`},
  {id:'distort',label:'Distortion',group:'Lens',hint:'The picture flows as if seen through moving glass',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.35},{k:'scale',label:'Scale',min:0.3,max:3,def:1},{k:'speed',label:'Speed',min:0,max:2,def:0.4}],
   uv:`{ vec2 q=uv*vec2(uRes.x,uRes.y)/max(uRes.x,uRes.y)*u_distort_scale*3.; float tt=uTime*u_distort_speed; uv+=(vec2(vnoise(q+vec2(0.,tt)),vnoise(q+vec2(5.2,-tt)))-.5)*u_distort_amount*.05; }`},
  {id:'posterize',label:'Posterize',group:'Color',hint:'Flatten tones into a few steps',
   params:[{k:'levels',label:'Levels',min:2,max:12,def:5,int:true}],
   color:`col=floor(col*(u_posterize_levels-1.)+.5)/(u_posterize_levels-1.);`},
  {id:'vignette',label:'Vignette',group:'Film',hint:'Darken toward the corners',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.5},{k:'softness',label:'Softness',min:0,max:1,def:0.6}],
   film:`{ vec2 d=(v-.5)*vec2(uRes.x,uRes.y)/max(uRes.x,uRes.y)*1.7; col*=1.-u_vignette_amount*smoothstep(.95-u_vignette_softness*.75,1.35,length(d)); }`},
  {id:'scan',label:'Scanlines',group:'Film',hint:'Fine horizontal lines, like a monitor',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.35},{k:'size',label:'Spacing',min:2,max:12,def:4,fmt:v=>v.toFixed(1)+' px'}],
   film:`{ float px=min(uRes.x,uRes.y)/1080.*u_scan_size; col*=1.-u_scan_amount*.55*(.5+.5*cos(gl_FragCoord.y/px*6.2832)); }`},
  {id:'film',label:'Film',group:'Film',hint:'Gate weave, a little flicker and lifted blacks',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.5}],
   uv:`uv+=vec2(sin(uTime*7.3)*.6+sin(uTime*13.1)*.4,sin(uTime*5.7)+.5*sin(uTime*11.3))*u_film_amount*.0011;`,
   film:`{ col*=1.+(hash1(floor(uTime*24.))-.5)*.07*u_film_amount; col=mix(col,col*.9+.055,u_film_amount*.7); }`},
  {id:'grain',label:'Grain',group:'Film',hint:'Animated film grain',
   params:[{k:'amount',label:'Amount',min:0,max:1,def:0.35},{k:'size',label:'Size',min:1,max:4,def:1.5,fmt:v=>v.toFixed(1)+' px'}],
   film:`{ vec2 c=floor(gl_FragCoord.xy/max(1.,u_grain_size*min(uRes.x,uRes.y)/1080.)); col+=(hash2(c+fract(uFrame*.6180339)*vec2(113.,71.))-.5)*u_grain_amount*.24; }`},
];
const FX_GROUPS=['Light','Lens','Color','Film'];
function defaultFx(){ const o={}; for(const e of FX){ o[e.id]={on:false}; for(const p of e.params) o[e.id][p.k]=p.def; } return o; }

/* ------------------------------------------------------------ colour grade */
const GRADE_ADJ=[
  {k:'exposure',label:'Exposure',min:-2,max:2,def:0,fmt:v=>(v>0?'+':'')+v.toFixed(2)},
  {k:'contrast',label:'Contrast',min:-1,max:1,def:0},
  {k:'saturation',label:'Saturation',min:-1,max:1,def:0},
  {k:'temperature',label:'Temperature',min:-1,max:1,def:0,hint:'Cooler to the left, warmer to the right'},
  {k:'tint',label:'Tint',min:-1,max:1,def:0,hint:'Magenta to the left, green to the right'},
  {k:'shadows',label:'Shadows',min:-1,max:1,def:0},
  {k:'highlights',label:'Highlights',min:-1,max:1,def:0},
];
const GRAD_PALETTES=[
  ['#e8412c','#050505','#3d7bff'],['#0b0b2a','#e2336b','#ffe6a8'],['#101010','#1f6f5c','#e9f5c8'],['#1a0f06','#c9642b','#fff1dc'],
  ['#000000','#6b5bff','#fbe9ff'],['#05121c','#2aa7c9','#f3fbff'],['#200505','#b51d1d','#ffd0c2'],['#111111','#8a8a80','#f5f3e7'],
  ['#0d1b0d','#8fc93a','#f7ffe0'],['#1b0624','#f06bd5','#fff6c9'],
];
function defaultGrade(){ return { exposure:0,contrast:0,saturation:0,temperature:0,tint:0,shadows:0,highlights:0,
  curves:{m:[[0,0],[1,1]],r:[[0,0],[1,1]],g:[[0,0],[1,1]],b:[[0,0],[1,1]]},
  grad:{on:false,amount:1,shift:0,repeat:1,stops:[{p:0,c:'#e8412c'},{p:0.5,c:'#050505'},{p:1,c:'#3d7bff'}]} }; }
const gradeIsDefault=g=>JSON.stringify(g)===JSON.stringify(defaultGrade());

/* monotone cubic through the points (Fritsch-Carlson): no overshoot, so a
   curve can never invert tones between two points */
function curveFn(pts){
  const p=[...pts].sort((a,b)=>a[0]-b[0]), n=p.length;
  if(n===2){ const [x0,y0]=p[0],[x1,y1]=p[1]; return x=>clamp(x<=x0?y0:x>=x1?y1:y0+(y1-y0)*(x-x0)/(x1-x0),0,1); }
  const d=[], m=new Array(n);
  for(let i=0;i<n-1;i++) d.push((p[i+1][1]-p[i][1])/Math.max(1e-6,p[i+1][0]-p[i][0]));
  m[0]=d[0]; m[n-1]=d[n-2];
  for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){ if(d[i]===0){ m[i]=m[i+1]=0; continue; } const a=m[i]/d[i], b=m[i+1]/d[i], s=a*a+b*b; if(s>9){ const t=3/Math.sqrt(s); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; } }
  return x=>{
    if(x<=p[0][0]) return clamp(p[0][1],0,1); if(x>=p[n-1][0]) return clamp(p[n-1][1],0,1);
    let i=0; while(i<n-2&&x>p[i+1][0]) i++;
    const hh=p[i+1][0]-p[i][0], t=(x-p[i][0])/hh, t2=t*t, t3=t2*t;
    return clamp((2*t3-3*t2+1)*p[i][1]+(t3-2*t2+t)*hh*m[i]+(-2*t3+3*t2)*p[i+1][1]+(t3-t2)*hh*m[i+1],0,1);
  };
}
const hex2rgb=hx=>[1,3,5].map(i=>parseInt(hx.substr(i,2),16));
const rgb2hex=c=>'#'+c.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
function gradSample(stops,t){
  const s=[...stops].sort((a,b)=>a.p-b.p);
  if(t<=s[0].p) return hex2rgb(s[0].c); if(t>=s[s.length-1].p) return hex2rgb(s[s.length-1].c);
  for(let i=0;i<s.length-1;i++) if(t<=s[i+1].p){ const a=hex2rgb(s[i].c), b=hex2rgb(s[i+1].c), u=(t-s[i].p)/Math.max(1e-6,s[i+1].p-s[i].p); return a.map((v,j)=>v+(b[j]-v)*u); }
  return hex2rgb(s[s.length-1].c);
}

/* ================================================================== POST */
const VS_Q=`#version 300 es
in vec2 p; out vec2 v; void main(){ v=p*.5+.5; gl_Position=vec4(p,0.,1.); }`;
const FS_DOWN=`#version 300 es
precision highp float; in vec2 v; uniform sampler2D t; uniform vec2 px; uniform float th; out vec4 o;
void main(){ vec3 s=(texture(t,v+px*vec2(-.5,-.5)).rgb+texture(t,v+px*vec2(.5,-.5)).rgb+texture(t,v+px*vec2(-.5,.5)).rgb+texture(t,v+px*vec2(.5,.5)).rgb)*.25;
  if(th>0.){ float l=dot(s,vec3(.2126,.7152,.0722)); s*=smoothstep(th,th+.2,l); } o=vec4(s,1.); }`;
const FS_BLUR=`#version 300 es
precision highp float; in vec2 v; uniform sampler2D t; uniform vec2 d; out vec4 o;
void main(){ vec3 s=texture(t,v).rgb*.2270270270;
 s+=(texture(t,v+d*1.3846153846).rgb+texture(t,v-d*1.3846153846).rgb)*.3162162162;
 s+=(texture(t,v+d*3.2307692308).rgb+texture(t,v-d*3.2307692308).rgb)*.0702702703; o=vec4(s,1.); }`;
/* Branding composite. Straight alpha from a 2D canvas; blend 1 = difference,
   which keeps white type readable over any picture by construction. */
const FS_BASE=`#version 300 es
precision highp float; in vec2 v; uniform sampler2D uSrc,uBrand; uniform float uBlend; out vec4 o;
void main(){ vec3 s=texture(uSrc,v).rgb; vec4 b=texture(uBrand,v);
  vec3 c=uBlend>.5?abs(s-b.rgb):b.rgb; o=vec4(mix(s,c,b.a),1.); }`;
function buildFinalFS(){
  const U=[], st={uv:[],sample:[],light:[],color:[],film:[]};
  for(const e of FX){ U.push(`uniform float u_${e.id}_on;`); for(const p of e.params) U.push(`uniform float u_${e.id}_${p.k};`);
    for(const k of Object.keys(st)) if(e[k]) st[k].push(`if(u_${e.id}_on>.5){ ${e[k]} }`); }
  return `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uSrc,uBlur,uGlow,uBloom,uLut,uGrad,uBrand;
uniform float uBrandLate,uBrandBlend;
uniform vec2 uRes,uSrcPx; uniform float uTime,uFrame;
uniform float uExposure,uContrast,uSat,uTemp,uTint,uShadows,uHighlights,uGradOn,uGradAmt,uGradShift,uGradRepeat;
uniform float uNegFrom,uNegTo,uNegP,uNegHue;
${U.join('\n')}
float hash1(float n){ return fract(sin(n*127.1)*43758.5453); }
float hash2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 x){ vec2 i=floor(x),f=fract(x); f=f*f*(3.-2.*f); return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
vec3 src(vec2 uv){ return texture(uSrc,uv).rgb; }
float tri(float x){ return 1.-abs(1.-mod(x,2.)); }
float lut(float x,int ch){ vec4 s=texture(uLut,vec2(clamp(x,0.,1.)*.99609375+.001953125,.5)); return ch==0?s.r:ch==1?s.g:s.b; }
vec3 grade(vec3 c){
  c*=exp2(uExposure);
  c*=vec3(1.+uTemp*.12-uTint*.04,1.+uTint*.09,1.-uTemp*.12-uTint*.04);
  float l=luma(c);
  c+=uShadows*.32*pow(1.-clamp(l,0.,1.),2.5);
  c+=uHighlights*.32*pow(clamp(l,0.,1.),2.5);
  c=(c-.5)*(1.+uContrast)+.5;
  l=luma(c); c=mix(vec3(l),c,1.+uSat);
  c=clamp(c,0.,1.);
  c=vec3(lut(c.r,0),lut(c.g,1),lut(c.b,2));
  if(uGradOn>.5){ float t=tri(luma(c)*uGradRepeat+uGradShift); c=mix(c,texture(uGrad,vec2(t*.99609375+.001953125,.5)).rgb,uGradAmt); }
  return c;
}
// Negative. "Keep hue" flips lightness but keeps each colour's chroma, so a red
// field stays red while light and dark trade places; otherwise a plain invert.
vec3 negate(vec3 c){ if(uNegHue>.5){ float l=luma(c); return clamp(c+(1.-2.*l),0.,1.); } return 1.-c; }
void main(){
  vec2 uv=v; vec3 col;
  ${st.uv.join('\n  ')}
  uv=clamp(uv,0.,1.);
  col=src(uv);
  ${st.sample.join('\n  ')}
  ${st.light.join('\n  ')}
  col=grade(col);
  ${st.color.join('\n  ')}
  // the flip wipes top to bottom, so it never passes through a flat grey
  float w=smoothstep(uNegP-.012,uNegP+.012,1.-v.y);
  float m=mix(uNegTo,uNegFrom,w);
  if(m>0.) col=mix(col,negate(col),m);
  ${st.film.join('\n  ')}
  // "keep branding clean": type composited after grade and effects (still turns over with Negative)
  if(uBrandLate>.5){ vec4 b=texture(uBrand,v); vec3 bc=b.rgb;
    if(uBrandBlend>.5) bc=abs(clamp(col,0.,1.)-bc); else if(m>0.) bc=mix(bc,negate(bc),m);
    col=mix(col,bc,b.a); }
  o=vec4(clamp(col,0.,1.),1.);
}`;
}

function createPost(canvas){
  const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,premultipliedAlpha:false,preserveDrawingBuffer:true});
  if(!gl) return createPost2D(canvas);
  const sh=(t,s)=>{ const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog=fs=>{ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,VS_Q)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs)); gl.bindAttribLocation(p,0,'p'); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u={}, n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS); for(let i=0;i<n;i++){ const a=gl.getActiveUniform(p,i); u[a.name]=gl.getUniformLocation(p,a.name); } return {p,u}; };
  const pDown=prog(FS_DOWN), pBlur=prog(FS_BLUR), pBase=prog(FS_BASE), pFin=prog(buildFinalFS());
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const tex=(w,h,data)=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data||null);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
    return t; };
  const target=(w,h)=>{ const t=tex(w,h), fb=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fb); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0); return {t,fb,w,h}; };
  let W=canvas.width, H=canvas.height;
  const T={src:tex(1,1), lut:tex(256,1), grad:tex(256,1), brand:tex(1,1)};
  function sizeTargets(){
    for(const k of ['base','b1','b2','g1','g2','m1','m2']) if(T[k]){ gl.deleteTexture(T[k].t); gl.deleteFramebuffer(T[k].fb); }
    T.base=target(W,H); T.b1=target(W>>1,H>>1); T.b2=target(W>>1,H>>1); T.g1=target(W>>2,H>>2); T.g2=target(W>>2,H>>2); T.m1=target(W>>2,H>>2); T.m2=target(W>>2,H>>2);
  }
  sizeTargets();
  let srcW=1, srcH=1, lutKey='', gradKey='', cur=null, brandW=1, srcAW=1, srcAH=1;
  // the effects' uniform locations, looked up once (not as new strings on every frame)
  const fxU=FX.map(e=>({id:e.id,on:pFin.u[`u_${e.id}_on`],ps:e.params.map(p=>[p.k,pFin.u[`u_${e.id}_${p.k}`]]).filter(q=>q[1])}));
  const pass=(rt,pr)=>{ gl.bindFramebuffer(gl.FRAMEBUFFER,rt?rt.fb:null); gl.viewport(0,0,rt?rt.w:W,rt?rt.h:H); gl.useProgram(pr.p); };
  const bind=(unit,t)=>{ gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); };
  function chain(a,b,th,radius,iters){
    pass(a,pDown); bind(0,cur); gl.uniform1i(pDown.u.t,0); gl.uniform2f(pDown.u.px,1/srcW,1/srcH); gl.uniform1f(pDown.u.th,th); gl.drawArrays(gl.TRIANGLES,0,3);
    let r=radius*Math.max(a.w,a.h)/480;   // against the long side: the same blur in pixels in either orientation (portrait: a.h/480)
    for(let i=0;i<iters;i++){
      pass(b,pBlur); bind(0,a.t); gl.uniform1i(pBlur.u.t,0); gl.uniform2f(pBlur.u.d,r/a.w,0); gl.drawArrays(gl.TRIANGLES,0,3);
      pass(a,pBlur); bind(0,b.t); gl.uniform2f(pBlur.u.d,0,r/a.h); gl.drawArrays(gl.TRIANGLES,0,3);
      r*=1.9;
    }
  }
  function uploadLUT(grade){
    const key=JSON.stringify(grade.curves); if(key===lutKey) return; lutKey=key;
    const M=curveFn(grade.curves.m), C=[curveFn(grade.curves.r),curveFn(grade.curves.g),curveFn(grade.curves.b)], d=new Uint8Array(1024);
    for(let i=0;i<256;i++){ const m=M(i/255); for(let c=0;c<3;c++) d[i*4+c]=Math.round(C[c](m)*255); d[i*4+3]=255; }
    gl.bindTexture(gl.TEXTURE_2D,T.lut); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,d);
  }
  function uploadGrad(grade){
    const key=JSON.stringify(grade.grad.stops); if(key===gradKey) return; gradKey=key;
    const d=new Uint8Array(1024); for(let i=0;i<256;i++){ const c=gradSample(grade.grad.stops,i/255); d[i*4]=c[0]; d[i*4+1]=c[1]; d[i*4+2]=c[2]; d[i*4+3]=255; }
    gl.bindTexture(gl.TEXTURE_2D,T.grad); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,d);
  }
  let frame=0;
  return { gl:true,
    resize(w,h){ if(w===W&&h===H) return; canvas.width=w; canvas.height=h; W=w; H=h; sizeTargets(); },
    render(source,fx,grade,neg,time,brand){
      gl.bindVertexArray(vao);
      gl.bindTexture(gl.TEXTURE_2D,T.src); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      // same size as last frame: update the texture in place instead of reallocating it (same pixels)
      if(source.width!==srcAW||source.height!==srcAH){ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,source); srcAW=source.width; srcAH=source.height; }
      else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
      srcW=source.width; srcH=source.height; cur=T.src;
      const B=brand&&brand.on?brand:null;
      if(B&&(B.dirty||brandW!==B.canvas.width)){ gl.bindTexture(gl.TEXTURE_2D,T.brand); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,B.canvas); brandW=B.canvas.width; B.dirty=false; }
      if(B&&!B.late){   // branding becomes part of the picture: every effect and the grade see it
        pass(T.base,pBase); bind(0,T.src); bind(1,T.brand); gl.uniform1i(pBase.u.uSrc,0); gl.uniform1i(pBase.u.uBrand,1); gl.uniform1f(pBase.u.uBlend,B.blend?1:0);
        gl.drawArrays(gl.TRIANGLES,0,3); cur=T.base.t; srcW=W; srcH=H; }
      uploadLUT(grade); uploadGrad(grade);
      if(fx.blur.on) chain(T.b1,T.b2,0,fx.blur.radius,2);
      if(fx.glow.on) chain(T.g1,T.g2,0,fx.glow.radius*1.4,3);
      if(fx.bloom.on) chain(T.m1,T.m2,fx.bloom.threshold,fx.bloom.radius,3);
      const u=pFin.u; pass(null,pFin);
      bind(0,cur); bind(1,T.b1.t); bind(2,T.g1.t); bind(3,T.m1.t); bind(4,T.lut); bind(5,T.grad); bind(6,T.brand);
      gl.uniform1i(u.uSrc,0); gl.uniform1i(u.uBlur,1); gl.uniform1i(u.uGlow,2); gl.uniform1i(u.uBloom,3); gl.uniform1i(u.uLut,4); gl.uniform1i(u.uGrad,5); gl.uniform1i(u.uBrand,6);
      gl.uniform1f(u.uBrandLate,B&&B.late?1:0); gl.uniform1f(u.uBrandBlend,B&&B.blend?1:0);
      gl.uniform2f(u.uRes,W,H); gl.uniform2f(u.uSrcPx,1/srcW,1/srcH); gl.uniform1f(u.uTime,time); gl.uniform1f(u.uFrame,frame++);
      const G=grade;
      gl.uniform1f(u.uExposure,G.exposure); gl.uniform1f(u.uContrast,G.contrast); gl.uniform1f(u.uSat,G.saturation);
      gl.uniform1f(u.uTemp,G.temperature); gl.uniform1f(u.uTint,G.tint); gl.uniform1f(u.uShadows,G.shadows); gl.uniform1f(u.uHighlights,G.highlights);
      gl.uniform1f(u.uGradOn,G.grad.on?1:0); gl.uniform1f(u.uGradAmt,G.grad.amount); gl.uniform1f(u.uGradShift,G.grad.shift); gl.uniform1f(u.uGradRepeat,G.grad.repeat);
      gl.uniform1f(u.uNegFrom,neg.from); gl.uniform1f(u.uNegTo,neg.to); gl.uniform1f(u.uNegP,neg.p); gl.uniform1f(u.uNegHue,neg.keepHue?1:0);
      for(const f of fxU){ const s=fx[f.id]; if(f.on) gl.uniform1f(f.on,s.on?1:0); for(const q of f.ps) gl.uniform1f(q[1],s[q[0]]); }
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
  };
}
/* Fallback without WebGL2: the picture passes straight through (effects and grade off). */
function createPost2D(canvas){
  const x=canvas.getContext('2d');
  return { gl:false, resize(w,h){ canvas.width=w; canvas.height=h; }, render(source,fx,grade,neg,time,brand){ x.globalCompositeOperation='source-over'; x.drawImage(source,0,0,canvas.width,canvas.height);
    if(brand&&brand.on){ x.globalCompositeOperation=brand.blend?'difference':'source-over'; x.drawImage(brand.canvas,0,0,canvas.width,canvas.height); x.globalCompositeOperation='source-over'; } } };
}


/* BVS integration exports only; original adapter implementations above remain unchanged */
window.METHOD_LIBRARY = Object.freeze({engines:ENGINES, adapters:ENG, effects:FX, audio:AudioEngine, post:createPost, post2d:createPost2D, format:paramFmt, fxDefaults:defaultFx, gradeDefaults:defaultGrade, gradeControls:GRADE_ADJ, gradientPalettes:GRAD_PALETTES});
