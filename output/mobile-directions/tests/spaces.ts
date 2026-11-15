// Isolated UI checks. Start `npm run dev` first. No Deskpilot service is accessed.
import { connect } from './cdp.ts';
const profile = await Deno.makeTempDir({ prefix: 'dp-directions-' });
const out = new URL('../artifacts/spaces/', import.meta.url);
await Deno.mkdir(out, { recursive: true });
const chrome = new Deno.Command('chromium', { args: ['--headless=new', '--disable-background-networking', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9389', `--user-data-dir=${profile}`, 'about:blank'], stdout: 'null', stderr: 'null' }).spawn();
const pause = (ms = 60) => new Promise(r => setTimeout(r, ms));
let cdp;
const report: { checks: string[], layouts: unknown[] } = { checks: [], layouts: [] };
try {
  let endpoint;
  for (let n = 0; n < 80; n++) { try { endpoint = (await (await fetch('http://127.0.0.1:9389/json/version')).json()).webSocketDebuggerUrl; break; } catch { await pause(); } }
  if (!endpoint) throw Error('Chromium did not start');
  cdp = await connect(endpoint);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method: string, params = {}) => cdp!.send(method, params, sessionId);
  const run = async (expression: string) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const frame = (source: string) => run(`document.querySelector('iframe').contentWindow.eval(${JSON.stringify(source)})`);
  const until = async (source: string) => { for (let n = 0; n < 90; n++) { try { if (await frame(source)) return; } catch {} await pause(); } throw Error(`Timed out: ${source}\n${await frame('document.body.innerText')}`); };
  const check = async (source: string, label: string) => { if (!await frame(source)) throw Error(label + '\n' + await frame('document.body.innerText')); report.checks.push(label); console.log('✓ ' + label); };
  const click = async (label: string, scope = 'document') => { const success = await frame(`(() => { const el=[...${scope}.querySelectorAll('button')].find(b => b.getAttribute('aria-label')===${JSON.stringify(label)} || b.textContent.trim()===${JSON.stringify(label)} || b.innerText.trim().replace(/\\s+/g,' ')===${JSON.stringify(label)}); if(!el || el.disabled) return false; el.focus(); el.click(); return true; })()`); if (!success) throw Error('Button not found/enabled: ' + label + '\n' + await frame('document.body.innerText')); await pause(90); };
  const row = async (id: string) => { await frame(`document.querySelector('[data-item=${JSON.stringify(id)}]').click()`); await pause(100); };
  const input = async (selector: string, value: string) => { await frame(`{const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true}));}`); await pause(); };
  const select = async (selector: string, value: string) => { await frame(`{const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true}));}`); await pause(); };
  const stored = (d: string) => `JSON.parse(localStorage.getItem('deskpilot-mobile-directions:v1:${d}'))`;
  const reload = async () => { await frame('location.reload()'); await pause(250); await until('!!document.querySelector(".app-shell[data-organization-ready=true]")'); };
  const size = async (w: number,h: number) => { await run(`{const f=document.querySelector('iframe'); f.style.width='${w}px';f.style.height='${h}px';}`); await pause(); };
  const fresh = async (d: string) => {
    await run(`localStorage.removeItem('deskpilot-mobile-directions:v1:${d}'); document.querySelector('iframe')?.remove(); {const f=document.createElement('iframe'); f.src='/${d}'; f.style.cssText='width:390px;height:844px;border:0;display:block;';document.body.append(f);}`);
    await until('!!document.querySelector(".app-shell[data-organization-ready=true]")');
  };
  const swipe = async (vertical = false, reverse = false) => {
    const box = await frame(`(()=>{const r=document.querySelector('.terminal-frame').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    const coords = [.72,.57,.42,.27].map(n=>({x:box.x+box.w*(vertical?.5:reverse?1-n:n), y:box.y+box.h*(vertical?n:.5)}));
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[coords[0]]});
    for(const point of coords.slice(1)) { await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]}); await pause(20); }
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await pause(120);
  };
  const screenshot = async (name: string, w = 390,h = 844) => { const result = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0,y: 0,width:w,height:h,scale:1 } }); await Deno.writeFile(new URL(name+'.png',out), Uint8Array.from(atob(result.data),c=>c.charCodeAt(0))); };
  const layout = async (label: string) => {
    const metrics = await frame(`(() => { const root=document.documentElement; const visible=[...document.querySelectorAll('button,a[href],input,select,textarea')].filter(e=>e.getClientRects().length && !e.closest('[inert]') && getComputedStyle(e).visibility!=='hidden'); return {width:innerWidth,height:innerHeight,overflow:root.scrollWidth>innerWidth,short:visible.filter(e=>e.getBoundingClientRect().height<43.9).map(e=>({text:e.getAttribute('aria-label')||e.textContent.trim(),height:e.getBoundingClientRect().height})),escaped:visible.filter(e=>{const r=e.getBoundingClientRect();return !e.closest('.task-tabs,.pane-tabs') && (r.left < -.5 || r.right > innerWidth+.5)}).map(e=>e.getAttribute('aria-label')||e.textContent.trim()),terminal:document.querySelector('.terminal-frame')?.getBoundingClientRect().height,composer:document.querySelector('.composer textarea')?.getBoundingClientRect().width}; })()`);
    report.layouts.push({ label, ...metrics });
    if (metrics.overflow || metrics.short.length || metrics.escaped.length) throw Error(label + ': ' + JSON.stringify(metrics));
    if (metrics.width === 390 && metrics.height === 430 && metrics.terminal && metrics.terminal < 258) throw Error('Less than 60% terminal output: '+JSON.stringify(metrics)+' / '+await frame(`JSON.stringify([...document.querySelectorAll('.app-shell,.spaces-workbench,.terminal-header,.task-tabs,.pane-tabs,.terminal-context,.terminal-frame,.composer,.spaces-tools,.prototype-strip,.organization-status')].map(e=>({cls:e.className,h:e.getBoundingClientRect().height,display:getComputedStyle(e).display,flex:getComputedStyle(e).flex})))`));
  };
  const sessions = async (d: string) => { await click(d === 'inbox' ? '☷Library' : '☷Sessions'); };
  const computerDestination = async (label: string) => { await frame(`(document.querySelector('.computer-picker') || document.querySelector('.bottom-dock button:last-child')).click()`); await pause(); await click(label+' →', 'document.querySelector(".sheet")'); };
  await send('Page.enable');
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const sampleRun='test-'+crypto.randomUUID();
  await send('Page.addScriptToEvaluateOnNewDocument', {source:`if(location.protocol==='http:')localStorage.setItem('deskpilot-mobile-directions:sample-namespace','${sampleRun}');window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));`});
  await send('Emulation.setDeviceMetricsOverride', {width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate', {url:'http://127.0.0.1:5178/'}); await pause(400);
  await screenshot('launcher',1280,1000);
  await run(`document.body.innerHTML='';document.body.style.cssText='margin:0;background:#131613';`);

  await fresh('spaces');
  await until('!!document.querySelector(".composer")');
  await check(`${stored('spaces')}.selected==='tmux-0' && document.querySelector('.title-picker').textContent.includes('Unassigned')`, 'Opens recent terminal with explicit Unassigned context');
  await check(`!document.querySelector('.bottom-dock') && document.querySelectorAll('.spaces-tools button').length===3`, 'One work drawer replaces source sections and competing primary tabs');
  for(const w of [320,360,390,430]){await size(w,844);await layout('Terminal '+w);}
  await size(390,844);await screenshot('terminal');
  await input('.composer textarea','keep this exact recipient');
  await click('Open spaces');
  await until('!!document.querySelector(".space-browser")');
  await check(`document.querySelectorAll('[data-space]').length===4 && document.querySelector('[data-space="unassigned:studio"]').textContent.includes('8 terminals') && document.querySelector('[aria-label="Toggle Available conversations"]').getAttribute('aria-expanded')==='false'`, 'Native spaces, ordinary work and collapsed available conversations share one browser');
  for(const w of [320,360,390,430]){await size(w,844);await layout('Spaces drawer '+w);}
  await size(390,844);await screenshot('drawer');
  await check(`document.querySelector('.space-filters button:last-child').textContent.trim().endsWith('3')`, 'Drawer attention badge counts only the selected computer');
  await frame(`document.querySelector('.space-across input').click()`);await pause();
  await check(`document.querySelector('.space-filters button:last-child').textContent.trim().endsWith('4')`, 'Across-computer scope updates the attention badge');
  await frame(`document.querySelector('.space-across input').click()`);await pause();
  await frame(`document.querySelector('.sheet-body').scrollTop=250`);await pause();await click('Close panel');await click('Open spaces');
  await check(`document.querySelector('.sheet-body').scrollTop>=240 && document.activeElement.getAttribute('aria-label')==='Close panel'`, 'Drawer restores scroll without opening the search keyboard');
  await frame(`document.querySelector('.sheet-body').scrollTop=0`);await pause();
  await input('[aria-label="Search spaces and work"]','reconnect race');
  await check(`document.querySelectorAll('[data-item]').length===1 && document.querySelector('[data-item="codex-1"]').textContent.includes('Connect')`, 'Search finds long conversation titles with explicit connection');
  await row('codex-1');await click('Connect mobile view');await click('Cancel connection');await pause(550);
  await check(`${stored('spaces')}.selected==='tmux-0' && !!document.querySelector('.work-drawer')`, 'Canceling delayed connection keeps original terminal and search');
  await input('[aria-label="Search spaces and work"]','');await click('Toggle Product');await row('herdr-0');
  await until(`${stored('spaces')}.selected==='herdr-0' && !document.querySelector('.sheet')`);
  await check(`document.querySelector('.title-picker').textContent.includes('Product / Mobile') && document.querySelectorAll('.pane-tabs button').length===2 && ${stored('spaces')}.sequence.join(',')==='herdr-0,herdr-1'`, 'Native task keeps exact space, tab, pane membership and swipe scope');
  await input('.composer textarea','native draft');await frame('document.querySelector(".composer textarea").focus()');await swipe();
  await check(`${stored('spaces')}.selected==='herdr-1' && document.querySelector('.composer textarea').value==='' && document.activeElement===document.querySelector('.composer textarea')`, 'Sibling terminal receives separate draft and retains composer focus');
  await click('Previous session');await check(`document.querySelector('.composer textarea').value==='native draft'`, 'Native draft returns to exact original pane');
  await frame('document.querySelector(".composer textarea").blur()');await frame(`document.querySelectorAll('.task-tabs button')[1].click()`);await pause();await click('Connect mobile view');await until('!document.querySelector(".sheet")');
  await check(`${stored('spaces')}.selected==='herdr-2' && ${stored('spaces')}.sequence.join(',')==='herdr-2,herdr-3'`, 'Task tabs switch tasks and seed only their own terminal sequence');
  await frame(`document.querySelectorAll('.task-tabs button')[0].click()`);await pause();await screenshot('native-task');
  for(const [w,h] of [[320,430],[390,430],[932,430]]){await size(w,h);await frame('document.querySelector(".composer textarea").focus()');await layout('Reduced terminal '+w+'x'+h);}
  await size(390,430);await screenshot('keyboard',390,430);await size(390,844);await frame('document.querySelector(".composer textarea").blur()');
  await click('Open spaces');await input('[aria-label="Search spaces and work"]','tmux-0');await row('tmux-0');await until('!document.querySelector(".sheet")');
  await check(`document.querySelector('.composer textarea').value==='keep this exact recipient'`, 'Changing source types preserves ordinary draft');
  await click('Open spaces');await input('[aria-label="Search spaces and work"]','');await click('New space');
  await input('[aria-label="Space name"]','Deskpilot');await input('[aria-label="First task name"]','Mobile');await click('Create space');
  await until('!!document.querySelector(".work-drawer")');
  await check(`${stored('spaces')}.items.length===24 && ${stored('spaces')}.workSpaces.length===1`, 'Creating local organization starts no terminal and needs no Herdr');
  await click('Close panel');await click('Session actions');await click('Move to task →');
  const tabId=await frame(`${stored('spaces')}.workSpaces[0].tabs[0].id`);
  await select('[aria-label="Destination task"]',tabId);await click('Move work');await click('Close panel');
  await check(`document.querySelector('.title-picker').textContent.includes('Deskpilot / Mobile') && document.querySelector('.composer textarea').value==='keep this exact recipient' && ${stored('spaces')}.sequence.join(',')==='tmux-0'`, 'Moving exact work changes organization without moving its draft or process');
  await click('Open spaces');await click('Manage space: Deskpilot');await input('[aria-label="New task name"]','Tests');await click('Add task');await click('Close panel');await click('Close panel');
  await check(`document.querySelectorAll('.task-tabs button').length===3`, 'Local spaces support named task tabs including empty tasks');
  await click('New task');await input('[aria-label="Task name"]','Build');await click('Create task');await until(`document.querySelector('.sheet h1')?.textContent==='Build'`);
  await check(`document.querySelector('.sheet-body').textContent.includes('Start terminal') && document.querySelector('.sheet-body').textContent.includes('Add existing work')`, 'Tab-bar plus creates a task with explicit start-or-add actions');await screenshot('empty-task');await size(320,844);await layout('Empty task 320');await size(390,844);await layout('Empty task 390');
  await click('Add existing work');await layout('Add existing work 390');await row('tmux-2');await until('!document.querySelector(".sheet")');
  await check(`${stored('spaces')}.selected==='tmux-2' && document.querySelector('.title-picker').textContent.includes('Deskpilot / Build')`, 'Empty task accepts existing work without creating a terminal');
  await click('New task');await input('[aria-label="Task name"]','New shell');await click('Create task');await until(`document.querySelector('.sheet h1')?.textContent==='New shell'`);await click('Start terminal');await layout('Start terminal 390');await input('.sheet form input','task-shell');await click('Create terminal');await until('!document.querySelector(".sheet")');
  await check(`document.querySelector('.title-picker').textContent.includes('Deskpilot / New shell') && ${stored('spaces')}.items.filter(i=>i.name==='task-shell').length===1`, 'Starting a terminal creates it directly in the intended task exactly once');
  await click('Open spaces');await input('[aria-label="Search spaces and work"]','tmux-0');await row('tmux-0');await until('!document.querySelector(".sheet")');

  await click('Open spaces');await input('[aria-label="Search spaces and work"]','reconnect race');await row('codex-1');if(await frame('!!document.querySelector(".sheet")'))await click('Connect mobile view');await until('!document.querySelector(".sheet")');
  await click('Session actions');await click('Move to task →');await select('[aria-label="Destination task"]',tabId);await click('Move work');await click('Close panel');
  await check(`document.querySelectorAll('.pane-tabs button').length===2 && ${stored('spaces')}.sequence.join(',')==='tmux-0,codex-1'`, 'Ordinary terminals and conversations can share one explicit task');
  await reload();await until('!!document.querySelector(".composer")');
  await check(`document.querySelector('.title-picker').textContent.includes('Deskpilot / Mobile') && ${stored('spaces')}.selected==='codex-1'`, 'Reload restores local membership and exact selected source');
  await click('Previous session');await check(`document.querySelector('.composer textarea').value==='keep this exact recipient'`, 'Grouped mixed-source draft survives reload and switching');
  await click('Input tools');await click('Paste without Enter →');await input('[aria-label="Paste draft"]','separate paste');await click('Close panel');await click('Close panel');
  await click('Needs attention');await click('All work');await input('[aria-label="Search spaces and work"]','travel-shell');await row('travel-shell');
  await check(`${stored('spaces')}.computer==='studio' && ${stored('spaces')}.selected==='tmux-0' && document.querySelector('.sheet-body').textContent.includes('Travel laptop') && document.querySelector('.composer textarea').value==='keep this exact recipient'`, 'Offline result preserves original computer, terminal and draft while naming the recovery target');
  await click('Retry connection');await click('Close panel');await click('Close panel');
  await check(`${stored('spaces')}.computer==='studio' && ${stored('spaces')}.selected==='tmux-0'`, 'Recovering another computer never silently switches the current terminal');
  await click('Needs attention');await check(`document.querySelector('[aria-label="Search spaces and work"]') && document.querySelector('.space-across input').checked && document.querySelectorAll('[data-item]').length===4`, 'Attention is a drawer filter across computers with coverage access');
  await screenshot('attention');await row('build-job');await until('!document.querySelector(".sheet")');
  await check(`document.querySelector('.terminal-context').textContent.includes('Build server')`, 'Explicit attention selection can cross computers visibly');
  await input('.composer textarea','headless draft');await click('Computer');
  await frame(`document.querySelectorAll('.sheet .destination')[0].click()`);await pause(160);
  await check(`document.querySelector('.composer textarea').value==='keep this exact recipient'`, 'Explicit computer switch restores its previous view and draft');
  await click('Test states');await click('Simulate no Herdr installed');await click('Close panel');await click('Open spaces');
  await input('[aria-label="Search spaces and work"]','');await click('All work');await frame(`{const box=document.querySelector('.space-across input');if(box.checked)box.click();}`);await pause();
  await check(`document.querySelectorAll('[data-space]').length===3 && !document.querySelector('[data-space^="native:"]') && document.querySelector('.space-browser').textContent.includes('Deskpilot')`, 'Spaces and ordinary work remain useful with Herdr entirely absent');
  await screenshot('without-herdr');await click('Close panel');
  await click('Computer');await click('Computer settings →');await until('!document.querySelector(".sheet")');await click('Machines & pairing Local labels, pair, and forget →');await click('Pair computer');await click('Cancel pairing');
  await check(`document.querySelector('.sheet h1').textContent==='Machines & pairing' && document.activeElement.id==='pair-from-machines'`, 'Pairing cancellation restores invoking subsection and control');
  await click('Close panel');await computerDestination('Previews');
  await check(`!!document.querySelector('.preview-image')`, 'Independent previews remain available');
  await computerDestination('Desktop');await click('Capture screen');
  await check(`!!document.querySelector('.capture')`, 'Desktop capture remains available');
  await click('Open spaces');await input('[aria-label="Search spaces and work"]','tmux-0');await row('tmux-0');await until('!document.querySelector(".sheet")');
  await click('Test states');await click('offline');await click('Close panel');
  await check(`document.querySelector('.connection-banner').textContent.includes('Stale') && document.querySelector('.composer textarea').value==='keep this exact recipient' && document.querySelector('[aria-label="Send prompt"]').disabled`, 'Offline terminal keeps draft and blocks input without replay');
  await click('Stale output · offline · Recover connection →');await click('Retry connection');await click('Close panel');
  // A separate browser context has no cached fixture state or drafts.
  const {browserContextId}=await cdp.send('Target.createBrowserContext');
  const {targetId:secondTarget}=await cdp.send('Target.createTarget',{url:'about:blank',browserContextId});
  const {sessionId:secondSession}=await cdp.send('Target.attachToTarget',{targetId:secondTarget,flatten:true});
  const other=async(expression:string)=>{const r=await cdp!.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},secondSession);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await cdp.send('Page.enable',{},secondSession);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.protocol==='http:')localStorage.setItem('deskpilot-mobile-directions:sample-namespace','${sampleRun}');`},secondSession);
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:5178/spaces'},secondSession);
  let otherReady=false;for(let n=0;n<90;n++){if(await other(`!!document.querySelector('.app-shell[data-organization-ready=true]')`)){otherReady=true;break;}await pause();}
  if(!otherReady)throw Error('Independent browser did not load organization');
  const shared=await other(`(()=>{const s=${stored('spaces')};return s.workSpaces[0]?.name==='Deskpilot' && s.workAssignments['studio:Terminal:tmux-0:1']===${JSON.stringify(tabId)} && Object.keys(s.drafts).length===0;})()`);
  await check(JSON.stringify(shared), 'A fresh independent browser receives computer-owned spaces and membership without the original draft');
  await click('Session actions');await click('Move to task →');
  const changed=await other(`(async()=>{const options={headers:{'content-type':'application/json','x-prototype-namespace':${JSON.stringify(sampleRun)}}};const doc=await(await fetch('/__prototype/organization/studio',options)).json();doc.spaces[0].tabs.push({id:'task:from-other-browser',name:'From another browser'});return (await fetch('/__prototype/organization/studio',{...options,method:'POST',body:JSON.stringify(doc)})).ok;})()`);
  if(!changed)throw Error('Independent browser could not edit organization');
  await select('[aria-label="Destination task"]',tabId);await click('Move work');
  await check(`document.querySelector('.sheet-message').textContent.includes('another browser') && document.querySelector('.composer textarea').value==='keep this exact recipient' && ${stored('spaces')}.selected==='tmux-0'`, 'A stale save surfaces a conflict and preserves the current terminal, draft and form');
  await click('Refresh organization','document.querySelector(".sheet")');await until('!!document.querySelector(".app-shell[data-organization-ready=true]")');await click('Move work');await click('Close panel');
  await check(`${stored('spaces')}.workSpaces[0].tabs.some(t=>t.id==='task:from-other-browser')`, 'Explicit refresh and retry preserve the other browser’s change');
  await cdp.send('Target.disposeBrowserContext',{browserContextId});
  await click('Open spaces');await input('[aria-label="Search spaces and work"]','');await click('All work');await frame(`{const box=document.querySelector('.space-across input');if(box.checked)box.click();}`);await pause();await click('Manage space: Deskpilot');await click('Remove organization');await click('Close panel');
  await check(`document.querySelector('.title-picker').textContent.includes('Unassigned') && document.querySelector('.composer textarea').value==='keep this exact recipient' && !${stored('spaces')}.items.some(i=>i.closed) && ${stored('spaces')}.sequence.join(',')==='tmux-0'`, 'Removing local organization returns work to Unassigned without stopping it');
  await check(`window.__errors.length===0`, 'No runtime errors or unhandled rejections');
  await check(`performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).every(r=>new URL(r.name).origin===location.origin && !new URL(r.name).pathname.startsWith('/api'))`, 'Trial uses isolated assets and no production API');
  await Deno.writeTextFile(new URL('verification.json',out),JSON.stringify(report,null,2));
  console.log(`${report.checks.length} Spaces checks and ${report.layouts.length} layouts passed.`);
} finally {
  cdp?.close();try{chrome.kill();}catch{}await chrome.status;await Deno.remove(profile,{recursive:true}).catch(()=>{});
}
