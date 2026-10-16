/* Native METHOD visual engines 02-07. Original SOURCE: https://method.hiveglobal.org/app/#/caustic . Reuse based on project owner's authorization; original code below preserved. MIDI transcription module intentionally excluded. */

/* ======================= VISUAL ENGINES (approved builds, logic untouched) ======================= */
/* ===========================================================================
   RETRO — a character-cell visual instrument. Two presets, one engine.

   What the reference archive (209 frames, 1080x1920) shows, and what this
   module rebuilds as rules rather than pictures:

   - Every preset is the SAME kind of system: an audio waveform (short
     window, Tukey-tapered "lens" envelope, tip cells at both ends) sampled
     onto a fixed character grid of 44 x 43 cells (24.55 x 44.65 px each),
     and every cell is replaced by one glyph chosen from a density ramp.
   - The picture is re-derived on a stepped clock: 21-24 new states per
     second, every 3rd-5th output frame is a hold. Consecutive states share
     only ~10-35% of their lit cells: glyphs are replaced, not animated.
   - Kicks produce a one- or two-step "fill" of the lens (lit cells x2.5-4)
     that collapses on the very next state. Nothing lingers.

   RETRO 01 (frames 0-76)    dark terminal: sparse bright ramp, pixel font,
                             slate/green two-tone glyphs with a left fringe,
                             deep-red bloom around the lit cells only.
   RETRO 03 (frames 148-208) raster: an INVERTED ramp - every empty cell is a
                             full block, so the page is a solid raster wall and
                             a clean, low-passed trace is carved out of it with
                             a dark halo; sparse stray near-block glyphs are
                             re-rolled across the wall every state.

   Preview and export both call Engine.render(ctx,W,H,t,...) — same code.
   =========================================================================== */
const RETRO = (function(){
'use strict';

/* ---------------------------------------------------------------- font --- */
/* 5x8 bitmap font, column-major, LSB = top row, ASCII 32..126 */
const F58=[
0,0,0,0,0, 0,0,95,0,0, 0,7,0,7,0, 20,127,20,127,20, 36,42,127,42,18, 35,19,8,100,98, 54,73,86,32,80, 0,8,7,3,0,
0,28,34,65,0, 0,65,34,28,0, 42,28,127,28,42, 8,8,62,8,8, 0,128,112,48,0, 8,8,8,8,8, 0,0,96,96,0, 32,16,8,4,2,
62,81,73,69,62, 0,66,127,64,0, 114,73,73,73,70, 33,65,73,77,51, 24,20,18,127,16, 39,69,69,69,57, 60,74,73,73,49, 65,33,17,9,7,
54,73,73,73,54, 70,73,73,41,30, 0,0,20,0,0, 0,64,52,0,0, 0,8,20,34,65, 20,20,20,20,20, 0,65,34,20,8, 2,1,89,9,6,
62,65,93,89,78, 124,18,17,18,124, 127,73,73,73,54, 62,65,65,65,34, 127,65,65,65,62, 127,73,73,73,65, 127,9,9,9,1, 62,65,65,81,115,
127,8,8,8,127, 0,65,127,65,0, 32,64,65,63,1, 127,8,20,34,65, 127,64,64,64,64, 127,2,28,2,127, 127,4,8,16,127, 62,65,65,65,62,
127,9,9,9,6, 62,65,81,33,94, 127,9,25,41,70, 38,73,73,73,50, 3,1,127,1,3, 63,64,64,64,63, 31,32,64,32,31, 63,64,56,64,63,
99,20,8,20,99, 3,4,120,4,3, 97,89,73,77,67, 0,127,65,65,65, 2,4,8,16,32, 0,65,65,65,127, 4,2,1,2,4, 64,64,64,64,64,
0,3,7,8,0, 32,84,84,120,64, 127,40,68,68,56, 56,68,68,68,40, 56,68,68,40,127, 56,84,84,84,24, 0,8,126,9,2, 24,164,164,156,120,
127,8,4,4,120, 0,68,125,64,0, 32,64,64,61,0, 127,16,40,68,0, 0,65,127,64,0, 124,4,120,4,120, 124,8,4,4,120, 56,68,68,68,56,
252,24,36,36,24, 24,36,36,24,252, 124,8,4,4,8, 72,84,84,84,36, 4,4,63,68,36, 60,64,64,32,124, 28,32,64,32,28, 60,64,48,64,60,
68,40,16,40,68, 76,144,144,144,124, 68,100,84,76,68, 0,8,54,65,0, 0,0,119,0,0, 0,65,54,8,0, 2,1,2,4,2];

/* cell = 7 x 13 font pixels: at 1080x1920 one font pixel is ~3.5 px, which
   is the pixel size measured on the RETRO 01 glyphs */
const CW=7, CH=13, GX=1, GY=3;
const SP=24;                         // trace subcolumns per cell: one per output pixel column at 1080 wide, like the Waveform engine
const BLOCK=256, Q_TR=258, Q_BR=259, Q_BL=260, Q_TL=261, HALF=262;
const MASK=[];                       // code -> list of pixel offsets inside the cell
(function(){
  for(let ch=32;ch<127;ch++){
    const px=[];
    for(let col=0;col<5;col++){ const b=F58[(ch-32)*5+col];
      for(let row=0;row<8;row++) if(b&(1<<row)) px.push((GY+row)*CW+GX+col); }
    MASK[ch]=Int16Array.from(px);
  }
  const blk=[];
  for(let y=2;y<12;y++) for(let x=1;x<5;x++) blk.push(y*CW+x);
  MASK[BLOCK]=Int16Array.from(blk);
})();

/* glyph ramps, from the character statistics of the archive: b, D and g
   dominate the middle of the ramp; / and \ sit on the slopes of the trace */
const cc=s=>Int16Array.from([...s].map(c=>c.charCodeAt(0)));
const R_DIM  =cc(".,'`:-_~.,'");
const R_LIGHT=cc("()<>!?=+*^\";rcszxvil17j");
const R_MID  =cc("bbbbbDDDgggdqkhpnubDg");
const R_HEAVY=cc("DDGEKNMWBQRU8&%$@#ZSDb");
const R_EDGE =cc("KnGgEwuhMAYjBD0&*!:)5_ek");      // RETRO 03 carved-cell letters
const R_NOISE=[Q_TR,Q_TR,Q_TR,Q_BR,Q_TL,HALF,77,87,77,78,35];   // near-full glyphs (M W N #)

/* seeded hash -> [0,1) */
function h3(a,b,c){ let h=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+Math.imul(c|0,1103515245)+1013904223)|0;
  h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; h=Math.imul(h^(h>>>15),2246822519); h^=h>>>13; return (h>>>0)/4294967296; }
const pick=(arr,u)=>arr[Math.min(arr.length-1,(u*arr.length)|0)];

/* ------------------------------------------------------------ palettes --- */
/* A Look is colour only. Roles: base (page), ink0 (dim / accent hue),
   ink1 (main), ink2 (strongest contrast), glow (bloom or halo). */
const hexRGB=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
const LOOKS={
  terminal:{label:'Green terminal', base:'#101010', ink0:'#5c5e8c', ink1:'#96c85c', ink2:'#dcdcce', glow:'#6a140e'},
  paper:   {label:'Paper',          base:'#e9e8e7', ink0:'#8c8a89', ink1:'#403e3e', ink2:'#141414', glow:'#a39d98'},
  raster:  {label:'Green raster',   base:'#7a4e14', ink0:'#5fb84a', ink1:'#84fb6a', ink2:'#c4ffae', glow:'#3a1c06'},
  mono:    {label:'Mono',           base:'#0a0a0a', ink0:'#595959', ink1:'#cfcfcf', ink2:'#ffffff', glow:'#3a3a3a'},
  blue:    {label:'Blue',           base:'#060a18', ink0:'#33468f', ink1:'#76a2ff', ink2:'#dce6ff', glow:'#12306e'},
  red:     {label:'Red',            base:'#110505', ink0:'#6e2020', ink1:'#ff4b3a', ink2:'#ffd3c6', glow:'#620c08'},
  amber:   {label:'Amber',          base:'#0f0902', ink0:'#7d4b12', ink1:'#ffb03a', ink2:'#ffe3ab', glow:'#5e2a04'}
};
for(const k in LOOKS){ const L=LOOKS[k];
  L.rgb={base:hexRGB(L.base),ink0:hexRGB(L.ink0),ink1:hexRGB(L.ink1),ink2:hexRGB(L.ink2),glow:hexRGB(L.glow)};
  const b=L.rgb.base; L.dark=(0.299*b[0]+0.587*b[1]+0.114*b[2])<128; }
const pack=(c,a)=>((a&255)<<24)|((c[2]&255)<<16)|((c[1]&255)<<8)|(c[0]&255);

/* ------------------------------------------------------ audio features --- */
/* Same method as the product's Caustic analyser (band magnitudes in dB,
   band-limited spectral flux against its own slow average, weighted by
   level), extended to the six features the presets need. Each band is also
   normalised against its own running maximum, so a track's highs reach the
   same range as its bass and nothing is left to the low end alone. */
function makeFFT(n){
  const cos=new Float32Array(n/2), sin=new Float32Array(n/2), rev=new Uint32Array(n);
  for(let i=0;i<n/2;i++){ cos[i]=Math.cos(-2*Math.PI*i/n); sin[i]=Math.sin(-2*Math.PI*i/n); }
  let bits=0; while((1<<bits)<n) bits++;
  for(let i=0;i<n;i++){ let r=0; for(let b=0;b<bits;b++) if(i&(1<<b)) r|=1<<(bits-1-b); rev[i]=r; }
  return function(re,im){
    for(let i=0;i<n;i++){ const j=rev[i]; if(j>i){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
    for(let size=2;size<=n;size<<=1){ const half=size>>1, step=n/size;
      for(let i=0;i<n;i+=size) for(let j=i,k=0;j<i+half;j++,k+=step){
        const tr=cos[k]*re[j+half]-sin[k]*im[j+half], ti=cos[k]*im[j+half]+sin[k]*re[j+half];
        re[j+half]=re[j]-tr; im[j+half]=im[j]-ti; re[j]+=tr; im[j]+=ti; } }
  };
}
const NFFT=2048;
class Features{
  constructor(pcm,sr){
    this.pcm=pcm; this.sr=sr; this.fft=makeFFT(NFFT);
    this.re=new Float32Array(NFFT); this.im=new Float32Array(NFFT); this.win=new Float32Array(NFFT);
    for(let i=0;i<NFFT;i++) this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(NFFT-1));
    this.mag=new Float32Array(NFFT/2); this.prev=new Float32Array(NFFT/2);
    // amplitude reference of the whole track: 95th percentile of block peaks
    const B=1024, nb=Math.max(1,Math.floor(pcm.length/B)), pk=new Float32Array(nb);
    for(let b=0;b<nb;b++){ let m=0; for(let i=b*B,e=Math.min(pcm.length,i+B);i<e;i++){ const v=pcm[i]<0?-pcm[i]:pcm[i]; if(v>m)m=v; } pk[b]=m; }
    pk.sort(); this.ampRef=Math.max(0.05, pk[Math.floor(nb*0.95)]||0.05);
    this.o={bass:0,kick:0,mid:0,snare:0,high:0,hat:0,energy:0,level:0};
    this.reset();
  }
  reset(){
    this.lastT=-1e9; this.prev.fill(0);
    this.sB=this.sM=this.sH=this.sE=0; this.mB=this.mM=this.mH=0.2;
    this.aK=this.aS=this.aH=1e-6; this.kick=this.snare=this.hat=0; this.lvlMax=1e-3;
  }
  band(f0,f1){
    const i0=Math.max(1,Math.round(f0*NFFT/this.sr)), i1=Math.min(NFFT/2-1,Math.round(f1*NFFT/this.sr));
    let s=0; for(let i=i0;i<=i1;i++) s+=this.mag[i];
    const db=20*Math.log10(s/(i1-i0+1)/(NFFT/4)+1e-9);
    return Math.max(0,Math.min(1.25,(db+72)/56));
  }
  flux(f0,f1){
    const i0=Math.max(1,Math.round(f0*NFFT/this.sr)), i1=Math.min(NFFT/2-1,Math.round(f1*NFFT/this.sr));
    let s=0,e=0; for(let i=i0;i<=i1;i++){ const d=this.mag[i]-this.prev[i]; if(d>0) s+=d; e+=this.mag[i]; } this._e=e; return s;
  }
  read(t,dt){
    const pcm=this.pcm, n=pcm.length, s0=Math.round(t*this.sr)-(NFFT>>1);
    let rms=0;
    for(let i=0;i<NFFT;i++){ const k=s0+i, v=(k>=0&&k<n)?pcm[k]:0; this.re[i]=v*this.win[i]; this.im[i]=0; rms+=v*v; }
    rms=Math.sqrt(rms/NFFT);
    this.fft(this.re,this.im);
    for(let i=1;i<NFFT/2;i++) this.mag[i]=Math.hypot(this.re[i],this.im[i]);
    // flux, and the share of each band that is NEW this state: a sustained tone has none,
    // so it can never fire an onset however far its own flux average decays
    const fK=this.flux(30,150), eK=this._e, nK=fK/(eK+1e-9);
    const fS1=this.flux(150,350), eS1=this._e, fS2=this.flux(1000,4000), eS2=this._e;
    const fS=fS1+0.6*fS2, eS=eS1+0.6*eS2, nS=fS/(eS+1e-9);
    const fH=this.flux(6500,15000), eH=this._e, nH=fH/(eH+1e-9);
    this.flux(30,15000); const eT=this._e+1e-9;
    // ...and it must carry a real share of the spectrum: leakage from a bass tone is not a snare
    const sig=(e,share)=>Math.max(0,Math.min(1,e/(eT*share)));
    const gK=sig(eK,0.10), gS=sig(eS,0.10), gH=sig(eH,0.04);
    this.prev.set(this.mag);
    const bass=this.band(30,150), mid=this.band(300,2500), high=this.band(5000,14000);
    const jump=Math.abs(t-this.lastT)>0.35||t<this.lastT; this.lastT=t;
    if(jump){ this.sB=bass; this.sM=mid; this.sH=high; this.sE=rms; this.aK=fK+1e-6; this.aS=fS+1e-6; this.aH=fH+1e-6; this.kick=this.snare=this.hat=0; }
    const fol=(up,dn,cur,tgt)=>cur+(tgt-cur)*(1-Math.exp(-dt/(tgt>cur?up:dn)));
    this.sB=fol(0.015,0.10,this.sB,bass); this.sM=fol(0.02,0.12,this.sM,mid);
    this.sH=fol(0.01,0.07,this.sH,high);  this.sE=fol(0.01,0.13,this.sE,rms);
    // per-band running maximum (slow): every band gets the full range
    const dec=Math.exp(-dt/7);
    this.mB=Math.max(this.sB,this.mB*dec,0.45); this.mM=Math.max(this.sM,this.mM*dec,0.42); this.mH=Math.max(this.sH,this.mH*dec,0.42);
    this.lvlMax=Math.max(rms,this.lvlMax*Math.exp(-dt/5));
    const aud=Math.min(1,rms/(this.lvlMax*0.45+1e-6)) * Math.min(1, rms/0.004);   // level weight, and true silence stays silent
    const on=(f,a)=>Math.max(0,Math.min(1,(f/(a+1e-9)-1.3)/1.5))*aud;
    const nov=v=>Math.max(0,Math.min(1,(v-0.10)/0.25));
    const kk=on(fK,this.aK)*nov(nK)*gK, ss=on(fS,this.aS)*nov(nS)*gS, hh=on(fH,this.aH)*nov(nH)*gH;
    this.aK+=(fK-this.aK)*(1-Math.exp(-dt/0.55)); this.aS+=(fS-this.aS)*(1-Math.exp(-dt/0.55)); this.aH+=(fH-this.aH)*(1-Math.exp(-dt/0.45));
    this.kick=Math.max(kk,this.kick*Math.exp(-dt/0.06));
    this.snare=Math.max(ss,this.snare*Math.exp(-dt/0.08));
    this.hat=Math.max(hh,this.hat*Math.exp(-dt/0.05));
    const o=this.o, gate=v=>v*Math.min(1,rms/0.003);
    o.bass=gate(Math.min(1,this.sB/this.mB)); o.mid=gate(Math.min(1,this.sM/this.mM)); o.high=gate(Math.min(1,this.sH/this.mH));
    o.kick=this.kick; o.snare=this.snare; o.hat=this.hat;
    o.energy=Math.min(1.2,this.sE/(this.lvlMax*0.8+1e-5))*Math.min(1,rms/0.003);
    // loudness against the whole track: quiet passages stay quiet (scales the kick fill)
    o.level=Math.min(1,this.sE/(this.ampRef*0.22));
    return o;
  }
}

/* --------------------------------------------------------------- engine --- */
// measured step rates: unique states per second in each reference sequence
const STEP_HZ={r1:21.7, r3:21.4};
const TH1=[0.10,0.20,0.30,0.52,0.93];   // glyph-ramp thresholds (01)
const W8=[0,0.12,0.2,0.34,0.5,1];
const R_TUKEY=0.336;                 // the lens: same taper as the Waveform engine

class Engine{
  constructor(){ this.feat=null; this.pcmRef=null; this.lastStep=null; this.lastKey=''; this.C=0; this.R=0; this.N=0;
    this.o={bass:0,kick:0,mid:0,snare:0,high:0,hat:0,energy:0,level:0}; 
    this.th=new Float32Array(5); this.cols=new Int32Array(3); this.A={bass:0,kick:0,mid:0,snare:0,high:0,hat:0,energy:0}; this.g={C:0,R:0,W:0,H:0,step:0,ts:0,yc:0,reach:0,x0:0,x1:0}; }

  grid(C,R){
    if(this.C===C&&this.R===R) return;
    this.C=C; this.R=R; const n=C*R;
    this.cov=new Float32Array(n); this.halo=new Float32Array(n); this.tmp=new Float32Array(n);
    this.sl=new Float32Array(n); this.sw=new Float32Array(n); this.tip=new Float32Array(n);
    this.code=new Int16Array(n); this.tone=new Uint8Array(n); this.lvl=new Uint8Array(n);
    this.pcode=new Int16Array(n).fill(-1); this.carve=new Uint8Array(n); this.pcarve=new Uint8Array(n);
    this.bl=new Float32Array(4*n); this.bl2=new Float32Array(4*n);
    this.low=document.createElement('canvas'); this.low.width=C*CW; this.low.height=R*CH;
    this.lctx=this.low.getContext('2d'); this.limg=this.lctx.createImageData(C*CW,R*CH);
    this.l32=new Uint32Array(this.limg.data.buffer);
    this.lowF=document.createElement('canvas'); this.lowF.width=C*CW; this.lowF.height=R*CH;
    this.fctx=this.lowF.getContext('2d'); this.fimg=this.fctx.createImageData(C*CW,R*CH); this.f32=new Uint32Array(this.fimg.data.buffer);
    this.bcv=document.createElement('canvas'); this.bcv.width=2*C; this.bcv.height=2*R;
    this.bctx=this.bcv.getContext('2d'); this.bimg=this.bctx.createImageData(2*C,2*R);
    this.pcode.fill(-1); this.pcarve.fill(0);
  }
  subcols(N){ if(this.N===N) return; this.N=N; this.yT=new Float32Array(N); this.yB=new Float32Array(N); this.fA=new Float32Array(N); this.ym=new Float32Array(N+1); this.pin=new Float32Array(N);
    for(let i=0;i<N;i++){ const u=(i+0.5)/N*2-1, t=Math.min(1,Math.max(0,(1-Math.abs(u))/R_TUKEY)); this.pin[i]=0.5*(1-Math.cos(Math.PI*t)); } }

  render(ctx,W,H,t,S,pcm,sr,ver){
    const id=S.preset, P=S[id], look=LOOKS[P.look]||LOOKS.terminal;
    const hz=STEP_HZ[id]*P.motion;
    const step=Math.floor(t*hz+1e-6);
    const key=ver;
    if(this.out && this.out.width===W && this.out.height===H && step===this.lastStep && key===this.lastKey && pcm===this.pcmRef){ ctx.drawImage(this.out,0,0); return; }
    if(!this.out||this.out.width!==W||this.out.height!==H){ this.out=document.createElement('canvas'); this.out.width=W; this.out.height=H; this.octx=this.out.getContext('2d',{alpha:false}); }

    /* -- analysis runs on the step clock, so preview and export see the same states -- */
    if(pcm && this.pcmRef!==pcm){ this.feat=new Features(pcm,sr); this.pcmRef=pcm; }
    if(!pcm){ this.feat=null; this.pcmRef=null; }
    if(step!==this.lastStep){
      const ts=step/hz, gap=this.lastStep==null?1e9:(step-this.lastStep)/hz;
      if(this.feat){ const f=this.feat.read(ts, gap>0&&gap<0.35?gap:1/hz); Object.assign(this.o,f); }
      else for(const k in this.o) this.o[k]=0;
    }
    const resp=P.response, o=this.o, A=this.A;
    A.bass=Math.min(1.3,o.bass*resp); A.kick=Math.min(1.3,o.kick*resp*(0.25+0.75*o.level)); A.mid=Math.min(1.3,o.mid*resp);
    A.snare=Math.min(1.3,o.snare*resp); A.high=Math.min(1.3,Math.max(o.high,o.hat)*resp); A.hat=Math.min(1.3,o.hat*resp); A.energy=Math.min(1.3,o.energy*resp);

    /* -- the character grid: 44 x 43 at scale 1 (measured), cell aspect 1 : 1.819 --
       A landscape frame keeps the same cell size (44 cells across its short side, so more columns across the
       width) and the same vertical reach of the trace in cells; a portrait frame is exactly as measured. */
    const wide=Math.max(1,W/H);
    const C=Math.max(12,Math.round(44/P.scale*wide)), R=Math.max(12,Math.round(H/(W/C*1.8191)));
    this.grid(C,R);
    if(id!==this.lastId){ this.pcode.fill(-1); this.pcarve.fill(0); }
    const g=this.g; g.C=C; g.R=R; g.W=W; g.H=H; g.step=step; g.ts=step/hz; g.yc=R*0.5; g.reach=R*(5.9/43)*wide; g.x0=C*0.15; g.x1=C*0.85;

    if(id==='r1') this.r1(g,P,A,pcm,sr,look);
    else this.r3(g,P,A,pcm,sr,look);

    ctx.drawImage(this.out,0,0);
    this.lastStep=step; this.lastKey=key; this.lastId=id;
  }

  /* ---- source: the audio window as per-subcolumn spans, in cell units ---- */
  trace(g,mode,winSec,gain,minT,pcm,sr){
    const N=Math.round((g.x1-g.x0)*SP); this.subcols(N);
    const yT=this.yT, yB=this.yB, ym=this.ym, pin=this.pin, reach=g.reach*gain;
    const ref=this.feat?this.feat.ampRef:1;
    if(!pcm){ for(let i=0;i<N;i++){ yT[i]=g.yc-minT/2; yB[i]=g.yc+minT/2; ym[i]=g.yc; } ym[N]=g.yc; return; }
    const t=g.ts, n=winSec*sr, start=Math.floor(t*sr-n), L=pcm.length;
    if(mode==='minmax'){
      for(let i=0;i<N;i++){
        let s0=Math.floor(start+n*i/N), s1=Math.floor(start+n*(i+1)/N); if(s1<=s0) s1=s0+1;
        let mn=1e9,mx=-1e9; for(let s=s0;s<s1;s++){ const v=(s>=0&&s<L)?pcm[s]:0; if(v<mn)mn=v; if(v>mx)mx=v; }
        const lim=g.reach*1.02*pin[i]; let a=mx/ref*reach*pin[i], b=mn/ref*reach*pin[i]; a=a>lim?lim:a<-lim?-lim:a; b=b>lim?lim:b<-lim?-lim:b;
        let top=g.yc-a, bot=g.yc-b; if(bot-top<minT){ const m=(top+bot)/2; top=m-minT/2; bot=m+minT/2; }
        yT[i]=top; yB[i]=bot; ym[i]=(top+bot)/2;
      }
      ym[N]=ym[N-1];
    } else {
      // low-passed single-valued trace (RETRO 03): one-pole LP, settled 25 ms early
      const k=1-Math.exp(-2*Math.PI*230/sr); let lp=0, s=start-Math.floor(0.025*sr);
      for(;s<start;s++) lp+=(((s>=0&&s<L)?pcm[s]:0)-lp)*k;
      for(let i=0;i<=N;i++){
        const s1=Math.floor(start+n*i/N); let acc=0,c=0;
        for(;s<s1;s++){ lp+=(((s>=0&&s<L)?pcm[s]:0)-lp)*k; acc+=lp; c++; }
        const v=c?acc/c:lp, lim=g.reach*1.02; let d=v/ref*1.35*reach; d=d>lim?lim:d<-lim?-lim:d; ym[i]=g.yc-d*pin[Math.min(N-1,i)];
      }
      for(let i=0;i<N;i++){ const a=Math.min(ym[i],ym[i+1]), b=Math.max(ym[i],ym[i+1]);
        yT[i]=a-minT/2; yB[i]=b+minT/2; }
    }
  }
  /* kick fill: the lens opens as column groups with gaps (reference frames 18 / 156).
     soft = density of the filled material (01: partial, so the fill reads as letters with
     some blocks, as in the archive); without it the spans are simply widened (03 carves). */
  fill(g,kf,groupCells,gapP,salt,soft){
    this.fA.fill(0); this.fSoft=soft||0; this.fSalt=salt;
    if(kf<=0.02) return;
    const N=this.N, yT=this.yT, yB=this.yB, pin=this.pin;
    for(let i=0;i<N;i++){
      const grp=Math.floor(i/(SP*groupCells));
      let A=g.reach*pin[i]*kf*(0.55+0.45*h3(grp,g.step,salt));
      if(h3(grp,g.step,salt+1)<gapP) A*=0.2;
      if(soft){ this.fA[i]=A; continue; }
      if(g.yc-A<yT[i]) yT[i]=g.yc-A; if(g.yc+A>yB[i]) yB[i]=g.yc+A;
    }
  }
  /* coverage of every cell (0..1) plus the mean slope of the trace in it */
  cover(g){
    const {C,R}=g, cov=this.cov, sl=this.sl, sw=this.sw, N=this.N, yT=this.yT, yB=this.yB, ym=this.ym;
    cov.fill(0); sl.fill(0); sw.fill(0);
    for(let i=0;i<N;i++){
      const c=Math.floor(g.x0+i/SP); if(c<0||c>=C) continue;
      const top=yT[i], bot=yB[i], dy=(ym[Math.min(N,i+1)]-ym[i])*SP;   // rows per column
      const r0=Math.max(0,Math.floor(top)), r1=Math.min(R-1,Math.ceil(bot)-1);
      for(let r=r0;r<=r1;r++){ const ov=Math.min(bot,r+1)-Math.max(top,r); if(ov<=0) continue;
        const k=r*C+c; cov[k]+=ov/SP; sl[k]+=dy*ov; sw[k]+=ov; }
    }
    if(this.fSoft) for(let i=0;i<N;i++){ const A=this.fA[i]; if(A<=0) continue;
      const c=Math.floor(g.x0+i/SP); if(c<0||c>=C) continue;
      const top=g.yc-A, bot=g.yc+A, r0=Math.max(0,Math.floor(top)), r1=Math.min(R-1,Math.ceil(bot)-1);
      for(let r=r0;r<=r1;r++){ const ov=Math.min(bot,r+1)-Math.max(top,r); if(ov<=0) continue;
        const k=r*C+c; cov[k]+=ov/SP*this.fSoft*(0.3+0.9*h3(k,g.step,this.fSalt+2)); } }
    for(let k=0;k<C*R;k++){ if(cov[k]>1) cov[k]=1; sl[k]=sw[k]>0?sl[k]/sw[k]*1.8191:0; }
  }
  blurCells(src,dst,C,R,passes){
    const t=this.tmp; dst.set(src);
    for(let p=0;p<passes;p++){
      for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c; t[k]=(dst[k]*2+(c>0?dst[k-1]:0)+(c<C-1?dst[k+1]:0))*0.25; }
      for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c; dst[k]=(t[k]*2+(r>0?t[k-C]:0)+(r<R-1?t[k+C]:0))*0.25; }
    }
  }
  tips(g,amt){ const k0=Math.floor(g.yc)*g.C; this.tip.fill(0);
    const a=Math.floor(g.x0), b=Math.min(g.C-1,Math.floor(g.x1-1e-3)); this.tip[k0+a]=amt; this.tip[k0+b]=amt; }
  slopeGlyph(s,u){ const a=Math.abs(s); if(a<0.45) return u<0.5?45:95; if(a>2.8) return u<0.6?124:33; return s>0?92:47; }

  /* glyph for a lit cell from its level (1..5) — the bright ramp of 01 */
  ramp(lvl,slope,u,v){
    const diag=Math.abs(slope)>=0.45;
    if(lvl<=1) return (diag&&v<0.6)||(!diag&&v<0.35)?this.slopeGlyph(slope,u):pick(R_DIM,u);
    if(lvl===2) return diag&&v<0.4?this.slopeGlyph(slope,u):pick(R_LIGHT,u);
    if(lvl===3) return pick(R_MID,u);
    if(lvl===4) return pick(R_HEAVY,u);
    return BLOCK;
  }
  /* lit-cell pass for 01 */
  litCells(g,P,A,th,dropP,salt,quiet){
    const {C,R,step}=g, cov=this.cov, halo=this.halo, code=this.code, tone=this.tone, lvl=this.lvl, sl=this.sl, tip=this.tip;
    code.fill(-1); tone.fill(0); lvl.fill(0);
    let lit=0;
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){
      // the cell's light saturates (the trace carries its own glow in the source): a thin clean
      // curve reads as letters, a filled span as blocks - as in the archive
      const k=r*C+c, L=Math.min(1,1.55*Math.sqrt(cov[k]+0.3*halo[k]))*quiet+tip[k];
      if(L<th[0]) continue;
      if(tip[k]===0 && h3(k,step,salt)<dropP) continue;
      let lv=1; while(lv<5&&L>=th[lv]) lv++;
      lvl[k]=lv; code[k]=this.ramp(lv,sl[k],h3(k,step,salt+1),h3(k,step,salt+2));
      tone[k]= lv<=1?0 : lv===2?(h3(k,step,salt+3)<0.5?0:1) : (lv>=4&&(L>0.985||h3(k,step,salt+4)<P.contrast*0.18)?2:1);
      lit++;
    }
    return lit;
  }
  persist(g,P,salt){
    const n=g.C*g.R, code=this.code, pc=this.pcode, pr=P.persistence*0.85;
    if(pr>0) for(let k=0;k<n;k++) if(code[k]<0&&pc[k]>=0&&h3(k,g.step,salt)<pr){ code[k]=pc[k]; this.tone[k]=0; this.lvl[k]=1; }
    pc.set(code);
  }

  /* =================================================================== 01 */
  /* BASS -> vertical reach of the trace   KICK -> lens fill + threshold drop + bloom surge
     MID  -> density (thresholds)          SNARE -> lit cells promoted to full blocks
     HIGH -> punctuation sparks beside the trace, fringe widens
     ENERGY -> bloom intensity and tip cells                                        */
  r1(g,P,A,pcm,sr,look){
    this._id='r1';
    const {C,R,step}=g;
    this.trace(g,'minmax',0.050,0.55+0.6*A.bass+0.2*A.energy,0.06,pcm,sr);
    this.fill(g,Math.pow(Math.max(0,A.kick-0.3)/0.7,1.5),4.5,0.22,51,0.10);
    this.cover(g); this.blurCells(this.cov,this.halo,C,R,1);
    this.tips(g,pcm?0.30+0.45*A.energy+0.3*A.kick:0.22);
    const dens=(0.6+0.9*P.density)*(0.85+0.4*A.mid), kd=1-0.35*Math.min(1,A.kick);
    const th=this.th, TB=TH1; for(let i=0;i<5;i++) th[i]=TB[i]/dens*kd;
    this.litCells(g,P,A,th,0.48-0.28*P.density,101,0.5+0.5*Math.min(1,this.o.level*4));
    const code=this.code, tone=this.tone, lvl=this.lvl;
    // snare: blocks
    if(A.snare>0.05) for(let k=0;k<C*R;k++) if(lvl[k]>=3&&h3(k,step,131)<A.snare*0.15){ code[k]=BLOCK; lvl[k]=5; tone[k]=1; }
    // high: sparks one row off the trace
    if(A.high>0.05) for(let r=1;r<R-1;r++) for(let c=0;c<C;c++){ const k=r*C+c;
      if(code[k]>=0||(code[k-C]<0&&code[k+C]<0)) continue;
      if(h3(k,step,141)<A.high*0.10){ code[k]=pick(R_DIM,h3(k,step,142)); tone[k]=0; lvl[k]=1; } }
    this.persist(g,P,151);

    /* paint: pixel buffer, two-tone glyphs with the slate fringe on the left */
    const l32=this.l32, BW=C*CW, rgb=look.rgb, cols=this.cols; cols[0]=pack(rgb.ink0,255); cols[1]=pack(rgb.ink1,255); cols[2]=pack(rgb.ink2,255);
    const fr=pack(rgb.ink0,255), f32=this.f32;
    l32.fill(0); f32.fill(0);
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c, cd=code[k]; if(cd<0) continue;
      const m=MASK[cd]||MASK[63], ox=c*CW, oy=r*CH, tn=tone[k], col=cols[tn];
      for(let j=0;j<m.length;j++){ const p=m[j], q=(oy+(p/CW|0))*BW+ox+p%CW; l32[q]=col; if(tn>0) f32[q]=fr; }
    }
    this.lctx.putImageData(this.limg,0,0); this.fctx.putImageData(this.fimg,0,0);
    // the slate fringe is a sub-pixel optical split (left / up), wider with the highs
    const fpx=(0.42+0.35*A.high)*g.W/(C*CW), fpy=0.25*g.H/(R*CH);

    // bloom: lit cells only, no memory (the archive shows none)
    const bl=this.bl; bl.fill(0); const C2=2*C;
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c; if(code[k]<0) continue;
      const v=code[k]===BLOCK?1:W8[lvl[k]]; const q=(2*r)*C2+2*c; bl[q]+=v; bl[q+1]+=v; bl[q+C2]+=v; bl[q+C2+1]+=v; }
    const bamt=P.bloom*(0.4+0.35*A.energy+0.6*A.kick);
    this.paintBloom(look,bamt,2);

    const x=this.octx; x.globalCompositeOperation='source-over'; x.fillStyle=look.base; x.fillRect(0,0,g.W,g.H);
    x.imageSmoothingEnabled=true;
    x.globalCompositeOperation=look.dark?'lighter':'multiply'; x.drawImage(this.bcv,0,0,g.W,g.H);
    x.globalCompositeOperation='source-over'; x.imageSmoothingEnabled=false;
    x.drawImage(this.lowF,-fpx,-fpy,g.W,g.H); x.drawImage(this.low,0,0,g.W,g.H);
  }
  paintBloom(look,amt,passes){
    const C2=this.bcv.width, R2=this.bcv.height, bl=this.bl, t=this.bl2;
    for(let p=0;p<passes;p++){
      for(let r=0;r<R2;r++) for(let c=0;c<C2;c++){ const k=r*C2+c; t[k]=(bl[k]*2+(c>0?bl[k-1]:0)+(c<C2-1?bl[k+1]:0))*0.25; }
      for(let r=0;r<R2;r++) for(let c=0;c<C2;c++){ const k=r*C2+c; bl[k]=(t[k]*2+(r>0?t[k-C2]:0)+(r<R2-1?t[k+C2]:0))*0.25; }
    }
    const d=this.bimg.data, gc=look.rgb.glow;
    for(let k=0;k<C2*R2;k++){ const v=Math.min(1,bl[k]*amt*1.8), o=k*4;
      if(look.dark){ d[o]=gc[0]*v; d[o+1]=gc[1]*v; d[o+2]=gc[2]*v; d[o+3]=255; }
      else { d[o]=255+(gc[0]-255)*v; d[o+1]=255+(gc[1]-255)*v; d[o+2]=255+(gc[2]-255)*v; d[o+3]=255; } }
    this.bctx.putImageData(this.bimg,0,0);
  }

  /* =================================================================== 03 */
  /* BASS -> amplitude of the carved trace   KICK -> the whole lens is carved open
     MID  -> trace thickness + halo width    SNARE -> glyph scramble + erosion of the wall along the trace
     HIGH -> stray near-block glyphs across the wall
     ENERGY -> halo darkness                                                         */
  r3(g,P,A,pcm,sr,look){
    this._id='r3';
    const {C,R,step}=g, n=C*R;
    const T=0.14+0.32*A.mid*(0.6+0.8*P.density);
    this.trace(g,'lp',0.060,0.5+0.7*A.bass+0.15*A.energy,T,pcm,sr);
    this.fill(g,Math.pow(Math.max(0,A.kick-0.3)/0.7,1.5)*1.05,5,0.12,57);
    this.cover(g);
    this.tips(g,0.4);
    const cov=this.cov, carve=this.carve, code=this.code, sl=this.sl, tip=this.tip;
    const thc=0.05/(0.6+0.9*P.density);
    carve.fill(0); code.fill(BLOCK);
    for(let k=0;k<n;k++) if(cov[k]+tip[k]>thc) carve[k]=1;
    // persistence: carved cells may survive one more state (trail)
    const pr=P.persistence*0.8;
    if(pr>0) for(let k=0;k<n;k++) if(!carve[k]&&this.pcarve[k]&&h3(k,step,301)<pr) carve[k]=2;
    this.pcarve.set(carve);
    // inverted ramp inside the carve
    for(let k=0;k<n;k++){ if(!carve[k]) continue;
      const L=cov[k], u=h3(k,step,311), v=h3(k,step,312);
      let cd=-1;
      if(carve[k]===2) cd=v<0.5?pick(R_DIM,u):-1;
      else if(L>0.55) cd=v<0.22?pick(R_DIM,u):-1;
      else if(L>0.18) cd=v<0.42?-1:(Math.abs(sl[k])>=0.45&&v<0.62?this.slopeGlyph(sl[k],u):pick(R_EDGE,u));
      else cd=v<0.35?-1:pick(R_HEAVY,u);
      if(A.snare>0.05&&h3(k,step,313)<A.snare*0.55) cd=pick(R_EDGE,h3(k,step,314));
      code[k]=cd;
    }
    // snare erosion + high-band stray glyphs in the wall
    const pN=(0.003+0.018*P.noise)*(1+2.5*A.high);
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c; if(carve[k]) continue;
      const nb=(c>0&&carve[k-1])||(c<C-1&&carve[k+1])||(r>0&&carve[k-C])||(r<R-1&&carve[k+C]);
      if((nb&&h3(k,step,321)<A.snare*0.3)||h3(k,step,322)<pN) code[k]=pick(R_NOISE,h3(k,step,323)); }
    // halo: dark ring around the carve
    const hs=this.halo; for(let k=0;k<n;k++) this.tmp[k]=carve[k]?1:0;
    this.blurCells(this.tmp,hs,C,R,1+(A.mid>0.5?1:0));
    const bl=this.bl, C2=2*C; bl.fill(0);
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const v=carve[r*C+c]?1:hs[r*C+c]*0.8, q=2*r*C2+2*c; bl[q]=bl[q+1]=bl[q+C2]=bl[q+C2+1]=v; }

    /* paint: vector cells at output resolution (the reference font here is a clean mono) */
    const x=this.octx, W=g.W, H=g.H, cw=W/C, ch=H/R;
    x.globalCompositeOperation='source-over'; x.fillStyle=look.base; x.fillRect(0,0,W,H);
    const hamt=(0.5+0.5*P.contrast)*(0.6+0.5*A.energy+0.4*A.kick);
    this.paintHalo(look,hamt);
    x.imageSmoothingEnabled=true; x.drawImage(this.bcv,0,0,W,H);
    const bx=cw*0.2, bw=Math.max(1,Math.round(cw*0.59)), by=ch*0.085, bh=Math.max(1,Math.round(ch*0.83)), hw=Math.round(bw/2), hh=Math.round(bh/2);
    x.fillStyle=look.ink1; x.beginPath();
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c, cd=code[k]; if(carve[k]||cd<256) continue;
      const X=Math.round(c*cw+bx), Y=Math.round(r*ch+by);
      if(cd===BLOCK) x.rect(X,Y,bw,bh);
      else if(cd===Q_TR){ x.rect(X,Y,hw,bh); x.rect(X+hw,Y+hh,bw-hw,bh-hh); }
      else if(cd===Q_BR){ x.rect(X,Y,hw,bh); x.rect(X+hw,Y,bw-hw,hh); }
      else if(cd===Q_BL){ x.rect(X+hw,Y,bw-hw,bh); x.rect(X,Y,hw,hh); }
      else if(cd===Q_TL){ x.rect(X+hw,Y,bw-hw,bh); x.rect(X,Y+hh,hw,bh-hh); }
      else if(cd===HALF) x.rect(X,Y,hw,bh);
    }
    x.fill();
    x.font='500 '+(ch*0.6).toFixed(1)+'px ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace';
    x.textAlign='center'; x.textBaseline='middle';
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const k=r*C+c, cd=code[k]; if(cd<0||cd>=256) continue;
      x.fillText(String.fromCharCode(cd), c*cw+cw*0.5, r*ch+ch*0.52); }
  }
  paintHalo(look,amt){
    const C2=this.bcv.width, R2=this.bcv.height, bl=this.bl, t=this.bl2;
    for(let p=0;p<2;p++){
      for(let r=0;r<R2;r++) for(let c=0;c<C2;c++){ const k=r*C2+c; t[k]=(bl[k]*2+(c>0?bl[k-1]:0)+(c<C2-1?bl[k+1]:0))*0.25; }
      for(let r=0;r<R2;r++) for(let c=0;c<C2;c++){ const k=r*C2+c; bl[k]=(t[k]*2+(r>0?t[k-C2]:0)+(r<R2-1?t[k+C2]:0))*0.25; }
    }
    const d=this.bimg.data, gc=look.rgb.glow;
    for(let k=0;k<C2*R2;k++){ const o=k*4; d[o]=gc[0]; d[o+1]=gc[1]; d[o+2]=gc[2]; d[o+3]=Math.min(255,bl[k]*amt*255); }
    this.bctx.putImageData(this.bimg,0,0);
  }
}

