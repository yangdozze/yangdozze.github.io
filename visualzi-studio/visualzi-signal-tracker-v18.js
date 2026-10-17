/* VISUALZI · Signal Tracker · real MIDI driven field visualization.
   An independent visual design inspired by tracking/motion-graphics aesthetics.
   Standard MIDI type 0/1 PPQ parser; no audio-to-MIDI guessing.
   Runs on the existing VISUALZI shell's canvas, audio clock, FX, grade and recorder. */
'use strict';
const VISUALZI_SIGNAL_MIDI = (() => {
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  function parse(source){
    const bytes=source instanceof Uint8Array?source:new Uint8Array(source);
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let off=0;
    function need(n){if(n<0||off+n>bytes.length)throw new Error('MIDI file is truncated');}
    function ascii(n){need(n);let v='';for(let i=0;i<n;i++)v+=String.fromCharCode(bytes[off++]);return v;}
    function u8(){need(1);return bytes[off++];}
    function u16(){need(2);const v=dv.getUint16(off,false);off+=2;return v;}
    function u32(){need(4);const v=dv.getUint32(off,false);off+=4;return v;}
    function vlq(end){let v=0;for(let i=0;i<4;i++){if(off>=end)throw new Error('Incomplete MIDI variable length');const c=u8();v=(v<<7)|(c&127);if(!(c&128))return v;}throw new Error('Bad MIDI variable length');}
    if(ascii(4)!=='MThd')throw new Error('This is not a Standard MIDI file');
    const hdrLen=u32();if(hdrLen<6||hdrLen>256)throw new Error('Invalid MIDI header');
    const type=u16(),tracks=u16(),division=u16();off+=hdrLen-6;
    if(type>1)throw new Error('Only MIDI format 0 and 1 are supported');
    if(division&0x8000)throw new Error('SMPTE-timed MIDI is not supported. Export with PPQ timing.');
    if(!division||!tracks||tracks>64)throw new Error('Invalid MIDI track count or timing');
    const tempo=[{tick:0,us:500000,serial:-1}];const notes=[];let serial=0,maxTick=0;
    for(let ti=0;ti<tracks;ti++){
      if(ascii(4)!=='MTrk')throw new Error('Invalid MIDI track chunk');
      const len=u32(), end=off+len; if(end>bytes.length)throw new Error('Truncated MIDI track');
      let tick=0,running=0,count=0;
      const active=new Map();
      const complete=(channel,pitch)=>{
        const key=channel*128+pitch,q=active.get(key);
        if(q&&q.length){const a=q.shift();notes.push({tick:a.tick,endTick:Math.max(tick,a.tick+1),pitch,velocity:a.velocity,channel,track:ti,serial:a.serial});}
      };
      while(off<end){
        tick+=vlq(end);maxTick=Math.max(maxTick,tick);if(++count>200000)throw new Error('Too many events in one MIDI track');
        let status=bytes[off];if(status&0x80){off++;if(status<0xf0)running=status;else running=0;}
        else {if(!running)throw new Error('Missing MIDI running status');status=running;}
        if(status===0xff){const meta=u8(),n=vlq(end);if(off+n>end)throw new Error('Truncated MIDI meta event');
          if(meta===0x51&&n===3){const us=(bytes[off]<<16)|(bytes[off+1]<<8)|bytes[off+2];if(us>0)tempo.push({tick,us,serial:serial++});}
          off+=n;if(meta===0x2f){off=end;break;}
        } else if(status===0xf0||status===0xf7){const n=vlq(end);if(off+n>end)throw new Error('Truncated sysex');off+=n;}
        else if(status>=0xf0){throw new Error('Unsupported MIDI system event');}
        else {const op=status>>4,ch=status&15;const a=u8(),b=(op===0xc||op===0xd)?0:u8();if(off>end)throw new Error('Truncated MIDI channel event');
          if(op===9&&b>0){const key=ch*128+a;if(!active.has(key))active.set(key,[]);active.get(key).push({tick,velocity:b/127,serial:serial++});}
          else if(op===8||(op===9&&b===0))complete(ch,a);
        }
      }
      // Some exports leave notes hanging: end at track boundary.
      for(const [key,q] of active)for(const a of q)notes.push({tick:a.tick,endTick:Math.max(tick,a.tick+1),pitch:key%128,velocity:a.velocity,channel:Math.floor(key/128),track:ti,serial:a.serial});
      off=end;
    }
    tempo.sort((a,b)=>a.tick-b.tick||a.serial-b.serial);
    let merged=[];for(const t of tempo){if(merged.length&&merged[merged.length-1].tick===t.tick)merged[merged.length-1]=t;else merged.push(t);}
    let seconds=0;for(let i=0;i<merged.length;i++){if(i)seconds+=(merged[i].tick-merged[i-1].tick)*merged[i-1].us/(division*1e6);merged[i].s=seconds;}
    const toSeconds=tick=>{let lo=0,hi=merged.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(merged[m].tick<=tick)lo=m;else hi=m-1;}const m=merged[lo];return m.s+(tick-m.tick)*m.us/(division*1e6);};
    const done=notes.slice(0,50000).map((n,i)=>({start:toSeconds(n.tick),end:toSeconds(n.endTick),pitch:n.pitch,velocity:n.velocity,track:n.track,channel:n.channel,id:i}));
    done.sort((a,b)=>a.start-b.start||a.pitch-b.pitch||a.id-b.id);
    const nonDrum=done.filter(n=>n.channel!==9);const pitched=nonDrum.length?nonDrum:done;
    const pitchLo=pitched.length?Math.min(...pitched.map(n=>n.pitch)):36;
    const pitchHi=pitched.length?Math.max(...pitched.map(n=>n.pitch)):84;
    return {notes:done,duration:Math.max(toSeconds(maxTick),...done.map(n=>n.end),0),bpm:Math.round(60e6/merged[0].us),tempoMap:merged,ppq:division,tracks,range:[pitchLo,pitchHi],type};
  }
  return {parse};
})();
const SignalTrackerAdapter = (() => {
  const C=(v,a,b)=>Math.max(a,Math.min(b,v));
  const H=(n)=>{let x=(n|0)>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return(x>>>0)/4294967296;};
  const demoNotes=(()=>{const notes=[];let id=0;const pitches=[48,60,64,67,72,67,64,60,53,65,69,72,76,72,69,65];for(let step=0;step<64;step++){
    const pitch=pitches[step%pitches.length];notes.push({start:step*.26,end:step*.26+.19,pitch,velocity:.65+H(step)*.35,track:step%4,channel:0,id:id++});
    if(step%4===0)notes.push({start:step*.26,end:step*.26+.8,pitch:pitch-12,velocity:.75,track:4,channel:1,id:id++});
  }return {notes,duration:16.6,bpm:116,tracks:5,range:[36,84]};})();
  const noteNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const labelFor=p=>noteNames[p%12]+(Math.floor(p/12)-1);
  function box(c,x,y,w,h){c.strokeRect(x,y,w,h);}
  function create(){
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
    const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
    const S={density:.80,scatter:.57,trail:1.4,links:.78,red:.70,contrast:.92,offset:0,ghost:.40,noise:.32};
    let look='paper',userData=null,userName='',pending=null,error='',lastAudio=null,hadAudio=false;
    const L={paper:{bg:'#e8e7e2',ink:'#171918',red:'#a6323c',muted:'#575854'},cream:{bg:'#efeadf',ink:'#292824',red:'#9f402b',muted:'#777169'},night:{bg:'#101417',ink:'#e4e6e0',red:'#ed6970',muted:'#9ba6ae'}};
    let palette=L.paper,preview=true,watch=()=>{};
    const fresh=()=>{inst._dirty=true;watch();};
    const isDemo=()=>!userData && !hadAudio;
    function setSize(aspect){const w=aspect==='16:9'?1920:1080,h=aspect==='16:9'?1080:1920;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;inst._dirty=true;}}
    // Pixel-field renderer.  All positions, lifetimes and capture targets are
    // deterministic functions of MIDI notes and audio time: seeking and export
    // produce the same pixels as realtime playback.
    let cachedPaper=null,cachedPaperKey='',sprites=new Map();
    const makeSurface=(width,height)=>{const cv=document.createElement('canvas');cv.width=width;cv.height=height;return cv;};
    function paper(){
      const key=look+"/"+Math.round(S.noise*100);
      if(cachedPaper&&key===cachedPaperKey)return cachedPaper;
      cachedPaperKey=key;
      const cv=makeSurface(512,910),g=cv.getContext('2d');
      g.fillStyle=palette.bg;g.fillRect(0,0,512,910);
      if(look==='night'){
        const shade=g.createRadialGradient(252,410,30,256,460,620);
        shade.addColorStop(0,'rgba(255,255,255,.065)');shade.addColorStop(1,'rgba(0,0,0,.43)');
        g.fillStyle=shade;g.fillRect(0,0,512,910);
      }else{
        const shade=g.createRadialGradient(256,400,70,256,445,590);
        shade.addColorStop(0,'rgba(255,255,255,.20)');shade.addColorStop(.64,'rgba(255,255,255,.04)');shade.addColorStop(1,'rgba(36,37,36,.22)');
        g.fillStyle=shade;g.fillRect(0,0,512,910);
      }
      // Original reference has faint horizontal scan texture and film grain.
      for(let yy=0;yy<910;yy+=2){g.globalAlpha=.008+S.noise*.052;g.fillStyle=look==='night'?'#ffffff':'#32312f';g.fillRect(0,yy,512,.55);}
      for(let j=0;j<3800;j++){
        const xx=Math.floor(H(j*17+97)*512),yy=Math.floor(H(j*41+13)*910);
        g.globalAlpha=(.007+H(j*53+2)*.045)*S.noise*2;
        g.fillStyle=look==='night'?'#ffffff':'#201f1e';g.fillRect(xx,yy,1,1);
      }
      g.globalAlpha=1;cachedPaper=cv;return cv;
    }
    function sprite(seed){
      const idx=(seed%72+72)%72;
      if(sprites.has(idx))return sprites.get(idx);
      const size=96, cv=makeSurface(size,size),cx=cv.getContext('2d'),cell=3;
      // Multiple offset Gaussian lobes produce dense pixelated smoke, not circles.
      const lobes=[];
      for(let j=0;j<5;j++)lobes.push({x:47+(H(idx*67+j*13)-.5)*30,y:48+(H(idx*113+j*31)-.5)*27,r:7+H(idx*43+j*17)*15,str: .65+H(idx*101+j*29)*1.1});
      for(let y=1;y<95;y+=cell)for(let x=1;x<95;x+=cell){
        let field=0;
        for(const b of lobes){let dx=x-b.x,dy=y-b.y;field+=b.str*Math.exp(-(dx*dx+dy*dy)/(2*b.r*b.r));}
        const grit=H(idx*8999+y*367+x*71);
        // Only scattered pixels survive in the outermost smoky halo.
        const strength=Math.max(0,Math.min(1,field*(.31+grit*.83)-.16));
        if(strength<.08)continue;
        cx.globalAlpha=Math.pow(strength,.72)*(.26+grit*.72);
        cx.fillStyle='#111110';
        const sz=grit>.82?4:3;
        cx.fillRect(x,y,sz,sz);
      }
      // The subtle broad defocused fringe is built once and cached per motif.
      const haze=makeSurface(96,96),hx=haze.getContext('2d');
      hx.filter='blur(5px)';hx.globalAlpha=.40;hx.drawImage(cv,0,0);hx.filter='none';
      const joined=makeSurface(96,96),jx=joined.getContext('2d');
      jx.drawImage(haze,0,0);jx.drawImage(cv,0,0);
      sprites.set(idx,joined);return joined;
    }
    const demos=[
      [0,1.25,.18,.18],[1.25,2.65,.34,.27],[2.65,4.30,.63,.53],
      [4.30,6.05,.55,.60],[6.05,8.23,.58,.59],[8.23,10.1,.53,.53],
      [10.1,12.15,.42,.69],[12.15,14.14,.40,.51],[14.14,17.2,.39,.65]
    ];
    function demoActivity(time){
      // Demo only: match the audiovisual *rhythm* of the supplied example.
      // When a user imports MIDI, the actual note events determine activity.
      const s=((time%18.9)+18.9)%18.9;
      if(s>14.1)return .8;
      if((s>=4.4&&s<6)||(s>=8.35&&s<10.02)||(s>=12.25&&s<14.12))return .045;
      return 1;
    }
    function anchorFor(n){
      const group=Math.floor(n.start/1.25),r1=H(group*41+17),r2=H(group*37+29);
      // Beat-level clusters can wander through the picture; pitch adds only a
      // small displacement, avoiding the piano-roll-like fixed-note lanes.
      let ax=85+r1*330,ay=165+r2*550;
      const demoCenters=[[.17,.18],[.31,.27],[.65,.53],[.56,.57],[.58,.59],[.51,.55],[.43,.67],[.45,.59],[.40,.65]];
      if(!userData){for(let i=0;i<demos.length;i++)if(n.start>=demos[i][0]&&n.start<demos[i][1]){
        ax=demoCenters[i][0]*512;ay=demoCenters[i][1]*910;break;
      }}
      const seed=n.id+17;
      const spreadX=(H(seed*71+9)-.5)*138;
      const spreadY=(H(seed*79+5)-.5)*160;
      const pitchShift=((n.pitch-62)/38)*26;
      return {x:C(ax+spreadX+pitchShift,24,482),y:C(ay+spreadY,80,806),group};
    }
    function notePulse(n,t){
      const age=t-n.start;
      if(age<-.25||age>3.5)return 0;
      if(age<0)return Math.max(0,.055*(1+age/.25));
      const length=C(n.end-n.start,.09,1.8);
      const attack=C(age/.095,0,1);
      const release=Math.exp(-Math.max(0,age-length*.45)/(.24+S.trail*.30));
      return C(attack*release,0,1)*(.42+.58*n.velocity);
    }
    function draw(t){
      const w=canvas.width,h=canvas.height,p=palette,c=ctx;
      const time=Math.max(0,(Number.isFinite(t)?t:0)+S.offset);
      const scale=Math.min(w/512,h/910),ox=(w-scale*512)/2,oy=(h-scale*910)/2;
      c.setTransform(1,0,0,1,0,0);c.fillStyle=p.bg;c.fillRect(0,0,w,h);
      c.save();c.translate(ox,oy);c.scale(scale,scale);c.beginPath();c.rect(0,0,512,910);c.clip();
      c.drawImage(paper(),0,0);
      const data=userData||(isDemo()?demoNotes:null);
      const quiet=isDemo()?demoActivity(time):1;
      const all=[];
      if(data){
        const notes=data.notes,start=time-2.8,end=time+.26;
        let lo=0,hi=notes.length;
        while(lo<hi){const m=(lo+hi)>>1;if(notes[m].start<start)lo=m+1;else hi=m;}
        for(let i=lo;i<notes.length&&notes[i].start<=end;i++){
          const n=notes[i],pulse=notePulse(n,time)*quiet;
          if(pulse<.009)continue;
          const a=anchorFor(n),age=time-n.start;
          const drift=C(age,0,1.9);
          all.push({...a,n,pulse,age,x:a.x+Math.sin(n.id*11+time*.7)*drift*3.0,y:a.y-drift*5});
          if(all.length>140)break;
        }
      }
      // Ghost field: pale drifting clusters even in gaps; they do not look
      // like permanent notes because their activation tracks musical phrases.
      const major=all.filter(q=>q.pulse>.16).sort((a,b)=>b.pulse-a.pulse);
      c.filter=look==='night'?'invert(1)':'none';
      const faded=all.filter(q=>q.pulse<=.16);
      for(let i=0;i<Math.min(105,faded.length);i++){
        const q=faded[i];c.globalAlpha=q.pulse*.49*(1+S.ghost);
        const diam=(18+H(q.n.id*3)*17)*(1+S.scatter*.55);
        c.drawImage(sprite(q.n.id+47),q.x-diam/2,q.y-diam/2,diam,diam);
      }
      // Wider pale debris and very short-lived light squares create space
      // around black clusters instead of rendering isolated circle outlines.
      const nPale=Math.min(230,major.length*22);
      for(let i=0;i<nPale;i++){
        const q=major[i%major.length],seed=q.n.id*193+i*71;
        const x=q.x+(H(seed*31)-.5)*(185+S.scatter*245);
        const y=q.y+(H(seed*29+5)-.5)*(225+S.scatter*270);
        const radius=6+H(seed+39)*32;
        c.globalAlpha=q.pulse*(.18+H(seed+9)*.24)*(.7+S.density);
        c.drawImage(sprite(seed+71),x-radius/2,y-radius/2,radius,radius);
      }
      const active=major.slice(0,50);
      for(let i=active.length-1;i>=0;i--){
        const q=active[i],seed=q.n.id+43;
        const intensity=q.pulse*(.65+S.contrast*.75);
        const diameter=(29+H(seed*21)*31)*(0.85+S.density*.60)*(0.82+q.pulse*.50);
        c.globalAlpha=Math.min(.95,intensity)*.92;
        c.drawImage(sprite(seed),q.x-diameter/2,q.y-diameter/2,diameter,diameter);
        // Dark core of pixel groups, focused at onset and smeared at release.
        if(q.pulse>.33){
          const core=diameter*(.42+H(seed*7)*.24);
          c.globalAlpha=C((q.pulse-.18)*1.17,0,.95);
          c.drawImage(sprite(seed+12),q.x-core/2+2,q.y-core/2,core,core);
        }
        // A MIDI event blooms into several irregular overlapping ink cells.
        // This produces the amorphous dark cloud visible in the reference.
        for(let b=0;b<5;b++){
          const ss=seed*41+b*211;
          const rr=diameter*(.21+.34*H(ss*3+1));
          const bx=q.x+(H(ss*7+19)-.5)*diameter*.95;
          const by=q.y+(H(ss*13+11)-.5)*diameter*.86;
          c.globalAlpha=C(q.pulse*(.23+.50*H(ss*13+71))*(.7+S.contrast*.5),0,.94);
          c.drawImage(sprite(ss+31),bx-rr/2,by-rr/2,rr,rr);
        }
      }
      c.globalAlpha=1;c.filter='none';
      // Technical object detection connects NEARBY blobs, rather than every
      // note.  This yields short ink-black webs only during stronger passages.
      const tracked=active.filter(q=>q.pulse>.30).slice(0,15);
      c.strokeStyle=p.ink;c.lineWidth=.8;c.globalAlpha=S.links*.86;
      for(let i=0;i<tracked.length;i++){
        const a=tracked[i];let hits=0;
        for(let j=i+1;j<tracked.length;j++){
          const b=tracked[j],dist=Math.hypot(a.x-b.x,a.y-b.y);
          if(dist<105&&dist>8&&hits++<3){
            c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
            c.fillStyle=p.ink;c.fillRect(a.x-1,a.y-1,2.3,2.3);
          }
        }
      }
      // Fine-grained local tracking links inside dark clouds. Their tiny
      // square anchors make the cloud look computer-detected, not connected
      // as a conventional music visualizer / piano roll.
      c.strokeStyle=p.ink;c.lineWidth=.65;c.globalAlpha=S.links*.62;
      for(const q of tracked.slice(0,9)){
        const seed=q.n.id*371;
        const x0=q.x+(H(seed+7)-.5)*18,y0=q.y+(H(seed+19)-.5)*17;
        c.beginPath();c.moveTo(x0,y0);
        for(let j=0;j<3;j++){
          const ax=q.x+(H(seed+j*31+11)-.5)*53;
          const ay=q.y+(H(seed+j*29+23)-.5)*54;
          c.lineTo(ax,ay);
        }
        c.stroke();c.fillStyle=p.ink;c.fillRect(x0-1,y0-1,2,2);
      }
      c.globalAlpha=1;
      // Capture rectangles are tracked on clusters/phrases and persist after
      // notes fade; they are not drawn separately around every note.
      const groups=new Map();
      for(const q of all){if(!groups.has(q.group))groups.set(q.group,[]);groups.get(q.group).push(q);}
      const regions=[];
      for(const [g,qs] of groups){
        if(qs.length===0)continue;
        const sx=qs.reduce((a,q)=>a+q.x*q.pulse,0),sy=qs.reduce((a,q)=>a+q.y*q.pulse,0),pulses=qs.reduce((a,q)=>a+q.pulse,0);
        const span=Math.max(35,Math.min(118,qs.length*6.5));
        regions.push({x:sx/Math.max(.01,pulses),y:sy/Math.max(.01,pulses),energy:pulses,span,g});
      }
      regions.sort((a,b)=>b.energy-a.energy);
      // The dominant target drives the reticle; in silence only empty dashed
      // boxes remain, as seen at 5s / 9s / 13s of the source reference.
      const main=regions[0]&&regions[0].energy>.26?regions[0]:null;
      if(main&&S.red>.02){
        const xx=Math.round(C(main.x,24,488))+.5,yy=Math.round(C(main.y,80,840))+.5;
        c.strokeStyle=p.red;c.globalAlpha=S.red*.70;c.lineWidth=.55;
        c.beginPath();c.moveTo(xx,0);c.lineTo(xx,910);c.moveTo(0,yy);c.lineTo(512,yy);c.stroke();
        c.globalAlpha=1;c.lineWidth=.9;
        const span=Math.max(29,Math.min(85,35+main.energy*9));
        c.strokeRect(xx-span*.5,yy-span*.55,span,span*1.07);
        c.fillStyle=p.red;c.fillRect(xx-span*.5,yy-span*.55-13,62,13);
        c.fillStyle='#ffffff';c.font='bold 7px monospace';c.fillText('LOCK 0x'+Math.floor(H(main.g*31+93)*65535).toString(16).toUpperCase().padStart(4,'0'),xx-span*.5+3,yy-span*.55-4);
      }
      c.strokeStyle=p.ink;c.lineWidth=.7;
      let rectangles=0;
      for(const r of regions.slice(main?1:0,7)){
        if(rectangles++>=4)break;
        const dim=32+H(r.g*9)*54;
        c.save();c.globalAlpha=.35+Math.min(.22,r.energy*.05);c.setLineDash([2,3]);
        c.strokeRect(C(r.x-dim/2,15,512-dim-15),C(r.y-dim*.75,80,910-dim-90),dim,dim*(.9+H(r.g*7)*.4));c.restore();
      }
      if(rectangles<3){
        // Stable watch regions during quiet passages.
        const seed=Math.floor(time/2.25);
        for(let j=rectangles;j<3;j++){
          const sw=35+H(seed*23+j*39)*52,sh=45+H(seed*29+j*43)*60;
          const x=50+H(seed*71+j*31)*365,y=210+H(seed*37+j*61)*525;
          c.save();c.globalAlpha=.48;c.setLineDash([2.2,2.4]);c.strokeRect(x,y,sw,sh);c.restore();
        }
      }
      // Sparse black tags read like computer-vision labels.
      if(tracked.length>2){
        c.font='bold 6px monospace';
        for(let i=1;i<Math.min(6,tracked.length);i+=2){
          const q=tracked[i],text='bx'+Math.floor(H(q.n.id*39)*4096).toString(16).padStart(3,'0');
          const bx=C(q.x+7,8,474),by=C(q.y-10,75,838);
          c.fillStyle=p.ink;c.globalAlpha=.92;c.fillRect(bx,by,29,9);
          c.fillStyle=p.bg;c.fillText(text,bx+2,by+6.6);
        }
      }
      c.globalAlpha=1;
      // Sparse micro-typography and marks use VISUALZI, not Akira branding.
      c.fillStyle=p.ink;c.textAlign='left';c.font='bold 7px monospace';
      c.fillText('TRACKING '+String(tracked.length).padStart(2,'0'),40,98);
      c.fillText('THRESH 0.23  MIN 3',40,110);
      c.textAlign='right';c.fillText(String(data?data.bpm:'---')+' BPM  /  '+(data?.notes.length||0)+' N',476,98);c.textAlign='left';
      c.font='bold 6px monospace';c.fillText('VISUALZI  /  SIGNAL FIELD',40,802);
      c.font='6px monospace';c.fillText((Math.floor(time/60)).toString().padStart(2,'0')+':'+Math.floor(time%60).toString().padStart(2,'0')+'.'+Math.floor((time%1)*100).toString().padStart(2,'0'),40,815);
      c.textAlign='right';c.fillText(userData?'MIDI SOURCE':'DEMO ENGINE',473,815);c.textAlign='left';
      if(!data){c.textAlign='center';c.font='bold 14px monospace';c.fillText('IMPORT MIDI NOTES',256,455);c.textAlign='left';}
      c.restore();
    }
    async function loadMidi(f){pending={name:f.name,status:'reading'};error='';fresh();
      try{if(f.size>16e6)throw new Error('MIDI file exceeds 16 MB');const parsed=VISUALZI_SIGNAL_MIDI.parse(await f.arrayBuffer());
        if(!parsed.notes.length)throw new Error('No note-on events were found');userData=parsed;userName=f.name;pending=null;fresh();}
      catch(e){pending=null;error=e.message||String(e);fresh();}
    }
    const inst={canvas,setAudio(p,sr){const isUser=typeof AudioEngine!=='undefined'&&AudioEngine.has&&AudioEngine.pcm===p;
        if(lastAudio&&isUser&&lastAudio!==p&&userData){userData=null;userName='';error='The track changed: please import the corresponding MIDI again.';}
        if(isUser)lastAudio=p;hadAudio=isUser;preview=!isUser;fresh();},
      frame(t){const source=userData||(isDemo()?demoNotes:null);draw(source&&isDemo()?(t%Math.max(1,source.duration)):t);},
      set(k,v){if(k in S){S[k]=Number(v);inst._dirty=true;}},setLook(k){look=k in L?k:'paper';palette=L[look];inst._dirty=true;},
      setAspect:setSize,setHQ(){},ready(){return Promise.resolve();},progress(){return null;},
      useMidiFile:loadMidi,midiFile(){return pending|| (userData?{name:userName,status:'ready',info:`${userData.notes.length} notes · ${userData.tracks} tracks · ${userData.bpm} BPM`}:error?{name:'MIDI',status:'error',msg:error}:null);},
      clearMidi(){userData=null;userName='';error='';fresh();},
      onChanged(fn){watch=fn;},isDemo,
    };
    return inst;
  }
  return {id:'tracker',num:'12',name:'Signal Tracker',short:'Tracker',tag:'MIDI Field',cost:'cpu',defaultLook:'paper',
    looks:[{k:'paper',label:'Paper',bg:'#efeee9',fg:'#171a1a',g:'#b3b0a9'},{k:'cream',label:'Warm',bg:'#efeadf',fg:'#292824',g:'#a9a295'},{k:'night',label:'Night',bg:'#101417',fg:'#eaeeee',g:'#636f78'}],
    params:[
      {k:'density',label:'Ink mass',min:.1,max:1,def:.80,tier:1,fmt:v=>Math.round(v*100)+'%'},
      {k:'scatter',label:'Field scatter',min:0,max:1,def:.57,tier:1,fmt:v=>Math.round(v*100)+'%'},
      {k:'trail',label:'Ink decay',min:.45,max:3.2,def:1.4,tier:1,fmt:v=>v.toFixed(1)+' s'},
      {k:'links',label:'Tracker links',min:0,max:1,def:.78,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'red',label:'Lock reticle',min:0,max:1,def:.70,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'contrast',label:'Ink contrast',min:0,max:1,def:.92,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'ghost',label:'Afterimages',min:0,max:1,def:.40,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'noise',label:'Film texture',min:0,max:1,def:.32,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'offset',label:'MIDI sync offset',min:-2,max:2,def:0,group:'Tracking',fmt:v=>(v>=0?'+':'')+v.toFixed(2)+' s',hint:'Align note events to the beat if audio has a leading gap'}
    ],
    panel(inst){
      const d=document.createDocumentFragment(),b=h('div',{class:'blk'}),lab=h('span',{class:'lab'},'MIDI NOTES'),
        line=h('div',{class:'midi-row'}),status=h('span',{class:'note'}),action=h('button',{class:'btn',onclick:()=>pickMidiFile(inst)},'Upload .mid');
      line.append(action);b.append(lab,line,status);d.append(b);
      d.append(h('div',{class:'blk'},h('p',{class:'note'},'Real MIDI drives every tracker point. Load your audio in Track above, then the corresponding .mid here. MIDI-only preview works, but recording needs audio.')));
      const update=()=>{const m=inst.midiFile();status.textContent=m?m.status==='ready'?m.name+' · '+m.info:m.status==='reading'?'Reading '+m.name+'…':m.msg:(inst.isDemo()?'Preview uses demo MIDI. Upload your file for actual notes.':'No MIDI loaded · upload a .mid file.');action.textContent=m&&m.status==='ready'?'Replace MIDI':'Upload .mid';};
      inst.onChanged(update);update();return d;
    },create};
})();