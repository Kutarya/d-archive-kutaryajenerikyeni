const fs=require('node:fs');const path=require('node:path');
const {run}=require('../electron/process.cjs');
async function fixtures(folder,vendor){
  fs.mkdirSync(folder,{recursive:true});const ff=path.join(vendor,'ffmpeg.exe');
  const song=path.join(folder,'Test şarkısı.mp4'),speech=path.join(folder,'Test jeneriği.wav'),bg=path.join(folder,'Kısa fon.wav');
  await run(ff,['-v','error','-nostdin','-y','-f','lavfi','-i','color=c=0x357994:s=640x360:r=30:d=12','-f','lavfi','-i','sine=frequency=440:duration=12:sample_rate=48000','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=0xc47635:t=fill:enable='gte(t,6)'",'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',song]);
  await run(ff,['-v','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=1000:duration=3:sample_rate=48000','-c:a','pcm_s16le',speech]);
  await run(ff,['-v','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=170:duration=1:sample_rate=48000','-c:a','pcm_s16le',bg]);
  return {song,speech,bg};
}
module.exports={fixtures};
