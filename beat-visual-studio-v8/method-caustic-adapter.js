/* METHOD / HiveGlobal — original CausticAdapter, copied from METHOD app by permission relayed by this project's owner. Keep attribution, and preserve original default parameters and render size. */
import {CAUSTIC} from './caustic-core.js?v=m20261016c';
const f2 = v => Number(v).toFixed(2);
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
    // Original connected-component tracking is unchanged. HUD is composited
    // at full output resolution rather than subpixel-size in the 540px raster.
    R.trk.draw=()=>{};
    const OBJ={U:CAUSTIC.U,IN:CAUSTIC.IN,DS:CAUSTIC.DS,TH:CAUSTIC.TH,TK:CAUSTIC.TK};
    return { canvas:c,
      getTrackerState(){return R.trk;},
      setAudio(p,r){ pcm=p; sr=r; R.clear(); },
      frame(t,dt){ if(pcm) R.render(ctx,W,H,t,pcm,sr,dt); },
      set(k,v){ const p=CausticAdapter.params.find(q=>q.k===k); OBJ[p.o][k]=v; if(p.o==='U') CAUSTIC.applyUser(); },
      setLook(k){ CAUSTIC.U.stage=k; },
      // landscape: the same CPU raster turned on its side (960 x 540); the analysis carries over
      setAspect(a){ const land=a==='16:9'; if((W>H)===land) return; const t=W; W=H; H=t; c.width=W; c.height=H;
        const old=R; R=new CAUSTIC.Ref(W,H); R.an=old.an; R.anPcm=old.anPcm; R.lastT=old.lastT; R.trk.draw=()=>{}; },
    };
  }
};
export {CausticAdapter};
