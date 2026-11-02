'use strict';
const $ = id => document.getElementById(id), api = window.kutarya;
const ACTIVE = new Set(['queued','preparing','downloading','speech','analysing','rendering','saving']);
const statusName = {queued:'Başlıyor',preparing:'Kaynaklar hazırlanıyor',downloading:'Şarkı indiriliyor',speech:'Jenerik hazırlanıyor',analysing:'Sesler dengeleniyor',rendering:'Video oluşturuluyor',saving:'Kaydediliyor',completed:'Tamamlandı',failed:'Tamamlanamadı',cancelled:'İptal edildi',interrupted:'Yarım kaldı'};
let state = {jobs:[],settings:{}}, selected = {song:null,speech:null,bg:null};
let view = 'editor', songSource = 'youtube', speechMode = 'text', busyCount = 0;
let startBusy = false, startCancelled = false, currentJobId = null, resultJob = null;
let exportPreview = null, exportSequence = 0, invalidName = false, saveTimer, planTimer, toastTimer, modalTimer;
const completedShown = new Set(), checking = new Set();
const basename = file => String(file || '').split(/[\\/]/u).at(-1);
const esc = value => String(value ?? '').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = seconds => Number(seconds).toLocaleString('tr-TR',{maximumFractionDigits:1})+' sn';
const elapsed = start => {const seconds = Math.max(0,Math.floor((Date.now()-Date.parse(start))/1000));return seconds<60?seconds+' sn':Math.floor(seconds/60)+' dk '+(seconds%60)+' sn';};
async function call(promise) {
  const result = await promise;
  if (!result?.ok) {const error = new Error(result?.error || 'İşlem tamamlanamadı.'); error.field = result?.field; throw error;}
  return result.value;
}
function toast(message,error=false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = 'toast'+(error?' error':'');
  toastTimer = setTimeout(()=>$('toast').classList.add('hidden'),6500);
}
function clearError() {
  $('form-error').classList.add('hidden');
  document.querySelectorAll('.invalid:not(.output-preview)').forEach(element=>element.classList.remove('invalid'));
}
function errorTarget(field) {return ({song:'local-source',speech:'file-source',bg:'background-section'})[field] || field;}
function showError(error,scroll=true) {
  $('form-error-text').textContent = error.message || String(error); $('form-error').classList.remove('hidden');
  const target = $(errorTarget(error.field)); if(target)target.classList.add('invalid');
  if(scroll&&!$('process-dialog').open) {switchView('editor'); $('form-error').scrollIntoView({block:'start',behavior:'smooth'}); target?.focus?.({preventScroll:true});}
}
async function action(fn,button) {
  if(button)button.disabled = true;
  try {return await fn();} catch(error) {showError(error);}
  finally {if(button)button.disabled = false; updateBusy();}
}
function settings() {
  return {urls:$('song-url').value,songUrl:$('song-url').value,songSource,songPath:songSource==='local'?(selected.song?.path||''):'',
    text:$('jingle-text').value,voice:$('voice-select').value||'tr-TR-EmelNeural',speechMode,speechPath:selected.speech?.path||'',
    bgPath:selected.bg?.path||'',backgroundEnabled:$('background-enabled').checked,fade:Number($('fade').value),
    voiceGain:Number($('voice-gain').value),bgGain:Number($('bg-gain').value),songGain:Number($('song-gain').value),
    rate:Number($('rate').value),pitch:Number($('pitch').value),cutMode:$('cut-mode').value,cutSecond:Number($('cut-second').value),
    outputHeight:Number($('output-height').value),alsoMp3:$('also-mp3').checked,outputName:$('output-name').value};
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{void call(api.save(settings())).catch(error=>{if(error.field!=='output-name')showError(error,false);});},500);
}
function schedulePlan() {clearTimeout(planTimer); planTimer = setTimeout(()=>void refreshExportPlan(),120);}
async function refreshExportPlan() {
  const sequence = ++exportSequence;
  try {
    const plan = await call(api.exportPlan(settings()));
    if(sequence!==exportSequence)return exportPreview;
    exportPreview = plan; invalidName = false;
    $('output-preview').textContent = plan.file; $('mp3-preview').textContent = plan.mp3 || '';
    $('mp3-preview').classList.toggle('hidden',!plan.mp3);
    $('file-count-hint').textContent = plan.count===1?'Tek video dosyası · MP4':'2 dosya · MP4 + MP3';
    const entered = $('output-name').value.trim().replace(/\.mp4$/iu,'');
    $('name-note').classList.toggle('hidden',plan.name===entered);
    $('output-preview').parentElement.classList.remove('invalid');
    updateBusy(); return plan;
  } catch(error) {
    if(sequence!==exportSequence)return null;
    invalidName = true; exportPreview = null; $('output-preview').textContent = error.message;
    $('mp3-preview').classList.add('hidden'); $('name-note').classList.add('hidden');
    $('output-preview').parentElement.classList.add('invalid'); updateBusy(); return null;
  }
}
function updateControls() {
  for(const [id,key] of [['fade','fade-value'],['voice-gain','voice-gain-value'],['bg-gain','bg-gain-value'],['song-gain','song-gain-value']]) {
    const value = Number($(id).value); $(key).textContent = (id==='fade'?'':value>0?'+':'')+value.toLocaleString('tr-TR')+(id==='fade'?' sn':' dB');
  }
  for(const [id,key,unit] of [['rate','rate-value','%'],['pitch','pitch-value',' Hz']]) {
    const value=Number($(id).value); $(key).textContent = value===0?'Normal':(value>0?'+':'')+value+unit;
  }
  $('manual-cut').classList.toggle('hidden',$('cut-mode').value!=='manual');
}
function setSongSource(mode) {
  songSource = mode==='local'?'local':'youtube';
  $('youtube-source').classList.toggle('hidden',songSource!=='youtube'); $('local-source').classList.toggle('hidden',songSource!=='local');
  for(const [id,value] of [['youtube-tab','youtube'],['local-tab','local']]) {
    $(id).classList.toggle('selected',songSource===value); $(id).setAttribute('aria-pressed',String(songSource===value));
  }
}
function setSpeechMode(mode) {
  speechMode = mode==='file'?'file':'text';
  $('text-source').classList.toggle('hidden',speechMode!=='text'); $('file-source').classList.toggle('hidden',speechMode!=='file');
  for(const [id,value] of [['text-tab','text'],['file-tab','file']]) {
    $(id).classList.toggle('selected',speechMode===value); $(id).setAttribute('aria-pressed',String(speechMode===value));
  }
}
function sourceUI() {
  const defaults = {song:['Şarkı dosyası seç','Video veya ses dosyası seçebilir, buraya sürükleyebilirsin.'],speech:['Jenerik sesini seç','Ses dosyanı seç veya buraya sürükle.'],bg:['Fon müziği seçilmedi','Kendi fon müziğini ekleyebilirsin.']};
  for(const kind of ['song','speech','bg']) {
    const media = selected[kind], name = $(kind==='bg'?'bg-name':kind+'-name'), description=$(kind+'-description');
    name.textContent = media?.name || defaults[kind][0]; name.title = media?.path || '';
    description.textContent = checking.has(kind)?'Dosya kontrol ediliyor…':media?.info?'✓ Dosya algılandı · '+duration(media.info.duration):media?'Dosya kontrol ediliyor…':defaults[kind][1];
    const tile = name.closest('.file-tile'); tile.classList.toggle('recognized',!!media?.info); tile.classList.toggle('is-busy',checking.has(kind));
    $('clear-'+kind).classList.toggle('hidden',!media);
  }
  $('listen-file').classList.toggle('hidden',!selected.speech?.info);
  $('listen-bg').classList.toggle('hidden',!selected.bg?.info);
}
function fill(raw) {
  for(const [kind,key] of [['song','songPath'],['speech','speechPath'],['bg','bgPath']]) selected[kind]=raw[key]?{path:raw[key],name:basename(raw[key])}:null;
  $('song-url').value = raw.songUrl || raw.urls || ''; $('jingle-text').value = raw.text || '';
  $('output-name').value = raw.outputName || 'Jenerikli video';
  for(const [id,key,fallback] of [['fade','fade',1],['voice-gain','voiceGain',3.7],['bg-gain','bgGain',-5],['song-gain','songGain',0],['rate','rate',0],['pitch','pitch',0],['cut-mode','cutMode','half'],['cut-second','cutSecond',60],['output-height','outputHeight',1080]]) $(id).value=raw[key]??fallback;
  $('background-enabled').checked=raw.backgroundEnabled===true; $('also-mp3').checked=raw.alsoMp3===true;
  if(raw.voice&&!Array.from($('voice-select').options).some(option=>option.value===raw.voice))$('voice-select').add(new Option(raw.voice,raw.voice));
  $('voice-select').value=raw.voice||'tr-TR-EmelNeural';
  setSongSource(raw.songSource || (raw.songPath?'local':'youtube')); setSpeechMode(raw.speechMode); sourceUI(); updateControls();
}
async function restoreFiles() {
  busyCount++; updateBusy();
  await Promise.all(['song','speech','bg'].map(async kind=>{
    if(!selected[kind])return;
    const file=selected[kind].path; checking.add(kind); sourceUI();
    try {selected[kind] = await call(api.inspect(kind,file));}
    catch(error) {selected[kind]=null; if(kind==='bg')$('background-enabled').checked=false; showError(error,false);}
    finally {checking.delete(kind); sourceUI();}
  }));
  busyCount--; updateBusy();
}
async function acceptMedia(kind,promise) {
  if(startBusy||state.jobs.some(job=>ACTIVE.has(job.status)))return;
  busyCount++; checking.add(kind); updateBusy(); sourceUI();
  try {
    const media = await call(promise); if(!media)return;
    selected[kind] = media;
    if(kind==='song')setSongSource('local');
    if(kind==='speech')setSpeechMode('file');
    if(kind==='bg')$('background-enabled').checked=true;
    clearError(); sourceUI(); scheduleSave();
  } catch(error) {
    selected[kind]=null; if(kind==='bg')$('background-enabled').checked=false; showError(error);
  } finally {checking.delete(kind);busyCount--;sourceUI();updateBusy();}
}
function updateBusy() {
  const running = state.jobs.find(job=>ACTIVE.has(job.status)), locked=busyCount>0||startBusy||!!running;
  $('editor-fields').disabled = locked;
  $('create').disabled = locked || (view==='editor'&&invalidName);
  $('tab-create').disabled = startBusy||!!running; $('tab-history').disabled = startBusy||!!running;
  $('create').innerHTML = running||startBusy?'Video hazırlanıyor…':busyCount?'Dosya kontrol ediliyor…':view==='history'?'Yeni video oluştur <span>→</span>':'Videoyu oluştur <span>→</span>';
  $('footer-status').textContent = running?running.detail:busyCount?'Seçilen dosyalar kontrol ediliyor.':invalidName?'Geçerli bir video adı yaz.':'Videonun adı ve kayıt konumu yukarıda.';
}
function switchView(next) {
  view = next==='history'?'history':'editor';
  $('editor-view').classList.toggle('hidden',view!=='editor'); $('history-view').classList.toggle('hidden',view!=='history');
  $('page-title').textContent = view==='editor'?'Jenerikli video oluştur':'Videolarım';
  $('page-description').textContent = view==='editor'?'Şarkını ekle, jeneriğini seç, videonu kaydet.':'Oluşturulan videolar ve önceki işlemler.';
  for(const button of document.querySelectorAll('[data-view]')) {button.classList.toggle('selected',button.dataset.view===view);button.setAttribute('aria-pressed',String(button.dataset.view===view));}
  updateBusy();
}
function renderJobs() {
  $('done-count').textContent = state.jobs.filter(job=>job.status==='completed').length;
  $('all-jobs').innerHTML = state.jobs.length?[...state.jobs].reverse().map(job=>{
    const pending=ACTIVE.has(job.status), filename=basename(job.file||job.plannedFile)||job.outputName||job.title;
    return '<article class="job-card '+esc(job.status)+'" data-id="'+esc(job.id)+'"><div class="job-icon">'+(job.status==='completed'?'✓':job.status==='failed'?'!':pending?'↻':'−')+'</div><div class="job-main"><strong>'+esc(filename)+'</strong><p>'+esc(job.detail||statusName[job.status])+'</p><p>'+esc(job.file||job.plannedFile||job.outputDir)+'</p>'+(job.mp3?'<p>Ek MP3: '+esc(basename(job.mp3))+'</p>':'')+(pending?'<progress max="100" value="'+(Number(job.progress)||0)+'"></progress>':'')+'</div><div><span class="job-status">'+esc(statusName[job.status]||job.status)+'</span><div class="job-actions">'+(job.status==='completed'?'<button data-job-action="play">▶ İzle</button><button data-job-action="folder">Klasörü aç</button>':pending?'<button data-job-action="progress">İlerleme</button>':'<button data-job-action="retry">Tekrar dene</button>')+'</div></div></article>';
  }).join(''):'<div class="empty-jobs"><strong>İlk videon burada görünecek.</strong>Oluştur bölümünden şarkı ve jenerik ekleyebilirsin.</div>';
}
function modalDestination(file,mp3,folder,complete=false) {
  $('modal-file-label').textContent=complete?'DOSYA KAYDEDİLDİ':'KAYDEDİLECEK DOSYA';
  $('modal-file').textContent=basename(file)||'Jenerikli video.mp4';
  $('modal-extra').textContent=mp3?'Ek ses: '+basename(mp3):''; $('modal-extra').classList.toggle('hidden',!mp3);
  $('modal-dir').textContent=folder||state.outputDir;
}
function openProcess(job) {
  $('process-dialog').className=''; $('process-dialog').querySelector('.spinner').classList.remove('hidden'); $('process-symbol').classList.add('hidden');
  $('modal-title').textContent='Video hazırlanıyor'; $('modal-detail').textContent='Dosyalar ve kayıt konumu kontrol ediliyor…';
  $('modal-phase').textContent='Kontrol ediliyor'; $('modal-percent').textContent=''; $('modal-progress').removeAttribute('value');
  $('modal-progress-area').classList.remove('hidden'); $('modal-cancel').classList.remove('hidden'); $('modal-cancel').disabled=false; $('modal-cancel').textContent='İptal et';
  for(const id of ['modal-play','modal-folder','modal-retry','modal-close'])$(id).classList.add('hidden');
  $('modal-time').textContent='Bu pencerede işlem sonucunu göreceksin.';
  modalDestination(exportPreview?.file,exportPreview?.mp3,exportPreview?.outputDir);
  if(!$('process-dialog').open)$('process-dialog').showModal();
  clearInterval(modalTimer); modalTimer=setInterval(()=>{const current=state.jobs.find(item=>item.id===currentJobId);if(current&&ACTIVE.has(current.status))$('modal-time').textContent='Geçen süre: '+elapsed(current.startedAt||current.createdAt);},1000);
  if(job){currentJobId=job.id;updateProcess(job);}
}
function updateProcess(job) {
  const pending=ACTIVE.has(job.status); modalDestination(job.file||job.plannedFile,job.mp3||job.plannedMp3,job.outputDir,job.status==='completed');
  if(pending) {
    $('modal-title').textContent=startCancelled?'İşlem durduruluyor':'Video hazırlanıyor'; $('modal-detail').textContent=job.detail;
    $('modal-phase').textContent=statusName[job.status]; $('modal-percent').textContent='%'+Math.round(job.progress||0); $('modal-progress').value=job.progress||0;
    const phase={queued:0,preparing:0,downloading:0,speech:1,analysing:1,rendering:2,saving:3}[job.status];
    document.querySelectorAll('.process-steps li').forEach(element=>{const index=Number(element.dataset.phase);element.classList.toggle('done',index<phase);element.classList.toggle('current',index===phase);});
    return;
  }
  clearInterval(modalTimer); $('process-dialog').className=job.status==='completed'?'completed':job.status==='failed'?'failed':'cancelled';
  $('process-dialog').querySelector('.spinner').classList.add('hidden'); $('process-symbol').classList.remove('hidden');
  $('process-symbol').textContent=job.status==='completed'?'✓':job.status==='failed'?'!':'−';
  $('modal-cancel').classList.add('hidden'); $('modal-close').classList.remove('hidden'); $('modal-close').textContent='Tamam';
  $('modal-play').classList.toggle('hidden',job.status!=='completed'); $('modal-folder').classList.toggle('hidden',job.status!=='completed');
  $('modal-retry').classList.toggle('hidden',!['failed','cancelled','interrupted'].includes(job.status));
  $('modal-title').textContent=job.status==='completed'?'Videon hazır!':job.status==='failed'?'Video oluşturulamadı':job.status==='cancelled'?'İşlem iptal edildi':'İşlem yarım kaldı';
  $('modal-detail').textContent=job.status==='completed'?(job.mp3?'MP4 video ve istediğin MP3 ses dosyası kaydedildi.':'MP4 videon aşağıdaki konuma kaydedildi.'):job.error||job.detail;
  $('modal-progress-area').classList.toggle('hidden',job.status!=='completed'); $('modal-progress').value=100; $('modal-phase').textContent='Tamamlandı'; $('modal-percent').textContent='%100';
  $('modal-time').textContent=job.status==='completed'?'Toplam süre: '+elapsed(job.startedAt||job.createdAt):'Tamamlanmış bir çıktı kaydedilmedi.';
  if(job.status==='completed'&&!completedShown.has(job.id)) {completedShown.add(job.id);displayResult(job);$('result-card').scrollIntoView({block:'center',behavior:'smooth'});void refreshExportPlan();}
}
function modalError(error) {
  clearInterval(modalTimer); $('process-dialog').className='failed'; $('process-dialog').querySelector('.spinner').classList.add('hidden');
  $('process-symbol').classList.remove('hidden'); $('process-symbol').textContent='!';
  $('modal-title').textContent='Video oluşturulmadı'; $('modal-detail').textContent=error.message;
  $('modal-progress-area').classList.add('hidden'); $('modal-cancel').classList.add('hidden');
  for(const id of ['modal-play','modal-folder','modal-retry'])$(id).classList.add('hidden');
  $('modal-close').classList.remove('hidden'); $('modal-close').textContent='Bilgileri düzelt'; $('modal-time').textContent='Dosyaların değiştirilmedi. Sorunu düzelterek tekrar başlatabilirsin.';
  showError(error,false);
}
function closeProcess() {$('process-dialog').close();clearInterval(modalTimer);if(resultJob)$('result-card').scrollIntoView({block:'center',behavior:'smooth'});else if(!$('form-error').classList.contains('hidden'))$('form-error').scrollIntoView({block:'start',behavior:'smooth'});}
function displayResult(job) {
  resultJob=job; $('result-card').classList.remove('hidden'); $('result-name').textContent=basename(job.file);
  $('result-path').textContent=job.file; $('result-summary').textContent=(job.mp3?'MP4 + MP3 kaydedildi.':'Tek MP4 video kaydedildi.')+' · Video süresi: '+duration(job.outputInfo?.duration||job.timing?.total);
}
function validationError(message,field) {const error=new Error(message);error.field=field;return error;}
function validateForm() {
  if(songSource==='local'&&!selected.song?.info)throw validationError('Şarkı dosyasını seç ve kontrolün bitmesini bekle.','song');
  if(songSource==='youtube'&&!$('song-url').value.trim())throw validationError('YouTube şarkı bağlantısını yapıştır veya Bilgisayarımdaki dosya seçeneğini kullan.','song-url');
  if(speechMode==='text'&&!$('jingle-text').value.trim())throw validationError('Jenerik metnini yaz veya Hazır sesim var seçeneğini kullan.','jingle-text');
  if(speechMode==='file'&&!selected.speech?.info)throw validationError('Jenerik ses dosyasını seç.','speech');
  if($('background-enabled').checked&&!selected.bg?.info)throw validationError('Fon müziğini seç veya Fon müziği kullan seçeneğini kapat.','bg');
  if(!$('output-name').value.trim())throw validationError('Videona bir ad ver.','output-name');
}
async function start() {
  if(view==='history'){switchView('editor');return;}
  if(startBusy||busyCount||state.jobs.some(job=>ACTIVE.has(job.status)))return;
  try{validateForm();}catch(error){showError(error);return;}
  clearError();clearTimeout(saveTimer);startBusy=true;startCancelled=false;currentJobId=null;updateBusy();
  openProcess();
  try {
    const plan=await refreshExportPlan();if(!plan)throw validationError($('output-preview').textContent,'output-name');
    modalDestination(plan.file,plan.mp3,plan.outputDir);
    const result=await call(api.start({...settings(),startToken:crypto.randomUUID()}));
    currentJobId=result.ids[0];
    state=await call(api.state());renderState(state);
    if(startCancelled)await call(api.cancel(currentJobId));
  } catch(error){modalError(error);}
  finally {startBusy=false;updateBusy();}
}
async function retry(id) {
  if(startBusy||busyCount||state.jobs.some(job=>ACTIVE.has(job.status)))return;
  clearError();startBusy=true;startCancelled=false;currentJobId=id;openProcess(state.jobs.find(job=>job.id===id));updateBusy();
  try {await call(api.retry(id));state=await call(api.state());renderState(state);}
  catch(error){currentJobId=null;modalError(error);} finally{startBusy=false;updateBusy();}
}
function renderState(snapshot) {
  state=snapshot; $('output-dir').textContent=state.outputDir; renderJobs();
  const running=state.jobs.find(job=>ACTIVE.has(job.status));
  if(startBusy&&!currentJobId&&running)currentJobId=running.id;
  const current=state.jobs.find(job=>job.id===currentJobId);
  if(current&&$('process-dialog').open)updateProcess(current);
  $('work-status').classList.toggle('hidden',!running);
  $('work-status-detail').textContent=running?running.detail+' · '+basename(running.plannedFile):'';
  updateBusy();
}
function showAudio(media) {
  $('speech-audio').pause();$('speech-audio').src=media.url;$('audio-name').textContent=media.name;$('audio-player').classList.remove('hidden');
  $('speech-audio').load();void $('speech-audio').play().catch(()=>{});
}
async function previewJob(id) {
  const job=state.jobs.find(item=>item.id===id);if(!job)return;
  const media=await call(api.output(id));switchView('editor');displayResult(job);closeProcess();
  const video=$('video-preview');video.pause();video.src=media.url;video.classList.remove('hidden');video.load();
  $('result-card').scrollIntoView({block:'start',behavior:'smooth'});
  await video.play().catch(()=>toast('Oynatmak için videonun oynat düğmesine bas.'));
}
async function listen(fn,button) {
  busyCount++;updateBusy();
  await action(async()=>{const media=await fn();showAudio(media);},button);
  busyCount--;updateBusy();
}
async function loadVoices(refresh=false) {
  const chosen=$('voice-select').value,list=await call(api.voices(refresh));if(!list.length)return;
  const groups=[['Türkçe',voice=>voice.locale==='tr-TR'&&!voice.offline],['Windows · çevrimdışı',voice=>voice.offline],['Diğer diller',voice=>voice.locale!=='tr-TR'&&!voice.offline]];
  $('voice-select').replaceChildren();
  for(const [name,filter] of groups) {
    const voices=list.filter(filter).sort((a,b)=>a.locale.localeCompare(b.locale,'tr')||a.name.localeCompare(b.name,'tr'));if(!voices.length)continue;
    const group=document.createElement('optgroup');group.label=name;
    for(const voice of voices)group.append(new Option((voice.id.match(/-(\w+)Neural$/u)?.[1]||voice.name)+' · '+(voice.gender==='Female'?'Kadın':voice.gender==='Male'?'Erkek':voice.gender)+' · '+voice.locale,voice.id));
    $('voice-select').append(group);
  }
  if(Array.from($('voice-select').options).some(option=>option.value===chosen))$('voice-select').value=chosen;
}
for(const [id,fn] of [['minimize',()=>api.minimize()],['maximize',()=>api.maximize()],['close',()=>api.close()]])$(id).addEventListener('click',fn);
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
for(const [id,mode] of [['youtube-tab','youtube'],['local-tab','local']])$(id).addEventListener('click',()=>{setSongSource(mode);clearError();scheduleSave();});
for(const [id,mode] of [['text-tab','text'],['file-tab','file']])$(id).addEventListener('click',()=>{setSpeechMode(mode);clearError();scheduleSave();});
for(const [id,kind] of [['choose-song','song'],['choose-speech','speech'],['choose-bg','bg']])$(id).addEventListener('click',()=>void acceptMedia(kind,api.choose(kind)));
for(const kind of ['song','speech','bg'])$('clear-'+kind).addEventListener('click',()=>{selected[kind]=null;if(kind==='bg')$('background-enabled').checked=false;sourceUI();scheduleSave();});
$('paste-url').addEventListener('click',()=>void action(async()=>{$('song-url').value=(await call(api.paste())).trim();setSongSource('youtube');clearError();scheduleSave();},$('paste-url')));
$('dismiss-error').addEventListener('click',clearError);
$('create').addEventListener('click',()=>void start());
$('change-folder').addEventListener('click',()=>void action(async()=>{const folder=await call(api.changeFolder());if(folder){state.outputDir=folder;$('output-dir').textContent=folder;await refreshExportPlan();}},$('change-folder')));
$('preview-speech').addEventListener('click',()=>{if(!$('jingle-text').value.trim()){showError(validationError('Önce jenerik metnini yaz.','jingle-text'));return;}void listen(()=>call(api.speech(settings())),$('preview-speech'));});
$('listen-file').addEventListener('click',()=>void listen(()=>call(api.speech(settings())),$('listen-file')));
$('listen-bg').addEventListener('click',()=>void listen(()=>call(api.previewMedia(selected.bg.path)),$('listen-bg')));
$('close-audio').addEventListener('click',()=>{$('speech-audio').pause();$('audio-player').classList.add('hidden');});
$('speech-audio').addEventListener('error',()=>toast('Ses önizlemesi açılamadı. Dosyayı yeniden seçip tekrar dinleyebilirsin.',true));
$('video-preview').addEventListener('error',()=>toast('Video önizlemesi açılamadı. Klasörü aç düğmesinden dosyayı açabilirsin.',true));
$('modal-cancel').addEventListener('click',()=>{startCancelled=true;$('modal-cancel').disabled=true;$('modal-cancel').textContent='Durduruluyor…';if(currentJobId)void action(()=>call(api.cancel(currentJobId)));});
$('modal-close').addEventListener('click',closeProcess);
$('modal-retry').addEventListener('click',()=>void retry(currentJobId));
$('modal-play').addEventListener('click',()=>void action(()=>previewJob(currentJobId),$('modal-play')));
$('modal-folder').addEventListener('click',()=>void action(()=>call(api.jobFolder(currentJobId)),$('modal-folder')));
$('show-progress').addEventListener('click',()=>{const job=state.jobs.find(item=>ACTIVE.has(item.status));if(job)openProcess(job);});
$('process-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!startBusy&&!state.jobs.some(job=>job.id===currentJobId&&ACTIVE.has(job.status)))closeProcess();});
$('result-play').addEventListener('click',()=>void action(()=>previewJob(resultJob.id),$('result-play')));
$('result-folder').addEventListener('click',()=>void action(()=>call(api.jobFolder(resultJob.id)),$('result-folder')));
$('save-project').addEventListener('click',()=>void action(async()=>{const file=await call(api.saveProject(settings()));if(file)toast('Ayarlar kaydedildi. Video oluşturmak için Videoyu oluştur düğmesini kullan.');},$('save-project')));
$('load-project').addEventListener('click',()=>void action(async()=>{const project=await call(api.loadProject());if(!project)return;fill({...project.settings,songUrl:project.urls});await restoreFiles();await refreshExportPlan();switchView('editor');toast('Ayarlar açıldı. Henüz yeni bir video oluşturulmadı.');},$('load-project')));
$('refresh-voices').addEventListener('click',()=>void action(()=>loadVoices(true),$('refresh-voices')));
$('clear-cache').addEventListener('click',()=>void action(async()=>{await call(api.clearCache());toast('Geçici dosyalar temizlendi. Videoların duruyor.');},$('clear-cache')));
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-job-action]');if(!button)return;
  const id=button.closest('[data-id]').dataset.id,kind=button.dataset.jobAction;
  void action(()=>kind==='play'?previewJob(id):kind==='folder'?call(api.jobFolder(id)):kind==='progress'?openProcess(state.jobs.find(job=>job.id===id)):retry(id),button);
});
for(const id of ['song-url','jingle-text','voice-select','background-enabled','fade','voice-gain','bg-gain','song-gain','rate','pitch','cut-mode','cut-second','output-height','also-mp3','output-name'])$(id).addEventListener('input',()=>{updateControls();scheduleSave();if(['output-name','also-mp3'].includes(id))schedulePlan();});
document.querySelectorAll('[data-drop]').forEach(zone=>{
  zone.addEventListener('dragover',event=>{event.preventDefault();if(!$('editor-fields').disabled)zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',event=>{event.preventDefault();zone.classList.remove('drag-over');if(!$('editor-fields').disabled)void acceptMedia(zone.dataset.drop,api.importFiles(zone.dataset.drop,event.dataTransfer.files));});
});
document.addEventListener('dragover',event=>event.preventDefault());document.addEventListener('drop',event=>event.preventDefault());
api.onChange(renderState);
async function init() {
  state=await call(api.state());fill(state.settings);renderState(state);await restoreFiles();await refreshExportPlan();window.uiReady=true;
  void loadVoices().catch(()=>{});
}
init().catch(error=>{showError(error);updateBusy();});
