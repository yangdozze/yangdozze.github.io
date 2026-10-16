/* Beat Visual Studio original STRIP/NIGHT in the same studio. */
window.BVS_CLASSICS_READY=Promise.all([import('./akira-scenes.js'),import('./midi.js')]).then(([scenes,midi])=>{
 const L=window.METHOD_LIBRARY;if(!L?.engines)throw Error('METHOD library missing');
 function make(id,draw,bg,ink,accent){
  return {id,num:id==='strip'?'B1':'B2',name:id.toUpperCase(),tag:'BVS / MIDI + AUDIO',
   looks:[{k:'default',label:'Original',bg,fg:ink,g:accent}],defaultLook:'default',
   params:[
    {k:'react',label:'Audio reaction',min:.1,max:3,def:1,tier:1},
    {k:'noteFocus',label:'Note window',min:12,max:36,def:15,int:true,tier:1},
    {k:'bpm',label:'BPM',min:40,max:240,def:120,int:true,tier:1},
    {k:'midiLoop',label:'MIDI loop',min:1,max:120,def:16,tier:1},
    {k:'loopMidi',label:'Loop MIDI',def:'on',choices:[{v:'on',label:'Repeat'},{v:'off',label:'Once'}]},
    {k:'title',label:'Title',def:'YOUR BEAT'},
    {k:'artist',label:'Artist',def:'YANGDOZZE'}
   ],
   create(){
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
    const ctx=canvas.getContext('2d',{alpha:false});
    const opt={react:1,noteFocus:15,bpm:120,midiLoop:16,loopMidi:'on',title:'YOUR BEAT',artist:'YANGDOZZE'};
    let audioDuration=0,peaks=null,notes=[],midiDuration=0,midiBpm=120,lastMidiName='';
    const inst={canvas,
      setAspect(a){if(a==='16:9'){canvas.width=1280;canvas.height=720}else{canvas.width=720;canvas.height=1280}},
      setAudio(pcm,sr){
        if(!pcm){audioDuration=0;peaks=null;return;}
        audioDuration=pcm.length/sr;const bins=1000;peaks=[];
        for(let b=0;b<bins;b++){
         const start=Math.floor(b*pcm.length/bins),end=Math.floor((b+1)*pcm.length/bins);let lo=0,hi=0;
         for(let i=start;i<end;i+=3){const v=pcm[i];if(v<lo)lo=v;if(v>hi)hi=v;}
         peaks.push({leftMin:lo,leftMax:hi,rightMin:lo,rightMax:hi});
        }
      },
      async useMidiFile(file){
        if(!file)return;
        const parsed=midi.parseMidi(await file.arrayBuffer());notes=parsed.notes;
        midiDuration=parsed.duration;midiBpm=parsed.bpm;lastMidiName=file.name;
        opt.bpm=Math.round(midiBpm);opt.midiLoop=Math.round(midiDuration*100)/100;
        inst._dirty=true;inst.watch?.();
      },
      set(k,v){opt[k]=v;inst._dirty=true;inst.watch?.()},
      setLook(){},
      frame(t,dt,playing){
        const data={notes,midiDuration,audioDuration,audioPeaks:peaks,audioLoop:false};
        const s={...opt,background:bg,ink,accent,labels:true,
          loopMidi:opt.loopMidi!=='off',bpm:Number(opt.bpm)||midiBpm||120,
          midiLoop:midiDuration||Number(opt.midiLoop)||16};
        draw(ctx,canvas.width,canvas.height,t,s,data,false);
      },
      get midiInfo(){return {name:lastMidiName,notes:notes.length,duration:midiDuration}}
    };
    return inst;
   }
  };
 }
 L.engines.push(
  make('strip',scenes.renderStrip,'#faf8f3','#27202e','#8a65cf'),
  make('night',scenes.renderNight,'#0d0d13','#eeddf9','#a66ff1')
 );
 return {added:2};
});
