
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
const MIDI_DEMO={"name":"demo","duration":21.2,"hopSec":0.011609977324263039,"nF":1827,"loop":[7.5,17.5],"tempo":{"bpm":96.11,"beat0":0.005,"downbeat0":0.005,"confidence":0.56},"key":"a minor","sections":[{"label":"a","start":0,"end":21.2}],"plan":[{"key":"high","w":1.7},{"key":"chords","w":2.3},{"key":"bass","w":1.7},{"key":"perc","w":0.9}],"chords":[{"start":0.005,"end":2.502,"duration":2.497,"root":9,"quality":"m7","name":"am7","pcs":[9,0,4,7],"intervals":[0,3,7,10],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[57,60,64,67]},{"start":2.502,"end":4.999,"duration":2.497,"root":5,"quality":"maj7","name":"fmaj7","pcs":[5,9,0,4],"intervals":[0,4,7,11],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[53,57,60,64]},{"start":4.999,"end":7.496,"duration":2.497,"root":0,"quality":"","name":"c","pcs":[0,4,7],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[60,64,67]},{"start":7.496,"end":9.994,"duration":2.497,"root":7,"quality":"","name":"g","pcs":[7,11,2],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":8,"pitches":[55,59,62]},{"start":9.994,"end":12.491,"duration":2.497,"root":9,"quality":"m7","name":"am7","pcs":[9,0,4,7],"intervals":[0,3,7,10],"diatonic":true,"confidence":1,"transcribed":6,"pitches":[57,60,64,67]},{"start":12.491,"end":14.988,"duration":2.497,"root":5,"quality":"maj7","name":"fmaj7","pcs":[5,9,0,4],"intervals":[0,4,7,11],"diatonic":true,"confidence":1,"transcribed":7,"pitches":[53,57,60,64]},{"start":14.988,"end":17.485,"duration":2.497,"root":0,"quality":"","name":"c","pcs":[0,4,7],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":4,"pitches":[60,64,67]},{"start":17.485,"end":19.982,"duration":2.497,"root":7,"quality":"","name":"g","pcs":[7,11,2],"intervals":[0,4,7],"diatonic":true,"confidence":1,"transcribed":8,"pitches":[55,59,62]}],"pitched":{"high":[[5340,460,74,10000,9775,0,0,-1],[5640,1240,76,8895,8830,0,0,-1],[7520,940,74,10000,10000,0,0,-1],[8160,1220,71,7450,8650,0,0,-1],[9400,720,78,10000,9820,0,0,-1],[10700,560,79,10000,10000,0,0,-1],[10960,420,81,8555,9775,0,0,-1],[11320,1080,79,9065,10000,0,0,-1],[12200,940,76,8725,8650,0,0,-1],[12540,660,77,8385,9685,0,0,-1],[13200,1180,76,8895,10000,0,0,-1],[14080,1240,74,8215,9595,0,0,-1],[15320,480,74,9915,9280,0,0,-1],[15680,1700,76,8980,8875,0,0,-1],[17520,940,74,10000,10000,0,0,-1],[18200,1200,71,7450,8200,0,0,-1],[18820,1040,79,8130,4400,1,0,-1],[19420,700,78,8555,9235,0,0,-1]],"chords":[[20,607,57,7025,8515,0,0,4],[20,1698,60,7620,8830,0,0,6],[20,1698,64,7790,8965,0,0,9],[20,1698,67,7960,9010,0,0,7],[659,630,57,8980,9370,0,0,5],[1320,398,57,7365,8650,0,0,8],[1750,735,60,7450,8740,0,0,10],[1750,735,67,7790,8965,0,0,11],[2249,259,47,6175,3750,1,0,15],[2516,456,64,7280,8380,0,0,12],[2644,352,57,7620,8740,0,0,14],[2644,340,60,6940,8425,0,0,13],[3004,421,64,7535,8605,0,0,18],[3015,410,60,6345,8020,0,0,17],[3027,398,57,7110,8380,0,0,16],[3271,177,53,6940,7525,0,0,19],[3457,1513,57,7705,8695,0,0,24],[3457,317,60,9405,9460,0,0,23],[3457,1524,64,7875,8830,0,0,22],[3480,270,53,10000,9415,0,0,20],[3782,572,53,6770,8155,0,0,21],[4803,235,43,6940,3870,1,0,26],[5012,2441,64,7790,8965,0,0,28],[5012,2476,67,8215,9100,0,0,27],[5628,1222,55,7875,9010,0,0,25],[6881,688,48,10000,9595,0,0,31],[6881,607,55,8130,9055,0,0,29],[7520,2476,67,7875,8920,0,0,35],[7543,1814,62,7110,8560,0,0,36],[7566,549,59,7025,8560,0,0,30],[8135,1199,55,7705,8785,0,0,32],[8147,1234,59,7365,8605,0,0,33],[9401,607,43,10000,9595,0,0,37],[9412,549,59,6600,8290,0,0,34],[10028,2952,60,7280,8605,0,0,44],[10028,2441,67,7705,8920,0,0,47],[10051,897,64,6685,8380,0,0,38],[10074,874,57,6940,8515,0,0,39],[10980,1524,64,7960,9010,0,0,41],[11862,305,54,6515,3720,1,0,40],[12280,212,47,5835,3720,1,0,42],[12536,433,64,7365,8515,0,0,45],[12582,398,57,7450,8605,0,0,43],[13012,1663,57,7620,8650,0,0,49],[13012,1663,60,7025,8290,0,0,53],[13302,154,53,7025,7390,0,0,46],[13488,270,53,10000,9415,0,0,48],[13488,1187,64,7960,8830,0,0,50],[13789,560,53,6770,8155,0,0,51],[14707,247,57,7365,8380,0,0,54],[14707,259,64,7450,8470,0,0,52],[14811,189,43,7195,3900,1,0,57],[14997,1884,64,7535,8830,0,0,56],[15020,2476,67,8215,9100,0,0,59],[15647,1211,55,7875,9010,0,0,55],[16889,665,48,10000,9595,0,0,66],[16889,607,55,8215,9055,0,0,60],[16913,549,64,8215,9145,0,0,58],[17528,421,62,6600,8290,0,0,61],[17528,421,67,7535,8740,0,0,62],[17981,444,55,7280,8650,0,0,63],[17981,444,62,6770,8425,0,0,64],[17981,444,67,7535,8785,0,0,65],[18457,920,55,7790,8785,0,0,67],[18457,920,59,7535,8740,0,0,68],[18457,1559,62,6770,8020,0,0,-1],[18457,1605,67,7535,8650,0,0,-1],[19409,235,43,10000,8920,0,0,69],[19409,630,59,5410,4020,1,0,-1],[19757,375,43,8470,8785,0,0,-1]],"bass":[[22,998,33,7195,8830,0,0,1],[1569,349,33,6430,7615,0,0,2],[1918,619,45,5665,8470,0,0,3],[2617,2395,29,6430,7525,0,0,4],[5300,868,36,5835,8290,0,0,5],[6588,958,36,6005,8470,0,0,6],[7545,1137,31,9150,9055,0,0,7],[9072,918,31,8640,9145,0,0,8],[9990,1028,33,7195,8425,0,0,9],[11566,339,33,6515,7570,0,0,10],[11905,629,45,5665,8470,0,0,11],[12614,1626,29,6430,7795,0,0,12],[14240,768,29,7025,8875,0,0,13],[15298,868,36,5835,8290,0,0,14],[16585,958,36,6005,8470,0,0,15],[17543,1147,31,9150,9145,0,0,16],[19079,579,31,8555,8740,0,0,-1]]},"perc":[[308,2,8000],[621,1,9300],[621,2,7000],[935,2,4100],[1248,0,9600],[1248,2,10000],[1556,2,9600],[1875,1,10000],[1875,2,7500],[2183,2,3700],[2496,0,8900],[2496,2,9500],[2810,2,9300],[3123,2,7400],[3437,2,4900],[3750,0,10000],[3750,2,10000],[4063,2,7600],[4214,2,4700],[4371,1,9100],[4371,2,7300],[4685,2,4500],[4975,0,8000],[4998,2,9300],[5300,2,9500],[5625,1,8400],[5625,2,7700],[5939,2,4000],[6246,0,10000],[6246,2,8200],[6560,2,7800],[6873,1,8200],[6873,2,7500],[7187,2,4800],[7500,0,8900],[7500,2,8800],[7808,2,7900],[8110,1,7800],[8121,2,7300],[8435,2,4100],[8748,0,9600],[8748,2,8900],[9062,2,7700],[9218,2,5400],[9381,1,8400],[9381,2,7600],[9683,2,3800],[9990,0,8000],[9996,2,8300],[10310,2,8600],[10623,1,7800],[10623,2,7600],[10937,2,5300],[11250,0,10000],[11250,2,7900],[11552,2,8400],[11871,0,5400],[11871,2,7400],[12185,2,4200],[12469,0,5700],[12498,2,8900],[12812,2,9100],[13125,1,9700],[13125,2,8100],[13433,2,4000],[13746,0,10000],[13746,2,8900],[14048,2,7900],[14216,0,8500],[14216,2,5200],[14373,1,10000],[14687,2,4900],[15000,0,7700],[15000,2,8700],[15314,2,8500],[15610,1,8600],[15621,2,7200],[15935,2,4100],[16248,0,9600],[16248,2,8700],[16562,2,8800],[16875,1,9100],[16875,2,7400],[17183,2,3500],[17496,0,9000],[17496,2,7800],[17653,2,5400],[17810,2,5400],[17966,2,4800],[18123,1,8200],[18123,2,7100],[18437,2,4700],[18593,2,5200],[18750,0,10000],[18750,2,6000],[18901,2,4800],[19052,2,5600],[19215,0,8300],[19215,2,5900],[19354,1,7900],[19371,2,7400],[19667,0,7700],[19679,2,4300],[19841,2,6400]],"sig":{"amp":"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","energy":"mdbv8u3r6Obm6u/1+vn17eTg3+Pp6Obi2dLR0dXY2NbRycfFx9HRz83IxMPCw8G/wcC+vr2/yM3LysnJx8XEw8LAv768u768uru5uLayrqijnpmSjoqFgX58dnVzcWxsampnaGZlZGdiY2Gv3vL5+Pn39vTz8vDu7Onn5OHf3NnW09HOy8jFwsjR2NjW0czGxczMzMzKx8bExMLBwL24tK6zvsXFxMLCwL++vby7urm4t7e1tbS0s7KysbGxsbCwr6+vrq+urq2trKytrKurrKurqqeinZfN6+/4/Pz7+PPu5+Hc2dXU0tLQ1NLW1djX2tja2dnY2NfX19fW1dXU09PR0c3MyMfFxMLBv8DIysnJxsbGxcPCwMC+vru8uru5uri5tbOuqqSfmZSOioSCfHt0dG9wamppamZlZGZjYmJiYV2+5fH49/f29fPx7+3r6efl4uDd2tjV0s/Myca8trKvrKqoqaiurbKy1e7w+f369fLu7Orp5+bt6+ro6OTk4N/c29jX1NPQz8zLycfGxMPBwb6+vL27uri3trW0tLOysbGxsLCvrq6tqqahm8jj9Pr9/v369fX7+vPw8/Lu6enp5uHg4uHb2N3c2NPY2NTQ0NHPzMvMy8jHxsbFxMPCwsHAwL/My8zMy8rJycjHxcXDwsHBwL++vr68ure0sK2ppqOgnpyZl5aUkpGQj46NjIuLiomIiIeGhMrq9/f5+Pf39fTy8O7r6efk4uDd29jW09HOzMjU1tTP0dLRzczOzsnIzMzJyMfGxMTCv7y4tLrIx8fKyMbGxcPCwb++vby7u7m5ubi3t7e2tbW0tLOzs7OysrKxsbCwsK+vr6+urq6sqaWgmtfv8/H4/P7+//7+/fz59fLs5d7W0M7MzNLS2dnb29vd3NvZ19XQzcnHwsDAv8HAxMPCwcDAvs3LzMzLysnJx8fGxMPBwb/Avr29u7u5t7KvqqeloqCcmpiWlJKRkI6NjIuKiYmHh4aGhYSDveXz+vr6+ff29PPx7+3r6Obj4N7b2dbU0c7MycTDwsbJzdXU2djX1tXu+Pr9/v79/Pr49fTy8PLw7u7q6Obi4N7a2dbV09DPzMvLx8fFw8TBwMC9vLu6ubi3trW1tLOzs7KxsbGwsK+sqKWf1u749/Xx7evq7fL4+Pb18Oji4OLo6ejl3dfS09vc29nW0c3LzM3O0tDMycfFxcPDwsHCwL/Ayc3My8zKysnHxcbEw8LBwcC/wL69v726t7Ovq6mmo6CenJqYlpWTkpCQjo6NjIuKiomIiIeEzuv1+fj49/b08vDv7evp5uTi393a19XSz8zKxsrP1dva1tLMysnM1NPQzszKycjGxcLAu7e2vsXFxcTEw8LBwL++vby7urq5uLe3t7a2tbW0tba2tra2tbe2trW1tbS0tLSzs7Kysa+tqaXO5/b1+/39+vXw6uXg3dnX1dTT0tPS1dXY19nZ2tra2tnZ2djY19fW1dTU0tDNzMrIx8XEw8LFz87NzcvKysjHxcXDw8HBv7++vr2+vLq3tLCtqaWjoJ2bmJeUk5GQj46MjIuKiYmIiIeGhoTJ6fb3+fj39/X08vDt6+nn5OLf3dvY1dPQzsvHwr67uLa0tLOzs7e3yurv+fz++fTx7u3r6ujs6+ro5+bk49/e29vW1tHTztDLzcnKxsfDxcLCv8C+vby7urm4t7a2tbS0s7OysbGwrquno53W7vj8/v/79/X4+fbw7/Xy6Oft6uLg5OPd2trc2NTT2dbQz9XTzszS0MzKysjHxsXEw8LCwcDFzMzLysrKycjHxsXEwsLBwL+/v768u7i1sq6rp6Shn5yamJeVk5KQj46NjIyLiomJiIeGhb7l8/r6+vn39vXz8e/t6+jm4+He29nW1NHPzMnJ2NbS0NbV0c/S0M7My8vKycjGxcXDwb26tbfAwMjHxcjIxcTEwsC/vr28u7q6ubi4t7e2trW1tLSzs7OysrKxsbGwsLCvr6+urq2tqqainNLt+Pb1+/3+//7+/fv59vPu6eLZ08/MzMvS2dnf397e3NzZ2NbTz8vIw8LAwsHBwL/DwcLBwMHIzMvMy8rJx8fFxcPCwL+/vsC+vby7ubWyrKilo6Cdm5mXlZORkI6OjYyKiomIh4aGhYSDgc3r8/j3+fj29PLx7+3r6efk4uDd2tjV0s/NysXDwsfGzM7R1tXZ2Nfr9/f8/v38+/r49vTy8PLw7+7r6ubk493c2tbW09HQzczLyMjFxcPCzuPm9fr5+/j49fT08O/t6unl4+Le3dnX1NDOysbDv7y4tLGtqqajn5uYlJF/cGNXTEM7NC4oIx8bGBUTEA4NCwoJCAcGBQUEBAMDAgICAgEBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","bass":"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","mid":"SIaswcjR0tXV1dTU2dfW1djY1dXV1dTT0tLS0tHQ09LRz8/Pzs7MzMvPzMzLzczJysrIxsXEw8XEwsHBwb69vcC9wcC/vsG+vr7Avby8vru7urq4ubi2tre3sra2trG1tLSytLKxsbOurauyssDN1dXW19XW1dXR1dTU0NPS0c7Qz87Mz8vKyczHx8fHxcTEw8LCwb/AwcC+v7++u7+9vLi3tbSzsa6usbCvrrCwr6+urq2xra6tr66sra2sq6uqqaupqKerqainp6ekpKGfm5eRjYZ+dG97jp6esrq8usLGyMfMy83NzMvMzczLy83KysrLyMfJycXExMjGxMLGxcPAw8PBvbzAv7u5uLe1sbK0tLKwr7Curaywr62rr6+uq6utrKqqqqmoqKupqKeqqailpqanoqKkp6Kho6ekoaGhnp2hrrnGysjIycvJyMfJyMfExcXFwcDDxMC+v8G/vLy9vbu4uLy7t7S0tLGts7Oyr66usK2sqqqpqKalo6Gkqqmop6amo6KipaOioaakoaCjoqCdnZ6empmcoJ2Zmp6cmJeXlpGMhoB3bF9UVIG01ur1+vv9/f7+//3+/v79/v7+/f7+/f38+/j4/Pr5+/z7+fn5+Pf39vb19fT08/Px8O7s6efn7fT39fb29/b29fX19PTz8/Py8vHx8fDw8PDv7u7t7e3s7Ovr6urp6ejo6Ofn5ubl5eTj4OLw+Pv9/v/+//7+/v79/fz8+/v6+vn5+Pf39/b19fTz8/Ly8fDw7+/u7u3t7Ovr6+rq6ejo5+bl5OLh4OHi5OPj4uPi4uLh4eDf397e3t3d3Nzb29va2trZ2djY2NfX19bV1NPS0c/OzMrHxtLm8vn8/f7//v/////+//7+/f79/f3+/f38/Pz7/Pr6+fn5+Pj39vX19PTz8/Lx8PDw7ezp5uTk5ens7O7t7vHx7+7t7Ozs6+rq6unp6Ofm5OPl5urp6eno6Ofn6Ofm5eXk5OXk4+Pj4uDf3uTw9/v9/f39/Pz8/Pv7+vr6+fn5+Pj39vb29fX09PPz8vLx8fDw7+/w7+7u7e3s7Ovq6Obi5OPw8PX09PLy8PDv7u7t7Ozr6+rq6enp6Ofn5ubl5OTj4+Li4eHg397e3d3c29nZ19bTzsa8vtTn7/X4+Pn5+fn4+vj5+Pj3+Pf39vX29fX08/Py8vLx8PDv7+7t6+no5OPi4d/i4uLh393Z2uDm6+7u7u3t7Ozs7ezs7Ozr6+vq6urq6ebj39rW0s7MycfDwcC+vLq6uLe1tLSzsrCvrq2utMfT2dnb2tra2djX2dfX1dfW1NPT0tHQz87OzczLzMvKyMjIxsbFxMTGxMPDxcPCxcrO09jZ29/h4N7c2tfV1dXU09HR0dTW1trb29ra2dbS0M7N1Nnh5ujs6+zs7Ozs7Ovq6ejn5uXk4+Dd2tjY2trZ1dTV1dHP09PRzNLR0czMzM/My8nOzMvIy8rJx8fGxcPDwsHAv7++vry/vby5ube2tLS2uLSztLi1s7G1tLGws7WysLC1tLKvs7OyrrCwr62urbCur66vrq2srKuqqamrqaipqKatuMTCztDPzc7OzcvLysrJyMfGx8bFxcbEw8PDwL/AwLy7ur67ube2tbKvsrSyrq6zs6+srKqppaSlpaGfn6KfnpyhoJ+doqKhn5+fnp2dnp2cm56cm5mcm5qYmZialpaXlpCMh4F5dXuLm6jC3u73+v38/v7+/f7+//3+/v79/v79/fz7+ff39/b6/Pv5+fr5+Pj39vb19fX09PPy8fDu6+nq8vf39vb5+Pf39vX19fX09PPz8/Py8fHx8PDv7+7u7e3s7Ozr6+rq6enp6Ofn5+bm5eTj4uHp9Pr8/v7//v/+/v39/f38+/v7+vn5+Pj39vb19fTz8/Py8fHw8O/u7u3t7Ovr6+rp6eno5+fm5eXk5OPk5OPi4uHh4eDg39/f397e3d3d3Nzb29va2trZ2dnY2NfX1tbW1dPS0dDOzMrIxcna7fb6/f7+/v/+/v7+/f38/v38/Pv9+/39/Pv6+vn5+fj39/b29fX19PPy8/Ly8fDv7u7r6Obp7u/v7+/u7u3t7fHv7u3r6+vr6unp6ejn5OPi4uHh4+Xl5eXl5eTn5ubl5OTj4+Pi4eHf3tzh4Obo8fP5+vn5+fn5+/r6+fn39/f39vb19fX09PPz8vLy8fHw7+7t6+jl4d/e3d7g393a2dnm6e/v8O/v7u/u7u3t7Ozr7Orr6eno6Ofn5eTj4+Li4uHh4ODg39/e3d3c29rZ2NfW1dTSz8nCurGmm4+CdWhbUEc+NzAqJSEdGRYUEQ8NDAoJCAcGBQUEBAMDAwICAgIBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","high":"mdbv7uPOt5d7ZVNEOC4mHxkVEQ4LCQgGBQQDGBQRDgsJCAYFBAMDAgICDh4ZFBEOCwkIHSRcl7CvraqknZaMhHtwZltQRTwzKyMdGBQQDQsJEA0LCQcGBQQDAwICAQEBAQEBAAAAAAAACS+r3vL69ejRq4xzXk0/NCsjHRgTEA0LCQcGBRFBUlFDNy0lHhkUEQ4LCQgGFBkUEA4LCQcGDzZ4o6uppp+ZkoyGfXNqX1ZORDkxKCEbFhIPDAoJCAcGBQQDAwICAQEBAQEBAAAAAAAAAAAJLmK+5fX49uXQsph/aVZJPDIpIRsWEg8MCggHBgUbGxgUEA0LCQcGBQQDAwICFxYSDwwKCAcTEyl9nJ2cmJSQi4N7dW1mW1JGQDYwKCEcFxMPDQoRDgwKCAYFBAQDAgICAQEBAQEAAAAAAAAAKEy34vT58Ny/nYFqV0c6MCcgGhYSDwwKCAcFBEFVUUU4LiYfGhURGFN1yOn28OjTupl9Z1RIQVmWpJ+cmpaTjoR8dGxmW1JJQzozKSIcFxMPDQoRECQgGhURDgwKCAYFBAQDAgICAQEBAQE0Wbnj5uHSs5aBbl1MQjkxKCMeGxYTEQ8MCgoKCiM6NSskHhkUEQ4LCQgHBQUZGBQQDQsJBwYTQ3igoJ6blpCKg3t0bWVcUkc+NCwmIiIcFxMPDA0KCQcGBQQDAwICAQEBAQEBAAAAAAAAAAAHK6rd8fn05cqmiHBbSz0yKSIcFxMPDQoIBwYFJEVbU0c6MCcgGhYSDwwKCAgQDwwKCAcGBQQnPX+ko6Gel5GLhHxza2BYTUM7MSghGxYSDwwKCA0KCQcGBQQDAwICAQEBAQEBAAAAAAAAAAErVLvk9PHn1baVgGlWRzowJyAaFRIODAoIBwUEBBoWEg8MCggHBgUEAwMCAg4ZFBEOCwkIBgg2ZpmanJmWkYuDe3NrYlpQRToxKSIcFxMPDQoIHS8mIBoVEQ4MCggGBQQEAwICAgEBAQEBAAIwrN7y+vXo0auMc15NPzQrIx0YExANCwkHBgUPQUhIPTIpIRsWEhYVTmfC5+/q3MCgg2tYSEBUe6GhnpqVj4iCenRrYFVKQDUsJR4ZFBEOCwkHBgwhHxoVEQ4MCggGBQQEAwICAgEBAQEBACBnwuf18uvdxaWIb1tLPTIpIhwXEw8NCggHBgUEFhcTEA0LCQcGBQQDAwICASAaFREODAoICRQ8hqWmpaGemZGKgHhvZl1TST0zKyQeGRQRDgsVMCsjHRcTEA0LCQcGBQQDAwICAQEBAQEBABNEtOHz+O7auJd8ZlNEOC4mHxkVEQ4LCQgGBQQ2SVVMPjMqIhwXEw8NCgkHCRYSDwwKCAcGCyFgmKmppqKblI2GfnVqXlVMQjoxKCIcFxMPDQofLycgGhURDgwKCAYFBAQDAgICAQEBAQEAEU+x4PP69+7WuJyEblpMQTUsJB8ZFREODAoIBwUXHBoVEg4MCggHBQQEAwICEBYSDwwKCAcGERRomqajoJyXkYqCeXJqYVdPRz42LiUhHBcTDw0ODQsJBwYFBAMDAgIBAQEBAQEAAAAAAAAAJDux4PL69ebMqIpxXUw+MyoiHBcTEA0KCQcGBTlcWk9ANSskHRgUFkZluuP0+vHkyaWIb1tLQT6DoZ+cm5eUjod+eHBoXVRKRTw0KiMdFxMQDQsPDSEgGhUSDgwKCAYFBAQDAgICAQEBAQEbU4TO5ePXxq6XgWpcTkI2MCkkHRkWFBAODQwKCR44Ni4oIRsWExANCwkHBgUXHhgUEA0LCQcSPmeXo6Ogm5aPiIF6cWpfU0lANjAqJiIfGhURDgwLCQgGBQQDAwICAgEBAQEBAAAAAAAAAAAAMKze8vr16NCrjHNeTT80KyMdFxMQDQsJBwYFCTpXVUs/NCsjHRgTEA0LCQcXGBQQDQsJBwYINXSdn52ZlJCJgnpyamFYTkQ6LycgGhUSDgwKCAcFBAQDAgICAQEBAQEAAAAAAAAAAAAAAAMuTrjj9PLr3cGfh29bSz0zMCcgGhYSDwwKCAcFBBEQDQsJBwYFBAMDAgIBCAYfGhURDgwJCAYoS4idnJqWkIqEfnVtZFxVTUQ8MikhGxYSDwwKFSwnIBoVEg4MCggGBQQECAYFBAMDAgICAQEJQbPh8/fu2biXfGZTRDgwKiIcFxMQDQoJBwYFNUlJRDguJh8ZFREcSm3F6Pbx6dSzknhiUUJQcKCkoJuWkoqCe3JpYVpSST8zKiMcFxMQDSN0tNzo9vTs2bmYfWZURTg0LiUfGRURDgsJCAYFBAMDAgICAQEBAQEAAAAAABsdGBMQDQsJBwYFBAMDAgIBAQEBAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","kick":"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","snare":"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","hat":"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","perc":"8v/mezsUEAYEBAUEBAIEAwQCAwMDAwIDAgQDEAoIBgQCAwMCAgICAwIDAwoDAwECAwIDBggSbVdPP1g1LiMhGxsXFA0OCQoNCQcGBwYHBQQCEAkEAwMCAgIBAQIBAQECAQEBAgEBAgEBBgka+f/FbUUYBQMEAgICBAICAgMCAgIDAwIDAwYRGhMGBgMDAgMCAgIBAgIDBwYEAgMBBAMECA4XZVNEPikuIyMiHBYVERENCgoLCggGBggGBQUHDAcEAwICAgICAQIBAgEBAgEBAAAAAQIDCB20rdKeeCkZCwsKBgcHCAYGBQcFBgQGBAYEBgQPDAsHCAYGBQQFAwUCAwIECQcCBAIDAgMDCQlXY1NHNS8qIRwfGBcTDg4LDQkKCAgJCQcHBgQOBwUEBAIDAQIBAwECAQICAgICAgIBAgMFDhL1/+qnSiQRBgUDBAMDAgMCAwIDAwMCAgMCAw8hEQsHBAQEBAQECBcdndOVVkYcDQcGBAIGBgpWSj4yPDAuJBgZHRoVEA0LDwsKCAYGBwcGBQMOCQ0HBAMDAgIBAgECAQICAwEBAQEDAgIIHzKvblslCAkKCQUHBwgFBwcHBAYHBgQEBwcEBQ0TDAcICAYEBQYGBAQGBgUICgYDAgMDAwQKFBVhTkY8KyUmHB0ZGBIQFAsNBwkKCggKBwUFBAcLBgUDAgICAgIBAQICAQECAgIBAQECAgMFEe//9J1uMBUFAwMDAgICAgIBAgICAgECAgMECB0cDQkGCAcEBQUGBAMEBQMICAQCAwQDAgUJEkxySkYyMiIlIRwbFBARDQoJCQcJBwYGBgYEAgwIBQQDAgICAgICAgICAQIDAgEBAQEBAwYOGNr/y209HwwFBwQGAwQEAwMEAwMDAwMDAwMDAw8ICAYFBAQDAwMDAgIDAgIIAwMDAwICBAYNFYVFPzA6LyEhHBUYEREMDQoLCAgHBwcGBgQGCREKBgQDAgECAQEBAQEBAQEBAQEBAQEBAgYIJPv7xWlCFAcEAwMCAgICAgICAgICAgICAgMDESAVCgQDAwMCAgUGEB/P/J9QKhMGBAIDBAYVJHxRQzIwNCQdHBkWEA4LCwkIBwcHBgYEBAUFCQoJCQkDAgECAQIBAQEBAgEBAQEBAQIBAwUavbewbFgoFAkHAwQEAgMEBAICBAMCAwMDAgQCDAwJBAMEBAICAwICAwIDAgoHAQIDAgECBQwOTWdWUDo+LSomHB8UEw8MEAoJCQkHBwYEBgUFEQwFAwICAQEBAgIBAgICAQEBAgEBAQECBAgS9v/hmkklDAQCAwMDAwIDAgMCAgIDAgECAwUOIRkQBgMCAgMCAgICAgEDBQoEAgECAwICBQYVcWFVPTY4LR4lHBoWDw4OCw4KCAgHBggIBQUIEggFAwICAgIBAQIBAQECAgIBAAAAAQABCBUshu+edVUYCgwFBgcIBwUHBQcFBgUGBAcEBgQHDwoIBwYGBQUFBAUEBQUGBwgFBQMEAwUDBwgRX1dAQTUwKSIbGBQVEg8PDAoJCgYIBgYGBgQMCQUEBAMCAgICAgICAgECAgICAgECAQMEDRX9/++pbDMaBwYEBAMDBAQEAwQDBAIEAgQDBQ4cEgsFBgQEAwIEBQ8aH8nbmU8zEAcCAgMECQxPa1I9RTAtJC0dHhYXDhENDgsJCAcICAUGBwIJCQwIBAMDAgMBAwIDAgMCAwIBAAECAQQIFTXYj2QsIBILBwYKCAQFCAcEBQcGBAQHBwQEBwwZEg0JBgUGBgYEBQYGBAQGCwMEAwMDAwQJDBVdYUc6My0lIR8XFxMQDg0MCQwMCQkMBggHBQMNBgUDAwICAgEBAgIBAQICAgEBAgIBAQEGDib1/MprQRYGBAMCAgMDAgECAgICAQICAgIDCA0ZGQoKCAQFBgYEBAQFBAYICAQDAgQDAwQGExtNU0U5MC0kGhgUGg4RCwoLBggIBwYGBgUDBAkJBQQEAwICAgICAgIBAQIDAQEBAQEBAwQLGt34+XZUJBUEBwcDBQQEDgoHBQMDAwMDAwMDAwwMCAYDBAMDAgMDAgMDCQkMCAQDAwICAwQLEmZiSzc5KSIeGxUWERMPEAwLCAgJBwYHBQQGBQ8MBQQCAgIBAQEBAQECCwcEBAICAQECAQUHFv//z5pJIgoDAgICAgIJCwYFBAICAgICAgIEDhsSDQcDAwMCAwIKCiO//7JgThsIBAQBAwUPGkhMOCwvMiEhHBoSFhMPDQoHBwYHBgQEBQgtXHp/kXhSHw0DAQMBAgISCggGAwICAgQBAQEBAAAAAAAAAAAAAAAAAAABAQgHAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}};
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

/* ============================================================ COMPONENTS
   Every visualizer consumes the same components. Shared behaviour:
   drag to change, Shift for fine, double-click to reset, arrows / PageUp /
   Home / End on focus, a dot next to the label when not at default, and
   onCommit fired once per gesture (that is what Undo records). */

function arcPath(cx,cy,r,a0,a1){
  const P=a=>[cx+r*Math.cos(a*Math.PI/180),cy+r*Math.sin(a*Math.PI/180)];
  const [x0,y0]=P(a0),[x1,y1]=P(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a1-a0)>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function keyStep(e,range,int){
  const f=e.shiftKey?0.001:0.01;
  switch(e.key){
    case 'ArrowUp': case 'ArrowRight': return int?1:range*f;
    case 'ArrowDown': case 'ArrowLeft': return int?-1:-range*f;
    case 'PageUp': return range*0.1; case 'PageDown': return -range*0.1;
  } return null;
}

/* ---------------- Knob: the primary instrument control ---------------- */
function Knob(o){
  const range=o.max-o.min, fmt=o.fmt||f2, def=o.def;
  let v=o.value, commitT=null;
  const root=h('div',{class:'knob','data-tip':o.hint});
  const dial=h('div',{class:'knob-dial',tabindex:0,role:'slider','aria-label':o.label,'aria-valuemin':o.min,'aria-valuemax':o.max});
  dial.innerHTML='<svg viewBox="0 0 100 100"><path class="k-track"/><path class="k-val"/><circle class="k-cap" cx="50" cy="50" r="29"/><line class="k-ind"/></svg>';
  const val=h('div',{class:'knob-val'}), lab=h('div',{class:'knob-lab'},o.label);
  root.append(dial,val,lab);
  const [pT,pV,,ind]=dial.querySelector('svg').children;
  pT.setAttribute('d',arcPath(50,50,44,135,405));
  const zeroA=135+270*clamp((0-o.min)/range,0,1), a0=(o.min<0&&o.max>0)?zeroA:135;
  function draw(){
    const a=135+270*(v-o.min)/range;
    pV.setAttribute('d',Math.abs(a-a0)<0.5?'':a>a0?arcPath(50,50,44,a0,a):arcPath(50,50,44,a,a0));
    const r=a*Math.PI/180; ind.setAttribute('x1',50+Math.cos(r)*13); ind.setAttribute('y1',50+Math.sin(r)*13);
    ind.setAttribute('x2',50+Math.cos(r)*25); ind.setAttribute('y2',50+Math.sin(r)*25);
    val.textContent=fmt(v); dial.setAttribute('aria-valuenow',v); dial.setAttribute('aria-valuetext',fmt(v));
    root.classList.toggle('changed',Math.abs(v-def)>1e-6);
  }
  function set(nv){ nv=clamp(nv,o.min,o.max); if(o.int) nv=Math.round(nv); if(nv===v) return; v=nv; draw(); o.onInput(v); }
  const commitSoon=()=>{ clearTimeout(commitT); commitT=setTimeout(()=>o.onCommit&&o.onCommit(v),350); };
  dial.addEventListener('pointerdown',e=>{
    if(e.button!==0) return; e.preventDefault(); dial.focus(); dial.setPointerCapture(e.pointerId);
    let sy=e.clientY, sx=e.clientX, sv=v, sh=e.shiftKey; const start=v; root.classList.add('active');
    const mv=ev=>{ if(ev.shiftKey!==sh){ sh=ev.shiftKey; sy=ev.clientY; sx=ev.clientX; sv=v; }
      const d=(sy-ev.clientY)+(ev.clientX-sx)*0.5; set(sv+d/220*range*(sh?0.12:1)); };
    const up=()=>{ dial.removeEventListener('pointermove',mv); root.classList.remove('active'); if(v!==start&&o.onCommit) o.onCommit(v); };
    dial.addEventListener('pointermove',mv); dial.addEventListener('pointerup',up,{once:true}); dial.addEventListener('pointercancel',up,{once:true});
  });
  dial.addEventListener('dblclick',()=>{ set(def); o.onCommit&&o.onCommit(v); });
  dial.addEventListener('keydown',e=>{
    if(e.key==='Home'||e.key==='End'){ e.preventDefault(); e.stopPropagation(); set(e.key==='Home'?o.min:o.max); commitSoon(); return; }
    const d=keyStep(e,range,o.int); if(d==null) return; e.preventDefault(); e.stopPropagation(); set(v+d); commitSoon();
  });
  dial.addEventListener('wheel',e=>{ if(document.activeElement!==dial) return; e.preventDefault(); set(v-Math.sign(e.deltaY)*range*(e.shiftKey?0.002:0.01)); commitSoon(); },{passive:false});
  draw();
  root.update=nv=>{ v=nv; draw(); };
  return root;
}

/* ---------------- Slider: compact, for Advanced ---------------- */
function Slider(o){
  const range=o.max-o.min, fmt=o.fmt||(o.int?(x=>String(Math.round(x))):f2), def=o.def, bip=o.min<0&&o.max>0;
  let v=o.value, commitT=null;
  const out=h('output'), fill=h('div',{class:'sl-fill'}), thumb=h('div',{class:'sl-thumb'});
  const track=h('div',{class:'sl-track',tabindex:0,role:'slider','aria-label':o.label,'aria-valuemin':o.min,'aria-valuemax':o.max},fill,thumb,bip?h('div',{class:'sl-zero',style:`left:${(0-o.min)/range*100}%`}):null);
  const root=h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{'data-tip':o.hint},o.label),out),track);
  const pct=x=>(x-o.min)/range*100;
  function draw(){ const p=pct(v), z=bip?pct(0):0; fill.style.left=Math.min(p,z)+'%'; fill.style.width=Math.abs(p-z)+'%'; thumb.style.left=p+'%';
    out.textContent=fmt(v); track.setAttribute('aria-valuenow',v); track.setAttribute('aria-valuetext',fmt(v)); root.classList.toggle('changed',Math.abs(v-def)>1e-6); }
  function set(nv){ nv=clamp(nv,o.min,o.max); if(o.int) nv=Math.round(nv); if(nv===v) return; v=nv; draw(); o.onInput(v); }
  const commitSoon=()=>{ clearTimeout(commitT); commitT=setTimeout(()=>o.onCommit&&o.onCommit(v),350); };
  track.addEventListener('pointerdown',e=>{
    if(e.button!==0) return; e.preventDefault(); track.focus(); track.setPointerCapture(e.pointerId); root.classList.add('active');
    const start=v, r=track.getBoundingClientRect(), at=ev=>o.min+clamp((ev.clientX-r.left)/r.width,0,1)*range;
    // grabbing the thumb keeps its offset; clicking the track jumps
    const onThumb=Math.abs(e.clientX-(r.left+pct(v)/100*r.width))<9; let off=onThumb?v-at(e):0, sx=e.clientX, sv=v;
    if(!onThumb) set(at(e));
    const mv=ev=>{ if(ev.shiftKey) set(sv+(ev.clientX-sx)/r.width*range*0.12); else { set(at(ev)+off); sx=ev.clientX; sv=v; } };
    const up=()=>{ track.removeEventListener('pointermove',mv); root.classList.remove('active'); if(v!==start&&o.onCommit) o.onCommit(v); };
    track.addEventListener('pointermove',mv); track.addEventListener('pointerup',up,{once:true}); track.addEventListener('pointercancel',up,{once:true});
  });
  track.addEventListener('dblclick',()=>{ set(def); o.onCommit&&o.onCommit(v); });
  root.querySelector('.sl-top span').addEventListener('dblclick',()=>{ set(def); o.onCommit&&o.onCommit(v); });
  track.addEventListener('keydown',e=>{
    if(e.key==='Home'||e.key==='End'){ e.preventDefault(); e.stopPropagation(); set(e.key==='Home'?o.min:o.max); commitSoon(); return; }
    const d=keyStep(e,range,o.int); if(d==null) return; e.preventDefault(); e.stopPropagation(); set(v+d); commitSoon();
  });
  draw(); root.update=nv=>{ v=nv; draw(); };
  return root;
}

