'use strict';
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const fs=require('fs'),path=require('path');
const dir='method-parity-output';
fs.mkdirSync(dir,{recursive:true});
const urls=['https://method.hiveglobal.org/app/#/retro','https://wavedropstudio.ru/beat-visual-studio-v15-original/#/retro'];
const engines=['midi','retro','caustic','contour','dust','spatial','volume','dancer','grid','pads','scope'];
const w=270,h=480,frames=[],errors=[];
async function fillAudio(p){
 return p.evaluate(()=>{
  const sr=22050,N=sr*4,b=new AudioBuffer({length:N,numberOfChannels:1,sampleRate:sr}),pcm=b.getChannelData(0);
  for(let i=0;i<N;i++){const t=i/sr,k=t%.5;pcm[i]=Math.tanh(.68*Math.sin(2*Math.PI*70*t)*Math.exp(-k*16)+.18*Math.sin(2*Math.PI*440*t)+.1*Math.sin(2*Math.PI*1500*t))}
  AudioEngine.setBuffer(b,'PARITY-TEST.wav');AudioEngine.pause();
  return {n:AudioEngine.pcm?.length,sr:AudioEngine.sr};
 });
}
async function take(p,id,look,t){
 return p.evaluate(async opts=>{
  const E=ENG[opts.id];
  if(!E)throw Error('Engine not found: '+opts.id);
  App.view='ws';App.vid=opts.id;document.body.dataset.view='ws';
  const inst=instance(opts.id),vs=vsOf(opts.id);
  if(inst.setAspect)inst.setAspect('9:16');
  if(inst.setMode&&vs.mode)inst.setMode(vs.mode);
  inst.setLook?.(opts.look);
  for(const parm of E.params||[])inst.set?.(parm.k,vs.params[parm.k]);
  if(inst.ready){const pr=inst.ready();if(pr?.then)await Promise.race([pr,new Promise(resolve=>setTimeout(resolve,12000))])}
  if(inst.progress){for(let n=0;n<40&&inst.progress();n++)await new Promise(resolve=>setTimeout(resolve,400))}
  const began=performance.now();inst.frame(opts.t,1/30,true);const ms=performance.now()-began;
  const c=document.createElement('canvas');c.width=opts.w;c.height=opts.h;
  const g=c.getContext('2d',{alpha:false,willReadFrequently:true});g.fillStyle='#090909';g.fillRect(0,0,opts.w,opts.h);
  g.drawImage(inst.canvas,0,0,opts.w,opts.h);
  const d=g.getImageData(0,0,opts.w,opts.h).data;
  let bright=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>90)bright++;
  return {png:c.toDataURL('image/png').split(',')[1],ms:Math.round(ms),bright,progress:inst.progress?.()||null};
 },{id,look,t,w,h});
}
function pair(aBase,bBase){
 const a=PNG.sync.read(Buffer.from(aBase,'base64')),b=PNG.sync.read(Buffer.from(bBase,'base64'));
 const combined=new PNG({width:2*w,height:h}),n=w*h;
 let diff=0,changed=0;
 for(let i=0;i<n;i++){
  let delta=0;
  for(let ch=0;ch<4;ch++){
   const va=a.data[4*i+ch],vb=b.data[4*i+ch];
   const y=Math.floor(i/w),x=i%w,pa=4*(y*w*2+x),pb=4*(y*w*2+x+w);
   combined.data[pa+ch]=va;combined.data[pb+ch]=vb;
   if(ch<3){const e=Math.abs(va-vb);diff+=e;delta+=e}
  }
  if(delta>12)changed++;
 }
 const file=String(frames.length).padStart(4,'0')+'.png';
 fs.writeFileSync(path.join(dir,file),PNG.sync.write(combined));
 return {file,mae:diff/(n*3),changedPercent:100*changed/n};
}
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:850}}),pages=[];
  for(const url of urls){
   const p=await ctx.newPage();pages.push(p);
   p.on('pageerror',e=>errors.push({url,error:String(e).slice(0,250)}));
   const resp=await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
   await p.waitForFunction(()=>typeof AudioEngine==='object'&&typeof ENGINES!=='undefined',{timeout:30000});
   console.log('OPEN',url,resp?.status(),JSON.stringify(await fillAudio(p)));
  }
  for(const id of engines){
   const spec=await pages[0].evaluate(id=>{
    const e=ENG[id];return e?{name:e.name,defaultLook:e.defaultLook,looks:e.looks.map(x=>x.k)}:null;
   },id);
   if(!spec){errors.push({id,error:'Original engine missing'});continue}
   const looks=[spec.defaultLook,...spec.looks.filter(x=>x!==spec.defaultLook)];
   for(const look of looks){
    const times=look===spec.defaultLook?[.5,1.25]:[.75];
    for(const t of times){
     try{
      const a=await take(pages[0],id,look,t),b=await take(pages[1],id,look,t),result=pair(a.png,b.png);
      frames.push(Object.assign({id,name:spec.name,look,t,originalMs:a.ms,cloneMs:b.ms,originBright:a.bright,cloneBright:b.bright,originProgress:a.progress,cloneProgress:b.progress},result));
      console.log('FRAME',frames.length,id,look,t,'MAE',result.mae.toFixed(4),'DIFF',result.changedPercent.toFixed(4)+'%');
     }catch(e){errors.push({id,look,t,error:String(e?.stack||e).slice(0,650)});console.log('FRAME_ERROR',id,look,t,String(e).slice(0,300))}
    }
   }
  }
 }catch(e){errors.push({fatal:String(e?.stack||e).slice(0,1000)});console.log('FATAL',String(e))}
 finally{if(browser)await browser.close().catch(()=>{})}
 const report={generated:new Date().toISOString(),urls,description:'Original METHOD engine Canvas pixel parity at same audio PCM, time, and look. This does not test paid export/post-processing.',frames,errors};
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
 const lines=['# METHOD vs VISUALZI v15: pixel parity','Original source-engine canvas only; no auth/export/post parity claims.','',
 '| Engine | Look | Time | Original ms | Clone ms | Mean abs error | Changed pixels |',
 '|---|---|---:|---:|---:|---:|---:|'];
 for(const f of frames)lines.push('| '+f.id+' | '+f.look+' | '+f.t+' | '+f.originalMs+' | '+f.cloneMs+' | '+f.mae.toFixed(4)+' | '+f.changedPercent.toFixed(4)+'% |');
 lines.push('','Frames: '+frames.length,'Errors: '+errors.length);
 for(const e of errors)lines.push('- '+JSON.stringify(e));
 fs.writeFileSync(path.join(dir,'REPORT.md'),lines.join('\n'));
 console.log('QA_COMPLETE',frames.length,errors.length);
 if(!frames.length)process.exitCode=1;
})();