const DEFAULTS={ preset:'r1',
  r1:{look:'mono',     density:0.5, scale:1, motion:1, persistence:0, response:1, contrast:0.4, bloom:0.6},
  r3:{look:'raster',   density:0.5, scale:1, motion:1, persistence:0, response:1, contrast:0.5, noise:0.5} };

return { Engine, LOOKS, DEFAULTS, STEP_HZ, Features };
})();


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

const CONTOUR_DATA=(function(){
const C = (r,g,b)=>[r/255,g/255,b/255];
const COLOR_PRESETS = {
  chalk: {            // reference 1 — luminous chalk + stepped topo rings on black
    name:'Chalk', bg:C(11,11,13), core:C(236,239,244), contour:C(160,162,168), hi:C(236,239,244), shadow:C(0,0,0), ridge:C(236,239,244),
    coreAmt:1.0, poster:5, contourAmt:0.95, fineAmt:0.3, relief:0, reliefHard:0, reliefHalo:0, hiAmt:0, shadowAmt:0, ridgeAmt:0, ridgeTh:1, detail:0.6, grain:0.034, light:C(232,238,255), lightAmt:0.95,
    swatch:{b:'#0b0b0d',f:'#eceff4',g:'#6a6b70'}
  },
  moss: {             // reference 2 — dark relief, only ridge crests survive in pale green
    name:'Moss', bg:C(10,11,10), core:C(120,124,120), contour:C(40,44,40), hi:C(150,156,150), shadow:C(0,0,0), ridge:C(187,210,160),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:5.0, reliefHard:0.2, reliefHalo:0.0, hiAmt:0.75, shadowAmt:0.9, ridgeAmt:1.0, ridgeTh:0.58, detail:0.7, grain:0.045, light:C(160,200,130), lightAmt:0.85,
    swatch:{b:'#0a0b0a',f:'#bbd2a0',g:'#2a2c2a'}
  },
  graphite: {         // reference 3 — grey emboss, hard clipped black shadows
    name:'Graphite', bg:C(143,144,146), core:C(143,144,146), contour:C(120,121,123), hi:C(212,214,218), shadow:C(6,6,6), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:4.6, reliefHard:0.85, reliefHalo:0.10, hiAmt:0.5, shadowAmt:1.0, ridgeAmt:0, ridgeTh:1, detail:0.12, grain:0.026, light:C(250,250,252), lightAmt:0.75,
    swatch:{b:'#8f9092',f:'#070707',g:'#b8babc'}
  },
  clay: {             // reference 4 — terracotta emboss, oxide shadows, pale highlights
    name:'Clay', bg:C(220,137,115), core:C(220,137,115), contour:C(200,118,98), hi:C(244,205,196), shadow:C(122,40,28), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:3.6, reliefHard:0.45, reliefHalo:0.10, hiAmt:0.85, shadowAmt:0.95, ridgeAmt:0, ridgeTh:1, detail:0.2, grain:0.022, light:C(255,236,226), lightAmt:0.75,
    swatch:{b:'#dc8973',f:'#7a281c',g:'#f4cdc4'}
  },
  frost: {            // reference 5 — pale ice, soft pillow emboss with faint ripples
    name:'Frost', bg:C(211,222,226), core:C(211,222,226), contour:C(150,166,176), hi:C(240,246,247), shadow:C(58,70,78), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.55, fineAmt:0.0, relief:3.2, reliefHard:0.3, reliefHalo:0.45, hiAmt:0.9, shadowAmt:0.85, ridgeAmt:0, ridgeTh:1, detail:0.25, grain:0.022, light:C(255,255,255), lightAmt:0.85,
    swatch:{b:'#d3dee2',f:'#3a464e',g:'#b0bec6'}
  }
};
const DEFAULT_PRESET = 'chalk';

/* ---------------- creative controls ---------------- */
const CONTROLS = [
  {k:'twist',   label:'Twist',    min:0.5, max:4, v:2.01, step:0.01, hint:'how many half-turns the cloth makes'},
  {k:'body',    label:'Body',     min:0.6, max:1.4, v:1.08, step:0.01, hint:'width of the cloth'},
  {k:'flow',    label:'Flow',     min:0.0, max:2.0, v:1.63, step:0.01, hint:'speed of rotation and travelling torsion'},
  {k:'influence',label:'Audio influence', min:0.0, max:2.0, v:0.38, step:0.01, hint:'how strongly the audio modulates the form\'s own movement'},
  {k:'trails',  label:'Trails',   min:0.0, max:1.0, v:0.00, step:0.01, hint:'temporal persistence of the strands'},
  {k:'halo',    label:'Halo',     min:0.0, max:2.0, v:0.00, step:0.01, hint:'reach of the stepped contour rings'},
  {k:'grit',    label:'Grit',     min:0.0, max:2.0, v:1.21, step:0.01, hint:'grain, cell coarseness and contour flicker'},
  {k:'glow',    label:'Glow',     min:0.0, max:2.0, v:0.27, step:0.01, hint:'soft light bleeding off the dense threads', g:'light'},
  {k:'rays',    label:'Rays',     min:0.0, max:2.0, v:0.35, step:0.01, hint:'light shafts streaming out of the form', g:'light'},
  {k:'depth',   label:'Depth',    min:0.0, max:2.0, v:1.41, step:0.01, hint:'3D displacement, perspective and camera drift', g:'light'},
  {k:'warp',    label:'Warp',     min:0.0, max:2.0, v:1.97, step:0.01, hint:'space bends and flows around the form', g:'light'},
];

return {COLOR_PRESETS,CONTROLS,DEFAULT_PRESET};
})();

/* CONTOUR CLOTH renderer, verbatim, wrapped as a factory: one instance per canvas */
function makeContour(canvas){
'use strict';
/* ==========================================================================
   CONTOUR BRAID — standalone audio-reactive renderer
   Audio → analysis → braid geometry → density + persistence → two-scale field
   → quantized contour / posterize / relief material → color preset.
   ========================================================================== */

/* ---------------- COLOR PRESETS (appearance only) ---------------- */
const C = (r,g,b)=>[r/255,g/255,b/255];
const COLOR_PRESETS = {
  chalk: {            // reference 1 — luminous chalk + stepped topo rings on black
    name:'Chalk', bg:C(11,11,13), core:C(236,239,244), contour:C(160,162,168), hi:C(236,239,244), shadow:C(0,0,0), ridge:C(236,239,244),
    coreAmt:1.0, poster:5, contourAmt:0.95, fineAmt:0.3, relief:0, reliefHard:0, reliefHalo:0, hiAmt:0, shadowAmt:0, ridgeAmt:0, ridgeTh:1, detail:0.6, grain:0.034, light:C(232,238,255), lightAmt:0.95,
    swatch:{b:'#0b0b0d',f:'#eceff4',g:'#6a6b70'}
  },
  moss: {             // reference 2 — dark relief, only ridge crests survive in pale green
    name:'Moss', bg:C(10,11,10), core:C(120,124,120), contour:C(40,44,40), hi:C(150,156,150), shadow:C(0,0,0), ridge:C(187,210,160),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:5.0, reliefHard:0.2, reliefHalo:0.0, hiAmt:0.75, shadowAmt:0.9, ridgeAmt:1.0, ridgeTh:0.58, detail:0.7, grain:0.045, light:C(160,200,130), lightAmt:0.85,
    swatch:{b:'#0a0b0a',f:'#bbd2a0',g:'#2a2c2a'}
  },
  graphite: {         // reference 3 — grey emboss, hard clipped black shadows
    name:'Graphite', bg:C(143,144,146), core:C(143,144,146), contour:C(120,121,123), hi:C(212,214,218), shadow:C(6,6,6), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:4.6, reliefHard:0.85, reliefHalo:0.10, hiAmt:0.5, shadowAmt:1.0, ridgeAmt:0, ridgeTh:1, detail:0.12, grain:0.026, light:C(250,250,252), lightAmt:0.75,
    swatch:{b:'#8f9092',f:'#070707',g:'#b8babc'}
  },
  clay: {             // reference 4 — terracotta emboss, oxide shadows, pale highlights
    name:'Clay', bg:C(220,137,115), core:C(220,137,115), contour:C(200,118,98), hi:C(244,205,196), shadow:C(122,40,28), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.0, fineAmt:0.0, relief:3.6, reliefHard:0.45, reliefHalo:0.10, hiAmt:0.85, shadowAmt:0.95, ridgeAmt:0, ridgeTh:1, detail:0.2, grain:0.022, light:C(255,236,226), lightAmt:0.75,
    swatch:{b:'#dc8973',f:'#7a281c',g:'#f4cdc4'}
  },
  frost: {            // reference 5 — pale ice, soft pillow emboss with faint ripples
    name:'Frost', bg:C(211,222,226), core:C(211,222,226), contour:C(150,166,176), hi:C(240,246,247), shadow:C(58,70,78), ridge:C(0,0,0),
    coreAmt:0.0, poster:5, contourAmt:0.55, fineAmt:0.0, relief:3.2, reliefHard:0.3, reliefHalo:0.45, hiAmt:0.9, shadowAmt:0.85, ridgeAmt:0, ridgeTh:1, detail:0.25, grain:0.022, light:C(255,255,255), lightAmt:0.85,
    swatch:{b:'#d3dee2',f:'#3a464e',g:'#b0bec6'}
  }
};
const DEFAULT_PRESET = 'chalk';

/* ---------------- creative controls ---------------- */
const CONTROLS = [
  {k:'twist',   label:'Twist',    min:0.5, max:4, v:2.01, step:0.01, hint:'how many half-turns the cloth makes'},
  {k:'body',    label:'Body',     min:0.6, max:1.4, v:1.08, step:0.01, hint:'width of the cloth'},
  {k:'flow',    label:'Flow',     min:0.0, max:2.0, v:1.63, step:0.01, hint:'speed of rotation and travelling torsion'},
  {k:'influence',label:'Audio influence', min:0.0, max:2.0, v:0.38, step:0.01, hint:'how strongly the audio modulates the form\'s own movement'},
  {k:'trails',  label:'Trails',   min:0.0, max:1.0, v:0.00, step:0.01, hint:'temporal persistence of the strands'},
  {k:'halo',    label:'Halo',     min:0.0, max:2.0, v:0.00, step:0.01, hint:'reach of the stepped contour rings'},
  {k:'grit',    label:'Grit',     min:0.0, max:2.0, v:1.21, step:0.01, hint:'grain, cell coarseness and contour flicker'},
  {k:'glow',    label:'Glow',     min:0.0, max:2.0, v:0.27, step:0.01, hint:'soft light bleeding off the dense threads', g:'light'},
  {k:'rays',    label:'Rays',     min:0.0, max:2.0, v:0.35, step:0.01, hint:'light shafts streaming out of the form', g:'light'},
  {k:'depth',   label:'Depth',    min:0.0, max:2.0, v:1.41, step:0.01, hint:'3D displacement, perspective and camera drift', g:'light'},
  {k:'warp',    label:'Warp',     min:0.0, max:2.0, v:1.97, step:0.01, hint:'space bends and flows around the form', g:'light'},
];
const P = {}; CONTROLS.forEach(c=>P[c.k]=c.v);
let presetKey = DEFAULT_PRESET;

/* ======================= AUDIO ANALYSIS (offline, deterministic) ======================= */
const FPS_A = 60, NPROF = 24, FFTN = 2048;
const fftTables = (()=>{
  const n=FFTN, rev=new Uint32Array(n), cos=new Float32Array(n/2), sin=new Float32Array(n/2);
  const bits=Math.log2(n);
  for(let i=0;i<n;i++){let r=0,x=i;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}rev[i]=r;}
  for(let i=0;i<n/2;i++){cos[i]=Math.cos(2*Math.PI*i/n);sin[i]=-Math.sin(2*Math.PI*i/n);}
  const win=new Float32Array(n);for(let i=0;i<n;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1));
  return {rev,cos,sin,win};
})();
function fft(re,im){
  const n=re.length,{rev,cos,sin}=fftTables;
  for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let size=2;size<=n;size<<=1){
    const half=size>>1, step=n/size;
    for(let i=0;i<n;i+=size){
      for(let j=0,k=0;j<half;j++,k+=step){
        const a=i+j,b=a+half, wr=cos[k], wi=sin[k];
        const tr=re[b]*wr-im[b]*wi, ti=re[b]*wi+im[b]*wr;
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
      }
    }
  }
}
function pct(arr,p){const a=Float32Array.from(arr).sort();return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];}

function analyze(x, sr){
  const hop=sr/FPS_A, frames=Math.max(1,Math.ceil(x.length/hop)), N=FFTN, NB=N/2;
  const re=new Float32Array(N), im=new Float32Array(N), mag=new Float32Array(NB), prev=new Float32Array(NB);
  const bin=hz=>Math.max(1,Math.min(NB-1,Math.round(hz*N/sr)));
  const bL=[bin(30),bin(160)], bM=[bin(200),bin(2500)], bH=[bin(4000),bin(14000)];
  const edges=[];for(let i=0;i<=NPROF;i++)edges.push(bin(40*Math.pow(12000/40,i/NPROF)));
  const dL=new Float32Array(frames),dM=new Float32Array(frames),dH=new Float32Array(frames),dE=new Float32Array(frames),flux=new Float32Array(frames);
  const dP=new Float32Array(frames*NPROF);
  const db=p=>10*Math.log10(p+1e-12);
  for(let f=0;f<frames;f++){
    const s0=Math.floor(f*hop)-N/2;
    for(let i=0;i<N;i++){const k=s0+i;re[i]=(k>=0&&k<x.length?x[k]:0)*fftTables.win[i];im[i]=0;}
    fft(re,im);
    let pL=0,pM=0,pH=0,pE=0,fl=0;
    for(let k=1;k<NB;k++){
      const m=Math.hypot(re[k],im[k])/(N/4); mag[k]=m; const p=m*m; pE+=p;
      if(k>=bL[0]&&k<=bL[1])pL+=p; else if(k>=bM[0]&&k<=bM[1])pM+=p; else if(k>=bH[0]&&k<=bH[1])pH+=p;
      const d=Math.log(1+200*m)-Math.log(1+200*prev[k]); if(d>0) fl+=d*(k<bM[1]?1.6:0.25);
      prev[k]=m;
    }
    dL[f]=db(pL);dM[f]=db(pM);dH[f]=db(pH);dE[f]=db(pE);flux[f]=fl;
    for(let b=0;b<NPROF;b++){let p=0;for(let k=edges[b];k<=Math.max(edges[b],edges[b+1]-1);k++)p+=mag[k]*mag[k];dP[f*NPROF+b]=db(p);}
  }
  // normalisation: relative to the track, with absolute gates so quiet audio stays quiet
  const eRef=pct(dE,0.97), trackGain=Math.min(1,Math.max(0,(eRef+56)/30));
  const norm=(arr,range,gateRef)=>{
    const ref=pct(arr,0.97), floor=ref-range, gate=Math.min(1,Math.max(0,(ref-gateRef+52)/26))*trackGain;
    const out=new Float32Array(arr.length);
    for(let i=0;i<arr.length;i++){const v=Math.min(1,Math.max(0,(arr[i]-floor)/range));out[i]=Math.pow(v,1.35)*gate;}
    return out;
  };
  const low=norm(dL,36,eRef), mid=norm(dM,36,eRef), high=norm(dH,36,eRef), energy=norm(dE,40,eRef);
  let pRef=-200;for(let b=0;b<NPROF;b++){const col=new Float32Array(frames);for(let f=0;f<frames;f++)col[f]=dP[f*NPROF+b];pRef=Math.max(pRef,pct(col,0.97));}
  const prof=new Float32Array(frames*NPROF);
  for(let i=0;i<prof.length;i++){const v=Math.min(1,Math.max(0,(dP[i]-(pRef-46))/46));prof[i]=Math.pow(v,1.6)*trackGain;}
  // onsets: adaptive threshold peak picking on spectral flux
  const fRef=Math.max(1e-6,pct(flux,0.98)); const fn=new Float32Array(frames);for(let i=0;i<frames;i++)fn[i]=Math.min(1.5,flux[i]/fRef);
  const onset=new Float32Array(frames); let last=-99;
  for(let f=0;f<frames;f++){
    let m=0,c=0;for(let k=Math.max(0,f-15);k<=Math.min(frames-1,f+6);k++){m+=fn[k];c++;} m/=c;
    const thr=m*1.35+0.12;
    let isPeak=fn[f]>thr; for(let k=Math.max(0,f-3);k<=Math.min(frames-1,f+3)&&isPeak;k++) if(fn[k]>fn[f]) isPeak=false;
    if(isPeak && f-last>=7){onset[f]=Math.min(1,(fn[f]-thr)*1.6+0.35)*trackGain*Math.min(1,0.25+0.9*Math.max(low[f],mid[f])); last=f;}
  }
  return {frames,low,mid,high,energy,prof,onset,duration:x.length/sr};
}

/* feature lookup — writes into a reused object, no allocation */
const F = {low:0,mid:0,high:0,energy:0,onset:0,prof:new Float32Array(NPROF)};
let lastFeatIdx=-1;
function sampleFeatures(A,t,active){
  if(!A||!active){ F.low=F.mid=F.high=F.energy=F.onset=0; F.prof.fill(0); lastFeatIdx=-1; return F; }
  const fi=Math.min(A.frames-1,Math.max(0,Math.floor(t*FPS_A)));
  F.low=A.low[fi];F.mid=A.mid[fi];F.high=A.high[fi];F.energy=A.energy[fi];
  for(let b=0;b<NPROF;b++)F.prof[b]=A.prof[fi*NPROF+b];
  // collect any onset between the previous sample and this one (frame rate independent)
  let o=0; const from=(lastFeatIdx<0||lastFeatIdx>fi)?fi:lastFeatIdx+1;
  if(fi-from<30) for(let k=from;k<=fi;k++) o=Math.max(o,A.onset[k]);
  F.onset=o; lastFeatIdx=fi; return F;
}

/* ======================= SIMULATION STATE ======================= */
const S = {
  t:0, rot:0, wave:0, drift:0, cam:0, low:0, mid:0, high:0, energy:0, hit:0,
  hitS:0,     // hit, smoothed: drives tension / speed of the existing motion (never a new shape)
  swell:0,    // bass, slow: depth swell of the cloth
  light:0,    // energy, slow: the only thing the light layers follow
  prof:new Float32Array(NPROF)
};
const envf=(cur,tgt,dt,att,rel)=>cur+(tgt-cur)*(1-Math.exp(-dt/(tgt>cur?att:rel)));
function stepSim(dt,f){
  const r=P.influence;
  S.t+=dt;
  S.low   =envf(S.low,   Math.min(1.4,f.low*r),   dt,0.025,0.30);
  S.mid   =envf(S.mid,   Math.min(1.4,f.mid*r),   dt,0.08, 0.50);
  S.high  =envf(S.high,  Math.min(1.4,f.high*r),  dt,0.012,0.14);
  S.energy=envf(S.energy,Math.min(1.4,f.energy*r),dt,0.05, 0.45);
  for(let b=0;b<NPROF;b++) S.prof[b]=envf(S.prof[b],f.prof[b],dt,0.06,0.38);
  S.hit*=Math.exp(-dt*5.5);
  if(f.onset>0) S.hit=Math.max(S.hit,f.onset*Math.min(1.5,r));
  // hits act on the EXISTING motion: a short surge in the speed of the torsion / billow
  // and a little extra tension in the folds. Smoothed (15 ms in), so nothing snaps.
  S.hitS =envf(S.hitS, S.hit,      dt,0.015,0.22);
  S.swell=envf(S.swell,S.low,      dt,0.07, 0.45);
  S.light=envf(S.light,S.energy,   dt,0.35, 1.10);
  const fl=P.flow;
  S.rot  +=dt*fl*(0.22+0.75*S.mid+0.20*S.energy+0.45*S.hitS);
  S.wave +=dt*fl*(0.70+1.40*S.mid+0.60*S.high+1.10*S.hitS);
  S.drift+=dt*fl*0.09;
  S.cam+=dt*(0.10+0.08*fl)*(1+0.8*S.mid);
}

/* ======================= BRAID GEOMETRY ======================= */
// Source geometry: one wide ribbon ("cloth") made of parallel threads.
// u runs along the ribbon, v across it. The ribbon twists (half-turns), folds and billows.
const NS=56, NPTS=300;
const strand=(()=>{ let s=987654; const r=()=>{s=(s*16807)%2147483647;return s/2147483647;};
  const a=[]; for(let j=0;j<NS;j++){ const v=-1+2*j/(NS-1);
    a.push({v:v+(r()-0.5)*0.035, ph:r()*6.283, br:0.55+0.45*r(), lag:(r()-0.5)*0.02, edge:Math.abs(v)}); } return a; })();
const VSTRIDE=4, verts=new Float32Array(NS*NPTS*2*VSTRIDE);
const px=new Float32Array(NPTS), py=new Float32Array(NPTS), pw=new Float32Array(NPTS), pf=new Float32Array(NPTS);
function profAt(s){ const x=s*(NPROF-1), i=Math.floor(x), fr=x-i; const a=S.prof[Math.max(0,i-1)]*0.25+S.prof[i]*0.5+S.prof[Math.min(NPROF-1,i+1)]*0.25;
  const j=Math.min(NPROF-1,i+1); const b=S.prof[i]*0.25+S.prof[j]*0.5+S.prof[Math.min(NPROF-1,j+1)]*0.25; return a+(b-a)*fr; }