function Seg(opts,value,onChange){
  const root=h('div',{class:'seg',role:'radiogroup'});
  const bs=opts.map(op=>h('button',{role:'radio','data-tip':op.hint,onclick:()=>{ if(value===op.v) return; value=op.v; sync(); onChange(op.v); }},op.dot?h('i',{class:'cdot',style:'background:'+op.dot}):null,op.label));
  root.append(...bs);
  const sync=()=>bs.forEach((b,i)=>b.setAttribute('aria-checked',opts[i].v===value));
  sync(); root.set=v=>{ value=v; sync(); }; root.buttons=bs;
  return root;
}
function Toggle(on,onChange,label){
  const b=h('button',{class:'tog',role:'switch','aria-checked':!!on,'aria-label':label});
  b.addEventListener('click',e=>{ e.stopPropagation(); on=!on; b.setAttribute('aria-checked',on); onChange(on); });
  b.set=x=>{ on=x; b.setAttribute('aria-checked',on); };
  return b;
}
function Section(title,{open=true,onReset,right}={},...body){
  const s=h('section',{class:'sec'+(open?' open':'')});
  const t=h('button',{class:'sec-t','aria-expanded':open,onclick:()=>{ s.classList.toggle('open'); t.setAttribute('aria-expanded',s.classList.contains('open')); }},h('span',{class:'chev',html:ICON.chev}),title);
  s.append(h('div',{class:'sec-h'},t,right||null,onReset?h('button',{class:'ico','data-tip':'Reset '+title.toLowerCase(),'aria-label':'Reset '+title,onclick:onReset,html:ICON.reset}):null),
    h('div',{class:'sec-b'},...body));
  return s;
}

/* ---------------- Tooltip (one element, any [data-tip]) ---------------- */
const Tip=(()=>{ const d=h('div',{class:'tip',role:'tooltip'}); document.body.append(d); let tmr=null, cur=null;
  function show(t){ const s=t.getAttribute('data-tip'); if(!s||!t.isConnected) return; d.textContent=s; d.classList.add('on');
    const r=t.getBoundingClientRect(), w=d.offsetWidth, hh=d.offsetHeight; let x=r.left+r.width/2-w/2, y=r.top-hh-8; if(y<6) y=r.bottom+8;
    d.style.transform=`translate(${clamp(x,8,innerWidth-w-8)}px,${y}px)`; }
  document.addEventListener('pointerover',e=>{ const t=e.target.closest&&e.target.closest('[data-tip]'); if(t===cur) return; cur=t; clearTimeout(tmr); d.classList.remove('on'); if(t) tmr=setTimeout(()=>show(t),520); });
  document.addEventListener('pointerdown',()=>{ clearTimeout(tmr); d.classList.remove('on'); },true);
  return {hide(){ clearTimeout(tmr); d.classList.remove('on'); }};
})();
function toast(msg){ const t=h('div',{class:'toast',role:'status'},msg); $('#toasts').append(t); setTimeout(()=>{ t.style.transition='opacity .3s'; t.style.opacity=0; setTimeout(()=>t.remove(),320); },3800); }

/* ---------------- Curve editor ---------------- */
function CurveEditor(curves,onInput,onCommit){
  const CH=[{v:'m',label:'RGB'},{v:'r',label:'Red',dot:'#e5484d'},{v:'g',label:'Green',dot:'#30a46c'},{v:'b',label:'Blue',dot:'#3e63dd'}];
  let ch='m', drag=-1, moved=false;
  const cv=h('canvas'), ctx=cv.getContext('2d');
  const seg=Seg(CH,ch,v=>{ ch=v; draw(); });
  const root=h('div',{class:'curve'},seg,cv,h('p',{class:'note'},'Click to add a point, drag to shape, double-click a point to remove it.'));
  const PAD=9;
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const col=c=>c==='m'?css('--ink'):CH.find(x=>x.v===c).dot;
  function size(){ const r=cv.getBoundingClientRect(), d=devicePixelRatio||1; if(cv.width!==Math.round(r.width*d)){ cv.width=Math.round(r.width*d); cv.height=Math.round(r.height*d); } return [cv.width,cv.height,d]; }
  const toPx=(p,w,hh)=>[PAD+p[0]*(w-2*PAD),hh-PAD-p[1]*(hh-2*PAD)];
  function draw(){
    if(!cv.isConnected) return;
    const [w,hh,d]=size(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,hh);
    const W=w/d, H=hh/d; ctx.scale(d,d);
    ctx.strokeStyle=css('--line'); ctx.lineWidth=1;
    for(let i=1;i<4;i++){ const x=PAD+i/4*(W-2*PAD), y=PAD+i/4*(H-2*PAD); ctx.beginPath(); ctx.moveTo(x,PAD); ctx.lineTo(x,H-PAD); ctx.moveTo(PAD,y); ctx.lineTo(W-PAD,y); ctx.stroke(); }
    ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(PAD,H-PAD); ctx.lineTo(W-PAD,PAD); ctx.stroke(); ctx.setLineDash([]);
    for(const c of ['r','g','b','m']){
      const f=curveFn(curves[c]), act=c===ch; if(!act&&curves[c].length===2&&curves[c][0][1]===0&&curves[c][1][1]===1) continue;
      ctx.strokeStyle=col(c); ctx.globalAlpha=act?1:0.3; ctx.lineWidth=act?2:1.25; ctx.beginPath();
      for(let i=0;i<=120;i++){ const x=i/120, [px,py]=toPx([x,f(x)],W,H); i?ctx.lineTo(px,py):ctx.moveTo(px,py); } ctx.stroke();
    }
    ctx.globalAlpha=1;
    for(const p of curves[ch]){ const [px,py]=toPx(p,W,H); ctx.beginPath(); ctx.arc(px,py,4.5,0,7); ctx.fillStyle=css('--surface'); ctx.fill(); ctx.lineWidth=1.75; ctx.strokeStyle=col(ch); ctx.stroke(); }
  }
  const at=e=>{ const r=cv.getBoundingClientRect(); return [clamp((e.clientX-r.left-PAD)/(r.width-2*PAD),0,1),clamp(1-(e.clientY-r.top-PAD)/(r.height-2*PAD),0,1),r]; };
  const near=(e)=>{ const [x,y,r]=at(e), pts=curves[ch]; let best=-1,bd=12; pts.forEach((p,i)=>{ const dx=(p[0]-x)*(r.width-2*PAD), dy=(p[1]-y)*(r.height-2*PAD), dd=Math.hypot(dx,dy); if(dd<bd){bd=dd;best=i;} }); return best; };
  cv.addEventListener('pointerdown',e=>{
    e.preventDefault(); cv.setPointerCapture(e.pointerId); moved=false;
    let i=near(e); const pts=curves[ch];
    if(i<0){ const [x]=at(e); const f=curveFn(pts); pts.push([x,f(x)]); pts.sort((a,b)=>a[0]-b[0]); i=pts.findIndex(p=>p[0]===x); moved=true; onInput(); draw(); }
    drag=i;
  });
  cv.addEventListener('pointermove',e=>{
    if(drag<0){ cv.style.cursor=near(e)>=0?'grab':'crosshair'; return; }
    const pts=curves[ch], [x,y]=at(e), last=pts.length-1;
    if(drag===0) pts[0]=[0,y]; else if(drag===last) pts[last]=[1,y];
    else pts[drag]=[clamp(x,pts[drag-1][0]+0.01,pts[drag+1][0]-0.01),y];
    moved=true; onInput(); draw();
  });
  const up=()=>{ if(drag>=0&&moved) onCommit(); drag=-1; };
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.addEventListener('dblclick',e=>{ const i=near(e), pts=curves[ch]; if(i>0&&i<pts.length-1){ pts.splice(i,1); onInput(); onCommit(); draw(); } });
  new ResizeObserver(draw).observe(cv);
  root.redraw=draw; root.channel=()=>ch;
  return root;
}

/* ---------------- Gradient map bar ---------------- */
function GradientBar(grad,onInput,onCommit){
  const bar=h('div',{class:'gbar','data-tip':'Click to add a colour stop'}), picker=h('input',{type:'color',class:'sr',tabindex:-1});
  const root=h('div',{style:'position:relative'},bar,picker);
  // the browser opens its colour chooser where the colour input is, so the (invisible) input is moved onto the stop being
  // edited first. Left under the bar it opened wherever the drawer had scrolled that spot to: often at the screen's bottom.
  const pickAt=(hd,st,onPick)=>{ const rr=root.getBoundingClientRect(), r=hd.getBoundingClientRect();
    picker.style.cssText=`left:${(r.left-rr.left).toFixed(1)}px;top:${(r.top-rr.top).toFixed(1)}px;width:${Math.max(1,r.width).toFixed(1)}px;height:${Math.max(1,r.height).toFixed(1)}px;clip:auto;opacity:0;pointer-events:none`;
    picker.value=st.c; picker.oninput=onPick; picker.onchange=()=>onCommit(); picker.click(); };
  function paint(){ const s=[...grad.stops].sort((a,b)=>a.p-b.p); bar.style.background=`linear-gradient(90deg,${s.map(x=>x.c+' '+(x.p*100).toFixed(1)+'%').join(',')})`; }
  function render(){ paint(); bar.querySelectorAll('.gstop').forEach(n=>n.remove());
    grad.stops.forEach(st=>{
      const hd=h('div',{class:'gstop',style:`left:${st.p*100}%;background:${st.c}`,tabindex:0,role:'button','aria-label':'Colour stop '+st.c,'data-tip':'Click for colour, drag to move, pull down to remove'});
      hd.addEventListener('pointerdown',e=>{ e.stopPropagation(); e.preventDefault(); hd.setPointerCapture(e.pointerId);
        const r=bar.getBoundingClientRect(), sx=e.clientX, sy=e.clientY; let moved=false, del=false;
        const mv=ev=>{ if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3) moved=true; if(!moved) return;
          st.p=clamp((ev.clientX-r.left)/r.width,0,1); hd.style.left=st.p*100+'%';
          del=grad.stops.length>2&&ev.clientY-r.bottom>34; hd.classList.toggle('del',del); paint(); onInput(); };
        const up=()=>{ hd.removeEventListener('pointermove',mv);
          if(!moved){ pickAt(hd,st,()=>{ st.c=picker.value; hd.style.background=st.c; paint(); onInput(); }); return; }
          if(del) grad.stops.splice(grad.stops.indexOf(st),1); render(); onInput(); onCommit(); };
        hd.addEventListener('pointermove',mv); hd.addEventListener('pointerup',up,{once:true}); });
      hd.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pickAt(hd,st,()=>{ st.c=picker.value; hd.style.background=st.c; paint(); onInput(); }); }
        if((e.key==='Delete'||e.key==='Backspace')&&grad.stops.length>2){ grad.stops.splice(grad.stops.indexOf(st),1); render(); onInput(); onCommit(); } });
      bar.append(hd);
    }); }
  bar.addEventListener('pointerdown',e=>{ if(e.target!==bar) return; const r=bar.getBoundingClientRect(), p=clamp((e.clientX-r.left)/r.width,0,1);
    grad.stops.push({p,c:rgb2hex(gradSample(grad.stops,p))}); render(); onInput(); onCommit(); });
  render(); root.render=render;
  return root;
}

/* ---------------- motion helpers borrowed from the web-effects set ---------------- */
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Text scramble: letters resolve left to right through glyphs */
function scramble(el,text,dur=560){
  if(!el) return; cancelAnimationFrame(el._scr);
  if(REDUCED){ el.textContent=text; return; }
  const G='#%&*+=<>/\\|[]{}?!01', th=[...text].map((c,i)=>i/text.length*0.6+Math.random()*0.4), t0=performance.now();
  const step=now=>{ const p=Math.min(1,(now-t0)/dur);
    el.textContent=[...text].map((c,i)=>c===' '||p>=th[i]?c:G[(Math.random()*G.length)|0]).join('');
    if(p<1) el._scr=requestAnimationFrame(step); };
  el._scr=requestAnimationFrame(step);
}
/* Magnetic: the control leans toward the pointer; its label leans a little further */
function magnetic(el,{pull=0.22,max=7}={}){
  if(REDUCED||el._mag) return; el._mag=true; el.classList.add('magnet');
  el.addEventListener('pointermove',e=>{ if(e.pointerType!=='mouse') return;
    const r=el.getBoundingClientRect(), dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
    const x=clamp(dx*pull,-max,max), y=clamp(dy*pull*1.6,-max,max); el.classList.add('pull');
    el.style.transform=`translate(${x}px,${y}px)`; for(const c of el.children) if(!c.classList.contains('bar')) c.style.transform=`translate(${x*0.5}px,${y*0.5}px)`; });
  el.addEventListener('pointerleave',()=>{ el.classList.remove('pull'); el.style.transform=''; for(const c of el.children) c.style.transform=''; });
}

/* ============================================================== BRANDING
   VYRAL does the art direction; the user supplies the words.

   ├── Content  (App.brand) ........ title / artist / custom text / logo. Global, so
   │                                 it follows you from one visualizer to the next.
   ├── Styles   (BRAND_STYLES[id]) . three compositions per visualizer. Each one fixes
   │                                 font, weight, size, tracking, case, alignment,
   │                                 position, colour role, opacity and how the type
   │                                 relates to the picture (blend, legibility, decor).
   ├── Overrides (vs.brand.o) ...... Customize: per element, per visualizer.
   ├── Motion ...................... Static / Fade / Pulse / Beat, read per style
   │                                 (Retro types in, Caustic decodes, Contour rises).
   └── BrandLayer .................. draws into a canvas the size of the composition (1080 x 1920,
                                     or 1920 x 1080 in 16:9). The post pipeline composites it
                                     INTO the picture before effects and grade, so type is lit,
                                     graded and inverted with it.

   Colour is never absolute: 'ink' / 'dim' / 'bg' come from the current look, so type
   stays readable when the look changes. Layout keeps to SAFE, the area platforms
   (Reels, TikTok, Shorts) leave clear of their own buttons and captions; in 16:9 it is
   the usual title-safe frame of a landscape video.                                   */

const SAFE_P={l:84, r:996, t:210, b:1500}, SAFE_L={l:120, r:1800, t:108, b:972}, SAFE_F={l:84, r:996, t:108, b:1242};   // F: 4:5 (1080 x 1350)
let BW=1080, BH=1920, SAFE=SAFE_P;   // the current composition (BrandLayer.setSize)

const BRAND_FONTS={
  plex:  {label:'IBM Plex Mono',   css:'"IBM Plex Mono",ui-monospace,Menlo,monospace',        weights:[400,500,600]},
  vt:    {label:'VT323',           css:'"VT323","IBM Plex Mono",ui-monospace,monospace',      weights:[400]},
  jet:   {label:'JetBrains Mono',  css:'"JetBrains Mono",ui-monospace,Menlo,monospace',       weights:[300,400,500,600]},
  grot:  {label:'Space Grotesk',   css:'"Space Grotesk",system-ui,sans-serif',                weights:[300,400,500,700]},
  wide:  {label:'Unbounded',       css:'Unbounded,"Arial Black",system-ui,sans-serif',        weights:[200,300,500,700]},
  geist: {label:'Geist',           css:'Geist,"Helvetica Neue",system-ui,sans-serif',         weights:[300,400,500,600]},
  anton: {label:'Anton',           css:'Anton,Impact,"Arial Narrow Bold","Arial Narrow",sans-serif', weights:[400]},
  tight: {label:'Inter Tight',     css:'"Inter Tight",system-ui,sans-serif',                  weights:[300,400,600,800]},
};

/* ---------------- layouts: five per visualizer, designed for its picture ----------------
   All four pictures hold their form in a band across the middle, so most layouts live in
   the empty top and bottom thirds. The ones that sit on the form do it on purpose (Dust /
   Cut uses a difference blend, so the dust cuts through the letters instead of hiding them).
   g: group (vertical anchor + stacking), o: order in the group. Horizontal position comes
   from alignment: left = safe left, center = middle, right = safe right.
   wrapW: measure the words wrap at; maxW: the width the block is shrunk or filled to.     */
const BRAND_STYLES={
  retro:[
    {id:'terminal',name:'Terminal',hint:'A terminal header: mono type, a prompt and a live cursor',leg:'none',
     groups:{a:{y:SAFE.t,v:'top',gap:18}},
     artist:{g:'a',o:1,font:'plex',w:500,size:30,case:'upper',track:.14,color:'dim'},
     title:{g:'a',o:2,font:'plex',w:600,size:58,case:'upper',track:.02,color:'ink',decor:'prompt',maxW:840,fit:'wrap'},
     custom:{g:'a',o:3,font:'plex',w:400,size:28,track:.04,color:'dim',prefix:'# '},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:76,treat:'mono'}},
    {id:'raster',name:'Raster',hint:'Big pixel type in the spirit of the character grid',
     groups:{a:{y:SAFE.b,v:'bottom',gap:14}},
     artist:{g:'a',o:1,font:'vt',w:400,size:64,case:'upper',track:.04,color:'dim'},
     title:{g:'a',o:2,font:'vt',w:400,size:176,case:'upper',track:0,lh:.84,color:'ink',maxW:912,fit:'shrink',minK:.42},
     custom:{g:'a',o:3,font:'vt',w:400,size:48,track:.04,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:92,treat:'mono'}},
    {id:'stack',name:'Stack',hint:'One word per line, pixel type filling the top of the frame',
     groups:{a:{y:SAFE.t,v:'top',gap:16},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'vt',w:400,size:230,case:'upper',lh:.8,color:'ink',wrapW:520,maxW:912,fit:'wrap',fill:true,minK:.3},
     artist:{g:'b',o:1,font:'plex',w:500,size:28,case:'upper',track:.2,color:'ink'},
     custom:{g:'b',o:2,font:'plex',w:400,size:24,track:.06,color:'dim'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:64,treat:'mono'}},
    {id:'status',name:'Status bar',hint:'A now-playing line across the bottom, title left and artist right',
     groups:{a:{y:SAFE.b,v:'bottom',gap:12},b:{y:SAFE.b,v:'bottom',gap:12}},
     custom:{g:'a',o:1,font:'plex',w:400,size:24,track:.08,color:'dim'},
     title:{g:'a',o:2,font:'plex',w:600,size:34,case:'upper',track:.1,color:'ink',prefix:'▶ ',maxW:560,fit:'wrap'},
     artist:{g:'b',o:1,font:'plex',w:400,size:34,case:'upper',track:.1,align:'right',color:'dim',maxW:340,fit:'shrink',minK:.5},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:64,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Small, widely spaced mono under the picture',
     groups:{a:{y:SAFE.b,v:'bottom',gap:18}},
     title:{g:'a',o:1,font:'plex',w:500,size:30,case:'upper',track:.3,align:'center',color:'ink',maxW:900,fit:'wrap'},
     artist:{g:'a',o:2,font:'plex',w:400,size:24,case:'upper',track:.3,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'plex',w:400,size:22,track:.2,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:64,treat:'mono',op:.9}},
  ],
  caustic:[
    {id:'tracker',name:'Tracker',hint:'The title becomes one of the tracked objects: framed, tagged, with a live readout',leg:'none',
     groups:{a:{y:SAFE.t,v:'top',gap:18}},
     title:{g:'a',o:1,font:'jet',w:600,size:50,case:'upper',track:.04,color:'ink',decor:'hud',maxW:780,fit:'wrap'},
     artist:{g:'a',o:2,font:'jet',w:400,size:28,case:'upper',track:.12,color:'dim'},
     custom:{g:'a',o:3,font:'jet',w:400,size:24,track:.06,color:'dim'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:72,treat:'mono'}},
    {id:'field',name:'Field',hint:'Light, large grotesk anchored under the ribbon',
     groups:{a:{y:SAFE.b,v:'bottom',gap:18}},
     artist:{g:'a',o:1,font:'jet',w:400,size:26,case:'upper',track:.16,color:'dim'},
     title:{g:'a',o:2,font:'grot',w:300,size:124,track:-.03,lh:.96,color:'ink',maxW:912,fit:'wrap'},
     custom:{g:'a',o:3,font:'jet',w:400,size:24,track:.08,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:72,treat:'mono'}},
    {id:'headline',name:'Headline',hint:'A heavy grotesk headline centred above the ribbon',
     groups:{a:{y:SAFE.t+10,v:'top',gap:20},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'grot',w:700,size:118,case:'upper',track:-.02,lh:.92,align:'center',color:'ink',maxW:912,fit:'wrap'},
     artist:{g:'a',o:2,font:'jet',w:500,size:26,case:'upper',track:.24,align:'center',color:'dim'},
     custom:{g:'b',o:1,font:'jet',w:400,size:24,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.b-60,align:'center',v:'bottom',h:60,treat:'mono'}},
    {id:'sheet',name:'Data sheet',hint:'Labelled lines, like the spec sheet of a sample',
     groups:{a:{y:SAFE.b,v:'bottom',gap:14}},
     title:{g:'a',o:1,font:'jet',w:600,size:40,case:'upper',track:.04,color:'ink',prefix:'TTL  ',maxW:912,fit:'wrap'},
     artist:{g:'a',o:2,font:'jet',w:400,size:30,case:'upper',track:.06,color:'ink',prefix:'ART  '},
     custom:{g:'a',o:3,font:'jet',w:400,size:30,track:.04,color:'dim',prefix:'SRC  '},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:64,treat:'mono'}},
    {id:'corners',name:'Corners',hint:'Metadata in the corners, like the readouts on an instrument',leg:'none',
     groups:{a:{y:SAFE.t,v:'top',gap:10},b:{y:SAFE.t,v:'top',gap:10},c:{y:SAFE.b,v:'bottom',gap:10}},
     artist:{g:'a',o:1,font:'jet',w:500,size:26,case:'upper',track:.18,color:'ink',maxW:420,fit:'wrap'},
     title:{g:'b',o:1,font:'jet',w:500,size:26,case:'upper',track:.18,align:'right',color:'ink',maxW:440,fit:'wrap'},
     custom:{g:'c',o:1,font:'jet',w:400,size:24,track:.12,color:'dim',maxW:620,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:56,treat:'mono'}},
  ],
  contour:[
    {id:'editorial',name:'Editorial',hint:'A light, wide title set under the cloth like a cover line',
     groups:{a:{y:SAFE.b,v:'bottom',gap:22}},
     artist:{g:'a',o:1,font:'geist',w:500,size:26,case:'upper',track:.22,color:'dim'},
     title:{g:'a',o:2,font:'wide',w:300,size:92,track:-.01,lh:1.02,color:'ink',maxW:912,fit:'wrap'},
     custom:{g:'a',o:3,font:'geist',w:400,size:30,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:64,treat:'mono'}},
    {id:'centred',name:'Centred',hint:'Centred above the cloth, with a hairline under the title',
     groups:{a:{y:SAFE.t+30,v:'top',gap:24}},
     artist:{g:'a',o:1,font:'geist',w:500,size:22,case:'upper',track:.34,align:'center',color:'dim'},
     title:{g:'a',o:2,font:'wide',w:200,size:78,case:'upper',track:.04,align:'center',color:'ink',maxW:880,fit:'wrap',decor:'rule'},
     custom:{g:'a',o:3,font:'geist',w:400,size:28,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.b,align:'center',v:'bottom',h:60,treat:'mono'}},
    {id:'split',name:'Split',hint:'Artist in the top corner, title set big across the bottom right',
     groups:{a:{y:SAFE.t,v:'top',gap:12},b:{y:SAFE.b,v:'bottom',gap:16}},
     artist:{g:'a',o:1,font:'geist',w:500,size:26,case:'upper',track:.24,color:'ink'},
     custom:{g:'a',o:2,font:'geist',w:400,size:24,track:.04,color:'dim'},
     title:{g:'b',o:1,font:'wide',w:500,size:110,case:'upper',track:-.02,lh:.95,align:'right',color:'ink',maxW:912,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:56,treat:'mono'}},
    {id:'band',name:'Band',hint:'Wide spaced caps filling a line across the top',
     groups:{a:{y:SAFE.t+20,v:'top',gap:22},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'wide',w:200,size:70,case:'upper',track:.22,align:'center',color:'ink',maxW:912,fit:'shrink',fill:true,minK:.35},
     artist:{g:'a',o:2,font:'geist',w:400,size:24,case:'upper',track:.4,align:'center',color:'dim'},
     custom:{g:'b',o:1,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.b-50,align:'center',v:'bottom',h:52,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Quiet, widely spaced caps under the picture',
     groups:{a:{y:SAFE.b,v:'bottom',gap:16}},
     title:{g:'a',o:1,font:'geist',w:500,size:28,case:'upper',track:.32,align:'center',color:'ink',maxW:900,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:400,size:22,case:'upper',track:.32,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:52,treat:'mono',op:.85}},
  ],
  spatial:[
    {id:'tracked',name:'Tracked',hint:'The title as one of the tracker’s locked tags, with a live readout',leg:'none',
     groups:{a:{y:SAFE.b,v:'bottom',gap:16}},
     artist:{g:'a',o:1,font:'jet',w:400,size:26,case:'upper',track:.16,color:'dim'},
     title:{g:'a',o:2,font:'jet',w:600,size:46,case:'upper',track:.06,color:'ink',decor:'hud',maxW:780,fit:'wrap'},
     custom:{g:'a',o:3,font:'jet',w:400,size:24,track:.06,color:'dim'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:64,treat:'mono'}},
    {id:'film',name:'Film',hint:'Light, large type under the field, like a title card',
     groups:{a:{y:SAFE.b,v:'bottom',gap:20}},
     artist:{g:'a',o:1,font:'geist',w:500,size:26,case:'upper',track:.28,color:'dim'},
     title:{g:'a',o:2,font:'tight',w:300,size:112,track:-.02,lh:.98,color:'ink',maxW:912,fit:'wrap'},
     custom:{g:'a',o:3,font:'geist',w:400,size:26,track:.04,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:64,treat:'mono'}},
    {id:'headline',name:'Headline',hint:'Wide caps centred above the field',
     groups:{a:{y:SAFE.t+10,v:'top',gap:20},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'wide',w:500,size:84,case:'upper',track:-.01,lh:.96,align:'center',color:'ink',maxW:912,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:500,size:24,case:'upper',track:.3,align:'center',color:'dim'},
     custom:{g:'b',o:1,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.b-50,align:'center',v:'bottom',h:56,treat:'mono'}},
    {id:'coords',name:'Coordinates',hint:'Small readouts pinned to opposite corners',leg:'none',
     groups:{a:{y:SAFE.t,v:'top',gap:10},b:{y:SAFE.b,v:'bottom',gap:10}},
     artist:{g:'a',o:1,font:'jet',w:500,size:26,case:'upper',track:.18,color:'ink',maxW:520,fit:'wrap'},
     custom:{g:'a',o:2,font:'jet',w:400,size:22,track:.08,color:'dim'},
     title:{g:'b',o:1,font:'jet',w:600,size:34,case:'upper',track:.12,align:'right',color:'ink',maxW:640,fit:'wrap'},
     logo:{x:SAFE.l,y:SAFE.b,align:'left',v:'bottom',h:56,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Quiet, widely spaced caps under the picture',
     groups:{a:{y:SAFE.b,v:'bottom',gap:16}},
     title:{g:'a',o:1,font:'geist',w:500,size:28,case:'upper',track:.34,align:'center',color:'ink',maxW:900,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:400,size:22,case:'upper',track:.34,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:52,treat:'mono'}},
  ],
  volume:[
    {id:'specimen',name:'Specimen',hint:'Set like a specimen plate: title top left, a small caption under it',
     groups:{a:{y:SAFE.t,v:'top',gap:18},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'wide',w:500,size:72,case:'upper',track:-.01,lh:1,color:'ink',maxW:800,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:500,size:24,case:'upper',track:.26,color:'dim'},
     custom:{g:'b',o:1,font:'jet',w:400,size:22,track:.08,color:'dim'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:60,treat:'mono'}},
    {id:'heavy',name:'Heavy',hint:'Chunky wide caps filling the bottom of the frame',
     groups:{a:{y:SAFE.b,v:'bottom',gap:18}},
     artist:{g:'a',o:1,font:'geist',w:600,size:28,case:'upper',track:.24,color:'ink'},
     title:{g:'a',o:2,font:'wide',w:700,size:120,case:'upper',track:-.03,lh:.92,color:'ink',wrapW:760,maxW:912,fit:'wrap',fill:true,minK:.3},
     custom:{g:'a',o:3,font:'geist',w:400,size:24,track:.08,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:72,treat:'mono'}},
    {id:'centred',name:'Centred',hint:'Light, widely spaced title centred above the object',
     groups:{a:{y:SAFE.t+20,v:'top',gap:22},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'tight',w:300,size:64,case:'upper',track:.24,align:'center',color:'ink',maxW:960,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:400,size:24,case:'upper',track:.4,align:'center',color:'dim'},
     custom:{g:'b',o:1,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.b-50,align:'center',v:'bottom',h:56,treat:'mono'}},
    {id:'label',name:'Label',hint:'A small labelled data block, like the tag on an object in a collection',
     groups:{a:{y:SAFE.b,v:'bottom',gap:12}},
     title:{g:'a',o:1,font:'jet',w:600,size:36,case:'upper',track:.04,color:'ink',prefix:'OBJ  ',maxW:912,fit:'wrap'},
     artist:{g:'a',o:2,font:'jet',w:400,size:28,case:'upper',track:.06,color:'ink',prefix:'BY   '},
     custom:{g:'a',o:3,font:'jet',w:400,size:28,track:.04,color:'dim',prefix:'REF  '},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:60,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Quiet, widely spaced caps under the picture',
     groups:{a:{y:SAFE.b,v:'bottom',gap:16}},
     title:{g:'a',o:1,font:'geist',w:500,size:28,case:'upper',track:.34,align:'center',color:'ink',maxW:900,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:400,size:22,case:'upper',track:.34,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:52,treat:'mono'}},
  ],
  dust:[
    {id:'bold',name:'Bold',hint:'Condensed type at full width, set under the dust',
     groups:{a:{y:SAFE.b,v:'bottom',gap:18}},
     artist:{g:'a',o:1,font:'tight',w:600,size:30,case:'upper',track:.22,color:'ink'},
     title:{g:'a',o:2,font:'anton',w:400,size:210,case:'upper',track:.005,lh:.9,color:'ink',maxW:912,fit:'shrink',fill:true,minK:.34},
     custom:{g:'a',o:3,font:'tight',w:400,size:26,track:.1,color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:80,treat:'mono'}},
    {id:'cut',name:'Cut',hint:'Huge type across the middle. The dust cuts through it and flips its colour',blend:true,leg:'none',
     groups:{a:{y:960,v:'middle',gap:0},t:{y:SAFE.t,v:'top',gap:10},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'anton',w:400,size:300,case:'upper',lh:.86,align:'center',color:'white',maxW:1000,fit:'wrap',fill:true,minK:.3},
     artist:{g:'t',o:1,font:'tight',w:600,size:30,case:'upper',track:.22,color:'white'},
     custom:{g:'b',o:1,font:'tight',w:400,size:26,track:.1,color:'white'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:72,treat:'white'}},
    {id:'poster',name:'Poster',hint:'Stacked words at full width over the top of the frame',
     groups:{a:{y:SAFE.t,v:'top',gap:18},b:{y:SAFE.b,v:'bottom',gap:10}},
     title:{g:'a',o:1,font:'anton',w:400,size:240,case:'upper',lh:.88,color:'ink',wrapW:560,maxW:912,fit:'wrap',fill:true,minK:.3},
     artist:{g:'a',o:2,font:'tight',w:600,size:28,case:'upper',track:.26,color:'ink'},
     custom:{g:'b',o:1,font:'tight',w:400,size:24,track:.1,color:'dim'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:64,treat:'mono'}},
    {id:'credits',name:'Credits',hint:'Film-credit style: a presenter line, then the title, spaced out',
     groups:{a:{y:1290,v:'top',gap:26},b:{y:SAFE.b,v:'bottom',gap:10}},
     artist:{g:'a',o:1,font:'tight',w:400,size:24,case:'upper',track:.42,align:'center',color:'dim',suffix:' presents'},
     title:{g:'a',o:2,font:'tight',w:300,size:66,case:'upper',track:.3,align:'center',color:'ink',maxW:960,fit:'wrap'},
     custom:{g:'b',o:1,font:'tight',w:400,size:22,track:.2,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:60,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Light type, widely spaced, centred under the picture',
     groups:{a:{y:SAFE.b,v:'bottom',gap:18}},
     title:{g:'a',o:1,font:'tight',w:300,size:40,case:'upper',track:.42,align:'center',color:'ink',maxW:960,fit:'wrap'},
     artist:{g:'a',o:2,font:'tight',w:400,size:24,case:'upper',track:.42,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'tight',w:300,size:22,track:.2,align:'center',color:'dim'},
     logo:{x:540,y:SAFE.t,align:'center',v:'top',h:56,treat:'mono'}},
  ],
  // the dancer fills the frame from head to feet, the face in the top third: words go into a corner, or set big over
  // the legs at the foot of the frame; never across the face
  dancer:[
    {id:'credit',name:'Credit',hint:'A music-video credit in the lower corner, beside the dancer',
     groups:{a:{y:SAFE.b,v:'bottom',gap:6}},
     artist:{g:'a',o:1,font:'tight',w:600,size:36,lh:1.06,color:'ink',maxW:420,fit:'wrap'},
     title:{g:'a',o:2,font:'tight',w:400,size:36,lh:1.06,color:'ink',prefix:'“',suffix:'”',maxW:420,fit:'wrap'},
     custom:{g:'a',o:3,font:'tight',w:400,size:26,lh:1.1,color:'dim',maxW:420,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:64,treat:'mono'}},
    {id:'cover',name:'Cover',hint:'A game-cover title, set big across the foot of the frame',
     groups:{a:{y:SAFE.b,v:'bottom',gap:12},b:{y:SAFE.t,v:'top',gap:8}},
     artist:{g:'a',o:1,font:'geist',w:600,size:26,case:'upper',track:.3,color:'ink'},
     title:{g:'a',o:2,font:'wide',w:700,size:100,case:'upper',track:-.02,lh:.92,color:'ink',maxW:912,fit:'shrink',minK:.36},
     custom:{g:'b',o:1,font:'geist',w:500,size:24,case:'upper',track:.18,color:'dim',maxW:380,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:60,treat:'mono'}},
    {id:'select',name:'Select',hint:'A character-select screen: the name in pixel type under the dancer',
     groups:{a:{y:SAFE.b,v:'bottom',gap:4},b:{y:SAFE.t,v:'top',gap:6}},
     artist:{g:'a',o:1,font:'vt',w:400,size:52,case:'upper',track:.04,color:'ink',prefix:'P1  '},
     title:{g:'a',o:2,font:'vt',w:400,size:150,case:'upper',lh:.82,color:'ink',maxW:912,fit:'shrink',minK:.4},
     custom:{g:'b',o:1,font:'vt',w:400,size:46,case:'upper',track:.04,color:'ink',prefix:'> ',maxW:380,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.t,align:'right',v:'top',h:64,treat:'mono'}},
    {id:'tag',name:'Tag',hint:'Small readouts in the top corners, like the name tags in a fighting game',
     groups:{a:{y:SAFE.t,v:'top',gap:8},b:{y:SAFE.t,v:'top',gap:8}},
     title:{g:'a',o:1,font:'jet',w:600,size:34,case:'upper',track:.1,color:'ink',maxW:360,fit:'wrap'},
     artist:{g:'a',o:2,font:'jet',w:400,size:24,case:'upper',track:.18,color:'dim'},
     custom:{g:'b',o:1,font:'jet',w:400,size:22,case:'upper',track:.14,align:'right',color:'dim',maxW:300,fit:'wrap'},
     logo:{x:SAFE.r,y:SAFE.b,align:'right',v:'bottom',h:56,treat:'mono'}},
    {id:'minimal',name:'Minimal',hint:'Quiet, widely spaced caps at the dancer’s feet',
     groups:{a:{y:SAFE.b,v:'bottom',gap:14}},
     title:{g:'a',o:1,font:'geist',w:500,size:28,case:'upper',track:.34,align:'center',color:'ink',maxW:900,fit:'wrap'},
     artist:{g:'a',o:2,font:'geist',w:400,size:22,case:'upper',track:.34,align:'center',color:'dim'},
     custom:{g:'a',o:3,font:'geist',w:400,size:22,track:.1,align:'center',color:'dim'},
     logo:{x:SAFE.l,y:SAFE.t,align:'left',v:'top',h:52,treat:'mono'}},
  ],
};
const BRAND_ROLES=['logo','title','artist','custom'];
const ROLE_LABEL={logo:'Logo',title:'Title',artist:'Artist',custom:'Text'};
const LOGO_TREATS=[{v:'orig',label:'Original'},{v:'mono',label:'Mono',hint:'One colour that follows the look'},{v:'white',label:'White'},{v:'black',label:'Black'},{v:'mark',label:'Watermark',hint:'Mono at low opacity'}];
const MOTIONS=[{v:'static',label:'Static'},{v:'fade',label:'Fade',hint:'Comes in at the start and leaves at the end, in this visualizer’s way'},{v:'pulse',label:'Pulse',hint:'Breathes with the low end'},{v:'beat',label:'Beat',hint:'Flashes on the hits'}];
/* 16:9: the same layouts, set again for a wide frame. Anchors move with the frame (the top and bottom safe lines,
   the middle, the side margins); measures widen, so words that wrapped in 9:16 can run on one line; display type
   comes down so the shorter bands above and below the picture still hold it. Small type keeps its size (both
   formats are 1080 px on their short side). */
const mapPts=(v,A,B)=>{ for(let i=1;i<A.length;i++) if(v<=A[i]||i===A.length-1) return B[i-1]+(B[i]-B[i-1])*(v-A[i-1])/(A[i]-A[i-1]); return v; };
const LAND_Y=[[0,SAFE_P.t,960,SAFE_P.b,1920],[0,SAFE_L.t,540,SAFE_L.b,1080]], LAND_X=[[0,SAFE_P.l,540,SAFE_P.r,1080],[0,SAFE_L.l,960,SAFE_L.r,1920]];
function landEl(e){ const o={...e};
  if(o.size) o.size=Math.round(o.size*(o.size<=40?1:Math.max(.6,1-(o.size-40)/420)));
  if(o.maxW) o.maxW=Math.min(SAFE_L.r-SAFE_L.l,Math.round(o.maxW*1.6));
  if(o.wrapW) o.wrapW=Math.round(o.wrapW*1.9);
  if(o.h) o.h=Math.round(o.h*.9);
  if(o.x!=null) o.x=Math.round(mapPts(o.x,...LAND_X));
  if(o.y!=null) o.y=Math.round(mapPts(o.y,...LAND_Y));
  return o; }
function landStyle(st){ const o={...st,groups:{}};
  for(const [g,G] of Object.entries(st.groups)) o.groups[g]={...G,y:Math.round(mapPts(G.y,...LAND_Y)),gap:Math.round(G.gap*.85)};
  for(const r of BRAND_ROLES) if(st[r]) o[r]=landEl(st[r]);
  return o; }
const BRAND_STYLES_L={};
const brandStyles=id=>{ const P=BRAND_STYLES[id]||BRAND_STYLES.retro; if(App.aspect!=='16:9') return P;
  return BRAND_STYLES_L[id]||(BRAND_STYLES_L[id]=P.map(landStyle)); };
function newBrandState(id){ return { style:brandStyles(id)[0].id, motion:'static', leg:null, late:false, os:{} }; }
/* per-element overrides, kept per layout so a nudge made for one composition doesn't leak into another, and per
   format: a position or size belongs to its frame (9:16 or 16:9), so each format keeps its own */
const FMT_KEY=()=>App.aspect==='16:9'?'|16:9':'';
const bso=(bs,style)=>{ const k=(style||bs.style)+FMT_KEY(); if(!bs.os) bs.os={}; return bs.os[k]||(bs.os[k]={logo:{},title:{},artist:{},custom:{}}); };
/* type choices (font, weight, case, alignment, colour, opacity, logo treatment) are not geometry: they come along
   when the format changes, so a title styled in 9:16 keeps its style in 16:9 while each keeps its own place and size */
const BRAND_GEO=['dx','dy','scale'];
function brandFormatSync(from,to){
  const fk=from==='16:9'?'|16:9':'', tk=to==='16:9'?'|16:9':'';
  for(const vs of Object.values(App.vs)){ const os=vs.brand&&vs.brand.os; if(!os) continue;
    for(const k of Object.keys(os)){ if(fk?!k.endsWith(fk):k.endsWith('|16:9')) continue;
      const base=fk?k.slice(0,-fk.length):k, src=os[k], dst=os[base+tk]||(os[base+tk]={logo:{},title:{},artist:{},custom:{}});
      for(const r of BRAND_ROLES){ const s=src[r]||{}, d=dst[r]||(dst[r]={});
        for(const p of Object.keys(d)) if(!BRAND_GEO.includes(p)) delete d[p];
        for(const [p,v] of Object.entries(s)) if(!BRAND_GEO.includes(p)&&v!==undefined) d[p]=v; } } } }
const brandOf=vs=>vs.brand||(vs.brand=newBrandState(App.vid));
const curStyle=(id,bs)=>brandStyles(id).find(s=>s.id===bs.style)||brandStyles(id)[0];

/* ---------------- colour ---------------- */
const mixHex=(a,b,t)=>rgb2hex(hex2rgb(a).map((v,i)=>v+(hex2rgb(b)[i]-v)*t));
function lookColors(id,vs){ const E=ENG[id], L=E.looks.find(l=>l.k===vs.look)||E.looks[0];
  return {bg:L.bg, ink:L.fg, dim:mixHex(L.fg,L.bg,.42), accent:L.g}; }
function roleColor(c,C){ const P=BrandPreset.get()||{};
  return c==='ink'?C.ink:c==='dim'?C.dim:c==='bg'?C.bg:c==='white'?'#ffffff':c==='black'?'#0b0b0b':c==='p1'?(P.p1||C.ink):c==='p2'?(P.p2||C.dim):(c&&c[0]==='#'?c:C.ink); }

/* ---------------- content helpers ---------------- */
/* "prodbyflames - Midnight Drive (prod. X) [140 BPM] FINAL.wav" -> {artist:'prodbyflames', title:'Midnight Drive'} */
function parseTrackName(name){
  let s=(name||'').replace(/\.[a-z0-9]{2,5}$/i,'').replace(/_+/g,' ');
  s=s.replace(/[\(\[][^\)\]]*[\)\]]/g,' ')
     .replace(/\b(prod(uced)?\.?\s*(by)?\s+\S+).*$/i,' ')
     .replace(/\b\d{2,3}\s*bpm\b/ig,' ')
     .replace(/\b(final|master(ed)?|mixdown|bounce|export|untitled|v\d+)\b/ig,' ')
     .replace(/\s{2,}/g,' ').trim().replace(/[\s\-–—]+$/,'');
  const m=s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m?{artist:m[1].trim(),title:m[2].trim()}:{artist:'',title:s||(name||'').replace(/\.[^.]+$/,'')};
}
function autoText(role){
  const P=BrandPreset.get()||{}, T=AudioEngine.user?parseTrackName(AudioEngine.name):{title:'',artist:''};
  if(role==='title') return T.title||'Track title';
  if(role==='artist') return P.artist||T.artist||'Artist name';
  return P.handle||'@yourhandle';
}

