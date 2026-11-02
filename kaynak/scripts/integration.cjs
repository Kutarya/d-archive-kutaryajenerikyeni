const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Engine}=require('../electron/engine.cjs');const {run}=require('../electron/process.cjs');const {fixtures}=require('./fixtures.cjs');
(async()=>{
  const base=path.resolve('../Kanitlar/motor-1'),vendor=path.resolve('vendor'),files=await fixtures(path.join(base,'girdiler'),vendor);
  const engine=new Engine({vendorDir:vendor,dataDir:path.join(base,'veri'),outputDir:path.join(base,'ciktilar')});
  engine.on('change',s=>{const j=s.jobs.at(-1);if(j&&j.status!==global.lastStatus){console.log(j.status,j.detail);global.lastStatus=j.status;}});
  const [id]=engine.enqueue({songPath:files.song,speechMode:'file',speechPath:files.speech,bgPath:files.bg});
  while(engine.running||engine.jobs.some(j=>j.status==='queued'))await new Promise(r=>setTimeout(r,250));
  const job=engine.jobs.find(j=>j.id===id);assert.equal(job.status,'completed',job.errorDetail);assert(job.mp3);assert(Math.abs(job.outputInfo.duration-15.5)<.1);
  const capture=async(at,name)=>{const output=path.join(base,name);await run(path.join(vendor,'ffmpeg.exe'),['-v','error','-nostdin','-y','-ss',String(at),'-i',job.file,'-frames:v','1',output]);return output;};
  const before=await capture(4,'once.png'),black=await capture(7,'siyah.png'),after=await capture(11,'sonra.png');
  const audio=await run(path.join(vendor,'ffmpeg.exe'),['-hide_banner','-nostdin','-i',job.file,'-vn','-af','astats=metadata=1:reset=0','-f','null','-']);
  const peaks=[...audio.stderr.matchAll(/Peak level dB:\s*([-\d.]+)/g)].map(m=>Number(m[1]));assert(peaks.length&&Math.max(...peaks)<-.7);
  const result={passed:true,job,inputs:files,frames:{before,black,after},peakDb:Math.max(...peaks),syntheticMedia:true};fs.writeFileSync(path.join(base,'kabul.json'),JSON.stringify(result,null,2));
  const voices=await engine.voices();console.log('Türkçe/Windows sesleri',voices.filter(v=>v.locale==='tr-TR'));
  for(const voice of ['tr-TR-EmelNeural','tr-TR-AhmetNeural']){const output=await engine.previewSpeech({text:'Kutarya Jenerik. Şarkının ortasında, sizin mesajınız.',voice});assert(fs.statSync(output).size>1000);console.log('Gerçek seslendirme hazır',voice,path.basename(output));}
  console.log(JSON.stringify({passed:true,output:job.file,peakDb:result.peakDb}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