function buildBraid(W,H,decayNorm){
  const land=W>H, Tb=land?H:W, Lb=land?0.86*W:W;   // Tb: thickness / vertical basis (short side) · Lb: length basis
  const TAU=6.283185307, sc=Tb/720, cx=0.50*W, cy=0.545*H, len=0.37*Lb, Wd=0.14*Tb*P.body, tilt=0.16, ct=Math.cos(tilt), st=Math.sin(tilt);
  const HALF=Math.PI*P.twist, hw=1.0*sc, r=P.influence;
  const baseI=(0.25+0.10*S.energy)*decayNorm;
  const tor=(0.45+0.70*S.mid+0.25*S.hitS)*Math.min(1,0.35+P.flow*0.65);
  const fold=(0.30+0.35*S.mid+0.25*S.low+0.12*S.hitS);
  const DP=P.depth, yaw=DP*0.26*Math.sin(S.cam*0.8)+DP*0.08*Math.sin(S.cam*2.3), cyw=Math.cos(yaw), syw=Math.sin(yaw);
  let v=0;
  for(let n=0;n<NS;n++){
    const q=strand[n];
    for(let i=0;i<NPTS;i++){
      const u=i/(NPTS-1), uu=u*2-1;
      // width envelope: soft rounded ends, fuller head on the left, spectrum bulges left(low)→right(high)
      const env=Math.pow(Math.sin(Math.PI*u),0.55)*(1+0.22*(1-u));
      const A=1+0.35*r*profAt(u)+0.18*S.low+0.05*Math.sin(S.drift*TAU*0.7+u*4.0);
      const half=Wd*env*A;
      // centreline: a slow S-sweep that drifts
      const cyl=0.055*Tb*Math.sin(TAU*(0.75*u)+S.drift*2.1+0.6)+0.03*Tb*Math.sin(TAU*1.6*u-S.wave*0.35);
      // twist: ribbon turns about its own length; travelling torsion wave makes the folds crawl
      const psi=HALF*(u+q.lag)+S.rot+tor*env*Math.sin(TAU*1.1*u-S.wave);
      const cp=Math.cos(psi), sp=Math.sin(psi);
      // cloth billow: out-of-plane waves across and along the ribbon
      const bil=Wd*fold*env*(0.55*Math.sin(TAU*(1.3*u+0.35*q.v)-S.wave*1.3)+0.35*Math.sin(TAU*(0.6*q.v*q.v-0.8*u)+S.rot*1.7));
      const vv=q.v*half;
      let y3=vv*cp-bil*sp, z3=vv*sp+bil*cp;
      y3+=Wd*0.035*S.high*env*Math.sin(47*u+q.ph+S.t*9.0);
      // dynamic displacement in depth: slow standing waves across the cloth, bass pushes it toward camera
      const zD=0.7*DP*Wd*env*(0.60*Math.sin(TAU*(0.9*u+0.3*q.v)+S.cam*1.9)+0.40*Math.sin(TAU*(1.7*u-0.5*q.v)-S.wave*0.5)-1.1*S.swell*Math.sin(Math.PI*u));
      const zt=z3+zD, sx0=uu*len;
      // camera yaw, then perspective
      const X3=sx0*cyw+zt*syw, Z3=-sx0*syw+zt*cyw;
      const f=Math.min(1.22,Math.max(0.6,1/(1+DP*Z3/(2.6*Lb))));
      const sx=X3*f, sy=(cyl+y3+zt*0.32)*f;
      px[i]=cx+sx*ct-sy*st; py[i]=cy+sx*st+sy*ct; pf[i]=f;
      const near=0.5-0.5*Math.tanh(zt/(Wd*0.6));
      const edgeOn=1+0.8*Math.pow(Math.abs(sp),6);          // threads pile up where the cloth turns edge-on
      pw[i]=baseI*q.br*(0.45+0.55*near)*edgeOn*(0.8+0.2*(1-q.edge))*Math.min(1.5,Math.pow(f,1.8*DP+0.001));
    }
    for(let i=0;i<NPTS;i++){
      const ia=Math.max(0,i-1), ib=Math.min(NPTS-1,i+1);
      let tx=px[ib]-px[ia], ty=py[ib]-py[ia]; const l=Math.hypot(tx,ty)||1; tx/=l; ty/=l;
      const hf=hw*Math.min(1.5,Math.pow(pf[i],1.5)), nx=-ty*hf, ny=tx*hf;
      for(let sd=-1;sd<=1;sd+=2){
        verts[v++]=(px[i]+nx*sd)/W*2-1; verts[v++]=1-(py[i]+ny*sd)/H*2; verts[v++]=sd; verts[v++]=pw[i];
      }
    }
  }
}

/* ======================= RENDERER (WebGL2) ======================= */
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
if(!gl) throw new Error('WebGL2 is required');
const floatOK=!!gl.getExtension('EXT_color_buffer_float');
const VS_Q=`#version 300 es
in vec2 p; out vec2 uv; void main(){ uv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;
const FS_FADE=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform float k; out vec4 o;
void main(){ o=vec4(texture(t,uv).rgb*k,1.); }`;
const VS_LINE=`#version 300 es
in vec4 a; out float sd; out float w; void main(){ sd=a.z; w=a.w; gl_Position=vec4(a.xy,0.,1.); }`;
const FS_LINE=`#version 300 es
precision highp float; in float sd; in float w; out vec4 o;
void main(){ float f=1.-abs(sd); f=f*f*(3.-2.*f); o=vec4(vec3(w*f),1.); }`;
const FS_DOWN=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 px; out vec4 o;
void main(){ vec3 s=texture(t,uv+px*vec2(-.5,-.5)).rgb+texture(t,uv+px*vec2(.5,-.5)).rgb+texture(t,uv+px*vec2(-.5,.5)).rgb+texture(t,uv+px*vec2(.5,.5)).rgb; o=vec4(s*.25,1.); }`;
const FS_BLUR=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 d; out vec4 o;
void main(){ const float w0=.2270270270,w1=.3162162162,w2=.0702702703; vec3 s=texture(t,uv).rgb*w0;
 s+=(texture(t,uv+d*1.3846153846).rgb+texture(t,uv-d*1.3846153846).rgb)*w1;
 s+=(texture(t,uv+d*3.2307692308).rgb+texture(t,uv-d*3.2307692308).rgb)*w2; o=vec4(s,1.); }`;
const FS_RAYS=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 c; uniform float len,tm,shim,asp; out vec4 o;
float h(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h(vec2(i,1.7)),h(vec2(i+1.,1.7)),f); }
void main(){
  vec2 d=uv-c; const int N=36; vec2 st=d*len/float(N);
  float ang=atan(d.y*asp,d.x);
  float beams=.35+.65*n1(ang*9.+tm*.35)*(.6+.4*n1(ang*23.-tm*shim));
  vec2 p=uv-st*h(uv*917.+tm); float a=0., w=1., tot=0.;
  for(int i=0;i<N;i++){ float m=max(texture(t,p).r-.035,0.); a+=m*w; tot+=w; w*=.955; p-=st; }
  o=vec4(vec3(a/tot*beams),1.);
}`;
const FS_COMP=`#version 300 es
precision highp float;
uniform sampler2D uAcc,uFine,uHalo; uniform vec2 uRes; uniform float uScale,uFrame,uTime;
uniform vec3 uBg,uCore,uContour,uHi,uShadow,uRidge;
uniform float uCoreAmt,uPoster,uContourAmt,uFineAmt,uRelief,uReliefHard,uReliefHalo,uHiAmt,uShadowAmt,uRidgeAmt,uRidgeTh,uGrain;
uniform sampler2D uGlow,uRays; uniform vec3 uLight; uniform float uGlowAmt,uRaysAmt,uLightAmt,uWarp;
uniform float uDetail,uHaloGain,uCellC,uCellF,uJit;
out vec4 o;
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float haloV(vec2 cell){ vec2 uv=(cell+.5)*uCellC/uRes; float h=texture(uHalo,uv).r*uHaloGain;
  float n=hash(cell+vec2(floor(uTime*12.)*37.1,11.)); return h+(n-.5)*uJit*clamp(h*6.+.08,0.,1.); }
float lvlH(float h){ return min(floor(log2(1.+max(h,0.)*40.)*0.95),4.); }
float fineV(vec2 cell){ vec2 uv=(cell+.5)*uCellF/uRes; float f=texture(uFine,uv).r; float n=hash(cell*1.7+vec2(floor(uTime*12.)*13.7,5.));
  return 1.-exp(-(f*2.2))+(n-.5)*uJit*.4; }
float lvlF(float v){ return floor(v*5.); }
float edgeH(vec2 p){ vec2 c=floor(p/uCellC); vec2 f=p-c*uCellC; float lw=max(1.,1.15*uScale); float L0=lvlH(haloV(c)); float e=0.;
  if(f.x>=uCellC-lw && lvlH(haloV(c+vec2(1,0)))!=L0) e=1.;
  if(f.y>=uCellC-lw && lvlH(haloV(c+vec2(0,1)))!=L0) e=1.; return e; }
float edgeF(vec2 p){ vec2 c=floor(p/uCellF); vec2 f=p-c*uCellF; float lw=max(1.,.9*uScale); float L0=lvlF(fineV(c)); float e=0.;
  if(f.x>=uCellF-lw && lvlF(fineV(c+vec2(1,0)))!=L0) e=1.;
  if(f.y>=uCellF-lw && lvlF(fineV(c+vec2(0,1)))!=L0) e=1.; return e; }
float height(vec2 uv){ float a=texture(uAcc,uv).r,f=texture(uFine,uv).r,h=texture(uHalo,uv).r;
  return (1.-exp(-(f*2.4+a*uDetail))) + uReliefHalo*(1.-exp(-h*uHaloGain*2.5)); }