/* ---------------- logos: a mask is derived so any logo can go mono ---------------- */
const Logos={};
function prepLogo(img,name,dataURL){
  let w=img.naturalWidth||img.width||512, h=img.naturalHeight||img.height||512; const k=Math.min(1,1024/Math.max(w,h)); w=Math.max(1,Math.round(w*k)); h=Math.max(1,Math.round(h*k));
  const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d',{willReadFrequently:true}); x.drawImage(img,0,0,w,h);
  const d=x.getImageData(0,0,w,h), p=d.data, n=w*h;
  let clear=0; for(let i=3;i<p.length;i+=4) if(p[i]<250) clear++;
  const A=new Uint8ClampedArray(n);
  if(clear>n*0.02){ for(let i=0;i<n;i++) A[i]=p[i*4+3]; }
  else{ // opaque artwork (JPG on a plain ground): the ground is whatever the corners agree on
    let r=0,g=0,b=0,c2=0; const s=Math.max(2,Math.round(Math.min(w,h)*0.03));
    for(const [cx,cy] of [[0,0],[w-s,0],[0,h-s],[w-s,h-s]]) for(let yy=cy;yy<cy+s;yy++) for(let xx=cx;xx<cx+s;xx++){ const o=(yy*w+xx)*4; r+=p[o]; g+=p[o+1]; b+=p[o+2]; c2++; }
    r/=c2; g/=c2; b/=c2;
    for(let i=0;i<n;i++){ const o=i*4, dd=Math.hypot(p[o]-r,p[o+1]-g,p[o+2]-b)/441.7; A[i]=Math.round(clamp((dd-0.06)/0.22,0,1)*255); }
  }
  // trim to the artwork
  let x0=w,y0=h,x1=-1,y1=-1; for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++) if(A[yy*w+xx]>12){ if(xx<x0)x0=xx; if(xx>x1)x1=xx; if(yy<y0)y0=yy; if(yy>y1)y1=yy; }
  if(x1<0){ x0=0;y0=0;x1=w-1;y1=h-1; }
  const tw=x1-x0+1, th=y1-y0+1;
  const orig=document.createElement('canvas'); orig.width=tw; orig.height=th; const ox=orig.getContext('2d');
  // opaque artwork keeps its colours but loses its ground
  const od=x.getImageData(x0,y0,tw,th); for(let yy=0;yy<th;yy++) for(let xx=0;xx<tw;xx++) od.data[(yy*tw+xx)*4+3]=Math.min(od.data[(yy*tw+xx)*4+3],A[(yy+y0)*w+xx+x0]);
  ox.putImageData(od,0,0);
  const mask=document.createElement('canvas'); mask.width=tw; mask.height=th; const mx=mask.getContext('2d'), md=mx.createImageData(tw,th);
  for(let yy=0;yy<th;yy++) for(let xx=0;xx<tw;xx++){ const o=(yy*tw+xx)*4; md.data[o]=md.data[o+1]=md.data[o+2]=255; md.data[o+3]=A[(yy+y0)*w+xx+x0]; }
  mx.putImageData(md,0,0);
  const id='L'+Math.random().toString(36).slice(2,9);
  Logos[id]={id,name,orig,mask,aspect:tw/th,tint:{},dataURL:dataURL||orig.toDataURL('image/png')};
  return id;
}
function loadImage(src){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; }); }
async function importLogoFile(f){
  if(!/^image\//.test(f.type)&&!/\.(png|jpe?g|svg|webp|gif)$/i.test(f.name)) throw new Error('type');
  const url=URL.createObjectURL(f);
  try{ const img=await loadImage(url); if(!img.naturalWidth){ img.width=512; img.height=512; } return prepLogo(img,f.name); }
  finally{ URL.revokeObjectURL(url); }
}
async function importLogoData(dataURL,name){ const img=await loadImage(dataURL); return prepLogo(img,name,dataURL); }
const LOGO_TINTS=12;   // tinted copies kept per logo, least recently used out first (dragging the colour picker would otherwise keep one per colour)
function logoArt(L,treat,color){
  if(treat==='orig') return L.orig;
  const key=treat+color, T=L.tint; let c=T[key];
  if(c){ delete T[key]; T[key]=c; return c; }   // most recently used moves to the end
  c=document.createElement('canvas'); c.width=L.mask.width; c.height=L.mask.height; const x=c.getContext('2d');
  x.drawImage(L.mask,0,0); x.globalCompositeOperation='source-in'; x.fillStyle=color; x.fillRect(0,0,c.width,c.height);
  T[key]=c; const keys=Object.keys(T); if(keys.length>LOGO_TINTS) delete T[keys[0]];
  return c;
}

/* ---------------- My brand: kept in this browser ---------------- */
const BrandPreset={ _c:undefined,
  get(){ if(this._c!==undefined) return this._c; try{ this._c=JSON.parse(localStorage.getItem('hive.brand.v1')||'null'); }catch(e){ this._c=null; } return this._c; },
  set(p){ this._c=p; try{ p?localStorage.setItem('hive.brand.v1',JSON.stringify(p)):localStorage.removeItem('hive.brand.v1'); }catch(e){ toast('This browser won’t keep your brand between sessions, but it’s saved for now.'); } },
};

/* ---------------- audio features for motion (100 frames / s, computed once per track) ---------------- */
const brandFeatCache=new WeakMap();
function brandFeatures(pcm,sr){
  let F=brandFeatCache.get(pcm); if(F) return F;
  const hop=Math.max(1,Math.round(sr/100)), n=Math.floor(pcm.length/hop), rms=new Float32Array(n), low=new Float32Array(n);
  const a=1-Math.exp(-2*Math.PI*140/sr); let lp=0;
  for(let f=0,j=0;f<n;f++){ let s=0,sl=0; for(let i=0;i<hop;i++,j++){ const v=pcm[j]; lp+=a*(v-lp); s+=v*v; sl+=lp*lp; } rms[f]=Math.sqrt(s/hop); low[f]=Math.sqrt(sl/hop); }
  const pct=(arr,q)=>{ const c=Float32Array.from(arr).sort(); return c[Math.floor(q*(c.length-1))]||1e-6; };
  const rN=pct(rms,.98)||1e-6, lN=pct(low,.98)||1e-6;
  const pulse=new Float32Array(n), hit=new Float32Array(n), on=new Float32Array(n);
  let e=0, h=0, avg=0;
  for(let f=0;f<n;f++){ const L=Math.min(1,low[f]/lN), R=Math.min(1,rms[f]/rN);
    e+=(L-e)*(L>e?0.5:0.08); pulse[f]=e;                       // fast rise, ~120 ms fall
    on[f]=Math.max(0,L-avg)+0.5*Math.max(0,R-avg*0.9); avg+=(0.6*L+0.4*R-avg)*0.12; }
  const oN=pct(on,.985)||1e-6;
  for(let f=0;f<n;f++){ h=Math.max(Math.min(1,on[f]/oN),h*Math.exp(-0.01/0.16)); hit[f]=h; }
  brandFeatCache.set(pcm,F={pulse,hit,n});
  return F;
}

/* ================================================================ LAYER */
const HAS_LS='letterSpacing' in CanvasRenderingContext2D.prototype;
const BrandLayer={
  canvas:null, ctx:null, boxes:[], key:'', dirty:true, on:false, blend:false, late:false, fontsVer:0,
  init(){ this.canvas=document.createElement('canvas'); this.canvas.width=BW; this.canvas.height=BH; this.ctx=this.canvas.getContext('2d'); },
  /* the composition changed format: the layer takes the new frame; layouts, safe area and positions follow it */
  setSize(w,h){ if(BW===w&&BH===h&&this.canvas.width===w) return; BW=w; BH=h; SAFE=w>h?SAFE_L:h<w*1.5?SAFE_F:SAFE_P;
    this.canvas.width=w; this.canvas.height=h; this.key=''; this.dirty=true; this.boxes=[]; LayoutStrip.key=''; },
  has(){ const B=App.brand; return !!(B.logo||['title','artist','custom'].some(r=>B[r]&&B[r].text.trim())); },
  /* env: {t, playing, from, until} */
  redrawNow(){ this.key=''; if(App.vid) this.update(App.vid,vsOf(App.vid),this.env||{t:0,playing:false,from:0,until:1}); },
  update(id,vs,env){
    this.env=env;
    if(ENG[id]&&ENG[id].noBrand){ this.on=false; this.boxes=[]; this.dirty=false; return; }   // MIDI / Score: its own words, no Branding layer
    const bs=brandOf(vs), peek=App.brandPeek&&brandStyles(id).find(q=>q.id===App.brandPeek), st=peek||curStyle(id,bs);
    const has=this.has(), content=has?App.brand:peek?sampleContent():null;   // hovering a layout with nothing added shows it with sample words
    this.on=!!content; this.blend=!!st.blend; this.late=!!bs.late;
    if(!this.on){ if(this.boxes.length){ this.boxes=[]; } this.dirty=false; return; }
    const anim=this.animKey(st,bs,env);
    const key=JSON.stringify([id,content,st.id,bs,vs.look,this.fontsVer,anim,!!(BrandPreset.get()||{}).font,BW]);
    if(key===this.key) return;   // dirty stays set until the pipeline has uploaded the canvas
    this.key=key; this.dirty=true; this.draw(id,vs,bs,st,env,{content});
  },
  animKey(st,bs,env){
    const parts=[];
    if(env.playing&&bs.motion!=='static') parts.push(Math.round(env.t*60));
    if(st.title&&st.title.decor==='prompt') parts.push(Math.floor(performance.now()/560)%2, env.playing&&bs.motion==='beat'?Math.round(env.t*30):0);
    if(st.title&&st.title.decor==='hud') parts.push(Math.floor(env.t*25));
    return parts;
  },
  spec(role,st,bs){
    const base=st[role]; if(!base) return null;
    const ov=bso(bs,st.id)[role]||{}, P=BrandPreset.get()||{};
    const s={lh:1.1,align:'left',track:0,op:1,case:'none',italic:false,...base};
    if(role==='logo'){ s.treat=ov.treat||'auto'; if(s.treat==='auto') s.treat=base.treat||'mono'; s.h*=ov.scale??1; s.op=(ov.op??s.op??1)*(s.treat==='mark'?0.22:1); s.dx=ov.dx||0; s.dy=ov.dy||0; s.color=ov.color||'ink'; return s; }
    if(ov.font&&BRAND_FONTS[ov.font]){ s.font=ov.font; } else if(role==='title'&&P.font&&BRAND_FONTS[P.font]){ s.font=P.font; s.italic=false; }
    const W=BRAND_FONTS[s.font].weights; const wantW=ov.w||s.w; s.w=W.reduce((a,b)=>Math.abs(b-wantW)<Math.abs(a-wantW)?b:a,W[0]);
    s.k=clamp(ov.scale??1,0.2,5); if(ov.track!=null) s.track+=ov.track; if(ov.case) s.case=ov.case; if(ov.align) s.align=ov.align;
    if(ov.color) s.color=ov.color; if(ov.op!=null) s.op=ov.op; s.dx=ov.dx||0; s.dy=ov.dy||0;
    return s;
  },
  font(s,size){ return `${s.italic?'italic ':''}${s.w} ${size.toFixed(1)}px ${BRAND_FONTS[s.font].css}`; },
  setType(x,s,size){ x.font=this.font(s,size); if(HAS_LS) x.letterSpacing=(s.track*size).toFixed(2)+'px'; },
  width(x,str,s,size){ if(!str) return 0;
    if(HAS_LS) return x.measureText(str).width-s.track*size;
    let w=0; for(const ch of str) w+=x.measureText(ch).width+s.track*size; return w-s.track*size; },
  fill(x,str,x0,y,s,size){ if(HAS_LS){ x.fillText(str,x0,y); return; } let xx=x0; for(const ch of str){ x.fillText(ch,xx,y); xx+=x.measureText(ch).width+s.track*size; } },
  /* text -> lines at a size that fits: shrink (one line), wrap (words), fill (grow to the measure) */
  layout(x,s,text){
    let size=s.size; const raw=text+(s.suffix||''), tx=s.case==='upper'?raw.toLocaleUpperCase():raw, pre=s.decor==='prompt'?'> ':(s.prefix||'');
    this.setType(x,s,size);
    const preW=pre?this.width(x,pre,s,size)+(HAS_LS?s.track*size:0):0, maxW=(s.maxW||900)-preW;
    let lines=[tx];
    const wid=L=>Math.max(...L.map(l=>this.width(x,l,s,size)));
    const wrapW=Math.min(maxW,(s.wrapW||1e9)-preW);
    if(s.fit==='wrap'&&wid(lines)>wrapW){
      const words=tx.split(/\s+/); lines=[]; let cur='';
      for(const w of words){ const tryL=cur?cur+' '+w:w; if(cur&&this.width(x,tryL,s,size)>wrapW){ lines.push(cur); cur=w; } else cur=tryL; }
      if(cur) lines.push(cur);
      if(lines.length>3){ lines=[...lines.slice(0,2),lines.slice(2).join(' ')]; }
    }
    let w=wid(lines);
    if(w>maxW){ size*=Math.max(s.minK||0.5,maxW/w); }
    else if(s.fill){ size*=Math.min(1.45,maxW/w); }
    size*=s.k||1;
    this.setType(x,s,size); w=wid(lines);
    const m=x.measureText('H'), cap=m.actualBoundingBoxAscent||size*0.72;
    const last=x.measureText(lines[lines.length-1]); const desc=Math.max(0,last.actualBoundingBoxDescent||0);
    const lead=size*s.lh, preW2=pre?this.width(x,pre,s,size)+(HAS_LS?s.track*size:0):0;
    return {lines,size,cap,desc,lead,w:w+preW2,pre,preW:preW2,h:cap+(lines.length-1)*lead+desc};
  },
  /* opt.ctx: draw somewhere else (layout thumbnails); opt.content: words to set instead of App.brand */
  draw(id,vs,bs,st,env,opt={}){
    const x=opt.ctx||this.ctx, C=lookColors(id,vs), B=opt.content||App.brand; x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,BW,BH); x.textBaseline='alphabetic'; x.textAlign='left';
    const boxes=[]; if(!opt.ctx) this.boxes=boxes;
    const leg=bs.leg||st.leg||'shadow', F=AudioEngine.user?brandFeatures(AudioEngine.pcm,AudioEngine.sr):null;
    const fi=F?Math.min(F.n-1,Math.max(0,Math.floor(env.t*100))):0, pulse=F?F.pulse[fi]:0, hit=F?F.hit[fi]:0;
    // collect elements
    const els=[];
    for(const role of BRAND_ROLES){
      if(role==='logo'){ if(!B.logo||!Logos[B.logo.id]) continue; }
      else if(!B[role]||!B[role].text.trim()) continue;
      const s=this.spec(role,st,bs); if(!s) continue;
      const e={role,s};
      if(role==='logo'){ const L=Logos[B.logo.id], k=bso(bs,st.id).logo.scale??1; let hh=s.h, ww=hh*L.aspect; const maxW=440*k; if(ww>maxW){ ww=maxW; hh=ww/L.aspect; }
        if(ww>BW-48){ ww=BW-48; hh=ww/L.aspect; } if(hh>BH*0.8){ hh=BH*0.8; ww=hh*L.aspect; } e.L=L; e.w=ww; e.h=hh; e.k=k; }
      else { e.text=B[role].text.trim(); e.lay=this.layout(x,s,e.text); e.w=e.lay.w; e.h=e.lay.h+(s.decor==='hud'?60:0)+(s.decor==='rule'?34:0); }
      els.push(e);
    }
    // a logo sharing a band with left/right-set type takes its room first
    const lg=els.find(e=>e.role==='logo');
    if(lg) for(const e of els){ if(e.role==='logo'||!e.s.g) continue; const G=st.groups[e.s.g];
      if(G.v!==lg.s.v||Math.abs(G.y-lg.s.y)>80||e.s.align===lg.s.align||e.s.align==='center'||lg.s.align==='center') continue;
      const room=(SAFE.r-SAFE.l)-lg.w-56; if((e.s.maxW||900)>room){ e.s.maxW=room; if(e.s.fit!=='shrink') e.s.fit='wrap'; e.lay=this.layout(x,e.s,e.text); e.w=e.lay.w; e.h=e.lay.h+(e.s.decor==='hud'?60:0)+(e.s.decor==='rule'?34:0); } }
    // stack groups
    const byG={}; for(const e of els){ const g=e.s.g; if(g) (byG[g]||(byG[g]=[])).push(e); }
    for(const [g,list] of Object.entries(byG)){
      const G=st.groups[g]; list.sort((a,b)=>a.s.o-b.s.o);
      const total=list.reduce((a,e)=>a+e.h,0)+G.gap*(list.length-1);
      let y=G.v==='top'?G.y:G.v==='bottom'?G.y-total:G.y-total/2;
      for(const e of list){ e.y=y; y+=e.h+G.gap; }
    }
    for(const e of els) if(!e.s.g){ const s=e.s; e.y=s.v==='bottom'?s.y-e.h:s.v==='middle'?s.y-e.h/2:s.y; }
    // horizontal: alignment decides the edge
    for(const e of els){ const a=e.s.align, ax=e.role==='logo'&&e.s.x!=null?e.s.x:(a==='center'?BW/2:a==='right'?SAFE.r:SAFE.l);
      e.x=a==='center'?ax-e.w/2:a==='right'?ax-e.w:ax; e.x+=e.s.dx; e.y+=e.s.dy;
      if(e.w<BW) e.x=clamp(e.x,0,BW-e.w); if(e.h<BH) e.y=clamp(e.y,0,BH-e.h); }   // never lost off the edge
    // motion
    const clipLen=Math.max(0.1,env.until-env.from), tl=env.t-env.from, anim=env.playing&&bs.motion!=='static';
    els.forEach((e,i)=>{
      e.a=1; e.k=1; e.rise=0; e.reveal=1; e.scr=0;
      if(!anim) return;
      if(bs.motion==='fade'){
        const d=0.25+i*0.22, pin=clamp((tl-d)/1.1,0,1), pout=clamp((env.until-env.t)/1.1,0,1), p=Math.min(pin,pout), ez=p*p*(3-2*p);
        if(id==='retro'){ e.reveal=clamp((tl-d)*24/Math.max(1,(e.text||'').length+2),0,1); e.a=e.role==='logo'?ez:(pout<1?ez:1); if(e.role==='logo'&&pin<1) e.a=pin>.5?1:0; }
        else if(id==='caustic'){ e.a=pout<1?ez:Math.min(1,pin*3); e.scr=1-pin; }
        else if(id==='contour'){ e.a=ez; e.rise=(1-ez)*22; }
        else { e.a=ez; e.k=1+(1-ez)*0.04; }
      } else if(bs.motion==='pulse'){ e.k=1+0.045*pulse; e.a=0.8+0.2*pulse; }
      else if(bs.motion==='beat'){ e.a=0.42+0.58*hit; e.k=1+0.018*hit; }
    });
    // legibility
    const shadow=(on)=>{ if(on&&leg==='shadow'&&!st.blend){ const c=hex2rgb(C.bg); x.shadowColor=`rgba(${c[0]},${c[1]},${c[2]},.6)`; x.shadowBlur=28; } else { x.shadowColor='transparent'; x.shadowBlur=0; } };
    if(leg==='plate'&&!st.blend){ const c=hex2rgb(C.bg); x.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},.74)`;
      for(const e of els){ if(e.a<=0) continue; x.globalAlpha=e.a; roundRect(x,e.x-18,e.y-14,e.w+36,e.h+28,8); x.fill(); } x.globalAlpha=1; }
    // draw
    for(const e of els){
      const s=e.s; if(e.a<=0.003) continue;
      x.save(); x.globalAlpha=clamp(e.a*s.op,0,1);
      const cx=e.x+e.w/2, cy=e.y+e.h/2; if(e.k!==1){ x.translate(cx,cy); x.scale(e.k,e.k); x.translate(-cx,-cy); }
      x.translate(0,e.rise);
      const col=roleColor(s.color,C);
      shadow(true);
      if(e.role==='logo'){ x.drawImage(logoArt(e.L,s.treat==='mark'?'mono':s.treat,col),e.x,e.y,e.w,e.h); }
      else this.drawText(x,e,col,C,env,bs,hit);
      x.restore();
      boxes.push({role:e.role,x0:e.x,y0:e.y,x1:e.x+e.w,y1:e.y+e.h,
        px:e.lay?e.lay.size:null, px1:e.lay?e.lay.size/(e.s.k||1):null, w1:e.role==='logo'?e.w/(e.k||1):null});
    }
    x.shadowColor='transparent'; x.shadowBlur=0;
  },
  drawText(x,e,col,C,env,bs,hit){
    const s=e.s, L=e.lay; let top=e.y;
    if(s.decor==='hud') top+=44;
    this.setType(x,s,L.size); x.fillStyle=col;
    const total=L.lines.join(' ').length; let shown=Math.round(e.reveal*total), idx=0;
    L.lines.forEach((ln,i)=>{
      let str=ln; const lw=this.width(x,ln,s,L.size);
      if(e.reveal<1){ const n=clamp(shown-idx,0,ln.length); str=ln.slice(0,n); } idx+=ln.length+1;
      if(e.scr>0){ const G='#%&*+=<>/\\|01'; const frz=Math.floor(env.t*24); str=[...str].map((c,j)=>c!==' '&&((j*37+frz*13)%100)/100<e.scr?G[(j*7+frz)%G.length]:c).join(''); }
      const base=top+L.cap+i*L.lead, avail=L.w-L.preW;
      let x0=e.x+L.preW+(s.align==='center'?(avail-lw)/2:s.align==='right'?avail-lw:0);
      if(i===0&&L.pre){ x.fillStyle=roleColor('dim',C); this.fill(x,L.pre,e.x,base,s,L.size); x.fillStyle=col; }
      this.fill(x,str,x0,base,s,L.size);
      if(s.decor==='prompt'&&i===L.lines.length-1){
        const blinkOn=bs.motion==='beat'&&env.playing?hit>0.35:Math.floor(performance.now()/560)%2===0;
        const typing=e.reveal<1;
        if(blinkOn||typing){ const cw=L.size*0.56, cxp=x0+this.width(x,str,s,L.size)+L.size*0.14+(HAS_LS&&str?s.track*L.size:0); x.fillRect(cxp,base-L.cap,cw,L.cap); }
      }
    });
    if(s.decor==='hud'){   // a tracker frame like the ones Caustic draws, with a tag and a live timecode
      const pad=16, fx=e.x-pad, fy=top-pad, fw=L.w+pad*2, fh=L.h+pad*2;
      x.shadowColor='transparent'; x.lineWidth=2; x.strokeStyle=col; x.strokeRect(fx,fy,fw,fh);
      const tk=12; x.lineWidth=4; for(const [px,py,dx,dy] of [[fx,fy,1,1],[fx+fw,fy,-1,1],[fx,fy+fh,1,-1],[fx+fw,fy+fh,-1,-1]]){ x.beginPath(); x.moveTo(px+dx*tk,py); x.lineTo(px,py); x.lineTo(px,py+dy*tk); x.stroke(); }
      const tt=Math.max(0,env.t), tc=String(Math.floor(tt/60)).padStart(2,'0')+':'+String(Math.floor(tt%60)).padStart(2,'0')+'.'+String(Math.floor((tt%1)*100)).padStart(2,'0');
      const tag=`ID 01  ·  T+${tc}`; const ts={font:'jet',w:500,track:.08,italic:false}; this.setType(x,ts,19);
      const tw=this.width(x,tag,ts,19)+20; x.fillStyle=col; x.fillRect(fx,fy-32,tw,28); x.fillStyle=C.bg; this.fill(x,tag,fx+10,fy-12,ts,19);
    }
    if(s.decor==='rule'){ const ry=top+L.h+28; x.fillStyle=roleColor('dim',C); x.fillRect(e.x+e.w/2-36,ry,72,2); }
  },
};
function roundRect(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }
BrandLayer.init();

/* fonts: load every curated face once; redraw when they arrive (offline falls back quietly) */
(function(){ if(!document.fonts) return;
  const jobs=[]; for(const f of Object.values(BRAND_FONTS)){ const fam=f.css.split(',')[0]; for(const w of f.weights){ jobs.push(document.fonts.load(`${w} 48px ${fam}`).catch(()=>{})); if(f.italic) jobs.push(document.fonts.load(`italic ${w} 48px ${fam}`).catch(()=>{})); } }
  Promise.all(jobs).then(()=>{ BrandLayer.fontsVer++; });
  document.fonts.addEventListener&&document.fonts.addEventListener('loadingdone',()=>BrandLayer.fontsVer++);
})();

/* ============================================================ BRANDING UI */
function brandCommitSoon(){ clearTimeout(brandCommitSoon.t); brandCommitSoon.t=setTimeout(commit,600); }
function addBrand(role){
  if(role==='logo'){ $('#logoIn').click(); return; }
  const P=BrandPreset.get();
  const P0=BrandPreset.get()||{};   // text that came from the track or a placeholder keeps following the track
  App.brand[role]={text:autoText(role),auto:role==='title'||(role==='artist'&&!P0.artist)};
  if(!App.brandSel||!App.brand[App.brandSel]) App.brandSel=role;
  buildBrandBlock(); commit();
  const inp=document.querySelector(`.brow[data-role="${role}"] input`); if(inp){ inp.focus(); inp.select(); }
}
function removeBrand(role){ App.brand[role]=null; if(App.brandSel===role) App.brandSel=null; buildBrandBlock(); if(App.advTab==='brand') buildAdv(); commit(); }
async function onLogoFile(f){
  try{ const id=await importLogoFile(f); App.brand.logo={id,name:f.name}; App.brandSel=App.brandSel||'logo'; buildBrandBlock(); if(App.advTab==='brand') buildAdv(); commit(); }
  catch(e){ console.error(e); toast(`Couldn’t use ${f.name} as a logo. Try a PNG, SVG or JPG.`); }
}
$('#logoIn').addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; if(f) onLogoFile(f); });
async function applyPreset(){
  const P=BrandPreset.get(); if(!P) return;
  if(P.artist) App.brand.artist={text:P.artist};
  if(P.handle) App.brand.custom={text:P.handle};
  if(P.logo&&P.logo.data){ try{ const id=await importLogoData(P.logo.data,P.logo.name); App.brand.logo={id,name:P.logo.name}; }catch(e){ console.error(e); } }
  buildBrandBlock(); if(App.advTab==='brand') buildAdv(); commit(); toast('Your brand is on. METHOD has set it for '+ENG[App.vid].name+'.');
}

/* the visible block in the main panel: add content, pick a style, pick motion */
function buildBrandBlock(){
  const host=$('#brandBlk'); if(!host||!App.vid) return; host.innerHTML='';
  const vs=vsOf(App.vid), bs=brandOf(vs), B=App.brand, P=BrandPreset.get(), any=BrandLayer.has()||BRAND_ROLES.some(r=>B[r]);
  host.append(h('div',{class:'lab-row'},h('span',{class:'lab'},'Branding'),
    h('button',{class:'link',onclick:()=>{ App.advTab='brand'; buildAdv(); toggleAdv(true); }},'Customize')));
  const layouts=brandStyles(App.vid), land=BW>BH;
  const strip=h('div',{class:'lstrip',id:'layoutStrip',role:'radiogroup','aria-label':'Layout'},layouts.map(st=>{
    const on=any&&bs.style===st.id, b=h('button',{class:'lthumb',role:'radio','aria-checked':on,'data-tip':st.hint,'aria-label':st.name},
      h('canvas',{width:land?192:108,height:land?108:192,'data-style':st.id}),h('span',{},st.name));
    b.addEventListener('click',()=>chooseLayout(st.id));
    const peek=v=>{ App.brandPeek=v; };
    b.addEventListener('pointerenter',()=>peek(st.id)); b.addEventListener('pointerleave',()=>peek(null));
    b.addEventListener('focus',()=>peek(st.id)); b.addEventListener('blur',()=>peek(null));
    return b; }));
  host.append(strip); LayoutStrip.key=''; requestAnimationFrame(()=>LayoutStrip.tick(true));
  const rows=h('div',{class:'brows'});
  for(const role of BRAND_ROLES){
    const it=B[role]; if(!it) continue;
    if(role==='logo'){
      const L=Logos[it.id]; const th=h('span',{class:'bthumb'}); if(L){ const c=document.createElement('canvas'); c.width=48; c.height=48; const k=Math.min(44/L.orig.width,44/L.orig.height); c.getContext('2d').drawImage(L.orig,24-L.orig.width*k/2,24-L.orig.height*k/2,L.orig.width*k,L.orig.height*k); th.append(c); }
      const cur=(bso(bs).logo.treat)||'auto';
      const sel=h('select',{class:'bsel','aria-label':'Logo treatment','data-tip':'How the logo sits in the picture'},
        h('option',{value:'auto'},'Auto'),LOGO_TREATS.map(t=>h('option',{value:t.v},t.label)));
      sel.value=cur; sel.addEventListener('change',()=>{ bso(bs).logo.treat=sel.value==='auto'?undefined:sel.value; commit(); if(App.advTab==='brand') buildAdv(); });
      rows.append(h('div',{class:'brow','data-role':role},h('span',{class:'brole'},'Logo'),h('div',{class:'blogo'},th,h('span',{class:'bname',title:it.name},it.name),sel),
        h('button',{class:'ico bx','aria-label':'Remove logo','data-tip':'Remove',html:ICON.close,onclick:()=>removeBrand(role)})));
      continue;
    }
    const inp=h('input',{class:'bin',value:it.text,spellcheck:'false','aria-label':ROLE_LABEL[role],maxlength:80});
    inp.addEventListener('input',()=>{ it.text=inp.value; it.auto=false; brandCommitSoon(); });
    inp.addEventListener('focus',()=>{ BrandEditor.select(role); });
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); inp.blur(); } });
    rows.append(h('div',{class:'brow','data-role':role},h('span',{class:'brole'},ROLE_LABEL[role]),inp,
      h('button',{class:'ico bx','aria-label':'Remove '+ROLE_LABEL[role].toLowerCase(),'data-tip':'Remove',html:ICON.close,onclick:()=>removeBrand(role)})));
  }
  if(rows.children.length) host.append(rows);
  const chips=h('div',{class:'chips'});
  for(const role of BRAND_ROLES) if(!B[role]) chips.append(h('button',{class:'chip',onclick:()=>addBrand(role)},h('span',{class:'plus'},'+'),ROLE_LABEL[role]));
  if(P&&!B.artist&&!B.logo&&!B.custom) chips.append(h('button',{class:'chip mine','data-tip':'Add your saved logo, artist name and handle',onclick:applyPreset},'My brand'));
  if(chips.children.length) host.append(chips);
  if(!any){ host.append(h('p',{class:'note'},`Pick a layout, or add words and a logo. Hover a layout to see it on the picture.`)); return; }
  host.append(h('div',{class:'bset'},h('span',{class:'brole'},'Motion'),Seg(MOTIONS,bs.motion,v=>{ bs.motion=v; commit(); })));
}
/* words used to show a layout before the user has added any */
function sampleContent(){ const B=App.brand, any=['title','artist','custom'].some(r=>B[r]&&B[r].text.trim());
  if(any) return B; return {logo:B.logo,title:{text:autoText('title')},artist:{text:autoText('artist')},custom:null}; }
function chooseLayout(id){
  const bs=brandOf(vsOf(App.vid)); App.brandPeek=null;
  if(!['title','artist','custom'].some(r=>App.brand[r])){   // picking a layout from empty adds the words it needs
    App.brand.title={text:autoText('title'),auto:true}; const P=BrandPreset.get()||{}; App.brand.artist={text:autoText('artist'),auto:!P.artist}; }
  bs.style=id; buildBrandBlock(); if(App.advOpen&&App.advTab==='brand') buildAdv(); commit();
}
function cycleLayout(d){ const L=brandStyles(App.vid), bs=brandOf(vsOf(App.vid)); const i=L.findIndex(q=>q.id===bs.style); chooseLayout(L[(i+d+L.length)%L.length].id); }
/* live thumbnails of every layout, drawn over the current frame of the picture */
const LayoutStrip={ key:'', t:0, off:null, pic:null, ovs:{}, strip:null, cs:[],
  tick(force){
    if(!this.strip||!this.strip.isConnected){ this.strip=document.getElementById('layoutStrip'); this.cs=this.strip?[...this.strip.querySelectorAll('canvas')]:[]; }
    const cs=this.cs; if(!cs.length||!WS.inst||!App.vid) return;
    const vs=vsOf(App.vid), bs=brandOf(vs), content=sampleContent(), now=performance.now();
    const key=JSON.stringify([App.vid,vs.look,content,bs.os,BrandLayer.fontsVer,cs.length,BW]);
    if(!force&&key===this.key&&(now-this.t<2500||Recorder.busy())) return; this.key=key; this.t=now;   // no timed refresh while recording; a real change still redraws
    if(!this.off) this.off=document.createElement('canvas');
    if(this.off.width!==BW||this.off.height!==BH){ this.off.width=BW; this.off.height=BH; }
    const ox=this.off.getContext('2d'), L=brandStyles(App.vid), t=curTime(), env={t,playing:false,from:0,until:1};
    // the current frame of the picture, scaled down once and shared by every thumbnail
    const TW=cs[0].width, TH=cs[0].height;
    if(!this.pic) this.pic=document.createElement('canvas');
    if(this.pic.width!==TW||this.pic.height!==TH){ this.pic.width=TW; this.pic.height=TH; }
    const px=this.pic.getContext('2d'); px.clearRect(0,0,TW,TH); px.drawImage(WS.inst.canvas,0,0,TW,TH);
    const logo=content.logo&&Logos[content.logo.id]?1:0, preset=BrandPreset.get();
    for(const c of cs){ const st=L.find(q=>q.id===c.dataset.style); if(!st) continue;
      // each layout's overlay is drawn at full size only when what it shows has changed (words, look, fonts, the
      // prompt cursor's blink, the HUD timecode), and kept at thumbnail size in between
      const dec=st.title&&st.title.decor, anim=[dec==='prompt'?Math.floor(now/560)%2:0, dec==='hud'?Math.floor(Math.max(0,t)*100):0];
      const ok=JSON.stringify([App.vid,st.id,vs.look,content,bs.leg||null,bso(bs,st.id),preset,BrandLayer.fontsVer,logo,anim,BW]);
      let o=this.ovs[st.id];
      if(!o||o.key!==ok||o.c.width!==c.width||o.c.height!==c.height){
        if(!o) o=this.ovs[st.id]={c:document.createElement('canvas'),key:''};
        if(o.c.width!==c.width||o.c.height!==c.height){ o.c.width=c.width; o.c.height=c.height; }
        BrandLayer.draw(App.vid,vs,bs,st,env,{ctx:ox,content});
        const oc=o.c.getContext('2d'); oc.clearRect(0,0,c.width,c.height); oc.drawImage(this.off,0,0,c.width,c.height); o.key=ok; }
      const tc=c.getContext('2d'); tc.globalCompositeOperation='source-over'; tc.drawImage(this.pic,0,0);
      tc.globalCompositeOperation=st.blend?'difference':'source-over'; tc.drawImage(o.c,0,0); tc.globalCompositeOperation='source-over'; }
  }
};
/* track name changed: titles still on their automatic text follow it */
function brandOnTrack(){ for(const r of ['title','artist']){ const it=App.brand[r]; if(it&&it.auto) it.text=autoText(r); } buildBrandBlock(); }

/* ---------------- Customize (drawer tab) ---------------- */
function advBrand(vs,body){
  const bs=brandOf(vs), B=App.brand, st=curStyle(App.vid,bs), present=BRAND_ROLES.filter(r=>B[r]);
  if(!present.length){
    body.append(h('p',{class:'note',style:'padding-top:14px'},'Add a logo or some text in the Branding block first. The detailed controls for each element live here.'));
  } else {
    if(!present.includes(App.brandSel)) App.brandSel=present.find(r=>r!=='logo')||present[0];
    const role=App.brandSel, ov=bso(bs)[role], base=st[role]||{};
    const seg=Seg(present.map(r=>({v:r,label:ROLE_LABEL[r]})),role,v=>{ App.brandSel=v; buildAdv(); });
    const items=[];
    const S=(label,k,min,max,def,fmt,step)=>Slider({label,min,max,value:ov[k]??def,def,fmt,onInput:v=>{ ov[k]=v; },onCommit:commit});
    if(role==='logo'){
      items.push(h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},'Treatment')),Seg([{v:'auto',label:'Auto'},...LOGO_TREATS.map(t=>({...t,label:t.v==='mark'?'Mark':t.label}))],ov.treat||'auto',v=>{ ov.treat=v==='auto'?undefined:v; buildBrandBlock(); commit(); })));
      const b=BrandLayer.boxes.find(q=>q.role==='logo'), w1=b?b.w1:220;
      items.push(S('Width','scale',0.3,5,1,v=>Math.round(w1*v)+' px'), S('Opacity','op',0.05,1,base.op??1,v=>Math.round(v*100)+'%'));
    } else {
      const fsel=h('select',{class:'bsel wide','aria-label':'Font'},h('option',{value:''},`Style default — ${BRAND_FONTS[base.font].label}`),
        Object.entries(BRAND_FONTS).map(([k,f])=>h('option',{value:k},f.label)));
      fsel.value=ov.font||''; fsel.addEventListener('change',()=>{ ov.font=fsel.value||undefined; ov.w=undefined; buildAdv(); commit(); });
      items.push(h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},'Font')),fsel));
      const fk=ov.font||base.font, W=BRAND_FONTS[fk].weights;
      if(W.length>1) items.push(h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},'Weight')),Seg(W.map(w=>({v:w,label:{300:'Light',400:'Regular',500:'Medium',600:'Semi',700:'Bold',800:'Heavy'}[w]||w})),ov.w||(ov.font?W[Math.min(1,W.length-1)]:base.w),v=>{ ov.w=v; commit(); })));
      const b=BrandLayer.boxes.find(q=>q.role===role), px1=b?b.px1:base.size;
      items.push(S('Font size','scale',0.3,4,1,v=>Math.round(px1*v)+' px'));
      items.push(S('Tracking','track',-0.1,0.5,0,v=>(v>0?'+':'')+v.toFixed(2)+' em'));
      items.push(h('div',{class:'sl two'},h('div',{},h('div',{class:'sl-top'},h('span',{},'Case')),Seg([{v:'none',label:'As typed'},{v:'upper',label:'CAPS'}],ov.case||base.case||'none',v=>{ ov.case=v; commit(); })),
        h('div',{},h('div',{class:'sl-top'},h('span',{},'Align')),Seg([{v:'left',label:'Left'},{v:'center',label:'Centre'},{v:'right',label:'Right'}],ov.align||base.align||'left',v=>{ ov.align=v; ov.dx=0; commit(); }))));
      items.push(S('Opacity','op',0.05,1,base.op??1,v=>Math.round(v*100)+'%'));
    }
    // colour: roles first, so a colour keeps working when the look changes
    const C=lookColors(App.vid,vs), P=BrandPreset.get()||{};
    const opts=[['ink','Auto','Follows the look'],['dim','Soft','A quieter tone of the look'],['white','White'],['black','Black']];
    if(P.p1) opts.push(['p1','Brand']); if(P.p2) opts.push(['p2','Brand 2']);
    const curC=ov.color||base.color||'ink';
    const sw=h('div',{class:'swatches'},opts.map(([k,l,tip])=>h('button',{class:'swc','aria-pressed':curC===k,'data-tip':tip?`${l}: ${tip}`:l,'aria-label':l,style:`--c:${roleColor(k,C)}`,onclick:()=>{ ov.color=k; buildAdv(); commit(); }})));
    const pick=h('input',{type:'color',class:'swpick','data-tip':'Any colour','aria-label':'Pick a colour',value:curC[0]==='#'?curC:roleColor(curC,C)});
    pick.addEventListener('input',()=>{ ov.color=pick.value; }); pick.addEventListener('change',()=>{ buildAdv(); commit(); });
    sw.append(h('label',{class:'swc pick','aria-pressed':curC[0]==='#'},pick));
    items.push(h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},'Colour')),sw));
    // position as the element's centre, in % of the frame (the same in the preview and the video, in either format)
    const bx=BrandLayer.boxes.find(q=>q.role===role);
    const P2=(label,axis)=>{ const cur=bx?(axis==='x'?(bx.x0+bx.x1)/2/BW:(bx.y0+bx.y1)/2/BH)*100:50;
      return Slider({label,min:0,max:100,value:cur,def:cur,fmt:v=>Math.round(v)+'%',onInput:v=>{ const b2=BrandLayer.boxes.find(q=>q.role===role); if(!b2) return;
        if(axis==='x') ov.dx=(ov.dx||0)+v/100*BW-(b2.x0+b2.x1)/2; else ov.dy=(ov.dy||0)+v/100*BH-(b2.y0+b2.y1)/2; BrandLayer.redrawNow(); },onCommit:commit}); };
    items.push(h('div',{class:'sl two'},P2('X','x'),P2('Y','y')));
    items.push(h('p',{class:'note'},'On the preview: drag to move, pull a corner to resize.'));
    body.append(Section(ROLE_LABEL[role],{onReset:()=>{ bso(bs)[role]={}; buildAdv(); buildBrandBlock(); commit(); }},seg,h('div',{style:'height:8px'}),items));
  }
  // legibility and composition
  const legSeg=Seg([{v:'shadow',label:'Soft shadow',hint:'A shadow in the look’s own background colour'},{v:'none',label:'None'},{v:'plate',label:'Plate',hint:'A panel behind the type'}],bs.leg||st.leg||'shadow',v=>{ bs.leg=v; commit(); });
  if(st.blend) legSeg.buttons.forEach(b=>b.disabled=true);
  const late=Toggle(bs.late,on=>{ bs.late=on; commit(); },'Keep branding clean');
  const safe=Toggle(App.showSafe,on=>{ App.showSafe=on; syncSafe(); },'Show safe area');
  body.append(Section('Legibility',{},legSeg,
    st.blend?h('p',{class:'note'},`${st.name} flips the colour of whatever is behind the type, so it stays readable on its own.`):null,
    h('div',{class:'row'},h('span',{},'Keep branding clean'),late),
    h('p',{class:'note'},'Off: the type sits inside the picture, so effects and colour grading apply to it too. On: it stays crisp on top.'),
    h('div',{class:'row'},h('span',{},'Show safe area'),safe),
    h('p',{class:'note'},'The area Reels, TikTok and Shorts keep free of their own buttons and captions.')));
  // my brand
  const P=BrandPreset.get()||{};
  const draft={artist:P.artist||'',handle:P.handle||'',p1:P.p1||'',p2:P.p2||'',font:P.font||''};
  const fld=(label,k,ph)=>{ const i=h('input',{class:'bin',value:draft[k],placeholder:ph,spellcheck:'false','aria-label':label}); i.addEventListener('input',()=>draft[k]=i.value); return h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},label)),i); };
  const col=(label,k)=>{ const i=h('input',{type:'color',class:'swpick big',value:draft[k]||'#ffffff','aria-label':label}); const on=Toggle(!!draft[k],v=>{ draft[k]=v?i.value:''; },label);
    i.addEventListener('input',()=>{ draft[k]=i.value; on.set(true); }); return h('div',{class:'row'},h('span',{},label),i,on); };
  const fsel=h('select',{class:'bsel wide','aria-label':'Title font'},h('option',{value:''},'Let each visualizer choose'),Object.entries(BRAND_FONTS).map(([k,f])=>h('option',{value:k},f.label)));
  fsel.value=draft.font; fsel.addEventListener('change',()=>draft.font=fsel.value);
  const L=B.logo&&Logos[B.logo.id];
  body.append(Section('My brand',{open:!BrandPreset.get()},
    h('p',{class:'note'},'Save what you use every time. Each visualizer still sets its own composition.'),
    fld('Artist name','artist','Artist name'), fld('Handle','handle','@yourhandle'),
    col('Brand colour','p1'), col('Second colour','p2'),
    h('div',{class:'sl'},h('div',{class:'sl-top'},h('span',{},'Title font')),fsel),
    h('div',{class:'row'},h('span',{},'Logo'),h('span',{class:'note'},L?L.name:(P.logo?P.logo.name:'Add one in the Branding block'))),
    h('div',{class:'adv-foot'},
      h('button',{class:'btn solid',onclick:()=>{ const logo=L?{name:L.name,data:L.dataURL}:(P.logo||null);
        BrandPreset.set({...draft,logo}); toast('Saved as your brand in this browser.'); buildAdv(); buildBrandBlock(); }},'Save my brand'),
      BrandPreset.get()?h('button',{class:'btn',onclick:applyPreset},'Apply'):null,
      BrandPreset.get()?h('button',{class:'btn q',onclick:()=>{ BrandPreset.set(null); buildAdv(); buildBrandBlock(); }},'Forget'):null)));
}

/* ---------------- on the preview: select, move, resize ----------------
   One editor for every branding element (title, artist, text, logo):
   click selects, drag moves, a corner resizes, double-click edits the words.
   All maths is in composition space (1080 x 1920, or 1920 x 1080), so an adjustment made on a
   small preview lands exactly the same in the recording. Everything here is DOM
   laid over the canvas; none of it is drawn into the picture, so selection,
   handles, guides and toolbar can never reach a video.                       */
let brandOverlayTick=()=>{};
function syncSafe(on){ $('#safe').classList.toggle('on',!!(App.showSafe||on)); }
const BrandEditor=(function(){
  const O=$('#bover'), hov=$('#bhov'), sel=$('#bsel'), gV=$('#gV'), gH=$('#gH'), tool=$('#btool');
  let cur=null, hovRole=null, drag=null, editing=null, toolKey='', keyT=null;
  const rect=()=>$('#stage').getBoundingClientRect();
  const toFrame=e=>{ const r=rect(); return [(e.clientX-r.left)/r.width*BW,(e.clientY-r.top)/r.height*BH,r]; };
  const boxOf=role=>BrandLayer.boxes.find(b=>b.role===role);
  const headAt=(X,Y)=>App.view==='ws'&&WS.inst&&WS.inst.headerAt?WS.inst.headerAt(X,Y):null;
  const ovOf=role=>bso(brandOf(vsOf(App.vid)))[role];
  const hitAt=(X,Y,pad)=>{ for(let i=BrandLayer.boxes.length-1;i>=0;i--){ const b=BrandLayer.boxes[i]; if(X>=b.x0-pad&&X<=b.x1+pad&&Y>=b.y0-pad&&Y<=b.y1+pad) return b; } return null; };
  const PAD=6;   // screen px between the element and its outline
  function place(el,b,r){ const k=r.width/BW; el.style.left=(b.x0*k-PAD)+'px'; el.style.top=(b.y0*k-PAD)+'px'; el.style.width=((b.x1-b.x0)*k+PAD*2)+'px'; el.style.height=((b.y1-b.y0)*k+PAD*2)+'px'; }
  const corners=(b,r)=>{ const p=PAD*BW/r.width; return {nw:[b.x0-p,b.y0-p],ne:[b.x1+p,b.y0-p],sw:[b.x0-p,b.y1+p],se:[b.x1+p,b.y1+p]}; };
  const OPP={nw:'se',ne:'sw',sw:'ne',se:'nw'}, CUR={nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize'};
  function handleAt(X,Y,r,touch){ if(!cur) return null; const b=boxOf(cur); if(!b) return null; const tol=(touch?22:11)*BW/r.width;
    for(const [k,[hx,hy]] of Object.entries(corners(b,r))) if(Math.hypot(X-hx,Y-hy)<tol) return k; return null; }
  function select(role){
    const was=cur; cur=role; if(role){ App.brandSel=role; } editing=null; toolKey='';
    if(role!==was&&App.advOpen&&App.advTab==='brand') buildAdv();
    tick();
  }
  function guides(v,hh){ gV.classList.toggle('on',v!=null); gH.classList.toggle('on',hh!=null); const r=rect(), k=r.width/BW;
    if(v!=null) gV.style.left=(v*k)+'px'; if(hh!=null) gH.style.top=(hh*k)+'px'; }
  /* move: snap the edges or centre to the middle and the safe area, only when close, and never off the canvas */
  function moveTo(X,Y,alt){
    const d=drag, ov=d.ov, b0=d.b, r=rect(), tol=7*BW/r.width;
    let sx=X-d.X0, sy=Y-d.Y0;
    let gx=null, gy=null;
    if(!alt){
      const cx=(b0.x0+b0.x1)/2+sx, cy=(b0.y0+b0.y1)/2+sy, l=b0.x0+sx, rr=b0.x1+sx, t=b0.y0+sy, bb=b0.y1+sy;
      for(const [pos,target] of [[cx,BW/2],[l,SAFE.l],[rr,SAFE.r]]) if(Math.abs(pos-target)<tol){ sx+=target-pos; gx=target; break; }
      for(const [pos,target] of [[cy,BH/2],[t,SAFE.t],[bb,SAFE.b]]) if(Math.abs(pos-target)<tol){ sy+=target-pos; gy=target; break; }
    }
    sx=clamp(sx,-b0.x0,BW-b0.x1); sy=clamp(sy,-b0.y0,BH-b0.y1);   // stays on the canvas
    ov.dx=Math.round(d.dx0+sx); ov.dy=Math.round(d.dy0+sy);
    guides(gx,gy); BrandLayer.redrawNow();
  }
  /* resize: uniform, about the opposite corner. Text changes its real font size, a logo its real width. */
  function resizeTo(X,Y){
    const d=drag, ov=d.ov, A=d.anchor, D=[d.X0-A[0],d.Y0-A[1]], dd=D[0]*D[0]+D[1]*D[1]||1;
    let f=((X-A[0])*D[0]+(Y-A[1])*D[1])/dd;
    const w0=d.b.x1-d.b.x0, h0=d.b.y1-d.b.y0;
    f=Math.min(f,(BW-24)/w0,(BH*0.85)/h0);                       // never bigger than the frame
    const k=clamp(d.k0*f,0.25,5); ov.scale=+k.toFixed(3);
    BrandLayer.redrawNow();
    // hold the opposite corner where it was
    const b=boxOf(d.role); if(!b) return; const c=corners(b,rect())[OPP[d.h]], a2=corners(d.b,rect())[OPP[d.h]];
    ov.dx=Math.round((ov.dx||0)+a2[0]-c[0]); ov.dy=Math.round((ov.dy||0)+a2[1]-c[1]); BrandLayer.redrawNow();
  }
  O.addEventListener('pointerdown',e=>{
    if(Recorder.busy()||e.button!==0||editing||e.target.closest('.btool')) return;
    const [X,Y,r]=toFrame(e), touch=e.pointerType==='touch';
    const hd=handleAt(X,Y,r,touch);
    if(hd){ e.preventDefault(); O.setPointerCapture(e.pointerId); const b={...boxOf(cur)}, ov=ovOf(cur);
      drag={mode:'resize',role:cur,h:hd,ov,b,X0:X,Y0:Y,k0:ov.scale??1,anchor:corners(b,r)[OPP[hd]],moved:false}; syncSafe(true); return; }
    const b=hitAt(X,Y,touch?20:10);
    if(!b){ select(null); return; }
    e.preventDefault(); O.setPointerCapture(e.pointerId); select(b.role);
    const ov=ovOf(b.role); drag={mode:'move',role:b.role,ov,b:{...b},X0:X,Y0:Y,dx0:ov.dx||0,dy0:ov.dy||0,moved:false,sx:e.clientX,sy:e.clientY};
  });
  O.addEventListener('pointermove',e=>{
    if(Recorder.busy()){ O.style.cursor=''; return; }
    const [X,Y,r]=toFrame(e);
    if(drag){
      if(!drag.moved){ if(drag.mode==='move'&&Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)<3) return; drag.moved=true; O.classList.add('dragging'); syncSafe(true); }
      drag.mode==='move'?moveTo(X,Y,e.altKey):resizeTo(X,Y); return;
    }
    const hd=handleAt(X,Y,r,e.pointerType==='touch'); if(hd){ O.style.cursor=CUR[hd]; hovRole=null; return; }
    const b=hitAt(X,Y,10); hovRole=b&&b.role!==cur?b.role:null; O.style.cursor=b?'move':headAt(X,Y)?'text':'';
  });
  const end=()=>{ if(!drag) return; const d=drag; drag=null; O.classList.remove('dragging'); syncSafe(false); guides(null,null);
    if(d.moved){ commit(); if(App.advOpen&&App.advTab==='brand') buildAdv(); } };
  O.addEventListener('pointerup',end); O.addEventListener('pointercancel',end);
  O.addEventListener('pointerleave',()=>{ if(!drag) hovRole=null; });
  O.addEventListener('dblclick',e=>{ const [X,Y]=toFrame(e), b=hitAt(X,Y,10); if(b&&b.role!=='logo'){ select(b.role); startEdit(); return; }
    // MIDI / Score writes its own words at its head: double-clicking them goes to their field in the panel
    const part=!b&&headAt(X,Y), inp=part&&document.querySelector(`#panel .hdr-row[data-part="${part}"] input`);
    if(inp){ inp.focus(); inp.select(); } });

  /* the small toolbar that rides above a selection */
  const COLS=[['ink','Auto'],['dim','Soft'],['white','White'],['black','Black']];
  function buildTool(){
    const role=cur, ov=ovOf(role), vs=vsOf(App.vid), st=curStyle(App.vid,brandOf(vs)), C=lookColors(App.vid,vs), base=st[role]||{};
    tool.innerHTML='';
    if(editing){
      const it=App.brand[role]; const inp=h('input',{class:'tb-in',value:it.text,spellcheck:'false','aria-label':'Edit '+ROLE_LABEL[role].toLowerCase(),maxlength:80});
      inp.addEventListener('input',()=>{ it.text=inp.value; it.auto=false; const pi=document.querySelector(`.brow[data-role="${role}"] input`); if(pi) pi.value=inp.value; });
      const done=()=>{ if(!editing) return; editing=null; toolKey=''; commit(); tick(); };
      inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); done(); } });
      inp.addEventListener('blur',done);
      tool.append(inp); tool.classList.add('edit'); setTimeout(()=>{ inp.focus(); inp.select(); },0); return;
    }
    tool.classList.remove('edit');
    const btn=(label,tip,fn,cls)=>h('button',{class:'tb'+(cls?' '+cls:''),'data-tip':tip,onclick:e=>{ e.stopPropagation(); fn(); }},label);
    if(role==='logo'){
      const now=ov.treat||'auto', order=['auto',...LOGO_TREATS.map(t=>t.v)], shown=now==='auto'?(base.treat||'mono'):now, lab=LOGO_TREATS.find(t=>t.v===shown).label;
      tool.append(btn(lab,'Next treatment: Original, Mono, White, Black, Watermark',()=>{ ov.treat=order[(order.indexOf(now)+1)%order.length]; if(ov.treat==='auto') ov.treat=undefined; buildBrandBlock(); commit(); toolKey=''; }));
    } else {
      tool.append(btn('Edit','Edit the text (or double-click it)',startEdit));
      const cc=ov.color||base.color||'ink';
      tool.append(h('span',{class:'tb-dots'},COLS.map(([k,l])=>h('button',{class:'tb-dot','aria-label':l,'data-tip':l,'aria-pressed':cc===k,style:`--c:${roleColor(k,C)}`,onclick:e=>{ e.stopPropagation(); ov.color=k; commit(); toolKey=''; }}))));
    }
    if(ov.scale!=null||ov.dx||ov.dy) tool.append(btn('Reset','Back to the style’s size and place',()=>{ delete ov.scale; delete ov.dx; delete ov.dy; BrandLayer.redrawNow(); commit(); toolKey=''; }));
    tool.append(h('button',{class:'tb ico-tb','aria-label':'Remove','data-tip':'Remove (Delete)',html:ICON.close,onclick:e=>{ e.stopPropagation(); const r=cur; select(null); removeBrand(r); }}));
  }
  function startEdit(){ if(!cur||cur==='logo') return; editing=cur; toolKey=''; tick(); }
  function tick(){
    if(cur&&!App.brand[cur]) cur=null;
    // nothing selected or hovered (the usual case, every frame): nothing to place, so no layout read either
    if(!cur&&!hovRole){ sel.classList.toggle('on',false); hov.classList.toggle('on',false); tool.classList.toggle('on',false); toolKey=''; return; }
    const rec=Recorder.busy(), r=rect();
    const b=cur&&!rec?boxOf(cur):null, hb=hovRole&&!rec?boxOf(hovRole):null;
    sel.classList.toggle('on',!!b); hov.classList.toggle('on',!!hb&&!drag);
    if(hb) place(hov,hb,r);
    if(!b){ tool.classList.remove('on'); toolKey=''; return; }
    place(sel,b,r);
    const ov=ovOf(cur), key=[cur,editing,ov.treat,ov.color,ov.scale!=null||!!ov.dx||!!ov.dy,App.neg,vsOf(App.vid).look].join('|');
    if(key!==toolKey){ toolKey=key; buildTool(); }
    tool.classList.toggle('on',!drag);
    const k=r.width/BW, tw=tool.offsetWidth, th=tool.offsetHeight;
    let tx=(b.x0+b.x1)/2*k-tw/2, ty=b.y0*k-PAD-th-8; if(ty<6) ty=b.y1*k+PAD+8;
    tool.style.left=clamp(tx,6,r.width-tw-6)+'px'; tool.style.top=clamp(ty,6,r.height-th-6)+'px';
  }
  brandOverlayTick=tick;
  /* keys while something is selected: arrows move (Shift = 10x), Delete removes, Esc deselects */
  function key(e){
    if(!cur||App.view!=='ws'||editing||Recorder.busy()) return false;
    const k=e.key;
    if(k==='Escape'){ select(null); return true; }
    if(k==='Delete'||k==='Backspace'){ const r=cur; select(null); removeBrand(r); return true; }
    if(k==='Enter'&&cur!=='logo'){ startEdit(); return true; }
    const step=e.shiftKey?40:4, m={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[k];
    if(m){ const ov=ovOf(cur), b=boxOf(cur); if(b){ ov.dx=(ov.dx||0)+clamp(m[0],-b.x0,BW-b.x1); ov.dy=(ov.dy||0)+clamp(m[1],-b.y0,BH-b.y1); BrandLayer.redrawNow(); }
      clearTimeout(keyT); keyT=setTimeout(()=>{ commit(); if(App.advOpen&&App.advTab==='brand') buildAdv(); },500); return true; }
    return false;
  }
  return {select,key,tick,get selected(){ return cur; },startEdit};
})();
/* =============================================================== ACCOUNT
   The account lives in the background: nothing in VYRAL requires it, and signing in
   never interrupts the work (a popup is used where possible; if the browser blocks it,
   the page redirects and everything you were doing is put back when you return).

   ├── AUTH_CONFIG ........ which provider, and its public keys (empty = not connected yet)
   ├── Auth ............... provider-agnostic API used by the UI:
   │                          init · signInWith('google'|'apple') · emailStart · emailVerify
   │                          signOut · identities · link(provider) · on(fn)
   ├── SupabaseBackend .... the one backend implemented today (Supabase Auth, PKCE flow).
   │                        OAuth codes, tokens and sessions are handled by the official SDK
   │                        and verified by the server; this file never reads a token.
   ├── HiveUser ........... VYRAL's own user shape, independent of any provider:
   │                          { id, email, emailIsRelay, displayName, avatar, createdAt,
   │                            identities:[{provider,email}] }
   └── UI ................. header control, compact menu, sign-in sheet, account sheets.

   Account linking is the server's job: Supabase links sign-ins that share a verified email
   to one user, and "Connect Google / Apple" in Account uses linkIdentity() for everything
   else (e.g. Apple's private relay address). The client never merges accounts itself.    */

