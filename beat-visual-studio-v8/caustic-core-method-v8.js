/* Directly extracted from the public METHOD application, with permission as stated by the project owner. Visual and source attribution: METHOD / HiveGlobal. Original source comments and algorithm preserved. METHOD's own comments call this a reference rebuild. */
const CAUSTIC=(function(){
/* ===========================================================================
   CAUSTIC — REFERENCE REBUILD.  A new renderer, written from the INPUT/OUTPUT
   relationship of the Effect.app reference and nothing else.

   What the input is (from the source screenshot): a bundle of ~8 hairline
   contours (FWHM ~9 px at 1080) forming one twisted ribbon - two edges that
   cross each other - over a soft glow; white-blue on black.
   What the output is (from 279 processed frames): that same signal put through
     1. a STATIC cellular displacement (the fine web is identical early and
        late in the clip, r = .98), XY, ~25-40 px cells with finer veins;
     2. a THERMAL ramp, inverted, with the shadows lifted so the faint glow
        becomes the red body and the lines become the black rim;
     3. a hairline edge treatment and a blob tracker HUD.
   Stage view in ADVANCED shows each stage of the transformation.
   =========================================================================== */

/* ------------------------------------------------------------------ FFT */
function makeFFT(n){
  const cos=new Float32Array(n/2), sin=new Float32Array(n/2), rev=new Uint32Array(n);
  for(let i=0;i<n/2;i++){ cos[i]=Math.cos(-2*Math.PI*i/n); sin[i]=Math.sin(-2*Math.PI*i/n); }
  let bits=0; while((1<<bits)<n) bits++;
  for(let i=0;i<n;i++){ let r=0; for(let b=0;b<bits;b++) if(i&(1<<b)) r|=1<<(bits-1-b); rev[i]=r; }
  return function(re,im){
    for(let i=0;i<n;i++){ const j=rev[i]; if(j>i){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
    for(let size=2;size<=n;size<<=1){
      const half=size>>1, step=n/size;
      for(let i=0;i<n;i+=size) for(let j=i,k=0;j<i+half;j++,k+=step){
        const tr=cos[k]*re[j+half]-sin[k]*im[j+half];
        const ti=cos[k]*im[j+half]+sin[k]*re[j+half];
        re[j+half]=re[j]-tr; im[j+half]=im[j]-ti; re[j]+=tr; im[j]+=ti;
      }
    }
  };
}

/* --------------------------------------------------- PCM-INDEXED ANALYSER
   Carried over from v1 - bands, level, onset - with the flux split into a low
   half and an upper half so a kick and a snare can drive different things. */
const NFFT=2048;
class Analyser{
  constructor(pcm,sr){
    this.pcm=pcm; this.sr=sr; this.fft=makeFFT(NFFT);
    this.re=new Float32Array(NFFT); this.im=new Float32Array(NFFT);
    this.win=new Float32Array(NFFT);
    for(let i=0;i<NFFT;i++) this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(NFFT-1));
    this.mag=new Float32Array(NFFT/2); this.prev=new Float32Array(NFFT/2);
    this.split=Math.round(220*NFFT/sr);          // kick flux below here, snare above
    this.reset();
  }
  reset(){
    this.lastT=-1e9; this.prev.fill(0);
    this.sLow=0; this.sMid=0; this.sHigh=0; this.sRms=0;
    this.fLowAvg=1e-4; this.fHighAvg=1e-4;
    this.kick=0; this.snare=0; this.flash=0; this.body=0; this.lvlMax=1e-3;
    this.motion=0; this.detail=0;                 // continuous drives: mid -> motion (body of the sound), high -> detail (texture)
  }
  band(f0,f1){
    const i0=Math.max(1,Math.round(f0*NFFT/this.sr)), i1=Math.min(NFFT/2-1,Math.round(f1*NFFT/this.sr));
    let s=0; for(let i=i0;i<=i1;i++) s+=this.mag[i];
    const db=20*Math.log10(s/(i1-i0+1)/(NFFT/4)+1e-9);
    return Math.max(0,Math.min(1.25,(db+70)/55));
  }
  read(t,dt){
    const pcm=this.pcm, n=pcm.length, s0=Math.round(t*this.sr)-(NFFT>>1);
    let rms=0;
    for(let i=0;i<NFFT;i++){
      const k=s0+i, v=(k>=0&&k<n)?pcm[k]:0;
      this.re[i]=v*this.win[i]; this.im[i]=0; rms+=v*v;
    }
    rms=Math.sqrt(rms/NFFT);
    this.fft(this.re,this.im);
    let fLow=0, fHigh=0;
    const sp=this.split, top=Math.min(NFFT/2-1, Math.round(9000*NFFT/this.sr));
    for(let i=1;i<NFFT/2;i++){
      const m=Math.hypot(this.re[i],this.im[i]);
      this.mag[i]=m;
      const d=m-this.prev[i];
      if(d>0){ if(i<sp) fLow+=d; else if(i<top) fHigh+=d; }
      this.prev[i]=m;
    }
    const low=this.band(25,150), mid=this.band(150,1800), high=this.band(1800,11000);
    const jump=Math.abs(t-this.lastT)>0.35; this.lastT=t;
    if(jump){ this.sLow=low; this.sMid=mid; this.sHigh=high; this.sRms=rms;
              this.fLowAvg=fLow+1e-6; this.fHighAvg=fHigh+1e-6; this.flash=0; this.body=0; }
    const fol=(up,dn,cur,tgt)=>cur+(tgt-cur)*(1-Math.exp(-dt/(tgt>cur?up:dn)));
    this.sLow =fol(0.012,0.085,this.sLow ,low );
    this.sMid =fol(0.018,0.110,this.sMid ,mid );
    this.sHigh=fol(0.012,0.070,this.sHigh,high);
    this.sRms =fol(0.010,0.130,this.sRms ,rms );
    // band-limited onsets, each against its own slow average
    this.fLowAvg  += (fLow -this.fLowAvg )*(1-Math.exp(-dt/0.55));
    this.fHighAvg += (fHigh-this.fHighAvg)*(1-Math.exp(-dt/0.55));
    // a flux ratio alone is level-blind: a kick at 6% of the track's loudness
    // spikes the ratio just as hard as a full one. Weight by absolute level.
    const aud=Math.min(1, rms/(this.lvlMax*0.45+1e-6));
    const kk=Math.max(0,Math.min(1,(fLow /(this.fLowAvg +1e-9)-1.30)/1.5))*aud;
    const ss=Math.max(0,Math.min(1,(fHigh/(this.fHighAvg+1e-9)-1.30)/1.5))*aud;
    this.kick =Math.max(kk, this.kick *Math.exp(-dt/IN.kickDecay));
    this.snare=Math.max(ss, this.snare*Math.exp(-dt/IN.snareDecay));
    // level, normalised against a slow running maximum so any track collapses
    this.lvlMax=Math.max(rms, this.lvlMax*Math.exp(-dt/5.0));
    const lvl=Math.min(1.3, rms/(this.lvlMax*0.80+1e-5));
    // gate: below this the track is treated as genuinely quiet
    const gated=Math.max(0,(lvl-IN.gate)/(1-IN.gate));
    const drive=Math.max(this.kick, this.snare*0.92, gated*IN.sustain);
    this.flash=fol(0.005,IN.flashRel,this.flash,drive);
    this.body =fol(0.014,IN.bodyRel ,this.body ,drive);
    // CONTINUOUS MOTION, separate from the impact chain above. The band levels are
    // already smoothed (sMid / sHigh); here they are put through a soft threshold
    // (so a quiet track stays calm) and their own attack / release, and are NOT
    // added to body - impact and movement stay two different signals.
    const mAct=Math.max(0,Math.min(1,(this.sMid -IN.midFloor )/(IN.midFull -IN.midFloor )))*Math.min(1,aud*1.6);
    const hAct=Math.max(0,Math.min(1,(this.sHigh-IN.highFloor)/(IN.highFull-IN.highFloor)))*Math.min(1,aud*1.6);
    this.motion=fol(IN.motionAtt,IN.motionRel,this.motion,mAct);
    this.detail=fol(IN.detailAtt,IN.detailRel,this.detail,hAct);
    return {low:this.sLow, mid:this.sMid, high:this.sHigh, rms:this.sRms, lvl:lvl,
            kick:this.kick, snare:this.snare, flash:this.flash, body:this.body, motion:this.motion, detail:this.detail};
  }
}

/* ------------------------------------------------------------------ PARAMETERS
   IN  : the input signal (the visualizer that was fed to Effect.app)
   DS  : the displacement transformation
   TH  : the thermal transformation
   TK  : the tracker overlay
   U   : the few user controls */
const IN={
  x0:0.08, x1:0.92,          // horizontal extent of the ribbon (fraction of W)
  cy:0.50, tilt:0.11,        // centre height (fraction of H) and left-to-right descent (fraction of W)
  lines:22, tlag:1.0,        // hairlines across the ribbon, and how differently they lag the bend
  edgeI:5.0,                 // the two edges are a little brighter
  width:150,                 // ribbon half-width (px at 1080)
  twist:1.2, xk:0.15,                 // crossings across the width (cycles of the twist)
  modes:[[1,30],[2,14],[3,7],[5,3]],   // bend modes: [cycles across width, amplitude px]
  rate:0.10,                 // idle morph speed (rad/s per mode index)
  audioBend:0.5,             // extra bend from body
  audioRate:0.9,             // extra morph speed from body
  reform:5.0,                // phase jump on a hit (rad/s while the hit lasts)
  lineW:2.0, lineI:0.22,     // hairline width and intensity
  glow:2.0, glowR:10, glowWide:1.6, glowWideR:40,   // soft glow: near and far
  floor:0.10,                // brightness with no sound
  gamma:1.6,                 // brightness vs level
  // response followers (same analyser family as the product)
  gate:0.295, sustain:0.44, bodyRel:0.60, flashRel:0.34, kickDecay:0.03, snareDecay:0.6,
  // continuous motion (mid = movement, high = detail) - added on top of the impact chain, never into it
  midFloor:0.22, midFull:0.85, highFloor:0.12, highFull:0.55,   // band level where a band counts as absent / fully present (the high band reads lower on the dB scale)
  motionAtt:0.025, motionRel:0.42,               // mid follower: quick attack, slow release
  detailAtt:0.015, detailRel:0.18,               // high follower: quick attack, shortish release
  midRate:1.6, midBend:0.45,                     // mid -> morph speed and continuous bend
  highRate:1.0, highPhase:3.2, highTwist:0.16, highJit:2.8   // high -> faster fine morph, fine phase on the small modes, twist clock, hairline micro-motion (px)
};
const DS={ amt:1.0, cell:86, oct:5, fall:0.56, vein:0.71, smooth:0.17, seed:8, px:170 };
const TH={ on:1, lo:3, gamma:0.62, knee:0.0, curve:1.0, edge:0.06, edgeLv:0.07 };
const TK={ on:1, thr:0.86, persist:0.66, min:12, max:5, cap:17, bg:0.45, lines:1, seed:3 };
const U={displacement:1.00, speed:0.97, tracker:0.65, stage:'disp',
  cont:0.35,                   // CONTINUOUS MOTION: 0 = audio-led, 0.35 = the approved behaviour, 1 = continuously evolving
  low:1.00, mid:1.00, high:1.00  // SPECTRAL MOTION: how strongly each band drives the existing motion (1 = approved behaviour)
};

/* ---------------------------------------------------------------- RENDERER */
class Ref{
  constructor(W,H){ this.W=W; this.H=H; this.s=Math.min(W,H)/1080; this.hitPh=0; this.fph=0; this.ph=IN.modes.map((_,k)=>k*1.7); this.tw=0; this.auto=0;
    this.cv=document.createElement('canvas'); this.cv.width=W; this.cv.height=H; this.cx=this.cv.getContext('2d',{willReadFrequently:true});
    this.g1=document.createElement('canvas'); this.g1.width=W>>2; this.g1.height=H>>2; this.gx1=this.g1.getContext('2d',{willReadFrequently:true});
    this.g2=document.createElement('canvas'); this.g2.width=W>>3; this.g2.height=H>>3; this.gx2=this.g2.getContext('2d',{willReadFrequently:true});
    this.lum=new Float32Array(W*H); this.T=new Uint16Array(W*H); this.Lt=new Uint8Array(W*H); this.Q=new Uint8Array(W*H);
    this.img=null; this.trk=new Tracker(W,H); this.dKey=''; this.lKey=''; this.an=null; this.lastT=-1e9; }
  clear(){ this.hitPh=0; this.fph=0; this.trk.reset(); }

  /* ---- 1. the input signal: a twisted ribbon of hairlines + glow -------- */
  drawInput(A,t,dt){
    const W=this.W,H=this.H,s=this.s,cx=this.cx;
    cx.globalCompositeOperation='source-over'; cx.fillStyle='#000'; cx.fillRect(0,0,W,H);
    const body=A.body, level=A.lvl, motion=A.motion||0, detail=A.detail||0;
    // LOW = impact / structure (kick / snare / body), MID = movement, HIGH = detail.
    // Each band's share is scaled by its Spectral Motion amount; the continuous share
    // (the form's own evolution, independent of audio) by Continuous Motion.
    const gL=IN.gLow, gM=IN.gMid, gH=IN.gHigh, cm=IN.contMul;
    const spd=IN.speed||1, rate=IN.rate*(cm+IN.audioRate*body*gL+Math.min(1.6, IN.midRate*motion*gM+IN.highRate*detail*gH))*spd;   // the continuous share is capped so mids + highs can never race
    for(let k=0;k<this.ph.length;k++) this.ph[k]+=rate*(1+0.35*k)*dt;
    // hits re-form the shape: soft knee instead of a hard gate, so the phase velocity never snaps
    const hit=Math.max(A.kick*gL,A.snare*gM), hk=Math.max(0,Math.min(1,(hit-0.25)/0.2)), hw=hk*hk*(3-2*hk);
    this.hitPh+=IN.reform*hit*hw*dt*spd;
    this.fph+=IN.rate*IN.highPhase*detail*gH*dt*spd;             // fine phase: only the small, fast modes feel it
    this.tw+=dt*spd*(0.06*cm+0.25*body*gL+IN.highTwist*detail*gH);
    // the continuous field: above the approved default the modes also breathe, each on its own
    // slow incommensurate clock - one coherent evolution of the same shape, never per-frame noise
    this.auto+=dt*spd; const br=IN.breathe, au=this.auto;
    const fp=this.fph, N=180, X0=IN.x0*W, X1=IN.x1*W, CY=IN.cy*H, bend=1+IN.audioBend*body*gL+IN.midBend*motion*gM;
    const jit=IN.highJit*s*detail*gH;                              // hairline micro-motion, a slow per-line sway, never per-frame noise
    const mb=this.mb||(this.mb=new Float32Array(IN.modes.length));
    for(let k=0;k<mb.length;k++) mb[k]=1+br*Math.sin(au*(0.13+0.09*k)+k*2.1);
    const pts=new Float32Array(N*2), wid=new Float32Array(N);
    for(let i=0;i<N;i++){ const u=i/(N-1); let y=CY+IN.tilt*W*(u-0.5);
      for(let k=0;k<IN.modes.length;k++){ const [f,a]=IN.modes[k]; y+=a*s*bend*mb[k]*Math.sin(6.283*f*u+this.ph[k]+this.hitPh*(0.5+0.4*k)+fp*Math.max(0,k-1)); }
      pts[i*2]=X0+(X1-X0)*u; pts[i*2+1]=y;
    }
    const vis=IN.floor+Math.pow(Math.max(0,level),IN.gamma)*(1-IN.floor)*(1+0.6*A.flash);
    cx.globalCompositeOperation='lighter'; cx.lineWidth=IN.lineW*s; cx.lineCap='round';
    // the ribbon is a surface: K hairlines span it from edge to edge. Where the
    // twist closes the width they pile up and the band goes bright - that is
    // where the source's bright crossings come from. Each line lags the modes a
    // little differently (tlag), so they slide against each other.
    const K=IN.lines|0;
    for(let j=0;j<K;j++){
      // Chebyshev spacing: the lines crowd toward the two edges, the way the
      // contours of a surface crowd where it folds away - that is the bright rim
      const v=K>1?Math.cos(3.14159*j/(K-1)):0, edge=Math.abs(v)>0.999?IN.edgeI:1;
      cx.strokeStyle='rgba(174,182,197,'+(IN.lineI*vis*edge).toFixed(3)+')';
      cx.beginPath();
      const jph=this.tw*3.1+j*1.37;
      for(let i=0;i<N;i++){ const u=i/(N-1); let y=CY+IN.tilt*W*(u-0.5)+jit*Math.sin(jph+u*9.4);
        for(let k=0;k<IN.modes.length;k++){ const [f,a]=IN.modes[k]; y+=a*s*bend*mb[k]*Math.sin(6.283*f*u+this.ph[k]*(1+IN.tlag*v)+this.hitPh*(0.5+0.4*k)+fp*Math.max(0,k-1)); }
        // a twisted ribbon seen in projection: the cross vector rotates, so the
        // lines also shift sideways and the surface visibly loops over itself
        const th=6.283*IN.twist*u+this.tw, env=0.3+0.7*Math.pow(Math.sin(3.1416*u),0.5);
        y+=IN.width*s*env*Math.cos(th)*v;
        const x=pts[i*2]+IN.width*s*IN.xk*env*Math.sin(th)*v;
        if(i)cx.lineTo(x,y); else cx.moveTo(x,y); }
      cx.stroke();
    }
    // glow: two blurred, downsampled copies added back (a bloom, as the source had)
    for(const [g,gx,r,wgt] of [[this.g1,this.gx1,IN.glowR/4,IN.glow],[this.g2,this.gx2,IN.glowWideR/8,IN.glowWide]]){
      gx.globalCompositeOperation='source-over'; gx.filter='none'; gx.fillStyle='#000'; gx.fillRect(0,0,g.width,g.height);
      gx.filter='blur('+(r*s).toFixed(1)+'px)'; gx.drawImage(this.cv,0,0,g.width,g.height); gx.filter='none';
      cx.globalAlpha=wgt; cx.drawImage(g,0,0,W,H); cx.globalAlpha=1;
    }
    cx.globalCompositeOperation='source-over';
    const d=cx.getImageData(0,0,W,H).data, lum=this.lum;
    for(let i=0,n=W*H;i<n;i++) lum[i]=(d[i*4]*0.30+d[i*4+1]*0.45+d[i*4+2]*0.25)/255;
  }

  /* ---- 2. displacement: one static cellular map, XY -------------------- */
  buildDisp(){
    const W=this.W,H=this.H,s=this.s,n=W*H, key=[DS.amt,DS.cell,DS.oct,DS.fall,DS.vein,DS.smooth,DS.seed,DS.px].join('/');
    if(this.dKey===key) return; this.dKey=key;
    const SX=this.dSX=this.dSX||new Float32Array(n), SY=this.dSY=this.dSY||new Float32Array(n), L=new Float32Array(n), LS=new Float32Array(n);
    let q=DS.seed*7919+13; const rnd=()=>((q=(q*1103515245+12345)&0x7fffffff)/0x7fffffff);
    const NO=DS.oct|0, k=1+DS.vein*14; let wsum=0;
    for(let o=0;o<NO;o++){
      const cell=DS.cell*s*Math.pow(0.42,o-1), w=Math.pow(DS.fall,o); wsum+=w; const smo=NO>1?0.92-(0.92-DS.smooth)*(o/(NO-1)):DS.smooth;
      const gx=Math.ceil(W/cell)+3, gy=Math.ceil(H/cell)+3, px=new Float32Array(gx*gy), py=new Float32Array(gx*gy);
      for(let j=0;j<gy;j++) for(let i=0;i<gx;i++){ px[j*gx+i]=(i-1.5+rnd())*cell; py[j*gx+i]=(j-1.5+rnd())*cell; }
      const wp=[rnd()*6.28,rnd()*6.28,rnd()*6.28,rnd()*6.28], wf=1/(cell*3.1), wa=cell*0.45;
      for(let y=0;y<H;y++) for(let x=0;x<W;x++){
        const qx=x+wa*Math.sin(y*wf*1.13+wp[0])*Math.cos(x*wf*0.71+wp[1]), qy=y+wa*Math.sin(x*wf*0.97+wp[2])*Math.cos(y*wf*0.83+wp[3]);
        const ci=Math.floor(qx/cell)+1, cj=Math.floor(qy/cell)+1; let f1=1e9,f2=1e9;
        for(let j=cj-1;j<=cj+1;j++) for(let i=ci-1;i<=ci+1;i++){ if(i<0||j<0||i>=gx||j>=gy) continue;
          const dx=qx-px[j*gx+i], dy=qy-py[j*gx+i], d=dx*dx+dy*dy; if(d<f1){f2=f1;f1=d;} else if(d<f2) f2=d; }
        const r1=Math.sqrt(f1)/cell, e=(Math.sqrt(f2)-Math.sqrt(f1))/cell, v=Math.exp(-e*k*2.2);
        const val=w*((1-smo)*v+smo*Math.min(1,r1*1.4)); L[y*W+x]+=val; if(o<2) LS[y*W+x]+=val;
      }
    }
    let mean=0; for(let i=0;i<n;i++) mean+=L[i]; mean/=n;
    // amount above 1: stronger, plus a twist from the smooth part so it folds instead of only sliding
    const e=Math.max(0,DS.amt-1), u=Math.min(1,DS.amt);
    const amp=DS.px*s*Math.pow(u,1.15)*(1+0.35*Math.min(e,2)+0.15*Math.max(0,e-2))/wsum, curl=Math.min(2,e)*amp*2.2, gr=Math.max(2,Math.round(6*s));
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const o=y*W+x; const d=(L[o]-mean)*amp; let sx=x+d, sy=y+d;
      if(curl>0){ const xm=x>=gr?o-gr:o, xp=x<W-gr?o+gr:o, ym=y>=gr?o-gr*W:o, yp=y<H-gr?o+gr*W:o;
        const gX=(LS[xp]-LS[xm])/(2*gr), gY=(LS[yp]-LS[ym])/(2*gr); sx+=-gY*curl*gr*4; sy+=gX*curl*gr*4; }
      if(sx<0)sx=0; if(sx>W-1.001)sx=W-1.001; if(sy<0)sy=0; if(sy>H-1.001)sy=H-1.001; SX[o]=sx; SY[o]=sy; }
  }
  warp(src,out){ const W=this.W, SX=this.dSX, SY=this.dSY;
    for(let i=0,n=W*this.H;i<n;i++){ const sx=SX[i],sy=SY[i],x0=sx|0,y0=sy|0,tx=sx-x0,ty=sy-y0,o=y0*W+x0;
      out[i]=(src[o]*(1-tx)+src[o+1]*tx)*(1-ty)+(src[o+W]*(1-tx)+src[o+W+1]*tx)*ty; } }

  /* ---- 3. thermal: luminance -> T -> inverted orange/red/black ramp ------ */
  buildLUT(){
    const key=[TH.lo,TH.gamma,TH.knee,TH.curve,TH.on].join('/'); if(this.lKey===key) return; this.lKey=key;
    if(!this.tIdx){ this.tIdx=new Uint16Array(1024); this.rgb=new Uint32Array(1024); }
    for(let i=0;i<1024;i++){ const lum=i/1023*255; let T=Math.pow(Math.max(0,(lum-TH.lo)/(255-TH.lo)),TH.gamma);
      // knee: the lifted shadows - the faint glow becomes the red body
      T=T+TH.knee*T*(1-T); if(T>1)T=1;
      const c=TH.curve; if(c!==1){ const a=Math.pow(T,c), b=Math.pow(1-T,c); T=a/(a+b+1e-9); }
      this.tIdx[i]=Math.min(1023,(T*1023)|0); }
    for(let i=0;i<1024;i++){ const T=i/1023; let r,g,b;
      if(TH.on){ if(T<0.5){ const u=T/0.5; r=255-15*u; g=126-116*u; b=2+3*u; } else { const u=(T-0.5)/0.5; r=240*(1-u); g=10*(1-u); b=5*(1-u); } }
      else { r=g=b=Math.round(255*T); }
      this.rgb[i]=(255<<24)|((b|0)<<16)|((g|0)<<8)|(r|0); }
  }
  compose(ctx){
    const W=this.W,H=this.H,n=W*H, lum=this.lum, T=this.T, Lt=this.Lt, Q=this.Q;
    if(!this.img){ this.img=ctx.createImageData(W,H); this.px=new Uint32Array(this.img.data.buffer); this.tmp=new Float32Array(n); }
    const px=this.px;
    this.buildDisp(); this.buildLUT();
    let src=lum; if(DS.amt>0.005){ this.warp(lum,this.tmp); src=this.tmp; }
    if(U.stage==='in'||U.stage==='disp'){ for(let i=0;i<n;i++){ const v=Math.min(255,(src[i]*255)|0); px[i]=(255<<24)|(v<<16)|(v<<8)|v; } ctx.putImageData(this.img,0,0); if(TK.on&&U.stage==='disp') this.trk.frame(Lt,W,H,ctx,src); return; }
    const tIdx=this.tIdx, rgb=this.rgb;
    for(let i=0;i<n;i++){ let v=(src[i]*1023)|0; if(v>1023)v=1023; T[i]=tIdx[v]; Lt[i]=(src[i]*255)|0; }
    // edges: a hairline where T crosses a level (the "show edges" of the app)
    const eg=TH.edge*1023, lv=(TH.edgeLv*1023)|0;
    if(eg>0){ for(let i=0;i<n;i++) Q[i]=T[i]>=lv?1:0;
      for(let y=0;y<H;y++){ const o=y*W, yp=y<H-1?o+W:o; for(let x=0;x<W;x++){ const b=Q[o+x], xp=x<W-1?x+1:x; let t=T[o+x]; if(b!==Q[o+xp]||b!==Q[yp+x]){ t+=eg; if(t>1023)t=1023; } px[o+x]=rgb[t|0]; } } }
    else for(let i=0;i<n;i++) px[i]=rgb[T[i]];
    ctx.putImageData(this.img,0,0);
    if(TK.on) this.trk.frame(Lt,W,H,ctx);
  }
  /* t = audio position (what is being heard), fdt = real frame time. Analysis follows the
     audio clock; the motion integrates frame time, so the form moves on every frame even
     when the audio clock has not ticked (coarse currentTime) or playback is paused. Only a
     real jump (seek / new clip) resets the followers. */
  render(ctx,W,H,t,pcm,sr,fdt){
    if(!this.an||this.anPcm!==pcm){ this.an=new Analyser(pcm,sr); this.anPcm=pcm; this.lastT=-1e9; }
    const mdt=Math.min(0.1,Math.max(1/240,fdt||1/60));
    let adt=t-this.lastT;
    if(adt>0.35||adt<-0.02){ this.an.reset(); this.clear(); adt=mdt; }
    else if(adt<=0) adt=mdt;                                   // paused / clock has not ticked: followers settle in real time
    else adt=Math.min(0.1,Math.max(1/1000,adt));
    this.lastT=t;
    const A=this.an.read(t,adt); this.lastA=A; this.drawInput(A,t,mdt); this.compose(ctx);
  }
}

/* ---- 4. blob tracker HUD (144x256 grid, 7.5 px units, muted earth palette) */
class Tracker{
  constructor(W,H){ const land=W>H; this.GW=land?256:144; this.GH=land?144:256; this.reset(); }
  rnd(){ this.q=(this.q*1103515245+12345)&0x7fffffff; return this.q/0x7fffffff; }
  reset(){ this.tracks=[]; this.nextId=1; this.q=TK.seed*911+1; }
  frame(Lt,W,H,ctx,srcF){
    const GW=this.GW,GH=this.GH; if(!this.g){ this.g=new Uint8Array(GW*GH); this.lab=new Int32Array(GW*GH); this.stack=new Int32Array(GW*GH); }
    const g=this.g, thr=TK.thr*255, sx=W/GW, sy=H/GH;
    for(let j=0;j<GH;j++){ const y0=(j*sy)|0, y1=Math.min(H,((j+1)*sy)|0)||y0+1;
      for(let i=0;i<GW;i++){ const x0=(i*sx)|0, x1=Math.min(W,((i+1)*sx)|0)||x0+1; let m=0;
        for(let y=y0;y<y1;y++){ const o=y*W; for(let x=x0;x<x1;x++){ const v=srcF?srcF[o+x]*255:Lt[o+x]; if(v>m)m=v; } } g[j*GW+i]=m>thr?1:0; } }
    const lab=this.lab, st=this.stack; lab.fill(0); const blobs=[]; let nl=0;
    for(let s=0;s<GW*GH;s++){ if(!g[s]||lab[s]) continue; nl++; let sp=0; st[sp++]=s; lab[s]=nl; let n=0,cx=0,cy=0;
      while(sp>0){ const p=st[--sp], x=p%GW, y=(p/GW)|0; n++; cx+=x; cy+=y;
        if(x>0&&g[p-1]&&!lab[p-1]){lab[p-1]=nl;st[sp++]=p-1;} if(x<GW-1&&g[p+1]&&!lab[p+1]){lab[p+1]=nl;st[sp++]=p+1;}
        if(y>0&&g[p-GW]&&!lab[p-GW]){lab[p-GW]=nl;st[sp++]=p-GW;} if(y<GH-1&&g[p+GW]&&!lab[p+GW]){lab[p+GW]=nl;st[sp++]=p+GW;} }
      if(n>=TK.min) blobs.push({x:cx/n+0.5,y:cy/n+0.5,n}); }
    blobs.sort((a,b)=>b.n-a.n); if(blobs.length>TK.max*2) blobs.length=TK.max*2;
    const tr=this.tracks, keep=TK.persist, hold=Math.round(2+TK.persist*9); for(const t of tr) t.hit=false; const used=new Set();
    for(const t of tr){ let best=-1,bd=18; for(let k=0;k<blobs.length;k++){ if(used.has(k)) continue; const d=Math.hypot(blobs[k].x-t.x,blobs[k].y-t.y); if(d<bd){bd=d;best=k;} }
      if(best>=0){ used.add(best); const b=blobs[best]; t.x+=(b.x-t.x)*(1-keep*0.85); t.y+=(b.y-t.y)*(1-keep*0.85); t.lost=0; t.hit=true; t.age++; } else t.lost++; }
    for(let i=tr.length-1;i>=0;i--) if(tr[i].lost>hold) tr.splice(i,1);
    for(let k=0;k<blobs.length&&tr.length<TK.max;k++){ if(used.has(k)) continue; const b=blobs[k];
      tr.push({id:this.nextId++,x:b.x,y:b.y,lost:0,hit:true,age:0,pal:(this.rnd()*TRACKER_PAL.length)|0,dx:this.rnd()<0.5?-1:1,dy:this.rnd()<0.6?1:-1}); }
    this.draw(ctx,W,H);
  }
  draw(ctx,W,H){
    const s=Math.min(W,H)/1080, sx=W/this.GW, sy=H/this.GH, tr=this.tracks.filter(t=>t.age>=1||t.hit); ctx.save();
    const P=TRACKER_STYLE;
    for(const t of tr) t.col=TRACKER_PAL[t.pal%TRACKER_PAL.length].ink;
    if(TK.lines&&tr.length>1){ ctx.lineWidth=Math.max(1,1.5*s); ctx.setLineDash([7*s,6*s]); const done=new Set();
      for(const a of tr){ let b=null,bd=1e9; for(const o of tr){ if(o===a) continue; const d=Math.hypot(o.x-a.x,o.y-a.y); if(d<bd){bd=d;b=o;} } if(!b) continue;
        const key=a.id<b.id?a.id+'-'+b.id:b.id+'-'+a.id; if(done.has(key)) continue; done.add(key);
        const lc=a.col; ctx.beginPath(); ctx.moveTo(a.x*sx,a.y*sy); ctx.lineTo(b.x*sx,b.y*sy);
        if(P.halo>0){ ctx.lineWidth=Math.max(1,1.5*s)+2*s; ctx.strokeStyle='rgba(0,0,0,'+P.halo+')'; ctx.stroke(); ctx.lineWidth=Math.max(1,1.5*s); }
        ctx.strokeStyle='rgba('+lc[0]+','+lc[1]+','+lc[2]+','+P.lineA+')'; ctx.stroke(); }
      ctx.setLineDash([]); }
    const fs=TK.cap*0.78*s; ctx.font='500 '+fs+'px "DejaVu Sans Mono","Menlo","Consolas",monospace'; ctx.textBaseline='middle'; const tw=71*s, th=18*s;
    for(const t of tr){ const x=t.x*sx, y=t.y*sy, c=t.col;
      ctx.beginPath(); ctx.moveTo(x-4*s,y); ctx.lineTo(x+4*s,y); ctx.moveTo(x,y-4*s); ctx.lineTo(x,y+4*s);
      if(P.halo>0){ ctx.strokeStyle='rgba(0,0,0,'+P.halo+')'; ctx.lineWidth=Math.max(1,s)+2*s; ctx.stroke(); }
      ctx.strokeStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+P.markA+')'; ctx.lineWidth=Math.max(1,s); ctx.stroke();
      const bx=x+(t.dx>0?10*s:-tw-10*s), by=y+(t.dy>0?12*s:-th-12*s);
      const pe=TRACKER_PAL[t.pal%TRACKER_PAL.length], bk=pe.back; ctx.fillStyle='rgba('+bk[0]+','+bk[1]+','+bk[2]+','+Math.min(1,TK.bg*P.backA)+')'; ctx.fillRect(bx,by,tw,th);
      ctx.strokeStyle='rgba('+c[0]+','+c[1]+','+c[2]+',0.8)'; ctx.lineWidth=Math.max(1,s); ctx.strokeRect(bx+0.5,by+0.5,tw-1,th-1);
      ctx.fillStyle=pe.text;
      ctx.fillText('X'+String(Math.round(t.x)).padStart(3,'0')+'Y'+String(Math.round(t.y)).padStart(3,'0'),bx+4*s,by+th/2+0.5); }
    ctx.restore();
  }
}
/* Tracker colour presets. Each palette gives the tints a track can take (marker,
   caption box), the leader-line colour and alphas, and the caption text colour
   chosen for legibility on that box. The tracker's detection and geometry do not
   look at this - it only changes what colour the same marks are drawn in. */
/* Tracker palette: five restrained inks; each track takes one (seeded, as the
   original did) - marker, leader line, caption border and text in that ink over
   a dark backing so it stays legible on the thermal field. */
const TRACKER_PAL=[
  { ink:[214,104,28], back:[44,22,6],  text:'rgba(255,222,184,0.95)' },   // amber
  { ink:[240,236,228], back:[30,26,22], text:'rgba(240,236,228,0.95)' },  // white
  { ink:[196,32,26],  back:[40,10,8],  text:'rgba(255,206,198,0.95)' },   // red
  { ink:[156,176,132], back:[26,34,22], text:'rgba(214,228,196,0.95)' },  // sage
  { ink:[138,152,166], back:[22,28,34], text:'rgba(220,228,236,0.95)' }   // blue-grey
];
const TRACKER_STYLE={ lineA:0.7, markA:0.95, backA:1.5, halo:0.4 };

/* ---- user controls -> internal --------------------------------------- */
function applyUser(){
  DS.amt=U.displacement; TH.curve=1;
  // WAVE SPEED: the rate of the field's own clock, compressed above 1 (3.00 -> 2.5x)
  { const v=Math.max(0,U.speed); IN.speed = v<=1 ? v : 1+(v-1)*0.75; }
  // CONTINUOUS MOTION: idle clock multiplier (0.3x .. 1x at the approved 0.35 .. 3x) + mode breathing above it
  { const c=Math.max(0,Math.min(1,U.cont)); IN.contMul = c<=0.35 ? 0.3+0.7*c/0.35 : 1+2*(c-0.35)/0.65; IN.breathe=0.35*Math.max(0,c-0.35)/0.65; }
  // SPECTRAL MOTION: per-band gain on the existing motion drives
  IN.gLow=U.low; IN.gMid=U.mid; IN.gHigh=U.high;
  const T=U.tracker; TK.on=T>0.02?1:0; TK.max=Math.round(1+(T<0.5?T/0.5*4:5+(T-0.5)/0.5*4)); TK.thr=T<0.5?0.93+(0.86-0.93)*(T/0.5):0.86+(0.55-0.86)*((T-0.5)/0.5);
}
applyUser();


return {Ref,IN,DS,TH,TK,U,applyUser};
})();
export {CAUSTIC};
