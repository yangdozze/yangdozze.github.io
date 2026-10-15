// Standard MIDI File reader. All track events share a global tempo map.
export function parseMidi(input){
 const bytes=new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=0;
 const need=n=>{if(p+n>bytes.length)throw Error('MIDI обрезан или повреждён');};
 const u8=()=>{need(1);return bytes[p++];};const u16=()=>{need(2);let n=v.getUint16(p);p+=2;return n;};const u32=()=>{need(4);let n=v.getUint32(p);p+=4;return n;};const str=n=>{need(n);let s=String.fromCharCode(...bytes.subarray(p,p+n));p+=n;return s;};
 const vlq=()=>{let n=0;for(let i=0;i<4;i++){let b=u8();n=n*128+(b&127);if(!(b&128))return n;}throw Error('Некорректная MIDI длина');};
 if(str(4)!=='MThd')throw Error('Это не Standard MIDI File');let h=u32();if(h<6)throw Error('Некорректный заголовок MIDI');let format=u16(),tracks=u16(),division=u16();if(format>1)throw Error('MIDI Format 2 не поддерживается: сохрани как Format 0 или 1');if(division&32768||!division)throw Error('SMPTE MIDI не поддерживается: сохрани с PPQ');need(h-6);p+=h-6;
 let tempos=[{tick:0,us:500000,order:-1}],events=[],names=[],endTick=0,order=0;
 for(let tr=0;tr<tracks;tr++){
 if(str(4)!=='MTrk')throw Error('Не найдена MIDI дорожка');let len=u32(),end=p+len;need(len);let tick=0,running=0;
 while(p<end){tick+=vlq();let s=u8();if(s<128){if(!running)throw Error('Некорректный running status');p--;s=running;}else if(s<240)running=s;
 if(s===255){let type=u8(),n=vlq();if(p+n>end)throw Error('Некорректное MIDI событие');if(type===81&&n===3)tempos.push({tick,us:bytes[p]*65536+bytes[p+1]*256+bytes[p+2],order:order++});if(type===3)names[tr]=new TextDecoder().decode(bytes.subarray(p,p+n));p+=n;if(type===47)break;
 }else if(s===240||s===247){let n=vlq();if(p+n>end)throw Error('Некорректный SysEx');p+=n;running=0;
 }else if(s>=240)throw Error('Неподдерживаемое MIDI событие');
 else{let type=s>>4,ch=s&15,a=u8(),b=(type===12||type===13)?0:u8();if(a>127||b>127)throw Error('Некорректные MIDI данные');if([8,9,11].includes(type))events.push({tick,type,ch,a,b,tr,order:order++});}
 if(p>end)throw Error('MIDI событие выходит за дорожку');}
 endTick=Math.max(endTick,tick);p=end;
 }
 tempos.sort((a,b)=>a.tick-b.tick||a.order-b.order);let map=[];for(const t of tempos){if(!t.us)throw Error('Некорректный MIDI темп');if(map.length&&map.at(-1).tick===t.tick)map[map.length-1]=t;else map.push(t);}
 let seconds=0;map.forEach((m,i)=>{if(i)seconds+=(m.tick-map[i-1].tick)*map[i-1].us/division/1e6;m.seconds=seconds;});
 const toSec=t=>{let lo=0,hi=map.length-1;while(lo<hi){let mid=Math.ceil((lo+hi)/2);if(map[mid].tick<=t)lo=mid;else hi=mid-1;}let m=map[lo];return m.seconds+(t-m.tick)*m.us/division/1e6;};
 events.sort((a,b)=>a.tick-b.tick||a.order-b.order);const active=new Map(),held=new Map(),pedal=new Map(),notes=[];
 const finish=(n,t)=>{notes.push({...n,start:toSec(n.tick),end:toSec(Math.max(n.tick+1,t))});};
 for(const e of events){let channel=e.ch,key=e.tr+':'+channel+':'+e.a;if(e.type===9&&e.b){let q=active.get(key)||[];q.push({tick:e.tick,pitch:e.a,velocity:e.b/127,track:e.tr,channel});active.set(key,q);}else if(e.type===8||(e.type===9&&!e.b)){let q=active.get(key);if(q?.length){let n=q.shift();if(pedal.get(channel)){let a=held.get(channel)||[];a.push(n);held.set(channel,a);}else finish(n,e.tick);}}else if(e.type===11&&e.a===64){pedal.set(channel,e.b>=64);if(e.b<64){for(const n of held.get(channel)||[])finish(n,e.tick);held.delete(channel);}}else if(e.type===11&&[120,123].includes(e.a)){for(const [k,q]of active)if(k.split(':')[1]===String(channel)){q.forEach(n=>finish(n,e.tick));active.delete(k);}for(const n of held.get(channel)||[])finish(n,e.tick);held.delete(channel);}}
 for(const q of active.values())q.forEach(n=>finish(n,endTick));for(const q of held.values())q.forEach(n=>finish(n,endTick));notes.sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
 if(!notes.length)throw Error('В MIDI нет нот');return{notes,tempos:map,names,bpm:60e6/map[0].us,duration:Math.max(toSec(endTick),...notes.map(n=>n.end)),ppq:division,format};
}
export const mod=(n,m)=>((n%m)+m)%m;
export function activeNotes(notes,t,loop){return notes.filter(n=>{if(t<n.start)return false;let d=loop?mod(t-n.start,loop):t-n.start;return d>=0&&d<n.end-n.start;});}
export function filenameInfo(name){let bpm=name.match(/(?:^|[\s_\-(])(\d{2,3})(?:\s*bpm|(?=[\s_\-).]))/i);let key=name.match(/(?:^|[\s_\-(])([A-G](?:#|b)?)[\s_-]*(minor|major|min|maj|m)(?=$|[\s_\-).])/i);return{bpm:bpm&&+bpm[1]>=30&&+bpm[1]<=300?+bpm[1]:null,key:key?key[1]+' '+key[2]:null};}
export function demoMidi(){let notes=[];let seq=[57,60,64,69,64,60,55,59,62,67,62,59,53,57,60,65];for(let i=0;i<64;i++){let start=i*.25;notes.push({start,end:start+.19,pitch:seq[i%16],velocity:.65,track:0,channel:0});}for(let i=0;i<8;i++)for(let pitch of [33,45])notes.push({start:i*2,end:i*2+1.75,pitch:[0,0,-2,-2,-4,-4,-2,-2][i]+pitch,velocity:.7,track:1,channel:1});return{notes:notes.sort((a,b)=>a.start-b.start),duration:16,bpm:120,names:['Keys','Bass'],tempos:[],format:1};}

// Original, generated demonstration patterns. These do not redistribute third-party MIDI kits.
export function testMidi(kind='chords') {
 const notes=[],bpm=kind==='arp'?142:kind==='wide'?105:kind==='pluck'?156:120;
 const beat=60/bpm;let beats=32;
 const push=(pitch,start,duration,track=0,velocity=.8)=>notes.push({start:start*beat,end:(start+duration)*beat,pitch,track,velocity,channel:track});
 if(kind==='chords'){for(let bar=0;bar<8;bar++){const root=[45,41,48,43][bar%4];for(const offset of [0,7,12,16])push(root+offset,bar*4,3.45,0,.7);for(let i=0;i<4;i++)push(72+[0,3,5,7][(bar+i)%4],bar*4+i,0.52,1,.85);}}
 else if(kind==='pluck'){for(let i=0;i<64;i++){let root=[48,53,46,50][Math.floor(i/16)];push(root+[0,12,7,10,3,7,15,12][i%8],i*.5,.19,i%4===0?1:0,.55+.4*(i%3)/3);}for(let i=0;i<8;i++)push(36+(i%2)*2,i*4,1.65,2,.8);}
 else if(kind==='arp'){for(let i=0;i<128;i++){const arp=[0,7,12,19,16,12,7,3];push(49+arp[i%8],i*.25,.21,i%4===0?1:0,.65);}for(let i=0;i<16;i++)push(37+[0,3,7,5][Math.floor(i/4)%4],i*2,1.6,2,.9);}
 else if(kind==='wide'){for(let i=0;i<32;i++){push(32+[0,5,3,7][i%4],i,.7,0,.78);push(92+[0,-7,5,-12][i%4],i+.12,.35,1,.84);if(i%2===0)push(60+Math.round(i/2)%6,i,.86,2,.6);} }
 return{notes:notes.sort((a,b)=>a.start-b.start),duration:beats*beat,bpm,names:['Lead / chords','Counter','Bass'],tempos:[],format:1};
}