const AUTH_CONFIG=Object.assign({ provider:'supabase', url:'', anonKey:'', apple:true, sdk:'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
  // seconds an emailed sign-in code stays valid: keep equal to Supabase → Authentication → Sign In / Providers → Email → Email OTP Expiration (default 3600)
  emailOtpExpiry:3600 },
  window.VYRAL_AUTH||{});

const AVATAR_BUCKET='avatars';
const isRelayEmail=e=>/@privaterelay\.appleid\.com$/i.test(e||'');
function toHiveUser(u,profile){
  if(!u) return null;
  const md=u.user_metadata||{}, email=u.email||null, relay=isRelayEmail(email);
  const identities=(u.identities||[]).map(i=>({provider:i.provider==='email'?'email':i.provider, email:(i.identity_data&&i.identity_data.email)||null}));
  const name=(profile&&profile.display_name)||md.full_name||md.name||(email&&!relay?email.split('@')[0]:'');
  return { id:u.id, email, emailIsRelay:relay, displayName:name||'Your account', avatar:(profile&&profile.avatar_url)||md.avatar_url||md.picture||null,
    createdAt:(profile&&profile.created_at)||u.created_at||null, identities };
}

/* ---------------- Supabase Auth backend ---------------- */
const SupabaseBackend={
  client:null,
  async load(){
    if(!window.supabase) await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=AUTH_CONFIG.sdk; s.onload=res; s.onerror=()=>rej(new Error('sdk')); document.head.append(s); });
    this.client=window.supabase.createClient(AUTH_CONFIG.url,AUTH_CONFIG.anonKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  },
  async current(){ const {data}=await this.client.auth.getSession(); return data.session?data.session.user:null; },
  // which sign-in providers the project has switched on (public endpoint, same public key)
  async providers(){ const r=await fetch(AUTH_CONFIG.url+'/auth/v1/settings',{headers:{apikey:AUTH_CONFIG.anonKey}}); if(!r.ok) throw new Error('settings '+r.status); const j=await r.json(); return j.external||null; },
  async profile(uid){   // VYRAL's own row; readable only by its owner (row-level security)
    try{ const {data,error}=await this.client.from('hive_users').select('display_name,avatar_url,created_at').eq('id',uid).maybeSingle(); return error?null:data; }catch(e){ return null; } },
  // never call Supabase from inside its own auth callback (it holds a lock there); hand off to the next tick
  onChange(fn){ this.client.auth.onAuthStateChange((ev,session)=>{ setTimeout(()=>fn(ev,session?session.user:null),0); }); },
  async oauthUrl(provider,redirectTo){ const {data,error}=await this.client.auth.signInWithOAuth({provider,options:{redirectTo,skipBrowserRedirect:true}}); if(error) throw error; return data.url; },
  async emailStart(email,create,redirectTo){ const {error}=await this.client.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:redirectTo}}); if(error) throw error; },
  async emailVerify(email,token){ const {error}=await this.client.auth.verifyOtp({email,token,type:'email'}); if(error) throw error; },
  async signOut(){ const {error}=await this.client.auth.signOut(); if(error){ console.error('[VYRAL auth] sign-out on the server failed, clearing this browser',error); const r=await this.client.auth.signOut({scope:'local'}); if(r.error) throw r.error; } },
  async identities(){ const {data,error}=await this.client.auth.getUserIdentities(); if(error) throw error; return (data.identities||[]).map(i=>i.provider); },
  async linkUrl(provider,redirectTo){ const {data,error}=await this.client.auth.linkIdentity({provider,options:{redirectTo,skipBrowserRedirect:true}}); if(error) throw error; return data.url; },
  // --- profile & account (every call runs as the signed-in user; row-level security decides what it may touch)
  async saveProfile(uid,patch){
    const up=await this.client.from('hive_users').update(patch).eq('id',uid).select('id'); if(up.error) throw up.error;
    if(!up.data||!up.data.length){ const ins=await this.client.from('hive_users').insert(Object.assign({id:uid},patch)); if(ins.error) throw ins.error; } },
  async uploadAvatar(uid,blob){   // <bucket>/<user id>/avatar-<time>.jpg: storage policies only let a user write inside their own folder
    const path=uid+'/avatar-'+Date.now()+'.jpg', b=this.client.storage.from(AVATAR_BUCKET);
    const {error}=await b.upload(path,blob,{contentType:'image/jpeg',cacheControl:'31536000',upsert:false}); if(error) throw error;
    return b.getPublicUrl(path).data.publicUrl; },
  async removeAvatar(uid,url){ const k=(url||'').split('/storage/v1/object/public/'+AVATAR_BUCKET+'/')[1]; if(!k) return; const path=decodeURIComponent(k.split('?')[0]);
    if(!path.startsWith(uid+'/')) return; const {error}=await this.client.storage.from(AVATAR_BUCKET).remove([path]); if(error) throw error; },
  async changeEmail(email,redirectTo){ const {error}=await this.client.auth.updateUser({email},{emailRedirectTo:redirectTo}); if(error) throw error; },
  async signOutAll(){ const {error}=await this.client.auth.signOut({scope:'global'}); if(error){ console.error('[VYRAL auth] global sign-out failed on the server, clearing this browser',error); const r=await this.client.auth.signOut({scope:'local'}); if(r.error) throw r.error; } },
  async rpc(fn,args){ const {data,error}=await this.client.rpc(fn,args||{}); if(error) throw error; return data; },   // license + renders (vyral_license.sql)
  async invoke(fn,body){ const {data,error}=await this.client.functions.invoke(fn,{body}); if(error) throw error; return data; },   // server-side billing endpoints (not deployed yet)
};

