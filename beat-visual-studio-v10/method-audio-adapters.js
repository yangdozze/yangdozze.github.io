/* Original METHOD / HiveGlobal adapters and defaults. No auth, payment, or MIDI transcription subsystem. */
const f2=v=>Number(v).toFixed(2);
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


window.METHOD_AUDIO_ENGINES=[RetroAdapter,CausticAdapter,ContourAdapter,DustAdapter,SpatialAdapter,VolumeAdapter];
