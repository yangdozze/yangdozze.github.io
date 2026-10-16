/**
 * Deterministic offline video export for Beat Visual Studio v10.
 * Uses Mediabunny (MPL-2.0, https://mediabunny.dev) to mux WebCodecs frames.
 * Each rendered frame has an exact timestamp i/fps; render speed never changes video speed.
 * External library is loaded only when the user exports.
 */
const LIBRARY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.4/dist/bundles/mediabunny.min.mjs';

export async function exportFrameAccurate({
  audioBuffer, canvasWidth, canvasHeight, fps, start, duration,
  loopAudio, volume, renderAt, progress, cancelled
}) {
  if(!audioBuffer) throw Error('Для покадрового экспорта нужен WAV/MP3 с реальным звуком.');
  if(typeof VideoEncoder==='undefined'||typeof AudioEncoder==='undefined')
    throw Error('WebCodecs недоступен в этом браузере.');
  const {Output,Mp4OutputFormat,WebMOutputFormat,BufferTarget,CanvasSource,AudioBufferSource,Quality}
    = await import(LIBRARY);
  const rate=audioBuffer.sampleRate, channels=Math.min(2,audioBuffer.numberOfChannels);
  const videoBitrate=canvasWidth>=1000?11_000_000:5_500_000;
  const canVideo=async codec=>{
    try{return (await VideoEncoder.isConfigSupported({
      codec,width:canvasWidth,height:canvasHeight,bitrate:videoBitrate,framerate:fps
    })).supported;}catch{return false;}
  };
  const canAudio=async codec=>{
    try{return (await AudioEncoder.isConfigSupported({
      codec,sampleRate:rate,numberOfChannels:channels,bitrate:192000
    })).supported;}catch{return false;}
  };
  let format,ext,videoCodec,audioCodec;
  // VP9+Opus is a correct WebM fallback; never put VP9 inside a mislabeled .mp4.
  if(await canVideo('avc1.64002a')&&await canAudio('mp4a.40.2')){
    format=new Mp4OutputFormat();ext='mp4';videoCodec='avc';audioCodec='aac';
  } else if(await canVideo('vp09.00.10.08')&&await canAudio('opus')){
    format=new WebMOutputFormat();ext='webm';videoCodec='vp9';audioCodec='opus';
  } else if(await canVideo('vp8')&&await canAudio('opus')){
    format=new WebMOutputFormat();ext='webm';videoCodec='vp8';audioCodec='opus';
  }else {
    throw Error('Нет совместимого видеокодека и аудиокодека для покадрового экспорта.');
  }
  const outputCanvas=document.createElement('canvas');
  outputCanvas.width=canvasWidth; outputCanvas.height=canvasHeight;
  const outCtx=outputCanvas.getContext('2d',{alpha:false,desynchronized:false});
  const target=new BufferTarget();
  const output=new Output({format,target});
  const video=new CanvasSource(outputCanvas,{
    codec:videoCodec,quality:new Quality({bitrate:videoBitrate}),latencyMode:'quality'
  });
  const audio=new AudioBufferSource({codec:audioCodec,quality:new Quality({bitrate:192000})});
  output.addVideoTrack(video,{frameRate:fps});
  output.addAudioTrack(audio);
  let final=false;
  try{
    await output.start();
    if(cancelled())throw new DOMException('Операция отменена','AbortError');
    // Audio is generated from the decoded WAV/MP3 by sample index, never from wall-clock
    // playback. This prevents synchronization drift on heavily loaded devices.
    const samples=Math.round(duration*rate), startSample=Math.round(start*rate);
    const chunkSize=Math.max(1024,Math.round(rate*1.5));
    for(let from=0;from<samples;from+=chunkSize){
      if(cancelled())throw new DOMException('Операция отменена','AbortError');
      const len=Math.min(chunkSize,samples-from);
      const segment=new AudioBuffer({length:len,numberOfChannels:channels,sampleRate:rate});
      for(let ch=0;ch<channels;ch++){
        const dst=segment.getChannelData(ch),src=audioBuffer.getChannelData(ch);
        for(let i=0;i<len;i++){
          let ix=startSample+from+i;
          if(loopAudio) ix=(ix%audioBuffer.length+audioBuffer.length)%audioBuffer.length;
          dst[i]=ix>=0&&ix<src.length?src[ix]*volume:0;
        }
      }
      await audio.add(segment);
    }
    audio.close();
    const count=Math.round(duration*fps);
    if(count<1)throw Error('Нет кадров для экспорта');
    for(let i=0;i<count;i++){
      if(cancelled())throw new DOMException('Операция отменена','AbortError');
      const timestamp=i/fps;
      // Render sequentially: the Caustic simulation receives continuous deterministic times.
      renderAt(outCtx,start+timestamp);
      await video.add(timestamp,1/fps);
      if(i%4===0){
        progress(i/count);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    video.close();progress(1);
    if(cancelled())throw new DOMException('Операция отменена','AbortError');
    await output.finalize();final=true;
    return {blob:new Blob([target.buffer],{type:ext==='mp4'?'video/mp4':'video/webm'}),ext,frames:count};
  }finally{
    if(!final){try{await output.cancel();}catch{}}
  }
}