/* ---------------- provider-agnostic API ---------------- */
const Auth={
  user:null, ready:false, subs:new Set(), be:null,
  on(fn){ this.subs.add(fn); }, emit(){ this.subs.forEach(f=>{ try{ f(this.user); }catch(e){ console.error('[VYRAL auth] listener failed',e); } }); },
  /* the key in the page must be the PUBLIC one (publishable / legacy anon). A secret or
     service_role key is refused outright so it can never be used from the browser. */
  keyProblem(){
    const k=(AUTH_CONFIG.anonKey||'').trim();
    if(!AUTH_CONFIG.url) return 'missing-url';
    if(!k||/^(PASTE|YOUR)_/i.test(k)) return 'missing-key';
    if(/^sb_secret_/i.test(k)) return 'secret-key';
    if(/^eyJ/.test(k)){ try{ const p=JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if(p.role&&p.role!=='anon') return 'secret-key'; }catch(e){ return 'bad-key'; } }
    return null;
  },
  configured(){ return !this.keyProblem(); },
  servedFromFile(){ return location.protocol==='file:'; },
  status(){   // why sign-in can or can't run here, in plain words
    const kp=this.keyProblem();
    if(kp==='missing-url') return {ok:false,msg:'Sign-in isn’t connected in this build yet.'};
    if(kp==='missing-key') return {ok:false,dev:true,msg:'Setup needed: add the project’s public Supabase key to window.VYRAL_AUTH.anonKey in METHOD.html.'};
    if(kp==='secret-key') return {ok:false,dev:true,msg:'The key in VYRAL_AUTH is a secret key. Use the public (publishable / anon) key instead, and rotate the secret one.'};
    if(kp==='bad-key') return {ok:false,dev:true,msg:'The key in VYRAL_AUTH doesn’t look like a Supabase public key.'};
    if(this.servedFromFile()) return {ok:false,msg:'Sign-in works once METHOD is opened from its web address, not from a file on your computer.'};
    if(!this.be) return {ok:false,msg:'Couldn’t reach the sign-in service. Check your connection and try again.'};
    return {ok:true};
  },
  callbackUrl(){ return location.origin+location.pathname; },
  async init(){
    if(!this.configured()||this.servedFromFile()){ const kp=this.keyProblem(); if(kp&&kp!=='missing-url') console.warn('[VYRAL auth] '+this.status().msg);
      this.ready=true; this.emit(); return; }
    try{
      await SupabaseBackend.load(); this.be=SupabaseBackend;
      this.be.providers().then(x=>{ this.providersOn=x; }).catch(e=>console.warn('[VYRAL auth] could not read provider settings',e));
      // show the signed-in state straight from the session; VYRAL's own profile row follows when it arrives
      const set=async u=>{ const known=u&&this._p&&this._p.id===u.id?this._p.row:null; this._u=u||null; this.user=u?toHiveUser(u,known):null; this.ready=true; this.emit();
        if(!u) return; const p=await Promise.race([this.be.profile(u.id),new Promise(r=>setTimeout(()=>r(null),6000))]);
        if(p&&this.user&&this.user.id===u.id){ this._p={id:u.id,row:p}; this.user=toHiveUser(u,p); this.emit(); } };
      this.be.onChange((ev,u)=>{ set(u); if(ev==='SIGNED_IN'&&AuthUI.pending){ AuthUI.pending=false; closeModal(); toast('Signed in. Carry on where you were.'); } });
      await set(await this.be.current());
      // arrived back from a redirect sign-in: tidy the address bar
      if(/[?&](code|error|error_description)=/.test(location.search)||/error_description=/.test(location.hash)){
        const q=new URLSearchParams(location.search+'&'+location.hash.replace(/^#/,'')), err=q.get('error_description')||q.get('error');
        history.replaceState(null,'',location.pathname+(location.hash.includes('error')?'':location.hash));
        if(err){ console.error('[VYRAL auth] provider returned an error:',q.get('error'),err); this.returnError=err; } }
    }catch(e){ console.error('[VYRAL auth] could not start the Supabase client',e); this.loadError=e; this.ready=true; this.emit(); }
  },
  /* OAuth by full-page redirect (Supabase's standard browser flow). Google's sign-in pages cut the
     link to a popup's opener, so a popup can't report back reliably; instead the track, settings and
     branding are set aside first and put back when the browser returns to this page. */
  async oauth(provider,link){
    const st=this.status(); if(!st.ok) throw Object.assign(new Error(st.msg),{plain:true});
    if(provider==='apple'&&this.providersOn&&this.providersOn.apple===false){ console.warn('[VYRAL auth] the Apple provider is not enabled in Supabase');
      throw new Error('Apple sign-in isn\u2019t set up for METHOD yet. It has to be switched on in Supabase (Authentication \u2192 Sign In / Providers \u2192 Apple) first.'); }
    const url=link?await this.be.linkUrl(provider,this.callbackUrl()):await this.be.oauthUrl(provider,this.callbackUrl());
    await Resume.save(); location.assign(url);
  },
  signInWith(p){ return this.oauth(p,false); },
  link(p){ return this.oauth(p,true); },
  async emailStart(email,create){ const st=this.status(); if(!st.ok) throw new Error(st.msg); await this.be.emailStart(email,create,this.callbackUrl()); },
  async emailVerify(email,code){ await this.be.emailVerify(email,code); },
  async signOut(){ if(this.be) await this.be.signOut(); this.user=null; this.emit(); },
  async identities(){ if(!this.be) return (this.user?this.user.identities:[]).map(i=>i.provider); return this.be.identities(); },
  /* account page */
  _ok(){ const st=this.status(); if(!st.ok) throw new Error(st.msg); if(!this.user) throw new Error('not signed in'); },
  _merge(patch){ if(!this.user) return; const row=Object.assign({},this._p&&this._p.id===this.user.id?this._p.row:{},patch); this._p={id:this.user.id,row};
    this.user=this._u?toHiveUser(this._u,row):Object.assign({},this.user,{displayName:row.display_name||this.user.displayName,avatar:row.avatar_url||this.user.avatar}); this.emit(); },
  profileName(){ const r=this.user&&this._p&&this._p.id===this.user.id?this._p.row:null; return (r&&r.display_name)||(this.user&&this.user.displayName!=='Your account'?this.user.displayName:''); },
  async updateProfile({displayName}){ this._ok(); const name=(displayName||'').trim().slice(0,60); if(!name) throw new Error('empty name');
    await this.be.saveProfile(this.user.id,{display_name:name}); this._merge({display_name:name}); },
  async setAvatar(blob){ this._ok(); const uid=this.user.id, prev=this._p&&this._p.id===uid?this._p.row.avatar_url:null;
    const url=await this.be.uploadAvatar(uid,blob); await this.be.saveProfile(uid,{avatar_url:url}); this._merge({avatar_url:url});
    if(prev&&prev!==url) this.be.removeAvatar(uid,prev).catch(e=>console.warn('[VYRAL account] old photo not removed',e)); return url; },
  async changeEmail(email){ this._ok(); await this.be.changeEmail(email,this.callbackUrl()); },
  async signOutEverywhere(){ if(this.be) await this.be.signOutAll(); this.user=null; this.emit(); },
};

/* ---------------- continue where you left off (redirect sign-in only) ----------------
   Settings go to sessionStorage, the track and logo files to IndexedDB, for 30 minutes. */
const Resume={
  db(){ return new Promise((res,rej)=>{ const r=indexedDB.open('vyral-resume',1); r.onupgradeneeded=()=>r.result.createObjectStore('f'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); },
  async put(k,v){ const db=await this.db(); await new Promise((res,rej)=>{ const t=db.transaction('f','readwrite'); t.objectStore('f').put(v,k); t.oncomplete=res; t.onerror=()=>rej(t.error); }); },
  async get(k){ const db=await this.db(); return new Promise((res,rej)=>{ const t=db.transaction('f','readonly'), q=t.objectStore('f').get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); },
  async save(){
    try{
      const logo=App.brand.logo&&Logos[App.brand.logo.id];
      sessionStorage.setItem('vyral.resume',JSON.stringify({at:Date.now(),hash:location.hash,vs:App.vs,brand:App.brand,clip:App.clip,
        logo:logo?{id:App.brand.logo.id,name:logo.name,data:logo.dataURL}:null,track:AudioEngine.file?AudioEngine.file.name:null}));
      if(AudioEngine.file) await this.put('track',AudioEngine.file);
    }catch(e){ console.error(e); }
  },
  async restore(){
    let r; try{ r=JSON.parse(sessionStorage.getItem('vyral.resume')||'null'); sessionStorage.removeItem('vyral.resume'); }catch(e){ return; }
    if(!r||Date.now()-r.at>30*60*1000) return;
    Object.assign(App.vs,r.vs||{}); App.clip=r.clip||App.clip;
    if(r.logo){ try{ const id=await importLogoData(r.logo.data,r.logo.name); if(r.brand.logo) r.brand.logo.id=id; }catch(e){ r.brand.logo=null; } }
    App.brand=r.brand||App.brand;
    if(r.hash&&r.hash!==location.hash) location.hash=r.hash; else route();
    if(r.track){ try{ const b=await this.get('track'); if(b) await loadFile(new File([b],r.track,{type:b.type})); }catch(e){ console.error(e); } }
    AudioEngine.pause&&AudioEngine.pause();
  },
};

/* ---------------- license, renders and the feature gate ----------------
   VYRAL is a ONE-TIME purchase (LICENSE.price), attached to the account. The server is the authority:
     auth.users → hive_users → hive_entitlements (the license; written only by server code: the Shopify
     webhook (shopify-webhook), or the SQL Editor tools for testing, and during the private beta claim_private_beta_license)
     → hive_render_usage (free renders, moved only by the authorize_render function, atomically)
   The page asks: vyral_status() to show the plan, authorize_render() before every recording.
   What it keeps here (License.state) is only a copy for display and for greying out controls; it
   never decides whether a render is allowed.
   Honest limits: rendering happens in the browser, so a determined user who edits the page could
   record without asking, or strip the watermark. The server still decides who is licensed and what
   counts; the watermark and gates are product differentiation, not DRM.
   Buying: METHOD → Supabase Edge Function license-checkout → a Shopify checkout → the Shopify webhook (shopify-webhook)
   → hive_entitlements. Never the success page. Until Shopify is live LICENSE.buy stays false ("Purchasing opens soon"). */
const LICENSE={ price:'$30', buy:true, checkoutFn:'license-checkout' };   // every price on the page reads LICENSE.price
const License={
  state:{ plan:'guest', loaded:false, freeLimit:2, freeRemaining:null, purchasedAt:null },
  subs:new Set(), uid:undefined,
  on(fn){ this.subs.add(fn); }, emit(){ this.subs.forEach(f=>{ try{ f(this.state); }catch(e){ console.error('[VYRAL license] listener failed',e); } }); },
  get licensed(){ return this.state.plan==='licensed'; },
  set(d){ const s=this.state;
    if(d.plan) s.plan=d.plan; if(d.free_limit!=null) s.freeLimit=d.free_limit; if(d.free_remaining!=null) s.freeRemaining=d.free_remaining;
    if('purchased_at' in d) s.purchasedAt=d.purchased_at; s.loaded=true; this.emit(); },
  async refresh(){
    if(!Auth.user||!Auth.be){ this.state={ plan:Auth.user?'free':'guest', loaded:!Auth.user, freeLimit:2, freeRemaining:null, purchasedAt:null }; this.emit(); return; }
    try{ this.set(await Auth.be.rpc('vyral_status')); }
    catch(e){ console.warn('[VYRAL license] could not read the plan (is vyral_license.sql installed?)',e); this.state.plan='free'; this.state.loaded=false; this.emit(); }
  },
  // the only door to a recording: the server approves it, and for a free account uses one free render
  async authorizeRender(vis){
    if(!Auth.user) return {ok:false,reason:'AUTH_REQUIRED'};
    if(!Auth.be) return {ok:false,reason:'UNAVAILABLE'};
    try{ const r=await Auth.be.rpc('authorize_render',{p_visualizer:vis||null}); if(r&&r.plan) this.set(r); return r||{ok:false,reason:'UNAVAILABLE'}; }
    catch(e){ console.error('[VYRAL license] authorize_render failed',e); return {ok:false,reason:'UNAVAILABLE'}; }
  },
  async checkout(){   // the Edge Function license-checkout answers { url } (a Shopify checkout); the Shopify webhook grants the license
    if(!LICENSE.buy||!Auth.be||!Auth.user) throw new Error('purchasing is not connected yet');
    const r=await Auth.be.invoke(LICENSE.checkoutFn,{returnUrl:Auth.callbackUrl()+'#/account/plan'}); location.assign(r.url);
  },
};
Auth.on(u=>{ const id=u?u.id:null; if(id!==License.uid){ License.uid=id; setTimeout(()=>License.refresh().catch(e=>console.warn('[VYRAL license]',e)),0); } });

/* ---------------- TEMPORARY PRIVATE BETA AUTO-LICENSE — DISABLE BEFORE PUBLIC LAUNCH ----------------
   Switch: METHOD_PRIVATE_BETA_AUTO_LICENSE in the account config (anything but true = off, and nothing is asked).
   When the session is established and the server reads the plan as Free, the page asks once per account per
   page load: claim_private_beta_license() runs in Postgres for auth.uid() only (method_private_beta_license.sql),
   adds a 'test' license where the account has none and never changes an existing license row. The page writes
   nothing itself; it only re-reads the plan, so Get access, the watermark, Advanced and MIDI export follow. */
const BetaLicense={
  asked:new Set(),   // accounts already asked in this page load
  on(){ return typeof METHOD_PRIVATE_BETA_AUTO_LICENSE!=='undefined'&&METHOD_PRIVATE_BETA_AUTO_LICENSE===true; },
  async claim(S){
    const u=Auth.user;
    if(!this.on()||!u||!Auth.be||!S.loaded||S.plan!=='free'||this.asked.has(u.id)) return;
    this.asked.add(u.id);
    try{
      const r=await Auth.be.rpc('claim_private_beta_license');
      if(r&&r.ok){ if(Auth.user&&Auth.user.id===u.id) await License.refresh(); }
      else console.info('[METHOD beta] no beta license for this account:',r&&r.reason);
    }catch(e){ console.warn('[METHOD beta] could not ask for the beta license (is method_private_beta_license.sql installed?)',e); }
  },
};
License.on(S=>{ BetaLicense.claim(S); });

/* The feature gate: the ONE place that says what needs the license. Ask canUse(feature).
   FREE      explore and create: every visualizer, the main panel (Controls, camera / style modes), the signature
             looks, Branding layouts and quick edits on the picture, Negative, and 2 renders with the VYRAL mark
   LICENSED  the full production tool: the Advanced panel (the visualizer's own controls, Effects, Color, the
             Branding type controls), the thermal and spectrum looks, MIDI export, unlimited renders without the mark
   Keys: visualizer.<id> · skin.<visualizer>.<look> (MIDI / Score: skin.graphite …) · advanced.<visualizer>.<param>
         (one control) · advanced.visualizer / .effects / .color / .branding (the Advanced panel's tabs) · midi.export
   Anything not listed is free. Licensed features stay visible with a quiet lock; using one opens the one purchase
   sheet (LicenseUI.explain). Renders (count, watermark) are not here: authorize_render on the server decides those. */
const FEATURE_TIERS={
  'advanced.visualizer':'licensed', 'advanced.effects':'licensed', 'advanced.color':'licensed', 'advanced.branding':'licensed',
  'midi.export':'licensed',
  // the multi-colour heat-map and spectrum looks; every visualizer keeps its signature looks free
  'skin.spatial.thermal':'licensed',
  'skin.volume.solar':'licensed', 'skin.volume.signal':'licensed', 'skin.volume.dusk':'licensed',
};
const LICENSE_INCLUDES='Unlimited renders and stills without the METHOD mark, the Advanced panel (visualizer controls, effects, colour and type), the thermal and spectrum looks, and MIDI export.';
const Feature={
  vis:E=>E.feature||'visualizer.'+E.id,
  look:(E,L)=>L.feature||'skin.'+E.id+'.'+L.k,
  param:(E,p)=>p.feature||'advanced.'+E.id+'.'+p.k,
};
function featureTier(f){ return FEATURE_TIERS[f]||'free'; }
function canUse(f){ return featureTier(f)!=='licensed'||License.licensed; }
const LOCK_ICON='<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2.2" y="5.2" width="7.6" height="5.6" rx="1.2" fill="currentColor"/><path d="M3.9 5.4V3.9a2.1 2.1 0 0 1 4.2 0v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const lockMark=()=>h('span',{class:'lock-i','aria-hidden':'true',html:LOCK_ICON});

/* the quiet "this is part of the license" sheet */
const LicenseUI={
  explain(why){
    const S=License.state, m=$('#modal'), body=$('#modalBody'); body.innerHTML='';
    const lead=why==='FREE_RENDER_LIMIT'?'You\u2019ve used your '+S.freeLimit+' free renders.':why==='BUY'?'The METHOD license':why==='ADVANCED'?'Advanced is part of the METHOD license.':'This is part of the METHOD license.';
    const msg=h('p',{class:'au-err',role:'status'});
    const buy=h('button',{class:'au-btn primary',onclick:async()=>{
      if(!Auth.user){ closeModal(); toast('Sign in first — the license is attached to your account.'); return AuthUI.signIn('in'); }
      if(!LICENSE.buy){ msg.className='au-sub'; msg.textContent='Purchasing opens soon.'; return; }
      try{ await License.checkout(); }catch(e){ console.error('[VYRAL license]',e); msg.className='au-err'; msg.textContent='Something went wrong. Please try again.'; } }},'Get METHOD — '+LICENSE.price);
    body.append(h('div',{class:'modal-card auth lic'},h('div',{class:'au-mark'},'METHOD'),h('h2',{},lead),
      h('p',{class:'au-sub'},LICENSE_INCLUDES),
      buy,h('p',{class:'au-fine'},'One-time purchase \u00b7 No subscription'),msg,h('p',{class:'au-alt'},h('button',{class:'link',onclick:()=>closeModal()},'Not now'))));
    m.classList.add('on');
  },
};

/* ---------------- gift licenses: <VYRAL address>#/redeem/<CODE> ----------------
   The code is the gift: random, single use; the server keeps only its hash. Opening the link activates nothing.
   The friend signs in with the usual sheet (Google or email), then presses Activate: redeem_gift_license() runs in
   Postgres for auth.uid() and writes the same license row a purchase writes (source 'gift'). The page then only
   re-reads the plan (License.refresh), so Get access, the watermark, Advanced and MIDI export follow the server.
   A Google sign-in leaves the page: the address, code included, comes back with the rest of the work (Resume). */
const Gift={
  code:null, state:null, result:null, busy:false, card:null, pend:null,
  codeOf(hash){ const m=/^#\/redeem\/([0-9A-Za-z-]{16,40})\/?$/.exec(hash||''); return m?m[1].toUpperCase():null; },
  shown(){ return !!(this.card&&this.card.isConnected&&$('#modal').classList.contains('on')); },
  // what the server says about this code: pending / redeemed / revoked / not_found (needs the exact code)
  open(){
    const code=this.codeOf(location.hash); if(!code) return;
    if(code!==this.code){ this.code=code; this.state=null; this.result=null; this.pend=null; }
    this.render();                                     // "checking" until the sign-in service and the gift answer
    if(!Auth.ready||this.state||this.pend) return;     // Auth.on opens it again once the session is known; one check at a time
    if(!Auth.be){ this.state='error'; return this.render(); }
    const p=this.pend=Auth.be.rpc('vyral_gift_state',{p_code:code})
      .then(r=>{ if(this.pend===p) this.state=(r&&r.state)||'not_found'; })
      .catch(e=>{ console.error('[VYRAL gift] could not check the gift',e); if(this.pend===p) this.state='error'; })
      .finally(()=>{ if(this.pend===p){ this.pend=null; if(this.code===code) this.render(); } });
  },
  render(){
    const S=License.state, u=Auth.user, st=this.result||this.state, m=$('#modal'), body=$('#modalBody');
    const card=h('div',{class:'modal-card auth gift'},h('div',{class:'au-mark'},'METHOD'));
    const title=t=>h('h2',{},t), sub=t=>h('p',{class:'au-sub'},t), btn=(t,fn)=>h('button',{class:'au-btn primary',onclick:fn},t);
    const onward=()=>btn('Continue to METHOD',()=>this.leave());
    if(!st) card.append(title('Your METHOD gift'),sub('Checking the link…'));
    else if(st==='error') card.append(title('The gift couldn’t be checked'),sub('Check your connection and try again.'),btn('Try again',()=>{ this.state=null; this.result=null; this.open(); }));
    else if(st==='not_found') card.append(title('Gift link not found'),sub('Check the link, or ask the person who sent it.'),onward());
    else if(st==='redeemed') card.append(title('This gift has already been redeemed.'),onward());
    else if(st==='revoked') card.append(title('This gift is no longer available.'),onward());
    else if(st==='mine') card.append(title('This gift is already active on your account.'),onward());
    else if(st==='done') card.append(title('License activated'),sub('METHOD is now unlocked for this account.'),onward());
    else if(!u) card.append(title('You’ve been given METHOD access.'),sub('One-time license · Full access'),
      btn('Sign in to redeem',()=>AuthUI.signIn('in')),h('p',{class:'au-alt'},'New to METHOD? You can create your account in the next step.'));
    else if(st==='have'||S.plan==='licensed') card.append(title('You already have METHOD access.'),sub('This gift stays unused, so it can go to someone else.'),onward());
    else { const go=btn(this.busy?'Activating…':'Activate license',()=>this.redeem()); go.disabled=this.busy;
      card.append(title('Gift license'),sub('This will activate METHOD on:'),h('p',{class:'gift-who'},u.emailIsRelay?'your Apple account':(u.email||u.displayName)),go,
        h('p',{class:'au-alt'},h('button',{class:'link',onclick:()=>this.otherAccount()},'Use another account'))); }
    body.innerHTML=''; body.append(card); this.card=card; m.classList.add('on');
  },
  // the only step that activates anything, and it happens on the server
  async redeem(){
    if(this.busy||!this.code||!Auth.user||!Auth.be) return;
    this.busy=true; this.render();
    let r=null; try{ r=await Auth.be.rpc('redeem_gift_license',{p_code:this.code}); }catch(e){ console.error('[VYRAL gift] redeem failed',e); }
    this.busy=false;
    const why=r&&r.reason;
    this.result=r&&r.ok?'done':({ALREADY_LICENSED:'have',ALREADY_YOURS:'mine',ALREADY_REDEEMED:'redeemed',REVOKED:'revoked',NOT_FOUND:'not_found'})[why]||(why==='AUTH_REQUIRED'?null:'error');
    await License.refresh().catch(e=>console.warn('[VYRAL license]',e));   // the plan as the server now has it
    this.render();
  },
  async otherAccount(){ try{ await Auth.signOut(); }catch(e){ console.error('[VYRAL auth]',e); } this.render(); },
  // back to VYRAL, and the code leaves the address bar
  leave(){ this.code=null; this.state=null; this.result=null; this.card=null; closeModal();
    if(this.codeOf(location.hash)) history.replaceState(null,'',location.pathname+location.search+'#/'); route(); },
  close(){ this.card=null; closeModal(); },
};
// signing in or out while a gift link is open: the sheet follows (after an email code, the sign-in sheet has closed itself)
Auth.on(()=>{ if(!Auth.ready||!Gift.codeOf(location.hash)) return;
  if(!Gift.state) return Gift.open();
  if(Gift.shown()||!$('#modal').classList.contains('on')) Gift.render(); });
License.on(()=>{ if(Gift.shown()&&!Gift.busy) Gift.render(); });

/* ================================================================== UI */
const ACCT_ICON='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="7.2" r="3.2"/><path d="M3.8 16.6c1.1-2.7 3.4-4.1 6.2-4.1s5.1 1.4 6.2 4.1" stroke-linecap="round"/></svg>';
const G_LOGO='<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
/* Google from METHOD's own address: Google's button returns an ID token and Supabase checks it (signInWithIdToken),
   so Google's window names this site instead of the Supabase project. If Google's script can't load, our button
   stays and signs in by redirect as before. */
const GSI={
  p:null,
  load(){ if(this.p) return this.p; return this.p=new Promise((res,rej)=>{ if(window.google&&google.accounts&&google.accounts.id) return res();
    const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true; s.onload=()=>res(); s.onerror=()=>{ this.p=null; rej(new Error('gsi')); };
    document.head.append(s); setTimeout(()=>rej(new Error('gsi timeout')),6000); }); },
  async render(box,mode,done,fail){
    if(!Auth.be||!Auth.be.client) throw new Error('auth not ready');
    await this.load();
    const raw=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const hashed=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
    google.accounts.id.initialize({client_id:AUTH_CONFIG.googleClientId,nonce:hashed,ux_mode:'popup',itp_support:true,context:mode==='create'?'signup':'signin',
      callback:async r=>{ try{ const {error}=await Auth.be.client.auth.signInWithIdToken({provider:'google',token:r.credential,nonce:raw}); if(error) throw error; done&&done(); }catch(e){ fail(e); } }});
    const w=Math.max(200,Math.min(400,Math.round(box.getBoundingClientRect().width||320)));
    box.innerHTML=''; google.accounts.id.renderButton(box,{type:'standard',theme:'outline',size:'large',shape:'rectangular',text:mode==='create'?'signup_with':'continue_with',logo_alignment:'center',width:w});
  }
};
const A_LOGO='<svg viewBox="0 0 17 20" width="15" height="18" aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9C3.5 4.7 1.9 5.7 1 7.3c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.3zM11.5 2.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z"/></svg>';
const initials=n=>((n||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('')||'?').toUpperCase();
function avatarEl(u,size){
  const el=h('span',{class:'av',style:`width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px`});
  if(u&&u.avatar){ const im=h('img',{src:u.avatar,alt:'',referrerpolicy:'no-referrer'}); im.onerror=()=>{ im.remove(); el.textContent=initials(u.displayName); }; el.append(im); }
  else el.textContent=initials(u&&u.displayName);
  return el;
}

/* plain-language versions of what the auth service returns; the raw error always goes to the console */
function humanAuthError(msg){ return /rate|too many/i.test(msg)?'Too many attempts. Please wait a minute and try again.':/token has expired|token.*invalid|invalid otp|otp.*expired/i.test(msg)?'That code didn’t work. Check it, or send a new one.':'Something went wrong. Please try again.'; }
/* the email code screen's own messages. Supabase answers a wrong code and an expired one alike
   (otp_expired: "Token has expired or is invalid"), so the time since the code was sent tells them apart. */
function codeError(e,sentAt){
  const bad=(e&&e.code)==='otp_expired'||/expired or is invalid|token.*(expired|invalid)|invalid.*(otp|token)|otp.*expired/i.test((e&&e.message)||'');
  if(!bad) return 'Something went wrong. Please try again.';
  return Date.now()-sentAt>=(+AUTH_CONFIG.emailOtpExpiry||3600)*1000?'This code has expired. Send a new code.':'Invalid verification code. Try again.';
}
// Supabase sends one address a code at most once a minute by default; when asked sooner it says how many seconds are left
const RESEND_WAIT=60;
const sendWait=e=>{ const m=/after (\d+) seconds?/i.exec((e&&e.message)||''); return m?Math.max(1,+m[1]):0; };

const AuthUI={
  pending:false, pop:null,
  syncButton(){
    const b=$('#acctBtn'), u=Auth.user; b.innerHTML='';
    if(u){ b.append(avatarEl(u,26)); b.setAttribute('aria-label','Account: '+u.displayName); b.setAttribute('data-tip',u.displayName); b.classList.add('in'); }
    else { b.innerHTML=ACCT_ICON; b.setAttribute('aria-label','Account'); b.setAttribute('data-tip','Account'); b.classList.remove('in'); }
    if(this.pop) this.openMenu(true);
  },
  closeMenu(){ if(this.pop){ this.pop.remove(); this.pop=null; $('#acctBtn').setAttribute('aria-expanded','false'); } },
  openMenu(rebuild){
    if(this.pop&&!rebuild){ this.closeMenu(); return; }
    if(this.pop) this.pop.remove();
    const u=Auth.user, item=(label,fn,cls)=>h('button',{class:'am-i'+(cls?' '+cls:''),role:'menuitem',onclick:()=>{ this.closeMenu(); fn(); }},label);
    const pop=h('div',{class:'acct-pop',role:'menu','aria-label':'Account'});
    if(u){
      pop.append(h('div',{class:'am-who'},avatarEl(u,36),h('div',{class:'am-id'},h('b',{},u.displayName),h('span',{},u.emailIsRelay?'Email hidden by Apple':(u.email||'')))));
      pop.append(h('div',{class:'am-sep'}),item('Account',()=>this.account()),item('Settings',()=>this.settings()),
        h('div',{class:'am-sep'}),item('METHOD website',()=>location.assign('/?home'),'sub'),item('Sign out',async()=>{ try{ await Auth.signOut(); toast('Signed out.'); }catch(e){ toast('Couldn’t sign out. Try again.'); } }));
    } else {
      pop.append(
        h('button',{class:'am-g',role:'menuitem',onclick:()=>{ this.closeMenu(); this.signIn('create'); }},'Create account'),
        h('button',{class:'am-g light',role:'menuitem',onclick:()=>{ this.closeMenu(); this.signIn('in'); }},'Sign in'),
        h('div',{class:'am-sep'}),item('Keyboard shortcuts',showKeys,'sub'),item('METHOD website',()=>location.assign('/?home'),'sub'));
    }
    document.body.append(pop); this.pop=pop; $('#acctBtn').setAttribute('aria-expanded','true');
    const f=pop.querySelector('button'); f&&f.focus({preventScroll:true});
  },
  /* the sign-in sheet: Google first, Apple second, then email with a one-time code (no passwords) */
  signIn(mode='in',firstError){
    const m=$('#modal'), body=$('#modalBody'); body.innerHTML='';
    const st=Auth.status(), card=h('div',{class:'modal-card auth signin'});
    let email='';
    const err=h('p',{class:'au-err',role:'alert'});
    const fail=e=>{ console.error('[VYRAL auth]',e); err.textContent=e&&e.plain?e.message:humanAuthError((e&&e.message)||''); };
    const provider=(p)=>async()=>{ err.textContent=''; try{ await Auth.signInWith(p); }catch(e){ fail(e); } };
    const head=(t)=>[h('h2',{},t||(mode==='create'?'Create your METHOD account':'Sign in to METHOD'))];
    if(!st.ok) console.warn('[VYRAL auth]',st.msg);
    const choose=()=>{
      card.innerHTML='';   // sign-in and sign-up open straight on the buttons
      const g=h('button',{class:'au-btn google',onclick:provider('google')},h('span',{class:'au-ic',html:G_LOGO}),'Continue with Google');
      const a=AUTH_CONFIG.apple?h('button',{class:'au-btn apple',onclick:provider('apple')},h('span',{class:'au-ic',html:A_LOGO}),'Continue with Apple'):null;
      // Google's own button takes the place of ours once it has loaded; until then (or if it can't) ours signs in by redirect
      const gw=AUTH_CONFIG.googleClientId&&location.protocol!=='file:'?h('div',{class:'au-gsi'},g):g;
      if(gw!==g) setTimeout(()=>GSI.render(gw,mode,()=>{ closeModal(); toast('Signed in. Carry on where you were.'); },fail)
        .catch(e=>console.warn('[VYRAL auth] Google button unavailable, using the redirect sign-in',e)),0);
      card.append(...[gw,a].filter(Boolean),h('div',{class:'au-or'},h('span',{},'or')),
        h('button',{class:'au-btn email',onclick:emailStep},'Continue with email'),err,
        h('p',{class:'au-alt'},mode==='create'?'Already have an account? ':'Don’t have an account? ',
          h('button',{class:'link',onclick:()=>{ mode=mode==='create'?'in':'create'; err.textContent=''; choose(); }},mode==='create'?'Sign in':'Create one')));
    };
    const emailStep=()=>{
      card.innerHTML=''; err.textContent='';
      const inp=h('input',{class:'bin au-in',type:'email',autocomplete:'email',placeholder:'Email address','aria-label':'Email address',value:email});
      const go=h('button',{class:'au-btn primary',type:'submit'},'Continue');
      const form=h('form',{class:'au-form'},inp,go);
      form.addEventListener('submit',async e=>{ e.preventDefault(); email=inp.value.trim(); if(!/^\S+@\S+\.\S+$/.test(email)){ err.textContent='Enter a valid email address.'; return; }
        go.disabled=true; go.setAttribute('aria-busy','true'); go.textContent='Sending…';
        try{ await Auth.emailStart(email,mode==='create'); codeStep(RESEND_WAIT); }
        catch(x){ const wait=sendWait(x);
          if(wait){ console.warn('[VYRAL auth] a code went to this address moments ago; it still works',x); codeStep(wait); return; }
          fail(x); go.disabled=false; go.removeAttribute('aria-busy'); go.textContent='Continue'; } });
      card.append(...head(mode==='create'?'Sign up with email':'Sign in with email'),form,err,
        h('p',{class:'au-alt'},h('button',{class:'link',onclick:()=>{ err.textContent=''; choose(); }},'Back')));
      setTimeout(()=>inp.focus(),0);
    };
    /* the code screen: Supabase emails a 6-digit code ({{ .Token }} in the email template) and verifyOtp()
       turns it into a session, for new and returning accounts alike. wait = seconds before "Send again" works. */
    const codeStep=(wait)=>{
      card.innerHTML=''; err.textContent='';
      let sentAt=Date.now(), busy=false, sending=false, until=0, tick=0;
      const note=h('p',{class:'au-note',role:'status'});
      const inp=h('input',{class:'bin au-in code',type:'text',inputmode:'numeric',pattern:'[0-9]*',autocomplete:'one-time-code',enterkeyhint:'go',
        autocapitalize:'off',spellcheck:'false',placeholder:'6-digit code','aria-label':'Verification code'});
      const go=h('button',{class:'au-btn primary',type:'submit',disabled:true},'Continue');
      const form=h('form',{class:'au-form',novalidate:true},inp,go);
      // digits only, six at most: spaces, dashes and anything else typed or pasted are dropped
      const digits=()=>inp.value.replace(/\D/g,'').slice(0,6);
      const sync=()=>{ const d=digits(); if(inp.value!==d) inp.value=d; go.disabled=busy||d.length!==6; };
      inp.addEventListener('input',()=>{ sync(); err.textContent=''; });
      // a pasted message ("Your code: 123 456") gives up its six digits
      inp.addEventListener('paste',e=>{ const t=(e.clipboardData&&e.clipboardData.getData('text'))||'', m=t.replace(/[\s-]/g,'').match(/\d{6}/);
        if(m&&!busy){ e.preventDefault(); inp.value=m[0]; sync(); err.textContent=''; } });
      form.addEventListener('submit',async e=>{ e.preventDefault(); const code=digits(); if(busy||code.length!==6) return;
        busy=true; go.disabled=true; go.setAttribute('aria-busy','true'); go.textContent='Verifying…'; inp.readOnly=true; err.textContent=''; note.textContent='';
        try{ await Auth.emailVerify(email,code); closeModal(); toast('Signed in.'); }
        catch(x){ console.error('[VYRAL auth] the code was not accepted',x); busy=false; if(!inp.isConnected) return;
          err.textContent=codeError(x,sentAt); go.removeAttribute('aria-busy'); go.textContent='Continue'; inp.readOnly=false; sync(); inp.focus(); inp.select(); } });
      // "Send again": a new code to the same address, with a short wait between requests
      const again=h('button',{class:'link',type:'button',onclick:()=>resend()},'Send again'), left=h('span',{class:'au-wait'});
      const paint=()=>{ if(!again.isConnected){ clearInterval(tick); return; }
        const s=Math.ceil((until-Date.now())/1000); again.disabled=sending||s>0; left.textContent=s>0?' in '+s+'s':'';
        if(s<=0&&tick){ clearInterval(tick); tick=0; } };
      const hold=s=>{ until=Date.now()+s*1000; clearInterval(tick); tick=setInterval(paint,1000); paint(); };
      const resend=async()=>{ if(busy||sending||Date.now()<until) return;
        sending=true; paint(); err.textContent=''; note.textContent='';
        try{ await Auth.emailStart(email,mode==='create'); sentAt=Date.now(); if(!again.isConnected) return;
          note.textContent='New code sent.'; inp.value=''; sync(); hold(RESEND_WAIT); inp.focus(); }
        catch(x){ const w=sendWait(x); if(!again.isConnected) return; if(w){ console.warn('[VYRAL auth]',x); hold(w); } else fail(x); }
        finally{ sending=false; paint(); } };
      card.append(...head('Check your email'),
        h('div',{class:'au-lead'},h('p',{},'We sent a verification code to'),h('p',{class:'au-to'},email),h('p',{class:'au-then'},'Enter the code below to continue.')),
        form,err,note,
        h('p',{class:'au-alt'},'Didn’t receive it? ',again,left),
        h('p',{class:'au-alt tight'},h('button',{class:'link',type:'button',onclick:()=>emailStep()},'Use a different email')));
      if(wait) hold(wait); else paint();
      setTimeout(()=>inp.focus(),0);
    };
    choose(); if(firstError) err.textContent=humanAuthError(firstError); body.append(card); m.classList.add('on');
  },
  sheet(title,...kids){ const m=$('#modal'), body=$('#modalBody'); body.innerHTML=''; body.append(h('div',{class:'modal-card auth'},h('h2',{},title),...kids)); m.classList.add('on'); },
  account(){ AccountPage.open(); },
  projects(){ this.sheet('Projects',h('p',{class:'note'},'Saved projects aren’t here yet. Your settings and brand stay on this device for now.')); },
  settings(){
    const hue=Toggle(App.negKeepHue,on=>{ App.negKeepHue=on; document.documentElement.toggleAttribute('data-neg-full',!on); },'Negative keeps colours');
    const safe=Toggle(App.showSafe,on=>{ App.showSafe=on; syncSafe(); },'Show safe area');
    this.sheet('Settings',h('div',{class:'row'},h('span',{},'Negative keeps colours'),hue),h('div',{class:'row'},h('span',{},'Show safe area on the preview'),safe),
      h('div',{class:'adv-foot'},h('button',{class:'btn',onclick:showKeys},'Keyboard shortcuts')));
  },
};
$('#acctBtn').addEventListener('click',e=>{ e.stopPropagation(); AuthUI.openMenu(); });
document.addEventListener('pointerdown',e=>{ if(AuthUI.pop&&!AuthUI.pop.contains(e.target)&&!e.target.closest('#acctBtn')) AuthUI.closeMenu(); });
document.addEventListener('keydown',e=>{ if(!AuthUI.pop) return;
  if(e.key==='Escape'){ e.stopPropagation(); AuthUI.closeMenu(); $('#acctBtn').focus(); return; }
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); const it=[...AuthUI.pop.querySelectorAll('button')], i=it.indexOf(document.activeElement); it[(i+(e.key==='ArrowDown'?1:-1)+it.length)%it.length].focus(); } },true);
Auth.on(()=>AuthUI.syncButton());

/* ================================================================ ACCOUNT PAGE (#/account[/section])
   Section list on the left, the open section on the right: Profile · Subscription · Billing · Security.
   Everything shown comes from the signed-in user, their hive_users row and their entitlement row.
   No account deletion here: that needs server-side code with admin rights, which must never live
   in the page.                                                                                     */
const fmtDate=(d,full)=>{ const t=new Date(d); return isNaN(t)?'':t.toLocaleDateString('en-US',full?{day:'numeric',month:'long',year:'numeric'}:{month:'long',year:'numeric'}); };
async function avatarBlob(file){   // square, max 512 px, JPEG: small upload, and the camera's metadata is dropped
  const bmp=await createImageBitmap(file), s=Math.min(bmp.width,bmp.height), n=Math.min(512,s), c=document.createElement('canvas');
  c.width=c.height=n; c.getContext('2d').drawImage(bmp,(bmp.width-s)/2,(bmp.height-s)/2,s,s,0,0,n,n); bmp.close&&bmp.close();
  return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('encode')),'image/jpeg',0.88)); }
const AC_TABS=[['profile','Profile'],['plan','Plan'],['billing','Billing'],['security','Security']];
const AccountPage={
  from:null, uid:null, quiet:false, refs:null, tab:'profile', photoOk:null, nav:null, pane:null,
  open(){
    if(Recorder.busy()) return toast('Stop the recording first.');
    AuthUI.closeMenu(); closeModal();
    if(/^#\/account\b/.test(location.hash)) return this.show();
    this.from=location.hash||'#/'; location.hash='#/account';
  },
  back(){ if(this.from!=null) history.back(); else go(null); },
  show(ev){
    if(ev&&ev.oldURL){ const o=new URL(ev.oldURL).hash; if(!/^#\/account\b/.test(o)) this.from=o||'#/'; }   // arrived by link, back or forward: remember where from
    const t=(location.hash.match(/^#\/account\/(\w+)/)||[])[1]; this.tab=AC_TABS.some(x=>x[0]===t)?t:'profile';
    App.view='account'; App.vid=null; document.body.dataset.view='account'; AudioEngine.pause(); document.title='METHOD';
    $('#crumb').innerHTML=''; const cb=h('b',{},'Account'); $('#crumb').append(h('span',{},'/'),cb); if(typeof scramble==='function') scramble(cb,'Account',480);
    this.render();
  },
  // switching sections replaces the address (no history entry), so Back still leaves the page
  go(tab){
    if(tab===this.tab) return; this.tab=tab;
    history.replaceState(null,'',location.pathname+location.search+'#/account'+(tab==='profile'?'':'/'+tab));
    this.nav.querySelectorAll('.ac-tab').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.k===tab)));
    this.panel();
    const sc=$('#acct'), top=this.pane.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop-80;
    if(sc.scrollTop>top) sc.scrollTop=Math.max(0,top);
  },
  render(){
    const el=$('#acct'); el.innerHTML=''; this.uid=null; this.refs=null;
    if(!Auth.ready) return;                                   // Auth.on renders again once the session is known
    const u=Auth.user;
    if(!u){ const ask=!this.quiet; this.quiet=false; this.from=null;   // guests: back to VYRAL (and the sign-in sheet, unless they just signed out)
      history.replaceState(null,'',location.pathname+location.search); route(); if(ask) AuthUI.signIn('in'); return; }
    this.uid=u.id;
    const fid=this.from&&(this.from.match(/^#\/(\w+)/)||[])[1];
    const tabs=h('div',{class:'ac-tabs',role:'tablist','aria-label':'Account sections'},
      ...AC_TABS.map(([k,l])=>h('button',{class:'ac-tab',role:'tab','data-k':k,'aria-selected':String(k===this.tab),onclick:()=>this.go(k)},l)));
    tabs.addEventListener('keydown',e=>{ if(!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return; e.preventDefault();
      const i=AC_TABS.findIndex(x=>x[0]===this.tab), n=AC_TABS[(i+(/Up|Left/.test(e.key)?-1:1)+AC_TABS.length)%AC_TABS.length][0];
      this.go(n); tabs.querySelector(`[data-k=${n}]`).focus(); });
    this.nav=h('nav',{class:'ac-nav','aria-label':'Account'},
      h('span',{class:'lab ac-nav-t'},'Account'),tabs);
    this.pane=h('div',{class:'ac-panel',role:'tabpanel'});
    el.append(h('div',{class:'ac'},this.nav,this.pane));
    this.panel();
    if(this.photoOk!==true) this.probePhoto();   // re-checked each visit, so photos switch on as soon as storage exists
  },
  panel(){
    const u=Auth.user; if(!u) return; this.refs=null;
    const p=this.pane; p.innerHTML=''; p.style.animation='none'; void p.offsetWidth; p.style.animation='';
    p.append(...this[this.tab](u));
  },
  head(t,sub){ return [h('h1',{class:'ac-h'},t),h('p',{class:'ac-lead'},sub)]; },
  // photos go to a public Storage bucket; the button only appears once that bucket exists
  async probePhoto(){
    const was=this.photoOk;
    if(!Auth.be) this.photoOk=false;
    else try{ const r=await fetch(AUTH_CONFIG.url+'/storage/v1/object/public/'+AVATAR_BUCKET+'/.vyral-probe',{cache:'no-store'}); this.photoOk=r.ok||!/bucket not found/i.test(await r.text()); }
    catch(e){ this.photoOk=false; }
    if(!this.photoOk&&was==null) console.info('[VYRAL account] the "'+AVATAR_BUCKET+'" storage bucket is not set up yet, so profile photos show as coming soon');
    if(was!==this.photoOk&&this.tab==='profile'&&this.refs&&!this.refs.dirty()) this.panel();
  },
  refresh(u){   // profile or session changed while the page is open: update in place, keep what's being typed
    const r=this.refs; if(!r){ if(this.tab==='security') this.panel(); return; }
    if(!r.R.busy&&!r.R.pending) r.setAv();
    r.name.textContent=u.displayName; r.mailT.textContent=u.email||'';
    if(!r.editing()) r.showMail();
    if(r.inp.value.trim()===r.R.base){ r.inp.value=r.R.base=Auth.profileName(); }   // untouched field follows the saved name
    r.sync();
  },
  profile(u){
    const R={pending:null,url:null,busy:false,base:Auth.profileName()}, ok=!!this.photoOk;
    const msg=h('p',{class:'ac-msg',role:'status'}), say=(t,bad)=>{ msg.className='ac-msg'+(bad?' err':''); msg.textContent=t||''; };
    // --- identity: the avatar is the photo control
    const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp',hidden:true});
    const ava=h('button',{class:'ac-ava',type:'button','aria-label':ok?'Change photo':'Profile photo','aria-disabled':ok?null:'true',
      'data-tip':ok?null:'Profile photos are coming soon',onclick:()=>{ if(ok&&!R.busy) file.click(); }});
    const setAv=()=>{ ava.replaceChildren(avatarEl(R.pending?{displayName:Auth.user.displayName,avatar:R.url}:Auth.user,88),h('span',{class:'ac-ava-h'},ok?'Change':'Soon'));
      ava.classList.toggle('pending',!!R.pending); };
    const pl=h('div',{class:'ac-pl'});
    const drop=()=>{ if(R.url) setTimeout(((x)=>()=>URL.revokeObjectURL(x))(R.url),4000); R.pending=null; R.url=null; };
    const showPl=()=>pl.replaceChildren(...(!ok?[]:R.pending?[h('span',{},'New photo · save to apply'),h('button',{class:'link',type:'button',onclick:()=>{ drop(); setAv(); showPl(); say(''); sync(); }},'Undo')]
      :[h('button',{class:'link',type:'button',onclick:()=>file.click()},'Change photo')]));
    file.addEventListener('change',async()=>{
      const f=file.files[0]; file.value=''; if(!f) return; say('');
      if(!/^image\/(jpeg|png|webp)$/.test(f.type)) return say('Choose a JPG, PNG or WebP image.',1);
      let blob; try{ blob=await avatarBlob(f); }catch(e){ console.error('[VYRAL account]',e); return say('That image couldn’t be read. Try another one.',1); }
      drop(); R.pending=blob; R.url=URL.createObjectURL(blob); setAv(); showPl(); sync();
    });
    const name=h('b',{},u.displayName), mailT=h('span',{},u.email||'');
    setAv(); showPl();
    // --- name: the editable profile field
    const inp=h('input',{class:'bin',id:'acName',maxlength:60,autocomplete:'name',placeholder:'Your name',value:R.base});
    const nameDirty=()=>{ const v=inp.value.trim(); return !!v&&v!==Auth.profileName(); }, dirty=()=>nameDirty()||!!R.pending;
    const save=h('button',{class:'btn ac-save',type:'submit',form:'acNameF',disabled:true},'Save changes');
    const state=k=>{ save.className='btn ac-save'+(k==='dirty'||k==='saving'?' solid':'')+(k==='done'?' done':''); save.disabled=k!=='dirty';
      save.textContent=k==='saving'?'Saving…':k==='done'?'Saved':'Save changes'; };
    let doneT=0; const sync=()=>{ if(R.busy) return; if(dirty()){ clearTimeout(doneT); state('dirty'); } else if(!save.classList.contains('done')) state('idle'); };
    inp.addEventListener('input',()=>{ say(''); save.classList.remove('done'); sync(); });
    const nameF=h('form',{class:'ac-f',id:'acNameF'},h('label',{class:'lab',for:'acName'},'Name'),h('div',{class:'ac-ctl'},inp));
    nameF.addEventListener('submit',async e=>{ e.preventDefault(); if(!dirty()||R.busy) return;
      R.busy=true; state('saving'); let what='name';
      try{
        if(R.pending){ what='photo'; ava.classList.add('busy'); await Auth.setAvatar(R.pending); drop(); what='name'; }
        if(nameDirty()) await Auth.updateProfile({displayName:inp.value});
        inp.value=R.base=Auth.profileName(); R.busy=false; ava.classList.remove('busy'); setAv(); showPl();
        state('done'); clearTimeout(doneT); doneT=setTimeout(()=>{ save.classList.remove('done'); sync(); },1800);
      }catch(x){ R.busy=false; ava.classList.remove('busy'); console.error('[VYRAL account] '+what+' not saved',x);
        say(what==='photo'?'Couldn’t save your photo. Please try again.':'Something went wrong. Please try again.',1); state('dirty'); } });
    // --- email: the sign-in identity, read-only until "Change"
    const mailBox=h('div',{}), emsg=h('p',{class:'ac-msg',role:'status'}), ebad=t=>{ emsg.className='ac-msg err'; emsg.textContent=t; };
    let editing=false;
    const showMail=()=>{ editing=false; mailBox.replaceChildren(h('div',{class:'ac-mail'},h('span',{},Auth.user.email||'—'),
      h('button',{class:'link',type:'button',onclick:editMail},'Change'))); };
    const editMail=()=>{ editing=true; emsg.textContent='';
      const i=h('input',{class:'bin',type:'email',id:'acMail',autocomplete:'email',placeholder:'New email address','aria-label':'New email address'});
      const go=h('button',{class:'btn solid',type:'submit'},'Send link');
      const f=h('form',{class:'ac-ctl'},i,go,h('button',{class:'link',type:'button',onclick:()=>{ emsg.textContent=''; showMail(); }},'Cancel'));
      f.addEventListener('submit',async e=>{ e.preventDefault(); const v=i.value.trim();
        if(!/^\S+@\S+\.\S+$/.test(v)) return ebad('Enter a valid email address.');
        if(v.toLowerCase()===(Auth.user.email||'').toLowerCase()) return ebad('That’s already your email.');
        go.disabled=true; go.textContent='Sending…';
        try{ await Auth.changeEmail(v); showMail(); emsg.className='ac-msg';
          emsg.replaceChildren('We sent a confirmation link to ',h('b',{},v),'. The change happens once it’s confirmed; you may also be asked to confirm from your current address.'); }
        catch(x){ console.error('[VYRAL account] email change',x); ebad(/already/i.test((x&&x.message)||'')?'That email is already used by another account.':humanAuthError((x&&x.message)||'')); go.disabled=false; go.textContent='Send link'; } });
      mailBox.replaceChildren(f); setTimeout(()=>i.focus(),0); };
    showMail();
    this.refs={ava,setAv,name,mailT,inp,R,sync,dirty,showMail,editing:()=>editing};
    return [...this.head('Profile','Manage your personal information.'),
      h('div',{class:'ac-grp'},h('div',{class:'ac-who'},ava,h('div',{class:'ac-id'},name,mailT,pl)),file),
      h('div',{class:'ac-grp'},nameF,h('div',{class:'ac-f'},h('span',{class:'lab'},'Sign-in email'),mailBox,emsg)),
      h('div',{class:'ac-foot'},save,msg)];
  },
  // plan and billing read the license from the server on every visit (the copy in License is only for display)
  status(fill){ const box=h('div',{},h('div',{class:'ac-grp'},h('span',{class:'note'},'…')));
    License.refresh().then(()=>box.replaceChildren(...fill(License.state))); return box; },
  plan(){
    const row=(k,v,none)=>h('div',{class:'ac-row'},h('dt',{},k),h('dd',{class:none?'none':''},v));
    const box=this.status(s=>{   // no intro: the tab already says Plan, the page starts with the plan itself
      if(s.plan==='licensed') return [
        h('div',{class:'ac-grp'},h('div',{},h('div',{class:'ac-plan'},'METHOD License'),h('p',{class:'ac-sub'},'Active'),h('p',{class:'ac-sub'},'One-time purchase \u00b7 No subscription'))),
        h('div',{class:'ac-grp'},h('dl',{class:'ac-list'},s.purchasedAt?row('Purchased',fmtDate(s.purchasedAt,1)):null,row('Renders','Unlimited, without the METHOD mark'))),
        h('div',{class:'ac-grp'},h('div',{},h('span',{class:'lab'},'Included'),h('p',{class:'ac-sub'},'Everything in METHOD: every visualizer and look, the Advanced panel (visualizer controls, effects, colour and type), MIDI export, and unlimited renders and stills without the METHOD mark.')))];
      if(!s.loaded) return [h('div',{class:'ac-grp'},h('p',{class:'ac-sub'},'Your plan couldn\u2019t be loaded right now. Please try again later.'))];
      return [
        h('div',{class:'ac-grp'},h('div',{},h('div',{class:'ac-plan'},'Free'),h('p',{class:'ac-sub'},'Your current METHOD plan')),
          h('div',{class:'ac-act'},h('button',{class:'btn solid',onclick:()=>LicenseUI.explain('BUY')},'Get METHOD \u2014 '+LICENSE.price),h('span',{class:'note'},'One-time purchase \u00b7 No subscription'))),
        h('div',{class:'ac-grp'},h('dl',{class:'ac-list'},row('Free renders',s.freeLimit+' total \u00b7 '+s.freeRemaining+' remaining'),row('Watermark','Free renders carry a small METHOD mark'),
          row('Included','Every visualizer, the main controls and camera modes, the signature looks, Branding layouts and Negative'),
          row('With the license',LICENSE_INCLUDES)))];
    }); box.classList.add('ac-top'); return [box];
  },
  billing(){
    const row=(k,v,none)=>h('div',{class:'ac-row'},h('dt',{},k),h('dd',{class:none?'none':''},v));
    return [...this.head('Billing','Payment method, billing information and receipts.'),this.status(s=>{
      if(s.plan==='licensed') return [h('div',{class:'ac-grp'},h('dl',{class:'ac-list'},row('License','Active'),row('Type','One-time purchase, no subscription'),
          row('Purchased',s.purchasedAt?fmtDate(s.purchasedAt,1):'—',!s.purchasedAt))),
        h('div',{class:'ac-grp'},h('p',{class:'ac-sub'},'Receipts will appear here once payments are connected.'))];
      return [h('div',{class:'ac-grp'},h('dl',{class:'ac-list'},row('Payment method','None',1),row('Billing information','None',1),row('Receipts','No purchases yet',1))),
        h('div',{class:'ac-grp'},h('p',{class:'ac-sub'},'Your receipt will appear here after you buy the METHOD license.'))];
    })];
  },
  security(u){
    const row=(k,dd)=>h('div',{class:'ac-row'},h('dt',{},k),dd);
    const methods=h('dd',{class:'none'},'…'); this.loadMethods(methods);
    const out=async all=>{ this.quiet=true;
      try{ all?await Auth.signOutEverywhere():await Auth.signOut(); toast(all?'Signed out on all devices.':'Signed out.'); }
      catch(e){ this.quiet=false; console.error('[VYRAL auth] sign-out',e); toast('Couldn’t sign out. Try again.'); } };
    const line=(t,sub,btn)=>h('div',{class:'ac-line'},h('div',{},h('span',{class:'ac-t'},t),h('p',{class:'ac-sub'},sub)),btn);
    return [...this.head('Security','How you sign in, and where you’re signed in.'),
      h('div',{class:'ac-grp'},h('dl',{class:'ac-list'},row('Account email',h('dd',{},u.email||'—')),row('Sign-in',methods),
        u.createdAt?row('Member since',h('dd',{},fmtDate(u.createdAt))):null)),
      h('div',{class:'ac-grp'},line('Sign out','Sign out of METHOD in this browser.',h('button',{class:'btn',onclick:()=>out(false)},'Sign out')),
        line('Sign out everywhere','Also ends your sessions on other devices.',h('button',{class:'btn',onclick:()=>out(true)},'Sign out everywhere')))];
  },
  async loadMethods(dd){
    const uid=this.uid; let have;
    try{ have=await Auth.identities(); }catch(e){ console.warn('[VYRAL account] sign-in methods',e); have=((Auth.user&&Auth.user.identities)||[]).map(i=>i.provider); }
    if(this.uid!==uid) return;
    const names={google:'Google',email:'Email code',apple:'Apple'};
    const list=[...new Set(have)].filter(p=>names[p]&&(p!=='apple'||AUTH_CONFIG.apple)).map(p=>names[p]);
    dd.className=''; dd.replaceChildren(h('span',{},list.join(' · ')||'—'));
    if(!have.includes('google')) dd.append(h('button',{class:'link ac-inl',onclick:async()=>{ try{ await Auth.link('google'); }catch(e){ console.error('[VYRAL auth]',e); toast('Something went wrong. Please try again.'); } }},'Connect Google'));
  },
};
Auth.on(u=>{ if(App.view!=='account') return; if(!u||u.id!==AccountPage.uid) AccountPage.render(); else AccountPage.refresh(u); });

/* =====================================================================================================
   TEMPORARY PRIVATE BETA AUTH BYPASS — REMOVE THIS BYPASS BEFORE PUBLIC LAUNCH
   ===================================================================================================== */
// TEMPORARY PRIVATE BETA AUTH BYPASS
// REMOVE THIS BYPASS BEFORE PUBLIC LAUNCH
const METHOD_PRIVATE_BETA_AUTH_BYPASS = true;   // Oct 15: off — the real accounts, Free / Licensed and render checks are back (testers get the license automatically)   // false = the normal METHOD: accounts, sign-in, Free / Licensed, server render checks
/* While true, the private beta password screen is the only barrier. Behind it METHOD opens straight away, with
   no account and everything unlocked: every visualizer, Advanced, the premium looks, MIDI export, unlimited
   recordings and stills, no watermark. The sign-in service is never started, so nothing is read from or written
   to Supabase (no session, no license rows, no render counts).
   The account, license, gift and render-authorization code above and below is not changed; this block only
   stands in front of it while the page runs:
     Auth.init ............ no Supabase, no session; the account button and Get access are hidden
     License .............. reads as licensed on this device; authorizeRender approves locally, without the mark
     AuthUI.signIn ........ does nothing (no sign-in sheet, no Google, no email code)
     Gift links ........... open METHOD itself
     licenseNote .......... no "Sign in to render" line under the record button
   To restore the signed-in METHOD: set the constant to false, or delete this whole block down to
   "END OF TEMPORARY PRIVATE BETA AUTH BYPASS". METHOD_AUTH_BACKUP.html is the version from before the bypass. */
if(METHOD_PRIVATE_BETA_AUTH_BYPASS===true){
  Auth.init=async function(){ await null; this.user=null; this.ready=true; this.emit(); };
  License.state={ plan:'licensed', loaded:true, freeLimit:2, freeRemaining:null, purchasedAt:null };
  License.refresh=async function(){ this.state.plan='licensed'; this.state.loaded=true; this.emit(); };
  License.authorizeRender=async function(){ return {ok:true,plan:'licensed',watermark:false}; };
  AuthUI.signIn=function(){};
  Gift.open=function(){ if(/^#\/redeem\b/.test(location.hash)) history.replaceState(null,'',location.pathname+location.search+'#/'); };
  licenseNote=function(){ return null; };
  document.head.append(h('style',{},'#acctBtn,#getAccess{display:none!important}'));
}
// END OF TEMPORARY PRIVATE BETA AUTH BYPASS ===============================================================
/* ================================================================= STATE
   Per visualizer: params, look, mode, effects, grade. Kept while you move
   between visualizers, so coming back finds everything as you left it.
   Branding content (App.brand) is shared: your title and logo follow you. */
const App={ recMode:'live', recFps:30, view:'home', vid:null, vs:{}, clip:'full', neg:false, negKeepHue:true, advTab:'vis', advOpen:false, aspect:'9:16',
  brand:{logo:null,title:null,artist:null,custom:null}, brandSel:null, brandPeek:null, showSafe:false };
function newVisState(E){
  const mode=E.modes?E.modes.def:null, params={};
  for(const p of E.params) params[p.k]=defOf(p,mode);
  return { params, look:E.defaultLook, mode, fx:defaultFx(), grade:defaultGrade(), brand:newBrandState(E.id) };
}
const vsOf=id=>App.vs[id]||(App.vs[id]=newVisState(ENG[id]));
function applyAll(E,inst,vs){
  for(const p of E.params) inst.set(p.k,vs.params[p.k]);
  if(E.modes&&inst.setMode) inst.setMode(vs.mode);
  inst.setLook(vs.look);
}

/* ---------------- undo / redo: one history per visualizer ---------------- */
const History={
  h:{},
  get cur(){ return this.h[App.vid]||(this.h[App.vid]={stack:[],i:-1}); },
  push(){ if(!App.vid) return; const H=this.cur, s=JSON.stringify({v:App.vs[App.vid],b:App.brand}); if(H.stack[H.i]===s) return;
    H.stack=H.stack.slice(0,H.i+1); H.stack.push(s); if(H.stack.length>120) H.stack.shift(); H.i=H.stack.length-1; updateAdvBadge(); },
  undo(){ const H=this.cur; if(H.i<=0) return toast('Nothing to undo'); H.i--; this.restore(H.stack[H.i]); },
  redo(){ const H=this.cur; if(H.i>=H.stack.length-1) return; H.i++; this.restore(H.stack[H.i]); },
  restore(s){ const o=JSON.parse(s); App.vs[App.vid]=o.v; App.brand=o.b; applyAll(ENG[App.vid],WS.inst,App.vs[App.vid]); buildLooks(); buildPanel(); buildAdv(); updateAdvBadge(); },
};
const commit=()=>History.push();

/* ============================================================= INSTANCES */
/* One instance per visualizer. The home card shows its canvas directly; the
   workspace feeds the same canvas through the post pipeline. So the card IS
   the engine at full quality, and opening a visualizer costs nothing. */
const Inst={};
function instance(id){
  if(!Inst[id]){ const inst=ENG[id].create(); inst._ver=-1; inst._hq=false; inst._baseH=inst.canvas.height; Inst[id]=inst;
    for(const m of ['set','setLook','setMode']) if(inst[m]){ const f=inst[m]; inst[m]=(...a)=>{ inst._dirty=true; return f(...a); }; } }
  const inst=Inst[id], A=AudioEngine, ver=A.has?A.ver:'preview';
  if(inst._ver!==ver){ const P=A.has?A:PREVIEW(); inst.setAudio(P.pcm,P.sr); inst._ver=ver; inst._dirty=true; }
  return inst;
}

/* ============================================================ FORMAT
   The composition the workspace makes: 9:16 (1080 x 1920, the default) or 16:9 (1920 x 1080). It is a real
   composition, not a crop: each engine re-plans its frame (setAspect), the stage compositor and the Branding
   layer take the new size, and recording and stills come out at it. The library always shows 9:16 previews,
   so the open visualizer goes back to 9:16 when you return to it. */
const compFor=a=>a==='16:9'?{w:1920,h:1080}:a==='4:5'?{w:1080,h:1350}:{w:1080,h:1920};
const FORMATS={'9:16':{v:'9:16',label:'9:16',hint:'Vertical, 1080 \u00d7 1920: Reels, TikTok, Shorts'},'16:9':{v:'16:9',label:'16:9',hint:'Horizontal, 1920 \u00d7 1080: YouTube and screens'},
  '4:5':{v:'4:5',label:'4:5',hint:'Portrait post, 1080 \u00d7 1350: Instagram feed'}};
const fmtsOf=E=>E.formats||['9:16','16:9'];   // the formats a visualizer composes for (Grid and Pads add 4:5)
function setInstAspect(inst,a){ if(!inst||(inst._aspect||'9:16')===a) return; if(inst.setAspect) inst.setAspect(a); inst._aspect=a; inst._dirty=true; }
function setAspect(a){
  a=a==='16:9'||a==='4:5'?a:'9:16';
  if(Recorder.busy()){ toast('Stop the recording first.'); if(App.view==='ws') buildPanel(); return; }
  if(App.aspect===a) return;
  const was=App.aspect; App.aspect=a; brandFormatSync(was,a); applyAspect();
}
function applyAspect(){
  const c=compFor(App.aspect);
  document.body.classList.toggle('land',App.aspect==='16:9'); document.body.classList.toggle('f45',App.aspect==='4:5');
  if(WS.post&&WS.post.resize) WS.post.resize(c.w,c.h);
  BrandLayer.setSize(c.w,c.h);
  if(App.view==='ws'&&WS.inst) setInstAspect(WS.inst,App.aspect);
  WS.postKey=''; WS.postSrc=null;
  $('#stillBtn').setAttribute('data-tip',`Save the current frame as a ${c.w} \u00d7 ${c.h} PNG`);
  if(App.view==='ws'&&App.vid){ buildPanel(); buildAdv(); fitStage(); }
}

/* ================================================================== HOME */
const Home={ cards:[], t0:performance.now(),
  build(){
    const g=$('#gallery'); g.innerHTML=''; this.cards=[]; this.io&&this.io.disconnect(); this.io=null; this.hot=null;
    ENGINES.forEach((E,i)=>{
      const stage=h('div',{class:'card-stage'},h('span',{class:'card-open'},'Open'));
      const card=h('button',{class:'card','aria-label':`Open ${E.name}`,onclick:()=>go(E.id)},stage,
        h('div',{class:'card-meta'},h('span',{class:'card-num'},E.num),h('span',{class:'card-name'},E.name),h('span',{class:'card-tag'},E.tag)));
      card.querySelector('.card-meta').insertBefore(h('span',{class:'card-lock','data-tip':'Part of the METHOD license',html:LOCK_ICON}),card.querySelector('.card-tag'));
      const nm=card.querySelector('.card-name'); card.addEventListener('pointerenter',()=>scramble(nm,E.name));
      g.append(card); this.cards.push({E,stage,card,inst:null,err:false});
    });
    this.track(); this.edgeScroll();
  },
  /* the row is wider than the screen: rest the pointer near either edge and it glides that way.
     Speed grows toward the edge; wheel and trackpad scroll it as usual. */
  edgeScroll(){
    if(this._es) return; this._es=true;
    const g=$('#gallery'); let v=0, raf=0, px=-1;
    let last=0, pos=null;
    let idle=null; const busyScroll=()=>{ this.scrolling=true; clearTimeout(idle); idle=setTimeout(()=>{ this.scrolling=false; },160); };
    const step=ts=>{ raf=0; if(!v){ last=0; return; } const dt=last?Math.min(0.05,(ts-last)/1000):1/60; last=ts;
      if(pos==null||Math.abs(pos-g.scrollLeft)>2) pos=g.scrollLeft;   // keep sub-pixel position so slow glides stay smooth
      pos=clamp(pos+v*dt,0,g.scrollWidth-g.clientWidth); g.scrollLeft=pos; busyScroll(); raf=requestAnimationFrame(step); };
    g.addEventListener('pointermove',e=>{ if(e.pointerType!=='mouse') return; const r=g.getBoundingClientRect(), z=Math.min(160,r.width*0.14), x=e.clientX-r.left;
      const t=x<z?-(1-x/z):x>r.width-z?(1-(r.width-x)/z):0; v=Math.sign(t)*Math.pow(Math.abs(t),1.6)*1100; if(v&&!raf) raf=requestAnimationFrame(step); });
    g.addEventListener('pointerleave',()=>{ v=0; });
    g.addEventListener('wheel',e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&g.scrollWidth>g.clientWidth){ const before=g.scrollLeft; g.scrollLeft+=e.deltaY; if(g.scrollLeft!==before) e.preventDefault(); } },{passive:false});
    g.addEventListener('scroll',busyScroll,{passive:true});
  },
  track(){
    const T=$('#homeTrack'); T.innerHTML='';
    if(AudioEngine.user) T.append(h('div',{class:'pill'},h('span',{title:AudioEngine.name},AudioEngine.name),h('em',{},fmtT(AudioEngine.duration)),h('button',{class:'link',style:'margin-right:8px',onclick:chooseFile},'Replace')));
    else { const b=h('button',{class:'btn',onclick:chooseFile},h('span',{},'Upload audio')); magnetic(b,{max:5}); T.append(b); }
    $('#homeFoot').textContent='';
  },
  /* Home render scheduler. Six live engines are too much to redraw every frame on every
     machine, and a long frame is exactly what makes the row judder while it scrolls. So:
     - visibility and on-screen size come from observers, never from layout reads per frame;
     - the card under the pointer renders every frame;
     - the rest share a per-frame time budget, round-robin (each still gets its real elapsed
       time, so motion stays correct, just at a lower rate); the budget shrinks while scrolling. */
  observe(){
    const dpr=Math.min(2,devicePixelRatio||1);
    this.io&&this.io.disconnect(); this.ro&&this.ro.disconnect();
    // "visible" means on screen: the viewport is the root (at <=760px the gallery is a page-long column, so with the
    // gallery as root every card counted as visible). The row's own scroll box still clips; scrollMargin keeps its 40 px look-ahead.
    this.io=new IntersectionObserver(es=>{ for(const e of es){ const c=this.cards.find(q=>q.stage===e.target); if(c) c.vis=e.isIntersecting; } },{rootMargin:'0px 40px',scrollMargin:'0px 40px'});
    this.ro=new ResizeObserver(es=>{ for(const e of es){ const c=this.cards.find(q=>q.stage===e.target); if(!c) continue; const r=e.contentRect; c.shownH=Math.max(r.height,r.width*16/9)*dpr; } });
    for(const c of this.cards){ c.vis=true; this.io.observe(c.stage); this.ro.observe(c.stage);
      c.card.addEventListener('pointerenter',()=>{ this.hot=c; }); c.card.addEventListener('pointerleave',()=>{ if(this.hot===c) this.hot=null; }); }
  },
  frame(ts,dt){
    const A=AudioEngine, dur=A.has?A.duration:PREVIEW().duration, win=Math.min(16,dur), start=A.has?Math.max(0,Math.min(dur-win,dur*0.3)):0;
    const t=start+((ts-this.t0)/1000)%Math.max(1,win), t0=performance.now();
    if(!this.io) this.observe();
    for(const c of this.cards) if(!c.err&&c.inst) c.acc+=dt;
    const run=c=>{
      try{
        instance(c.E.id);
        // resolution follows what the card shows (cover-fit 9:16); switch only once it has settled, never mid-scroll
        const want=!!c.inst.setHQ&&(c.shownH||0)>c.inst._baseH*1.08;
        if(want!==c.inst._hq&&!this.scrolling){ if(!c.pend||c.pend.v!==want) c.pend={v:want,t:ts}; else if(ts-c.pend.t>260){ c.inst.setHQ(want); c.inst._hq=want; c.pend=null; } } else if(want===c.inst._hq) c.pend=null;
        c.inst.frame(t,Math.min(0.1,c.acc),true); c.acc=0; c.inst._warm=(c.inst._warm||0)+1;
      }catch(err){ console.error(err); c.err=true; c.stage.append(h('p',{class:'note',style:'position:absolute;inset:auto 12px 12px;color:#aaa'},'This preview needs WebGL2.')); }
    };
    // bring engines up one per frame, visible ones first. A card that isn't on screen yet waits for a moment the page is
    // idle (spaced one by one), so starting the library doesn't stack every engine's set-up into its first frames;
    // scrolled into view first, it is brought up at once, as before.
    let cold=this.cards.filter(c=>!c.inst&&!c.err).sort((a,b)=>(b.vis?1:0)-(a.vis?1:0))[0];
    // never more than two engines waiting off screen: each one is a GL context and a shader build the screen doesn't show yet
    if(cold&&!cold.vis&&this.cards.filter(c=>c.inst&&!c.vis).length>=2) cold=null;
    if(cold&&!cold.vis){ if(this.idleOK) this.idleOK=false; else { if(!this.idleAsk){ this.idleAsk=true; const go=()=>{ this.idleAsk=false; this.idleOK=true; };
      if(window.requestIdleCallback) requestIdleCallback(go,{timeout:1200}); else setTimeout(go,250); } cold=null; } }
    if(cold){ try{ cold.inst=instance(cold.E.id); applyAll(cold.E,cold.inst,vsOf(cold.E.id)); cold.stage.prepend(cold.inst.canvas); cold.acc=0; }
      catch(err){ console.error(err); cold.err=true; cold.stage.append(h('p',{class:'note',style:'position:absolute;inset:auto 12px 12px;color:#aaa'},'This preview needs WebGL2.')); } }
    const live=this.cards.filter(c=>c.inst&&!c.err&&c.vis&&c!==cold);
    if(this.hot&&live.includes(this.hot)) run(this.hot);
    const rest=live.filter(c=>c!==this.hot); if(!rest.length) return;
    // GL work is asynchronous, so CPU time alone undercounts: also adapt to the real frame interval
    // (fewer background cards per frame whenever the display rate drops, more when there is headroom)
    // at most two background cards per frame, each at most 30 fps: the card under the pointer stays at full rate
    if(this.cap==null) this.cap=2;
    if(dt>1/45) this.cap=Math.max(1,this.cap-1), this.good=0; else if(dt<1/55&&++this.good>30) this.cap=Math.min(rest.length,2,this.cap+1), this.good=0;
    const budget=this.scrolling?4:9, cap=this.scrolling?1:this.cap;
    this.rr=(this.rr||0)%rest.length;
    for(let k=0;k<rest.length;k++){
      const c=rest[(this.rr+k)%rest.length];
      if(k>=cap||(k>0&&performance.now()-t0>budget)){ this.rr=(this.rr+k)%rest.length; return; }
      if(c.acc<1/30) continue;                          // background cards: 30 fps is plenty for a preview
      run(c);
    }
    this.rr=(this.rr+1)%rest.length;
  }
};

/* ============================================================= WORKSPACE */
const WS={ inst:null, post:null, knobs:[], negAnim:{from:0,to:0,t0:0,p:1}, tlKey:'', stillT:0, postKey:'', postSrc:null };
const WAIT_T=7.4;   // with no track yet, the workspace holds one still of the look (from the preview signal)
const hasTrack=()=>AudioEngine.has;
function syncTrackState(){ document.body.classList.toggle('no-track',!hasTrack()); }

function go(id){
  if(Recorder.busy()) return toast('Stop the recording first.');
  if(id){ if(location.hash==='#/'+id) route(); else location.hash='#/'+id; return; }
  if(location.hash) history.pushState('',document.title,location.pathname+location.search);
  route();
}
function route(ev){
  const id=(location.hash.match(/^#\/(\w+)/)||[])[1];
  if(id==='redeem'){ showHome(); Gift.open(); return; }   // a gift link: its sheet over the library
  if(Gift.shown()) Gift.close();                          // left the gift link (e.g. Back): its sheet goes too
  if(id==='account') return AccountPage.show(ev);
  if(id&&ENG[id]) openVis(id); else showHome();
}
function showHome(){
  App.view='home'; App.vid=null; document.body.dataset.view='home'; AudioEngine.pause(); AudioEngine.setAlt(null);
  for(const id in Inst) setInstAspect(Inst[id],'9:16');
  for(const c of Home.cards) if(c.inst) applyAll(c.E,c.inst,vsOf(c.E.id));
  Home.track(); document.title='METHOD';
}
function openVis(id){
  const E=ENG[id];
  App.view='ws'; App.vid=id; document.body.dataset.view='ws'; document.title='METHOD'; AudioEngine.setAlt(null);
  $('#crumb').innerHTML=''; const cb=h('b',{},E.num+' '+E.name); $('#crumb').append(h('span',{},'/'),cb); scramble(cb,E.num+' '+E.name,480);
  const vs=vsOf(id);
  // a format this visualizer doesn't compose for (4:5 is Grid and Pads only): it opens in 9:16
  if(!fmtsOf(E).includes(App.aspect)){ const was=App.aspect; App.aspect='9:16'; brandFormatSync(was,'9:16'); App.vid=null; applyAspect(); App.vid=id;
    toast(was+' is for Grid and Pads: '+E.name+' opens in 9:16.'); }
  busy(true,'Preparing '+E.name);
  // let the veil paint before engines that build heavy tables on their first frame
  requestAnimationFrame(()=>setTimeout(()=>{
    try{ WS.inst=instance(id); if(WS.inst._hq){ WS.inst.setHQ(false); WS.inst._hq=false; } setInstAspect(WS.inst,App.aspect); }catch(err){ console.error(err); busy(false); toast(E.name+' needs WebGL2, which this browser has turned off.'); go(null); return; }
    applyAll(E,WS.inst,vs);
    // an engine that has never run (opened straight from a link) gets a second of silent warm-up,
    // so simulations that build over time show their form instead of an empty frame
    try{ if((WS.inst._warm||0)<30){ for(let i=0;i<36;i++) WS.inst.frame(WAIT_T-1.2+i/30,1/30,true); WS.inst._warm=36; }
      WS.inst.frame(curTime(),1/60,AudioEngine.playing); }catch(err){ console.error(err); }
    busy(false);
  },20));
  if(!History.cur.stack.length) History.push();
  syncTrackState(); buildLooks(); buildPanel(); buildAdv(); fitStage(); drawTimeline(true);
}
function busy(on,text){ $('#busyVeil').classList.toggle('on',!!on); if(text) $('#busyText').textContent=text; }

/* ---------------- looks column ---------------- */
function swatch(L){
  const d='M2 38 C 8 26, 12 26, 17 36 S 26 48, 32 34';
  return h('span',{class:'sw'},h('span',{class:'sw-inner',style:`--b:${L.bg}`,html:
    `<svg viewBox="0 0 34 52" preserveAspectRatio="none"><path d="M2 30 C 8 18, 12 18, 17 28 S 26 40, 32 26" fill="none" stroke="${L.g}" stroke-width="3" opacity=".55"/><path d="M2 30 C 8 18, 12 18, 17 28 S 26 40, 32 26" fill="none" stroke="${L.fg}" stroke-width="1.6"/></svg>`}));
}
function buildLooks(){
  const E=ENG[App.vid], vs=vsOf(App.vid), list=$('#lookList'); list.innerHTML='';
  E.looks.forEach((L,i)=>{ const ok=canUse(Feature.look(E,L));
    list.append(h('button',{class:'look'+(ok?'':' locked'),'aria-pressed':vs.look===L.k,'data-tip':ok?(i<9?`Press ${i+1}`:null):'Part of the METHOD license',onclick:()=>setLook(L.k)},swatch(L),h('span',{},L.label),ok?null:lockMark())); });
}
function setLook(k){ const vs=vsOf(App.vid); if(vs.look===k) return;
  const L=ENG[App.vid].looks.find(x=>x.k===k); if(L&&!canUse(Feature.look(ENG[App.vid],L))) return LicenseUI.explain(); vs.look=k; WS.inst.setLook(k);
  $('#lookList').querySelectorAll('.look').forEach((b,i)=>b.setAttribute('aria-pressed',ENG[App.vid].looks[i].k===k)); buildAdv(); commit(); }
function setMode(v){
  const E=ENG[App.vid], vs=vsOf(App.vid), old=vs.mode; vs.mode=v; WS.inst.setMode(v);
  for(const p of E.params) if(typeof p.def==='object'&&vs.params[p.k]===p.def[old]){ vs.params[p.k]=p.def[v]; WS.inst.set(p.k,vs.params[p.k]); }
  if(E.modes.looks&&vs.look===E.modes.looks[old]){ vs.look=E.modes.looks[v]; WS.inst.setLook(vs.look); buildLooks(); }
  buildAdv(); commit();
}

/* ---------------- primary panel ---------------- */
function buildPanel(){
  const E=ENG[App.vid], vs=vsOf(App.vid), P=$('#panel'); P.innerHTML=''; WS.knobs=[];
  const A=AudioEngine, S=h('div',{class:'pscroll'}), F=h('div',{class:'pfoot'});
  const track=h('div',{class:'blk'},h('span',{class:'lab'},'Track'));
  if(A.has) track.append(h('div',{class:'track-name',title:A.name},A.name),
    h('div',{class:'track-meta'},h('span',{},fmtT(A.duration)),h('button',{class:'link',onclick:chooseFile},'Replace')));
  else track.append(h('div',{class:'trk-empty'},h('span',{},'No track yet'),h('button',{class:'btn',onclick:chooseFile},'Choose file')));
  S.append(track);
  S.append(h('div',{class:'blk'},h('span',{class:'lab'},'Format'),Seg(fmtsOf(E).map(f=>FORMATS[f]),App.aspect,setAspect)));
  WS.modeSeg=null;
  if(E.modes){ const ms=WS.modeSeg=Seg(E.modes.options,vs.mode,setMode); if(E.modes.wrap) ms.classList.add('wrap');   // a long list (Dancer's eight moves) sits on two rows
    S.append(h('div',{class:'blk'},h('span',{class:'lab'},E.modes.label),ms)); }
  const prim=E.params.filter(p=>p.tier===1);
  const knobs=prim.map(p=>{ const k=Knob({label:p.label,min:p.min,max:p.max,value:vs.params[p.k],def:defOf(p,vs.mode),fmt:paramFmt(p),hint:p.hint,int:p.int,
    onInput:v=>{ vs.params[p.k]=v; WS.inst.set(p.k,v); }, onCommit:commit}); k.key=p.k; WS.knobs.push(k); return gated(k,Feature.param(E,p)); });
  S.append(h('div',{class:'blk'},h('div',{class:'lab-row'},h('span',{class:'lab'},'Controls'),
    h('button',{class:'ico','data-tip':'Reset controls','aria-label':'Reset controls',html:ICON.reset,onclick:()=>{ for(const p of prim){ vs.params[p.k]=defOf(p,vs.mode); WS.inst.set(p.k,vs.params[p.k]); } WS.knobs.forEach(k=>k.update(vs.params[k.key])); commit(); }})),
    h('div',{class:'knobs'},knobs)));
  if(E.panel) S.append(E.panel(instance(App.vid)));
  if(!E.noBrand) S.append(h('div',{class:'blk',id:'brandBlk'}));   // MIDI / Score sets its own words instead
  F.append(h('div',{class:'blk',id:'recBlk'}));
  F.append(h('button',{class:'drawer-btn',onclick:()=>toggleAdv(),'aria-expanded':App.advOpen},'Advanced',canUse('advanced.visualizer')?null:lockMark(),h('span',{class:'badge',id:'drawerBadge'}),h('span',{class:'kbd'},'A'),h('span',{class:'chev',html:ICON.chevL})));
  P.append(S,F);
  buildBrandBlock(); renderRecord(); updateAdvBadge();
}
function updateAdvBadge(){
  const b=$('#drawerBadge'); if(!b||!App.vid) return; const E=ENG[App.vid], vs=vsOf(App.vid);
  let n=E.params.filter(p=>!p.tier&&(p.choices?vs.params[p.k]!==defOf(p,vs.mode):Math.abs(vs.params[p.k]-defOf(p,vs.mode))>1e-6)).length;
  n+=Object.values(vs.fx).filter(f=>f.on).length; if(!gradeIsDefault(vs.grade)) n++;
  b.textContent=n; b.classList.toggle('on',n>0); b.setAttribute('data-tip',n+' advanced change'+(n===1?'':'s'));
}
function toggleAdv(force){ App.advOpen=!!(force??!App.advOpen);
  // the drawer is built only while it is open (see buildAdv), so it is (re)built here, before it shows, whenever it is behind
  if(App.advOpen&&(App.advStale||!$('#drawerIn').firstChild)) buildAdv();
  document.body.classList.toggle('drawer-open',App.advOpen); $('#panel').querySelector('.drawer-btn')?.setAttribute('aria-expanded',App.advOpen);
  fitStage();
  // on a phone the drawer sits under the transport, out of sight: bring it into view when it opens
  if(App.advOpen&&App.view==='ws'&&matchMedia('(max-width:760px)').matches) requestAnimationFrame(()=>$('#drawer').scrollIntoView({behavior:'smooth',block:'start'}));
}

/* a control that needs the license: kept in place, greyed, with a lock; a cover over it explains why */
function gated(el,feature){ if(canUse(feature)) return el;
  return h('div',{class:'gated'},el,lockMark(),h('button',{class:'gate-cover','aria-label':'Part of the METHOD license','data-tip':'Part of the METHOD license',onclick:()=>LicenseUI.explain()})); }
/* ---------------- advanced drawer ---------------- */
function buildAdv(){
  if(!App.vid) return;
  // a closed drawer is not built (opening a visualizer, changing a look or undoing does not pay for it); it is marked
  // behind and toggleAdv builds it, with the current state, the moment it opens
  if(!App.advOpen){ App.advStale=true; return; }
  App.advStale=false;
  const E=ENG[App.vid], vs=vsOf(App.vid), root=$('#drawerIn'); root.innerHTML='';
  if(E.noBrand&&App.advTab==='brand') App.advTab='vis';
  const TABS=[['vis',E.short||E.name],['fx','Effects'],['color','Color'],E.noBrand?null:['brand','Branding']].filter(Boolean);
  const tabs=h('div',{class:'tabs',role:'tablist'},TABS.map(([k,l])=>h('button',{role:'tab','aria-selected':App.advTab===k,onclick:()=>{ App.advTab=k; buildAdv(); }},l)),
    h('button',{class:'ico','aria-label':'Close advanced','data-tip':'Close (A)',html:ICON.close,onclick:()=>toggleAdv(false)}));
  const body=h('div',{class:'drawer-body'});
  root.append(tabs,body);
  // part of the license: a free account can open and look, the controls stay muted under one note, and a click
  // anywhere opens the purchase sheet (settings of free features, like Negative, stay usable)
  const locked=!canUse({vis:'advanced.visualizer',fx:'advanced.effects',color:'advanced.color',brand:'advanced.branding'}[App.advTab]);
  const host=locked?h('div',{class:'drawer-lock-body',inert:true}):body;
  if(App.advTab==='vis') advVis(E,vs,host); else if(App.advTab==='fx') advFx(vs,host); else if(App.advTab==='brand') advBrand(vs,host); else advColor(vs,host);
  if(locked){ const free=[...host.querySelectorAll('[data-free]')];
    body.append(h('div',{class:'drawer-lock-note'},lockMark(),h('span',{},'Advanced is part of the METHOD license.'),
        h('button',{class:'link',onclick:()=>LicenseUI.explain('ADVANCED')},'Get METHOD \u2014 '+LICENSE.price)),
      h('div',{class:'drawer-locked'},host,h('button',{class:'gate-cover','aria-label':'Part of the METHOD license','data-tip':'Part of the METHOD license',onclick:()=>LicenseUI.explain('ADVANCED')})),
      ...free); }
}
function advVis(E,vs,body){
  if(E.adv) E.adv(instance(App.vid),body);   // a visualizer's own section (MIDI / Score: tempo and key)
  const groups={};
  // tier 1: the knobs; tier 2: the visualizer's own panel block (Dancer: Camera). Neither is in Advanced.
  for(const p of E.params){ if(p.tier) continue; const mk=p.modes; if(mk&&!mk.includes(E.modes?vs.mode:vs.look)) continue; (groups[p.group]||(groups[p.group]=[])).push(p); }
  const sliders=[];
  for(const [g,ps] of Object.entries(groups)){
    const items=ps.map(p=>{
      if(p.choices){   // a set of options instead of a range
        const seg=Seg(p.choices,vs.params[p.k],v=>{ vs.params[p.k]=v; WS.inst.set(p.k,v); commit(); });
        if(p.avail){ const I=instance(App.vid), upd=()=>seg.buttons.forEach((b,i)=>{ b.disabled=!p.avail(I,p.choices[i].v); }); upd(); I.watchAdv=upd; }
        const row=h('div',{class:'choice'},h('span',{class:'lab','data-tip':p.hint},p.label),seg); row.key=p.k; row.update=v=>seg.set(v); sliders.push(row); return gated(row,Feature.param(E,p)); }
      const s=Slider({label:p.label,min:p.min,max:p.max,value:vs.params[p.k],def:defOf(p,vs.mode),fmt:paramFmt(p),hint:p.hint,int:p.int,
      onInput:v=>{ vs.params[p.k]=v; WS.inst.set(p.k,v); }, onCommit:commit}); s.key=p.k; sliders.push(s); return gated(s,Feature.param(E,p)); });
    body.append(Section(g,{onReset:()=>{ for(const p of ps){ vs.params[p.k]=defOf(p,vs.mode); WS.inst.set(p.k,vs.params[p.k]); } sliders.forEach(s=>s.update(vs.params[s.key])); commit(); }},items));
  }
  body.append(h('div',{class:'adv-foot'},h('button',{class:'btn',onclick:()=>{
    const fresh=newVisState(E); fresh.look=vs.look; fresh.mode=vs.mode; App.vs[App.vid]=Object.assign(vs,{params:fresh.params,fx:fresh.fx,grade:fresh.grade});
    applyAll(E,WS.inst,vs); buildPanel(); buildAdv(); commit(); toast('Everything reset for '+E.name+'. Undo with \u2318Z.'); }},'Reset everything')));
}
function advFx(vs,body){
  body.append(h('p',{class:'note',style:'padding-top:14px'},'Effects sit on top of the picture and work with every visualizer.'));
  for(const g of FX_GROUPS){
    body.append(h('div',{class:'grp'},g));
    for(const e of FX.filter(x=>x.group===g)){
      const st=vs.fx[e.id], row=h('div',{class:'fx'+(st.on?' on':'')});
      const tog=Toggle(st.on,on=>{ st.on=on; row.classList.toggle('on',on); commit(); },e.label);
      const name=h('button',{class:'fx-name','data-tip':e.hint,onclick:()=>tog.click()},e.label);
      const reset=h('button',{class:'ico','aria-label':'Reset '+e.label,'data-tip':'Reset '+e.label.toLowerCase(),html:ICON.reset,onclick:()=>{ for(const p of e.params) st[p.k]=p.def; buildAdv(); commit(); }});
      row.append(h('div',{class:'fx-h'},name,reset,tog),h('div',{class:'fx-b'},e.params.map(p=>Slider({label:p.label,min:p.min,max:p.max,value:st[p.k],def:p.def,fmt:p.fmt,int:p.int,
        onInput:v=>{ st[p.k]=v; }, onCommit:commit}))));
      body.append(row);
    }
  }
}
function advColor(vs,body){
  const G=vs.grade;
  if(!WS.post||!WS.post.gl){ body.append(h('p',{class:'note',style:'padding-top:14px'},'Colour grading needs WebGL2, which is turned off in this browser.')); return; }
  const adj=GRADE_ADJ.map(p=>{ const s=Slider({...p,value:G[p.k],onInput:v=>{ G[p.k]=v; },onCommit:commit}); s.key=p.k; return s; });
  body.append(Section('Adjust',{onReset:()=>{ for(const p of GRADE_ADJ) G[p.k]=p.def; adj.forEach(s=>s.update(G[s.key])); commit(); }},adj));
  const ce=CurveEditor(G.curves,()=>{},commit);
  body.append(Section('Curves',{onReset:()=>{ const c=ce.channel(); G.curves[c]=[[0,0],[1,1]]; ce.redraw(); commit(); }},ce));
  const gr=G.grad;
  const gtog=Toggle(gr.on,on=>{ gr.on=on; commit(); },'Gradient map');
  const gb=GradientBar(gr,()=>{},commit);
  const gs=[{k:'amount',label:'Amount',min:0,max:1,def:1},{k:'shift',label:'Shift',min:-1,max:1,def:0},{k:'repeat',label:'Repeat',min:1,max:6,def:1}]
    .map(p=>{ const s=Slider({...p,value:gr[p.k],onInput:v=>{ gr[p.k]=v; },onCommit:commit}); s.key=p.k; return s; });
  const shuffle=h('button',{class:'ico','data-tip':'Try a palette','aria-label':'Shuffle palette',html:ICON.shuffle,onclick:()=>{
    const pal=GRAD_PALETTES[(Math.random()*GRAD_PALETTES.length)|0]; gr.stops=pal.map((c,i)=>({p:i/(pal.length-1),c})); gr.on=true; gtog.set(true); gb.render(); commit(); }});
  body.append(Section('Gradient map',{open:gr.on,right:h('span',{style:'display:flex;gap:4px;align-items:center'},shuffle,gtog),
    onReset:()=>{ vs.grade.grad=Object.assign(gr,defaultGrade().grad); buildAdv(); commit(); }},
    h('p',{class:'note'},'Maps the picture\u2019s brightness onto a set of colours. Good for colouring mono looks.'),gb,gs));
  const hue=Toggle(App.negKeepHue,on=>{ App.negKeepHue=on; document.documentElement.toggleAttribute('data-neg-full',!on); },'Negative keeps hue');
  const negS=Section('Negative',{open:false},h('div',{class:'row'},h('span',{},'Keep colours when inverting'),hue),
    h('p',{class:'note'},'On: light and dark swap but a red stays red. Off: a straight photographic negative. Press N to flip.'));
  negS.setAttribute('data-free',''); body.append(negS);
}

/* ---------------- stage fit + timeline ---------------- */
function fitStage(){
  const W=$('#stageWrap'); if(!W||App.view!=='ws') return;
  const r=W.getBoundingClientRect(), aw=r.width-24, ah=r.height-24-16;
  let hh, w;
  if(App.aspect==='16:9'){ w=Math.max(160,Math.min(aw,ah*16/9)); hh=w*9/16; }
  else if(App.aspect==='4:5'){ hh=Math.max(160,Math.min(ah,aw*5/4)); w=hh*4/5; }
  else { hh=Math.max(160,Math.min(ah,aw*16/9)); w=hh*9/16; }
  const st=$('#stage'); st.style.width=Math.round(w)+'px'; st.style.height=Math.round(hh)+'px';
  drawTimeline(true);
}
new ResizeObserver(()=>fitStage()).observe($('#stageWrap'));
function clipRange(){
  const A=AudioEngine, pos=A.offset;
  if(App.clip==='full') return [0,A.duration];
  const len=+App.clip; let a=pos; if(a+len>A.duration) a=Math.max(0,A.duration-len); return [a,Math.min(A.duration,a+len)];
}
/* the timeline's size comes from a ResizeObserver (read after layout), not from a layout read on every frame,
   and its colours are read once per theme (they only change with Negative) */
const TL={ w:0, h:0, colKey:null, col:null };
new ResizeObserver(()=>{ const r=$('#tl').getBoundingClientRect(); if(r.width!==TL.w||r.height!==TL.h){ TL.w=r.width; TL.h=r.height; drawTimeline(true); } }).observe($('#tl'));
function tlColors(){ if(TL.colKey!==App.neg||!TL.col){ const cs=getComputedStyle(document.documentElement), css=n=>cs.getPropertyValue(n).trim();
  TL.col={ink:css('--ink'),dim:css('--line-2'),rec:css('--rec')}; TL.colKey=App.neg; } return TL.col; }
function drawTimeline(force){
  const cv=$('#tl'); if(!cv||App.view!=='ws') return;
  const A=AudioEngine, d=devicePixelRatio||1, r={width:TL.w,height:TL.h}, t=curTime();
  const key=[Math.round(r.width),Math.round(t*20),A.ver,App.clip,Recorder.state,App.neg,A.offset.toFixed(2)].join('|');
  if(!force&&key===WS.tlKey) return; WS.tlKey=key;
  if(cv.width!==Math.round(r.width*d)){ cv.width=Math.round(r.width*d); cv.height=Math.round(r.height*d); }
  const x=cv.getContext('2d'), Wd=cv.width, Hd=cv.height; x.clearRect(0,0,Wd,Hd);
  if(!A.has){ $('#tNow').textContent='\u2013:\u2013\u2013'; $('#tDur').textContent='\u2013:\u2013\u2013'; return; }
  const {ink,dim,rec}=tlColors(), step=3*d, bw=Math.max(1,1.6*d), mid=Hd/2;
  const [c0,c1]=Recorder.state==='recording'?[Recorder.from,Recorder.until]:clipRange(), showClip=App.clip!=='full'||Recorder.state==='recording';
  if(showClip){ x.fillStyle=Recorder.state==='recording'?rec:ink; x.globalAlpha=0.08; x.fillRect(c0/A.duration*Wd,0,(c1-c0)/A.duration*Wd,Hd); x.globalAlpha=1; }
  const px=t/A.duration*Wd;
  for(let i=0;i<Wd;i+=step){ const p=A.peaks[Math.min(A.peaks.length-1,Math.floor(i/Wd*A.peaks.length))], hh=Math.max(d,p*Hd*0.42);
    x.fillStyle=i<px?(Recorder.state==='recording'?rec:ink):dim; x.fillRect(i,mid-hh,bw,hh*2); }
  x.fillStyle=ink; x.fillRect(px-d/2,0,d*1.5,Hd);
  $('#tNow').textContent=fmtT(t); $('#tDur').textContent=fmtT(A.duration);
}
(function(){
  const cv=$('#tl'); let drag=false;
  const seekAt=e=>{ const r=cv.getBoundingClientRect(), t=clamp((e.clientX-r.left)/r.width,0,1)*AudioEngine.duration;
    AudioEngine.seek(t); drawTimeline(true); };
  cv.addEventListener('pointerdown',e=>{ if(Recorder.busy()||!hasTrack()) return; drag=true; cv.setPointerCapture(e.pointerId); seekAt(e); });
  cv.addEventListener('pointermove',e=>{ if(drag) seekAt(e); });
  cv.addEventListener('pointerup',()=>drag=false);
})();
function curTime(){ return hasTrack()?AudioEngine.time():WAIT_T; }
function askForTrack(){ const c=$('#upCard'); c.classList.remove('nudge'); void c.offsetWidth; c.classList.add('nudge'); chooseFile(); }
function togglePlay(){
  if(Recorder.busy()) return;
  if(!hasTrack()) return askForTrack();
  AudioEngine.toggle();
}
function syncPlayBtn(){ const p=AudioEngine.playing; const b=$('#playBtn'); b.innerHTML=p?ICON.pause:ICON.play; b.setAttribute('aria-label',p?'Pause':'Play'); b.setAttribute('data-tip',(p?'Pause':'Play')+' (Space)'); }

/* ============================================================== RECORDER
   Record = play the track (or a 30/60 s clip) once while capturing the
   final canvas and the audio bus. It stops by itself when the music ends. */
const Recorder={ state:'idle', rec:null, chunks:[], blob:null, url:null, mime:'', ext:'mp4', from:0, until:0, cancelled:false, stopT:null,
  busy(){ return this.state==='recording'||this.state==='processing'; },
  pickMime(){ const L=['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return L.find(m=>MediaRecorder.isTypeSupported(m))||''; },
  toggle(){ if(this.state==='recording') this.stop(); else if(this.state!=='processing'&&!this.authing) this.request(); },
  // before anything is recorded: the same checks start() makes, then the server approves the render
  canStart(){
    if(!hasTrack()){ toast('Add your track first \u2014 the video records while it plays.'); askForTrack(); return false; }
    if(!(App.recMode==='safe'&&SAFE_OK())&&(typeof MediaRecorder==='undefined'||!$('#out').captureStream)){ toast('This browser can\u2019t record video. Try Chrome, Edge or Safari 17+.'); return false; }
    if(WS.inst&&WS.inst.progress&&WS.inst.progress()){ toast('Still analysing the track. Record once it\u2019s done.'); return false; }
    return true; },
  async request(){
    if(!this.canStart()) return;
    if(!canUse(Feature.vis(ENG[App.vid]))) return LicenseUI.explain();
    AudioEngine.ensure();   // keep audio unlocked by this click while the server answers
    this.authing=true; renderRecord();
    const r=await License.authorizeRender(App.vid);
    this.authing=false;
    if(!r.ok){ renderRecord();
      if(r.reason==='AUTH_REQUIRED'){ toast('Sign in to render. Free accounts include '+License.state.freeLimit+' renders.'); return AuthUI.signIn('in'); }
      if(r.reason==='FREE_RENDER_LIMIT') return LicenseUI.explain('FREE_RENDER_LIMIT');
      return toast('Couldn\u2019t check your renders. Please try again.'); }
    this.watermark=!!r.watermark; if(App.recMode==='safe'&&SAFE_OK()) this.startSafe(); else this.start();
  },
  /* SAFE MODE: the video is rendered frame by frame on a fixed clock (1/fps per frame) instead of being captured while the
     track plays, and encoded with the browser's own encoders (WebCodecs) into an MP4 (mp4-muxer). A slow computer only
     makes it take longer: every frame is there, and the picture and the sound line up exactly. */
  async startSafe(){
    const A=AudioEngine; A.ensure();
    const [from,until]=clipRange(); this.from=from; this.until=until;
    this.clear(); BrandEditor.select(null); A.pause();
    if(WS.inst.setHQ){ WS.inst.setHQ(true); WS.inst._hq=true; }
    const out=$('#out'), cap=this.watermark?Watermark.prime(out):out, W=cap.width, H=cap.height, fps=+App.recFps||30, n=Math.max(1,Math.round((until-from)*fps));
    this.w=W; this.h=H; this.safe=true; this.cancelled=false; this.early=false; this.done=0; this.total=n; this.t0=performance.now(); this.fps=fps;
    this.state='recording'; document.body.classList.add('recording'); renderRecord(); drawTimeline(true);
    const fail=(msg,e)=>{ if(e) console.error('[Safe render]',e); this.safe=false; this.state='idle'; document.body.classList.remove('recording');
      if(WS.inst&&WS.inst.setHQ){ WS.inst.setHQ(false); WS.inst._hq=false; } this.watermark=false; renderRecord(); drawTimeline(true); toast(msg); };
    try{
      // video: H.264 at a level that holds the frame size and rate; audio: AAC, or Opus where AAC isn't available
      // H.264 first (plays everywhere: Instagram, TikTok, iPhone); VP9 in MP4 only where H.264 can't be encoded
      const vcfg=[...['avc1.640033','avc1.640028','avc1.4d0033','avc1.42e033'].map(codec=>({codec,mux:'avc',avc:{format:'avc'}})),{codec:'vp09.00.41.08',mux:'vp9'},{codec:'vp09.00.40.08',mux:'vp9'}]
        .map(c=>({...c,width:W,height:H,bitrate:W*H>2.1e6?14e6:10e6,framerate:fps}));
      let vc=null; for(const c of vcfg){ const {mux,...cfg}=c; const r=await VideoEncoder.isConfigSupported(cfg).catch(()=>null); if(r&&r.supported){ vc=c; break; } }
      if(!vc) return fail('This browser can\u2019t encode video here. Switch Safe mode off to record.');
      const vmux=vc.mux; delete vc.mux; this.vcodec=vmux;
      const ab=A.alt||A.buffer(), sr=ab.sampleRate, ch=Math.min(2,ab.numberOfChannels);
      let ac=null, acodec=null;
      for(const [codec,mux] of [['mp4a.40.2','aac'],['opus','opus']]){ const c={codec,sampleRate:sr,numberOfChannels:ch,bitrate:192000};
        const r=typeof AudioEncoder!=='undefined'?await AudioEncoder.isConfigSupported(c).catch(()=>null):null; if(r&&r.supported){ ac=c; acodec=mux; break; } }
      const muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),fastStart:'in-memory',firstTimestampBehavior:'offset',
        video:{codec:vmux,width:W,height:H,frameRate:fps},audio:ac?{codec:acodec,numberOfChannels:ch,sampleRate:sr}:undefined});
      let err=null;
      const venc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m),error:e=>{ err=e; }}); venc.configure(vc);
      // the sound of the clip, encoded up front (it is the track itself, not a recording of the speakers)
      if(ac){ const aenc=new AudioEncoder({output:(c,m)=>muxer.addAudioChunk(c,m),error:e=>{ err=e; }}); aenc.configure(ac);
        const s0=Math.floor(from*sr), s1=Math.min(ab.length,Math.ceil(until*sr)), step=sr;   // one second per AudioData
        const chans=[...Array(ch)].map((_,c)=>ab.getChannelData(c));
        for(let s=s0;s<s1;s+=step){ const m=Math.min(step,s1-s), d=new Float32Array(m*ch);
          for(let c=0;c<ch;c++) d.set(chans[c].subarray(s,s+m),c*m);
          const a=new AudioData({format:'f32-planar',sampleRate:sr,numberOfFrames:m,numberOfChannels:ch,timestamp:Math.round((s-s0)/sr*1e6),data:d});
          aenc.encode(a); a.close(); }
        await aenc.flush(); aenc.close(); }
      // the picture: one frame at a time, at its exact time on the track
      const yieldNow=()=>new Promise(r=>{ const mc=new MessageChannel(); mc.port1.onmessage=()=>r(); mc.port2.postMessage(0); });   // not throttled like timers
      let last=performance.now();
      for(let i=0;i<n;i++){
        if(this.cancelled||this.early||err) break;
        const t=from+i/fps;
        renderAt(t,1/fps,cap);
        const vf=new VideoFrame(cap,{timestamp:Math.round(i*1e6/fps),duration:Math.round(1e6/fps)});
        venc.encode(vf,{keyFrame:i%(fps*2)===0}); vf.close();
        this.done=i+1; this.at=t;
        while(venc.encodeQueueSize>3&&!err) await new Promise(r=>setTimeout(r,2));
        if(performance.now()-last>40){ tickRecord(); drawTimeline(false); await yieldNow(); last=performance.now(); }
      }
      if(err) return fail('The video couldn\u2019t be encoded. Switch Safe mode off to record.',err);
      if(this.cancelled){ try{ venc.close(); }catch(e){} this.safe=false; this.state='idle'; document.body.classList.remove('recording');
        if(WS.inst&&WS.inst.setHQ){ WS.inst.setHQ(false); WS.inst._hq=false; } this.watermark=false; renderRecord(); drawTimeline(true); return toast('Recording cancelled.'); }
      this.state='processing'; renderRecord();
      await venc.flush(); venc.close(); muxer.finalize();
      this.mime='video/mp4'; this.ext='mp4'; this.safe=false;
      this.chunks=[new Blob([muxer.target.buffer],{type:'video/mp4'})];
      this.state='processing'; this.finish();
    }catch(e){ fail('Safe mode couldn\u2019t render here. Switch it off to record.',e); }
  },
  start(){
    if(!hasTrack()){ toast('Add your track first \u2014 the video records while it plays.'); return askForTrack(); }
    if(typeof MediaRecorder==='undefined'||!$('#out').captureStream) return toast('This browser can\u2019t record video. Try Chrome, Edge or Safari 17+.');
    if(WS.inst&&WS.inst.progress&&WS.inst.progress()) return toast('Still analysing the track. Record once it\u2019s done.');
    const A=AudioEngine; A.ensure();
    const [from,until]=clipRange(); this.from=from; this.until=until;
    this.clear();
    BrandEditor.select(null);   // clean output: no selection, handles or guides (they are DOM, never in the picture anyway)
    A.pause();
    if(WS.inst.setHQ){ WS.inst.setHQ(true); WS.inst._hq=true; }
    const cap=this.watermark?Watermark.prime($('#out')):$('#out');   // free renders: a copy of the stage with the VYRAL mark
    this.w=cap.width; this.h=cap.height;   // the composition being recorded (9:16 or 16:9)
    const stream=new MediaStream([...cap.captureStream(60).getVideoTracks(),...A.dest.stream.getAudioTracks()]);
    this.mime=this.pickMime(); this.ext=this.mime.includes('mp4')?'mp4':'webm';
    try{ this.rec=new MediaRecorder(stream,{mimeType:this.mime||undefined,videoBitsPerSecond:16e6,audioBitsPerSecond:256e3}); }
    catch(e){ console.error(e); if(WS.inst.setHQ){ WS.inst.setHQ(false); WS.inst._hq=false; } return toast('Recording couldn\u2019t start in this browser.'); }
    this.chunks=[]; this.cancelled=false;
    this.rec.ondataavailable=e=>{ if(e.data&&e.data.size) this.chunks.push(e.data); };
    this.rec.onstop=()=>this.finish();
    this.rec.start(250);
    A.play(from,until);
    this.state='recording'; document.body.classList.add('recording'); renderRecord(); drawTimeline(true);
  },
  onEnded(){ if(this.state!=='recording') return;
    // the last buffer is still in the speakers: wait for it before closing the file
    const lat=((AudioEngine.ctx.outputLatency||0)+(AudioEngine.ctx.baseLatency||0));
    clearTimeout(this.stopT); this.stopT=setTimeout(()=>this.stop(),lat*1000+180); },
  stop(){ if(this.state!=='recording') return; if(this.safe){ this.early=true; return; } clearTimeout(this.stopT); AudioEngine.pause(); this.state='processing'; renderRecord(); try{ this.rec.stop(); }catch(e){ this.finish(); } },
  cancel(){ if(this.state!=='recording') return; this.cancelled=true; if(this.safe) return; this.stop(); },
  finish(){
    this.watermark=false; document.body.classList.remove('recording'); if(WS.inst&&WS.inst.setHQ){ WS.inst.setHQ(false); WS.inst._hq=false; }
    if(this.cancelled||!this.chunks.length){ this.chunks=[]; this.state='idle'; renderRecord(); drawTimeline(true); if(this.cancelled) toast('Recording cancelled.'); return; }
    this.blob=new Blob(this.chunks,{type:this.mime||'video/webm'}); this.chunks=[];   // the Blob holds the video now; the recorder's pieces can go
    this.url=URL.createObjectURL(this.blob);
    this.state='ready'; renderRecord(); drawTimeline(true);
  },
  clear(){ if(this.url) URL.revokeObjectURL(this.url); this.url=null; this.blob=null; if(!this.busy()) this.chunks=[]; if(this.state==='ready') this.state='idle'; },
  filename(){ const t=App.brand.title&&App.brand.title.text.trim(), base=(t||parseTrackName(AudioEngine.name).title||'track').replace(/[^\w\-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48)||'track';
    return `${base}_${ENG[App.vid].name.toLowerCase().replace(/[^\w\-]+/g,'_')}.${this.ext}`; },
  download(){ if(!this.url) return; const a=h('a',{href:this.url,download:this.filename()}); document.body.append(a); a.click(); a.remove(); },
};
function renderRecord(){
  const B=$('#recBlk'); if(!B) return; B.innerHTML='';
  const R=Recorder, s=R.state;
  const btn=h('button',{class:'rec',id:'recBtn','data-state':s,onclick:()=>R.toggle(),'data-tip':s==='recording'?'Stop now and keep what\u2019s recorded (R) \u2014 Esc discards':'Plays the track and records it (R)'});
  if(s==='recording') btn.append(h('i',{class:'bar',id:'recBar'}),h('i',{class:'dot'}),h('span',{id:'recText'},'Recording'),h('small',{},'Stop'));
  else if(s==='processing') btn.append(h('span',{},'Finishing video\u2026'));
  if(s==='recording'&&R.safe){ btn.innerHTML=''; btn.append(h('i',{class:'bar',id:'recBar'}),h('i',{class:'dot'}),h('span',{id:'recText'},'Rendering'),h('small',{},'Stop')); btn.setAttribute('data-tip','Stop now and keep what\u2019s rendered (R) \u2014 Esc discards'); }
  else if(R.authing){ btn.disabled=true; btn.append(h('span',{},'Starting\u2026')); }
  else btn.append(h('i',{class:'dot'}),h('span',{},s==='ready'?'Record again':'Record video'));
  const lens=(App.vid&&ENG[App.vid].clipOptions)||[{v:'full',label:'Whole track'},{v:'30',label:'30 s'},{v:'60',label:'60 s'}];   // a visualizer may list its own lengths
  if(!lens.some(o=>o.v===App.clip)) App.clip='full';
  const len=Seg(lens,App.clip,v=>{ App.clip=v; drawTimeline(true); renderRecord(); });
  len.buttons.forEach(b=>b.disabled=R.busy()||!hasTrack());
  if(s==='ready'){
    const mb=(R.blob.size/1048576).toFixed(1);
    const vid=h('video',{src:R.url,muted:true,playsinline:true,preload:'metadata','data-tip':'Watch','aria-label':'Watch the video',onclick:()=>watch()});
    B.append(h('div',{class:'ready'},h('div',{class:'ready-top'},vid,h('div',{},h('div',{class:'ready-t'},'Video ready'),
      h('div',{class:'note'},`${R.w||1080} \u00d7 ${R.h||1920} \u00b7 ${R.ext.toUpperCase()} \u00b7 ${mb} MB`))),
      h('div',{class:'ready-row'},h('button',{class:'btn solid',onclick:()=>R.download()},'Download'),h('button',{class:'btn',onclick:()=>watch()},'Watch'))));
    btn.classList.add('again');
  }
  B.append(btn); magnetic(btn);
  if(SAFE_OK()){   // Safe mode: frame by frame, for computers that can't keep up live
    const mode=Seg([{v:'live',label:'Live',hint:'Records while the track plays: as long as the track'},{v:'safe',label:'Safe mode',hint:'Renders frame by frame: smooth on any computer, can take longer than the track'}],App.recMode,v=>{ App.recMode=v; renderRecord(); });
    mode.buttons.forEach(b=>b.disabled=R.busy());
    B.append(mode);
    if(App.recMode==='safe'){ const fp=Seg([{v:'30',label:'30 fps'},{v:'60',label:'60 fps',hint:'Twice the frames: twice as long to render'}],String(App.recFps),v=>{ App.recFps=+v; });
      fp.buttons.forEach(b=>b.disabled=R.busy()); B.append(fp); } }
  const [a,b]=clipRange();
  if(!hasTrack()) btn.classList.add('wait');
  B.append(len,h('p',{class:'note'},!hasTrack()?'Add your track, then press record. The video records while it plays.':s==='recording'?(R.safe?'Rendering frame by frame. Keep this tab open: on a slower computer it takes longer, the video stays smooth.':'Keep this tab in front while it records.'):App.recMode==='safe'&&SAFE_OK()?'Safe mode: rendered frame by frame, every frame in place. It may take longer than the track.':
    App.clip==='full'?'Plays from the start and stops when the music ends.':`Records ${fmtT(a)} to ${fmtT(b)}. Move the playhead to choose where it starts.`));
  const ln=licenseNote(); if(ln&&s!=='recording') B.append(h('p',{class:'note'},ln));
}
function licenseNote(){ const S=License.state;
  if(!Auth.user) return 'Sign in to render. Free accounts include '+S.freeLimit+' renders.';
  if(S.plan!=='free'||!S.loaded||S.freeRemaining==null) return null;
  return S.freeRemaining?S.freeRemaining+' free render'+(S.freeRemaining===1?'':'s')+' left \u00b7 with a small METHOD mark':'No free renders left.'; }
/* free renders carry a small VYRAL mark in the video itself: the recorder captures a 2D copy of the stage
   with the mark drawn on top (difference blend, so it reads on dark and light pictures). Not DRM. */
const Watermark={ c:null, x:null, font:'',
  prime(src){ if(!this.c){ this.c=document.createElement('canvas'); this.x=this.c.getContext('2d',{alpha:false}); this.font=getComputedStyle(document.body).fontFamily; }
    this.c.width=src.width; this.c.height=src.height; this.frame(src); return this.c; },
  frame(src){ const x=this.x, W=this.c.width, H=this.c.height, k=Math.min(W,H)/1080, sp=26*0.34*k;   // sized on the short side: the same in 9:16 and 16:9
    x.globalCompositeOperation='source-over'; x.globalAlpha=1; x.drawImage(src,0,0,W,H);
    x.save(); x.globalCompositeOperation='difference'; x.globalAlpha=0.5; x.fillStyle='#fff'; x.font='600 '+Math.round(26*k)+'px '+this.font; x.textBaseline='alphabetic';
    const t='METHOD'; let w=-sp; for(const ch of t) w+=x.measureText(ch).width+sp; let px=(W-w)/2;
    for(const ch of t){ x.fillText(ch,px,H-(W>H?130:300)*k); px+=x.measureText(ch).width+sp; } x.restore(); } };
/* ================================================================ STAGE MARK
   Free accounts with no free renders left: the picture itself carries a small VYRAL signature.
     License.state (server)            -> StageMark.active()   who is marked (unchanged)
     visualizer, look, Branding boxes  -> StageMark.plan()     which treatment, and where it sits in THIS preset
     plan + the look's colours         -> StageMark.paint()    pixels in the stage layer
   It is drawn into the layer the shared post pipeline composites into the stage canvas (#out), so it is
   in the preview, in any screen recording of it, and in stills; no visualizer knows about it.
   The home page previews are left clean: the mark belongs to the stage, not to the gallery.
   Treatments (one renderer, chosen per preset):
     type    the preset sets words (Branding, large type): a small editorial label over a hairline in the first
             free lower corner, on the layout's own margins and baseline; side margin or top corner otherwise
     quiet   only small words (minimal layouts): a centred label and a short rule in the space they leave
     visual  no words: the visualizer's own signature in the room its picture leaves (a footer, a corner
             stamp, a centred rule, a margin note beside the score)
   Colour is the look's own ink over its ground, with a soft halo of the ground, so it is light on dark
   looks and dark on light ones; Negative inverts the stage with the mark in it, so the contrast holds.
   Size is fixed in stage units (1080 wide) and scales with the composition, never with the browser.
   Licensed, or renders left: layer() hands back the Branding layer untouched and nothing is drawn.
   Deterrent, not DRM: it can't stop screen recording, it makes the free state visibly signed. */
const MARK_TXT='METHOD';   // the free-plan mark (the product is METHOD)
const MK={ size:20, track:.5, gap:12, rule:1.5, ink:.86, line:.58 };   // stage px at 1080 wide
const MK_VIS={   // no words on the picture: each visualizer's signature, and where its picture leaves room
  retro:  {style:'footer', at:['bl','br']},       // like a terminal footer:  VYRAL ──────
  caustic:{style:'stamp',  at:['tl','tr','bl']},  // a print stamp in the corner of the field
  contour:{style:'line',   at:['bc','tc']},       // centred under the cloth:  ── VYRAL ──
  dust:   {style:'stamp-c',at:['bc','tc']},       // centred under the particles, over a short rule
  spatial:{style:'line',   at:['bc','tc']},
  volume: {style:'line',   at:['bc','tc']},
  midi:   {style:'margin', at:['vr']},             // a margin note beside the score, reading upward
  dancer: {style:'stamp',  at:['tl','tr','bl']},  // a corner stamp, clear of the dancer in the middle
  grid:   {style:'margin', at:['vr']},             // a margin note beside the frame (its words own the top, its panel the foot)
  pads:   {style:'margin', at:['vr']},
  scope:  {style:'stamp',  at:['tl','tr','bl']},  // a corner stamp, clear of the tube in the middle
};
const MK_TYPE=['br','bl','vrb','vlb','tr','tl','vr'];   // with type: lower corners first, then the side margins
const MK_KEEP={ midi:{'9:16':[{x0:100,y0:230,x1:980,y1:1750}],'16:9':[{x0:100,y0:90,x1:1820,y1:960}]} };   // the score (and its words) owns this area in any layout
const StageMark={
  c:null, x:null, dirty:true, was:null, key:'', font:'', m:null, P:null,
  active(){ const S=License.state; return !!Auth.user&&S.loaded&&S.plan==='free'&&S.freeRemaining===0; },
  sync(){ const on=this.active(); if(on===this.was) return; this.was=on; this.dirty=true; BrandLayer.dirty=true; },   // re-upload the plain Branding layer when the mark goes
  // what the post pipeline composites: the Branding canvas (when there is one) with the mark on top
  layer(B){
    if(!this.active()) return B;
    const src=B&&B.on?B.canvas:null, W=src?src.width:BW, H=src?src.height:BH;
    if(!this.c){ this.c=document.createElement('canvas'); this.x=this.c.getContext('2d'); }
    if(this.c.width!==W||this.c.height!==H){ this.c.width=W; this.c.height=H; this.dirty=true; }
    const vs=App.vid?vsOf(App.vid):null, key=[App.vid,vs&&vs.look,src?1:0,BrandLayer.fontsVer].join('|');
    if(key!==this.key){ this.key=key; this.dirty=true; }
    if(this.dirty||(src&&B.dirty)){ const x=this.x; x.clearRect(0,0,W,H);
      if(src){ x.drawImage(src,0,0); B.dirty=false; }
      if(App.vid){ this.P=this.plan(App.vid,src?BrandLayer.boxes:[]); this.paint(x,W/BW,this.P,lookColors(App.vid,vs)); }
      this.dirty=false; this.up=true; }
    const self=this;
    return { on:true, canvas:this.c, late:!!(B&&B.on&&B.late), blend:!!(B&&B.on&&B.blend),
      get dirty(){ return self.up; }, set dirty(v){ self.up=v; } };
  },
  // the label, measured once per font load (stage units)
  metrics(){ const f=BrandLayer.fontsVer;
    if(this.m&&this.m.f===f) return this.m;
    if(!this.font) this.font=getComputedStyle(document.body).getPropertyValue('--f').trim()||getComputedStyle(document.body).fontFamily;
    const x=(this.x||document.createElement('canvas').getContext('2d')); x.save(); this.type(x,1);
    const w=[...MARK_TXT].reduce((a,ch)=>a+x.measureText(ch).width,0)+MK.size*MK.track*(MARK_TXT.length-1), cap=x.measureText('V').actualBoundingBoxAscent||MK.size*.7;
    x.restore(); return this.m={f,w,cap};
  },
  type(x,k){ x.font='500 '+(MK.size*k).toFixed(2)+'px '+this.font; x.textBaseline='alphabetic'; x.textAlign='left'; if('letterSpacing' in x) x.letterSpacing='0px'; },
  // the size of each treatment, stage units; vertical ones are measured along their length
  dims(style){ const {w,cap}=this.metrics();
    if(style==='stamp') return {w,h:cap+MK.gap+MK.rule};
    if(style==='stamp-c') return {w,h:cap+MK.gap+MK.rule};
    if(style==='line') return {w:w+2*(44+16),h:cap};
    if(style==='footer') return {w:w+16+150,h:cap};
    return {w:w+14+72,h:cap,vert:true};   // margin
  },
  // anchors sit on the Branding safe frame (the same margins and baselines the layouts use)
  box(at,style){ const vert=at[0]==='v', d=this.dims(vert?'margin':style), W=vert?d.h:d.w, H=vert?d.w:d.h;
    const X={l:SAFE.l,r:SAFE.r-W,c:BW/2-W/2}, Y={t:SAFE.t,b:SAFE.b-H};
    if(vert){ const cx=at[1]==='r'?BW-(BW-SAFE.r)/2:(SAFE.l)/2, y0=at[2]==='b'?SAFE.b-H:BH/2-H/2;
      return {at,x0:cx-W/2,y0,x1:cx+W/2,y1:y0+H,vert:true,dir:at[1]}; }
    const x0=X[at[1]==='l'?'l':at[1]==='r'?'r':'c'], y0=Y[at[0]];
    return {at,x0,y0,x1:x0+W,y1:y0+H,align:at[1]==='l'?'left':at[1]==='r'?'right':'center'};
  },
  // which treatment this preset gets, and the first place that leaves the words and the logo alone
  plan(vid,boxes){
    const words=boxes.filter(b=>b.role!=='logo'), big=words.some(b=>(b.px||0)>=56||b.y1-b.y0>=100);
    const kind=!words.length?'visual':big?'type':'quiet', V=MK_VIS[vid]||MK_VIS.dust;
    const style=kind==='visual'?V.style:kind==='type'?'stamp':'stamp-c';
    // small words: take the half of the frame they leave empty, so the two mirror each other;
    // words in both halves: a margin note, so the mark never joins a line of words
    const top=words.some(b=>b.y0<BH/2), bot=words.some(b=>b.y1>BH/2);
    const order=kind==='visual'?[...V.at,'vrb','vr']:kind==='type'?MK_TYPE:top&&bot?['vr','vl','tc','bc']:bot?['tc','vr','vl']:['bc','vr','vl'];
    // clearance from words and logos: wide beside them on a row, narrow in the side margins
    const busy=[...boxes,...((MK_KEEP[vid]||{})[App.aspect]||[])];
    const free=r=>{ const px=r.vert?24:120, py=36; return !busy.some(b=>r.x0<b.x1+px&&r.x1>b.x0-px&&r.y0<b.y1+py&&r.y1>b.y0-py); };
    for(const at of order){ const r=this.box(at,style); if(free(r)) return {vid,kind,style,at,r}; }
    const at=order[order.length-1]; return {vid,kind,style,at,r:this.box(at,style)};
  },
  // draw one plan at scale k (stage px -> canvas px)
  paint(x,k,P,C){ const {w,cap}=this.metrics(), r=P.r, ink=hex2rgb(C.ink), bg=hex2rgb(C.bg);
    const rgba=(c,a)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
    x.save(); x.scale(k,k); this.type(x,1); x.shadowColor=rgba(bg,.6); x.shadowBlur=8*k;
    const label=(x0,base)=>{ let px=x0; x.fillStyle=rgba(ink,MK.ink); for(const ch of MARK_TXT){ x.fillText(ch,px,base); px+=x.measureText(ch).width+MK.size*MK.track; } };
    const rule=(x0,y,len)=>{ x.fillStyle=rgba(ink,MK.line); x.fillRect(x0,y,len,MK.rule); };
    if(r.vert){   // reads upward in the side margin: label, then a hairline running on
      x.translate(r.x0+(r.x1-r.x0)/2,r.y1); x.rotate(-Math.PI/2);
      label(0,cap/2); rule(w+14,-MK.rule/2,72);
    } else if(P.style==='line'){ const y=r.y0+cap/2-MK.rule/2, lx=r.x0+44+16;
      rule(r.x0,y,44); label(lx,r.y0+cap); rule(lx+w+16,y,44);
    } else if(P.style==='footer'){
      if(r.align==='right'){ rule(r.x0,r.y0+cap/2-MK.rule/2,150); label(r.x1-w,r.y0+cap); }
      else { label(r.x0,r.y0+cap); rule(r.x0+w+16,r.y0+cap/2-MK.rule/2,150); }
    } else {   // stamp: label over a hairline, on the anchor's side; stamp-c: centred over a short rule
      const lx=r.align==='right'?r.x1-w:r.align==='center'?(r.x0+r.x1)/2-w/2:r.x0;
      label(lx,r.y0+cap);
      if(P.style==='stamp-c') rule((r.x0+r.x1)/2-14,r.y1-MK.rule,28); else rule(lx,r.y1-MK.rule,w);
    }
    x.restore();
  },
};
License.on(()=>StageMark.sync());
function tickRecord(){
  if(Recorder.state!=='recording') return;
  if(Recorder.safe){ const R=Recorder, p=R.done/R.total, el=(performance.now()-R.t0)/1000, left=p>0.02?el/p-el:null;
    const txt=`Rendering ${Math.floor(p*100)}%`+(left!=null?` \u00b7 ${fmtT(Math.max(0,left))} left`:'');
    const rt=$('#recText'); if(rt&&rt.textContent!==txt) rt.textContent=txt;
    const bar=$('#recBar'); if(bar) bar.style.width=(p*100).toFixed(2)+'%';
    const bt=$('#recBadgeT'); if(bt) bt.textContent=Math.floor(p*100)+'%'; return; }
  const t=AudioEngine.time(), el=t-Recorder.from, tot=Recorder.until-Recorder.from, p=clamp(el/tot,0,1);
  const txt=`Recording ${fmtT2(el)} / ${fmtT2(tot)}`;
  const rt=$('#recText'); if(rt&&rt.textContent!==txt) rt.textContent=txt;
  const bar=$('#recBar'); if(bar) bar.style.width=(p*100).toFixed(2)+'%';
  const bt=$('#recBadgeT'); if(bt) bt.textContent=fmtT2(el)+' / '+fmtT2(tot);
}
function watch(){ if(!Recorder.url) return; const m=$('#modal'), b=$('#modalBody'); b.innerHTML='';
  b.append(h('video',{src:Recorder.url,controls:true,autoplay:true,playsinline:true})); m.classList.add('on'); AudioEngine.pause(); }
function closeModal(){ const m=$('#modal'); if(!m.classList.contains('on')) return false; m.classList.remove('on'); $('#modalBody').innerHTML=''; return true; }
$('#modal').addEventListener('click',e=>{ if(e.target.id==='modal') closeModal(); });

/* ============================================================== NEGATIVE */
function toggleNeg(){
  const N=WS.negAnim, apply=()=>{ App.neg=!App.neg; document.documentElement.toggleAttribute('data-neg',App.neg); $('#negBtn').setAttribute('aria-pressed',App.neg); };
  const redraw=()=>{ drawTimeline(true); document.querySelectorAll('.curve').forEach(c=>c.redraw&&c.redraw()); };
  if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    // the whole product turns over top to bottom; the live new state (picture included) wipes over the old
    document.documentElement.classList.add('vt-neg');
    let ran=false;
    const vt=document.startViewTransition(()=>{ ran=true; apply(); N.from=N.to=App.neg?1:0; N.p=1; redraw(); });
    vt.finished.finally(()=>document.documentElement.classList.remove('vt-neg'));
    setTimeout(()=>{ if(!ran) vt.skipTransition(); },400);   // a busy frame must never hold the page frozen
  } else {
    apply(); N.from=N.p<1?(N.p>0.5?N.to:N.from):N.to; N.to=App.neg?1:0; N.t0=performance.now(); N.p=0; setTimeout(redraw,470);
  }
}

/* ================================================================= AUDIO I/O */
function chooseFile(){ if(Recorder.busy()) return toast('Stop the recording first.'); $('#fileIn').click(); }
$('#fileIn').addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; if(f) loadFile(f); });
async function loadFile(f){
  if(Recorder.busy()) return toast('Stop the recording first.');
  // a MIDI file (dropped, or picked as audio): it is the notes for MIDI / Score, Grid or Pads, not a track
  if(isMidiFile(f)){ if(App.view==='ws'&&WS.inst&&WS.inst.useMidiFile) return WS.inst.useMidiFile(f);
    return toast(`${f.name} is a MIDI file. Open MIDI / Score, Grid or Pads to use it for the notes.`); }
  if(!/^audio\//.test(f.type)&&!/\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aif|aiff|webm)$/i.test(f.name)) return toast(`${f.name} isn\u2019t an audio file. Try WAV, MP3, M4A, FLAC or OGG.`);
  const ctx=AudioEngine.ensure();
  if(App.view==='ws') busy(true,'Reading '+f.name); else $('#homeFoot').textContent='Reading '+f.name+'\u2026';
  let buf;
  try{ buf=await ctx.decodeAudioData(await f.arrayBuffer()); }
  catch(e){ busy(false); Home.track(); return toast(`Couldn\u2019t read ${f.name}. It may be damaged or in a format this browser can\u2019t decode.`); }
  Recorder.clear();
  if(App.view==='ws') busy(true,'Analysing '+f.name);
  await new Promise(r=>setTimeout(r,30));
  AudioEngine.setBuffer(buf,f.name); AudioEngine.file=f;
  syncTrackState(); brandOnTrack();
  if(App.view==='ws'){ const I=instance(App.vid); busy(false); buildPanel(); if(I.ready) await I.ready(); if(App.view==='ws'&&Inst[App.vid]===I) AudioEngine.play(0); }
  else Home.track();
}
AudioEngine.on(e=>{ if(e==='ended') Recorder.onEnded(); if(e==='state'||e==='ended') syncPlayBtn(); if(e==='track'){ WS.tlKey=''; } });

/* drag and drop, anywhere */
(function(){
  let n=0; const hasFile=e=>[...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files');
  const veil=()=>App.view==='ws'?$('#dropVeil'):$('#pageVeil');
  addEventListener('dragenter',e=>{ if(!hasFile(e)) return; e.preventDefault(); n++; if(App.view==='ws'&&!hasTrack()) $('#upCard').classList.add('over'); else veil().classList.add('on'); });
  addEventListener('dragover',e=>{ if(hasFile(e)) e.preventDefault(); });
  const off=()=>{ $('#dropVeil').classList.remove('on'); $('#pageVeil').classList.remove('on'); $('#upCard').classList.remove('over'); };
  addEventListener('dragleave',()=>{ if(--n<=0){ n=0; off(); } });
  addEventListener('drop',e=>{ e.preventDefault(); n=0; off();
    const f=[...e.dataTransfer.files][0]; if(!f) return;
    // an image dropped on the workspace is a logo; anything else is treated as audio
    if(App.view==='ws'&&(/^image\//.test(f.type)||/\.(png|svg|jpe?g|webp)$/i.test(f.name))) return onLogoFile(f);
    loadFile(f); });
})();

/* ============================================================ SHORTCUTS */
function showKeys(){ const m=$('#modal'), b=$('#modalBody'); b.innerHTML='';
  const K=[['Space','Play / pause'],['R','Record, or stop recording'],['Esc','Discard a recording \u00b7 close \u00b7 back'],['A','Advanced'],['N','Negative'],['1\u20139','Looks (on the library: open a visualizer, 0 for the tenth)'],
    ['\u2190 \u2192','Move 5 s'],['\u2318Z / \u21e7\u2318Z','Undo / redo'],['Drag a knob','Up or right to raise; hold Shift for fine'],['Double-click','Reset a control'],
    ['Click text or logo','Select it on the preview: drag to move, pull a corner to resize (Alt: no snapping)'],['Double-click text','Edit the words in place'],['\u2190 \u2192 \u2191 \u2193','Move the selection (Shift: faster)'],['Delete','Remove the selection'],['L','Next layout for the branding (Shift: previous)']];
  b.append(h('div',{class:'modal-card'},h('h2',{},'Shortcuts'),h('div',{class:'keys'},K.map(([k,d])=>[h('span',{class:'kbd'},k),h('span',{},d)]))));
  m.classList.add('on'); }
addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('input,textarea,select')) return;
  const mod=e.metaKey||e.ctrlKey, k=e.key;
  if(!mod&&!e.altKey&&BrandEditor.key(e)){ e.preventDefault(); return; }   // a selected branding element takes the keys first
  if(mod&&k.toLowerCase()==='z'&&App.view==='ws'){ e.preventDefault(); e.shiftKey?History.redo():History.undo(); return; }
  if(mod||e.altKey) return;
  if(k==='Escape'){ if(closeModal()) return; if(Recorder.state==='recording') return Recorder.cancel(); if(App.advOpen) return toggleAdv(false); if(App.view==='ws') return go(null); if(App.view==='account') return AccountPage.back(); return; }
  if(k==='?'){ showKeys(); return; }
  if(k==='n'||k==='N'){ toggleNeg(); return; }
  if(App.view==='home'){ const i=k==='0'?10:+k; if(i>=1&&i<=ENGINES.length) go(ENGINES[i-1].id); return; }   // 0 opens the tenth
  if(App.view!=='ws') return;
  if(k===' '){ e.preventDefault(); togglePlay(); return; }
  if(k==='r'||k==='R'){ Recorder.toggle(); return; }
  if(k==='a'||k==='A'){ toggleAdv(); return; }
  if(k==='l'||k==='L'){ if(!Recorder.busy()&&!ENG[App.vid].noBrand) cycleLayout(e.shiftKey?-1:1); return; }
  if(k==='ArrowLeft'||k==='ArrowRight'){ if(Recorder.busy()||!hasTrack()) return; e.preventDefault(); AudioEngine.seek(AudioEngine.time()+(k==='ArrowLeft'?-5:5)); return; }
  const i=+k; if(i>=1&&i<=9){ const L=ENG[App.vid].looks[i-1]; if(L) setLook(L.k); }
});
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&Recorder.state==='recording') setTimeout(()=>toast('The recording may stutter while this tab is in the background.'),50); });

/* one finished frame of the stage at track time t (Safe mode): the engine, Branding, the mark, effects and grade, the
   watermark copy for free renders. The same steps as the live loop, on a clock that doesn't depend on the computer. */
function renderAt(t,dt,cap){
  const R=Recorder, vs=vsOf(App.vid), N=WS.negAnim;
  WS.inst.frame(t,dt,true);
  BrandLayer.update(App.vid,vs,{t,playing:true,from:R.from,until:R.until});
  const layer=StageMark.layer(BrandLayer);
  WS.post.render(WS.inst.canvas,vs.fx,vs.grade,{from:N.to,to:N.to,p:1,keepHue:App.negKeepHue},t,layer);
  WS.postKey=''; WS.postSrc=WS.inst.canvas;
  if(cap!==$('#out')) Watermark.frame($('#out'));
}
const SAFE_OK=()=>typeof VideoEncoder!=='undefined'&&typeof VideoFrame!=='undefined'&&typeof Mp4Muxer!=='undefined';

/* ================================================================== LOOP */
let lastTs=0;
function loop(ts){
  requestAnimationFrame(loop);
  const dt=lastTs?Math.min(0.1,(ts-lastTs)/1000):1/60; lastTs=ts;
  if(App.view==='home'){ Home.frame(ts,dt); return; }
  if(App.view!=='ws') return;
  if(WS.inst&&WS.inst.progress){ const pr=WS.inst.progress(); if(pr){ busy(true,pr); WS.anaVeil=true; return; } if(WS.anaVeil){ WS.anaVeil=false; busy(false); } }
  if(!WS.inst||$('#busyVeil').classList.contains('on')) return;
  if(Recorder.safe&&Recorder.state==='recording') return;   // Safe mode draws its own frames (renderAt)
  const A=AudioEngine, t=curTime(); let drew=false;
  if(hasTrack()){ try{ WS.inst.frame(t,dt,A.playing); }catch(err){ console.error(err); } drew=true; }
  // waiting for a track: hold a still, redrawn only when a control changes it
  else if(WS.inst._dirty||ts-WS.stillT>400){ WS.inst._dirty=false; WS.stillT=ts; try{ WS.inst.frame(t,0,false); }catch(err){ console.error(err); } drew=true; }
  const R=Recorder, rec=R.state==='recording';
  BrandLayer.update(App.vid,vsOf(App.vid),{t,playing:A.playing,from:rec?R.from:0,until:rec?R.until:(A.duration||1)});
  const N=WS.negAnim; if(N.p<1){ N.p=clamp((ts-N.t0)/520,0,1); if(N.p>=1) N.from=N.to; }
  const vs=vsOf(App.vid), ease=N.p<.5?2*N.p*N.p:1-Math.pow(-2*N.p+2,2)/2;
  const neg={from:N.from,to:N.to,p:N.p>=1?1:ease,keepHue:App.negKeepHue}, layer=StageMark.layer(BrandLayer);
  // The stage is composited only when its picture can have changed: the engine drew this frame (always, with a track),
  // an effect, the grade, Negative or the Branding changed, or an effect that moves by itself is on (grain, film,
  // distortion). A waiting still that nothing touches keeps its last frame (the canvas preserves it) instead of
  // being recomposited 60 times a second.
  const moving=vs.fx.grain.on||vs.fx.film.on||vs.fx.distort.on;
  const key=hasTrack()||moving?'':JSON.stringify([vs.fx,vs.grade,neg,layer&&layer.on?[!!layer.late,!!layer.blend,layer.canvas.width,layer.canvas.height]:0]);
  if(drew||!key||key!==WS.postKey||WS.inst.canvas!==WS.postSrc||(layer&&layer.on&&layer.dirty)) WS.post.render(WS.inst.canvas,vs.fx,vs.grade,neg,ts/1000,layer);
  WS.postKey=key; WS.postSrc=WS.inst.canvas;
  if(Recorder.watermark&&Recorder.state==='recording') Watermark.frame($('#out'));
  tickRecord(); drawTimeline(false); brandOverlayTick(); LayoutStrip.tick();
}

/* ================================================================== BOOT */
$('#restartBtn').innerHTML=ICON.restart; $('#stillIco').innerHTML=ICON.frame;
$('#playBtn').addEventListener('click',togglePlay);
$('#restartBtn').addEventListener('click',()=>{ if(Recorder.busy()||!hasTrack()) return; AudioEngine.seek(0); });
$('#upDrop').addEventListener('click',chooseFile);
$('#brand').addEventListener('click',()=>go(null));
$('#negBtn').addEventListener('click',toggleNeg);
$('#stillBtn').addEventListener('click',()=>exportStill());
async function exportStill(){
  if(Recorder.busy()||Recorder.authing) return;
  const r=await License.authorizeRender('still:'+App.vid);
  if(!r.ok){ if(r.reason==='AUTH_REQUIRED'){ toast('Sign in to export. Free accounts include '+License.state.freeLimit+' exports.'); return AuthUI.signIn('in'); }
    if(r.reason==='FREE_RENDER_LIMIT') return LicenseUI.explain('FREE_RENDER_LIMIT');
    return toast('Couldn\u2019t check your renders. Please try again.'); }
  (r.watermark?Watermark.prime($('#out')):$('#out')).toBlob(b=>{ const a=h('a',{href:URL.createObjectURL(b),download:`${ENG[App.vid].name.toLowerCase()}_${fmtT(curTime()).replace(':','-')}.png`}); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); });
}
addEventListener('hashchange',route);
License.on(()=>{ const lic=License.licensed; for(const c of Home.cards) c.card.classList.toggle('locked',!canUse(Feature.vis(c.E)));
  if(App.view!=='ws'||!App.vid) return; if(lic!==License._lic){ License._lic=lic; buildLooks(); buildPanel(); buildAdv(); } else renderRecord(); });
