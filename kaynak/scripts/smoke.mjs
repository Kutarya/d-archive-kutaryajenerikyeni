import {spawn} from 'node:child_process';
import {mkdir,readFile,access} from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve('..'),development=process.argv.includes('--dev'),unpacked=process.argv.includes('--unpacked');
const testDir=path.join(base,'Kanitlar',`${development?'gelistirme':unpacked?'paket-acik':'portable'}-${Date.now()}`);await mkdir(testDir,{recursive:true});
const exe=development?path.resolve('node_modules/electron/dist/electron.exe'):unpacked?path.join(base,'Paketler/win-unpacked/KutaryaJenerik.exe'):path.join(base,'Kutarya Jenerik.exe');await access(exe);
const args=[...(development?['.']:[]),`--kty-test-dir=${testDir}`,'--kty-smoke'];
if(process.argv.includes('--youtube'))args.push('--kty-youtube=https://www.youtube.com/watch?v=YE7VzlLtp-4');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,args,{cwd:process.cwd(),windowsHide:true,shell:false,stdio:'ignore',env});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
let report;try{report=JSON.parse(await readFile(path.join(testDir,'kabul.json'),'utf8'));}catch{throw new Error(`Kabul raporu yok: ${testDir}; çıkış ${code}`);}
console.log(JSON.stringify({testDir,passed:report.passed,packaged:report.packaged,checks:report.checks,failure:report.failure,visualCapture:report.visualCapture},null,2));process.exitCode=report.passed?0:1;
