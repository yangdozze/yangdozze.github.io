/* Original, deterministic audio analysis for Beat Visual Studio.
   Pre-compute from decoded PCM; no reference-product code included.
   Times are absolute in seconds; preview/seek/export request the same features. */
const EPS=1e-9;
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const N=512, TARGET_SR=11025, HOP=256;
function fftPower(input){
 const re=new Float64Array(N),im=new Float64Array(N);
 for(let i=0;i<N;i++){let j=0,v=i;for(let k=0;k<9;k++){j=(j<<1)|(v&1);v>>=1;}re[j]=input[i]*(.5-.5*Math.cos(2*Math.PI*i/(N-1)));}
 for(let size=2;size<=N;size*=2){const half=size>>1;for(let b=0;b<N;b+=size)for(let k=0;k<half;k++){
 const a=-2*Math.PI*k/size,cr=Math.cos(a),sr=Math.sin(a),p=b+k,q=p+half;
 const tr=cr*re[q]-sr*im[q],ti=sr*re[q]+cr*im[q],rr=re[p],ii=im[p];
 re[p]=rr+tr;im[p]=ii+ti;re[q]=rr-tr;im[q]=ii-ti;
 }}
 const spectrum=new Float32Array(N/2);for(let i=0;i<spectrum.length;i++)spectrum[i]=Math.hypot(re[i],im[i]);return spectrum;
}
function pctl(x,q){if(!x.length)return 1;let v=Array.from(x).sort((a,b)=>a-b);return Math.max(EPS,v[Math.floor((v.length-1)*q)]||0);}
export function analysePCM(buffer){
 if(!buffer||!buffer.numberOfChannels||!buffer.length||!buffer.sampleRate)return null;
 const src=buffer.getChannelData(0),alt=buffer.numberOfChannels>1?buffer.getChannelData(1):src;
 const hopIn=buffer.sampleRate/TARGET_SR,frameCount=Math.max(1,Math.ceil((src.length/buffer.sampleRate)*TARGET_SR/HOP));
 // Cap analysis length at 180 seconds (the site's maximum export duration).
 const frames=Math.min(frameCount,Math.ceil(180*TARGET_SR/HOP)),energy=new Float32Array(frames),bass=new Float32Array(frames),mid=new Float32Array(frames),high=new Float32Array(frames),onset=new Float32Array(frames),kick=new Float32Array(frames),snare=new Float32Array(frames),hat=new Float32Array(frames);
 const input=new Float32Array(N);let prevB=0,prevM=0,prevH=0,avgFlux=1e-5,prevKick=-100,prevSnare=-100,prevHat=-100;
 for(let f=0;f<frames;f++){
  const center=f*HOP*hopIn;let rms=0;
  for(let i=0;i<N;i++){
   const pos=Math.round(center+(i-N/2)*hopIn),a=pos>=0&&pos<src.length?(src[pos]+alt[pos])*.5:0;
   input[i]=a;rms+=a*a;
  }
  energy[f]=Math.sqrt(rms/N);
  const mag=fftPower(input);let b=0,m=0,h=0;
  for(let i=1;i<mag.length;i++){
   const hz=i*TARGET_SR/N,v=mag[i];
   if(hz<190)b+=v*v;else if(hz<2000)m+=v*v;else h+=v*v;
  }
  bass[f]=Math.sqrt(b);mid[f]=Math.sqrt(m);high[f]=Math.sqrt(h);
  const db=Math.max(0,bass[f]-prevB),dm=Math.max(0,mid[f]-prevM),dh=Math.max(0,high[f]-prevH);
  // Use relative spectral rise, rather than absolute volume, so the same
  // rhythmic events are found in quiet and loud mixes alike.
  const flux=db/(bass[f]+EPS)*.55+dm/(mid[f]+EPS)*.30+dh/(high[f]+EPS)*.15;
  avgFlux=avgFlux*.965+flux*.035;
  onset[f]=flux>avgFlux*1.5+.10?clamp((flux-avgFlux)*2):0;
  if(db>prevB*.20&&db>EPS&&f-prevKick>5){kick[f]=db/(bass[f]+EPS);prevKick=f;}
  if(dm>prevM*.25&&dm>EPS&&f-prevSnare>5){snare[f]=dm/(mid[f]+EPS);prevSnare=f;}
  if(dh>prevH*.28&&dh>EPS&&f-prevHat>3){hat[f]=dh/(high[f]+EPS);prevHat=f;}
  prevB=bass[f];prevM=mid[f];prevH=high[f];
 }
 const ref={energy:pctl(energy,.95),bass:pctl(bass,.95),mid:pctl(mid,.95),high:pctl(high,.95),kick:pctl(kick,.98),snare:pctl(snare,.98),hat:pctl(hat,.98)};
 for(let f=0;f<frames;f++){
  energy[f]=clamp(energy[f]/ref.energy);bass[f]=clamp(bass[f]/ref.bass);mid[f]=clamp(mid[f]/ref.mid);high[f]=clamp(high[f]/ref.high);
  kick[f]=clamp(kick[f]/ref.kick);snare[f]=clamp(snare[f]/ref.snare);hat[f]=clamp(hat[f]/ref.hat);
 }
 return {fps:TARGET_SR/HOP,duration:buffer.duration||src.length/buffer.sampleRate,frames,energy,bass,mid,high,kick,snare,hat,onset};
}
export function featureAt(profile,t,loop=true){
 const zero={energy:0,bass:0,mid:0,high:0,kick:0,snare:0,hat:0,onset:0};
 if(!profile||!Number.isFinite(t)||t<0)return zero;
 const duration=profile.duration;
 if(t>=duration&&!loop)return zero;
 const time=loop&&duration>0?((t%duration)+duration)%duration:t;
 let a=Math.min(profile.frames-1,Math.floor(time*profile.fps)),b=Math.min(profile.frames-1,a+1),v=clamp(time*profile.fps-a);
 const out={};for(const key of Object.keys(zero))out[key]=lerp(profile[key][a],profile[key][b],v);
 // A causal release envelope makes an actual transient visibly persist for
 // ~180 ms, independent of the display FPS or frame stepping direction.
 for(const key of ['kick','snare','hat','onset']){
  let held=out[key];for(let lag=1;lag<=8;lag++){const i=a-lag;if(i<0)break;
   const delta=(lag+v)/profile.fps;const falloff=Math.exp(-delta/(key==='hat'?.070:.100));
   held=Math.max(held,profile[key][i]*falloff);
  }out[key]=held;
 }
 return out;
}
