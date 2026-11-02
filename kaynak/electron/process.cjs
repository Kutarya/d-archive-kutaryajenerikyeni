const {spawn}=require('node:child_process');
const readline=require('node:readline');

// Yalnız kendi alt süreçlerimizi iptal ederiz; kullanıcının açık uygulamalarına dokunulmaz.
function run(file,args,{signal,onLine,cwd,timeout=0}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Object.assign(new Error('İşlem iptal edildi.'),{code:'CANCELLED'}));
    const child=spawn(file,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='',errors='',done=false,timer;
    const append=(kind,line)=>{if(kind==='out')output=(output+'\n'+line).slice(-2000000);else errors=(errors+'\n'+line).slice(-16000);onLine?.(line,kind);};
    const out=readline.createInterface({input:child.stdout}),err=readline.createInterface({input:child.stderr});
    out.on('line',line=>append('out',line));err.on('line',line=>append('err',line));
    const abort=()=>{
      if(done)return;
      if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore',shell:false});
      else child.kill('SIGTERM');
    };
    signal?.addEventListener('abort',abort,{once:true});
    if(timeout)timer=setTimeout(abort,timeout);
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);out.close();err.close();error?reject(error):resolve(result);};
    child.on('error',error=>finish(new Error(`Araç başlatılamadı: ${error.code||'bilinmiyor'}`)));
    child.on('close',code=>{
      if(signal?.aborted)return finish(Object.assign(new Error('İşlem iptal edildi.'),{code:'CANCELLED'}));
      if(code!==0)return finish(Object.assign(new Error((errors||output||`Araç HTTP değil, süreç hata kodu ${code} döndürdü.`).trim()),{exitCode:code}));
      finish(null,{stdout:output.trim(),stderr:errors.trim()});
    });
  });
}
module.exports={run};