float vn(vec2 x){ vec2 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
void main(){
  vec2 p0=gl_FragCoord.xy;
  // dynamic screen-space displacement: flowing space + lensing around the form
  float Lr=max(uRes.x,uRes.y); vec2 q=p0/Lr, uv0=p0/uRes;
  vec2 fl=vec2(vn(q*2.6+vec2(0.,uTime*.11)),vn(q*2.6+vec2(7.3,-uTime*.09)))-.5;
  vec2 e=vec2(3./uRes.x,0.), e2=vec2(0.,3./uRes.y);
  vec2 gr=vec2(texture(uGlow,uv0+e).r-texture(uGlow,uv0-e).r, texture(uGlow,uv0+e2).r-texture(uGlow,uv0-e2).r);
  vec2 off=uWarp*(fl*.008 - gr*.06); float ol=length(off); if(ol>.028) off*=.028/ol; off*=Lr;
  vec2 p=p0+off, uv=p/uRes;
  float acc=texture(uAcc,uv).r, fine=texture(uFine,uv).r, halo=texture(uHalo,uv).r*uHaloGain;
  float body=1.-exp(-(fine*2.4+acc*.6));
  float strand=1.-exp(-acc*1.1);
  float bq=floor(body*uPoster+.3)/uPoster;
  float core=clamp(max(mix(body,bq,.85)*.72,pow(strand,.8)),0.,1.); core=smoothstep(.03,.8,core);
  vec3 col=uBg;
  // stepped topographic rings from the coarse glow field
  if(uContourAmt>0.){ float e=edgeH(p); col=mix(col,uContour,e*uContourAmt*(.72+.28*clamp(halo*5.,0.,1.))); }
  // posterised luminous core
  col=mix(col,uCore,core*uCoreAmt);
  // fine iso-lines that chop the core into flat blocks
  if(uFineAmt>0.){ float e=edgeF(p); float inside=smoothstep(.04,.2,body)*(1.-smoothstep(.6,.85,body)); col=mix(col, mix(uContour,uCore,.55), e*uFineAmt*inside); col=mix(col,uBg,e*uFineAmt*.35*smoothstep(.55,.9,body)); }
  // relief (emboss) lighting of the same height field, light from top-left
  if(uRelief>0.){ vec2 L=normalize(vec2(-1.,1.))*1.6*uScale/uRes;
    float sh=(height(uv-L)-height(uv+L))*uRelief;
    float s=clamp(-sh,0.,1.); s=mix(s,smoothstep(.10,.22,s),uReliefHard);
    col=mix(col,uShadow,s*uShadowAmt); col=mix(col,uHi,clamp(sh,0.,1.)*uHiAmt); }
  // ridge crests (horizontal smear of the densest strands)
  if(uRidgeAmt>0.){ vec2 dx=vec2(2.*uScale/uRes.x,0.);
    float r=max(acc,max(max(texture(uAcc,uv+dx).r,texture(uAcc,uv-dx).r)*.85,max(texture(uAcc,uv+dx*2.5).r,texture(uAcc,uv-dx*2.5).r)*.6));
    r=smoothstep(uRidgeTh,uRidgeTh+.45,1.-exp(-r*1.3)); col=mix(col,uRidge,r*uRidgeAmt); }
  // light: glow + rays
  float lg=texture(uGlow,uv).r, ry=texture(uRays,uv).r;
  float L=(1.-exp(-(max(lg-.004,0.)*uGlowAmt*2.6+max(ry-.002,0.)*uRaysAmt*5.0)))*.8;
  col=mix(col,uLight,clamp(L,0.,1.)*uLightAmt);
  p=p0;
  float g=hash(p+vec2(fract(uFrame*.6180339)*1731.,fract(uFrame*.3819)*977.))-.5;
  col+=g*uGrain*2.;
  o=vec4(clamp(col,0.,1.),1.);
}`;
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)+'\n'+src);return s;}
function prog(vs,fs,attr){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.bindAttribLocation(p,0,attr);gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  const u={};const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i);u[a.name]=gl.getUniformLocation(p,a.name);}return {p,u};}
const pFade=prog(VS_Q,FS_FADE,'p'), pLine=prog(VS_LINE,FS_LINE,'a'), pDown=prog(VS_Q,FS_DOWN,'p'), pBlur=prog(VS_Q,FS_BLUR,'p'), pComp=prog(VS_Q,FS_COMP,'p'), pRays=prog(VS_Q,FS_RAYS,'p');
const quadVAO=gl.createVertexArray(); gl.bindVertexArray(quadVAO);
const qb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,qb); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
const lineVAO=gl.createVertexArray(); gl.bindVertexArray(lineVAO);
const lb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,lb); gl.bufferData(gl.ARRAY_BUFFER,verts.byteLength,gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);
gl.bindVertexArray(null);

function target(w,h){ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,floatOK?gl.RGBA16F:gl.RGBA8,w,h,0,gl.RGBA,floatOK?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fb=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fb); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); return {t,fb,w,h}; }
let RT=null, W=720, H=1280;
function setup(w,h){
  if(RT) for(const k in RT){gl.deleteTexture(RT[k].t);gl.deleteFramebuffer(RT[k].fb);}
  W=w;H=h;canvas.width=w;canvas.height=h;
  RT={accA:target(w,h),accB:target(w,h),fA:target(w>>1,h>>1),fB:target(w>>1,h>>1),hA:target(w>>3,h>>3),hB:target(w>>3,h>>3),gA:target(w>>2,h>>2),gB:target(w>>2,h>>2),rA:target(w>>2,h>>2)};
}
setup(720,1280);
function pass(rt,pr){ gl.bindFramebuffer(gl.FRAMEBUFFER,rt?rt.fb:null); gl.viewport(0,0,rt?rt.w:W,rt?rt.h:H); gl.useProgram(pr.p); }
function tex(unit,t){ gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); }
function blur(src,tmp,dx,dy){ pass(tmp,pBlur); tex(0,src.t); gl.uniform1i(pBlur.u.t,0); gl.uniform2f(pBlur.u.d,dx/src.w,0); gl.drawArrays(gl.TRIANGLES,0,3);
  pass(src,pBlur); tex(0,tmp.t); gl.uniform2f(pBlur.u.d,0,dy/src.h); gl.drawArrays(gl.TRIANGLES,0,3); }
let frameNo=0;
function render(dt){
  const decay=0.50+0.44*P.trails, k=Math.pow(decay,Math.max(0,dt)*60), norm=(1-decay)/0.25;
  gl.bindVertexArray(quadVAO);
  // 1. persistence: fade previous density into the other buffer
  pass(RT.accB,pFade); tex(0,RT.accA.t); gl.uniform1i(pFade.u.t,0); gl.uniform1f(pFade.u.k,dt>0?k:decay); gl.drawArrays(gl.TRIANGLES,0,3);
  // 2. strands, additive
  buildBraid(W,H,norm);
  gl.bindVertexArray(lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER,lb); gl.bufferSubData(gl.ARRAY_BUFFER,0,verts);
  gl.useProgram(pLine.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
  for(let n=0;n<NS;n++) gl.drawArrays(gl.TRIANGLE_STRIP,n*NPTS*2,NPTS*2);
  gl.disable(gl.BLEND);
  const t=RT.accA; RT.accA=RT.accB; RT.accB=t;
  gl.bindVertexArray(quadVAO);
  // 3. fine field (1/2 res) and coarse glow field (1/8 res)
  pass(RT.fA,pDown); tex(0,RT.accA.t); gl.uniform1i(pDown.u.t,0); gl.uniform2f(pDown.u.px,1/W,1/H); gl.drawArrays(gl.TRIANGLES,0,3);
  blur(RT.fA,RT.fB,1.3,1.3);
  pass(RT.hA,pDown); tex(0,RT.fA.t); gl.uniform2f(pDown.u.px,2/RT.fA.w,2/RT.fA.h); gl.drawArrays(gl.TRIANGLES,0,3);
  const hr=0.45+0.45*P.halo; blur(RT.hA,RT.hB,hr*1.7,hr*0.75); blur(RT.hA,RT.hB,hr*2.2,hr*0.8);
  // 4. light: wide glow field (1/4 res) and radial light shafts from it
  pass(RT.gA,pDown); tex(0,RT.fA.t); gl.uniform1i(pDown.u.t,0); gl.uniform2f(pDown.u.px,1/RT.fA.w,1/RT.fA.h); gl.drawArrays(gl.TRIANGLES,0,3);
  blur(RT.gA,RT.gB,1.6,1.6); blur(RT.gA,RT.gB,2.8,2.8);
  const cxu=0.5, cyu=1-0.545;
  pass(RT.rA,pRays); tex(0,RT.gA.t); gl.uniform1i(pRays.u.t,0); gl.uniform2f(pRays.u.c,cxu,cyu);
  gl.uniform1f(pRays.u.len,(0.20+0.22*P.rays)*(1+0.25*S.light)); gl.uniform1f(pRays.u.tm,S.t); gl.uniform1f(pRays.u.shim,0.6+4.0*S.high); gl.uniform1f(pRays.u.asp,W>H?H/W:1.7778);
  gl.drawArrays(gl.TRIANGLES,0,3);
  // 5. material + colour preset
  const cp=COLOR_PRESETS[presetKey], u=pComp.u, sc=W>H?H/720:H/1280;   // cell / relief scale: by the short side
  pass(null,pComp); tex(0,RT.accA.t); tex(1,RT.fA.t); tex(2,RT.hA.t); tex(3,RT.gA.t); tex(4,RT.rA.t);
  gl.uniform1i(u.uAcc,0); gl.uniform1i(u.uFine,1); gl.uniform1i(u.uHalo,2); gl.uniform1i(u.uGlow,3); gl.uniform1i(u.uRays,4);
  gl.uniform3fv(u.uLight,cp.light); gl.uniform1f(u.uLightAmt,cp.lightAmt);
  gl.uniform1f(u.uGlowAmt,Math.pow(P.glow,1.3)*(0.62+0.35*S.light));
  gl.uniform1f(u.uRaysAmt,Math.pow(P.rays,1.3)*(0.52+0.35*S.light));
  gl.uniform1f(u.uWarp,P.warp*(1+0.25*S.light));
  gl.uniform2f(u.uRes,W,H); gl.uniform1f(u.uScale,sc); gl.uniform1f(u.uFrame,frameNo++); gl.uniform1f(u.uTime,S.t);
  for(const [n,key] of [['uBg','bg'],['uCore','core'],['uContour','contour'],['uHi','hi'],['uShadow','shadow'],['uRidge','ridge']]) gl.uniform3fv(u[n],cp[key]);
  for(const [n,key] of [['uCoreAmt','coreAmt'],['uPoster','poster'],['uContourAmt','contourAmt'],['uFineAmt','fineAmt'],['uRelief','relief'],['uReliefHard','reliefHard'],['uReliefHalo','reliefHalo'],['uHiAmt','hiAmt'],['uShadowAmt','shadowAmt'],['uRidgeAmt','ridgeAmt'],['uRidgeTh','ridgeTh'],['uDetail','detail']]) gl.uniform1f(u[n],cp[key]);
  gl.uniform1f(u.uGrain,cp.grain*(0.4+0.6*P.grit));
  gl.uniform1f(u.uHaloGain,P.halo*(0.80+0.60*S.light+0.07*Math.sin(S.drift*9.0)));
  gl.uniform1f(u.uCellC,Math.max(2,Math.round((3.4+1.5*P.grit)*sc)));
  gl.uniform1f(u.uCellF,Math.max(1,Math.round((1.6+0.9*P.grit)*sc)));
  gl.uniform1f(u.uJit,(0.004+0.012*P.grit)*(1+2.0*S.high));
  gl.drawArrays(gl.TRIANGLES,0,3);
}


return { canvas, P, CONTROLS, COLOR_PRESETS, setup, analyze, A:null,
  setPreset(k){ presetKey=k; },
  frame(t,dt,playing){ const f=sampleFeatures(this.A,t,playing); stepSim(playing?dt:0,f); render(playing?dt:1/60); } };
}

const DUST_DATA=(function(){
const C=(r,g,b)=>[r/255,g/255,b/255];
const LOOKS={
  black:{ name:'Black', bg:C(13,13,13), ink:C(236,236,234), haze:C(150,150,148), grain:0.018, gamma:1.0, contrast:1.0, sw:{b:'#0d0d0d',f:'#ecece9'} },
  white:{ name:'White', bg:C(238,235,228), ink:C(28,27,26),  haze:C(120,118,114), grain:0.022, gamma:0.9, contrast:1.1, sw:{b:'#eeebe4',f:'#1c1b1a'} },
};
let lookKey='black';

/* ---------------- controls ---------------- */
const CONTROLS=[
  {k:'scale',      label:'Scale',       min:0.5, max:1.6, v:1.22,  g:'gForm',   hint:'size of the swell'},
  {k:'complexity', label:'Complexity',  min:0,   max:1,   v:0.76,  g:'gForm',   hint:'how many folds the membrane makes'},
  {k:'drift',      label:'Drift',       min:0,   max:2,   v:1.19,  g:'gMotion', hint:'speed of the field flow'},
  {k:'detail',     label:'Detail',      min:0,   max:2,   v:1.38,  g:'gMotion', hint:'fine shimmer and loose dust at the edges'},
  {k:'glow',       label:'Glow',        min:0,   max:2,   v:0.38,  g:'gLight',  hint:'near glow and the haze that lifts the black'},
  {k:'lines',      label:'Lines',       min:0,   max:3,   v:2.03,  g:'gLight',  hint:'brightness of the threads that flash out of the centre on a cut'},
  {k:'brightness', label:'Brightness',  min:0.2, max:2,   v:0.76,  g:'gLight',  hint:'material intensity'},
  {k:'persistence',label:'Persistence', min:0,   max:1,   v:0.1,  g:'gMem',    hint:'how long the dust lingers'},
  {k:'response',   label:'Response',    min:0,   max:2,   v:1,  g:'gMem',    hint:'how strongly the music drives the form'},
  {k:'lowResp',    label:'Bass · kick', min:0,   max:2,   v:1,  g:'gMem',    hint:'mass from bass, collapse and knot on a kick'},
  {k:'midResp',    label:'Mid · snare', min:0,   max:2,   v:1,  g:'gMem',    hint:'flow from mids, disturbance and cuts on a snare'},
  {k:'highResp',   label:'High · hats', min:0,   max:2,   v:0,  g:'gMem',    hint:'shimmer from highs; hats only nudge the field, never cut'},
];

return {LOOKS,CONTROLS};
})();

/* DUST renderer, verbatim, wrapped as a factory: one instance per canvas */
function makeDust(canvas){
'use strict';
/* ===========================================================================
   DUST — native rebuild of the "23 09" reference.
   Primitive: a thin SHEET of ~300k seeded points, displaced by a smooth 3D
   turbulence field under a bell envelope centred in frame. Where the sheet folds
   edge-on the points pile up → bright torn contours; where it faces the camera
   → faint haze; at its edges → loose dust. Rendered additively (GPU), then a
   near glow + a wide haze that lifts the black, and slow mottled grain that
   lives inside the haze. A camera cuts between four fixed views on hits.
   Audio: level+bass swell the sheet (mass); a kick COLLAPSES it to the line
   (as in the reference), snare/mid transients disturb the structure, mids set
   the flow of the field, highs keep a continuous shimmer.
   =========================================================================== */

/* ---------------- LOOKS (appearance only) ---------------- */
const C=(r,g,b)=>[r/255,g/255,b/255];
const LOOKS={
  black:{ name:'Black', bg:C(13,13,13), ink:C(236,236,234), haze:C(150,150,148), grain:0.018, gamma:1.0, contrast:1.0, sw:{b:'#0d0d0d',f:'#ecece9'} },
  white:{ name:'White', bg:C(238,235,228), ink:C(28,27,26),  haze:C(120,118,114), grain:0.022, gamma:0.9, contrast:1.1, sw:{b:'#eeebe4',f:'#1c1b1a'} },
};
let lookKey='black';

/* ---------------- controls ---------------- */
const CONTROLS=[
  {k:'scale',      label:'Scale',       min:0.5, max:1.6, v:1.22,  g:'gForm',   hint:'size of the swell'},
  {k:'complexity', label:'Complexity',  min:0,   max:1,   v:0.76,  g:'gForm',   hint:'how many folds the membrane makes'},
  {k:'drift',      label:'Drift',       min:0,   max:2,   v:1.19,  g:'gMotion', hint:'speed of the field flow'},
  {k:'detail',     label:'Detail',      min:0,   max:2,   v:1.38,  g:'gMotion', hint:'fine shimmer and loose dust at the edges'},
  {k:'glow',       label:'Glow',        min:0,   max:2,   v:0.38,  g:'gLight',  hint:'near glow and the haze that lifts the black'},
  {k:'lines',      label:'Lines',       min:0,   max:3,   v:2.03,  g:'gLight',  hint:'brightness of the threads that flash out of the centre on a cut'},
  {k:'brightness', label:'Brightness',  min:0.2, max:2,   v:0.76,  g:'gLight',  hint:'material intensity'},
  {k:'persistence',label:'Persistence', min:0,   max:1,   v:0.1,  g:'gMem',    hint:'how long the dust lingers'},
  {k:'response',   label:'Response',    min:0,   max:2,   v:1,  g:'gMem',    hint:'how strongly the music drives the form'},
  {k:'lowResp',    label:'Bass · kick', min:0,   max:2,   v:1,  g:'gMem',    hint:'mass from bass, collapse and knot on a kick'},
  {k:'midResp',    label:'Mid · snare', min:0,   max:2,   v:1,  g:'gMem',    hint:'flow from mids, disturbance and cuts on a snare'},
  {k:'highResp',   label:'High · hats', min:0,   max:2,   v:0,  g:'gMem',    hint:'shimmer from highs; hats only nudge the field, never cut'},
];
const P={shape:'auto'}; CONTROLS.forEach(c=>P[c.k]=c.v);
const SHAPES=['auto','side','oblique','vertical','axis'];

/* ======================= AUDIO ANALYSIS (offline, deterministic) ======================= */
const FPS_A=60, FFTN=2048;
const FT=(()=>{ const n=FFTN, rev=new Uint32Array(n), cos=new Float32Array(n/2), sin=new Float32Array(n/2), win=new Float32Array(n), bits=Math.log2(n);
  for(let i=0;i<n;i++){let r=0,x=i;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}rev[i]=r;}
  for(let i=0;i<n/2;i++){cos[i]=Math.cos(2*Math.PI*i/n);sin[i]=-Math.sin(2*Math.PI*i/n);}
  for(let i=0;i<n;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1)); return {rev,cos,sin,win}; })();
function fft(re,im){ const n=re.length,{rev,cos,sin}=FT;
  for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
    for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const a=i+j,b=a+half,wr=cos[k],wi=sin[k],tr=re[b]*wr-im[b]*wi,ti=re[b]*wi+im[b]*wr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}}}
function pct(arr,p){const a=Float32Array.from(arr).sort();return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];}
function peaks(flux,frames,gate,refr){ // adaptive-threshold peak picking → strengths 0..1
  const ref=Math.max(1e-6,pct(flux,0.98)), fn=new Float32Array(frames), out=new Float32Array(frames); let last=-99;
  for(let i=0;i<frames;i++) fn[i]=Math.min(1.5,flux[i]/ref);
  for(let f=0;f<frames;f++){ let m=0,c=0; for(let k=Math.max(0,f-15);k<=Math.min(frames-1,f+6);k++){m+=fn[k];c++;} m/=c;
    const thr=m*1.4+0.14; let pk=fn[f]>thr; for(let k=Math.max(0,f-3);k<=Math.min(frames-1,f+3)&&pk;k++) if(fn[k]>fn[f]) pk=false;
    if(pk&&f-last>=refr){ out[f]=Math.min(1,(fn[f]-thr)*1.5+0.35)*gate[f]; last=f; } }
  return out; }
// transient = a fast rise in a band's energy (dB over the last ~65 ms), not just spectral change,
// so steady pads and beating chords never read as hits
function rises(e,frames,eRef,g,gap=28){ const out=new Float32Array(frames), r=new Float32Array(frames), ref=pct(e,0.97); let last=-99;
  for(let f=0;f<frames;f++){ let m=1e9; for(let k=Math.max(0,f-4);k<f;k++) m=Math.min(m,e[k]); r[f]=f>0?e[f]-m:0; }
  for(let f=0;f<frames;f++){ if(r[f]<7||e[f]<Math.max(ref-24,eRef-gap)) continue; let pk=true; for(let k=Math.max(0,f-3);k<=Math.min(frames-1,f+3);k++) if(r[k]>r[f]) pk=false;
    if(pk&&f-last>=8){ out[f]=Math.min(1,0.35+(r[f]-7)/14)*g; last=f; } }
  return out; }
function analyze(x,sr){
  const hop=sr/FPS_A, frames=Math.max(1,Math.ceil(x.length/hop)), N=FFTN, NB=N/2;
  const re=new Float32Array(N), im=new Float32Array(N), prev=new Float32Array(NB);
  const bin=hz=>Math.max(1,Math.min(NB-1,Math.round(hz*N/sr)));
  const bL=[bin(30),bin(150)], bM=[bin(200),bin(2500)], bH=[bin(4000),bin(14000)], kLo=bin(35), kHi=bin(140), sLo=bin(1000), sHi=bin(8000), bLo=bin(150), bHi=bin(500);
  const dL=new Float32Array(frames),dM=new Float32Array(frames),dH=new Float32Array(frames),dE=new Float32Array(frames),fK=new Float32Array(frames),fS=new Float32Array(frames),fB=new Float32Array(frames);
  const db=p=>10*Math.log10(p+1e-12);
  for(let f=0;f<frames;f++){ const s0=Math.floor(f*hop)-N/2;
    for(let i=0;i<N;i++){const k=s0+i;re[i]=(k>=0&&k<x.length?x[k]:0)*FT.win[i];im[i]=0;}
    fft(re,im); let pL=0,pM=0,pH=0,pE=0,fk=0,fs=0,fb=0;
    for(let k=1;k<NB;k++){ const m=Math.hypot(re[k],im[k])/(N/4), p=m*m; pE+=p;
      if(k>=bL[0]&&k<=bL[1])pL+=p; else if(k>=bM[0]&&k<=bM[1])pM+=p; else if(k>=bH[0]&&k<=bH[1])pH+=p;
      if(k>=kLo&&k<=kHi) fk+=p; if(k>=sLo&&k<=sHi) fs+=p; if(k>=bLo&&k<=bHi) fb+=p;
      prev[k]=m; }
    dL[f]=db(pL);dM[f]=db(pM);dH[f]=db(pH);dE[f]=db(pE);fK[f]=db(fk);fS[f]=db(fs);fB[f]=db(fb); }
  const eRef=pct(dE,0.97), trackGain=Math.min(1,Math.max(0,(eRef+56)/30));
  const norm=(arr,range)=>{ const ref=pct(arr,0.97), floor=ref-range, gate=Math.min(1,Math.max(0,(ref-eRef+52)/26))*trackGain, o=new Float32Array(arr.length);
    for(let i=0;i<arr.length;i++){const v=Math.min(1,Math.max(0,(arr[i]-floor)/range));o[i]=Math.pow(v,1.35)*gate;} return o; };
  const low=norm(dL,36), mid=norm(dM,36), high=norm(dH,36), energy=norm(dE,40);
  // band-split onsets: kick = low flux weighted by bass level; snare = upper flux weighted by mid/high level
  const kick=rises(fK,frames,eRef,trackGain,22), snare=rises(fS,frames,eRef,trackGain,28);
  // a kick must be bass-dominated at that instant; a snare's crack must be a real share of the frame
  for(let f=0;f<frames;f++){ if(kick[f]>0&&fK[f]<dE[f]-9) kick[f]*=0.15; if(snare[f]>0&&fS[f]<dE[f]-22) snare[f]*=0.15; }
  // a snare needs body (150–500 Hz) rising with the crack; hats alone only give a light disturbance
  const hat=new Float32Array(frames);
  for(let f=0;f<frames;f++) if(snare[f]>0){ let m=1e9; for(let k=Math.max(0,f-4);k<f;k++) m=Math.min(m,fB[k]); if(!(fB[f]-m>6&&fB[f]>eRef-16)){ hat[f]=snare[f]; snare[f]=0; } }
  return {frames,low,mid,high,energy,kick,snare,hat,duration:x.length/sr};
}

const F={low:0,mid:0,high:0,energy:0,kick:0,snare:0,hat:0}; let lastFi=-1;
function sampleFeatures(A,t,active){
  if(!A||!active){ F.low=F.mid=F.high=F.energy=F.kick=F.snare=F.hat=0; lastFi=-1; return F; }
  const fi=Math.min(A.frames-1,Math.max(0,Math.floor(t*FPS_A)));
  F.low=A.low[fi];F.mid=A.mid[fi];F.high=A.high[fi];F.energy=A.energy[fi];
  let k=0,s=0,h=0; const from=(lastFi<0||lastFi>fi)?fi:lastFi+1; if(fi-from<30) for(let j=from;j<=fi;j++){k=Math.max(k,A.kick[j]);s=Math.max(s,A.snare[j]);h=Math.max(h,A.hat[j]||0);}
  F.kick=k;F.snare=s;F.hat=h; lastFi=fi; return F; }

/* ======================= SIMULATION ======================= */
const hash1=n=>{ const s=Math.sin(n*127.1+311.7)*43758.5453; return s-Math.floor(s); };
const S={ t:0, amp:0.3, knot:0, dist:0, flow:0, jump:0, shim:0, x0:0, low:0, mid:0, high:0, highS:0, energy:0, kick:0, snare:0, lvl:0,
  shot:'side', shotSeed:0, lastCut:-9, cutN:0, hitN:0, shotMax:99, lineA:0 };
const envf=(c,t,dt,a,r)=>c+(t-c)*(1-Math.exp(-dt/(t>c?a:r)));
function stepSim(dt,f){
  const r=P.response, rc=Math.min(1,r), RL=P.lowResp, RM=P.midResp, RH=P.highResp;
  S.t+=dt;
  S.low=envf(S.low,f.low,dt,0.03,0.30); S.mid=envf(S.mid,f.mid,dt,0.06,0.45);
  S.high=envf(S.high,f.high,dt,0.012,0.15); S.energy=envf(S.energy,f.energy,dt,0.05,0.5);
  S.highS=envf(S.highS,f.high,dt,0.08,0.40);         // the highs as a level, not as hat-by-hat pulses: this is what moves the field
  S.lvl=envf(S.lvl,f.energy,dt,0.15,1.2);
  // MASS: swell grows toward a target set by sustained bass + level (≈0.4 s rise, as measured)
  const drive=0.16+0.56*S.low*RL+0.32*S.energy;
  const target=(0.34+(drive-0.34)*rc)*(r>1?1+(r-1)*0.45:1);
  S.amp=envf(S.amp,target,dt,0.36,0.7);
  // IMPACT: a kick collapses the sheet back to the line (reference), leaving a hot knot
  if(f.kick>0){ const k=f.kick*rc*Math.min(1,RL); S.amp*=1-0.86*k; S.knot=Math.max(S.knot,k*Math.max(1,RL)); S.kick=Math.max(S.kick,f.kick*RL); maybeCut(f.kick*Math.min(1.5,RL)); }
  if(f.snare*RM>0.25) maybeCut(Math.min(1,f.snare*RM)*0.9);
  S.knot*=Math.exp(-dt/0.13); S.kick*=Math.exp(-dt/0.12);
  // DISTURBANCE: snare / mid transients reshuffle and roughen the field briefly
  if(f.snare>0){ const s=Math.min(1.2,f.snare*rc*RM); S.dist=Math.max(S.dist,s); S.jump+=0.55*s; S.snare=Math.max(S.snare,f.snare*RM); }
  // hats: a light nudge only, scaled by the high response; they never cut the camera
  if(f.hat>0){ const h=f.hat*rc*RH*0.3; S.dist=Math.max(S.dist,h); S.jump+=0.55*h; }
  S.dist*=Math.exp(-dt/0.26); S.snare*=Math.exp(-dt/0.12);
  // FLOW: the field keeps evolving; mids speed it up, highs add a little (as a smoothed level)
  S.flow+=dt*P.drift*(0.12+r*(0.34*S.mid*RM+0.14*S.highS*RH));
  // SHIMMER: highs keep a continuous fine motion (never zero while there is audio)
  S.shim+=dt*(0.6+r*5.0*S.highS*RH)*(0.3+0.7*P.detail);
  if(P.shape==='auto'&&S.t-S.lastCut>S.shotMax) maybeCut(1,true);   // leave inserts quickly
  S.lineA*=Math.exp(-dt/(S.shot==='axis'?0.2:0.05)); if(S.lineA<0.1) S.lineA=0;   // threads vanish within ~0.1 s and leave no tail
  S.x0=0.06*Math.sin(S.flow*0.9+1.3)+0.04*Math.sin(S.flow*2.3);   // slow wander of the swell centre
}
// camera editing: frequent, jerky flips between side and vertical; oblique / axis are short inserts
function maybeCut(k,force){
  if(P.shape!=='auto') return;
  const since=S.t-S.lastCut, starving=since>0.9;           // no cut for a while → take any hit
  if(!force&&(since<0.14||k<(starving?0.18:0.3))) return;
  S.hitN++; const h=hash1(S.hitN*7.31+3.1);
  if(!force&&h>(starving?0.95:0.72)) return;
  S.cutN++; const h2=hash1(S.cutN*3.77+9.2); let next;
  if(S.shot==='side') next=h2<0.72?'vertical':(h2<0.87?'oblique':'axis');
  else if(S.shot==='vertical') next=h2<0.8?'side':(h2<0.9?'oblique':'axis');
  else next=h2<0.55?'side':'vertical';
  S.shot=next; S.shotSeed=hash1(S.cutN*1.93+0.4); S.lastCut=S.t;
  S.shotMax=(next==='axis'||next==='oblique')?0.35+0.35*hash1(S.cutN*5.1):99;   // inserts never linger
  newLines();
}
// stray threads: 1–3 thin dust lines with fresh directions at every cut, fading fast
const LN=new Float32Array([1,0,0,1, 0,1,0,1, 0,0,1,1]);   // 3 × (dir.xyz, 0 off / 1 half / 2 full) — starts as the reference's three half-axes
function newLines(){
  const n=1+Math.floor(hash1(S.cutN*2.9+0.7)*3), axes=[[1,0,0],[0,1,0],[0,0,1]];
  for(let i=0;i<3;i++){ const hA=hash1(S.cutN*11.3+i*4.7), hB=hash1(S.cutN*6.1+i*9.3), hC=hash1(S.cutN*3.3+i*1.9);
    const a=axes[Math.floor(hA*3)], tilt=(hB-0.5)*1.1, tw=(hC-0.5)*1.1;
    let x=a[0]+tilt*(a[1]||a[2]?1:0)*0.6, y=a[1]+tw*(a[1]?0:1)*0.6, z=a[2]+(hB-hC)*0.5; const l=Math.hypot(x,y,z)||1;
    LN[i*4]=x/l; LN[i*4+1]=y/l; LN[i*4+2]=z/l; LN[i*4+3]=i<n?1:0; }   // 0 = off, 1 = half line from the centre (no full lines through it)
  S.lineA=1;
}

/* ======================= CAMERA ======================= */
function mat4persp(fovy,asp,n,f){ const t=1/Math.tan(fovy/2), o=new Float32Array(16); o[0]=t/asp;o[5]=t;o[10]=(f+n)/(n-f);o[11]=-1;o[14]=2*f*n/(n-f);return o; }
function mat4look(e,c,u){ let zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2]; let l=Math.hypot(zx,zy,zz); zx/=l;zy/=l;zz/=l;
  let xx=u[1]*zz-u[2]*zy, xy=u[2]*zx-u[0]*zz, xz=u[0]*zy-u[1]*zx; l=Math.hypot(xx,xy,xz); xx/=l;xy/=l;xz/=l;
  const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx, o=new Float32Array(16);
  o[0]=xx;o[4]=xy;o[8]=xz;o[1]=yx;o[5]=yy;o[9]=yz;o[2]=zx;o[6]=zy;o[10]=zz;
  o[12]=-(xx*e[0]+xy*e[1]+xz*e[2]);o[13]=-(yx*e[0]+yy*e[1]+yz*e[2]);o[14]=-(zx*e[0]+zy*e[1]+zz*e[2]);o[15]=1; return o; }
function mat4mul(a,b){ const o=new Float32Array(16); for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;} return o; }
const FOV=2*Math.atan(1.778/3);                     // side view: frame half-width = 1 world unit at the origin
const FOV_L=2*Math.atan(1.1/3);                     // landscape: frame half-height = 1.1 world units
function cameraFor(shot,seed,asp){
  const j=seed-0.5; let eye,up=[0,1,0],fov=asp>1?FOV_L:FOV,axes=0;
  if(shot==='side'){ eye=[0,0,3]; }
  else if(shot==='oblique'){ const a=0.72+0.25*j, y=0.18*j; eye=[3*Math.sin(y)*Math.cos(a),3*Math.sin(a),3*Math.cos(a)*Math.cos(y)]; }
  else if(shot==='vertical'){ eye=[0,0,3]; up=[j<0?1:-1,0,0]; }
  else { eye=[0.55+0.3*j,0.42,0.95]; fov=1.25; axes=1; }
  return {m:mat4mul(mat4persp(fov,asp,0.05,40),mat4look(eye,[0,0,0],up)),axes,amp:axes?0.22:1};
}

/* ======================= RENDERER (WebGL2) ======================= */
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
if(!gl) throw new Error('WebGL2 is required');
const floatOK=!!gl.getExtension('EXT_color_buffer_float');
// ---- the sheet: seeded points (u along the line, v across the sheet) + two faint axis strings
const NSHEET=300000, NAXIS=20000, NPTS=NSHEET+3*NAXIS;
const pts=(()=>{ const a=new Float32Array(NPTS*4); let s=0x9E3779B9>>>0; const r=()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; };
  for(let i=0;i<NSHEET;i++){ const w=r(); let u;
    if(w<0.72){ u=(r()*2-1)*0.95; } else { u=(r()*2-1)*4.0; }          // 72% inside the lit window, the rest along the long faint line
    a[i*4]=u; a[i*4+1]=r()*2-1; a[i*4+2]=r(); a[i*4+3]=0; }
  for(let i=0;i<3*NAXIS;i++){ const o=(NSHEET+i)*4; a[o]=(r()*2-1)*4.0; a[o+1]=r()*2-1; a[o+2]=r(); a[o+3]=1+Math.floor(i/NAXIS); }
  return a; })();
const VS_PTS=`#version 300 es
precision highp float;
layout(location=0) in vec4 a;       // u, v, seed, kind (0 sheet, 1 Y string, 2 Z string)
uniform mat4 uM; uniform vec4 uLn[3]; uniform float uLineA;
uniform float uAmp,uKnot,uDist,uFlow,uJump,uShim,uX0,uFreq,uOct,uDetail,uHigh,uScale,uAlpha,uAxes,uPt,uLean;
out float vA;
float h3(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z)*2.-1.; }
float fbm(vec3 p){ float s=vn(p)*.62; s+=vn(p*2.07+11.3)*.28; s+=vn(p*4.13+27.1)*.13*uOct; return s; }
void main(){
  float u=a.x, v=a.y, sd=a.z, kind=a.w;
  vec3 P; float alpha;
  if(kind<.5){
    float x=u, T=uFlow+uJump;
    float E=exp(-pow((x-uX0)/(0.36*uScale),2.));                  // the swell lives in the centre of the line
    float A=uAmp*uScale*E;
    // 1. centreline path: one coherent, slowly evolving wave (mass)
    float nL=fbm(vec3(x*uFreq*1.3,7.7,T*0.8)), zL=fbm(vec3(x*uFreq*1.1,-4.1,T*0.7+5.));
    vec3 Cl=vec3(x+A*0.16*fbm(vec3(x*2.,3.3,T)), A*0.62*nL, A*0.35*zL);
    // 2. a membrane that opens out of the line where it swells. It lies mostly flat
    //    (seen edge-on from the side → a ribbon; from above → a torn sheet), twists
    //    partly upright, and shears so the oblique view reads diagonal.
    float th=1.5708+0.55*fbm(vec3(x*uFreq*1.6,1.9,T*0.9));
    vec3 dir=vec3(0.85,cos(th),sin(th));
    float w=(0.004+0.62*A)*(0.8+0.4*fbm(vec3(x*3.1,v*0.6,T+2.)));
    vec3 q=vec3(x*uFreq*2.4, v*uFreq*1.8, T);
    float ny=fbm(q+vec3(17.1,3.3,0.));
    x=Cl.x;
    // hot knot after a kick: dust converges along the line toward the swell centre
    float kn=exp(-pow((u-uX0)/0.14,2.));
    x-= uKnot*0.75*(x-uX0)*exp(-pow((x-uX0)/0.35,2.));
    float vf=v+0.62*sin(3.1416*v*1.3+2.4*fbm(vec3(x*1.7,5.1,T*0.6))+1.);   // non-monotonic across the sheet → it folds over itself → bright crease lines
    P=vec3(x,Cl.y,Cl.z)+dir*vf*w; P.y+=A*0.22*ny;
    float edge=smoothstep(0.82,1.0,abs(v));
    // 3. crumple: high-frequency folds on the ribbon surface → torn, foamy texture
    vec3 cq=vec3(u*24.*uFreq, v*4.5, T*2.0+uShim*0.05);
    vec3 cr=vec3(vn(cq),vn(cq+vec3(5.2,1.3,0.)),vn(cq+vec3(-3.1,8.7,0.)));
    vec3 cq2=cq*2.6+vec3(1.7,4.4,0.); cr+=0.55*vec3(vn(cq2),vn(cq2+vec3(2.2,7.1,0.)),vn(cq2+vec3(9.3,-2.8,0.)));
    P+=cr*(0.001+A*(0.014+0.014*uDetail)*(1.+4.*edge)+0.06*uDist*A);
    // 4. loose dust: per-point scatter; a few flecks drift further; highs make it shimmer
    vec3 rj=vec3(h3(vec3(sd*91.7,v*13.1,1.)),h3(vec3(sd*37.3,u*7.9,2.)),h3(vec3(sd*53.1,3.,v*5.3)))*2.-1.;
    float sh=0.72+0.28*sin(uShim*(2.+6.*sd)+sd*40.);
    float sc=(0.0004+0.0018*A*(0.5+uDetail)+0.012*uDist*A)*sh+0.0015*uHigh*uDetail*E;
    if(sd>0.975) sc+= (0.008+0.05*A)*(0.4+0.6*uDetail)*sh;
    P+=rj*rj*rj*sc*6.;
    float win=smoothstep(1.05,0.45,abs(u));                    // bright window x≈0.19–0.81 W, faint beyond
    alpha=(0.10+0.90*win)*(0.55+0.45*sd)*(0.10+0.90*smoothstep(0.0,0.09,A)+2.6*uKnot*kn)*(0.5+2.0*edge);   // flat line stays a faint hairline; material gathers where it swells
  } else {
    float t=u; vec3 jit=(vec3(h3(vec3(sd*71.,v,3.)),h3(vec3(v*9.,sd*3.,4.)),h3(vec3(sd,v*17.,5.)))*2.-1.)*0.006;
    vec4 L=kind<1.5?uLn[0]:(kind<2.5?uLn[1]:uLn[2]);
    P=vec3(uX0,0.,0.)+L.xyz*t+jit;                              // anchored at the swell centre, not the world origin
    float half_=L.w<1.5?step(0.0,t):1.;                       // half lines start exactly at the centre
    alpha=step(0.5,L.w)*max(uAxes*0.6,uLineA)*0.9*(0.5+0.5*sd)*smoothstep(4.,0.,abs(t))*half_;
    if(uLineA>1.0) alpha*=1.0+0.35*(uLineA-1.0);          // above 1 the threads also thicken a little instead of only saturating
  }
  gl_Position=uM*vec4(P,1.);
  gl_PointSize=uPt; vA=alpha*uAlpha;
}`;
const FS_PTS=`#version 300 es
precision highp float; in float vA; out vec4 o; void main(){ o=vec4(vA,vA,vA,1.); }`;
const VS_Q=`#version 300 es
layout(location=0) in vec2 p; out vec2 uv; void main(){ uv=p*.5+.5; gl_Position=vec4(p,0.,1.); }`;
const FS_FADE=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform float k; out vec4 o; void main(){ o=vec4(texture(t,uv).rgb*k,1.); }`;
const FS_DOWN=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 px; out vec4 o;
void main(){ vec3 s=texture(t,uv+px*vec2(-.5,-.5)).rgb+texture(t,uv+px*vec2(.5,-.5)).rgb+texture(t,uv+px*vec2(-.5,.5)).rgb+texture(t,uv+px*vec2(.5,.5)).rgb; o=vec4(s*.25,1.); }`;
const FS_BLUR=`#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 d; out vec4 o;
void main(){ vec3 s=texture(t,uv).rgb*.2270270270; s+=(texture(t,uv+d*1.3846153846).rgb+texture(t,uv-d*1.3846153846).rgb)*.3162162162;
 s+=(texture(t,uv+d*3.2307692308).rgb+texture(t,uv-d*3.2307692308).rgb)*.0702702703; o=vec4(s,1.); }`;
const FS_COMP=`#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uAcc,uNear,uHaze; uniform vec2 uRes; uniform float uGain,uGlow,uGrain,uGrainT,uGamma,uContrast,uScaleG;
uniform vec3 uBg,uInk,uHazeC;
float h2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn2(vec2 x){ vec2 i=floor(x),f=fract(x); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
void main(){
  vec2 p=gl_FragCoord.xy;
  float d=texture(uAcc,uv).r, n=texture(uNear,uv).r, h=texture(uHaze,uv).r;
  float dust=1.-exp(-d*uGain);
  float near=1.-exp(-n*uGain*0.9);
  float haze=1.-exp(-h*uGain*2.2);
  // mottled grain living inside the haze (held ~12 Hz), plus a faint floor
  vec2 gp=p/(26.*uScaleG)+vec2(uGrainT*17.13,uGrainT*9.71);
  float mott=vn2(gp)*.6+vn2(gp*2.3+5.)*.4;
  float fine=h2(p+uGrainT*113.)-.5;
  float lum=dust+near*0.16*uGlow+haze*0.10*uGlow*(0.55+0.9*mott);
  lum=clamp(lum,0.,1.); lum=pow(lum,uGamma); lum=clamp((lum-.5)*uContrast+.5+(uContrast-1.)*.5*0.,0.,1.);
  vec3 col=mix(uBg,uInk,lum);
  col=mix(col,uHazeC,0.);
  col+=(fine*(0.25+2.5*haze)+ (mott-.5)*0.6*haze)*uGrain*sign(dot(uInk-uBg,vec3(1)));
  o=vec4(clamp(col,0.,1.),1.);
}`;
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function prog(vs,fs){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  const u={};const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i);u[a.name]=gl.getUniformLocation(p,a.name);}return {p,u};}
const pPts=prog(VS_PTS,FS_PTS), pFade=prog(VS_Q,FS_FADE), pDown=prog(VS_Q,FS_DOWN), pBlur=prog(VS_Q,FS_BLUR), pComp=prog(VS_Q,FS_COMP);
const qVAO=gl.createVertexArray(); gl.bindVertexArray(qVAO); { const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); }
const pVAO=gl.createVertexArray(); gl.bindVertexArray(pVAO); { const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,pts,gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0); }
gl.bindVertexArray(null);
function target(w,h){ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,floatOK?gl.RGBA16F:gl.RGBA8,w,h,0,gl.RGBA,floatOK?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fb=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fb); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); return {t,fb,w,h}; }
let RT=null, W=720, H=1280;
function setup(w,h){ if(RT) for(const k in RT){gl.deleteTexture(RT[k].t);gl.deleteFramebuffer(RT[k].fb);}
  W=w;H=h;canvas.width=w;canvas.height=h;
  RT={a:target(w,h),b:target(w,h),n1:target(w>>1,h>>1),n2:target(w>>1,h>>1),q1:target(w>>2,h>>2),h1:target(w>>3,h>>3),h2:target(w>>3,h>>3)}; }
setup(720,1280);
function pass(rt,pr){ gl.bindFramebuffer(gl.FRAMEBUFFER,rt?rt.fb:null); gl.viewport(0,0,rt?rt.w:W,rt?rt.h:H); gl.useProgram(pr.p); }
function tex(u,t){ gl.activeTexture(gl.TEXTURE0+u); gl.bindTexture(gl.TEXTURE_2D,t); }
function blur(src,tmp,dx,dy){ pass(tmp,pBlur); tex(0,src.t); gl.uniform1i(pBlur.u.t,0); gl.uniform2f(pBlur.u.d,dx/src.w,0); gl.drawArrays(gl.TRIANGLES,0,3);
  pass(src,pBlur); tex(0,tmp.t); gl.uniform2f(pBlur.u.d,0,dy/src.h); gl.drawArrays(gl.TRIANGLES,0,3); }
let frameNo=0;
function render(dt){
  const sc=W>H?H/720:H/1280, lk=LOOKS[lookKey];   // point size / grain scale: by the short side
  const decay=0.25+0.7*P.persistence, k=Math.pow(decay,Math.max(0,dt)*60), norm=(1-decay)/0.75;
  gl.bindVertexArray(qVAO);
  pass(RT.b,pFade); tex(0,RT.a.t); gl.uniform1i(pFade.u.t,0); gl.uniform1f(pFade.u.k,dt>0?k:decay); gl.drawArrays(gl.TRIANGLES,0,3);
  // dust
  const shot=P.shape==='auto'?S.shot:P.shape, cam=cameraFor(shot,P.shape==='auto'?S.shotSeed:0.5,W/H), u=pPts.u;
  gl.useProgram(pPts.p); gl.bindVertexArray(pVAO); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
  gl.uniformMatrix4fv(u.uM,false,cam.m);
  const lvlB=0.62+0.55*S.lvl*Math.min(1,P.response)+0.25*S.energy*Math.min(1,P.response);
  gl.uniform1f(u.uAmp,S.amp*cam.amp); gl.uniform1f(u.uKnot,S.knot); gl.uniform1f(u.uDist,S.dist); gl.uniform1f(u.uFlow,S.flow);
  gl.uniform1f(u.uJump,S.jump); gl.uniform1f(u.uShim,S.shim); gl.uniform1f(u.uX0,S.x0);
  gl.uniform1f(u.uFreq,(0.75+0.9*P.complexity)*(1+0.35*S.dist)); gl.uniform1f(u.uOct,0.3+1.4*P.complexity);
  gl.uniform1f(u.uDetail,P.detail); gl.uniform1f(u.uHigh,S.highS*P.highResp*Math.min(1.5,P.response)); gl.uniform1f(u.uScale,P.scale);
  gl.uniform1f(u.uAlpha,0.022*P.brightness*lvlB*norm*(720*1280)/(W*H)*2.25*sc*sc); gl.uniform1f(u.uAxes,cam.axes); gl.uniform4fv(u['uLn[0]'],LN); gl.uniform1f(u.uLineA,S.lineA*P.lines); gl.uniform1f(u.uPt,Math.max(1,1.0*sc*1.5)); gl.uniform1f(u.uLean,0.55);
  gl.drawArrays(gl.POINTS,0,NPTS);
  gl.disable(gl.BLEND);
  const t=RT.a; RT.a=RT.b; RT.b=t;
  // glow: near (1/2 res) and wide haze (1/8 res)
  gl.bindVertexArray(qVAO);
  pass(RT.n1,pDown); tex(0,RT.a.t); gl.uniform1i(pDown.u.t,0); gl.uniform2f(pDown.u.px,1/W,1/H); gl.drawArrays(gl.TRIANGLES,0,3);
  blur(RT.n1,RT.n2,1.6,1.6);
  pass(RT.q1,pDown); tex(0,RT.n1.t); gl.uniform2f(pDown.u.px,1/RT.n1.w,1/RT.n1.h); gl.drawArrays(gl.TRIANGLES,0,3);
  pass(RT.h1,pDown); tex(0,RT.q1.t); gl.uniform2f(pDown.u.px,1/RT.q1.w,1/RT.q1.h); gl.drawArrays(gl.TRIANGLES,0,3);
  blur(RT.h1,RT.h2,1.4,1.4); blur(RT.h1,RT.h2,2.2,2.2); blur(RT.h1,RT.h2,3.0,3.0);
  // material
  const c=pComp.u; pass(null,pComp); tex(0,RT.a.t); tex(1,RT.n1.t); tex(2,RT.h1.t);
  gl.uniform1i(c.uAcc,0); gl.uniform1i(c.uNear,1); gl.uniform1i(c.uHaze,2); gl.uniform2f(c.uRes,W,H);
  gl.uniform1f(c.uGain,1.0); gl.uniform1f(c.uGlow,P.glow*(0.8+0.5*S.lvl)); gl.uniform1f(c.uGrain,lk.grain); gl.uniform1f(c.uGrainT,Math.floor(S.t*12));
  gl.uniform1f(c.uGamma,lk.gamma); gl.uniform1f(c.uContrast,lk.contrast); gl.uniform1f(c.uScaleG,sc);
  gl.uniform3fv(c.uBg,lk.bg); gl.uniform3fv(c.uInk,lk.ink); gl.uniform3fv(c.uHazeC,lk.haze);
  gl.drawArrays(gl.TRIANGLES,0,3);
  frameNo++;
}


return { canvas, P, setup, analyze, A:null,
  setLook(k){ lookKey=k; },
  frame(t,dt,playing){ dt=Math.min(0.05,dt); const f=sampleFeatures(this.A,t,playing); stepSim(playing?dt:0,f); render(playing?dt:1/60); } };
}

/* ======================= 05 SPATIAL + 06 VOLUME (approved builds, logic untouched) ======================= */
const SPATIAL_DATA=(function(){
// ---------------------------------------------------------------- controls
// [key, label, default, section]
const CONTROLS = [
  ["scale",    "Scale",        0.21, "Form"],
  ["structure","Structure",    0.66, "Form"],
  ["speed",    "Speed",        0.44, "Motion"],
  ["turb",     "Turbulence",   0.61, "Motion"],
  ["drift",    "Roam",         0.70, "Motion"],
  ["density",  "Density",      0.70, "Particles"],
  ["sep",      "Separation",   0.55, "Particles"],
  ["persist",  "Persistence",  0.55, "Particles"],
  ["detail",   "Detail",       0.60, "Particles"],
  ["glow",     "Glow",         0.74, "Light"],
  ["core",     "Core",         0.47, "Light"],
  ["haze",     "Haze",         0.38, "Light"],
  ["bright",   "Brightness",   0.41, "Light"],
  ["resp",     "Response",     0.80, "Audio"],
  ["bass",     "Bass",         0.52, "Audio"],
  ["mid",      "Mid",          0.90, "Audio"],
  ["high",     "High",         0.88, "Audio"],
  ["grain",    "Grain",        0.50, "Grain"],
  ["grainSize","Grain size",   0.50, "Grain"],
  ["grainMove","Grain movement",1.00,"Grain"],
  ["tAmount",  "Amount",       0.69, "Tracker"],
];
const P = {};
const UI = { tracker:true, mirror:true, view:"result", res:1080, recording:false, camera:"static", palette:"mono",
  cTrk:[0.81,0.81,0.81], cSec:[1,1,1], cTxt:[0.95,0.95,0.95] };
/* Colour looks — stops sampled from the reference photos (luminance 0..1 → RGB 0..255).
   Thermal: blue haze → purple → red → orange → yellow → green → cyan → blue ring → flat orange clipped core.
   Red: near-black red haze → red body → orange peaks. Orange: inverted — orange field, the form burns down to maroon. */
const PALETTES={
  mono:{name:"Mono"},
  thermal:{name:"Thermal", stops:[[0,30,4,214],[0.03,15,4,232],[0.06,5,13,245],[0.1,11,34,246],[0.16,40,20,215],[0.22,62,10,183],
    [0.28,109,21,134],[0.35,234,62,38],[0.44,236,100,44],[0.52,240,160,55],[0.6,238,228,62],[0.68,80,215,85],[0.75,40,212,222],
    [0.83,24,70,225],[0.92,22,24,160],[0.955,240,176,64],[1,245,188,65]]},
  red:{name:"Red", stops:[[0,9,2,2],[0.04,33,5,4],[0.1,60,9,6],[0.18,84,15,10],[0.27,106,20,13],[0.37,131,26,18],[0.48,165,34,23],
    [0.6,201,44,31],[0.72,230,56,38],[0.84,235,83,43],[0.94,238,130,52],[1,246,172,80]]},
  orange:{name:"Orange", stops:[[0,240,149,54],[0.05,239,138,52],[0.12,238,120,47],[0.2,237,106,45],[0.29,235,84,40],[0.4,230,60,36],
    [0.52,204,43,29],[0.64,184,38,25],[0.76,157,31,20],[0.88,108,18,10],[1,89,13,7]]},
};
return {CONTROLS,PALETTES,UI};
})();

/* SPATIAL ENERGY renderer, verbatim, wrapped as a factory: one instance per canvas.
   The shell drives it with (t, dt, playing): AU.ctx.currentTime is the shell's clock. */
function makeSpatial(canvas){
'use strict';
// ---------------------------------------------------------------- constants
const TRAIL = 48, STRANDS = 4096, SIM_DT = 1/30, REF_W = 1080;
const OUT_FPS = 30;                 // grain / output cadence of the reference
const FPS_A = 60, FFTN = 2048;      // offline audio analysis rate

// Source look (luma of this ramp is what the AE Black & White stage sees)
const AMBER = [[0,0,0,0],[.055,13.8,9.3,1.2],[.14,32.3,21.3,4.6],[.30,69.7,48.7,11.4],[.50,123,88,22.4],
               [.70,174,127.6,37.9],[.875,220.8,169.2,62.2],[.98,251.7,221.9,125.2],[1,255,248,222]];
const AMBER_FLOOR = [4.6,4.0,3.3];

/* AE Curves — MEASURED, not designed: control points are matched quantiles
   (source B&W luma after ink bleed / displacement / DOF, steady state, 16 moments → the v1_5 target,
   21 frames). Monotone (PCHIP-like) interpolation, stored as a 16-bit LUT.
   Result: black floor 0.016, a long crushed toe, midtones lifted into a steep shoulder, clip at ≈0.74. */
const CURVE_PTS = [[0.0,0.011],[0.0392,0.012],[0.0588,0.0215],[0.0824,0.0353],[0.1098,0.0471],[0.1412,0.0588],[0.2235,0.098],
  [0.3412,0.1765],[0.4392,0.2745],[0.498,0.3451],[0.5647,0.4392],[0.6039,0.5176],[0.6471,0.6392],[0.698,0.8],[0.7373,1.0],[1.0,1.0]];
const CURVE = { bypass:false };   // fitted: see report

// ---------------------------------------------------------------- controls
// [key, label, default, section]
const CONTROLS = [
  ["scale",    "Scale",        0.21, "Form"],
  ["structure","Structure",    0.66, "Form"],
  ["speed",    "Speed",        0.44, "Motion"],
  ["turb",     "Turbulence",   0.61, "Motion"],
  ["drift",    "Roam",         0.70, "Motion"],
  ["density",  "Density",      0.70, "Particles"],
  ["sep",      "Separation",   0.55, "Particles"],
  ["persist",  "Persistence",  0.55, "Particles"],
  ["detail",   "Detail",       0.60, "Particles"],
  ["glow",     "Glow",         0.74, "Light"],
  ["core",     "Core",         0.47, "Light"],
  ["haze",     "Haze",         0.38, "Light"],
  ["bright",   "Brightness",   0.41, "Light"],
  ["resp",     "Response",     0.80, "Audio"],
  ["bass",     "Bass",         0.52, "Audio"],
  ["mid",      "Mid",          0.90, "Audio"],
  ["high",     "High",         0.88, "Audio"],
  ["grain",    "Grain",        0.50, "Grain"],
  ["grainSize","Grain size",   0.50, "Grain"],
  ["grainMove","Grain movement",1.00,"Grain"],
  ["tAmount",  "Amount",       0.69, "Tracker"],
];
const P = {};
const UI = { tracker:true, mirror:true, view:"result", res:1080, recording:false, camera:"static", palette:"mono", land:false,
  cTrk:[0.81,0.81,0.81], cSec:[1,1,1], cTxt:[0.95,0.95,0.95] };

// ---------------------------------------------------------------- GLSL
const GLSL_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
`;
const GLSL_HASH = `
uint pcg(uint v){ uint s=v*747796405u+2891336453u; uint w=((s>>((s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
float rnd(uint a, uint b){ return float(pcg(pcg(a)^(b*2654435769u)))*(1.0/4294967296.0); }
`;
const GLSL_NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 pot(vec3 p){ return vec3(snoise(p), snoise(p+vec3(31.4,-17.2,9.1)), snoise(p+vec3(-7.3,21.9,-45.6))); }
vec3 curl(vec3 p){
  const float e=0.09;
  vec3 dx=vec3(e,0,0), dy=vec3(0,e,0), dz=vec3(0,0,e);
  vec3 x0=pot(p-dx), x1=pot(p+dx), y0=pot(p-dy), y1=pot(p+dy), z0=pot(p-dz), z1=pot(p+dz);
  return vec3((y1.z-y0.z)-(z1.y-z0.y), (z1.x-z0.x)-(x1.z-x0.z), (x1.y-x0.y)-(y1.x-y0.x))/(2.0*e);
}
`;
const GLSL_VN2 = `
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn2(vec2 x){ vec2 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y)*2.0-1.0; }
`;
// strand populations: 0 core, 1 body shell, 2 outer wisps, 3 near drifters
const GLSL_POP = `
int popOf(uint row){ float h=rnd(row,1u); return h<0.64?0:(h<0.9?1:(h<0.975?2:3)); }
float lifeOf(uint row){ return mix(1.4,4.2,rnd(row,2u)); }
float popW(int p){ return p==0?1.0:(p==1?0.55:(p==2?0.07:0.8)); }
`;
const VS_QUAD = GLSL_HEAD + `
out vec2 vUv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2)*2.0-1.0; vUv=p*0.5+0.5; gl_Position=vec4(p,0,1); }`;

// ---- SIMULATION (unchanged physics of the source): column 0 = head, column k = history
const FS_SIM = GLSL_HEAD + GLSL_HASH + GLSL_NOISE + GLSL_POP + `
uniform sampler2D uState;
uniform float uDt, uEvol, uMass, uLowAmp, uMidAmp, uHighAmp, uSwirl, uPulse, uJet, uBreak, uFlow, uFreq, uSpeedK;
uniform vec3 uCenter, uSwirlAxis, uJetDir, uCamDir;
uniform mat3 uShape, uShapeInv;
uniform uint uSeed;
out vec4 o;
vec3 sphereDir(uint row, uint s){
  float z=rnd(row,s)*2.0-1.0; float a=6.2831853*rnd(row,s+1u);
  float r=sqrt(max(0.0,1.0-z*z)); return vec3(r*cos(a), r*sin(a), z);
}
void main(){
  ivec2 ij=ivec2(gl_FragCoord.xy);
  if(ij.x>0){ o=texelFetch(uState, ivec2(ij.x-1,ij.y), 0); return; }
  uint row=uint(ij.y);
  vec4 cur=texelFetch(uState, ij, 0);
  vec4 prv=texelFetch(uState, ivec2(1,ij.y), 0);
  int pop=popOf(row); float life=lifeOf(row); float hl=rnd(row,3u);
  float age=cur.w;
  if(age>life){
    vec3 d=sphereDir(row, uSeed);
    float w=rnd(row, uSeed+7u);
    vec3 np;
    if(pop==0)      np=uCenter + d*(0.05*pow(w,0.33)*uMass);
    else if(pop==1) np=uCenter + uShapeInv*(d*0.34*uMass*(0.85+0.3*w));
    else if(pop==2) np=uCenter + d*(0.7+0.5*w)*uMass;
    else {
      vec3 t1=normalize(cross(uCamDir, vec3(0.0,1.0,0.001))); vec3 t2=cross(uCamDir,t1);
      np=uCenter + uCamDir*(1.2+1.1*w) + t1*(rnd(row,uSeed+9u)-0.5)*2.4 + t2*(rnd(row,uSeed+11u)-0.5)*3.0;
    }
    o=vec4(np,0.0); return;
  }
  vec3 p=cur.xyz;
  vec3 v=(age<uDt*1.5)?vec3(0.0):(p-prv.xyz);
  vec3 q=p-uCenter;
  float ql=length(q)+1e-4; vec3 dir=q/ql;
  vec3 vel=vec3(0.0);
  vec3 m=uShape*q; float r=length(m)+1e-4;
  vec3 g=transpose(uShape)*(m/r);
  float tgt = pop==0?0.09:(pop==1?0.3:0.7);
  float pull= pop==0?2.2:(pop==1?1.4:(pop==2?0.5:0.0));
  vel += -g*(r-tgt*uMass)*pull;
  vec3 fl = curl(q*0.85 + vec3(0.0, uEvol*0.35, uEvol*0.21))*uLowAmp;
  if(pop<3){
    fl += curl(q*2.3*uFreq + vec3(uEvol*0.62, 0.0, -uEvol*0.41) + 17.0)*uMidAmp;
    fl += curl(q*7.2*uFreq + vec3(-uEvol*1.15, uEvol*0.93, 0.0) + 41.0)*uHighAmp;
  }
  vel += fl*uFlow*(pop==3?0.35:1.0);
  vel += cross(uSwirlAxis, q)*uSwirl*(pop==3?0.1:1.0);
  if(pop==3) vel += vec3(0.06,0.025,0.0);
  if(pop<3) vel += dir*uPulse*(0.6+0.8*hl);
  if(pop<2 && rnd(row,7u)<0.24 && ql<0.5*uMass) vel += uJetDir*uJet*(0.7+0.6*hl);
  v = mix(v, vel*uDt*uSpeedK, 0.2);
  if(uBreak>0.01 && rnd(row,9u)<0.35){
    vec3 j=vec3(rnd(row,uSeed+3u),rnd(row,uSeed+5u),rnd(row,uSeed+13u))-0.5;
    v += j*uBreak*0.03;
  }
  o=vec4(p+v, age+uDt);
}`;

const GLSL_CAM = `
uniform sampler2D uState;
uniform mat4 uVP; uniform mat3 uModel; uniform vec3 uCam;
uniform float uFocus, uAper, uH, uW, uCocH, uLineI, uDensity, uCoreBoost, uTrailExp, uSplitShare;
uniform int uT;
float cocPx(vec3 wp){ float z=max(distance(wp,uCam),0.2); return uAper*uCocH*abs(z-uFocus)/z; }
float nearOf(vec3 wp){ return distance(wp,uCam)<uFocus?1.0:0.0; }
float weightOf(uint row, int k, float age){
  int pop=popOf(row); float life=lifeOf(row);
  float kf=float(k)/float(uT-1);
  float trail=pow(1.0-kf,uTrailExp);
  float af=smoothstep(0.0,0.22,age)*(1.0-smoothstep(life*0.62,life,age));
  float youth=1.0+uCoreBoost*exp(-age*2.2)*(pop==0?1.6:0.3);
  float dens=1.0-smoothstep(uDensity-0.05,uDensity,rnd(row,5u));
  if(pop==3) dens=1.0;
  float sv=0.3+2.4*pow(rnd(row,19u),3.0);
  return uLineI*trail*af*youth*popW(pop)*dens*sv;
}
// energy handed from the thread to its split dust grows along the trail (older = more separated)
float splitOf(float kf){ return uSplitShare*smoothstep(0.05,0.7,kf); }
vec2 toPx(vec4 c){ return (c.xy/c.w)*0.5*vec2(uW,uH); }
`;

const VS_LINES = GLSL_HEAD + GLSL_HASH + GLSL_POP + GLSL_CAM + `
out float vI;
void main(){
  int seg=gl_VertexID>>1; int e=gl_VertexID&1;
  int row=seg/(uT-1); int k=seg-row*(uT-1);
  vec4 a=texelFetch(uState,ivec2(k,row),0);
  vec4 b=texelFetch(uState,ivec2(k+1,row),0);
  bool ok = b.w<a.w;
  vec4 s = e==0?a:b;
  vec3 wp=uModel*s.xyz;
  float coc=cocPx(wp);
  float sharp=1.0/(1.0+coc*coc*0.16);
  float kf=float(k+e)/float(uT-1);
  float I=weightOf(uint(row), k+e, s.w)*sharp*(1.0-splitOf(kf));
  vI=I;
  if(!ok || I<1e-5){ gl_Position=vec4(0.0,0.0,2.0,1.0); return; }
  gl_Position=uVP*vec4(wp,1.0);
}`;
const FS_LINES = GLSL_HEAD + `in float vI; out vec4 o; void main(){ o=vec4(vI,0.0,0.0,1.0); }`;

/* ---- SPLIT DUST (adapted from DUST's seeded loose-dust scatter, but with persistent identity):
   every trail sample sheds C children. A child's identity is (strand, emission step, c) — the
   emission step is (simStep − k), so the same child is drawn on consecutive frames while its
   parent sample ages down the trail, and its offset grows smoothly: the thread visibly frays
   apart instead of being re-randomised each frame. A few children are "loose" and travel ~5× further. */
const VS_SPLIT = GLSL_HEAD + GLSL_HASH + GLSL_POP + GLSL_CAM + `
uniform int uC, uStride; uniform uint uStep; uniform float uSep, uShim, uDetail, uPt, uWorld;
out float vI;
void main(){
  int per=((uT-1)/uStride)*uC;
  int row=gl_VertexID/per; int rem=gl_VertexID-row*per;
  int k=(rem/uC)*uStride+1; int c=rem-(rem/uC)*uC;
  vec4 a=texelFetch(uState,ivec2(k,row),0);
  vec4 b=texelFetch(uState,ivec2(k-1,row),0);
  float kf=float(k)/float(uT-1);
  uint id=pcg(uint(row)*977u ^ (uStep-uint(k))*2654435761u ^ uint(c)*40503u);
  vec3 rj=vec3(rnd(id,1u),rnd(id,2u),rnd(id,3u))*2.0-1.0;
  float loose=step(0.965,rnd(id,4u));
  float sh=0.75+0.25*sin(uShim*(2.0+6.0*rnd(id,5u))+rnd(id,6u)*40.0);
  vec3 vel=b.xyz-a.xyz;                                    // forward motion of the parent sample
  float grow=pow(kf,1.35);
  vec3 off=rj*rj*rj*uSep*grow*(0.05+0.02*uDetail*sh)*(1.0+4.0*loose)*uWorld
          - vel*grow*(2.0+6.0*rnd(id,7u))*uSep;           // lag behind the parent: parts trail the mass
  vec3 wp=uModel*(a.xyz+off);
  float coc=cocPx(wp);
  float sharp=1.0/(1.0+coc*coc*0.16);
  float W=weightOf(uint(row),k,a.w);
  float I=W*splitOf(kf)*float(uStride)/float(uC)*sharp*(0.4+1.2*rnd(id,8u))*mix(1.0,0.35,loose)*6.0;
  vI=I;
  if(!(a.w<b.w) || I<1e-5){ gl_Position=vec4(0,0,2,1); gl_PointSize=0.0; return; }
  gl_Position=uVP*vec4(wp,1.0); gl_PointSize=uPt;
}`;
const FS_SPLIT = GLSL_HEAD + `in float vI; out vec4 o; void main(){ o=vec4(vI,0.0,0.0,1.0); }`;

const VS_SPLAT = GLSL_HEAD + GLSL_HASH + GLSL_POP + GLSL_CAM + `
uniform int uStride; uniform float uQScale, uMaxPt;
out float vE; out float vNear;
void main(){
  int per=(uT-1)/uStride;
  int row=gl_VertexID/per; int k=(gl_VertexID-row*per)*uStride;
  vec4 a=texelFetch(uState,ivec2(k,row),0);
  vec4 b=texelFetch(uState,ivec2(k+uStride,row),0);
  vec3 wa=uModel*a.xyz, wb=uModel*b.xyz;
  vec4 ca=uVP*vec4(wa,1.0), cb=uVP*vec4(wb,1.0);
  float coc=cocPx(wa);
  float blur=1.0-1.0/(1.0+coc*coc*0.16);
  float len=(ca.w>0.05&&cb.w>0.05)?min(distance(toPx(ca),toPx(cb)),60.0):0.0;
  float E=weightOf(uint(row),k,a.w)*blur*len;
  float sizeQ=clamp(max(2.3*coc+2.0, len*1.25)/uQScale, 2.0, uMaxPt);
  float sizeF=sizeQ*uQScale;
  float area=(3.14159/3.0)*(sizeF*0.5)*(sizeF*0.5);
  vE=E/area; vNear=nearOf(wa);
  if(!(b.w<a.w) || E<1e-4 || ca.w<0.05){ gl_Position=vec4(0.0,0.0,2.0,1.0); gl_PointSize=0.0; return; }
  gl_Position=ca; gl_PointSize=sizeQ;
}`;
const VS_DUST = GLSL_HEAD + GLSL_HASH + `
uniform mat4 uVP; uniform vec3 uCam; uniform float uFocus, uAper, uH, uCocH, uQScale, uMaxPt, uTime, uDustE;
out float vE; out float vNear;
void main(){
  uint id=uint(gl_VertexID);
  vec3 p=vec3(rnd(id,1u),rnd(id,2u),rnd(id,3u))-0.5;
  p*=vec3(7.0,11.0,9.0);
  p+=0.22*vec3(sin(uTime*0.05+float(id)), sin(uTime*0.041+float(id)*1.7), cos(uTime*0.037+float(id)*0.3));
  float z=max(distance(p,uCam),0.3);
  float coc=uAper*uCocH*abs(z-uFocus)/z;
  float sizeQ=clamp((2.3*coc+3.0)/uQScale,2.0,uMaxPt);
  float sizeF=sizeQ*uQScale;
  float area=(3.14159/3.0)*(sizeF*0.5)*(sizeF*0.5);
  float tw=0.55+0.45*sin(uTime*(0.3+rnd(id,5u))+float(id));
  vE=uDustE*(0.2+rnd(id,4u))*tw/area*(3.0/z);
  vNear=z<uFocus?1.0:0.0;
  vec4 c=uVP*vec4(p,1.0);
  if(c.w<0.1||z<0.8){ gl_Position=vec4(0,0,2,1); gl_PointSize=0.0; return; }
  gl_Position=c; gl_PointSize=sizeQ;
}`;
const FS_SPLAT = GLSL_HEAD + `in float vE; in float vNear; out vec4 o;
void main(){ vec2 d=gl_PointCoord*2.0-1.0; float r2=dot(d,d); if(r2>1.0) discard;
  float w=exp(-3.0*r2)*vE; o=vec4(w, w*vNear, 0.0, 1.0); }`;
const VS_SPARK = GLSL_HEAD + GLSL_HASH + GLSL_POP + GLSL_CAM + `
uniform float uSparkFrac, uSparkI, uPt;
out float vI;
void main(){
  int row=gl_VertexID; uint r=uint(row);
  vec4 a=texelFetch(uState,ivec2(0,row),0);
  vec3 wp=uModel*a.xyz; float coc=cocPx(wp);
  float sharp=1.0/(1.0+coc*coc*0.16);
  float sel=rnd(r,13u);
  float life=lifeOf(r);
  float I=uSparkI*sharp*smoothstep(0.0,0.1,a.w)*(1.0-smoothstep(life*0.6,life,a.w))*(0.5+rnd(r,17u));
  vI=I;
  if(sel>uSparkFrac||I<1e-4||popOf(r)==3){ gl_Position=vec4(0,0,2,1); gl_PointSize=0.0; return; }
  gl_Position=uVP*vec4(wp,1.0); gl_PointSize=uPt;
}`;
const FS_SPARK = GLSL_HEAD + `in float vI; out vec4 o;
void main(){ vec2 d=gl_PointCoord*2.0-1.0; float r2=dot(d,d); if(r2>1.0) discard; o=vec4(vI*(1.0-r2),0.0,0.0,1.0); }`;

const FS_BASE = GLSL_HEAD + `in vec2 vUv; uniform sampler2D uSharp, uDef; out vec4 o;
void main(){ o=vec4(texture(uSharp,vUv).r+texture(uDef,vUv).r, texture(uDef,vUv).g, 0.0, 1.0); }`;
const FS_DOWN = GLSL_HEAD + `in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
vec3 s(float x,float y){ return texture(uSrc, vUv+vec2(x,y)*uTexel).rgb; }
void main(){
  vec3 a=s(-2.,-2.),b=s(0.,-2.),c=s(2.,-2.),d=s(-1.,-1.),e=s(1.,-1.),f=s(-2.,0.),g=s(0.,0.),h=s(2.,0.),
       i=s(-1.,1.),j=s(1.,1.),k=s(-2.,2.),l=s(0.,2.),m=s(2.,2.);
  o=vec4((d+e+i+j)*0.125+(a+b+f+g)*0.03125+(b+c+g+h)*0.03125+(f+g+k+l)*0.03125+(g+h+l+m)*0.03125,1.0);
}`;
const FS_UP = GLSL_HEAD + `in vec2 vUv; uniform sampler2D uLow, uHigh; uniform vec2 uLowTexel; uniform float uW, uLowW; out vec4 o;
void main(){
  vec2 t=uLowTexel;
  vec3 s=texture(uLow,vUv+vec2(-t.x,-t.y)).rgb+2.0*texture(uLow,vUv+vec2(0.,-t.y)).rgb+texture(uLow,vUv+vec2(t.x,-t.y)).rgb
        +2.0*texture(uLow,vUv+vec2(-t.x,0.)).rgb+4.0*texture(uLow,vUv).rgb+2.0*texture(uLow,vUv+vec2(t.x,0.)).rgb
        +texture(uLow,vUv+vec2(-t.x,t.y)).rgb+2.0*texture(uLow,vUv+vec2(0.,t.y)).rgb+texture(uLow,vUv+vec2(t.x,t.y)).rgb;
  o=vec4(s/16.0*uLowW + texture(uHigh,vUv).rgb*uW, 1.0);
}`;
// source composite (the original amber render, no grain) → RGBA16F
const FS_COMP = GLSL_HEAD + `in vec2 vUv;
uniform sampler2D uSharp, uDef, uBloom, uAtm, uLut, uTiny; uniform float uGlare;
uniform float uExp, uBloomK, uAtmK, uCA; uniform vec3 uFloor; uniform vec2 uAtmC, uAsp;
out vec4 o;
void main(){
  float Es=texture(uSharp,vUv).r;
  vec4 D=texture(uDef,vUv);
  float nf=clamp(D.g/(D.r+1e-4),0.0,1.0);
  vec2 dir=(vUv-0.5)*uAsp;
  vec2 sh=dir*uCA*nf;
  float Dr=texture(uDef,vUv+sh).r, Db=texture(uDef,vUv-sh*1.2).r;
  float B=texture(uBloom,vUv).r, At=texture(uAtm,vUv).r;
  float mE=0.0; for(int j=0;j<3;j++) for(int i=0;i<3;i++) mE+=texture(uTiny,vec2(0.2+0.3*float(i),0.2+0.3*float(j))).r;
  mE/=9.0;
  float c0=Es+B*uBloomK+At*uAtmK+uGlare*mE*(1.0-0.35*dot(vUv-0.5,vUv-0.5)*4.0);
  vec3 E=vec3(c0+Dr, c0+D.r, c0+Db);
  vec3 t=1.0-exp(-E*uExp);
  vec3 col=vec3(texture(uLut,vec2(t.r,0.5)).r, texture(uLut,vec2(t.g,0.5)).g, texture(uLut,vec2(t.b,0.5)).b);
  col*=1.0-dot(dir,dir)*4.0*0.45;
  float fl=1.0-0.55*clamp(length((vUv-uAtmC)*uAsp)*1.6,0.0,1.0);
  col+=uFloor*fl;
  o=vec4(col,1.0);
}`;

/* ---- EFFECT.APP: ink bleed + displacement (on the B&W luma of the source)
   Displacement: coherent 2-octave noise field (≈3 px @1080, ~20 px wavelength) → the wormy,
   crinkled filaments. Ink bleed: light spreads along a noise-steered direction (fibrous, one-sided
   feathering of edges) instead of an isotropic blur.                                              */
const FS_BLEED = GLSL_HEAD + GLSL_VN2 + `in vec2 vUv;
uniform sampler2D uSrc; uniform vec2 uRes; uniform float uDisp, uBleed, uT, uPxS;
out vec4 o;
float lum(vec2 uv){ vec3 c=texture(uSrc,uv).rgb; return dot(c,vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec2 px=vUv*uRes;
  vec2 q=px/(22.0*uPxS);
  vec2 d=vec2(vn2(q+vec2(uT*0.9,0.0)), vn2(q+vec2(17.3,uT*0.7)));
  d+=0.5*vec2(vn2(q*2.3+vec2(4.1,uT*1.3)), vn2(q*2.3+vec2(uT*1.1,9.7)));
  vec2 uv=vUv+d*uDisp*uPxS/uRes;
  vec2 tx=uPxS/uRes; float c0=lum(uv);
  float c=mix(c0,(lum(uv+vec2(tx.x,0))+lum(uv-vec2(tx.x,0))+lum(uv+vec2(0,tx.y))+lum(uv-vec2(0,tx.y))+c0)/5.0,0.85);
  float ang=6.2831*vn2(px/(60.0*uPxS)+vec2(uT*0.2,3.0));
  vec2 dir=vec2(cos(ang),sin(ang))*uPxS/uRes;
  float acc=0.0, wsum=0.0;
  for(int i=1;i<=6;i++){
    float fi=float(i), w=exp(-fi*0.42);
    acc+=w*max(lum(uv+dir*fi*2.2),lum(uv-dir*fi*1.1));
    wsum+=w;
  }
  float bleed=acc/wsum;
  float v=max(c, mix(c, bleed, uBleed));
  o=vec4(v,v,v,1.0);
}`;

/* ---- EFFECT.APP depth of field: blur radius depends on frame height (measured: labels in the
   lower half stay crisp, tags in the upper third are soft ≈ 6–9 px, form tops are hazy).
   Separable; pass 0 horizontal (also composites the tracker layer), pass 1 vertical.           */
const FS_DOF = GLSL_HEAD + `in vec2 vUv;
uniform sampler2D uSrc, uTrk; uniform vec2 uRes; uniform float uMaxR, uFocusY, uAniso, uPass, uUseTrk;
out vec4 o;
vec4 fetch(vec2 uv){
  vec4 s=texture(uSrc,uv);
  if(uUseTrk>0.5){ vec4 t=texture(uTrk,uv); s.rgb=mix(s.rgb,t.rgb,t.a); }
  return s;
}
void main(){
  float yTop=1.0-vUv.y;                                     // 0 = top of frame
  float above=clamp((uFocusY-yTop)/uFocusY,0.0,1.0);
  float below=clamp((yTop-(uFocusY+0.25))/(0.75-uFocusY),0.0,1.0);
  float r=uMaxR*(pow(above,1.35)+0.35*below*below);
  vec2 stepv = uPass<0.5 ? vec2(r*uAniso/uRes.x,0.0) : vec2(0.0,r/uRes.y);
  vec4 acc=vec4(0.0); float ws=0.0;
  for(int i=-6;i<=6;i++){
    float fi=float(i)/6.0; float w=exp(-fi*fi*2.2);
    acc+=w*fetch(vUv+stepv*float(i)/2.0); ws+=w;
  }
  o=vec4(acc.rgb/ws,1.0);
}`;

// ---- AE curves (+ Effect film grain before it). Shared by the glow bright-pass and the final pass.
const GLSL_GRADE = GLSL_HASH + `
uniform sampler2D uCurve; uniform float uCoreGain, uBypass;
float cv(float x){ x=clamp(x*uCoreGain,0.0,1.0); return texture(uCurve,vec2((x*1023.0+0.5)/1024.0,0.5)).r; }
vec3 curves(vec3 x){ if(uBypass>0.5) return x; return vec3(cv(x.r),cv(x.g),cv(x.b)); }
// film grain: white noise with a ≈0.8 px gaussian footprint @1080 (measured autocorr 0.68 @1px, 0.21 @2px)
float grainAt(vec2 p, uint f, float size){
  vec2 q=p/size; vec2 i=floor(q), fr=q-i;
  float acc=0.0, ws=0.0;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 c=i+vec2(x,y); vec2 d=c+0.5-q; float w=exp(-dot(d,d)*0.78);
    uint id=uint(int(c.x)+4096)*73856093u ^ uint(int(c.y)+4096)*19349663u;
    acc+=w*(rnd(id,f)+rnd(id,f+7919u)-1.0); ws+=w*w;
  }
  return acc/sqrt(ws)*2.449;                                  // unit std (triangular noise σ=0.408)
}
`;
const FS_BRIGHT = GLSL_HEAD + GLSL_GRADE + `in vec2 vUv; uniform sampler2D uSrc; uniform float uThr; out vec4 o;
void main(){ vec3 c=curves(texture(uSrc,vUv).rgb); float l=dot(c,vec3(0.2126,0.7152,0.0722));
  o=vec4(c*smoothstep(uThr,1.0,l)/max(l,1e-3)*l,1.0); }`;
// ---- final: curves(dof + film grain) + glow + add grain. View 1 = source A/B.
const FS_FINAL = GLSL_HEAD + GLSL_GRADE + `in vec2 vUv;
uniform sampler2D uDof, uGlow, uComp, uPal; uniform float uGlowK, uG1, uG2, uGSize, uView, uUsePal;
uniform uint uFrame; uniform vec2 uRes;
out vec4 o;
void main(){
  vec2 p=gl_FragCoord.xy;
  if(uView>0.5){
    vec3 c=texture(uComp,vUv).rgb;
    float l=dot(c,vec3(0.2126,0.7152,0.0722));
    c+=grainAt(p,uFrame,1.0)*(0.010+0.05*sqrt(l)*(1.0-l))*vec3(1.0,0.96,0.9);
    o=vec4(c,1.0); return;
  }
  vec3 x=texture(uDof,vUv).rgb;
  x+=grainAt(p,uFrame,uGSize)*uG1;                            // Effect.app film grain (before AE curves)
  vec3 c=curves(x);
  c+=texture(uGlow,vUv).rgb*uGlowK;                           // AE glow
  c=clamp(c,0.0,1.0);
  // AE add grain — measured σ: 3.8/255 in the black haze, ≈6.5–7.5/255 in the low mids, → 0 in clipped white
  c+=grainAt(p+vec2(311.0,97.0),uFrame*3u+1u,uGSize)*uG2*(1.0+0.7*clamp(c.g/0.08,0.0,1.0))*(1.0-0.85*pow(c.g,4.0));
  if(uUsePal>0.5){                                            // colour look = gradient map on final luminance (grain included)
    float L=clamp(dot(c,vec3(0.2126,0.7152,0.0722)),0.0,1.0);
    vec3 m=texture(uPal,vec2((L*1023.0+0.5)/1024.0,0.5)).rgb;
    float chroma=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
    c=mix(m,c,smoothstep(0.06,0.25,chroma));                  // custom-coloured tracker keeps its own colour
  }
  c+=(rnd(uint(p.x)+uint(p.y)*4099u,uFrame+55u)-0.5)/255.0;   // dither
  o=vec4(c,1.0);
}`;
const FS_PROBE = GLSL_HEAD + `in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main(){ float s=0.0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) s+=texture(uSrc,vUv+vec2(x,y)*uTexel).r; o=vec4(s/9.0,0,0,1); }`;

// ---------------------------------------------------------------- GL setup
const gl=canvas.getContext("webgl2",{antialias:false,alpha:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:"high-performance"});
function fail(msg){ throw new Error(msg); }
if(!gl) fail("WebGL2 is not available in this browser.");
if(!gl.getExtension("EXT_color_buffer_float")) fail("This GPU/browser can't render to float textures (EXT_color_buffer_float).");
const MAX_PT=Math.min(256, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]||64);
function compile(vs,fs){
  const mk=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error(src); fail("Shader error: "+gl.getShaderInfoLog(s)); } return s; };
  const p=gl.createProgram(); gl.attachShader(p,mk(gl.VERTEX_SHADER,vs)); gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fail("Link error: "+gl.getProgramInfoLog(p));
  const u={}; const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){ const info=gl.getActiveUniform(p,i); u[info.name.replace(/\[0\]$/,"")]=gl.getUniformLocation(p,info.name); }
  return {p,u};
}
const PR={
  sim:compile(VS_QUAD,FS_SIM), lines:compile(VS_LINES,FS_LINES), split:compile(VS_SPLIT,FS_SPLIT),
  splat:compile(VS_SPLAT,FS_SPLAT), dust:compile(VS_DUST,FS_SPLAT), spark:compile(VS_SPARK,FS_SPARK),
  base:compile(VS_QUAD,FS_BASE), down:compile(VS_QUAD,FS_DOWN), up:compile(VS_QUAD,FS_UP), comp:compile(VS_QUAD,FS_COMP),
  bleed:compile(VS_QUAD,FS_BLEED), dof:compile(VS_QUAD,FS_DOF), bright:compile(VS_QUAD,FS_BRIGHT),
  final:compile(VS_QUAD,FS_FINAL), probe:compile(VS_QUAD,FS_PROBE),
};
gl.bindVertexArray(gl.createVertexArray());
function target(w,h,ifmt,fmt,type,filter){
  const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,h,0,fmt,type,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) fail("Framebuffer incomplete ("+w+"×"+h+")");
  return {t,f,w,h};
}
const hdr=(w,h)=>target(Math.max(1,w|0),Math.max(1,h|0),gl.RGBA16F,gl.RGBA,gl.HALF_FLOAT,gl.LINEAR);

const sim={a:null,b:null,step:0};
function initSim(){
  const data=new Float32Array(TRAIL*STRANDS*4);
  let s=0x9E3779B9>>>0; const r=()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; };
  for(let row=0;row<STRANDS;row++){
    const z=r()*2-1, ang=r()*Math.PI*2, rr=Math.sqrt(1-z*z), rad=0.15+0.4*Math.cbrt(r());
    const x=rr*Math.cos(ang)*rad, y=rr*Math.sin(ang)*rad, zz=z*rad, age=r()*1.4;
    for(let k=0;k<TRAIL;k++){ const i=(row*TRAIL+k)*4; data[i]=x; data[i+1]=y; data[i+2]=zz; data[i+3]=age; }
  }
  for(const key of ["a","b"]){
    if(!sim[key]) sim[key]=target(TRAIL,STRANDS,gl.RGBA32F,gl.RGBA,gl.FLOAT,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D,sim[key].t); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,TRAIL,STRANDS,gl.RGBA,gl.FLOAT,data);
  }
  sim.step=0;
}
initSim();

const lutTex=gl.createTexture();
(function buildLut(){
  const px=new Uint8Array(256*4), s=AMBER;
  for(let i=0;i<256;i++){
    const t=i/255; let j=0; while(j<s.length-2&&t>s[j+1][0]) j++;
    const a=s[j], b=s[j+1], f=Math.min(1,Math.max(0,(t-a[0])/(b[0]-a[0])));
    for(let c=0;c<3;c++) px[i*4+c]=Math.round(a[c+1]+(b[c+1]-a[c+1])*f);
    px[i*4+3]=255;
  }
  gl.bindTexture(gl.TEXTURE_2D,lutTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,px);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
})();
const curveTex=gl.createTexture();
(function buildCurve(){
  const n=1024, d=new Float32Array(n*4), X=CURVE_PTS.map(p=>p[0]), Y=CURVE_PTS.map(p=>p[1]), m=X.length;
  // Fritsch–Carlson monotone cubic
  const dl=[], sl=[]; for(let i=0;i<m-1;i++){ dl.push(X[i+1]-X[i]); sl.push((Y[i+1]-Y[i])/(X[i+1]-X[i])); }
  const t=[sl[0]]; for(let i=1;i<m-1;i++) t.push(sl[i-1]*sl[i]<=0?0:(3*(dl[i-1]+dl[i]))/((2*dl[i]+dl[i-1])/sl[i-1]+(dl[i]+2*dl[i-1])/sl[i])); t.push(sl[m-2]);
  for(let k=0;k<n;k++){ const x=k/(n-1); let i=0; while(i<m-2&&x>X[i+1]) i++;
    const h=dl[i], u=(x-X[i])/h, h00=2*u*u*u-3*u*u+1, h10=u*u*u-2*u*u+u, h01=-2*u*u*u+3*u*u, h11=u*u*u-u*u;
    const y=Math.min(1,Math.max(0,h00*Y[i]+h10*h*t[i]+h01*Y[i+1]+h11*h*t[i+1])); d[k*4]=d[k*4+1]=d[k*4+2]=y; d[k*4+3]=1; }
  gl.bindTexture(gl.TEXTURE_2D,curveTex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,n,1,0,gl.RGBA,gl.FLOAT,d);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
})();
/* Colour looks — stops sampled from the reference photos (luminance 0..1 → RGB 0..255).
   Thermal: blue haze → purple → red → orange → yellow → green → cyan → blue ring → flat orange clipped core.
   Red: near-black red haze → red body → orange peaks. Orange: inverted — orange field, the form burns down to maroon. */
const PALETTES={
  mono:{name:"Mono"},
  thermal:{name:"Thermal", stops:[[0,30,4,214],[0.03,15,4,232],[0.06,5,13,245],[0.1,11,34,246],[0.16,40,20,215],[0.22,62,10,183],
    [0.28,109,21,134],[0.35,234,62,38],[0.44,236,100,44],[0.52,240,160,55],[0.6,238,228,62],[0.68,80,215,85],[0.75,40,212,222],
    [0.83,24,70,225],[0.92,22,24,160],[0.955,240,176,64],[1,245,188,65]]},
  red:{name:"Red", stops:[[0,9,2,2],[0.04,33,5,4],[0.1,60,9,6],[0.18,84,15,10],[0.27,106,20,13],[0.37,131,26,18],[0.48,165,34,23],
    [0.6,201,44,31],[0.72,230,56,38],[0.84,235,83,43],[0.94,238,130,52],[1,246,172,80]]},
  orange:{name:"Orange", stops:[[0,240,149,54],[0.05,239,138,52],[0.12,238,120,47],[0.2,237,106,45],[0.29,235,84,40],[0.4,230,60,36],
    [0.52,204,43,29],[0.64,184,38,25],[0.76,157,31,20],[0.88,108,18,10],[1,89,13,7]]},
};
const palTex=gl.createTexture();
function buildPalette(key){
  const st=PALETTES[key].stops; if(!st) return;
  const n=1024, px=new Uint8Array(n*4);
  for(let i=0;i<n;i++){ const t=i/(n-1); let j=0; while(j<st.length-2&&t>st[j+1][0]) j++;
    const a=st[j], b=st[j+1], f=Math.min(1,Math.max(0,(t-a[0])/(b[0]-a[0])));
    for(let c=0;c<3;c++) px[i*4+c]=Math.round(a[c+1]+(b[c+1]-a[c+1])*f); px[i*4+3]=255; }
  gl.bindTexture(gl.TEXTURE_2D,palTex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,n,1,0,gl.RGBA,gl.UNSIGNED_BYTE,px);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}
buildPalette("thermal");
const trkTex=gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D,trkTex);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));

let W=1080,H=1920,RT=null;
const trkCanvas=document.createElement("canvas"); const tctx=trkCanvas.getContext("2d");
function buildTargets(){
  if(RT){ for(const k in RT){ const v=RT[k]; for(const x of (Array.isArray(v)?v:[v])){ gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } } }
  H=UI.res; W=Math.round(H*9/16); if(UI.res===1080){ W=1080; H=1920; } else { W=720; H=1280; }
  if(UI.land){ const t=W; W=H; H=t; }
  PW=UI.land?96:54; PH=UI.land?54:96;   // the tracker's probe grid keeps square cells
  canvas.width=W; canvas.height=H; trkCanvas.width=W; trkCanvas.height=H;
  RT={
    sharp:hdr(W,H), def:hdr(W/4,H/4), base:hdr(W/2,H/2),
    down:[hdr(W/4,H/4),hdr(W/8,H/8),hdr(W/16,H/16),hdr(W/32,H/32),hdr(W/64,H/64)],
    up:[hdr(W/4,H/4),hdr(W/8,H/8),hdr(W/16,H/16),hdr(W/32,H/32)],
    comp:hdr(W,H), fx:hdr(W,H), dofA:hdr(W,H), dof:hdr(W,H),
    probe:target(PW,PH,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,gl.LINEAR),
  };
  trk.dirty=true;
}

// ---------------------------------------------------------------- math
const M4=new Float32Array(16), V4=new Float32Array(16), VP0=new Float32Array(16), VP=new Float32Array(16), TR4=new Float32Array(16);
const MODEL=new Float32Array(9), SHAPE=new Float32Array(9), SHAPEI=new Float32Array(9);
function rot3(yaw,pitch,roll){ const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch),cz=Math.cos(roll),sz=Math.sin(roll);
  return mul3(mul3([cy,0,sy,0,1,0,-sy,0,cy],[1,0,0,0,cx,-sx,0,sx,cx]),[cz,-sz,0,sz,cz,0,0,0,1]); }
function mul3(a,b){ const r=new Array(9); for(let i=0;i<3;i++)for(let j=0;j<3;j++) r[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j]; return r; }
function toCol(rm,out){ for(let i=0;i<3;i++)for(let j=0;j<3;j++) out[j*3+i]=rm[i*3+j]; return out; }
function perspective(out,fovy,aspect,near,far){ const f=1/Math.tan(fovy/2), nf=1/(near-far); out.fill(0);
  out[0]=f/aspect; out[5]=f; out[10]=(far+near)*nf; out[11]=-1; out[14]=2*far*near*nf; }
function lookAt(out,e,c,up){
  let zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2]; let l=Math.hypot(zx,zy,zz); zx/=l;zy/=l;zz/=l;
  let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx; l=Math.hypot(xx,xy,xz); xx/=l;xy/=l;xz/=l;
  const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
  out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0; out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0; out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;
  out[12]=-(xx*e[0]+xy*e[1]+xz*e[2]); out[13]=-(yx*e[0]+yy*e[1]+yz*e[2]); out[14]=-(zx*e[0]+zy*e[1]+zz*e[2]); out[15]=1; }
function mul4(out,a,b){ for(let c=0;c<4;c++)for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; out[c*4+r]=s; } }
const sn=(t,s)=>(Math.sin(t*1.0+s)*0.5+Math.sin(t*1.618+s*2.3)*0.3+Math.sin(t*2.718+s*0.7)*0.2);
const clamp01=x=>x<0?0:x>1?1:x;
const follow=(c,t,dt,a,r)=>c+(t-c)*(1-Math.exp(-dt/(t>c?a:r)));
// deterministic hash for CPU-side choices (tracker etc.)
const hash1=n=>{ const s=Math.sin(n*127.1+311.7)*43758.5453; return s-Math.floor(s); };

/* ================================================================ AUDIO — offline analysis
   Adapted from DUST 3: one FFT per 1/60 s over the decoded buffer, dB band energies, transients
   as fast dB rises (steady pads never read as hits), plus the spatial visualizer's kick/snare split. */
const FT=(()=>{ const n=FFTN, rev=new Uint32Array(n), cos=new Float32Array(n/2), sin=new Float32Array(n/2), win=new Float32Array(n), bits=Math.log2(n);
  for(let i=0;i<n;i++){let r=0,x=i;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}rev[i]=r;}
  for(let i=0;i<n/2;i++){cos[i]=Math.cos(2*Math.PI*i/n);sin[i]=-Math.sin(2*Math.PI*i/n);}
  for(let i=0;i<n;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1)); return {rev,cos,sin,win}; })();
function fft(re,im){ const n=re.length,{rev,cos,sin}=FT;
  for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
    for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const a=i+j,b=a+half,wr=cos[k],wi=sin[k],tr=re[b]*wr-im[b]*wi,ti=re[b]*wi+im[b]*wr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}}}
function pct(arr,p){const a=Float32Array.from(arr).sort();return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];}
function rises(e,frames,eRef,g,gap,minRise){ const out=new Float32Array(frames), r=new Float32Array(frames), ref=pct(e,0.97); let last=-99;
  for(let f=0;f<frames;f++){ let m=1e9; for(let k=Math.max(0,f-4);k<f;k++) m=Math.min(m,e[k]); r[f]=f>0?e[f]-m:0; }
  for(let f=0;f<frames;f++){ if(r[f]<minRise||e[f]<Math.max(ref-24,eRef-gap)) continue; let pk=true; for(let k=Math.max(0,f-3);k<=Math.min(frames-1,f+3);k++) if(r[k]>r[f]) pk=false;
    if(pk&&f-last>=6){ out[f]=Math.min(1,0.35+(r[f]-minRise)/14)*g; last=f; } }
  return out; }
function analyze(x,sr){
  const hop=sr/FPS_A, frames=Math.max(1,Math.ceil(x.length/hop)), N=FFTN, NB=N/2;
  const re=new Float32Array(N), im=new Float32Array(N);
  const bin=hz=>Math.max(1,Math.min(NB-1,Math.round(hz*N/sr)));
  const B={bass:[bin(30),bin(120)], lowmid:[bin(120),bin(400)], mid:[bin(400),bin(2500)], high:[bin(4000),bin(14000)],
           kick:[bin(35),bin(130)], crack:[bin(1800),bin(5000)], body:[bin(150),bin(300)], hat:[bin(8000),bin(16000)]};
  const keys=Object.keys(B), D={}; keys.forEach(k=>D[k]=new Float32Array(frames)); const dE=new Float32Array(frames);
  const db=p=>10*Math.log10(p+1e-12);
  for(let f=0;f<frames;f++){ const s0=Math.floor(f*hop)-N/2;
    for(let i=0;i<N;i++){const k=s0+i;re[i]=(k>=0&&k<x.length?x[k]:0)*FT.win[i];im[i]=0;}
    fft(re,im); let pE=0; const acc={}; keys.forEach(k=>acc[k]=0);
    for(let k=1;k<NB;k++){ const m=Math.hypot(re[k],im[k])/(N/4), p=m*m; pE+=p;
      for(const key of keys){ const b=B[key]; if(k>=b[0]&&k<=b[1]) acc[key]+=p; } }
    keys.forEach(k=>D[k][f]=db(acc[k])); dE[f]=db(pE); }
  const eRef=pct(dE,0.97), trackGain=Math.min(1,Math.max(0,(eRef+56)/30));
  // levels: relative to the track's own loud level, but gated by absolute level so quiet music stays quiet
  const norm=(arr,range)=>{ const ref=pct(arr,0.97), floor=ref-range, gate=Math.min(1,Math.max(0,(ref-eRef+52)/26))*trackGain, o=new Float32Array(arr.length);
    for(let i=0;i<arr.length;i++){const v=Math.min(1,Math.max(0,(arr[i]-floor)/range));o[i]=Math.pow(v,1.35)*gate;} return o; };
  const A={frames,duration:x.length/sr,
    low:norm(D.bass,36), lowmid:norm(D.lowmid,36), mid:norm(D.mid,36), high:norm(D.high,36), energy:norm(dE,40)};
  const absGate=new Float32Array(frames); for(let f=0;f<frames;f++) absGate[f]=Math.min(1,Math.max(0,(dE[f]+60)/24));
  for(const k of ["low","lowmid","mid","high","energy"]) for(let f=0;f<frames;f++) A[k][f]*=0.35+0.65*absGate[f];
  A.kick=rises(D.kick,frames,eRef,trackGain,22,7);
  A.snare=rises(D.crack,frames,eRef,trackGain,28,7);
  A.hat=rises(D.hat,frames,eRef,trackGain,30,6);
  for(let f=0;f<frames;f++){
    if(A.kick[f]>0&&D.kick[f]<dE[f]-9) A.kick[f]=0;                 // a kick is bass-dominated at that instant
    if(A.snare[f]>0){                                                  // a snare needs body rising with the crack,
      let m=1e9; for(let k=Math.max(0,f-4);k<f;k++) m=Math.min(m,D.body[k]);
      const body=D.body[f]-m>5&&D.body[f]>eRef-20;
      if(!body||D.crack[f]<dE[f]-32) A.snare[f]=0;                   // otherwise a hat / click (−32 dB: a snare on a kick sits ≈27 dB under the total)
    }
    if(A.hat[f]>0&&A.snare[f]>0) A.hat[f]*=0.4;
  }
  return A;
}

// ---- test audio: 9 states × 4 s (quiet, low energy, sustained, bass, kick, mid, high, dense mix, transition)
const TEST_SECTIONS=["quiet","low energy","sustained sound","bass","kick","mid","high","dense mix","transition"];
function synthTest(sr=44100){
  const SEC=4, dur=SEC*TEST_SECTIONS.length, n=Math.floor(dur*sr), x=new Float32Array(n);
  let seed=12345; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const bpm=124, beat=60/bpm;
  const add=(t0,len,fn)=>{const a=Math.floor(t0*sr),b=Math.min(n,a+Math.floor(len*sr));for(let i=Math.max(0,a);i<b;i++)x[i]+=fn((i-a)/sr,i/sr);};
  const kick=(t0,amp)=>{let ph=0;add(t0,0.4,t=>{const f=46+140*Math.exp(-t*30);ph+=2*Math.PI*f/sr;return amp*Math.exp(-t*8)*Math.sin(ph);});};
  const hat=(t0,amp,dec)=>{let p1=0,p2=0;add(t0,0.25,t=>{const w=rnd()*2-1,h=w-p1;p1=w;const h2=h-p2;p2=h;return amp*Math.exp(-t*dec)*h2*0.5;});};
  const snare=(t0,amp)=>{let p=0;add(t0,0.3,t=>{const w=rnd()*2-1,h=w-p;p=w;return amp*Math.exp(-t*16)*(0.6*h+0.5*Math.sin(2*Math.PI*185*t)*Math.exp(-t*20));});};
  const saw=(f,t,Hn=7)=>{let s=0;for(let h=1;h<=Hn;h++)s+=Math.sin(2*Math.PI*f*h*t)/h;return s*0.5;};
  const ch=[220,277.2,329.6,440];
  const pad=(t0,len,amp)=>add(t0,len,t=>{let s=0;for(const f of ch)s+=Math.sin(2*Math.PI*f*t)+0.3*Math.sin(4*Math.PI*f*t);return amp*s*Math.min(1,t*2)*Math.min(1,(len-t)*3);});
  const bass=(t0,len,f,amp)=>{let ph=0;add(t0,len,t=>{ph+=2*Math.PI*f/sr;return amp*Math.min(1,t*20)*Math.min(1,(len-t)*20)*(Math.sin(ph)+0.15*Math.sin(2*ph));});};
  const S=i=>i*SEC;
  pad(S(0),SEC,0.004);                                           // quiet
  pad(S(1),SEC,0.03); for(let t=0;t<SEC;t+=beat*2) hat(S(1)+t,0.04,50);   // low energy
  pad(S(2),SEC,0.12);                                            // sustained sound
  bass(S(3),SEC,49,0.6);                                         // bass
  for(let t=0;t<SEC-0.1;t+=beat) kick(S(4)+t,0.9);               // kick
  for(let e=0;e<SEC/beat*2;e++) if(e%2===1) add(S(5)+e*beat/2,beat*0.45,t=>{let s=0;for(const f of ch)s+=saw(f,t);return 0.12*s*Math.exp(-t*5);}); // mid stabs
  for(let s=0;s<SEC/beat*4;s++) hat(S(6)+s*beat/4,(s%2?0.35:0.55),s%4===2?12:55); // high
  { const t0=S(7); for(let t=0;t<SEC-0.1;t+=beat){ kick(t0+t,0.8); }                // dense mix
    for(let t=beat;t<SEC;t+=beat*2) snare(t0+t,0.5);
    for(let s=0;s<SEC/beat*4;s++) hat(t0+s*beat/4,0.25,s%4===2?12:55);
    bass(t0,SEC,55,0.35); pad(t0,SEC,0.05); }
  { const t0=S(8);                                               // transition: rise from near silence into the mix, then cut
    for(let t=0;t<SEC-0.1;t+=beat) kick(t0+t,0.8*Math.min(1,t/2.5));
    for(let s=0;s<SEC/beat*4;s++) hat(t0+s*beat/4,0.25*Math.min(1,s*beat/4/2),55);
    pad(t0,SEC,0.08); }
  let pk=0; for(let i=0;i<n;i++) pk=Math.max(pk,Math.abs(x[i])); if(pk>0){ const g=0.9/pk; for(let i=0;i<n;i++) x[i]*=g; }
  return x;
}

const AU={ ctx:null, dest:null, buffer:null, src:null, A:null, playing:false, startAt:0, offset:0, isTest:false, lastFi:-1,
  f:{ bass:0, lowmid:0, mid:0, high:0, energy:0, eShort:0, eLong:0, kick:0, kickC:0, snare:0, hat:0, jet:0 },
  kickT:9, kickS:0, jetT:9, jetS:0, jetDir:[0,0,1], kickCount:0, snareEnv:0, hatEnv:0, onset:0, force:null };
function ensureAudio(){ if(!AU.ctx){ AU.ctx=new (window.AudioContext||window.webkitAudioContext)(); AU.dest=AU.ctx.createMediaStreamDestination(); } return AU.ctx; }
function curTime(){ return AU.playing?AU.ctx.currentTime-AU.startAt:AU.offset; }
function kickCurve(){ const t=AU.kickT, s=AU.kickS; if(t>3) return {comp:0,burst:0};
  return { comp:s*Math.exp(-t/0.045), burst:s*(1-Math.exp(-t/0.05))*Math.exp(-t/0.28) }; }
function analyse(dt){
  const F=AU.f; AU.kickT+=dt; AU.jetT+=dt;
  let lv={low:0,lowmid:0,mid:0,high:0,energy:0}, k=0, s=0, h=0;
  if(AU.force){ const fo=AU.force; lv={low:fo.low||0,lowmid:fo.lowmid||0,mid:fo.mid||0,high:fo.high||0,energy:fo.energy||0}; k=AU.force.kick||0; s=AU.force.snare||0; h=AU.force.hat||0; AU.force.kick=AU.force.snare=AU.force.hat=0; }
  else if(AU.A&&AU.playing){
    const A=AU.A, fi=Math.min(A.frames-1,Math.max(0,Math.floor(curTime()*FPS_A)));
    lv={low:A.low[fi],lowmid:A.lowmid[fi],mid:A.mid[fi],high:A.high[fi],energy:A.energy[fi]};
    const from=(AU.lastFi<0||AU.lastFi>fi)?fi:AU.lastFi+1;
    if(fi-from<30) for(let j=from;j<=fi;j++){ k=Math.max(k,A.kick[j]); s=Math.max(s,A.snare[j]); h=Math.max(h,A.hat[j]); }
    AU.lastFi=fi;
  } else AU.lastFi=-1;
  F.bass=follow(F.bass,lv.low,dt,0.03,0.30); F.lowmid=follow(F.lowmid,lv.lowmid,dt,0.04,0.25);
  F.mid=follow(F.mid,lv.mid,dt,0.04,0.22); F.high=follow(F.high,lv.high,dt,0.015,0.12);
  F.energy=follow(F.energy,lv.energy,dt,0.06,0.4); F.eShort=follow(F.eShort,lv.energy,dt,0.2,0.5); F.eLong=follow(F.eLong,lv.energy,dt,4,6);
  if(k>0){ AU.kickS=Math.max(k,kickCurve().burst*0.6); AU.kickT=0; AU.kickCount++; AU.onset=Math.max(AU.onset,k);
    if(k>0.6&&AU.kickCount%3===0){ const a=hash1(AU.kickCount*3.1)*Math.PI*2, zz=hash1(AU.kickCount*7.7)*1.6-0.6, r=Math.sqrt(Math.max(0,1-zz*zz));
      AU.jetDir=[r*Math.cos(a), r*Math.sin(a)-0.35, zz]; const l=Math.hypot(...AU.jetDir); AU.jetDir=AU.jetDir.map(v=>v/l); AU.jetT=0; AU.jetS=k; } }
  if(s>0){ AU.snareEnv=Math.max(AU.snareEnv,s); AU.onset=Math.max(AU.onset,s*0.8); }
  if(h>0) AU.hatEnv=Math.max(AU.hatEnv,h);
  AU.snareEnv*=Math.exp(-dt/0.14); AU.hatEnv*=Math.exp(-dt/0.07); AU.onset*=Math.exp(-dt/0.2);
  const kc=kickCurve(); F.kick=kc.burst; F.kickC=kc.comp; F.snare=AU.snareEnv; F.hat=AU.hatEnv;
  F.jet=AU.jetT<3?AU.jetS*Math.exp(-AU.jetT/0.5)*(1-Math.exp(-AU.jetT/0.04)):0;
}

// ---------------------------------------------------------------- VISUAL STATE
// Composition measured from v1_5: form centroid ≈ (0.57, 0.44) of frame, spread σx ≈ 0.10 W, σy ≈ 0.09 H.
const COMPO = { cx:0.50, cy:0.45 };   // form centroid lands at frame centre (the mass sits ≈0.05 H below this point)
// Motion calibration: centroid step per unique frame measured 0.45 % (p90 1.3 %), spread change 1.5 % —
// the processed reference evolves ~4× slower than the raw source did, so all continuous rates are scaled.
const TS = 0.2;
const S={ t:0, evol:0, morph:0, rotA:0, fog:0, breakdown:0, center:[0,0,0], camPos:[0,0,4.6], camDist:4.6, focus:4.6, aper:0.02,
  exposure:1, mass:1, low:0.6, midA:0.3, highA:0.1, swirl:0.3, swirlAxis:[0,1,0], pulse:0, jet:0, brk:0, flow:1, freq:1,
  coreBoost:1.5, density:0.7, sparkFrac:0.02, sparkI:0, bloomK:1, atmK:1, glare:1, atmC:[0.5,0.5], camDirObj:[0,0,1], shim:0, dispT:0 };
function updateVisualState(dt){
  const F=AU.f, r=P.resp, mo=0.2+1.0*P.speed, tu=0.25+1.5*P.turb;
  const bassL=F.bass*P.bass*2*r, midL=F.mid*P.mid*2*r, highL=F.high*P.high*2*r;
  const kick=F.kick*P.bass*1.6*r, kickC=F.kickC*P.bass*1.6*r, snare=F.snare*P.mid*1.6*r, hat=F.hat*P.high*1.6*r;
  const en=F.energy*r;
  S.t+=dt; S.tm=(S.tm||0)+dt*TS*(0.6+0.8*mo);
  // continuous motion (independent of audio; audio only modulates rates)
  S.evol += dt*TS*(0.05+0.24*mo + 0.18*highL + 0.08*en) + dt*0.25*snare;
  S.morph += dt*TS*(0.02+0.07*mo + 0.03*midL);
  S.rotA += dt*TS*(0.01+0.05*mo)*(0.4+1.2*P.drift);
  S.shim += dt*(0.6+5.0*(highL+hat))*(0.3+0.7*P.detail);
  S.dispT += dt*(0.08+0.25*P.drift+0.3*midL);
  const m=S.morph, st=P.structure;
  const elong=0.5+0.5*sn(m*0.9,1.3);
  const sx=1+(0.6+1.8*st)*elong*elong+0.25*midL*Math.sin(S.t*2.1), sy=1/Math.sqrt(sx)*(1+0.18*midL*Math.sin(S.t*1.7+1)), sz=0.85+0.2*sn(m*1.3,4.1);
  const R=rot3(m*0.55+sn(m*0.4,2)*1.2, 0.7*sn(m*0.5,5.5), 0.9*sn(m*0.33,7.7)+0.6);
  const Rt=[R[0],R[3],R[6],R[1],R[4],R[7],R[2],R[5],R[8]];
  toCol(mul3([1/sx,0,0,0,1/sy,0,0,0,1/sz],Rt),SHAPE); toCol(mul3(R,[sx,0,0,0,sy,0,0,0,sz]),SHAPEI);
  // bass → mass & pressure (push through space), kick → compression then burst
  S.cBass=follow(S.cBass||0,bassL,dt,0.6,1.2);
  S.mass=1+0.45*S.cBass+0.35*kick-0.25*kickC;
  const dr=0.4+1.2*P.drift;
  // bass pushes the mass slowly, not per beat (S.cBass)
  // world-space wander (the mass moves through its own volume → trailing parts lag behind)
  S.dyn=follow(S.dyn==null?1:S.dyn, UI.camera==="dynamic"?1:0, dt, 0.5, 0.5);   // camera mode blends, no jump
  const stc=1-S.dyn, rp0=S.rp||[0,0], SR=0.65;                                   // static: roam at 0.65 of the dynamic range
  const fwx=UI.land?2.14:1.2, fwy=UI.land?1.2:2.14;
  S.center=[(0.13*sn((S.tr||0)*0.8+0.3,0.2)+0.05*S.cBass*sn(S.tm*0.7,3))*dr + stc*rp0[0]*fwx*SR,
            (0.11*sn((S.tr||0)*0.6+0.1,1.9)+0.03*S.cBass)*dr - stc*rp0[1]*fwy*SR, 0.12*sn(S.tm*0.2,4.4)];
  // mid → internal circulation; high → fine turbulence; structure → how much fine structure
  S.low=(0.5+0.3*S.cBass)*tu; S.midA=(0.4+0.3*st+0.45*midL)*tu; S.highA=(0.12+0.2*P.detail+0.3*highL+0.3*hat+1.3*snare)*tu;
  S.freq=0.8+0.45*st;
  S.flow=(0.4+0.6*mo+0.25*en)*0.32;
  S.swirl=((0.12+0.2*mo)*(1+0.6*sn(S.tm*0.4,6))+0.2*midL)*0.35;
  const ax=[sn(m*0.7,8),1,sn(m*0.6,9)*0.8]; const al=Math.hypot(...ax); S.swirlAxis=ax.map(v=>v/al);
  S.pulse=2.3*kick-3.2*kickC; S.jet=F.jet*2.6*r*P.bass; S.brk=snare;
  // energy → luminosity and density (not flashes: exposure follows the smoothed level)
  S.exposure=(0.45+1.1*P.bright)*(0.8+0.35*en+0.12*snare+0.12*kick);
  S.coreBoost=(0.6+1.6*P.core)+1.8*kick+0.6*en;
  S.bloomK=1.0; S.atmK=(0.5+2.2*P.haze); S.glare=(0.3+1.8*P.haze)*(1+S.fog*1.5);
  S.density=Math.min(1,(0.12+0.62*P.density)*(0.78+0.28*en+0.15*bassL));
  S.sparkFrac=0.01+0.1*highL+0.22*hat; S.sparkI=(0.25+1.2*hat+0.4*highL)*(0.5+P.detail);
  let fogT=0;
  if(AU.playing){ const ratio=F.eShort/(F.eLong+1e-3); S.breakdown=(ratio<0.5&&F.eLong>0.08)?S.breakdown+dt:0; if(S.breakdown>0.8) fogT=1; }
  const wander=0.5+0.5*Math.sin(S.tm*0.2+1.3*Math.sin(S.tm*0.08));
  fogT=Math.max(fogT,(wander>0.8?(wander-0.8)/0.2:0)*(AU.playing?0.35:0.8)*mo*0.6);
  S.fog=follow(S.fog,fogT,dt,1.6,0.5); if(F.kick>0.5||F.snare>0.5) S.fog*=Math.exp(-dt*6);
  const yaw=0.22*sn(S.tm*0.12,0.5)*dr*0.8*S.dyn, pitch=0.12*sn(S.tm*0.1,2.5)*dr*0.8*S.dyn;
  S.camDist=(4.6-2.2*P.scale)+(-0.2*S.cBass-0.18*kick+0.06*kickC)*S.dyn;
  S.camPos=[S.camDist*Math.sin(yaw)*Math.cos(pitch), S.camDist*Math.sin(pitch), S.camDist*Math.cos(yaw)*Math.cos(pitch)];
  S.focus=S.camDist+S.fog*1.35+0.1*Math.sin(S.tm*0.6)*mo;
  S.aper=(0.004+0.012*P.haze)*(1+S.fog*4.5);
  toCol(rot3(S.rotA,0.25*Math.sin(S.rotA*0.7),0.12*Math.sin(S.rotA*0.5)),MODEL);
  const cl=Math.hypot(...S.camPos), cd=S.camPos.map(v=>v/cl);
  S.camDirObj=[MODEL[0]*cd[0]+MODEL[1]*cd[1]+MODEL[2]*cd[2], MODEL[3]*cd[0]+MODEL[4]*cd[1]+MODEL[5]*cd[2], MODEL[6]*cd[0]+MODEL[7]*cd[1]+MODEL[8]*cd[2]];
  const c=[MODEL[0]*S.center[0]+MODEL[3]*S.center[1]+MODEL[6]*S.center[2], MODEL[1]*S.center[0]+MODEL[4]*S.center[1]+MODEL[7]*S.center[2], MODEL[2]*S.center[0]+MODEL[5]*S.center[1]+MODEL[8]*S.center[2]];
  const lk=0.45*S.dyn; lookAt(V4,S.camPos,[c[0]*lk,c[1]*lk,c[2]*lk],[Math.sin(0.03*sn(S.tm*0.07,1))*S.dyn,1,0]);
  if(UI.land) perspective(M4,2*Math.atan(Math.tan(17*Math.PI/180)*9/16),16/9,0.1,60); else perspective(M4,34*Math.PI/180,9/16,0.1,60);
  mul4(VP0,M4,V4);
  // screen-space placement: shift the projected field to the measured composition
  // ROAM — the form travels around the frame on a smooth path (damped spring toward a moving target):
  // Roam sets speed + range, energy speeds it up, bass widens it, kicks shove it off the path.
  S.tr=(S.tr||0)+dt*(0.4+1.4*P.drift)*(0.6+0.4*mo)*(1+0.6*en);
  const ra=0.5+1.1*P.drift, wide=1+0.35*S.cBass;
  const gx=0.17*ra*wide*sn(S.tr*0.9,1.1), gy=0.13*ra*wide*sn(S.tr*0.71,4.2);
  if(!S.rp){ S.rp=[gx,gy]; S.rv=[0,0]; }
  if(AU.kickT<dt*1.01 && kick>0.05){ const a=hash1(AU.kickCount*5.3)*6.2832; S.rv[0]+=Math.cos(a)*0.35*kick; S.rv[1]+=Math.sin(a)*0.3*kick; }
  const kS=14, cS=2*Math.sqrt(kS)*0.75;
  for(const i of [0,1]){ const g=i?gy:gx; S.rv[i]+=(kS*(g-S.rp[i])-cS*S.rv[i])*dt; S.rp[i]+=S.rv[i]*dt; }
  S.rp[0]=Math.max(-0.22,Math.min(0.22,S.rp[0])); S.rp[1]=Math.max(-0.18,Math.min(0.18,S.rp[1]));
  const rs=S.dyn+(1-S.dyn)*SR;
  S.formScr=[COMPO.cx+S.rp[0]*rs, COMPO.cy+0.05+S.rp[1]*rs];
  TR4.fill(0); TR4[0]=TR4[5]=TR4[10]=TR4[15]=1; TR4[12]=(COMPO.cx-0.5+S.rp[0]*S.dyn)*2; TR4[13]=-(COMPO.cy-0.5+S.rp[1]*S.dyn)*2;
  mul4(VP,TR4,VP0);
}

function stepSim(){
  const pr=PR.sim, u=pr.u;
  gl.useProgram(pr.p); gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER,sim.b.f); gl.viewport(0,0,TRAIL,STRANDS);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sim.a.t); gl.uniform1i(u.uState,0);
  gl.uniform1f(u.uDt,SIM_DT); gl.uniform1f(u.uEvol,S.evol); gl.uniform1f(u.uMass,S.mass);
  gl.uniform1f(u.uLowAmp,S.low); gl.uniform1f(u.uMidAmp,S.midA); gl.uniform1f(u.uHighAmp,S.highA);
  gl.uniform1f(u.uSwirl,S.swirl); gl.uniform1f(u.uPulse,S.pulse); gl.uniform1f(u.uJet,S.jet); gl.uniform1f(u.uBreak,S.brk);
  gl.uniform1f(u.uFlow,S.flow); gl.uniform1f(u.uFreq,S.freq); gl.uniform1f(u.uSpeedK,1.0);
  gl.uniform3fv(u.uCenter,S.center); gl.uniform3fv(u.uSwirlAxis,S.swirlAxis); gl.uniform3fv(u.uJetDir,AU.jetDir); gl.uniform3fv(u.uCamDir,S.camDirObj);
  gl.uniformMatrix3fv(u.uShape,false,SHAPE); gl.uniformMatrix3fv(u.uShapeInv,false,SHAPEI);
  gl.uniform1ui(u.uSeed,(sim.step*7919+13)>>>0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  const t=sim.a; sim.a=sim.b; sim.b=t; sim.step++;
}

// ---------------------------------------------------------------- RENDER
const pxS=()=>Math.min(W,H)/REF_W;
function setCam(u){
  gl.uniformMatrix4fv(u.uVP,false,VP); if(u.uModel) gl.uniformMatrix3fv(u.uModel,false,MODEL);
  gl.uniform3fv(u.uCam,S.camPos); gl.uniform1f(u.uFocus,S.focus); gl.uniform1f(u.uAper,S.aper);
  gl.uniform1f(u.uH,H); if(u.uW) gl.uniform1f(u.uW,W); if(u.uCocH) gl.uniform1f(u.uCocH,Math.max(W,H));
  if(u.uT){ gl.uniform1i(u.uT,TRAIL); gl.uniform1f(u.uLineI,0.17*pxS()/Math.pow(Math.max(S.density,0.2),0.35));
    gl.uniform1f(u.uDensity,S.density); gl.uniform1f(u.uCoreBoost,S.coreBoost);
    gl.uniform1f(u.uTrailExp,2.2-1.6*P.persist); gl.uniform1f(u.uSplitShare,0.7*P.sep); }
  if(u.uState!=null){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sim.a.t); gl.uniform1i(u.uState,0); }
}
function quad(fbo,w,h){ gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.viewport(0,0,w,h); gl.drawArrays(gl.TRIANGLES,0,3); }
function tex(unit,t,loc){ gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); gl.uniform1i(loc,unit); }
function pyramid(src, weights){          // down chain from src (half-res), weighted tent up chain → RT.up[0]
  let pr=PR.down; gl.useProgram(pr.p); let s=src;
  for(const d of RT.down){ tex(0,s.t,pr.u.uSrc); gl.uniform2f(pr.u.uTexel,1/s.w,1/s.h); quad(d.f,d.w,d.h); s=d; }
  pr=PR.up; gl.useProgram(pr.p); let low=RT.down[4], lowW=weights[4];
  for(let i=3;i>=0;i--){ const hi=RT.down[i], dst=RT.up[i];
    tex(0,low.t,pr.u.uLow); tex(1,hi.t,pr.u.uHigh); gl.uniform2f(pr.u.uLowTexel,1/low.w,1/low.h);
    gl.uniform1f(pr.u.uW,weights[i]); gl.uniform1f(pr.u.uLowW,lowW); quad(dst.f,dst.w,dst.h); low=dst; lowW=1; }
}
const BLOOM_W=[0.30,0.26,0.24,0.22,0.20];
// AE glow profile: fitted so luminance falls from the clipped core edge like the reference
// (0.5 at ≈19 px, 0.2 at ≈40 px, 0.1 at ≈56 px @1080)
const GLOW_W=[0.60,0.75,0.30,0.05,0.01];
// Core: scales the input into the curve (more / less of the form reaches the clipped shoulder)
const curveU=(u)=>{ tex(6,curveTex,u.uCurve); gl.uniform1f(u.uCoreGain,1+0.9*(P.core-0.55)); gl.uniform1f(u.uBypass,CURVE.bypass?1:0); };   // Core default 0.47 → gain 0.93

function renderHeavy(){
  // 1. sharp filaments + split dust + sparks (full res)
  gl.bindFramebuffer(gl.FRAMEBUFFER,RT.sharp.f); gl.viewport(0,0,W,H); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
  let pr=PR.lines; gl.useProgram(pr.p); setCam(pr.u); gl.drawArrays(gl.LINES,0,STRANDS*(TRAIL-1)*2);
  pr=PR.split; gl.useProgram(pr.p); setCam(pr.u);
  const C=3, STR=2;
  gl.uniform1i(pr.u.uC,C); gl.uniform1i(pr.u.uStride,STR); gl.uniform1ui(pr.u.uStep,sim.step>>>0);
  gl.uniform1f(pr.u.uSep,0.35+1.3*P.sep); gl.uniform1f(pr.u.uShim,S.shim); gl.uniform1f(pr.u.uDetail,P.detail);
  gl.uniform1f(pr.u.uPt,Math.max(1,pxS()*1.2)); gl.uniform1f(pr.u.uWorld,1.0);
  gl.drawArrays(gl.POINTS,0,STRANDS*Math.floor((TRAIL-1)/STR)*C);
  pr=PR.spark; gl.useProgram(pr.p); setCam(pr.u);
  gl.uniform1f(pr.u.uSparkFrac,S.sparkFrac); gl.uniform1f(pr.u.uSparkI,S.sparkI); gl.uniform1f(pr.u.uPt,Math.max(1.5,2.6*pxS()));
  gl.drawArrays(gl.POINTS,0,STRANDS);
  // 2. defocus + atmospheric dust (1/4 res)
  gl.bindFramebuffer(gl.FRAMEBUFFER,RT.def.f); gl.viewport(0,0,RT.def.w,RT.def.h); gl.clear(gl.COLOR_BUFFER_BIT);
  const qs=W/RT.def.w;
  pr=PR.splat; gl.useProgram(pr.p); setCam(pr.u); gl.uniform1i(pr.u.uStride,1); gl.uniform1f(pr.u.uQScale,qs); gl.uniform1f(pr.u.uMaxPt,MAX_PT);
  gl.drawArrays(gl.POINTS,0,STRANDS*(TRAIL-1));
  pr=PR.dust; gl.useProgram(pr.p); setCam(pr.u);
  gl.uniform1f(pr.u.uQScale,qs); gl.uniform1f(pr.u.uMaxPt,MAX_PT); gl.uniform1f(pr.u.uTime,S.t); gl.uniform1f(pr.u.uDustE,0.9*(0.3+P.haze));
  gl.drawArrays(gl.POINTS,0,700);
  gl.disable(gl.BLEND);
  // 3. source composite (bloom + atmosphere → amber LUT)
  pr=PR.base; gl.useProgram(pr.p); tex(0,RT.sharp.t,pr.u.uSharp); tex(1,RT.def.t,pr.u.uDef); quad(RT.base.f,RT.base.w,RT.base.h);
  pyramid(RT.base,BLOOM_W);
  pr=PR.comp; gl.useProgram(pr.p);
  tex(0,RT.sharp.t,pr.u.uSharp); tex(1,RT.def.t,pr.u.uDef); tex(2,RT.up[0].t,pr.u.uBloom); tex(3,RT.up[3].t,pr.u.uAtm); tex(4,lutTex,pr.u.uLut); tex(5,RT.down[4].t,pr.u.uTiny);
  gl.uniform1f(pr.u.uGlare,S.glare); gl.uniform1f(pr.u.uExp,S.exposure); gl.uniform1f(pr.u.uBloomK,S.bloomK); gl.uniform1f(pr.u.uAtmK,S.atmK);
  gl.uniform1f(pr.u.uCA,0.035); gl.uniform3f(pr.u.uFloor,AMBER_FLOOR[0]/255,AMBER_FLOOR[1]/255,AMBER_FLOOR[2]/255); gl.uniform2f(pr.u.uAtmC,S.atmC[0],S.atmC[1]);
  if(UI.land) gl.uniform2f(pr.u.uAsp,1.0,H/W); else gl.uniform2f(pr.u.uAsp,0.5625,1.0);
  quad(RT.comp.f,W,H);
  // 4. Effect.app: ink bleed + displacement (B&W)
  pr=PR.bleed; gl.useProgram(pr.p); tex(0,RT.comp.t,pr.u.uSrc);
  gl.uniform2f(pr.u.uRes,W,H); gl.uniform1f(pr.u.uDisp,3.2*(0.5+P.detail)); gl.uniform1f(pr.u.uBleed,0.75); gl.uniform1f(pr.u.uT,S.dispT); gl.uniform1f(pr.u.uPxS,pxS());
  quad(RT.fx.f,W,H);
  // 5. blob tracker reads the processed image, draws its layer
  probe(); updateTracker(); drawTracker();
  // 6. depth of field (tracker layer composited in the first pass)
  pr=PR.dof; gl.useProgram(pr.p);
  gl.uniform2f(pr.u.uRes,W,H); gl.uniform1f(pr.u.uMaxR,14.0*pxS()); gl.uniform1f(pr.u.uFocusY,Math.min(0.75,Math.max(0.3,(S.formScr?S.formScr[1]:0.5)+0.02)));   // focus follows the form gl.uniform1f(pr.u.uAniso,1.6);
  tex(0,RT.fx.t,pr.u.uSrc); tex(1,trkTex,pr.u.uTrk); gl.uniform1f(pr.u.uUseTrk,UI.tracker?1:0); gl.uniform1f(pr.u.uPass,0); quad(RT.dofA.f,W,H);
  tex(0,RT.dofA.t,pr.u.uSrc); gl.uniform1f(pr.u.uUseTrk,0); gl.uniform1f(pr.u.uPass,1); quad(RT.dof.f,W,H);
  // 7. AE glow (bright pass of the curved image → pyramid)
  pr=PR.bright; gl.useProgram(pr.p); tex(0,RT.dof.t,pr.u.uSrc); curveU(pr.u); gl.uniform1f(pr.u.uThr,0.77); quad(RT.base.f,RT.base.w,RT.base.h);
  pyramid(RT.base,GLOW_W);
}
let outFrame=0;
function renderFinal(){
  const pr=PR.final; gl.useProgram(pr.p);
  tex(0,RT.dof.t,pr.u.uDof); tex(1,RT.up[0].t,pr.u.uGlow); tex(2,RT.comp.t,pr.u.uComp);
  curveU(pr.u);
  gl.uniform1f(pr.u.uGlowK,1.45*P.glow);
  // grain calibrated to the reference: σ≈4/255 in the dark haze, rising through the midtones, ~0 in clipped white
  const g=P.grain*2;
  gl.uniform1f(pr.u.uG1,0.006*g); gl.uniform1f(pr.u.uG2,0.0175*g);
  gl.uniform1f(pr.u.uGSize,(0.5+1.3*P.grainSize)*pxS());
  gl.uniform1f(pr.u.uView,UI.view==="source"?1:0);
  tex(3,palTex,pr.u.uPal); gl.uniform1f(pr.u.uUsePal,UI.palette==="mono"?0:1);
  // grain movement: 1 = new grain every output frame (reference), lower = held longer
  const hold=Math.max(1,Math.round(1+(1-P.grainMove)*11));
  gl.uniform1ui(pr.u.uFrame,(Math.floor(outFrame/hold)*2654435761)>>>0);
  gl.uniform2f(pr.u.uRes,W,H);
  quad(null,W,H);
}

/* ================================================================ BLOB TRACKER
   Look measured from v1_5: glowing tags (≈96×28 px after DOF+glow), "×" marker + outlined label with
   mirrored "X###Y###" text (position in 1/10 px of 1080×1920), thin dashed leader lines, ≈1.65 tags on screen.
   Behaviour: every tag LOCKS onto a real bright structure found in the processed image and follows it —
   the marker sits on the blob, its coordinates update live, the tag trails it with a short lag.
   A tag is released when its structure fades/merges, or after 0.12–0.45 s: tags and leader lines flash on and off,
   short and jumpy, so the tracker keeps re-targeting (VYRAL: was 0.8–3 s). */
let PW=54, PH=96; const probeBuf=new Uint8Array(54*96*4);
const trk={ tags:[], nextId:1, cands:[], cx:0.5, cy:0.5, dirty:true, spawnAcc:0, lastT:0 };
const pv=(x,y)=>probeBuf[(y*PW+x)*4];
function probe(){
  const pr=PR.probe; gl.useProgram(pr.p); tex(0,RT.fx.t,pr.u.uSrc); gl.uniform2f(pr.u.uTexel,3/W,3/H);
  quad(RT.probe.f,PW,PH); gl.readPixels(0,0,PW,PH,gl.RGBA,gl.UNSIGNED_BYTE,probeBuf);
  let sw=0,sx=0,sy=0,mx=0;
  for(let y=0;y<PH;y++)for(let x=0;x<PW;x++){ const v=pv(x,y); if(v>mx) mx=v; const w=v*v; sw+=w; sx+=w*x; sy+=w*y; }
  if(sw>0){ trk.cx=sx/sw/PW; trk.cy=1-sy/sw/PH; }
  S.atmC=[trk.cx,trk.cy];
  const thr=Math.max(36,mx*0.3), c=[];
  for(let y=2;y<PH-2;y++)for(let x=2;x<PW-2;x++){ const v=pv(x,y); if(v<thr) continue; let isMax=true;
    for(let dy=-2;dy<=2&&isMax;dy++)for(let dx=-2;dx<=2;dx++){ if((dx||dy)&&pv(x+dx,y+dy)>v){ isMax=false; break; } }
    if(!isMax) continue;
    // sub-cell centroid + extent of the structure, so markers sit ON the blob and move smoothly
    let ws=0,wx=0,wy=0,n=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){ const xx=x+dx, yy=y+dy; if(xx<0||yy<0||xx>=PW||yy>=PH) continue;
      const u=pv(xx,yy); if(u>v*0.5) n++; const w=u*u; ws+=w; wx+=w*(xx+0.5); wy+=w*(yy+0.5); }
    c.push({x:wx/ws/PW, y:1-wy/ws/PH, v:v/255, r:Math.sqrt(n/Math.PI)/PW}); }   // readPixels rows are bottom-up → y top-down
  c.sort((a,b)=>b.v-a.v); trk.cands=c.slice(0,10);
}
const TD=(ax,ay,bx,by)=>Math.hypot(ax-bx,(ay-by)*(UI.land?H/W:1.78));
function updateTracker(){
  const t=S.t, dt=Math.min(0.2,Math.max(0,t-trk.lastT)); trk.lastT=t;
  const n0=trk.tags.length;
  // 1. follow: every tag re-acquires its structure (nearest candidate, oldest tags choose first)
  const claimed=new Set();
  for(const g of trk.tags){
    let best=-1, bd=0.09;
    trk.cands.forEach((c,i)=>{ if(claimed.has(i)) return; const d=TD(g.ax,g.ay,c.x,c.y); if(d<bd){ bd=d; best=i; } });
    if(best>=0){ const c=trk.cands[best]; claimed.add(best);
      g.vx=c.x-g.ax; g.vy=c.y-g.ay; g.ax+=(c.x-g.ax)*0.6; g.ay+=(c.y-g.ay)*0.6; g.r+=(c.r-g.r)*0.4; g.v=c.v; g.miss=0; }
    else { g.miss++; }                                          // hold position briefly, never drift off on its own
    // the tag trails its anchor (leader line stretches, then catches up)
    const tx=Math.min(0.88,Math.max(0.04,g.ax+g.pdx)), ty=Math.min(0.9,Math.max(0.04,g.ay+g.pdy));
    g.tx+=(tx-g.tx)*0.3; g.ty+=(ty-g.ty)*0.3;
  }
  trk.tags=trk.tags.filter(g=>g.miss<=2&&t<g.end);
  if(!UI.tracker){ if(n0) trk.dirty=true; return; }
  // 2. acquire new structures (rate-limited; transients lock on immediately)
  const amt=P.tAmount*2;
  trk.spawnAcc+=dt*4.0*amt*(0.6+0.8*AU.f.energy) + (AU.onset>0.45?0.9*amt:0);   // short lives → faster turnover, hits lock on at once
  AU.onset=AU.onset>0.45?0.3:AU.onset;
  const maxTags=Math.round(1+3*amt);
  while(trk.spawnAcc>=1){
    trk.spawnAcc-=1;
    if(trk.tags.length>=maxTags) break;
    const free=trk.cands.filter((c,i)=>!claimed.has(i)&&trk.tags.every(g=>TD(g.ax,g.ay,c.x,c.y)>0.07));
    if(!free.length) break;
    const id=trk.nextId++, h=k=>hash1(id*13.37+k*7.13);
    const c=free[Math.floor(h(1)*Math.min(free.length,3))];
    const kind=h(3)<0.7?"both":(h(3)<0.9?"label":"tag");
    const side=c.x<trk.cx?-1:1;                                   // labels open away from the mass
    const pdx=(h(5)-0.5)*0.3, pdy=-(0.12+0.16*h(6));             // tag sits above its structure (measured ≈ −0.18 H)
    trk.tags.push({id, kind, ax:c.x, ay:c.y, vx:0, vy:0, r:c.r, v:c.v, miss:0, side, pdx, pdy,
      tx:Math.min(0.88,Math.max(0.04,c.x+pdx)), ty:Math.min(0.9,Math.max(0.04,c.y+pdy)),
      end:t+0.12+0.33*Math.pow(h(4),1.6), dot:h(9)<0.3, tw:0.075+0.035*h(10), ring:h(11)<0.15});
    claimed.add(trk.cands.indexOf(c));
  }
  trk.spawnAcc=Math.min(trk.spawnAcc,1.5);
  if(trk.tags.length||n0) trk.dirty=true;
}
function mirroredText(ctx,txt,x,y,mirror){
  if(!mirror){ ctx.fillText(txt,x,y); return; }
  const w=ctx.measureText(txt).width; ctx.save(); ctx.translate(x+w,y); ctx.scale(-1,1); ctx.fillText(txt,0,0); ctx.restore();
}
const css=c=>`rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
function drawTracker(){
  if(!trk.dirty) return; trk.dirty=false;
  const ctx=tctx, s=pxS(); ctx.clearRect(0,0,W,H);
  if(UI.tracker){
    const cT=css(UI.cTrk), cS=css(UI.cSec), cX=css(UI.cTxt);
    ctx.font=`bold ${Math.round(14*s)}px "Courier New",ui-monospace,monospace`; ctx.textBaseline="middle";
    for(const g of trk.tags){
      const lx=g.ax*W, ly=g.ay*H, tx=g.tx*W, ty=g.ty*H, tw=g.tw*Math.min(W,H), th=20*s;
      const txt=`X${String(Math.round(g.ax*(UI.land?192:108))).padStart(3,"0")}Y${String(Math.round(g.ay*(UI.land?108:192))).padStart(3,"0")}`;
      if(g.kind==="both"){
        ctx.strokeStyle=cT; ctx.globalAlpha=1; ctx.lineWidth=Math.max(1,1.4*s); ctx.setLineDash([6*s,6*s]);
        ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(tx+(g.dot?-6*s:tw*0.5),ty+th*0.5); ctx.stroke(); ctx.setLineDash([]);
      }
      if(g.kind!=="label"){                        // glowing tag: bright glyphs on a dimmer body (curves + glow bloom them)
        ctx.fillStyle=cS; ctx.globalAlpha=0.62; ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(tx,ty,tw,th,3*s); else ctx.rect(tx,ty,tw,th); ctx.fill();
        ctx.globalAlpha=1; ctx.fillStyle=cS;
        const f0=ctx.font; ctx.font=`bold ${Math.round(17*s)}px "Courier New",ui-monospace,monospace`;
        mirroredText(ctx,txt,tx+4*s,ty+th*0.54,UI.mirror); ctx.font=f0;
        if(g.dot){ ctx.beginPath(); ctx.arc(tx-8*s,ty+th*0.5,3.2*s,0,7); ctx.fill(); }
        if(g.ring){ ctx.strokeStyle=cT; ctx.globalAlpha=0.45; ctx.beginPath(); ctx.arc(tx+tw*0.3,ty-26*s,5*s,0,7); ctx.stroke(); ctx.globalAlpha=1; }
      }
      // lock: marker on the structure + thin corner brackets sized to it
      ctx.strokeStyle=cT; ctx.lineWidth=Math.max(1,s); const m=2.5*s;
      ctx.beginPath(); ctx.moveTo(lx-m,ly-m); ctx.lineTo(lx+m,ly+m); ctx.moveTo(lx+m,ly-m); ctx.lineTo(lx-m,ly+m); ctx.stroke();
      const R=Math.min(70*s,Math.max(12*s,g.r*W*1.2)), k=Math.min(7*s,R*0.4);
      ctx.globalAlpha=0.55; ctx.beginPath();
      for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){ ctx.moveTo(lx+sx*R,ly+sy*R-sy*k); ctx.lineTo(lx+sx*R,ly+sy*R); ctx.lineTo(lx+sx*R-sx*k,ly+sy*R); }
      ctx.stroke(); ctx.globalAlpha=1;
      if(g.kind!=="tag"){                          // outlined label beside the marker, on the side away from the mass
        const bw=ctx.measureText(txt).width+10*s, bh=18*s, bx=g.side>0?lx+R+5*s:lx-R-5*s-bw, by=ly-bh/2;
        ctx.fillStyle="rgba(0,0,0,0.78)"; ctx.fillRect(bx,by,bw,bh);
        ctx.strokeStyle=cT; ctx.globalAlpha=0.6; ctx.strokeRect(bx+0.5,by+0.5,bw-1,bh-1); ctx.globalAlpha=1;
        ctx.fillStyle=cX; mirroredText(ctx,txt,bx+5*s,ly+0.5*s,UI.mirror);
      }
    }
  }
  gl.bindTexture(gl.TEXTURE_2D,trkTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,trkCanvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
}
for(const [key,,def] of CONTROLS) P[key]=def;
UI.res=720; buildTargets();
AU.ctx={currentTime:0}; AU.startAt=0;
let acc=0, lastPair=-1, forceHeavy=true, outAcc=0, dirty=true;
return { canvas, P, UI, PALETTES,
  setA(A){ AU.A=A; AU.lastFi=-1; },
  analyze,
  touch(){ dirty=true; },
  setPalette(k){ UI.palette=k; buildPalette(k); dirty=true; },
  setRes(r){ if(UI.res===r) return; UI.res=r; buildTargets(); dirty=true; },
  setLand(on){ on=!!on; if(UI.land===on) return; UI.land=on; buildTargets(); dirty=true; },
  frame(t,dt,playing){
    dt=Math.min(0.1,Math.max(0,dt)); AU.playing=!!playing; AU.ctx.currentTime=t; AU.offset=t;
    analyse(dt); updateVisualState(dt);
    acc+=dt; let n=0;
    while(acc>=SIM_DT&&n<3){ acc-=SIM_DT; stepSim(); n++; }
    if(acc>SIM_DT*3) acc=0;
    const pair=sim.step>>1;
    if(pair!==lastPair||forceHeavy||dirty){ lastPair=pair; forceHeavy=false; renderHeavy(); }
    outAcc+=dt;
    if(outAcc>=1/OUT_FPS-0.002||dirty){ outAcc=Math.max(0,outAcc-1/OUT_FPS); outFrame++; renderFinal(); }
    dirty=false;
  } };
}

