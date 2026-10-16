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
