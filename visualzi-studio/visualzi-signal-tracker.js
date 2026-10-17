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
    const S={density:.48,scatter:.48,trail:1.9,links:.6,red:.78,contrast:.52,offset:0,ghost:.42,noise:.23};
    let look='paper',userData=null,userName='',pending=null,error='',lastAudio=null,hadAudio=false;
    const L={paper:{bg:'#efeee9',ink:'#16191a',red:'#a72c35',muted:'#55595a'},cream:{bg:'#efeadf',ink:'#292824',red:'#9f402b',muted:'#777169'},night:{bg:'#101417',ink:'#e4e6e0',red:'#ed6970',muted:'#9ba6ae'}};
    let palette=L.paper,preview=true,watch=()=>{};
    const fresh=()=>{inst._dirty=true;watch();};
    const isDemo=()=>!userData && !hadAudio;
    function setSize(aspect){const w=aspect==='16:9'?1920:1080,h=aspect==='16:9'?1080:1920;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;inst._dirty=true;}}
    function draw(t){
      const w=canvas.width,h=canvas.height;const k=w/1080,kh=h/1920;
      const data=userData||(isDemo()?demoNotes:null);
      const c=ctx,p=palette;
      c.setTransform(1,0,0,1,0,0);c.fillStyle=p.bg;c.fillRect(0,0,w,h);
      // Quiet warm stock with row guides; deterministic in all export frames.
      c.globalAlpha=1;for(let y=0;y<h;y+=Math.max(3,Math.round(6*k))){c.fillStyle=look==='night'?'rgba(250,250,250,.022)':'rgba(25,25,25,.022)';c.fillRect(0,y,w,Math.max(1,k*.6));}
      c.save();c.translate(w*.5,h*.49);c.scale(k,k);c.translate(-540,-940); // design in 1080×1880 logical space
      const time=(Number.isFinite(t)?t:0)+S.offset;
      const living=[];
      if(data){const notes=data.notes,windowStart=time-S.trail*1.7,windowEnd=time+.7;
        // binary first note; bound work for long projects
        let low=0,high=notes.length;while(low<high){let m=(low+high)>>1;if(notes[m].start<windowStart)low=m+1;else high=m;}
        for(let i=Math.max(0,low-12);i<notes.length&&notes[i].start<=windowEnd;i++){
          const n=notes[i],age=time-n.start;if(age<-.7||age>S.trail*1.7)continue;
          const env=age<0?S.ghost*.23*(1+age/.7):Math.exp(-Math.max(0,age-Math.min(1,n.end-n.start)*.38)/(S.trail*.43));
          if(env<.04)continue;
          // MIDI pitch chooses lane; onset timing and track choose longitudinal placement.
          const pitchNorm=(n.pitch-(data.range?.[0]??36))/Math.max(12,(data.range?.[1]??84)-(data.range?.[0]??36));
          const lane=C((n.track%5)/4,0,1);const seed=n.id+33;
          const x=150+780*(.27+pitchNorm*.46+S.scatter*(H(seed*19)-.5)*.84);
          const y=230+1340*(.12+.73*(1-pitchNorm)+S.scatter*(H(seed*7+19)-.5)*.30)+Math.sin(time*.44+seed)*S.scatter*10;
          living.push({n,x:C(x,80,1000),y:C(y,130,1770),env,age,seed,lane});
          if(living.length>=34)break;
        }
      }
      // Transparent smoky globs built from same MIDI note seed every frame; no random walk or drifting alignment.
      for(const q of living){const {n,x,y,env,seed,age}=q;const r=15+S.density*32+(n.end-n.start)*7;const dots=Math.round(8+S.density*30);c.save();
        for(let i=0;i<dots;i++){const spin=6.283185*H(seed*101+i*13),dist=Math.sqrt(H(seed*257+i*29))*(r+S.scatter*26)*(1+Math.max(0,age)*.1);
          const xx=x+Math.cos(spin)*dist,yy=y+Math.sin(spin)*dist,sz=(2+H(seed*37+i*11)*11)*(0.7+env*.4);
          c.globalAlpha=env*(.07+.36*H(seed*31+i*3))*(1+S.contrast*.9);c.fillStyle=p.ink;
          if(i%3===0)c.fillRect(xx,yy,sz*1.7,sz*.85);else{c.beginPath();c.arc(xx,yy,sz,0,Math.PI*2);c.fill();}
        }c.restore();
      }
      // Lines only connect simultaneously active notes and fade as notes finish.
      const active=living.filter(q=>q.age>=-.07&&q.age<=Math.max(.6,q.n.end-q.n.start+S.trail*.5)&&q.env>.2).slice(0,13);
      c.lineWidth=1.1;c.strokeStyle=p.ink;c.globalAlpha=.26*S.links;
      for(let i=0;i<active.length;i++)for(let j=i+1;j<Math.min(i+3,active.length);j++){
        const a=active[i],b=active[j];if(Math.hypot(a.x-b.x,a.y-b.y)>710)continue;
        c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
      c.globalAlpha=1;
      const target=active[0]||living.find(q=>q.age>=-.5)||null;
      const cx=target?target.x:540,cy=target?target.y:940;
      c.strokeStyle=p.red;c.lineWidth=.9;c.globalAlpha=S.red*.73;
      c.beginPath();c.moveTo(cx,85);c.lineTo(cx,1795);c.moveTo(75,cy);c.lineTo(1005,cy);c.stroke();c.globalAlpha=1;
      for(let i=0;i<Math.min(8,living.length);i++){
        const q=living[i],sz=32+S.density*55,highlight=q===target;
        c.save();c.strokeStyle=highlight?p.red:p.muted;c.setLineDash(highlight?[]:[3,5]);c.lineWidth=highlight?1.5:1.05;c.globalAlpha=q.env*(highlight?1:.55);
        box(c,q.x-sz*.5,q.y-sz*.5,sz,sz*(.6+H(q.seed*23)*.45));c.restore();
        if(highlight || (i<4&&i%2===0)){c.font='600 12px ui-monospace, Menlo, Consolas, monospace';c.fillStyle=highlight?p.red:p.ink;c.globalAlpha=C(q.env,.2,1);
          const label=(highlight?'LOCK ':'NOTE ')+labelFor(q.n.pitch);c.fillText(label,q.x-sz*.5,q.y-sz*.5-9);c.globalAlpha=1;}
      }
      // Tracking anchors and guide marks; minimal technical typography, legible in 9:16.
      c.fillStyle=p.ink;c.globalAlpha=.82;c.font='700 17px ui-monospace, Menlo, Consolas, monospace';c.fillText('SIGNAL TRACKER / 01',68,93);
      c.font='600 12px ui-monospace, Menlo, Consolas, monospace';c.fillText('MIDI EVENT MONITOR',68,113);
      c.textAlign='right';c.fillText((data?data.bpm:'---')+' BPM  /  '+String(data?data.notes.length:0).padStart(3,'0')+' NOTES',1008,93);c.textAlign='left';
      c.globalAlpha=.65;c.fillText(data?(userData?'MIDI SOURCE · ACTIVE':'PREVIEW MIDI · DEMO'):'MIDI SOURCE · WAITING',68,1780);
      c.textAlign='right';c.fillText('VISUALZI / '+String(Math.max(0,Math.floor(time/60))).padStart(2,'0')+':'+String(Math.max(0,Math.floor(time%60))).padStart(2,'0'),1008,1780);c.textAlign='left';c.globalAlpha=1;
      if(!data){c.fillStyle=p.ink;c.font='600 31px ui-monospace, Menlo, Consolas, monospace';c.textAlign='center';c.fillText('ADD YOUR .MID',540,895);c.globalAlpha=.65;c.font='18px ui-monospace, Menlo, Consolas, monospace';c.fillText('TO SHOW THE REAL NOTES',540,935);c.textAlign='left';c.globalAlpha=1;}
      c.restore();
      if(S.noise>0){c.save();c.globalAlpha=S.noise*.07;for(let i=0;i<100;i++){const x=H(i*123+7)*w,y=H(i*59+101)*h;c.fillStyle=p.ink;c.fillRect(x,y,Math.max(1,k),Math.max(1,k));}c.restore();}
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
      {k:'density',label:'Particle density',min:.1,max:1,def:.48,tier:1,fmt:v=>Math.round(v*100)+'%'},
      {k:'scatter',label:'Scatter',min:0,max:1,def:.48,tier:1,fmt:v=>Math.round(v*100)+'%'},
      {k:'trail',label:'Trail',min:.45,max:3.2,def:1.9,tier:1,fmt:v=>v.toFixed(1)+' s'},
      {k:'links',label:'Connections',min:0,max:1,def:.6,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'red',label:'Tracking lines',min:0,max:1,def:.78,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'contrast',label:'Ink contrast',min:0,max:1,def:.52,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'ghost',label:'Future hints',min:0,max:1,def:.42,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
      {k:'noise',label:'Film texture',min:0,max:1,def:.23,group:'Tracking',fmt:v=>Math.round(v*100)+'%'},
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