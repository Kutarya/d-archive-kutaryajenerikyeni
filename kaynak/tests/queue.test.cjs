const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Engine}=require('../electron/engine.cjs');
test('Aynı YouTube videosu tekrar kullanıldığında ayrı iş kimlikleri ve kalıcı geçmiş oluşur',()=>{
  const base=path.resolve(__dirname,'../../Kanitlar',`birim-${crypto.randomUUID()}`);
  const options={vendorDir:path.join(base,'arac'),dataDir:path.join(base,'veri'),outputDir:path.join(base,'cikti')};
  const engine=new Engine(options);engine.pump=()=>{};
  const settings={urls:'https://youtu.be/YE7VzlLtp-4',text:'Merhaba',backgroundEnabled:false};
  const [first]=engine.enqueue(settings),[second]=engine.enqueue(settings);
  assert.notEqual(first,second);assert.match(first,/^[a-f0-9-]{36}$/);assert.match(second,/^[a-f0-9-]{36}$/);
  const reload=new Engine(options);assert.equal(reload.jobs.length,2);assert(reload.jobs.every(j=>j.url==='https://www.youtube.com/watch?v=YE7VzlLtp-4'));
});