const VOLUME_DATA=(function(){
const DEF = {
  scale:0.91, shape:1.32, density:11400, detail:1.00,
  motion:1.67, flow:1.18,
  low:0.36, lowmid:1.45, mid:1.80, high:0.95, overall:1.62,
  bright:0.51, glow:0.82, contrast:1.00
};
const UI = {
  gForm:[['scale','Scale',0.6,1.3,0.01],['shape','Shape',0,2.5,0.01],['density','Density',3000,24000,100],['detail','Detail',0.4,2.0,0.01]],
  gMotion:[['motion','Motion',0,3,0.01],['flow','Flow',0,3,0.01]],
  gAudio:[['low','Low',0,2.5,0.01],['lowmid','Low-Mid',0,2.5,0.01],['mid','Mid',0,2.5,0.01],['high','High',0,2.5,0.01],['overall','Overall',0,2.5,0.01]],
  gLight:[['bright','Brightness',0,2.5,0.01],['glow','Glow',0,3,0.01],['contrast','Contrast',0.5,1.8,0.01]]
};
const LOOKS = [
  {id:'steel',  name:'Steel'},
  {id:'solar',  name:'Solar',  stops:[[245,191,65],[241,162,57],[237,112,45],[234,60,36],[228,42,30]],   pos:[0,.22,.48,.78,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.5, soft:.45},
  {id:'paper',  name:'Paper',  stops:[[203,203,203],[180,180,180],[128,128,128],[48,48,48],[4,4,4]],    pos:[0,.20,.45,.75,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.3, soft:.45},
  {id:'signal', name:'Signal', stops:[[4,19,141],[14,45,152],[70,155,190],[150,212,96],[206,253,92]],   pos:[0,.16,.48,.82,1], tone:[5.0,.7,.08,.95], grain:.6, glow:.5, soft:.28},
  {id:'rust',   name:'Rust',   stops:[[162,86,53],[142,73,49],[106,50,41],[44,17,20],[12,4,10]],        pos:[0,.22,.48,.78,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.3, soft:.45},
  {id:'dusk',   name:'Dusk',   stops:[[60,6,84],[108,22,97],[180,44,92],[222,112,84],[238,152,84]],     pos:[0,.22,.46,.74,1], tone:[3.7,.78,.0,1], grain:.05, glow:1.7, soft:.40}
];
return {DEF,UI,LOOKS};
})();

/* VOLUME OBJECT renderer, verbatim, wrapped as a factory: one instance per canvas.
   It was built on a live AnalyserNode; here the analyser is emulated from the decoded
   track at the shell's clock (same fftSize, Blackman window, no smoothing, dB scale),
   so previews, scrubbing and recording all see exactly the audio at time t. */
function makeVolume(cv){
'use strict';
let W = 1080, H = 1920;   // the frame; setSize() switches it to 1920 x 1080 for a landscape composition
const gl = cv.getContext('webgl2', {antialias:false, alpha:false, depth:true, preserveDrawingBuffer:true, premultipliedAlpha:false});
function fatal(msg){ throw new Error(msg); }
if(!gl) fatal('WebGL2 is required.');
const extCBF = gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');
const GPU_COMPUTE = !!extCBF;          // per-instance pass in a float render target; otherwise done in the vertex shader

/* ------------------------------- params ------------------------------- */
const DEF = {
  scale:0.91, shape:1.32, density:11400, detail:1.00,
  motion:1.67, flow:1.18,
  low:0.36, lowmid:1.45, mid:1.80, high:0.95, overall:1.62,
  bright:0.51, glow:0.82, contrast:1.00
};
const P = Object.assign({}, DEF);
const LOOKS = [
  {id:'steel',  name:'Steel'},
  {id:'solar',  name:'Solar',  stops:[[245,191,65],[241,162,57],[237,112,45],[234,60,36],[228,42,30]],   pos:[0,.22,.48,.78,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.5, soft:.45},
  {id:'paper',  name:'Paper',  stops:[[203,203,203],[180,180,180],[128,128,128],[48,48,48],[4,4,4]],    pos:[0,.20,.45,.75,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.3, soft:.45},
  {id:'signal', name:'Signal', stops:[[4,19,141],[14,45,152],[70,155,190],[150,212,96],[206,253,92]],   pos:[0,.16,.48,.82,1], tone:[5.0,.7,.08,.95], grain:.6, glow:.5, soft:.28},
  {id:'rust',   name:'Rust',   stops:[[162,86,53],[142,73,49],[106,50,41],[44,17,20],[12,4,10]],        pos:[0,.22,.48,.78,1], tone:[3.6,.8,.0,1], grain:.05, glow:1.3, soft:.45},
  {id:'dusk',   name:'Dusk',   stops:[[60,6,84],[108,22,97],[180,44,92],[222,112,84],[238,152,84]],     pos:[0,.22,.46,.74,1], tone:[3.7,.78,.0,1], grain:.05, glow:1.7, soft:.40}
];
let lookIdx = 0;
/* ------------------------------- GLSL ------------------------------- */
const NOISE = `
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
float mod289(float x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
float permute(float x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float taylorInvSqrt(float r){return 1.79284291400159-0.85373472095314*r;}
vec4 grad4(float j, vec4 ip){
  const vec4 ones=vec4(1.0,1.0,1.0,-1.0);
  vec4 p,s;
  p.xyz=floor(fract(vec3(j)*ip.xyz)*7.0)*ip.z-1.0;
  p.w=1.5-dot(abs(p.xyz),ones.xyz);
  s=vec4(lessThan(p,vec4(0.0)));
  p.xyz=p.xyz+(s.xyz*2.0-1.0)*s.www;
  return p;
}
float snoise(vec4 v){
  const vec4 C=vec4(0.138196601125011,0.276393202250021,0.414589803375032,-0.447213595499958);
  vec4 i=floor(v+dot(v,vec4(0.309016994374947451)));
  vec4 x0=v-i+dot(i,C.xxxx);
  vec4 i0;
  vec3 isX=step(x0.yzw,x0.xxx);
  vec3 isYZ=step(x0.zww,x0.yyz);
  i0.x=isX.x+isX.y+isX.z;
  i0.yzw=1.0-isX;
  i0.y+=isYZ.x+isYZ.y;
  i0.zw+=1.0-isYZ.xy;
  i0.z+=isYZ.z;
  i0.w+=1.0-isYZ.z;
  vec4 i3=clamp(i0,0.0,1.0);
  vec4 i2=clamp(i0-1.0,0.0,1.0);
  vec4 i1=clamp(i0-2.0,0.0,1.0);
  vec4 x1=x0-i1+C.xxxx;
  vec4 x2=x0-i2+C.yyyy;
  vec4 x3=x0-i3+C.zzzz;
  vec4 x4=x0+C.wwww;
  i=mod289(i);
  float j0=permute(permute(permute(permute(i.w)+i.z)+i.y)+i.x);
  vec4 j1=permute(permute(permute(permute(
       i.w+vec4(i1.w,i2.w,i3.w,1.0))
     +i.z+vec4(i1.z,i2.z,i3.z,1.0))
     +i.y+vec4(i1.y,i2.y,i3.y,1.0))
     +i.x+vec4(i1.x,i2.x,i3.x,1.0));
  vec4 ip=vec4(1.0/294.0,1.0/49.0,1.0/7.0,0.0);
  vec4 p0=grad4(j0,ip);
  vec4 p1=grad4(j1.x,ip);
  vec4 p2=grad4(j1.y,ip);
  vec4 p3=grad4(j1.z,ip);
  vec4 p4=grad4(j1.w,ip);
  vec4 nrm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nrm.x;p1*=nrm.y;p2*=nrm.z;p3*=nrm.w;
  p4*=taylorInvSqrt(dot(p4,p4));
  vec3 m0=max(0.6-vec3(dot(x0,x0),dot(x1,x1),dot(x2,x2)),0.0);
  vec2 m1=max(0.6-vec2(dot(x3,x3),dot(x4,x4)),0.0);
  m0=m0*m0; m1=m1*m1;
  return 49.0*(dot(m0*m0,vec3(dot(p0,x0),dot(p1,x1),dot(p2,x2)))+dot(m1*m1,vec2(dot(p3,x3),dot(p4,x4))));
}`;

/* The surface model, shared by the per-instance pass and the core mesh.
   Every term is a displacement along the base normal at one spatial scale. */
const SURFACE = `
uniform float uT0, uT1, uT2, uT3, uT4;   // evolution phases: idle, low, lowmid, mid, high
uniform vec4  uBand;                      // shaped band drives (already × per-band response × overall)
uniform float uShape, uMotion, uPresence;
uniform float uSpacing, uDetail, uRelief;

// REFERENCE FORM (static): two noise octaves frozen at the phase whose silhouette best matched the
// reference, plus a fitted angular correction (k=2..10) that locks the outline to it (≈3 px RMS).
float dForm(vec3 n){
  float d = 0.0576*snoise(vec4(n*1.05+vec3(0.0,1.9,0.0), 33.0))
          + 0.0240*snoise(vec4(n*2.10+vec3(5.2,1.3,-2.0), 48.55));
  // interior relief (camera-facing hemisphere only, so the fitted outline is untouched):
  // the broad dents that catch the top light in patches
  float face = smoothstep(0.12, 0.62, n.z);
  d += face*0.032*snoise(vec4(n*2.2+vec3(1.1,-6.2,3.7), uRelief));
  // angular correction extended as Re/Im((x+iy)^k): smooth everywhere, fades toward the view pole
  vec2 z1 = n.xy, zk = vec2(z1.x*z1.x-z1.y*z1.y, 2.0*z1.x*z1.y);  // k=2
  float c = 0.0;
  c += 0.00591*zk.x + (-0.01623)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += 0.00028*zk.x + (-0.00016)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += 0.00536*zk.x + (0.01890)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += 0.01545*zk.x + (-0.00696)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += -0.01434*zk.x + (0.00128)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += -0.00924*zk.x + (0.00640)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += -0.00136*zk.x + (-0.00837)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += 0.00014*zk.x + (-0.00421)*zk.y;  zk = vec2(zk.x*z1.x-zk.y*z1.y, zk.x*z1.y+zk.y*z1.x);
  c += 0.00218*zk.x + (0.00153)*zk.y;
  return d + c;
}
// IDLE EVOLUTION: slow surface breathing that never stops (amount = Motion, speed = Flow via uT0)
float dIdle(vec3 n){
  return uShape*dForm(n)
       + uMotion*( 0.022*snoise(vec4(n*1.55+vec3(9.1,-3.0,2.2), uT0*2.6+11.0))
                 + 0.009*snoise(vec4(n*2.80+vec3(-4.4,6.1,0.7), uT0*3.4+2.0)) );
}
// LOW → whole-body lobes (silhouette scale, ~2 lobes across)
float dLow(vec3 n){ return 0.135*snoise(vec4(n*0.90+vec3(1.7,-0.4,3.1), uT1)); }
// LOW-MID → medium bumps / curvature (~6 across)
float dLowMid(vec3 n){ return 0.036*snoise(vec4(n*2.9+vec3(3.3,7.0,-1.2), uT2)); }
// MID → ridged creases: folds in the surface topology (~12 across)
float dMid(vec3 n){
  float r = snoise(vec4(n*4.2+vec3(8.8,-2.4,5.5), uT3));
  return 0.015*(0.45 - 1.25*sqrt(r*r+0.04));
}
// HIGH → micro relief at spike scale
float dHigh(vec3 n){ return 0.0045*snoise(vec4(n*23.0, uT4)); }

// body = everything above spike scale; HIGH rides on top as radial micro-relief only
float dispBody(vec3 n){
  return dIdle(n) + uBand.x*dLow(n) + uBand.y*dLowMid(n) + uBand.z*dMid(n);
}
float disp(vec3 n){ return dispBody(n) + uBand.w*dHigh(n); }
vec3 surfP(vec3 n){ return n*(1.0+disp(n)); }
vec3 bodyP(vec3 n){ return n*(1.0+dispBody(n)); }
void basis(vec3 n, out vec3 t1, out vec3 t2){
  vec3 up = abs(n.y)<0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  t1 = normalize(cross(up,n)); t2 = cross(n,t1);
}
// body normal, sampled about one lattice spacing wide so spikes follow the form, not sub-spike noise
vec3 surfN(vec3 n, vec3 p0){
  vec3 t1,t2; basis(n,t1,t2);
  const float e = 0.03;
  p0 = bodyP(n);
  vec3 pa = bodyP(normalize(n+t1*e)), pb = bodyP(normalize(n+t2*e));
  vec3 nn = normalize(cross(pa-p0, pb-p0));
  return dot(nn,n)<0.0 ? -nn : nn;
}
vec3 vnoise3(vec3 q, float t){
  return vec3(snoise(vec4(q,t)), snoise(vec4(q+vec3(31.4,-7.7,12.1),t)), snoise(vec4(q+vec3(-19.3,23.9,-4.6),t)));
}
// per-spike state: base position, spike axis, length
void spikeState(vec3 n, out vec3 pos, out vec3 axis, out float len){
  pos = surfP(n);
  vec3 N = surfN(n,pos);
  // tangential combing field: small idle amount; MID adds structural combing, HIGH adds tip jitter
  vec3 comb = vnoise3(n*3.6+vec3(2.0), uT0*0.8+uT3*0.6);
  vec3 jit  = vnoise3(n*21.0, uT4*1.7);
  vec3 tilt = comb*(0.035*uMotion + 0.10*uBand.z) + jit*(0.09*uBand.w);
  tilt -= N*dot(tilt,N);
  axis = normalize(N + tilt);
  float lv = snoise(vec4(n*9.0+vec3(4.0), uT0*0.5));
  float hv = snoise(vec4(n*19.0-vec3(2.0), uT4*2.3));
  len = uSpacing*2.6*uDetail*(0.92+0.08*lv)*(0.86+0.20*uPresence)*(1.0+0.24*uBand.w*hv);
}`;

const COMPUTE_VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;
const COMPUTE_FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uBase; uniform int uCount; uniform int uTexW;
${NOISE}
${SURFACE}
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  int id = c.y*uTexW + c.x;
  if(id>=uCount){ o0=vec4(0.0); o1=vec4(0.0,1.0,0.0,0.0); return; }
  vec3 n = texelFetch(uBase,c,0).xyz;
  vec3 pos, axis; float len;
  spikeState(n,pos,axis,len);
  o0 = vec4(pos,len); o1 = vec4(axis,1.0);
}`;

/* camera / object uniforms shared by the two scene programs */
const SCENE_HEAD = `
uniform mat4 uVP; uniform vec3 uCam; uniform float uObjScale; uniform vec3 uObjOff;`;

const SPIKE_VS = `#version 300 es
precision highp float; precision highp int;
in vec3 aProf;   // cos, sin, t(0 base → 1 tip)
${SCENE_HEAD}
uniform highp sampler2D uI0; uniform highp sampler2D uI1; uniform highp sampler2D uBase; uniform int uTexW;
uniform float uR0;
${GPU_COMPUTE ? '' : NOISE + SURFACE}
out vec3 vW; out vec3 vN; out float vT; out vec3 vAx; out float vFace;
float prof(float t){ return sqrt(max(1.0-t*t*t*t,0.0))*(0.82+0.18*smoothstep(0.0,0.35,t)); }
void main(){
  ivec2 c = ivec2(gl_InstanceID % uTexW, gl_InstanceID / uTexW);
  vec3 pos, axis; float len;
#if ${GPU_COMPUTE?1:0}
  vec4 a=texelFetch(uI0,c,0), b=texelFetch(uI1,c,0);
  pos=a.xyz; len=a.w; axis=b.xyz;
#else
  spikeState(texelFetch(uBase,c,0).xyz,pos,axis,len);
#endif
  vec3 wp0 = pos*uObjScale+uObjOff;
  vec3 toCam = normalize(uCam-wp0);
  vFace = dot(axis,toCam);
  if(vFace < -0.42){ gl_Position=vec4(2.0,2.0,2.0,1.0); vW=vec3(0);vN=vec3(0);vT=0.0;vAx=vec3(0); return; }
  vec3 up = abs(axis.y)<0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 t1 = normalize(cross(up,axis)), t2 = cross(axis,t1);
  float t = aProf.z;
  vec3 rad = t1*aProf.x + t2*aProf.y;
  float r = uR0*prof(t);
  vec3 lp = pos + axis*(t*len - 0.6*uR0) + rad*r;
  float tt = min(t,0.985);
  float e_ = 1e-3;
  float drdz = uR0*(prof(min(tt+e_,1.0))-prof(tt))/e_/len;
  vec3 nrm = normalize(rad - axis*drdz);
  vW = lp*uObjScale+uObjOff; vN = nrm; vT = t; vAx = axis;
  gl_Position = uVP*vec4(vW,1.0);
}`;

const LIGHT = `
uniform float uGain, uRim, uEnergy;
const vec3 L1 = normalize(vec3(-0.86,-0.12,-0.50));   // key: from the left, behind the object
const vec3 L2 = normalize(vec3( 0.74, 0.46,-0.50));   // upper-right back light
const vec3 L3 = normalize(vec3(-0.28, 0.95, 0.12));   // soft overhead light
// N = micro normal (spike surface), A = macro normal (spike axis / body), t = height along spike (0 root → 1 tip)
vec3 shade(vec3 P, vec3 N, vec3 A, vec3 V, float t, float spec){
  // Spike BODIES light up only where the body faces a light (left key, upper-right back light) or
  // turns edge-on — there each spike reads as a lit loop (per-spike fresnel). Where the body faces
  // the camera the bodies stay black and only the rounded TIPS catch the soft overhead light,
  // so the lattice reads as dots, patchy with the surface relief.
  float nv = clamp(dot(N,V),0.0,1.0);
  float fr = pow(1.0-nv, 2.0);
  float av = dot(A,V);
  float e1 = smoothstep(-0.28, 0.62, dot(A,L1));
  float e2 = smoothstep(-0.06, 0.70, dot(A,L2));
  float eg = pow(clamp(1.0-abs(av),0.0,1.0), 3.0);
  float env = 1.8*e1 + 0.95*e2 + 0.5*eg*uRim;
  float occl = mix(0.15, 1.0, t);
  vec3 c = vec3(0.024*fr*env*env*occl);
  vec3 Ls[2] = vec3[2](L1,L2); float Is[2] = float[2](1.0,0.45);
  for(int i=0;i<2;i++){
    vec3 L=Ls[i];
    float vis = smoothstep(-0.05, 0.62, dot(A,L)) * mix(0.15, 1.0, t*t);
    vec3 Hh = normalize(L+V);
    c += Is[i]*vis*spec*(0.40*pow(max(dot(N,Hh),0.0), 60.0) + 0.010*max(dot(N,L),0.0));
  }
  // tips: soft overhead light, gated by the body's slope (patches) + a faint universal catch (dots)
  vec3 H3 = normalize(L3+V);
  float e3 = pow(max(dot(A,H3),0.0), 16.0);
  float tip = smoothstep(0.66, 0.95, t);
  float g3 = pow(max(dot(N,H3),0.0), 9.0);
  c += spec*tip*g3*(0.0060 + 0.060*e3);
  c *= mix(0.6,1.0,smoothstep(-1.0,0.6,P.z));               // far limb sinks
  return c*uGain;
}`;

const SPIKE_FS = `#version 300 es
precision highp float;
${SCENE_HEAD}
${LIGHT}
in vec3 vW; in vec3 vN; in float vT; in vec3 vAx; in float vFace;
out vec4 o;
void main(){
  vec3 V = normalize(uCam-vW);
  vec3 N = normalize(vN); if(dot(N,V)<0.0) N=-N;
  vec3 c = shade(vW,N,normalize(vAx),V,vT,1.0);
  o = vec4(c,1.0);
}`;

const CORE_VS = `#version 300 es
precision highp float;
in vec3 aN;
${SCENE_HEAD}
${NOISE}
${SURFACE}
out vec3 vW; out vec3 vN;
void main(){
  vec3 p = surfP(aN);
  vN = surfN(aN,p);
  vW = p*uObjScale + uObjOff;
  gl_Position = uVP*vec4(vW,1.0);
}`;
const CORE_FS = `#version 300 es
precision highp float;
${SCENE_HEAD}
${LIGHT}
uniform float uSil;
in vec3 vW; in vec3 vN; out vec4 o;
void main(){
  if(uSil>0.5){ o=vec4(4.0); return; }
  vec3 V=normalize(uCam-vW); vec3 N=normalize(vN);
  o = vec4(shade(vW,N,N,V,0.0,0.0)*0.5,1.0);
}`;

const FS_QUAD_VS = `#version 300 es
in vec2 aPos; out vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }`;
const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUV; out vec4 o;
void main(){
  vec3 c = texture(uSrc,vUV).rgb*0.2270270270;
  c += (texture(uSrc,vUV+uDir*1.3846153846).rgb+texture(uSrc,vUV-uDir*1.3846153846).rgb)*0.3162162162;
  c += (texture(uSrc,vUV+uDir*3.2307692308).rgb+texture(uSrc,vUV-uDir*3.2307692308).rgb)*0.0702702703;
  o = vec4(c,1.0);
}`;
const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uGlow, uHalo;
uniform float uExpo, uGlowAmt, uContrast; uniform vec2 uRes; uniform float uFrame;
uniform int uLook; uniform vec3 uStops[5]; uniform float uPos[5]; uniform vec4 uTone; uniform float uGrain, uSoft;
in vec2 vUV; out vec4 o;
vec3 gradMap(float t){
  vec3 c = uStops[0];
  for(int i=1;i<5;i++) c = mix(c, uStops[i], smoothstep(uPos[i-1], uPos[i], t));
  return c;
}
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+uFrame*0.618)*43758.5453); }
void main(){
  vec3 s = texture(uScene,vUV).rgb;
  vec3 g = texture(uGlow,vUV).rgb, hh = texture(uHalo,vUV).rgb;
  vec3 c = s*uExpo + (g*0.08 + hh*0.010)*uGlowAmt*uExpo;
  c = mix(c, g*uExpo*1.6, uSoft);                      // looks: soften spikes into a printed, bled mass
  c = c/(1.0+c*0.35);                               // soft shoulder
  float l = dot(c,vec3(0.3,0.5,0.2));
  l = pow(max(l,0.0), 1.0/2.2);                     // display
  const float pv = 0.16;
  l = pv*pow(l/pv, uContrast);
  if(uLook==0){
    // cool steel: shadows lean cyan, highlights neutralise
    vec3 tint = mix(vec3(0.74,0.94,1.0), vec3(0.90,0.98,1.0), smoothstep(0.05,0.45,l));
    c = l*tint/0.97;
    c += vec3(0.004);                               // studio black
  } else {
    // colour looks: the rendered luminance drives a gradient map (background = first stop)
    float t = pow(clamp(l*uTone.x,0.0,1.0), uTone.y);
    t = smoothstep(uTone.z, uTone.w, t);
    t = clamp(t + (h(gl_FragCoord.xy*1.37+3.1)-0.5)*uGrain*smoothstep(0.0,0.08,t), 0.0, 1.0);
    c = gradMap(t);
  }
  c += (h(gl_FragCoord.xy)-0.5)/255.0;
  o = vec4(clamp(c,0.0,1.0),1.0);
}`;
const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; in vec2 vUV; out vec4 o;
void main(){
  vec3 c = texture(uSrc,vUV+uTexel*vec2(-1,-1)).rgb + texture(uSrc,vUV+uTexel*vec2(1,-1)).rgb
         + texture(uSrc,vUV+uTexel*vec2(-1,1)).rgb + texture(uSrc,vUV+uTexel*vec2(1,1)).rgb;
  o = vec4(c*0.25,1.0);
}`;

function compile(vs, fs, name){
  const mk=(t,src)=>{ const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ const log=gl.getShaderInfoLog(s); console.error(name, log); fatal(name+': '+log); } return s; };
  const p=gl.createProgram(); gl.attachShader(p,mk(gl.VERTEX_SHADER,vs)); gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs));
  gl.bindAttribLocation(p,0,'aPos'); gl.bindAttribLocation(p,0,'aProf'); gl.bindAttribLocation(p,0,'aN');
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fatal(name+' link: '+gl.getProgramInfoLog(p));
  const u={}; const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){ const info=gl.getActiveUniform(p,i); u[info.name.replace(/\[0\]$/,'')]=gl.getUniformLocation(p,info.name); }
  return {p,u};
}
const progCompute = GPU_COMPUTE ? compile(COMPUTE_VS, COMPUTE_FS, 'compute') : null;
const progSpike = compile(SPIKE_VS, SPIKE_FS, 'spike');
const progCore  = compile(CORE_VS, CORE_FS, 'core');
const progBlur  = compile(FS_QUAD_VS, BLUR_FS, 'blur');
const progDown  = compile(FS_QUAD_VS, DOWN_FS, 'down');
const progComp  = compile(FS_QUAD_VS, COMP_FS, 'comp');

