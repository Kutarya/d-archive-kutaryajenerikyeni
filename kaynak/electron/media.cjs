const fs=require('node:fs/promises');
const path=require('node:path');
const {run}=require('./process.cjs');

function parseYouTube(input) {
  let url;const value=String(input).trim(),normalized=/^(?:(?:www\.|m\.|music\.)?youtube\.com\/|youtu\.be\/)/iu.test(value)?'https://'+value:value;try{url=new URL(normalized);}catch{throw new Error('Bir YouTube video bağlantısı yazın.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Geçerli bir YouTube video bağlantısı kullanın.');
  const host=url.hostname.toLowerCase();let id;
  if(host==='youtu.be')id=url.pathname.split('/')[1];
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
    if(url.pathname==='/watch')id=url.searchParams.get('v');
    else id=url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/)?$/)?.[1];
  }
  if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw new Error('Arama/kanal/oynatma listesi yerine video bağlantısı kullanın.');
  return {id,url:`https://www.youtube.com/watch?v=${id}`};
}
const number=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
function outputName(value='Jenerikli video') {
  const name=String(value).trim().replace(/\.mp4$/iu,'');
  if(!name||name.length>100||/[<>:"/\\|?*\u0000-\u001f]/u.test(name)||/[. ]$/u.test(name)||['.','..'].includes(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name)) {
    const error=new Error('Video adı 1–100 karakter olmalı; \\ / : * ? " < > | karakterlerini ve Windows özel adlarını kullanmayın.');error.field='output-name';throw error;
  }
  return name;
}
function validateSettings(raw={}) {
  const text=String(raw.text||'').trim();
  if(text.length>20000)throw new Error('Metin çok uzun; bu jeneriği birkaç parçaya ayırın.');
  const voice=String(raw.voice||'tr-TR-EmelNeural');
  if(!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(voice)&&!/^sapi:[^\r\n\u0000]{1,150}$/.test(voice))throw new Error('Seslendirme kişisini listeden seçin.');
  return {text,voice,rate:Math.round(number(raw.rate,-50,50,0)),pitch:Math.round(number(raw.pitch,-30,30,0)),
    fade:number(raw.fade,0,3,1),voiceGain:number(raw.voiceGain,-12,12,3.7),songGain:number(raw.songGain,-12,6,0),bgGain:number(raw.bgGain,-36,0,-5),
    cutMode:raw.cutMode==='manual'?'manual':'half',cutSecond:number(raw.cutSecond,0,86400,0),
    speechMode:raw.speechMode==='file'?'file':'text',songPath:typeof raw.songPath==='string'?raw.songPath:'',speechPath:typeof raw.speechPath==='string'?raw.speechPath:'',
    bgPath:typeof raw.bgPath==='string'?raw.bgPath:'',backgroundEnabled:raw.backgroundEnabled===true,alsoMp3:raw.alsoMp3===true,
    outputName:outputName(raw.outputName??'Jenerikli video'),songSource:raw.songSource==='local'||(!raw.songSource&&raw.songPath)?'local':'youtube',songUrl:String(raw.songUrl||raw.urls||'').slice(0,2000),
    outputHeight:[720,1080].includes(Number(raw.outputHeight))?Number(raw.outputHeight):1080};
}
async function probe(file,vendor,signal) {
  const stat=await fs.stat(file);if(!stat.isFile()||!stat.size)throw new Error('Medya dosyası boş veya bulunamadı.');
  const result=await run(path.join(vendor,'ffprobe.exe'),['-v','error','-show_format','-show_streams','-of','json',file],{signal,timeout:45000});
  let data;try{data=JSON.parse(result.stdout);}catch{throw new Error('Medya bilgisi okunamadı.');}
  const video=data.streams?.find(s=>s.codec_type==='video'&&!(s.disposition?.attached_pic));
  const audio=data.streams?.find(s=>s.codec_type==='audio');
  const duration=Number(data.format?.duration||video?.duration||audio?.duration);
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Bu dosyanın süresi okunamıyor.');
  return {duration,hasVideo:!!video,hasAudio:!!audio,width:video?.width||0,height:video?.height||0,size:stat.size,videoCodec:video?.codec_name,audioCodec:audio?.codec_name};
}
function plan(song,speech,settings) {
  if(!song.hasAudio)throw new Error('Seçilen şarkıda ses kanalı yok.');
  if(!speech.hasAudio)throw new Error('Seçilen jenerik dosyasında ses kanalı yok.');
  if(song.duration<2)throw new Error('Şarkı en az iki saniye olmalı.');
  const cut=settings.cutMode==='manual'?settings.cutSecond:song.duration/2;
  if(cut<.5||cut>song.duration-.5)throw new Error('Kesim noktası şarkının başlangıcı ve sonundan en az yarım saniye uzakta olmalı.');
  const gap=speech.duration+.5;
  const fade=Math.min(settings.fade,cut,song.duration-cut);
  const h=Math.min(settings.outputHeight,song.hasVideo?Math.max(2,Math.round(song.height/2)*2):settings.outputHeight);
  const w=song.hasVideo?Math.max(2,Math.round((song.width/song.height*h)/2)*2):Math.round(h*16/9/2)*2;
  return {cut,gap,fade,total:song.duration+gap,speechDuration:speech.duration,head:.25,width:w,height:h};
}
function safeName(name) {return String(name||'Jenerik').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/[. ]+$/g,'').trim().slice(0,95)||'Jenerik';}
function filterGraph(songInfo,timing,settings,hasBg,normal={}) {
  const {cut,gap,fade,width,height,head}=timing;
  const num=n=>Number(n).toFixed(6);
  const norm=(key,target)=>normal[key]||`loudnorm=I=${target}:TP=-5:LRA=11`;
  const vf=fade>0?`,fade=t=out:st=${num(cut-fade)}:d=${num(fade)}`:'';
  const vi=fade>0?`,fade=t=in:st=0:d=${num(fade)}`:'';
  const af=fade>0?`,afade=t=out:st=${num(cut-fade)}:d=${num(fade)}`:'';
  const ai=fade>0?`,afade=t=in:st=0:d=${num(fade)}`:'';
  const g=[];
  if(songInfo.hasVideo)g.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,split=2[vpre][vpost]`);
  else g.push(`color=c=0x151523:s=${width}x${height}:r=30:d=${num(songInfo.duration)},split=2[vpre][vpost]`);
  g.push(`[vpre]trim=end=${num(cut)},setpts=PTS-STARTPTS${vf}[v1]`);
  g.push(`color=c=black:s=${width}x${height}:r=30:d=${num(gap)},format=yuv420p,setsar=1[v2]`);
  g.push(`[vpost]trim=start=${num(cut)}:end=${num(songInfo.duration)},setpts=PTS-STARTPTS${vi}[v3]`);
  g.push(`[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${norm('song',-18)},volume=${settings.songGain}dB,apad,atrim=end=${num(songInfo.duration)},asplit=2[apre][apost]`);
  g.push(`[apre]atrim=end=${num(cut)},asetpts=PTS-STARTPTS${af}[a1]`);
  g.push(`[apost]atrim=start=${num(cut)}:end=${num(songInfo.duration)},asetpts=PTS-STARTPTS${ai}[a3]`);
  const voice=`[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${norm('voice',-16)},volume=${settings.voiceGain}dB,adelay=${Math.round(head*1000)}:all=1,apad,atrim=end=${num(gap)}`;
  if(hasBg){
    g.push(`${voice},asplit=2[spoken][detector]`);
    g.push(`[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${norm('bg',-16)},volume=${settings.bgGain}dB,atrim=end=${num(gap)},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st=${num(Math.max(0,gap-.15))}:d=0.15[bed]`);
    g.push(`[bed][detector]sidechaincompress=threshold=0.025:ratio=6:attack=15:release=250[ducked]`);
    g.push(`[spoken][ducked]amix=inputs=2:duration=first:normalize=0[a2]`);
  }else g.push(`${voice}[a2]`);
  g.push('[v1][a1][v2][a2][v3][a3]concat=n=3:v=1:a=1[vout][joined]');
  // level=false limiter'in sesi kendiliğinden yükseltmesini önler; jenerikte fade yoktur.
  g.push('[joined]alimiter=limit=0.891:level=false:latency=true,aresample=48000[aout]');
  return g.join(';\n');
}
module.exports={parseYouTube,validateSettings,probe,plan,safeName,filterGraph,outputName};
