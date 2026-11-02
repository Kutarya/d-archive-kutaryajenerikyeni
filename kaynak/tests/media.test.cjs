const test=require('node:test'),assert=require('node:assert/strict');
const {parseYouTube,validateSettings,plan,filterGraph,safeName}=require('../electron/media.cjs');
test('YouTube linkleri canonical olur; sahte host/arama/listeler reddedilir',()=>{
  assert.equal(parseYouTube('https://youtu.be/YE7VzlLtp-4?t=2').url,'https://www.youtube.com/watch?v=YE7VzlLtp-4');
  assert.equal(parseYouTube('https://www.youtube.com/shorts/YE7VzlLtp-4').id,'YE7VzlLtp-4');
  for(const url of ['https://youtube.com.evil.com/watch?v=YE7VzlLtp-4','https://youtube.com/results?search_query=a','https://youtube.com/playlist?list=xx','file:///YE7VzlLtp-4'])assert.throws(()=>parseYouTube(url));
});
test('Tam orta, jenerik kadar yeni ara ve şarkının devamı korunur',()=>{
  const timing=plan({duration:221,hasAudio:true,hasVideo:true,width:1920,height:1080},{duration:8,hasAudio:true},validateSettings({}));
  assert.equal(timing.cut,110.5);assert.equal(timing.gap,8.5);assert.equal(timing.total,229.5);assert.equal(timing.head,.25);assert.equal(timing.width,1920);
});
test('Dikey video boyutu korunur, düşük kaynak büyütülmez',()=>{
  const p=plan({duration:30,hasAudio:true,hasVideo:true,width:720,height:1280},{duration:5,hasAudio:true},validateSettings({outputHeight:720}));assert.equal(p.width,406);assert.equal(p.height,720);
  assert.equal(plan({duration:30,hasAudio:true,hasVideo:true,width:640,height:360},{duration:5,hasAudio:true},validateSettings({})).height,360);
});
test('Hatalı kesim veya sessiz kaynak işleme başlatmaz',()=>{
  assert.throws(()=>plan({duration:30,hasAudio:true},{duration:5,hasAudio:true},validateSettings({cutMode:'manual',cutSecond:30})));
  assert.throws(()=>plan({duration:30,hasAudio:false},{duration:5,hasAudio:true},validateSettings({})));
});
test('Jenerik kanalında fade yok; geçiş şarkıya, ducking fona uygulanır',()=>{
  const s=validateSettings({}),source={duration:20,hasAudio:true,hasVideo:true,width:640,height:360};
  const graph=filterGraph(source,plan(source,{duration:4,hasAudio:true},s),s,true);
  const voice=graph.split(';\n').find(l=>l.startsWith('[1:a]'));
  assert(!voice.includes('afade'));assert(graph.includes('[apre]atrim=end=10.000000'));assert(graph.includes('sidechaincompress'));assert(graph.includes('alimiter=limit=0.891:level=false'));
});
test('Fon kapalı ve geçiş sıfırken efekt girdisi istenmez',()=>{
  const s=validateSettings({fade:0,backgroundEnabled:false}),source={duration:20,hasAudio:true,hasVideo:false};
  const graph=filterGraph(source,plan(source,{duration:4,hasAudio:true},s),s,false);assert(!graph.includes('afade'));assert(!graph.includes('[2:a]'));assert(graph.includes('color=c=black'));
});
test('Komut enjekte eden ses kimliği reddedilir; ses/karartma aralıkları güvenli',()=>{
  assert.throws(()=>validateSettings({voice:'x; calc.exe'}));const s=validateSettings({rate:100,voiceGain:100,bgGain:-100,fade:-4});assert.equal(s.rate,50);assert.equal(s.voiceGain,12);assert.equal(s.bgGain,-36);assert.equal(s.fade,0);assert.equal(safeName('../bir: şarkı?'), '.. bir  şarkı');
});
