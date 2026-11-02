const fs=require('node:fs');
const path=require('node:path');
const {run}=require('../electron/process.cjs');
(async()=>{
  const req=path.resolve('vendor/voices-request.json');fs.writeFileSync(req,JSON.stringify({op:'voices'}));
  try{
    const result=await run(path.resolve('vendor/KutaryaSes.exe'),[req],{timeout:120000});
    const voices=JSON.parse(result.stdout);fs.writeFileSync('vendor/voices.json',JSON.stringify(voices));
    console.log(JSON.stringify({total:voices.length,turkish:voices.filter(v=>v.locale==='tr-TR')}));
  }finally{fs.unlinkSync(req);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
