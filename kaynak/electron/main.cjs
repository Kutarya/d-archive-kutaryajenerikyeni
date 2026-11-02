const {app,BrowserWindow,ipcMain,protocol,dialog,shell,clipboard}=require('electron');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {Engine,ACTIVE,readJson,atomic}=require('./engine.cjs');
const {probe,validateSettings}=require('./media.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'kty-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
const testDir=process.argv.find(a=>a.startsWith('--kty-test-dir='))?.slice(15);
const smoke=process.argv.includes('--kty-smoke');
const base=testDir||process.env.PORTABLE_EXECUTABLE_DIR||path.resolve(__dirname,'../..');
const dataDir=path.join(base,'Veriler');fs.mkdirSync(dataDir,{recursive:true});
app.setPath('userData',path.join(dataDir,'Profil'));app.setAppUserModelId('com.kutarya.jenerik.yeni');
const testHooks=smoke?{pickQueue:[],folderQueue:[]}:null;
let win,engine,quitting=false;const authorized=new Set(),mediaTokens=new Map();
const authorize=file=>authorized.add(path.resolve(file));
const mediaUrl=file=>{authorize(file);const id=crypto.randomUUID();mediaTokens.set(id,path.resolve(file));return `kty-media://local/${id}`;};
const errors=[];
if(!testDir&&!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{win?.show();win?.focus();});
  app.whenReady().then(async()=>{
    const vendorDir=app.isPackaged?path.join(process.resourcesPath,'vendor'):path.join(__dirname,'../vendor');
    let outputDir=readJson(path.join(dataDir,'konum.json'),{}).outputDir||path.join(base,'Ciktilar');
    if(!path.isAbsolute(outputDir))outputDir=path.join(base,'Ciktilar');
    engine=new Engine({vendorDir,dataDir,outputDir,authorizeFile:file=>authorized.has(path.resolve(file))});
    for(const file of [engine.settings.songPath,engine.settings.speechPath,engine.settings.bgPath])if(file)authorize(file);
    for(const job of engine.jobs)for(const file of [job.songPath,job.settings?.speechPath,job.settings?.bgPath])if(file)authorize(file);
    protocol.handle('kty-media',async request=>{
      const token=new URL(request.url).pathname.slice(1),file=mediaTokens.get(token);
      if(!file)return new Response('Bulunamadı',{status:404});
      try{
        const stat=await fsp.stat(file),range=request.headers.get('range');let start=0,end=stat.size-1,status=200;
        const headers={'Content-Type':({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
        if(range){const m=range.match(/^bytes=(\d*)-(\d*)$/);if(!m)return new Response(null,{status:416});if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else if(m[2])start=Math.max(0,stat.size-Number(m[2]));if(start>end||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
        headers['Content-Length']=String(end-start+1);
        return new Response(request.method==='HEAD'?null:Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
      }catch{return new Response('Dosya bulunamadı',{status:404});}
    });
    win=new BrowserWindow({width:1120,height:920,minWidth:900,minHeight:680,frame:false,backgroundColor:'#f5f4fa',show:!smoke,
      icon:path.join(__dirname,'../ui/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,devTools:!!testDir,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
    const allowed=event=>event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame;
    const handle=(name,fn)=>ipcMain.handle('kty:'+name,async(event,...args)=>{if(!allowed(event))return {ok:false,error:'İstek reddedildi.'};try{return {ok:true,value:await fn(...args)};}catch(error){return {ok:false,error:error.message,field:error.field};}});
    const selected=async(file,kind)=>{authorize(file);const info=kind?await engine.inspect(file,kind):await probe(file,vendorDir);return {path:file,name:path.basename(file),info,url:mediaUrl(file)};};
    handle('state',()=>engine.snapshot());handle('save',raw=>engine.updateSettings(raw));handle('voices',refresh=>engine.voices(!!refresh));
    handle('choose',async kind=>{
      if(!['song','speech','bg'].includes(kind))throw new Error('Bilinmeyen dosya alanı.');
      const options={title:kind==='song'?'Şarkı videosunu veya sesini seç':kind==='speech'?'Jenerik sesini seç':'Fon müziğini seç',properties:['openFile'],filters:[{name:'Ses ve video',extensions:['mp4','mkv','webm','mov','avi','mp3','wav','m4a','flac','ogg','opus','aac','wma','mpeg','mpga','aiff','aif','3gp','m4b']},{name:'Tüm dosyalar',extensions:['*']}]};
      const pick=testHooks?.pickQueue.length?{canceled:false,filePaths:[testHooks.pickQueue.shift()]}:await dialog.showOpenDialog(win,options);
      if(pick.canceled||!pick.filePaths.length)return null;return selected(pick.filePaths[0],kind);
    });
    handle('import',async(kind,files)=>{if(!['song','speech','bg'].includes(kind)||!Array.isArray(files)||files.length!==1||typeof files[0]!=='string')throw new Error('Her alana tek bir ses/video dosyası bırakın.');return selected(files[0],kind);});
    handle('inspect',async(kind,file)=>{if(!['song','speech','bg'].includes(kind))throw new Error('Dosya alanı bulunamadı.');engine.checkFile(file,kind);return selected(file,kind);});
    handle('preview-media',async file=>{engine.checkFile(file);const result=await selected(await engine.previewAudio(file));result.name=path.basename(file);return result;});
    handle('export-plan',raw=>engine.exportPlan(raw));
    handle('speech',async raw=>{const settings=validateSettings(raw),file=await engine.previewSpeech(settings),result=await selected(file);result.name=settings.speechMode==='file'?path.basename(settings.speechPath):(settings.voice.startsWith('sapi:')?settings.voice.slice(5):settings.voice.match(/-([A-Za-z0-9]+)Neural$/)?.[1]||'Jenerik')+' · Ses önizlemesi';return result;});
    handle('start',async raw=>{await engine.preflight(raw);return engine.enqueue(raw);});handle('cancel',id=>engine.cancel(String(id)));handle('retry',id=>engine.retry(String(id)));
    const outputFile=id=>{const job=engine.jobs.find(j=>j.id===id);if(job?.status!=='completed'||!job.file||!fs.existsSync(job.file))throw new Error('Tamamlanmış çıktı bulunamadı.');return job.file;};
    handle('output',async id=>selected(outputFile(id)));handle('reveal',id=>shell.showItemInFolder(outputFile(id)));
    handle('job-folder',async id=>{const file=outputFile(id),error=await shell.openPath(path.dirname(file));if(error)throw new Error(error);return path.dirname(file);});
    handle('folder',async()=>{const error=await shell.openPath(engine.outputDir);if(error)throw new Error(error);return engine.outputDir;});
    handle('change-folder',async()=>{if(engine.running)throw new Error('İşlem bitince kayıt klasörünü değiştirebilirsiniz.');const pick=testHooks?.folderQueue.length?{canceled:false,filePaths:[testHooks.folderQueue.shift()]}:await dialog.showOpenDialog(win,{title:'Videonun kaydedileceği klasörü seç',properties:['openDirectory','createDirectory'],defaultPath:engine.outputDir});if(pick.canceled||!pick.filePaths.length)return null;engine.setOutput(pick.filePaths[0]);return engine.outputDir;});
    handle('paste',()=>clipboard.readText());
    handle('save-project',async raw=>{const settings=validateSettings(raw);const pick=await dialog.showSaveDialog(win,{title:'Kurgu ayarlarını kaydet',defaultPath:path.join(base,'Kurgu.kutarya.json'),filters:[{name:'Kutarya kurgu',extensions:['json']}]});if(pick.canceled)return null;atomic(pick.filePath,{app:'kutarya-jenerik',version:1,settings,urls:String(raw.urls||'')});return pick.filePath;});
    handle('load-project',async()=>{const pick=await dialog.showOpenDialog(win,{title:'Kurgu ayarlarını aç',properties:['openFile'],filters:[{name:'Kutarya kurgu',extensions:['json']}]});if(pick.canceled)return null;const stat=await fsp.stat(pick.filePaths[0]);if(stat.size>2000000)throw new Error('Proje dosyası geçersiz.');const data=readJson(pick.filePaths[0],{});if(data.app!=='kutarya-jenerik')throw new Error('Kutarya kurgu dosyası seçin.');const settings=validateSettings(data.settings);for(const file of [settings.songPath,settings.speechPath,settings.bgPath])if(file)authorize(file);engine.updateSettings(settings);return {settings,urls:String(data.urls||'')};});
    handle('clear-cache',async()=>{if(engine.running)throw new Error('Önbelleği temizlemek için devam eden işi bitirin.');let count=0;for(const name of await fsp.readdir(engine.cacheDir)){const target=path.resolve(engine.cacheDir,name);if(path.dirname(target)!==path.resolve(engine.cacheDir))continue;await fsp.rm(target,{recursive:true,force:true});count++;}return count;});
    for(const [name,fn]of [['minimize',()=>win.minimize()],['maximize',()=>win.isMaximized()?win.unmaximize():win.maximize()],['close',()=>win.close()]])ipcMain.on('kty:'+name,event=>{if(allowed(event))fn();});
    engine.on('change',state=>{if(!win.isDestroyed())win.webContents.send('kty:changed',state);});
    win.on('close',event=>{if(!quitting&&engine.running){event.preventDefault();void dialog.showMessageBox(win,{type:'question',title:'Kurgu sürüyor',message:'Devam eden kurgu durdurulup uygulama kapatılsın mı?',buttons:['Devam et','Durdur ve kapat'],defaultId:0,cancelId:0}).then(result=>{if(result.response===1){quitting=true;void engine.shutdown().then(()=>app.quit());}});}});
    await win.loadFile(path.join(__dirname,'../ui/index.html'));
    if(!smoke&&process.argv.includes('--kty-capture')){
      // Kendi başlangıç ekranının kabul kanıtı; port açmadan ve proje üretmeden.
      const proofFolder=path.join(base,'Kanitlar','baslangic');await fsp.mkdir(proofFolder,{recursive:true});
      const limit=Date.now()+20000;while(Date.now()<limit&&!await win.webContents.executeJavaScript('window.uiReady===true'))await new Promise(r=>setTimeout(r,100));
      await win.webContents.executeJavaScript('document.fonts.ready');
      await new Promise(r=>setTimeout(r,400));await fsp.writeFile(path.join(proofFolder,'arayuz.png'),(await win.webContents.capturePage()).toPNG());
      atomic(path.join(proofFolder,'durum.json'),{packaged:app.isPackaged,base,outputDir:engine.outputDir,jobs:engine.jobs.length,version:app.getVersion(),capturedAt:new Date().toISOString()});
    }
    if(smoke){const {selfTest}=require('./selftest.cjs');const report=await selfTest({win,engine,selected,base,testDir,errors,testHooks,packaged:app.isPackaged});atomic(path.join(testDir,'kabul.json'),report);quitting=true;await engine.shutdown();app.exit(report.passed?0:1);}
  }).catch(error=>{if(testDir)atomic(path.join(testDir,'failure.json'),{error:error.stack});else dialog.showErrorBox('Kutarya Jenerik',error.message);app.exit(1);});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(!quitting&&engine?.running){event.preventDefault();quitting=true;void engine.shutdown().then(()=>app.quit());}});