/* ------------------------------- geometry ------------------------------- */
const quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
{ const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); }

// spike: surface of revolution, rings denser toward the rounded tip
const SEG=12, RINGS=[0,0.16,0.32,0.47,0.6,0.71,0.8,0.87,0.925,0.965,0.99,1.0];
const spikeVAO = gl.createVertexArray(); let spikeIdxCount=0;
{
  gl.bindVertexArray(spikeVAO);
  const v=[], idx=[];
  for(let r=0;r<RINGS.length;r++) for(let s=0;s<SEG;s++){ const a=s/SEG*Math.PI*2; v.push(Math.cos(a),Math.sin(a),RINGS[r]); }
  for(let r=0;r<RINGS.length-1;r++) for(let s=0;s<SEG;s++){
    const a=r*SEG+s, b=r*SEG+(s+1)%SEG, c=(r+1)*SEG+s, d=(r+1)*SEG+(s+1)%SEG;
    idx.push(a,b,c, b,d,c);
  }
  const vb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vb); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const ib=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);
  spikeIdxCount=idx.length;
}
// core: subdivided icosphere (unit normals)
const coreVAO = gl.createVertexArray(); let coreIdxCount=0;
{
  const t=(1+Math.sqrt(5))/2;
  let verts=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(p=>{const l=Math.hypot(...p);return p.map(x=>x/l);});
  let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for(let it=0;it<6;it++){
    const cache=new Map(), nf=[];
    const mid=(a,b)=>{ const k=a<b?a+'_'+b:b+'_'+a; if(cache.has(k)) return cache.get(k);
      const p=verts[a].map((x,i)=>x+verts[b][i]); const l=Math.hypot(...p); verts.push(p.map(x=>x/l)); cache.set(k,verts.length-1); return verts.length-1; };
    for(const [a,b,c] of faces){ const ab=mid(a,b), bc=mid(b,c), ca=mid(c,a); nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]); }
    faces=nf;
  }
  gl.bindVertexArray(coreVAO);
  const vb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vb); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts.flat()),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const ib=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(faces.flat()),gl.STATIC_DRAW);
  coreIdxCount=faces.length*3;
}
gl.bindVertexArray(null);

