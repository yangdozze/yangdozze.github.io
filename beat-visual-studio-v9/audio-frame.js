// Deterministic paused-frame analysis, used when seeking or saving a still.
export function spectrumFromPCM(samples){
 const n=samples.length;if(n!==2048)throw Error('FFT frame must contain 2048 samples');
 const re=new Float64Array(n),im=new Float64Array(n);
 for(let i=0;i<n;i++){let j=0,x=i;for(let b=0;b<11;b++){j=(j<<1)|(x&1);x>>=1;}re[j]=(samples[i]||0)*(.42-.5*Math.cos(2*Math.PI*i/(n-1))+.08*Math.cos(4*Math.PI*i/(n-1)));}
 for(let size=2;size<=n;size*=2){let half=size/2;for(let off=0;off<n;off+=size)for(let j=0;j<half;j++){let a=-2*Math.PI*j/size,c=Math.cos(a),s=Math.sin(a),tr=c*re[off+j+half]-s*im[off+j+half],ti=s*re[off+j+half]+c*im[off+j+half];re[off+j+half]=re[off+j]-tr;im[off+j+half]=im[off+j]-ti;re[off+j]+=tr;im[off+j]+=ti;}}
 return Uint8Array.from(re.slice(0,n/2),(_,i)=>Math.max(0,Math.min(255,(20*Math.log10(Math.max(1e-9,Math.hypot(re[i],im[i])/n))+100)/70*255)));
}
// PCM min/max buckets preserve transients while giving the entire decoded file a true waveform overview.
export function audioEnvelope(buffer,points=768){
 if(!buffer||!buffer.length||!buffer.numberOfChannels)return [];
 const left=buffer.getChannelData(0),right=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1));
 const count=Math.max(1,Math.min(Math.floor(points)||768,left.length)),out=new Array(count);
 for(let i=0;i<count;i++){
  const from=Math.floor(i*left.length/count),to=Math.max(from+1,Math.floor((i+1)*left.length/count));
  let leftMin=1,leftMax=-1,rightMin=1,rightMax=-1;
  for(let j=from;j<to;j++){
   const l=left[j]||0,r=right[j]||0;
   if(l<leftMin)leftMin=l;if(l>leftMax)leftMax=l;if(r<rightMin)rightMin=r;if(r>rightMax)rightMax=r;
  }
  out[i]={leftMin,leftMax,rightMin,rightMax};
 }
 return out;
}
export function audioFrame(buffer,time,loop=true){let wave=new Float32Array(2048),waveR=new Float32Array(2048);if(!buffer)return {wave,waveR,freq:new Uint8Array(1024),energy:0};let l=buffer.getChannelData(0),r=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1)),at=Math.floor(Math.max(0,time)*buffer.sampleRate),sum=0;
 for(let i=0;i<2048;i++){let p=at+i;if(loop)p%=l.length;if(p<l.length){wave[i]=l[p];waveR[i]=r[p];}sum+=wave[i]*wave[i];}return{wave,waveR,freq:spectrumFromPCM(wave),energy:Math.sqrt(sum/2048)};}
