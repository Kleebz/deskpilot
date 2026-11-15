// App-shell identity is independent of the selected computer's backend version.
export const uiBuild = typeof __DESKPILOT_UI_BUILD__ === 'string' ? __DESKPILOT_UI_BUILD__ : 'development';
export const updates = $state({available:'',checking:false,error:'',cached:false,checkedAt:0});
let registration, starting, started=false;

function workerBuild(worker) {
  return new Promise(resolve=>{
    if(!worker)return resolve('');
    const channel=new MessageChannel();
    const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish(''),1500);
    channel.port1.onmessage=e=>finish(typeof e.data?.build==='string'?e.data.build:'');
    try{worker.postMessage({type:'DESKPILOT_BUILD'},[channel.port2]);}catch{finish('');}
  });
}
async function inspect(worker) {
  const build=await workerBuild(worker);
  if(build&&build!==uiBuild){updates.available=build;updates.error='';}
}
function watch(worker) {
  if(!worker)return;
  const changed=()=>{if(['installed','activated'].includes(worker.state))inspect(worker);else if(worker.state==='redundant'&&!updates.available)updates.error='The app update could not be installed. Current UI kept.';};
  worker.addEventListener('statechange',changed);changed();
}
export function startUpdates() {
  if(started)return starting;
  started=true;
  starting=(async()=>{
    if(!('serviceWorker'in navigator))return null;
    try{
      registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
      registration.addEventListener('updatefound',()=>watch(registration.installing));
      watch(registration.installing);
      if(registration.waiting)inspect(registration.waiting);
      if(registration.active)inspect(registration.active);
      navigator.serviceWorker.addEventListener('controllerchange',()=>inspect(navigator.serviceWorker.controller));
      return registration;
    }catch{return null;}
  })();
  const foreground=()=>{if(!document.hidden&&Date.now()-updates.checkedAt>30000)checkUpdates();};
  document.addEventListener('visibilitychange',foreground);
  window.addEventListener('pageshow',foreground);
  window.addEventListener('online',()=>checkUpdates());
  if(document.readyState==='complete')checkUpdates();else window.addEventListener('load',()=>checkUpdates(),{once:true});
  return starting;
}
export async function checkUpdates() {
  if(updates.checking)return;
  updates.checking=true;updates.error='';
  try{
    const response=await fetch('/ui-build.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error(response.status===404?'This app source does not provide update information yet.':'Could not check the app source.');
    const info=await response.json();
    if(typeof info.build!=='string')throw Error('App update information is unavailable.');
    updates.cached=false;
    const reg=await(started?starting:startUpdates());
    if(reg){
      await reg.update();
      if(reg.waiting)await inspect(reg.waiting);
      else if(reg.active)await inspect(reg.active);
    }else if(info.build!==uiBuild){
      // Without a worker the new document is already network-served.
      updates.available=info.build;
    }
  }catch(e){
    updates.cached=e instanceof TypeError||e?.name==='TimeoutError'||!navigator.onLine;
    updates.error=updates.cached?'App source cannot be reached. Using the saved UI when available.':e.message;
  }finally{updates.checkedAt=Date.now();updates.checking=false;}
}