/* ------------------------------- lattice ------------------------------- */
const TEXW=256;
let RELIEF=33.0;   // phase of the interior relief (chosen to match the reference's lit patches)
let count=0, texH=1, baseTex=null, iTex0=null, iTex1=null, computeFBO=null;
function mkTex(w,h,ifmt,fmt,type,filter,data=null){
  const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,h,0,fmt,type,data);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return t;
}
// fixed lattice orientation so the Fibonacci poles sit away from the view axis
const LROT = (()=>{ const ax=0.62, az=0.38; const cx=Math.cos(ax),sx=Math.sin(ax),cz=Math.cos(az),sz=Math.sin(az);
  return p=>{ let [x,y,z]=p; let y1=y*cx-z*sx, z1=y*sx+z*cx; return [x*cz-y1*sz, x*sz+y1*cz, z1]; }; })();
function rebuildLattice(){
  const N=Math.round(P.density);
  if(N===count && baseTex) return;
  count=N; texH=Math.ceil(N/TEXW);
  const d=new Float32Array(TEXW*texH*4);
  const ga=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<N;i++){
    const y=1-(i+0.5)/N*2, r=Math.sqrt(1-y*y), ph=i*ga;
    const q=LROT([Math.cos(ph)*r,y,Math.sin(ph)*r]);
    d.set([q[0],q[1],q[2],1],i*4);
  }
  for(const t of [baseTex,iTex0,iTex1]) if(t) gl.deleteTexture(t);
  baseTex=mkTex(TEXW,texH,gl.RGBA32F,gl.RGBA,gl.FLOAT,gl.NEAREST,d);
  if(GPU_COMPUTE){
    iTex0=mkTex(TEXW,texH,gl.RGBA32F,gl.RGBA,gl.FLOAT,gl.NEAREST);
    iTex1=mkTex(TEXW,texH,gl.RGBA32F,gl.RGBA,gl.FLOAT,gl.NEAREST);
    if(computeFBO) gl.deleteFramebuffer(computeFBO);
    computeFBO=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,computeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,iTex0,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,iTex1,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
}
rebuildLattice();

