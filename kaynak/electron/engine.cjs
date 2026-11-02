const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {run}=require('./process.cjs');
const {parseYouTube,validateSettings,probe,plan,filterGraph,outputName}=require('./media.cjs');
const ACTIVE=new Set(['queued','preparing','downloading','speech','analysing','rendering','saving']);
const defaultSettings=()=>validateSettings({});
function atomic(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');fs.renameSync(tmp,file);}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function friendly(raw,stage){
  if(/sign in|not a bot|confirm your age|private video|members.only/i.test(raw))return 'YouTube bu videoya erişim için oturum istiyor. Şifre sorulmadan indirme durduruldu; yerel dosyayı seçebilirsiniz.';
  if(/NoAudioReceived|403|Forbidden/.test(raw))return stage==='downloading'?'YouTube videoya erişim vermedi. Bağlantıyı kontrol edin veya yerel şarkı dosyasını seçin.':'Seslendirme hizmeti yanıt vermedi. Yeniden deneyin veya hazır jenerik / çevrimdışı Windows sesi seçin.';
  if(/EACCES|EPERM|Access is denied/i.test(raw))return 'Dosyaya veya kayıt klasörüne erişilemiyor. Açık dosyayı kapatın ya da farklı bir klasör seçin.';
  if(/ENOENT|No such file/i.test(raw))return 'Seçilen dosya taşınmış veya silinmiş. İlgili dosyayı yeniden seçin.';
  if(/Invalid data found|moov atom not found/i.test(raw))return 'Dosya okunamadı. Tam indirildiğini kontrol edin veya başka bir ses/video dosyası seçin.';
  if(/disk full|No space left|not enough space/i.test(raw))return 'Diskte yeterli boş alan yok.';
  if(/429|unable to download|network|connection|timed out/i.test(raw))return 'İnternet bağlantısı veya hizmet isteği başarısız. Yeniden deneyebilirsiniz.';
  return String(raw).split('\n').filter(Boolean).slice(-2).join(' ').slice(0,650)||'İşlem tamamlanamadı.';
}
class Engine extends EventEmitter {
  constructor({vendorDir,dataDir,outputDir,authorizeFile=()=>true}){
    super();Object.assign(this,{vendorDir,dataDir,outputDir,authorizeFile});
    fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(outputDir,{recursive:true});
    this.cacheDir=path.join(dataDir,'Onbellek');fs.mkdirSync(this.cacheDir,{recursive:true});
    this.settings={...defaultSettings(),...validateSettings(readJson(path.join(dataDir,'ayarlar.json'),{}))};
    this.jobs=readJson(path.join(dataDir,'isler.json'),[]).filter(j=>/^[a-f0-9-]{36}$/.test(j.id||'')).map(j=>({...j,status:ACTIVE.has(j.status)?'interrupted':j.status}));
    this.running=null;this.closing=false;this.lastEmit=0;this.voicesCache=readJson(path.join(vendorDir,'voices.json'),[]);
  }
  snapshot(){return {settings:{...this.settings},jobs:this.jobs.map(j=>({...j})),outputDir:this.outputDir,version:'1.1.0'};}
  save(){atomic(path.join(this.dataDir,'isler.json'),this.jobs);}
  notify(force=true){if(!force&&Date.now()-this.lastEmit<220)return;this.lastEmit=Date.now();this.emit('change',this.snapshot());}
  updateSettings(raw){this.settings=validateSettings(raw);atomic(path.join(this.dataDir,'ayarlar.json'),this.settings);return this.settings;}
  setOutput(folder){
    if(!path.isAbsolute(folder))throw new Error('Geçerli bir kayıt klasörü seçin.');
    fs.mkdirSync(folder,{recursive:true});
    const test=path.join(folder,`.kutarya-kontrol-${crypto.randomUUID()}`);
    try{fs.writeFileSync(test,'',{flag:'wx'});fs.unlinkSync(test);}catch(error){throw new Error(friendly(error.message));}
    atomic(path.join(this.dataDir,'konum.json'),{outputDir:folder});this.outputDir=folder;this.notify();
  }
  async voices(refresh=false){
    if(refresh||!this.voicesCache.length){
      try{this.voicesCache=await this.speechRequest({op:'voices'});atomic(path.join(this.dataDir,'sesler.json'),this.voicesCache);}catch{this.voicesCache=readJson(path.join(this.dataDir,'sesler.json'),this.voicesCache);}
    }
    let offline=[];try{offline=await this.speechRequest({op:'voices'},true);}catch{}
    return [...this.voicesCache,...offline];
  }
  async speechRequest(request,offline=false,signal){
    const requestFile=path.join(this.cacheDir,`ses-istegi-${crypto.randomUUID()}.json`);
    await fsp.writeFile(requestFile,JSON.stringify(request),'utf8');
    try{
      const file=offline?'powershell.exe':path.join(this.vendorDir,'KutaryaSes.exe');
      const args=offline?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(this.vendorDir,'tts-windows.ps1'),requestFile]:[requestFile];
      const result=await run(file,args,{signal,timeout:180000});return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
    }finally{await fsp.unlink(requestFile).catch(()=>{});}
  }
  async synthesize(settings,signal){
    if(!settings.text)throw new Error('Jenerik metnini yazın veya hazır bir ses dosyası seçin.');
    const hash=crypto.createHash('sha256').update(JSON.stringify([settings.text,settings.voice,settings.rate,settings.pitch])).digest('hex');
    const offline=settings.voice.startsWith('sapi:');const output=path.join(this.cacheDir,`${hash}.${offline?'wav':'mp3'}`);
    if(fs.existsSync(output)){try{if((await probe(output,this.vendorDir,signal)).hasAudio)return output;}catch(error){if(signal?.aborted)throw error;}await fsp.unlink(output);}
    // Önizleme ve üretim aynı metni isterse birbirinin geçici dosyasını kullanmaz.
    const partial=output+'.partial-'+crypto.randomUUID()+path.extname(output);
    try{await this.speechRequest({...settings,output:partial},offline,signal);const info=await probe(partial,this.vendorDir,signal);if(!info.hasAudio)throw new Error('Seslendirme ses kanalı üretmedi.');try{await fsp.copyFile(partial,output,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST'||!(await probe(output,this.vendorDir,signal)).hasAudio)throw error;}return output;}
    catch(error){throw new Error(friendly(error.message));}finally{await fsp.unlink(partial).catch(()=>{});}
  }
  async previewSpeech(raw,signal){const settings=validateSettings(raw);if(settings.speechMode==='file')return this.previewAudio(settings.speechPath,signal);return this.synthesize(settings,signal);}
  checkFile(file,field='speech'){
    const labels={song:'Şarkı',speech:'Jenerik',bg:'Fon'};
    let valid=false;try{valid=!!file&&this.authorizeFile(file)&&fs.statSync(file).isFile()&&fs.statSync(file).size>0;}catch{}
    if(!valid){const error=new Error(`${labels[field]||'Medya'} dosyası bulunamadı veya seçilmedi. Dosyayı yeniden seçin.`);error.field=field;throw error;}
  }
  async inspect(file,kind,signal){
    this.checkFile(file,kind);
    try{const info=await probe(file,this.vendorDir,signal);if(!info.hasAudio)throw new Error('Dosyada ses kanalı yok.');if(kind==='song'&&info.duration<2)throw new Error('Şarkı en az 2 saniye olmalı.');return info;}
    catch(cause){const error=new Error(`${{song:'Şarkı',speech:'Jenerik',bg:'Fon'}[kind]||'Medya'} dosyası okunamadı: ${friendly(cause.message)}`);error.field=kind;throw error;}
  }
  async previewAudio(file,signal){
    this.checkFile(file);
    const stat=await fsp.stat(file),key=crypto.createHash('sha256').update(JSON.stringify([file,stat.size,stat.mtimeMs])).digest('hex');
    const output=path.join(this.cacheDir,`dinle-${key}.mp3`);
    if(fs.existsSync(output))return output;
    const temp=path.join(this.cacheDir,`dinle-${crypto.randomUUID()}.mp3`);
    try{await run(path.join(this.vendorDir,'ffmpeg.exe'),['-v','error','-nostdin','-y','-i',file,'-vn','-c:a','libmp3lame','-b:a','192k',temp],{signal,timeout:180000});try{await fsp.copyFile(temp,output,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}return output;}
    finally{await fsp.unlink(temp).catch(()=>{});}
  }
  input({urls='',...raw}){
    const settings=validateSettings(raw);let song;
    if(settings.songSource==='local'){this.checkFile(settings.songPath,'song');song={songPath:settings.songPath,title:path.parse(settings.songPath).name};}
    else{const inputs=String(urls).trim().split(/\s+/u).filter(Boolean);if(inputs.length!==1){const error=new Error('Her video için tek YouTube bağlantısı ekleyin veya şarkı dosyası seçin.');error.field='song-url';throw error;}try{song=parseYouTube(inputs[0]);}catch(error){error.field='song-url';throw error;}}
    if(settings.speechMode==='file')this.checkFile(settings.speechPath,'speech');else if(!settings.text){const error=new Error('Jenerik metnini yazın veya hazır ses dosyası seçin.');error.field='jingle-text';throw error;}
    if(settings.backgroundEnabled)this.checkFile(settings.bgPath,'bg');
    return {settings,song};
  }
  async preflight(raw){
    const {settings,song}=this.input(raw);
    const [songInfo,speechInfo]=await Promise.all([song.songPath?this.inspect(song.songPath,'song'):null,settings.speechMode==='file'?this.inspect(settings.speechPath,'speech'):null,settings.backgroundEnabled?this.inspect(settings.bgPath,'bg'):null]);
    if(songInfo&&speechInfo)plan(songInfo,speechInfo,settings);
    await fsp.access(this.outputDir,fs.constants.W_OK);
    return true;
  }
  exportPlan(raw=this.settings){
    const settings=validateSettings(raw),name=outputName(settings.outputName);
    const reserved=new Set(this.jobs.filter(j=>ACTIVE.has(j.status)).flatMap(j=>[j.plannedFile,j.plannedMp3].filter(Boolean)).map(file=>path.resolve(file).toLowerCase()));
    let stem=name,file,mp3,index=1;
    do{stem=index===1?name:`${name} (${index})`;file=path.join(this.outputDir,stem+'.mp4');mp3=settings.alsoMp3?path.join(this.outputDir,stem+'.mp3'):null;index++;}while(fs.existsSync(file)||(mp3&&fs.existsSync(mp3))||reserved.has(file.toLowerCase())||(mp3&&reserved.has(mp3.toLowerCase())));
    return {name:stem,file,mp3,outputDir:this.outputDir,count:mp3?2:1};
  }
  enqueue(raw){
    if(this.closing)throw new Error('Uygulama kapanıyor.');
    const token=typeof raw.startToken==='string'&&/^[a-f0-9-]{36}$/u.test(raw.startToken)?raw.startToken:null;
    const previous=token&&this.jobs.find(j=>j.startToken===token);if(previous)return {ids:[previous.id],reused:true};
    const {settings,song}=this.input(raw);
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([song.url||song.songPath,{...settings,songUrl:''},this.outputDir])).digest('hex');
    const pending=this.jobs.find(j=>ACTIVE.has(j.status));
    if(pending){if(pending.fingerprint===fingerprint)return {ids:[pending.id],reused:true};throw new Error('Bir video zaten hazırlanıyor. İşlem bitince yeni video oluşturabilirsiniz.');}
    const output=this.exportPlan(settings),job={...song,id:crypto.randomUUID(),videoId:song.id||null,startToken:token,fingerprint,settings:{...settings},outputDir:this.outputDir,outputName:output.name,plannedFile:output.file,plannedMp3:output.mp3,status:'queued',progress:0,title:song.title||'YouTube videosu',createdAt:new Date().toISOString(),error:'',detail:'Hazırlama başlıyor'};
    // Veri kaydı başarısız olursa bellekte başlamış bir iş bırakılmaz.
    this.updateSettings(settings);this.jobs.push(job);try{this.save();}catch(error){this.jobs.pop();throw error;}
    this.notify();this.pump();return {ids:[job.id],reused:false};
  }
  pump(){if(this.running||this.closing)return;const job=this.jobs.find(j=>j.status==='queued');if(job)void this.execute(job);}
  state(job,status,detail,progress){Object.assign(job,{status,detail,progress:Math.max(job.progress||0,progress||0)});this.save();this.notify();}
  async download(job,work,signal){
    const args=['--ignore-config','--no-plugin-dirs','--no-playlist','--no-color','--newline','--encoding','utf-8','--no-simulate',
      '--js-runtimes',`deno:${path.join(this.vendorDir,'deno.exe')}`,'--ffmpeg-location',this.vendorDir,'--no-mtime','--socket-timeout','25','--retries','3','--fragment-retries','3','--concurrent-fragments','4',
      '-f','bestvideo[height<=1080]+bestaudio/best[height<=1080]/best','--merge-output-format','mp4','--remux-video','mp4',
      '-o',path.join(work,'sarki.%(ext)s'),'--print','before_dl:KTY_META:{"title":%(title)j,"duration":%(duration)j,"is_live":%(is_live)j}',
      '--print','after_move:KTY_FILE:%(filepath)j','--progress-template','download:KTY_PROGRESS:%(progress)j','--progress-delta','0.5','--match-filters','!is_live','--',job.url];
    let downloaded;
    await run(path.join(this.vendorDir,'yt-dlp.exe'),args,{signal,cwd:work,onLine:line=>{
      if(line.startsWith('KTY_META:')){try{const meta=JSON.parse(line.slice(9));job.title=meta.title||job.title;job.songDuration=meta.duration;this.notify();}catch{}}
      if(line.startsWith('KTY_FILE:')){try{downloaded=JSON.parse(line.slice(9));}catch{}}
      if(line.startsWith('KTY_PROGRESS:')){try{const p=JSON.parse(line.slice(13)),percent=Number(p.downloaded_bytes)/Number(p.total_bytes||p.total_bytes_estimate)*100;if(Number.isFinite(percent)){job.progress=Math.max(job.progress,2+percent*.3);job.detail=`Şarkı indiriliyor · %${Math.round(percent)}`;this.notify(false);}}catch{}}
    }});
    if(!downloaded||!path.resolve(downloaded).startsWith(path.resolve(work)+path.sep))throw new Error('Video indirilemedi; canlı yayın veya erişilemeyen bağlantı olabilir.');
    return downloaded;
  }
  async normalization(file,target,signal,seconds){
    const args=['-hide_banner','-nostdin'];if(seconds)args.push('-t',String(seconds));
    args.push('-i',file,'-vn','-sn','-dn','-af',`loudnorm=I=${target}:TP=-5:LRA=11:print_format=json`,'-f','null','-');
    const result=await run(path.join(this.vendorDir,'ffmpeg.exe'),args,{signal});
    const match=result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);if(!match)return `loudnorm=I=${target}:TP=-5:LRA=11`;
    const d=JSON.parse(match);if(![d.input_i,d.input_tp,d.input_lra,d.input_thresh,d.target_offset].every(x=>Number.isFinite(Number(x))))return `loudnorm=I=${target}:TP=-5:LRA=11`;
    return `loudnorm=I=${target}:TP=-5:LRA=11:measured_I=${d.input_i}:measured_TP=${d.input_tp}:measured_LRA=${d.input_lra}:measured_thresh=${d.input_thresh}:offset=${d.target_offset}:linear=true`;
  }
  async execute(job){
    const controller=new AbortController();this.running={job,controller};const signal=controller.signal;
    const work=path.join(this.cacheDir,`is-${job.id}`);
    let partial;const created=[];
    try{
      await fsp.mkdir(work,{recursive:true});signal.throwIfAborted();
      job.startedAt=new Date().toISOString();job.progress=0;this.state(job,'preparing','Kaynaklar hazırlanıyor',1);
      const song=job.songPath||await (this.state(job,'downloading','YouTube şarkısı indiriliyor',2),this.download(job,work,signal));
      const settings=job.settings;this.state(job,'speech',settings.speechMode==='text'?'Jenerik seslendiriliyor':'Hazır jenerik okunuyor',34);
      const speech=settings.speechMode==='file'?settings.speechPath:await this.synthesize(settings,signal);
      const songInfo=await probe(song,this.vendorDir,signal),speechInfo=await probe(speech,this.vendorDir,signal),timing=plan(songInfo,speechInfo,settings);
      const bg=settings.backgroundEnabled?settings.bgPath:null;if(bg&&!(await probe(bg,this.vendorDir,signal)).hasAudio)throw new Error('Fon dosyasında ses kanalı yok.');
      job.timing=timing;job.songDuration=songInfo.duration;this.state(job,'analysing','Şarkı, konuşma ve fon sesleri dengeleniyor',42);
      const normal={song:await this.normalization(song,-18,signal),voice:await this.normalization(speech,-16,signal)};
      if(bg)normal.bg=await this.normalization(bg,-16,signal,Math.min(timing.gap,120));
      const graph=filterGraph(songInfo,timing,settings,!!bg,normal),script=path.join(work,'kurgu.ffscript');await fsp.writeFile(script,graph,'utf8');
      await fsp.mkdir(job.outputDir,{recursive:true});
      const output=job.plannedFile;partial=path.join(work,'sonuc.mp4');
      const args=['-hide_banner','-nostdin','-y','-i',song,'-i',speech];if(bg)args.push('-stream_loop','-1','-i',bg);
      args.push('-filter_complex',graph,'-map','[vout]','-map','[aout]','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-t',String(timing.total),'-progress','pipe:1','-nostats',partial);
      this.state(job,'rendering','Siyah ekran, sesler ve geçişler birleştiriliyor',50);
      await run(path.join(this.vendorDir,'ffmpeg.exe'),args,{signal,onLine:line=>{if(line.startsWith('out_time_us=')){const seconds=Number(line.slice(12))/1e6;job.progress=Math.max(job.progress,Math.min(93,50+43*seconds/timing.total));job.detail=`Video hazırlanıyor · %${Math.round((job.progress-50)/43*100)}`;this.notify(false);}}});
      const media=await probe(partial,this.vendorDir,signal);if(!media.hasVideo||!media.hasAudio||Math.abs(media.duration-timing.total)>.3)throw new Error('Çıktı süresi/kanalları doğrulanamadı; tamamlandı olarak kaydedilmedi.');
      this.state(job,'saving','Çıktı kontrol edilip kaydediliyor',94);
      signal.throwIfAborted();await fsp.copyFile(partial,output,fs.constants.COPYFILE_EXCL);created.push(output);job.file=output;
      if(settings.alsoMp3){const mp3=job.plannedMp3,tmp=path.join(work,'sonuc.mp3');await run(path.join(this.vendorDir,'ffmpeg.exe'),['-v','error','-nostdin','-y','-i',partial,'-vn','-c:a','libmp3lame','-b:a','192k',tmp],{signal});signal.throwIfAborted();await fsp.copyFile(tmp,mp3,fs.constants.COPYFILE_EXCL);created.push(mp3);job.mp3=mp3;}
      signal.throwIfAborted();
      job.completedAt=new Date().toISOString();job.outputInfo=media;this.state(job,'completed','MP4 hazır'+(job.mp3?' · MP3 de kaydedildi':''),100);
      // Yalnız bu işin özel geçici klasörü silinir. Seçilen asıl dosyalar korunur.
      if(path.dirname(work)===path.resolve(this.cacheDir))await fsp.rm(work,{recursive:true,force:true}).catch(()=>{});
    }catch(error){for(const file of created)await fsp.unlink(file).catch(()=>{});job.file=null;job.mp3=null;job.error=signal.aborted?'İşlem iptal edildi.':friendly(error.message,job.status);job.errorDetail=signal.aborted?'':String(error.message).slice(-5000);this.state(job,signal.aborted?'cancelled':'failed',job.error,job.progress);}
    finally{this.running=null;this.save();this.notify();this.pump();}
  }
  cancel(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw new Error('İş bulunamadı.');if(this.running?.job.id===id)this.running.controller.abort();else if(job.status==='queued')this.state(job,'cancelled','Sıradan çıkarıldı',0);return true;}
  async retry(id){const job=this.jobs.find(j=>j.id===id);if(!job||!['failed','cancelled','interrupted'].includes(job.status))throw new Error('Bu iş yeniden başlatılamıyor.');if(this.jobs.some(j=>ACTIVE.has(j.status)))throw new Error('Devam eden video bitince yeniden deneyin.');const oldDir=this.outputDir;await this.preflight({...job.settings,urls:job.url});const output=this.exportPlan({...job.settings,outputName:job.settings.outputName||job.outputName||'Jenerikli video'});Object.assign(job,{outputDir:oldDir,outputName:output.name,plannedFile:output.file,plannedMp3:output.mp3,status:'queued',progress:0,error:'',errorDetail:'',file:null,mp3:null,detail:'Yeniden hazırlanıyor'});this.save();this.notify();this.pump();return {ids:[job.id],reused:false};}
  async shutdown(){this.closing=true;this.running?.controller.abort();const end=Date.now()+12000;while(this.running&&Date.now()<end)await new Promise(r=>setTimeout(r,100));}
}
module.exports={Engine,ACTIVE,atomic,readJson,defaultSettings};
