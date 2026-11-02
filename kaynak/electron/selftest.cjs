const fs=require('node:fs'),path=require('node:path');
const {run}=require('./process.cjs');
const {fixtures}=require('../scripts/fixtures.cjs');
async function selfTest({win,engine,selected,base,testDir,errors,packaged}){
  const report={packaged,runtime:process.versions.electron,checks:[],errors,startedAt:new Date().toISOString(),syntheticMedia:true};
  const check=(name,passed,detail)=>{report.checks.push({name,passed:!!passed,detail});if(!passed)throw new Error(name+': '+JSON.stringify(detail));};
  const wait=async(predicate,timeout=30000)=>{const end=Date.now()+timeout;while(!await predicate()){if(Date.now()>end)throw new Error('Kabul zaman aşımı');await new Promise(r=>setTimeout(r,150));}};
  const js=source=>win.webContents.executeJavaScript(source);
  try{
    for(const name of ['yt-dlp.exe','deno.exe','ffmpeg.exe','ffprobe.exe','KutaryaSes.exe','tts-windows.ps1'])check('Paket aracı '+name,fs.existsSync(path.join(engine.vendorDir,name)));
    await wait(()=>js('window.uiReady===true'));
    check('Sandbox / sınırlı IPC',await js('typeof require==="undefined" && typeof window.kutarya.start==="function"'));
    check('Türkçe arayüz',await js('document.documentElement.lang==="tr" && document.querySelector("h1").textContent.includes("Şarkının")'));
    await js('document.fonts.ready');
    await wait(()=>js('Array.from(document.querySelector("#voice-select").options).some(o=>o.value==="tr-TR-AhmetNeural")'));
    check('Ses listesi Türkçe kadın/erkek',await js('Array.from(document.querySelector("#voice-select").options).some(o=>o.value==="tr-TR-EmelNeural")'));
    // Kendi kabul penceresi boyanır; diğer açık uygulamalara odak/süreç müdahalesi yok.
    win.showInactive();await new Promise(r=>setTimeout(r,500));
    try{fs.writeFileSync(path.join(testDir,'01-arayuz.png'),(await win.webContents.capturePage()).toPNG());report.visualCapture=true;}catch(error){report.visualCapture=false;report.captureError=error.message;}
    win.setSize(1000,730);await new Promise(r=>setTimeout(r,250));
    check('1000 px pencere yatay taşma',await js('document.documentElement.scrollWidth<=window.innerWidth'),await js('({inner:innerWidth,scroll:document.documentElement.scrollWidth})'));
    try{fs.writeFileSync(path.join(testDir,'02-dar-pencere.png'),(await win.webContents.capturePage()).toPNG());}catch{}
    win.setSize(1420,960);
    const rejected=await js('window.kutarya.start({urls:"https://youtube.com.evil.example/watch?v=YE7VzlLtp-4",text:"Deneme",backgroundEnabled:false})');
    check('Sahte host IPC üzerinden reddedilir',rejected.ok===false);check('Reddedilen girdi kuyrukta iş bırakmaz',engine.jobs.length===0);
    const files=await fixtures(path.join(testDir,'girdiler'),engine.vendorDir);
    const song=await selected(files.song),speech=await selected(files.speech),bg=await selected(files.bg);
    await js(`fill({songPath:${JSON.stringify(song.path)},speechPath:${JSON.stringify(speech.path)},bgPath:${JSON.stringify(bg.path)},speechMode:"file",fade:1,voiceGain:3.7,bgGain:-18,alsoMp3:true});selected.song=${JSON.stringify(song)};selected.speech=${JSON.stringify(speech)};selected.bg=${JSON.stringify(bg)};sourceUI();document.querySelector('#video-preview').muted=true;document.querySelector('#speech-audio').muted=true;document.querySelector('#create').click();`);
    await wait(()=>engine.jobs.length===1);
    await wait(()=>['completed','failed'].includes(engine.jobs[0].status),180000);
    const job=engine.jobs[0];check('Gerçek renderer düğmesi / MP4+MP3',job.status==='completed'&&fs.existsSync(job.file)&&fs.existsSync(job.mp3),job.errorDetail);
    check('Şarkının tamamı + jenerik arası',Math.abs(job.outputInfo.duration-15.5)<.1,job.outputInfo);
    await wait(()=>js(`!!document.querySelector('[data-id="${job.id}"] [data-job-action="play"]')`));
    await js(`document.querySelector('[data-id="${job.id}"] [data-job-action="play"]').click()`);
    await wait(()=>js('document.querySelector("#video-preview").readyState>=2'));
    check('Port olmadan video oynatma',await js('document.querySelector("#video-preview").src.startsWith("kty-media://")'));
    await js('document.querySelector("#video-preview").pause();document.querySelector("#video-preview").currentTime=7');
    await wait(()=>js('!document.querySelector("#video-preview").seeking'));
    check('Gerçek video seek / süre',await js('Math.abs(document.querySelector("#video-preview").duration-15.5)<.1'));
    try{fs.writeFileSync(path.join(testDir,'03-sonuc.png'),(await win.webContents.capturePage()).toPNG());}catch{}
    const previewResult=await js('window.kutarya.speech({text:"Kutarya Jenerik. Şarkının ortasında sizin mesajınız.",voice:"tr-TR-EmelNeural"})');
    check('Ses önizleme IPC adı',previewResult.ok&&previewResult.value.name==='Emel · Ses önizlemesi');
    const tts=previewResult.value.path;
    check('Paket içinden gerçek Emel seslendirmesi',fs.statSync(tts).size>1000);
    const voiceMedia=previewResult.value;
    await js(`showAudio(${JSON.stringify(voiceMedia)});document.querySelector('#speech-audio').pause();`);
    await wait(()=>js('document.querySelector("#speech-audio").readyState>=2'));
    check('Gerçek jenerik ses önizlemesi',await js('document.querySelector("#speech-audio").duration>1'));
    const youtubeArg=process.argv.find(a=>a.startsWith('--kty-youtube='));
    if(youtubeArg){
      const url=youtubeArg.slice(14);
      const [id]=engine.enqueue({urls:url,text:'Kutarya Jenerik. Şarkı kısa bir ara verir, mesajınız duyulur.',voice:'tr-TR-AhmetNeural',bgPath:files.bg,alsoMp3:true});
      await wait(()=>['completed','failed'].includes(engine.jobs.find(j=>j.id===id)?.status),1200000);
      const live=engine.jobs.find(j=>j.id===id);check('Paket YouTube→seslendirme→tam MP4+MP3',live.status==='completed',live.errorDetail);report.youtube=live;
    }
    const second=engine.enqueue({songPath:files.song,speechMode:'file',speechPath:files.speech,bgPath:files.bg})[0];engine.cancel(second);
    await wait(()=>engine.jobs.find(j=>j.id===second)?.status==='cancelled');check('İptal kendi alt sürecini durdurur',!engine.jobs.find(j=>j.id===second).file);
    const reload=new (require('./engine.cjs').Engine)({...engine,vendorDir:engine.vendorDir,dataDir:engine.dataDir,outputDir:engine.outputDir});
    check('Geçmiş ve seçili fon kalıcı',reload.jobs.some(j=>j.id===job.id&&j.status==='completed')&&reload.settings.bgPath===files.bg);
    if(report.youtube)check('Gerçek YouTube işi yeniden yüklenen geçmişte kalır',reload.jobs.some(j=>j.id===report.youtube.id&&j.status==='completed'&&j.file===report.youtube.file));
    check('Renderer hata kaydı',errors.length===0,errors);
    report.job=job;report.realTts={file:tts,duration:voiceMedia.info.duration};report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  report.finishedAt=new Date().toISOString();return report;
}
module.exports={selfTest};