/* ------------------------------- render targets ------------------------------- */
const HDR = !!extCBF;
const colorIF = HDR ? gl.RGBA16F : gl.RGBA8, colorT = HDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
const SAMPLES = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
const msFBO = gl.createFramebuffer();
let msColor=null, msDepth=null, rtScene, rtD2, rtD4a, rtD4b, rtD16a, rtD8, rtD16b;
function mkTarget(w,h){ const t=mkTex(w,h,colorIF,gl.RGBA,colorT,gl.LINEAR); const f=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0); return {t,f,w,h}; }
// (re)allocate everything sized by the frame: the multisampled scene buffer and the glow chain
function buildSize(){
  gl.bindFramebuffer(gl.FRAMEBUFFER,msFBO);
  if(msColor) gl.deleteRenderbuffer(msColor); if(msDepth) gl.deleteRenderbuffer(msDepth);
  const c=msColor=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,c);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER,SAMPLES,colorIF,W,H);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,c);
  const d=msDepth=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,d);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER,SAMPLES,gl.DEPTH_COMPONENT24,W,H);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,d);
  for(const t of [rtScene,rtD2,rtD4a,rtD4b,rtD16a,rtD8,rtD16b]) if(t){ gl.deleteTexture(t.t); gl.deleteFramebuffer(t.f); }
  rtScene = mkTarget(W,H);
  rtD2 = mkTarget(W/2,H/2); rtD4a = mkTarget(W/4,H/4); rtD4b = mkTarget(W/4,H/4);
  rtD16a = mkTarget(W/16,H/16); rtD8 = mkTarget(W/8,H/8); rtD16b = mkTarget(W/16,H/16);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}
buildSize();

/* ------------------------------- camera (constant) ------------------------------- */
const FOV = 30*Math.PI/180, CAMZ = 9.60;
// the object sits slightly right of and below frame centre, as in the reference
const OBJ_OFF = [0.05895, -0.05273, 0.0];
// portrait: 30° vertical, as measured; landscape keeps the same field across its short side
let VP=null;
function buildVP(){ VP=(()=>{
  const a=W/H, f=1/Math.tan((W>H?2*Math.atan(Math.tan(FOV/2)*H/W):FOV)/2), n=0.1, fa=40;
  const Pm=[f/a,0,0,0, 0,f,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0];
  const Vm=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-CAMZ,1];
  const out=new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=Pm[k*4+r]*Vm[c*4+k]; out[c*4+r]=s; }
  return out;
})(); }
buildVP();
/* ----- analyser emulation (replaces the Web Audio graph) ----- */
let playing=false; const actx={sampleRate:44100}; let fData=new Float32Array(2048), tData=new Float32Array(4096);
const EM={pcm:null,sr:44100,t:0}, EN=4096, ERe=new Float32Array(EN), EIm=new Float32Array(EN), EWin=new Float32Array(EN), ERev=new Uint32Array(EN);
for(let i=0;i<EN;i++){ const a=i/EN; EWin[i]=0.42-0.5*Math.cos(2*Math.PI*a)+0.08*Math.cos(4*Math.PI*a); let r=0,x=i; for(let b=0;b<12;b++){ r=(r<<1)|(x&1); x>>=1; } ERev[i]=r; }
function emFill(){ const p=EM.pcm, end=Math.floor(EM.t*EM.sr); for(let i=0;i<EN;i++){ const k=end-EN+i; tData[i]=p&&k>=0&&k<p.length?p[k]:0; } }
const analyser={ fftSize:EN, frequencyBinCount:EN/2,
  getFloatTimeDomainData(a){ emFill(); },
  getFloatFrequencyData(a){ emFill();
    for(let i=0;i<EN;i++){ ERe[ERev[i]]=tData[i]*EWin[i]; EIm[ERev[i]]=0; }
    for(let s=2;s<=EN;s<<=1){ const h=s>>1, th=-2*Math.PI/s; for(let i=0;i<EN;i+=s) for(let j=0;j<h;j++){ const c=Math.cos(th*j), sn=Math.sin(th*j), a=i+j, b=a+h;
      const tr=ERe[b]*c-EIm[b]*sn, ti=ERe[b]*sn+EIm[b]*c; ERe[b]=ERe[a]-tr; EIm[b]=EIm[a]-ti; ERe[a]+=tr; EIm[a]+=ti; } }
    for(let k=0;k<EN/2;k++){ const m=Math.hypot(ERe[k],EIm[k])/EN; a[k]=20*Math.log10(m+1e-12); } } };
/* ----- analysis: band powers → shaped envelopes → springs ----- */
const BANDS = [ // [lo Hz, hi Hz, dB floor, dB ceil]
  [25,  140,  -48, -12],
  [140, 450,  -60, -22],
  [450, 2200, -64, -26],
  [2200,14000,-72, -30]
];
const env = {b:[0,0,0,0], e:0};
const spring = [0,0,0,0].map(()=>({x:0,v:0}));
const SPR = [ {w:2*Math.PI*3.2, z:0.62}, {w:2*Math.PI*4.5, z:0.70}, {w:2*Math.PI*6.5, z:0.75}, {w:2*Math.PI*11, z:0.85} ];
const ATK = [0.018,0.022,0.030,0.012], REL=[0.22,0.20,0.26,0.12];
let energyEnv=0, forced=null, lastTgt=[0,0,0,0,0]; const rawDb=[-120,-120,-120,-120,-120];
const clamp01=x=>x<0?0:x>1?1:x;
function analyse(dt){
  const tgt=[0,0,0,0]; let e=0;
  if(analyser && playing){
    analyser.getFloatFrequencyData(fData); analyser.getFloatTimeDomainData(tData);
    const binHz = actx.sampleRate/analyser.fftSize;
    for(let b=0;b<4;b++){
      const [lo,hi,fl,cl]=BANDS[b]; let s=0;
      for(let k=Math.max(1,Math.floor(lo/binHz)); k<=Math.min(fData.length-1,Math.ceil(hi/binHz)); k++) s+=Math.pow(10,fData[k]/10);
      const db = 10*Math.log10(s+1e-12);
      tgt[b] = clamp01((db-fl)/(cl-fl)); rawDb[b]=db;
    }
    let rms=0; for(let i=0;i<tData.length;i++) rms+=tData[i]*tData[i]; rms=Math.sqrt(rms/tData.length);
    rawDb[4]=20*Math.log10(rms+1e-9);
    e = clamp01((rawDb[4]+44)/38);
  }
  if(forced){ for(let b=0;b<4;b++) tgt[b]=forced.b[b]; e=forced.e; }
  lastTgt=[...tgt,e];
  for(let b=0;b<4;b++){
    const tau = tgt[b]>env.b[b]?ATK[b]:REL[b];
    env.b[b] += (tgt[b]-env.b[b])*(1-Math.exp(-dt/tau));
  }
  // loudness envelope: fast attack, controlled release
  const tauE = e>energyEnv?0.045:0.65;
  energyEnv += (e-energyEnv)*(1-Math.exp(-dt/tauE));
  // springs give the geometry mass (bass heavy & slow, highs light & quick)
  const sub=4, h=dt/sub;
  for(let b=0;b<4;b++){ const s=spring[b], {w,z}=SPR[b];
    for(let i=0;i<sub;i++){ const a=w*w*(env.b[b]-s.x)-2*z*w*s.v; s.v+=a*h; s.x+=s.v*h; } }
}
const pres={x:0,v:0};
function presenceStep(dt){ const w=2*Math.PI*2.4, z=0.92, sub=4, h=dt/sub;
  for(let i=0;i<sub;i++){ const a=w*w*(energyEnv-pres.x)-2*z*w*pres.v; pres.v+=a*h; pres.x+=pres.v*h; } }
/* ------------------------------- frame ------------------------------- */
const ph = {t0:0,t1:3.1,t2:7.3,t3:1.9,t4:5.5};
let last=performance.now(), frame=0;

function setCommon(prog){
  const u=prog.u;
  gl.uniformMatrix4fv(u.uVP,false,VP); gl.uniform3f(u.uCam,0,0,CAMZ);
  gl.uniform1f(u.uObjScale,P.scale); gl.uniform3fv(u.uObjOff,OBJ_OFF);
}
let lastBand=[0,0,0,0], lastPresence=0;
function setSurface(prog){
  const u=prog.u;
  gl.uniform1f(u.uT0,ph.t0); gl.uniform1f(u.uT1,ph.t1); gl.uniform1f(u.uT2,ph.t2); gl.uniform1f(u.uT3,ph.t3); gl.uniform1f(u.uT4,ph.t4);
  gl.uniform4fv(u.uBand,lastBand);
  gl.uniform1f(u.uShape,P.shape); gl.uniform1f(u.uMotion,P.motion); gl.uniform1f(u.uPresence,lastPresence);
  gl.uniform1f(u.uRelief,RELIEF); gl.uniform1f(u.uSpacing,Math.sqrt(8*Math.PI/(Math.sqrt(3)*count))); gl.uniform1f(u.uDetail,P.detail);
}
let lightGain=1, rimGain=1;
function setLight(prog){ const u=prog.u; gl.uniform1f(u.uGain,lightGain); gl.uniform1f(u.uRim,rimGain); gl.uniform1f(u.uEnergy,lastPresence); }

function render(dt){ update(dt); draw(); }
function update(dt){
  analyse(dt); presenceStep(dt);
  const ov=P.overall;
  const s=spring.map(o=>Math.max(0,o.x));
  // perceptual shaping per band
  lastBand=[ Math.pow(s[0],1.3)*P.low*ov, Math.pow(s[1],1.2)*P.lowmid*ov, Math.pow(s[2],1.15)*P.mid*ov, s[3]*P.high*ov ];
  const pr=clamp01(pres.x); lastPresence = pr;
  // evolution: every field keeps drifting when quiet; each band speeds up its own field
  {
    const f=P.flow;
    ph.t0 += dt*f*0.045*(1+0.6*pr);
    ph.t1 += dt*(0.018*f + 0.20*s[0]*P.low*ov);
    ph.t2 += dt*(0.030*f + 0.34*s[1]*P.lowmid*ov);
    ph.t3 += dt*(0.040*f + 0.55*s[2]*P.mid*ov);
    ph.t4 += dt*(0.25*f  + 2.6*s[3]*P.high*ov);
  }
  // light: silence sits dim but present; loud = brighter, edges defined
  const depth = Math.min(1.6, 0.4+0.6*ov);
  lightGain = P.bright*(0.34 + 1.50*pr*depth);
  rimGain = 1 + 1.4*pr*depth;

}
function draw(){
  const pr=lastPresence;
  // 1) per-instance pass
  if(GPU_COMPUTE){
    gl.bindFramebuffer(gl.FRAMEBUFFER,computeFBO); gl.viewport(0,0,TEXW,texH);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(progCompute.p); setSurface(progCompute);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,baseTex); gl.uniform1i(progCompute.u.uBase,0);
    gl.uniform1i(progCompute.u.uCount,count); gl.uniform1i(progCompute.u.uTexW,TEXW);
    gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // 2) scene
  gl.bindFramebuffer(gl.FRAMEBUFFER,msFBO); gl.viewport(0,0,W,H);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE);
  gl.useProgram(progCore.p); setCommon(progCore); setSurface(progCore); setLight(progCore);
  gl.bindVertexArray(coreVAO); gl.drawElements(gl.TRIANGLES,coreIdxCount,gl.UNSIGNED_INT,0);
  {
  gl.useProgram(progSpike.p); setCommon(progSpike); setLight(progSpike);
  if(!GPU_COMPUTE) setSurface(progSpike);
  const R0 = 0.36*Math.sqrt(8*Math.PI/(Math.sqrt(3)*count));
  gl.uniform1f(progSpike.u.uR0,R0); gl.uniform1i(progSpike.u.uTexW,TEXW);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,GPU_COMPUTE?iTex0:baseTex); gl.uniform1i(progSpike.u.uI0,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,GPU_COMPUTE?iTex1:baseTex); gl.uniform1i(progSpike.u.uI1,1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,baseTex); gl.uniform1i(progSpike.u.uBase,2);
  gl.bindVertexArray(spikeVAO); gl.drawElementsInstanced(gl.TRIANGLES,spikeIdxCount,gl.UNSIGNED_SHORT,0,count);
  }
  gl.disable(gl.DEPTH_TEST);
  // resolve
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,msFBO); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,rtScene.f);
  gl.blitFramebuffer(0,0,W,H,0,0,W,H,gl.COLOR_BUFFER_BIT,gl.NEAREST);
  // 3) glow chain: near glow (1/4 res) + restrained halo (1/16)
  gl.bindVertexArray(quadVAO);
  const down=(src,dst)=>{ gl.bindFramebuffer(gl.FRAMEBUFFER,dst.f); gl.viewport(0,0,dst.w,dst.h); gl.useProgram(progDown.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,src.t); gl.uniform1i(progDown.u.uSrc,0);
    gl.uniform2f(progDown.u.uTexel,0.5/src.w,0.5/src.h); gl.drawArrays(gl.TRIANGLES,0,3); };
  const blur=(src,dst,dx,dy)=>{ gl.bindFramebuffer(gl.FRAMEBUFFER,dst.f); gl.viewport(0,0,dst.w,dst.h); gl.useProgram(progBlur.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,src.t); gl.uniform1i(progBlur.u.uSrc,0);
    gl.uniform2f(progBlur.u.uDir,dx/src.w,dy/src.h); gl.drawArrays(gl.TRIANGLES,0,3); };
  down(rtScene,rtD2); down(rtD2,rtD4a);
  blur(rtD4a,rtD4b,1,0); blur(rtD4b,rtD4a,0,1);
  down(rtD4a,rtD8); down(rtD8,rtD16a);
  blur(rtD16a,rtD16b,1,0); blur(rtD16b,rtD16a,0,1); blur(rtD16a,rtD16b,1.6,0); blur(rtD16b,rtD16a,0,1.6);
  // 4) composite
  gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,W,H);
  gl.useProgram(progComp.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,rtScene.t); gl.uniform1i(progComp.u.uScene,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,rtD4a.t); gl.uniform1i(progComp.u.uGlow,1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,rtD16a.t); gl.uniform1i(progComp.u.uHalo,2);
  gl.uniform1f(progComp.u.uExpo,1.0);
  const LK=LOOKS[lookIdx];
  gl.uniform1f(progComp.u.uGlowAmt,P.glow*(0.55+0.6*pr)*(LK.glow||1));
  gl.uniform1i(progComp.u.uLook, LK.stops?1:0);
  if(LK.stops){
    gl.uniform3fv(progComp.u.uStops, new Float32Array(LK.stops.flat().map(v=>v/255)));
    gl.uniform1fv(progComp.u.uPos, new Float32Array(LK.pos));
    gl.uniform4fv(progComp.u.uTone, LK.tone); gl.uniform1f(progComp.u.uGrain, LK.grain);
  }
  gl.uniform1f(progComp.u.uSoft, LK.soft||0);
  gl.uniform1f(progComp.u.uContrast,P.contrast);
  gl.uniform1f(progComp.u.uFrame,frame%64);
  gl.drawArrays(gl.TRIANGLES,0,3);
  frame++;
}
return { canvas:cv, P, LOOKS, rebuildLattice,
  setAudio(pcm,sr){ EM.pcm=pcm; EM.sr=sr; actx.sampleRate=sr; },
  setLook(k){ const i=LOOKS.findIndex(l=>l.id===k); lookIdx=i<0?0:i; },
  setSize(w,h){ if(w===W&&h===H) return; W=w; H=h; cv.width=w; cv.height=h; buildSize(); buildVP(); },
  frame(t,dt,on){ playing=!!on; EM.t=t; render(Math.min(0.05,Math.max(0,dt))); } };
}