(function(){ const X=$('#xray'), M=X.querySelector('.xray-mask');   // x-ray lens: a peek at Negative under the cursor
  if(REDUCED) return;
  X.addEventListener('pointermove',e=>{ const r=M.getBoundingClientRect(); M.style.setProperty('--x',(e.clientX-r.left)+'px'); M.style.setProperty('--y',(e.clientY-r.top)+'px'); X.classList.add('on'); });
  X.addEventListener('pointerleave',()=>X.classList.remove('on'));
})();
{
syncTrackState();
  WS.post=createPost($('#out'));
  if(!WS.post.gl) toast('WebGL2 is off in this browser, so effects and colour grading are disabled.');
  syncPlayBtn(); Home.build(); route();
  requestAnimationFrame(loop);
  Auth.init().then(async()=>{ try{ if(sessionStorage.getItem('vyral.resume')) await Resume.restore(); }catch(e){ console.error('[VYRAL] restore after sign-in failed',e); } if(Auth.returnError) AuthUI.signIn('in',Auth.returnError); });
}
/* the header's purchase action, left of Upload audio: shown to everyone without an active license (guests and free
   accounts, whatever their render count). The plan comes from the server status (License.state); it opens the one
   purchase sheet. Hidden until the status is known, so a licensed account never sees it flash. */
const GetAccess={ el:$('#getAccess'),
  sync(){ const show=Auth.ready&&(!Auth.user||License.state.plan==='free'); this.el.classList.toggle('ga-off',!show); } };
GetAccess.el.addEventListener('click',()=>LicenseUI.explain('BUY')); magnetic(GetAccess.el,{max:5});
License.on(()=>GetAccess.sync()); Auth.on(()=>GetAccess.sync());


