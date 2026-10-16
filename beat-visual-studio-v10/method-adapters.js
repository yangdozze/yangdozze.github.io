/* METHOD / HiveGlobal: original public adapter definitions, visual algorithms and parameters; attribution retained. Shell/account/license workflows intentionally excluded. */
const f2=n=>Number(n).toFixed(2);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const PREVIEW=()=>({pcm:new Float32Array(44100),sr:44100,duration:1});
const App={view:'ws',vid:''};
const h=(name,attrs)=>{const el=document.createElement(name);if(attrs)for(const [k,v] of Object.entries(attrs)){if(k==='class')el.className=v;else if(k==='html')el.innerHTML=v;else if(v!=null)el.setAttribute(k,v);}return el;};
const ICON={reset:''};
const commit=()=>{};
const vsOf=()=>({params:{}});
const Slider=o=>document.createElement('input');
const Seg=o=>document.createElement('div');
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

window.METHOD_ADAPTERS=ENGINES;
