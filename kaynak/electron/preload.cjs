const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke('kty:'+name,...args);
contextBridge.exposeInMainWorld('kutarya',{
  state:()=>call('state'),choose:kind=>call('choose',kind),save:settings=>call('save',settings),
  voices:refresh=>call('voices',refresh),speech:settings=>call('speech',settings),start:settings=>call('start',settings),
  cancel:id=>call('cancel',id),retry:id=>call('retry',id),output:id=>call('output',id),reveal:id=>call('reveal',id),
  folder:()=>call('folder'),changeFolder:()=>call('change-folder'),paste:()=>call('paste'),loadProject:()=>call('load-project'),saveProject:settings=>call('save-project',settings),
  clearCache:()=>call('clear-cache'),
  inspect:(kind,file)=>call('inspect',kind,file),previewMedia:file=>call('preview-media',file),exportPlan:settings=>call('export-plan',settings),jobFolder:id=>call('job-folder',id),
  importFiles:(kind,files)=>{try{const paths=Array.from(files).map(file=>webUtils.getPathForFile(file));if(!paths.length||paths.some(file=>!file))return Promise.resolve({ok:false,error:'Dosyayı bilgisayarınızdaki klasörden sürükleyin veya Dosya seç düğmesini kullanın.'});return call('import',kind,paths);}catch{return Promise.resolve({ok:false,error:'Dosya algılanamadı; Dosya seç düğmesini kullanın.'});}},
  minimize:()=>ipcRenderer.send('kty:minimize'),maximize:()=>ipcRenderer.send('kty:maximize'),close:()=>ipcRenderer.send('kty:close'),
  onChange:fn=>{const listener=(_event,data)=>fn(data);ipcRenderer.on('kty:changed',listener);return()=>ipcRenderer.removeListener('kty:changed',listener);}
});
