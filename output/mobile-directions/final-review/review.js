// Design-only fixture. No host keyring, API, service worker or real transport.
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const items=[
 {id:'native-1',name:'Mobile navigation',space:'Deskpilot',tab:'Mobile',source:'Herdr',agent:'Codex',native:true,needs:true},
 {id:'native-2',name:'Regression checks',space:'Deskpilot',tab:'Mobile',source:'Herdr',agent:'Shell',native:true},
 {id:'native-3',name:'Pairing recovery',space:'Deskpilot',tab:'Connections',source:'Herdr',agent:'Codex',native:true},
 {id:'native-4',name:'Renderer',space:'Design tools',tab:'Workspace',source:'Herdr',agent:'Shell',native:true},
 {id:'local-1',name:'Website build',space:'Personal',tab:'Website',source:'Terminal',agent:'Shell'},
 {id:'ordinary',name:'Project shell',space:'Unassigned',tab:'Project shell',source:'Terminal',agent:'Shell'},
 {id:'chat-1',name:'Choose a learning path',source:'Codex',agent:'Codex',available:true},
 {id:'chat-2',name:'Prototype a playlist assistant',source:'Codex',agent:'Codex',available:true},
 {id:'chat-3',name:'Plan a desktop utility',source:'Codex',agent:'Codex',available:true}
];
let selected='native-1',computer='Studio',scenario='native',query='',needs=false,scope='computer',showHidden=false;
let expanded=new Set(['space:Deskpilot','tab:Deskpilot/Mobile']),hidden=new Set(),drafts={},logs={},panelState=null,lastFocus=null;
const nav=$('#navigator'),panel=$('#panel');
function visibleItems(){return items.filter(i=>scenario!=='ordinary'||!i.native);}
function context(i){return i.available?(hidden.has(i.id)?'Hidden conversations':'Available conversations'):(i.space+' / '+i.tab);}
function row(i,result=false){
 const muted=hidden.has(i.id),active=i.id===selected;
 return '<div class="terminal-row '+(result?'search-result':'')+'"><button data-open="'+i.id+'" class="'+(active?'active':'')+'" '+(active?'aria-current="true"':'')+'><span class="terminal-dot '+(i.needs?'needs':'')+'">●</span><span><strong>'+esc(i.name)+'</strong><small>'+esc(result?computer+' · '+context(i)+' · '+i.source:i.agent+' · '+(i.needs?'Needs you':i.source==='Codex'?'Attention unknown':'Idle'))+(muted?' · Hidden':'')+'</small></span></button>'+(i.available?'<button class="visibility" data-hide="'+i.id+'" aria-label="'+(muted?'Restore':'Hide')+' conversation: '+esc(i.name)+'">'+(muted?'Restore':'Hide')+'</button>':'')+'</div>';
}
function toggleRow(key,label,detail,kind){
 return '<div class="'+kind+'-row"><button data-expand="'+esc(key)+'" aria-expanded="'+expanded.has(key)+'"><span>'+(expanded.has(key)?'⌄':'›')+'</span><span><strong>'+esc(label)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</span></button>'+((kind==='space'||kind==='tab')&&label!=='Unassigned'&&!key.startsWith('available')&&!key.startsWith('hidden')?'<button class="icon" data-manage="'+esc(label)+'" data-level="'+kind+'" aria-label="Manage '+kind+': '+esc(label)+'">⋯</button>':'')+'</div>';
}
function navigatorHTML(){
 const all=visibleItems(),count=all.filter(i=>i.needs&&!hidden.has(i.id)).length,hc=all.filter(i=>hidden.has(i.id)).length;
 let html='<div class="nav-brand">DESKPILOT · DESIGN SAMPLE</div><div class="nav-body"><div class="nav-computer"><button data-panel="computer"><span>● '+computer+'<small> · '+(scenario==='offline'?'Cannot reach':scenario==='auth'?'Pairing required':'Connected')+'</small></span><span>⌄</span></button></div><input class="nav-search" aria-label="Search work" placeholder="Search spaces, tabs and work" value="'+esc(query)+'"><div class="filters"><button data-filter="all" aria-pressed="'+!needs+'">All work</button><button data-filter="needs" aria-pressed="'+needs+'">Needs you <span class="count">'+count+'</span></button></div><label class="scope">Search in <select aria-label="Search scope"><option value="computer" '+(scope==='computer'?'selected':'')+'>This computer</option><option value="all" '+(scope==='all'?'selected':'')+'>All computers</option></select></label>';
 if(query||needs||scope==='all'){
  const found=all.filter(i=>(showHidden||!hidden.has(i.id))&&(!needs||i.needs)&&(!query||(i.name+' '+context(i)+' '+i.source).toLowerCase().includes(query.toLowerCase())));
  html+='<p class="results-count">'+found.length+' results · '+(scope==='all'?'All computers':computer)+'</p>'+found.map(i=>row(i,true)).join('');
  if(!found.length)html+='<p class="empty-note">No matching work. Unknown status does not mean all-clear.</p>';
 }else{
  html+='<div class="tree-toolbar"><span>SPACES</span><button data-panel="new-space">＋ New space</button></div>';
  for(const name of [...new Set(all.filter(i=>i.space).map(i=>i.space))]){
   const group=all.filter(i=>i.space===name),key='space:'+name;
   html+='<section class="space">'+toggleRow(key,name,group[0].native?'Herdr':'Deskpilot','space');
   if(expanded.has(key)&&name==='Unassigned')html+=group.map(i=>row(i)).join('');
   else if(expanded.has(key))for(const tab of [...new Set(group.map(i=>i.tab))]){
    const tk='tab:'+name+'/'+tab,children=group.filter(i=>i.tab===tab);
    html+=toggleRow(tk,tab,'','tab');
    if(expanded.has(tk))html+=children.map(i=>row(i)).join('');
   }
   html+='</section>';
  }
  const available=all.filter(i=>i.available&&!hidden.has(i.id));
  if(available.length){html+='<section class="space">'+toggleRow('available','Available conversations',available.length+' conversations','space');if(expanded.has('available'))html+=available.map(i=>row(i)).join('')+'<p class="section-note">Available in Codex, even after a desktop window closes. Hide keeps original work and drafts.</p>';html+='</section>';}
  if(showHidden&&hc)html+='<section class="space">'+toggleRow('hidden','Hidden conversations',hc+' conversations','space')+all.filter(i=>hidden.has(i.id)).map(i=>row(i)).join('')+'</section>';
 }
 html+='<div class="nav-footer">'+((hc||showHidden)?'<button id="show-hidden" aria-pressed="'+showHidden+'">'+(showHidden?'✓ ':'')+'Show hidden ('+hc+')</button>':'')+'<button data-panel="new-terminal">＋ New terminal</button><button data-panel="coverage">Attention coverage →</button><button data-panel="computer">Computer · Desktop, previews & settings →</button></div></div>';
 return html;
}
function renderNavigation(){
 const active=document.activeElement,typing=active?.classList.contains('nav-search'),start=typing?active.selectionStart:null,container=active?.closest('.desktop-nav')?'sidebar':'drawer';
 const html=navigatorHTML();$('.desktop-nav').innerHTML=html;$('#drawer-nav').innerHTML=html;
 if(typing){const input=$(container==='sidebar'?'.desktop-nav .nav-search':'#drawer-nav .nav-search');input.focus({preventScroll:true});input.setSelectionRange(start,start);}
}
function render(){
 const i=items.find(x=>x.id===selected);
 $('#terminal-name').textContent=i.name;$('#breadcrumb').textContent=context(i);
 $('#source-status').textContent=i.source+' · '+(scenario==='offline'?'Unavailable':scenario==='auth'?'Pairing required':i.needs?'Needs you':'Connected');
 const siblings=visibleItems().filter(x=>x.space===i.space&&x.tab===i.tab&&!x.available),at=siblings.findIndex(x=>x.id===i.id);
 $('#previous').disabled=at<1;$('#next').disabled=at<0||at>=siblings.length-1;
 $('#prompt').value=drafts[selected]||'';$('#send').disabled=scenario==='offline'||scenario==='auth';
 $('#transcript').textContent='❯ '+i.agent+' · '+i.name+'\n\n'+(i.id==='native-1'?'Navigation review\n\nSpaces\n  Mobile\n    ● Mobile navigation\n    ○ Regression checks\n\nThe sidebar and the phone drawer share this hierarchy.\nSelect a terminal to return to its own prompt and draft.\n\nOne terminal remains visible. The colorful outline stays.\n\n✓ History scrolling\n✓ Exact-source drafts\n✓ Native pane membership\n\nReady for your next instruction.':i.source==='Codex'?'Available conversation\n\nThis conversation can be opened independently of its desktop window.\n\nIts original work remains in Codex. Hiding affects Deskpilot visibility only.':'$ run checks\n\n✓ source identity\n✓ organization persistence\n✓ terminal scrolling\n\n$ ready')+(logs[selected]||'');
 const feedback=$('#feedback');feedback.hidden=!['offline','auth','update'].includes(scenario);
 if(!feedback.hidden)feedback.innerHTML=scenario==='update'?'<span>A new Deskpilot UI is ready. Your draft will be saved.</span><button data-update>Reload</button>':scenario==='auth'?'<span>Pair this browser with Studio. Your draft is preserved.</span><button data-panel="pair">Pair</button>':'<span>Cannot reach Studio. Check Tailscale and wake the computer. Draft preserved.</span><button data-retry>Retry</button>';
 renderNavigation();
}
function openItem(id){drafts[selected]=$('#prompt').value;selected=id;if(nav.open)nav.close();render();}
function closePanel(){panel.close();panelState=null;if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});}
function showPanel(type,data,back){
 if(!panel.open){lastFocus=document.activeElement;panel.showModal();}
 panelState={type,data,back};$('#panel-title').textContent=({computer:'Computer',settings:'Settings',pair:'Pair computer',coverage:'Attention coverage',actions:'Terminal actions',tools:'Input tools','new-space':'New space','new-terminal':'New terminal',desktop:'Desktop',previews:'Previews',manage:data?.level==='tab'?'Manage tab':'Manage space',hide:hidden.has(data?.id)?'Restore conversation':'Hide conversation',devices:'Authorized devices',connections:'Connections',app:'App & installation',notifications:'Notifications',usage:'Agent usage',machines:'Computers & pairing'})[type]||'Deskpilot';
 const list=(entries)=>'<div class="list">'+entries.map(e=>'<button data-panel="'+e[0]+'"><span>'+e[1]+'</span><span>→</span></button>').join('')+'</div>';
 let html=back?'<button class="back" data-back>‹ Back</button>':'';
 if(type==='computer')html+='<p>Studio · Connected. Switching computers restores their previous view.</p><div class="list"><button data-computer="Studio">● Studio <span>Selected ✓</span></button><button data-computer="Build server">○ Build server <span>Headless →</span></button></div>'+list([['desktop','Desktop'],['previews','Previews'],['settings','Settings'],['pair','Pair computer']]);
 else if(type==='settings')html+='<p>For '+computer+'. App preferences are browser-specific.</p>'+list([['machines','Computers & pairing'],['devices','Authorized devices'],['notifications','Notifications'],['usage','Agent usage'],['connections','Connections'],['app','App & installation']]);
 else if(type==='pair')html+='<p>Pair using a one-time code from the computer. Cancel returns to the screen that opened pairing.</p><form id="pair-form"><label>Computer address<input placeholder="https://computer.example" required></label><label>One-time code<input placeholder="8-character code" required></label><button class="primary">Pair sample computer</button><button type="button" data-back>Cancel pairing</button></form>';
 else if(type==='coverage')html+='<p>Studio is connected. Herdr reports agent activity and requests. Codex conversation discovery does not report input requests.</p><p>“No reported requests” includes this coverage limit. Unknown and unreachable work are not an all-clear.</p>';
 else if(type==='actions'){
 const current=items.find(i=>i.id===selected),shared=current.native||current.source==='Codex';
 html+='<p>'+esc(current.name)+' · '+computer+'</p>'+list([['move','Move to tab'],['rename','Rename terminal'],['previews','Previews'],['desktop','Show on desktop'],...(current.native?[['manage','Native Herdr management']]:[])])+'<div class="list">'+(shared?'<button data-sample-action="Disconnect mobile view">Disconnect mobile view</button>':'<button class="danger" data-panel="stop">End session…</button>')+(current.native?'<button class="danger" data-panel="stop">Stop Herdr terminal…</button>':'')+'</div>';
 }
 else if(type==='tools')html+='<p>These tools retain the terminal and its prompt draft.</p>'+list([['keys','Special keys'],['paste','Paste without Enter'],['copy','Select & copy'],['text','Terminal text size']]);
 else if(type==='desktop')html+='<p>Screens and windows stay under Computer. Captures are always explicit.</p><label>Workspace<select><option>Screen 1</option><option>Screen 2</option></select></label><div class="mock-window"><strong>Herdr · Deskpilot</strong><p>Move, tile, place or open the matching terminal. Capture and unlock keep their existing guards.</p><button data-sample-action="Capture sample window">Capture window</button></div>';
 else if(type==='previews')html+='<p>Published images have their own history. A matching name never establishes terminal ownership.</p><div class="mock-preview">Sample published preview</div><p>Mobile layout · 390 × 844 · Sample metadata</p><div class="list"><button data-sample-action="Fit preview">Fit / actual size</button><button data-sample-action="Refresh preview">Refresh</button><button data-sample-action="Remove sample preview">Remove preview…</button></div>';
 else if(type==='new-space')html+='<p>Creating organization starts no terminal. Native Herdr creation stays in native management.</p><form id="space-form"><label>Space name<input name="space" required maxlength="100"></label><label>First tab name<input name="tab" value="Work" required maxlength="100"></label><button class="primary">Create sample space</button></form>';
 else if(type==='new-terminal')html+='<p>Start a terminal explicitly. Name, directory, command and placement remain editable.</p><form id="terminal-form"><label>Name<input name="name" value="New shell" required></label><label>Directory<input value="~/Projects"></label><label>Command<input value="bash"></label><button class="primary">Start sample terminal</button></form>';
 else if(type==='hide')html+='<p><strong>'+esc(data.name)+'</strong></p><p>'+(hidden.has(data.id)?'Restore this conversation to normal lists and search.':'Hide this conversation from normal lists and search. Show hidden lets you restore it.')+'</p><p>Original work, mobile views and drafts stay intact. The real choice is saved on the source computer.</p><button class="primary" data-confirm-hide="'+data.id+'">'+(hidden.has(data.id)?'Restore conversation':'Hide from Deskpilot')+'</button>';
 else if(type==='manage')html+='<p>'+esc(data?.name||'Deskpilot')+' · '+computer+'</p>'+list([['new-tab','New tab'],['rename','Rename'],['reorder','Reorder'],['split','Split terminal'],['stop','Review close…']])+'<p>Native Herdr owns its space/tab/pane layout. Local organization only changes Deskpilot metadata.</p>';
 else if(type==='app')html+='<p>This browser · UI build: review sample<br>Studio backend: sample version</p><p>The production screen will show both versions and whether a UI update is ready.</p><button data-sample-action="Check for UI update">Check for updates</button><button data-sample-action="Install sample">Install / app preferences</button>';
 else if(type==='connections')html+='<p>Studio: '+(scenario==='offline'?'Cannot reach':'Connected')+'<br>Herdr: '+(scenario==='ordinary'?'Not installed':'Available')+'<br>Desktop: Available</p><p>Network reachability, authorization, source discovery and terminal attachment each show their own state and recovery.</p>';
 else if(type==='machines')html+='<p>Labels belong to this browser. Forgetting a saved computer is distinct from revoking a device.</p>'+list([['pair','Pair computer']])+'<button data-sample-action="Rename computer label">Rename computer label</button>';
 else if(type==='devices')html+='<p>Authorized devices on '+computer+'</p><div class="list"><button data-sample-action="Rename sample device">This browser · Rename</button><button class="danger" data-sample-action="Review device revocation">Other phone · Revoke…</button></div>';
 else if(type==='notifications')html+='<p>Notifications are configured per computer and browser. Show loading, enabled, repair or unavailable states explicitly.</p><button data-sample-action="Test sample notification">Test notification</button>';
 else if(type==='usage')html+='<p>Usage is computer-scoped. A failed provider shows Unavailable with Retry, instead of an empty page.</p><button data-sample-action="Refresh sample usage">Refresh usage</button>';
 else if(type==='stop')html+='<p>Review the original terminal and affected programs before stopping. A changed native layout invalidates the review.</p><p class="action-note">Sample review only. No work will stop.</p><button class="danger" data-sample-action="Simulated stop review">Stop & close sample</button>';
 else if(type==='paste')html+='<p>Paste types text without Enter. It keeps its own draft.</p><label>Paste draft<textarea rows="5"></textarea></label><button data-sample-action="Simulated paste without Enter">Paste without Enter</button>';
 else if(type==='copy')html+='<p>Select readable output. Terminal history scrolling remains available behind this sheet.</p><textarea rows="8" readonly>'+esc($('#transcript').textContent)+'</textarea>';
 else if(type==='keys')html+='<p>Scroll: PageUp / PageDown. Input: Enter, Escape, Tab, arrows and control keys.</p><div class="list">'+['PageUp','PageDown','Enter','Escape','Tab','Ctrl+C'].map(k=>'<button data-sample-action="'+k+'">'+k+'</button>').join('')+'</div>';
 else if(type==='text')html+='<p>Keep existing terminal size choices.</p><button data-font="12">Compact</button><button data-font="16">Readable</button>';
 else html+='<p>This destination retains the existing '+esc(type)+' controls, exact-source targeting, cancellation and error states.</p><p class="action-note">Interaction sample. No live command is sent.</p><button data-sample-action="'+esc(type)+'">Review sample action</button>';
 $('#panel-body').innerHTML=html;
}
document.addEventListener('input',e=>{if(e.target.id==='prompt')drafts[selected]=e.target.value;if(e.target.classList.contains('nav-search')){query=e.target.value;renderNavigation();}});
document.addEventListener('change',e=>{if(e.target.matches('[aria-label="Search scope"]')){scope=e.target.value;renderNavigation();}});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.open)return openItem(b.dataset.open);
 if(b.dataset.expand){const k=b.dataset.expand;expanded.has(k)?expanded.delete(k):expanded.add(k);return renderNavigation();}
 if(b.dataset.filter){needs=b.dataset.filter==='needs';return renderNavigation();}
 if(b.dataset.hide)return showPanel('hide',items.find(i=>i.id===b.dataset.hide),panelState);
 if(b.dataset.confirmHide){const id=b.dataset.confirmHide;hidden.has(id)?hidden.delete(id):hidden.add(id);closePanel();renderNavigation();return;}
 if(b.id==='show-hidden'){showHidden=!showHidden;return renderNavigation();}
 if(b.dataset.manage)return showPanel('manage',{name:b.dataset.manage,level:b.dataset.level},panelState);
 if(b.dataset.panel!==undefined)return showPanel(b.dataset.panel,null,panelState);
 if(b.hasAttribute('data-back')){const back=panelState?.back;if(back){const from=panelState.type;showPanel(back.type,back.data,back.back);$('#panel-body [data-panel="'+from+'"]')?.focus();}else closePanel();return;}
 if(b.dataset.computer){computer=b.dataset.computer;closePanel();return render();}
 if(b.hasAttribute('data-retry')||b.hasAttribute('data-update')){scenario='native';return render();}
 if(b.dataset.font){$('.output').style.fontSize=b.dataset.font+'px';return closePanel();}
 if(b.dataset.sampleAction){$('#panel-body').insertAdjacentHTML('beforeend','<p role="status" class="action-note">Simulated: '+esc(b.dataset.sampleAction)+'. No real work changed.</p>');}
});
$('#spaces-open').onclick=()=>{lastFocus=document.activeElement;nav.showModal();};
$('.close-nav').onclick=()=>{nav.close();$('#spaces-open').focus();};
$('#computer-open').onclick=()=>showPanel('computer');
$('#actions-open').onclick=()=>showPanel('actions');
$('#input-tools').onclick=()=>showPanel('tools');
$('#panel-close').onclick=closePanel;
panel.oncancel=e=>{e.preventDefault();closePanel();};
nav.oncancel=e=>{e.preventDefault();nav.close();$('#spaces-open').focus();};
$('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);
function step(direction){const i=items.find(i=>i.id===selected),siblings=visibleItems().filter(x=>x.space===i.space&&x.tab===i.tab&&!x.available);const next=siblings[siblings.indexOf(i)+direction];if(next)openItem(next.id);}
$('.composer').onsubmit=e=>{e.preventDefault();if(!$('#prompt').value.trim()||$('#send').disabled)return;logs[selected]=(logs[selected]||'')+'\n\n❯ '+$('#prompt').value+'\n\n[Sample input only; nothing sent to a computer.]';drafts[selected]='';render();$('.output').scrollTop=$('.output').scrollHeight;};
document.addEventListener('submit',e=>{
 if(e.target.id==='pair-form'){e.preventDefault();$('#panel-body').insertAdjacentHTML('beforeend','<p role="status">Sample paired. Production will enroll using a one-time code.</p>');}
 if(e.target.id==='space-form'){e.preventDefault();const f=new FormData(e.target),space=String(f.get('space')),tab=String(f.get('tab'));items.push({id:'empty-'+Date.now(),name:'Start terminal or add existing work',space,tab,source:'Terminal',agent:'Empty tab'});expanded.add('space:'+space);expanded.add('tab:'+space+'/'+tab);closePanel();renderNavigation();}
 if(e.target.id==='terminal-form'){e.preventDefault();const name=String(new FormData(e.target).get('name')),id='demo-'+Date.now();items.push({id,name,space:'Unassigned',tab:name,source:'Terminal',agent:'Shell'});closePanel();openItem(id);}
});
window.addEventListener('message',e=>{if(e.origin!==location.origin||!e.data.scenario)return;scenario=e.data.scenario;if(scenario==='ordinary'){selected='local-1';expanded=new Set(['space:Personal','tab:Personal/Website']);}else if(items.find(i=>i.id===selected)?.source!=='Herdr')selected='native-1';if(nav.open)nav.close();if(panel.open)closePanel();render();});
matchMedia('(min-width:960px)').addEventListener('change',e=>{if(e.matches&&nav.open)nav.close();});
render();

let touchOrigin=null,touchAxis='';
$('.output').addEventListener('touchstart',e=>{if(e.touches.length===1){touchOrigin={x:e.touches[0].clientX,y:e.touches[0].clientY};touchAxis='';}},{passive:true});
$('.output').addEventListener('touchmove',e=>{if(!touchOrigin||e.touches.length!==1)return;const dx=e.touches[0].clientX-touchOrigin.x,dy=e.touches[0].clientY-touchOrigin.y;if(!touchAxis&&Math.max(Math.abs(dx),Math.abs(dy))>12)touchAxis=Math.abs(dx)>Math.abs(dy)*1.3?'horizontal':'vertical';if(touchAxis==='horizontal')e.preventDefault();},{passive:false});
$('.output').addEventListener('touchend',e=>{if(touchOrigin&&touchAxis==='horizontal'){const dx=e.changedTouches[0].clientX-touchOrigin.x;if(Math.abs(dx)>50)step(dx<0?1:-1);}touchOrigin=null;},{passive:true});
$('.output').addEventListener('touchcancel',()=>touchOrigin=null,{passive:true});
