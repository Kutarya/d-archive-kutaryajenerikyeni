// Kullanımdaki Kutarya Video dosyalarına yalnız okuma yapılır; araçlar ayrı kopyalanır.
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const source='D:/KutaryaVideo/kaynak/vendor',dest=path.resolve('vendor');
await mkdir(path.join(dest,'licenses'),{recursive:true});
const assets=[];
for(const name of await readdir(source)) {
  if (!(/^(yt-dlp|ffmpeg|ffprobe|deno)\.exe$/.test(name)||/\.dll$/i.test(name))) continue;
  const input=path.join(source,name),output=path.join(dest,name);
  await copyFile(input,output);
  const bytes=await readFile(output);
  assets.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const name of await readdir(path.join(source,'licenses'))) await copyFile(path.join(source,'licenses',name),path.join(dest,'licenses',name));
await writeFile(path.join(dest,'manifest.json'),JSON.stringify({date:'2026-10-07',origin:JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8')),assets},null,2));
console.log(`${assets.length} medya aracı/DLL ayrı klasöre doğrulanarak kopyalandı.`);
