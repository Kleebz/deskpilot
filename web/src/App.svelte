<script>
  import { onMount, tick, untrack } from 'svelte';
  import { api, post, ready, tilde } from './lib/api.js';
  import { hosts, currentHost, displayName, switchTo, setCaps, needsYou, attention, setAttention } from './lib/hosts.svelte.js';
  import { vis } from './lib/visible.svelte.js';
  import WorkNavigation from './lib/spaces/WorkNavigation.svelte';
  import UpdateNotice from './lib/UpdateNotice.svelte';
  import OrganizationForms from './lib/spaces/OrganizationForms.svelte';
  import { SpacesController } from './lib/spaces/controller.svelte.js';
  import { liveItems, liveSpaceState, routeItem, sourceRef, sourceKey, sameSource } from './lib/spaces/live-model.js';
  import { taskFor } from './lib/spaces/model.js';
  import Pane from './lib/Pane.svelte';
  import ComputerSheet from './lib/ComputerSheet.svelte';
  import Sheet from './lib/Sheet.svelte';
  import { inventory, reportedRequests } from './lib/attention-model.js';
  import WindowRow from './lib/WindowRow.svelte';
  import NewSession from './lib/NewSession.svelte';
  import AddMachine from './lib/AddMachine.svelte';
  import Management from './lib/Management.svelte';
  import Previews from './lib/Previews.svelte';
  import ConversationPicker from './lib/ConversationPicker.svelte';
  import HerdrActions from './lib/HerdrActions.svelte';
  import { isTerminalWindow, matchConversationWindows } from './lib/conversation-windows.js';
  import { normalWork, matchesWorkFilter, attentionUnavailable, workStateLabel } from './lib/work-model.js';
  import { readResume, resumeRoute, writeResume } from './lib/resume.js';

  const workspaces = [1,2,3,4,5,6,7,8,9,10];
  const origins = hosts.list.map(h => h.origin);
  const resumed = readResume(localStorage, origins);
  const previousEntry = resumeRoute(history.state?.deskpilot, origins);
  const notificationParams = new URLSearchParams(location.search);
  const notificationHost = notificationParams.get('machine');
  const notificationSession = notificationParams.get('session');
  const notificationRoute = notificationHost && notificationSession && hosts.list.some(h => h.origin === notificationHost)
    ? { view: 'terminal', host: notificationHost, session: notificationSession, returnTo: { view: 'sessions', host: notificationHost } }
    : null;
  if (notificationHost || notificationSession) history.replaceState(null, '', location.pathname);
  const restoredRoute = migrateRoute(notificationRoute ?? previousEntry ?? resumed?.route ?? { view: 'sessions', host: hosts.current });
  const initialComputer = restoredRoute.view==='computer';
  const initialRoute = initialComputer?(restoredRoute.returnTo??{host:restoredRoute.host,view:'sessions'}):restoredRoute;
  if (initialRoute.host !== hosts.current) switchTo(initialRoute.host);
  let sessions = $state([]), unmanaged = $state([]), windows = $state([]), connection = $state('loading');
  let conversations = $state([]), connecting = $state('');
  let herdrTerminals = $state([]);
  let herdrManagement = $state(null), herdrNotice = $state(''), herdrAction = $state(null);
  let picker = $state(false),computerOpen=$state(initialComputer),wide=$state(matchMedia('(min-width:960px)').matches),sidebar=$state(null);
  let computerOrigin={picker:false,focus:'computer-nav'},lastObserved=$state(0),herdrSeenAt=$state(0);
  let inventories = $state({});
  let spacePreferences=$state(resumed?.spaces??{}),legacyRestore=$state(false),coverage=$state(false),workActions=$state(false);
  let spaceOpenAction=0,spaceOpening=$state(false);
  const spaces=new SpacesController({host:currentHost,hostFor:origin=>hosts.list.find(h=>h.origin===origin),status:onstatus,open:openSpaceItem,create:target=>create(null,'new-session',target),native:target=>{herdrAction=target;},selected:()=>activeSource?sourceRef(activeSource):null});
  let visits = $state(resumed?.visits ?? {}), recent = $state(resumed?.recent ?? {});
  let conversationPicker = $state(null), conversationAction = 0;
  let status = $state(''), bad = $state(false), locked = $state(false);
  let route = $state(initialRoute.view==='management'?{...initialRoute,settings:initialRoute.settings??'home'}:initialRoute);
  let main = $state(null),paneRef=$state(null);
  let screenRail = $state(null);
  let screenWidth = 0;
  let shownHost = $state(''), epoch = 0, request = 0;
  let drafts = $state(resumed?.drafts ?? {}), creationDrafts = $state(resumed?.creationDrafts ?? {}), pairingDraft = $state({ address: '', code: '' });
  let menu = $state(false), rename = $state(''), target = $state(1), actionBusy = $state(false);
  const screensByHost = new Map(resumed?.screens ?? []);
  const positions = new Map(resumed?.positions ?? []);
  let screen = $state(screensByHost.get(hosts.current) ?? 1), password = $state(''), unlocking = $state(false);
  const caps = $derived(hosts.caps[hosts.current] ?? {});
  const localSpaceItems=$derived(liveItems(hosts.current,sessions,conversations,herdrTerminals,unmanaged));
  const activeSource=$derived(routeItem(route,localSpaceItems));
  const liveHosts=$derived(hosts.list.map(h=>({id:h.origin,name:displayName(h),observedAt:h.origin===hosts.current?lastObserved:inventories[h.origin]?.observedAt,health:h.origin===hosts.current?(connection==='ready'?'online':connection):(inventories[h.origin]?.health==='ready'?'online':inventories[h.origin]?.health||'checking')})));
  const allSpaceItems=$derived(hosts.list.flatMap(h=>h.origin===hosts.current?localSpaceItems:liveItems(h.origin,inventories[h.origin]?.sessions||[],inventories[h.origin]?.chats||[],inventories[h.origin]?.native||[],inventories[h.origin]?.agents||[])));
  const spaceState=$derived(liveSpaceState(liveHosts,hosts.current,allSpaceItems,spaces.documents,{...route,selected:activeSource?.id},spacePreferences[hosts.current]));
  const taskContext=$derived(taskFor(spaceState,activeSource));
  const selected = $derived(shownHost === route.host && activeSource ? sessions.find(s => s.session === activeSource.session) : undefined);
  const windowConversations = $derived(matchConversationWindows(conversations, windows));
  const windowForConversation = chat => windows.find(w => windowConversations.get(w.address)?.id === chat.id);
  const rank = s => s.state === 'blocked' ? 0 : s.state === 'working' ? 1 : 2;
  const ordered = $derived([...sessions].sort((a,b) => rank(a)-rank(b)));
  const herdrBySession = $derived(new Map(herdrTerminals.filter(t => t.session).map(t => {
    const space=herdrManagement?.spaces?.find(s=>s.id===t.space?.id),tab=space?.tabs.find(s=>s.id===t.tab?.id);
    return [t.session,{...t,...(space?{space:{...t.space,title:space.title}}:{}),...(tab?{tab:{...t.tab,title:tab.title}}:{})}];
  })));
  const selectedHerdr = $derived((activeSource?.source==='Herdr'?{...activeSource.raw,session:activeSource.session}:null) ?? herdrBySession.get(route.session) ?? (selected?.herdrId ? {id:selected.herdrId,title:selected.session,session:selected.session} : null));
  const workItems = $derived(normalWork(ordered, conversations, herdrBySession));
  const selectedConversation = $derived(workItems.find(item=>item.kind==='conversation'&&item.session===route.session));
  const sharedView = $derived(!!selectedHerdr || !!selectedConversation || !!selected?.codexThreadId);
  const allWork = $derived([...workItems,...herdrTerminals.map(i=>({...i,kind:'herdr'})),...unmanaged.map(i=>({...i,kind:'unmanaged'}))]);
  const localAttentionCount = $derived(allWork.filter(item=>matchesWorkFilter(item,'blocked')).length);
  const unknownAttention = $derived(attentionUnavailable(allWork));
  const herdrWindows = $derived(windows.filter(w => w.class === 'herdr-app'));
  const attentionItems = $derived(reportedRequests(hosts.list,inventories));
  const keyFor = r => JSON.stringify([r.host, r.view, r.session ?? '']);
  const draftKey = $derived(sourceKey(route.host,route.ref||(activeSource?sourceRef(activeSource):null)));
  const legacyKey=$derived(JSON.stringify([route.host,route.session]));
  const legacyDraft=$derived(drafts[legacyKey]);
  const sessionPages=$derived((route.order||[]).map(ref=>taskContext?.tab.items.find(item=>sameSource(sourceRef(item),ref))).filter(Boolean));
  const sessionIndex=$derived(sessionPages.findIndex(item=>activeSource&&sameSource(sourceRef(item),sourceRef(activeSource))));
  let restoreFocus = '';
  let saveTimer;
  prepareDraft(initialRoute);

  function prepareDraft(next) {
    if (next.view === 'new') creationDrafts[next.host] ??= { name: '', dir: '', command: 'bash', workspace: null };
    if (next.view === 'terminal'&&next.ref) drafts[sourceKey(next.host,next.ref)] ??= { input: '', clip: '' };
  }
  function savePlace() {
    clearTimeout(saveTimer);
    remember();
    screensByHost.set(hosts.current, screen);
    writeResume(localStorage, {
      // Pairing is intentionally not resumed: its form can hold credentials.
      route: route.view === 'add' ? route.returnTo ?? { host: hosts.current, view: 'sessions' } : computerOpen?{host:route.host,view:'computer',returnTo:route}:route,
      drafts, creationDrafts, screens: [...screensByHost], positions: [...positions], visits, recent,spaces:spacePreferences,
    }, hosts.list.map(h => h.origin));
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(savePlace, 150); }
  $effect(() => {
    // Track nested edits, including clearing a submitted draft. Flush again
    // synchronously when hidden; a mobile process may disappear without unload.
    JSON.stringify({ route, drafts, creationDrafts, screen, visits, recent,spacePreferences,computerOpen, machines: hosts.list.map(h => h.origin) });
    scheduleSave();
  });

  $effect(() => { history.replaceState({deskpilot:$state.snapshot(route)},'',location.href); });

  $effect.pre(()=>{
    if(route.view!=='terminal'||!route.ref||connection!=='ready'||!activeSource?.generation)return;
    const ref=sourceRef(activeSource),scope=taskContext?JSON.stringify([route.host,taskContext.space.id,taskContext.tab.id]):'';
    untrack(()=>{
      const key=sourceKey(route.host,ref);drafts[key]??={input:'',clip:''};
      const peers=taskContext?.tab.items||[];
      const order=route.scope===scope?(route.order||[]).filter(r=>peers.some(i=>sameSource(sourceRef(i),r))):[];
      order.push(...peers.filter(i=>!order.some(r=>sameSource(r,sourceRef(i)))).map(sourceRef));
      if(!sameSource(route.ref,ref)||route.session!==activeSource.session||route.scope!==scope||JSON.stringify(route.order)!==JSON.stringify(order))route={...route,ref,session:activeSource.session,scope,order};
    });
  });
  function restorePosition() {
    if (route.view === 'screens') alignScreen();
    if (main) main.scrollTop = positions.get(keyFor(route)) ?? 0;
  }
  $effect(() => {
    if (connection !== 'ready') return;
    // The saved scroll position can only be applied once data has laid out.
    untrack(() => {
      const key = keyFor(route);
      tick().then(() => { if (key === keyFor(route)) restorePosition(); });
    });
  });

  function switchSession(name) {const item=localSpaceItems.find(i=>i.session===name);if(item)openSpaceItem(item);}
  function stepSession(direction){const next=sessionPages[sessionIndex+direction];if(next)openSpaceItem(next,{sibling:true});}
  function selectPage(item){openSpaceItem(item);}
  async function herdrChanged(action) { await refresh(); if(action==='terminal.stop'&&route.view==='terminal')home(); }
  function keepComposerFocus(event) {
    if (document.activeElement?.matches('.composer input')) event.preventDefault();
  }
  function backFromTerminal() {
    if (route.returnTo) history.back();
    else home();
  }

  function sessionLocation(session) {
    const terminal = herdrBySession.get(session.session);
    if (terminal) return ['Herdr', terminal.space?.title, terminal.tab?.title].filter(Boolean).join(' · ');
    const chat = workItems.find(item=>item.kind==='conversation'&&item.session===session.session);
    const win = chat && windowForConversation(chat);
    if (win) return `Codex · Screen ${win.workspace}`;
    const screens = session.workspaces?.length
      ? session.workspaces
      : session.workspace == null ? [] : [session.workspace];
    return screens.length === 0
      ? (chat ? 'Codex · Desktop location unavailable' : 'No desktop window')
      : `${screens.length === 1 ? 'Screen' : 'Screens'} ${screens.join(', ')}`;
  }
  function machineAttentionSuffix(host) { if(host.origin===hosts.current)return localAttentionCount?` · ${localAttentionCount} ${localAttentionCount===1?'needs':'need'} you`:''; const n=needsYou[host.origin]??0; return n?` · ${n} session ${n===1?'alert':'alerts'}`:''; }
  function jumpWork(selector) { const section=main?.querySelector(selector); section?.scrollIntoView({block:'start'}); section?.focus({preventScroll:true}); }
  function sessionTitle(session) { return localSpaceItems.find(i=>i.session===session.session)?.name || herdrBySession.get(session.session)?.title || workItems.find(item=>item.kind==='conversation'&&item.session===session.session)?.title || session.session; }

  let statusTimer;
  function onstatus(text, error = false) { clearTimeout(statusTimer);status=text;bad=error;if(text&&!error)statusTimer=setTimeout(()=>{if(status===text)status='';},5000); }
  function remember() { if (main && connection === 'ready') positions.set(keyFor(route), main.scrollTop); }
  function alignScreen(behavior = 'auto') {
    if (!screenRail) return;
    screenWidth = screenRail.clientWidth;
    screenRail.scrollTo({ left: (screen - 1) * screenWidth, behavior });
  }
  $effect(() => {
    const rail = screenRail;
    if (!rail) return;
    screenWidth = 0;
    const observer = new ResizeObserver(() => {
      if (rail === screenRail && rail.clientWidth !== screenWidth) alignScreen();
    });
    observer.observe(rail);
    return () => observer.disconnect();
  });
  function showScreen(value, smooth = true) {
    const next = Math.max(1, Math.min(10, Number(value) || 1));
    screen = next;
    screensByHost.set(hosts.current, next);
    alignScreen(smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto');
  }
  function onScreenScroll() {
    if (!screenRail?.clientWidth) return;
    if (conversationPicker) { showScreen(conversationPicker.workspace, false); return; }
    // A resized page changes the meaning of scrollLeft. Keep the chosen
    // screen instead of treating phone rotation as a swipe to another one.
    if (screenRail.clientWidth !== screenWidth) { alignScreen(); return; }
    const next = Math.max(1, Math.min(10, Math.round(screenRail.scrollLeft / screenRail.clientWidth) + 1));
    if (next !== screen) {
      screen = next;
      screensByHost.set(hosts.current, next);
    }
  }
  async function renderRoute(next, focus = '') {
    const openComputerAfter=next.view==='computer';
    if(openComputerAfter)next=next.returnTo??{host:next.host,view:'sessions'};
    computerOpen=false;
    if(next.view==='management'&&!next.settings)next={...next,settings:'home'};
    if(!['computer','add','attention'].includes(route.view))visits[route.host]=$state.snapshot(route);
    clearTimeout(statusTimer);
    conversationPicker = null; conversationAction++; connecting = ''; picker=false; spaces.close();legacyRestore=false;workActions=false;spaceOpenAction++;spaceOpening=false;
    const switchingSession = next.view === 'terminal' && route.view === 'terminal' && next.host === route.host;
    route = next; menu = false; status = ''; password = '';
    prepareDraft(next);
    await tick();
    if(openComputerAfter)computerOpen=true;
    if (keyFor(route) !== keyFor(next)) return;
    if (next.view === 'screens') alignScreen();
    if (main) main.scrollTop = positions.get(keyFor(next)) ?? 0;
    if (switchingSession) return; // Keep the same focused composer and mobile keyboard.
    const control = focus && document.getElementById(focus);
    (control || document.querySelector('h1'))?.focus({ preventScroll: true });
  }
  function navigate(view, extra = {}, invoker = '') {
    remember(); restoreFocus = invoker;
    if(!['computer','add','attention'].includes(route.view)) visits[route.host]=$state.snapshot(route);
    const next = { view, host: hosts.current, ...extra };
    history.pushState({ deskpilot: $state.snapshot(next) }, '', location.href);
    renderRoute(next);
  }
  function home(top = false) {
    if (top) positions.set(keyFor({ host: hosts.current, view: 'sessions' }), 0);
    navigate('sessions');
  }
  function cancel() {
    // Our form entries always have an in-app predecessor.
    history.back();
  }
  function choose(origin) {
    if (origin === hosts.current) { closeComputer(); return; }
    computerOpen=false;
    remember(); switchTo(origin);
    if(!['computer','add','attention'].includes(route.view)) visits[route.host]=$state.snapshot(route);
    const next=visits[origin]??{host:origin,view:'sessions'};
    navigate(next.view,{...next,host:origin});
  }
  function migrateRoute(value){const next={...value};if(next.view==='attention'){next.view='sessions';next.filter='blocked';next.across=true;}delete next.review;delete next.reviewIndex;if(next.returnTo)next.returnTo=migrateRoute(next.returnTo);return next;}
  function updateSpaces(values){if('workQuery'in values)route.query=values.workQuery;if('workNeeds'in values)route.filter=values.workNeeds?'blocked':'all';if('workAcross'in values)route.across=values.workAcross;if('workShowHidden'in values)spacePreferences[hosts.current]={...spacePreferences[hosts.current],showHidden:values.workShowHidden};if(values.workExpanded)spacePreferences[hosts.current]={...spacePreferences[hosts.current],expanded:values.workExpanded};}
  function showSpaces(needs=false){if(needs){route.query='';route.filter='blocked';route.across=true;}picker=true;}
  function closeSpaces(){picker=false;spaceOpenAction++;spaceOpening=false;}
  async function openSpaceItem(item,options={}){
    if(item.viewOnly)return onstatus('This program is available through Desktop; it has no controllable terminal.');
    if(!item.generation)return onstatus('Update or refresh this computer to confirm terminal identity before opening it.',true);
    const host=hosts.list.find(h=>h.origin===item.computer),from=keyFor(route),action=++spaceOpenAction;
    if(!host)return;spaceOpening=true;
    try{
      let name=item.session;
      if(item.source!=='Terminal'){
        const result=await post(`/${item.source==='Herdr'?'herdr':'conversations'}/connect`,{id:item.id},{host,timeoutMs:20000});name=result.session;
      }
      const list=await api('/sessions',{host});
      const resolved=liveItems(host.origin,list).find(i=>i.session===name&&sameSource(sourceRef(i),sourceRef(item)));
      if(!resolved)throw Error('This work closed or changed. It will not be recreated.');
      if(from!==keyFor(route)||spaceOpenAction!==action)return;
      const returnTo=route.view==='terminal'?route.returnTo:$state.snapshot(route),sameHost=host.origin===hosts.current;
      if(!sameHost){visits[hosts.current]=$state.snapshot(route);switchTo(host.origin);}
      const sibling=options.sibling&&sameHost;
      const next={view:'terminal',host:host.origin,session:name,ref:sourceRef(item),returnTo,query:route.query,filter:route.filter,across:route.across,...(sibling?{scope:route.scope,order:$state.snapshot(route.order)}:{})};
      remember();history[route.view==='terminal'?'replaceState':'pushState']({deskpilot:$state.snapshot(next)},'',location.href);
      if(sameHost)sessions=list;
      renderRoute(next);
    }catch(e){if(keyFor(route)===from&&spaceOpenAction===action)onstatus(`${displayName(host)}: ${e.message}`,true);}
    finally{if(spaceOpenAction===action)spaceOpening=false;}
  }
  function noteRecent(item) { const id=item.id||item.session,kind=item.kind||'session';recent[hosts.current]=[{kind,id},...(recent[hosts.current]??[]).filter(r=>r.id!==id||r.kind!==kind)].slice(0,8); }
  function open(s) { const item=localSpaceItems.find(i=>i.session===s.session);if(item)return openSpaceItem(item); }
  function showConversationScreen(win) {
    showScreen(win.workspace, false);
    navigate('screens');
  }
  function dismissConversationPicker(picker) {
    if (picker !== conversationPicker) return;
    showScreen(picker.workspace, false);
    conversationPicker = null; conversationAction++; connecting = '';
  }
  function openComputer(focus='computer-nav') {
    computerOrigin={picker,focus:typeof focus==='string'?focus:document.activeElement?.id};
    closeSpaces();computerOpen=true;
  }
  async function closeComputer(){computerOpen=false;if(computerOrigin.picker&&!wide)picker=true;await tick();document.getElementById(computerOrigin.focus||'computer-nav')?.focus({preventScroll:true});}
  function pairFromComputer(){computerOpen=false;navigate('add',{returnTo:$state.snapshot(route),fromComputer:true},'computer-nav');}
  function navigationAction(kind,item){
    if(kind==='visibility')return spaces.visibility(item,!spaceState.workHiddenSources?.[item.computer]?.some(s=>sameSource(s,sourceRef(item))));
    if(kind==='new'){closeSpaces();return create();}
    if(kind==='refresh')return refresh();
    if(kind==='organization')return spaces.load(currentHost(),true);
    workActions=true;
  }
  function emptyTab(space,tab,mode){spaces.openTask(space,tab);if(mode==='start')spaces.startTerminal();else spaces.addExisting();}
  function reloadUI(){savePlace();location.reload();}

  function computerDestination(view) {
    computerOpen=false;
    navigate(view,{returnTo:$state.snapshot(route),...(view==='management'?{settings:'home'}:{})},'computer-nav');
  }
  async function pollAttention() {
    const list=hosts.list.map(h=>({...h}));
    await Promise.all(list.map(async host=>{
      const observedAt=Date.now();
      try {
        const [s,ch,n,a]=await Promise.all([api('/sessions',{host,timeoutMs:6000}),api('/conversations',{host,timeoutMs:6000}).catch(()=>null),api('/herdr',{host,timeoutMs:6000}).catch(()=>null),api('/unmanaged',{host,timeoutMs:6000}).catch(()=>null)]);
        if(!hosts.list.some(h=>h.origin===host.origin))return;
        const snapshot=inventory(host,s,ch?.items??[],n?.items??[],a??[]);
        inventories[host.origin]={...snapshot,sessions:s,chats:ch?.items??[],native:n?.items??[],agents:a??[],health:'ready',observedAt,limited:!ch||!n||!a};setAttention(host.origin,s);
      } catch(e) {if(hosts.list.some(h=>h.origin===host.origin))inventories[host.origin]={...(inventories[host.origin]??{items:[],unknown:0}),health:e.status===401?'auth':'offline',observedAt};}
    }));
  }
  function create(workspace = null, invoker = 'new-session', task = null) {
    creationDrafts[hosts.current] ??= { name: '', dir: '', command: 'bash', workspace: route.view === 'screens' ? (workspace ?? screen) : null };
    navigate('new', { returnTo: $state.snapshot(route),...(task?{task}: {}) }, invoker);
  }
  async function created(result) {
    const here = hosts.current, generation = epoch;

    await refresh();
    if (here !== hosts.current || generation !== epoch || route.view !== 'new') return;
    if (!sessions.some(s => s.session === result.session)) sessions = [...sessions, result];
    const item=liveItems(here,sessions,conversations,herdrTerminals).find(i=>i.session===result.session);
    if(!item?.generation){onstatus('Session created. Refresh to confirm its identity; it will not be created again.',true);home();return;}
    let groupingError='';if(route.task){try{await spaces.assignCreated(item,route.task);}catch(e){groupingError=e.message;}if(here!==hosts.current||generation!==epoch||route.view!=='new')return;}
    const next = { view: 'terminal', host: here, session: result.session,ref:sourceRef(item), returnTo: route.returnTo };
    history.replaceState({ deskpilot: $state.snapshot(next) }, '', location.href);
    renderRoute(next);
    delete creationDrafts[here];
    onstatus(groupingError||result.warning || (result.workspace == null ? 'Session created' : `Session created; desktop placement requested on Screen ${result.workspace}`), !!(groupingError||result.warning));
  }
  function paired() { home(true); refresh(); onstatus('Machine paired'); }

  async function refresh() {
    const host = currentHost(), generation = epoch, seq = ++request;
    try {
      const [list, agents, c, w, l] = await Promise.all([
        api('/sessions', { host }), api('/unmanaged', { host }),
        api('/capabilities', { host }),
        api('/desk/state', { host }).catch(() => []),
        api('/desk/locked', { host }).catch(() => ({ locked: false })),
      ]);
      if (host.origin !== hosts.current || generation !== epoch || seq !== request) return;
      sessions = list; unmanaged = agents; windows = w; locked = l.locked; setCaps(host.origin, c);
      setAttention(host.origin, list);
      connection = 'ready';lastObserved=Date.now();spaces.load(host);
      // Optional agent discovery must never delay ordinary terminal loading.
      api('/conversations', { host, timeoutMs: 10000 }).then(chats => {
        if (host.origin === hosts.current && generation === epoch && seq === request) conversations = chats.items ?? [];
      }).catch(() => {
        if (host.origin === hosts.current && generation === epoch && seq === request) conversations = [];
      });
      api('/herdr', { host, timeoutMs: 10000 }).then(result => {
      if (host.origin === hosts.current && generation === epoch && seq === request) {
        if(result.available){herdrTerminals=result.items??[];herdrNotice='';herdrSeenAt=Date.now();}
        else if(herdrTerminals.length)herdrNotice='Herdr is unavailable. Showing its last known terminals.';
      }
      }).catch(() => {
        if (host.origin === hosts.current && generation === epoch && seq === request && herdrTerminals.length) herdrNotice='Could not refresh Herdr. Showing its last known terminals.';
      });
      api('/herdr/management',{host,timeoutMs:10000}).then(result=>{if(host.origin===hosts.current&&generation===epoch&&seq===request)herdrManagement=result;}).catch(()=>{if(host.origin===hosts.current&&generation===epoch&&seq===request)herdrManagement={...(herdrManagement??{}),writable:false,reason:'Herdr management is unavailable. Running terminals remain accessible.'};});
    } catch (e) {
      if (host.origin !== hosts.current || generation !== epoch || seq !== request) return;
      connection = e.status === 401 ? 'auth' : e.unreachable ? 'offline' : 'error';
      if (connection === 'error') onstatus(e.message, true);
    }
  }
  async function connectConversation(chat, provider = 'conversations') {
    const host = currentHost(), generation = epoch, from = route, action = ++conversationAction;
    const current = () => host.origin === hosts.current && generation === epoch && route === from && action === conversationAction;
    connecting = chat.id;
    onstatus('');
    try {
      const result = chat.session ? { session: chat.session } : await post(`/${provider}/connect`, { id: chat.id }, { host, timeoutMs: 20000 });
      if (!current()) return;
      await refresh();
      if (!current()) return;
      const session = sessions.find(s => s.session === result.session);
      if (!session) throw new Error('The mobile terminal is starting. Refresh sessions to open it.');
      if (conversationPicker) showScreen(conversationPicker.workspace, false);
      conversationPicker = null;
      noteRecent({...chat,kind:provider==='herdr'?'herdr':'conversation'});
      if (route.view==='terminal') { picker=false;switchSession(session.session); } else open({...session,id:chat.id,kind:provider==='herdr'?'herdr':'conversation'});
      onstatus('Mobile terminal opened. Your desktop window stays available.');
      return true;
    } catch (e) {
      if (current()) { onstatus(e.message, true); return e.message; }
    } finally {
      if (host.origin===hosts.current&&generation===epoch&&action===conversationAction) connecting = '';
    }
  }
  $effect(() => {
    const here = hosts.current;
    void vis.wokeAt;
    untrack(() => {
    if (shownHost !== here) {
      screensByHost.set(shownHost, screen); screen = screensByHost.get(here) ?? 1;
      shownHost = here; epoch++; sessions = []; unmanaged = []; windows = []; conversations = []; herdrTerminals = []; herdrManagement=null;herdrNotice='';herdrSeenAt=0;lastObserved=0;herdrAction=null; connecting = ''; connection = 'loading';
      if (route.host !== here) {
        positions.set(keyFor({ host: here, view: 'sessions' }), 0);
        renderRoute({ host: here, view: 'sessions' });
      }
    }
    ready.then(refresh);
    });
    if (!vis.visible) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    hosts.list.map(h=>h.origin);
    untrack(()=>{pollAttention();for(const host of hosts.list)spaces.load(host);});
    if (!vis.visible) return;
    const timer = setInterval(()=>{pollAttention();if(!spaces.action&&!spaces.busy)for(const host of hosts.list)spaces.load(host,true);}, 15000);
    return () => clearInterval(timer);
  });
  $effect(()=>{
    const surface=sidebar,host=hosts.current,ready=connection,desktop=wide;
    if(surface&&desktop&&ready==='ready')untrack(()=>tick().then(()=>{if(sidebar===surface&&host===hosts.current)surface.scrollTop=spacePreferences[host]?.scroll||0;}));
  });
  onMount(() => {
    const layout=matchMedia('(min-width:960px)');
    const layoutChanged=()=>{wide=layout.matches;if(wide&&picker)closeSpaces();};
    layout.addEventListener('change',layoutChanged);
    // A fresh PWA window has no in-app predecessor. Rebuild one so Back/Cancel
    // still works after restoring a terminal or an unfinished creation form.
    if (!previousEntry && ['terminal', 'new', 'computer'].includes(route.view)) {
      const parent = route.returnTo ?? { view: 'sessions', host: route.host };
      route = { ...route, returnTo: parent };
      history.replaceState({ deskpilot: $state.snapshot(parent) }, '', location.href);
      history.pushState({ deskpilot: $state.snapshot(route) }, '', location.href);
    }
    history.replaceState({ deskpilot: $state.snapshot(route) }, '', location.href);
    const hidden = () => { if (document.hidden) savePlace(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', savePlace);
    const back = e => {
      if (!e.state?.deskpilot) return;
      if(computerOpen){closeComputer();history.pushState({deskpilot:$state.snapshot(route)},'',location.href);return;}
      if(paneRef?.dismissTools()){history.pushState({deskpilot:$state.snapshot(route)},'',location.href);return;}
      if(legacyRestore||coverage||workActions){legacyRestore=false;coverage=false;workActions=false;history.pushState({deskpilot:$state.snapshot(route)},'',location.href);return;}
      if(spaces.action){spaces.close();history.pushState({deskpilot:$state.snapshot(route)},'',location.href);return;}
      if(herdrAction||conversationPicker||menu||picker){if(herdrAction)herdrAction=null;else if(conversationPicker)dismissConversationPicker(conversationPicker);else if(menu)menu=false;else closeSpaces();history.pushState({deskpilot:$state.snapshot(route)},'',location.href);return;}
      const returningToComputer=route.view==='add'&&route.fromComputer;
      remember(); const next = e.state.deskpilot;
      if (!hosts.list.some(h => h.origin === next.host)) { home(true); return; }
      switchTo(next.host); renderRoute(next, restoreFocus).then(()=>{if(returningToComputer)computerOpen=true;}); restoreFocus = '';
    };
    const resize = () => {
      document.documentElement.style.setProperty('--app-h', `${window.visualViewport?.height ?? innerHeight}px`);
      requestAnimationFrame(() => { if (route.view === 'screens') alignScreen(); });
    };
    window.addEventListener('popstate', back);
    window.visualViewport?.addEventListener('resize', resize); resize();
    return () => {
      layout.removeEventListener('change',layoutChanged);
      clearTimeout(saveTimer);clearTimeout(statusTimer);
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', savePlace);
      window.removeEventListener('popstate', back); window.visualViewport?.removeEventListener('resize', resize);
    };
  });
  async function unlock(e) {
    e.preventDefault();
    const host = currentHost(), generation = epoch, secret = password;
    password = ''; unlocking = true;
    try {
      await post('/unlock', { password: secret }, { host, timeoutMs: 20000 });
      if (generation === epoch && hosts.current === host.origin) { onstatus('Desktop unlocked'); refresh(); }
    } catch (e) { if (generation === epoch && hosts.current === host.origin) onstatus(e.message, true); }
    finally { unlocking = false; }
  }
  async function action(kind) {
    if (actionBusy || !selected) return;
    if (kind === 'kill' && !confirm(sharedView?'Disconnect this mobile view? The original work keeps running.':`End session "${selected.session}"? Anything running in it will stop.`)) return;
    if(selectedHerdr&&kind!=='kill')return;
    const host = currentHost(), generation = epoch, name = selected.session, shared = sharedView;
    const view = route;
    actionBusy = true;
    try {
      await post(`/sessions/${kind}`, { session: name,...(selected.terminalId?{expected:{terminalId:selected.terminalId,generation:selected.generation}}:{}), ...(kind === 'rename' ? { name: rename.trim() } : {}), ...(kind === 'attach' ? { workspace: target } : {}) }, { host });
      if (generation !== epoch || host.origin !== hosts.current || route !== view) return;
      // The compositor accepts a placed terminal before that window appears in
      // its client list. An immediate refresh therefore observes the old
      // workspace and makes a successful action look like it did nothing.
      // Invalidate any poll that started before this response and reconcile the
      // action locally; the regular poll confirms the authoritative state once
      // the new client is discoverable.
      request++;
      if (kind === 'rename') {
        const nextName = rename.trim();
        sessions = sessions.map((item) => item.session === name ? { ...item, session: nextName } : item);
        // Draft and organization keys use the stable runtime identity.
        route = { ...route, session: nextName };
        history.replaceState({ deskpilot: $state.snapshot(route) }, '', location.href);
      }
      if (kind === 'attach') {
        const workspace = Number(target);
        sessions = sessions.map((item) => {
          if (item.session !== name) return item;
          const workspaces = [...new Set([...(item.workspaces ?? []), workspace])].sort((a, b) => a - b);
          return { ...item, workspace: item.workspace ?? workspace, workspaces, attached: true };
        });
      }
      if (kind === 'kill') { sessions = sessions.filter((item) => item.session !== name); home(); }
      menu = false;
      if (kind !== 'attach') await refresh();
      if (host.origin === hosts.current) onstatus(kind === 'attach' ? `Opening ${name} on Screen ${target}` : kind === 'kill' ? shared ? 'Mobile view closed; original work keeps running' : 'Session ended' : 'Session renamed');
    } catch (e) { if (generation === epoch && host.origin === hosts.current) onstatus(e.message, true); }
    finally { actionBusy = false; }
  }
</script>

{#snippet workNavigator()}
  <WorkNavigation state={spaceState} onchange={updateSpaces} open={openSpaceItem} create={()=>spaces.newSpace()} manage={space=>spaces.manage(space)} manageTab={(space,tab)=>spaces.manageTab(space,tab)} emptyTask={emptyTab} computer={()=>openComputer('navigation-computer')} coverage={()=>coverage=true} actions={navigationAction}/>
  {#if spaces.health[hosts.current]==='error'}<p class="navigation-error" role="status">{spaces.errors[hosts.current]}</p><button onclick={()=>spaces.load(currentHost(),true)}>Refresh organization</button>{/if}
  {#if herdrNotice}<p class="navigation-error" role="status">{herdrNotice}{herdrSeenAt?' Last observed '+new Date(herdrSeenAt).toLocaleString():''}</p>{/if}
{/snippet}
<div class="app-shell">
{#if wide}<aside class="work-sidebar" aria-label="Spaces sidebar" bind:this={sidebar} onscroll={e=>spacePreferences[hosts.current]={...spacePreferences[hosts.current],scroll:e.currentTarget.scrollTop}}>{@render workNavigator()}</aside>{/if}
<div class="app-content">
<UpdateNotice onreload={reloadUI}/>
{#if (route.view!=='sessions'||connection!=='ready')&&!(route.view==='terminal'&&route.ref&&selected&&activeSource?.generation)}
<header class="app-header"><button class="mobile-spaces" aria-label="Open spaces" onclick={()=>showSpaces()}>☰ Spaces</button><button class="app-brand" aria-label="Spaces" onclick={()=>home()}>Deskpilot</button><button id="computer-nav" aria-label="Computer" onclick={()=>openComputer()}>{displayName()} ⌄</button></header>
{/if}
{#if status}<div class:err={bad} class:terminal-feedback={route.view==='terminal'} class="feedback" role={bad ? 'alert' : 'status'}><span>{status}</span><button aria-label="Dismiss message" onclick={()=>status=''}>×</button></div>{/if}

{#if route.view === 'terminal' && route.ref && selected && activeSource?.generation}
  {#if menu}<Sheet label={'Terminal actions'} onclose={()=>menu=false}><div class="session-menu"><p class="terminal-location">{displayName()} · {activeSource.source} · {sessionLocation(selected)}{activeSource.cwd?' · '+tilde(activeSource.cwd):''}</p>
    {#if legacyDraft?.input||legacyDraft?.clip}<button onclick={()=>legacyRestore=true}>Review saved draft from the earlier layout</button>{/if}
    <button onclick={()=>spaces.move(activeSource)} disabled={!activeSource?.organizable}>Move to tab</button>
    {#if taskContext&&!taskContext.space.unassigned&&!taskContext.space.available&&!taskContext.space.hidden}<button onclick={()=>spaces.manage(taskContext.space)}>Manage space</button>{/if}
    {#if caps.previews}<button onclick={() => navigate('previews')}>Previews</button>{/if}
    {#if selectedHerdr}
      <button onclick={() => herdrAction={kind:'terminal',spaceId:selectedHerdr.space?.id,tabId:selectedHerdr.tab?.id,terminalId:selectedHerdr.id}}>Manage Herdr terminal</button>
      {#if herdrWindows.length===1}<button onclick={() => showConversationScreen(herdrWindows[0])}>Show Herdr window · Screen {herdrWindows[0].workspace}</button>{:else if caps.windows}<span class="dim">Herdr window location is unavailable or ambiguous.</span>{/if}
      <span class="dim">Disconnecting closes this mobile view. Herdr's original program keeps running.</span>
    {:else}
    {#if selectedConversation}<span class="dim shared-context">Codex · {tilde(selectedConversation.path)}. Disconnecting closes this mobile view; the original conversation keeps running.</span>{#if windowForConversation(selectedConversation)}<button onclick={() => showConversationScreen(windowForConversation(selectedConversation))}>Show original desktop window</button>{/if}{/if}
    <label>{selectedConversation?'Mobile view name':'Session name'}<input bind:value={rename} aria-label="Session name" /></label><button disabled={actionBusy || !rename.trim()} onclick={() => action('rename')}>Rename</button>
    {#if caps.windows}<label>Desktop screen<select bind:value={target}>{#each workspaces as n}<option value={n}>Screen {n}</option>{/each}</select></label><button disabled={actionBusy} onclick={() => action('attach')}>Open on desktop…</button>{/if}
    {/if}
    <button class:danger={!sharedView} disabled={connection!=='ready'||!selected||actionBusy} onclick={()=>action('kill')}>{sharedView?'Disconnect mobile view':'End session'}</button>
  </div></Sheet>{/if}
  {#key hosts.current}<Pane bind:this={paneRef} ws={selected.workspace} session={selected} windows={[]} orphans={[]} allNames={sessions.map(s => s.session)} {workspaces} active={true} enabled={connection==='ready'} {onstatus} onchanged={refresh} onstep={stepSession} bind:draft={drafts[draftKey]}>
    {#snippet navigation()}
      <div class="terminal-heading">
        <div class="session-pager" aria-label="Terminal navigation">
          <button id="spaces-open" class="mobile-spaces" aria-label="Open spaces" onclick={()=>showSpaces()}>☰ Spaces</button>
          <div class="session-title" title={sessionTitle(selected)}><span class="name">{sessionTitle(selected)}</span><span class="dim">{taskContext?.space.name||'Unassigned'}{taskContext&&!taskContext.space.available&&!taskContext.space.hidden?' / '+taskContext.tab.name:''}</span></div>
          <button id="terminal-actions" class="session-step" aria-label={'Terminal actions'} onclick={()=>{menu=true;rename=route.session;}}>⋯</button>
        </div>
        <div class="terminal-context">
          <button id="computer-nav" class="terminal-computer" aria-label="Computer" title={displayName()+' · '+(connection==='ready'?'Connected':connection==='offline'?'Cannot reach':connection==='auth'?'Pairing required':connection)} onclick={()=>openComputer()}><span class:online={connection==='ready'} aria-hidden="true">●</span><span>{displayName()}</span> ⌄</button>
          <span class="terminal-source">{activeSource.source} · {activeSource.status==='needs'?'Needs you':activeSource.status==='working'?'Working':activeSource.status==='idle'?'Idle':'Attention unknown'}</span>
          <div class="terminal-steps"><button class="session-step" aria-label="Previous terminal" disabled={spaceOpening||sessionIndex<=0} onpointerdown={keepComposerFocus} onclick={()=>stepSession(-1)}>‹</button><button class="session-step" aria-label="Next terminal" disabled={spaceOpening||sessionIndex>=sessionPages.length-1} onpointerdown={keepComposerFocus} onclick={()=>stepSession(1)}>›</button></div>
        </div>
        {#if connection!=='ready'}<div class="connection-notice" role="status"><span>{connection==='auth'?'Pairing required':connection==='loading'?'Connecting to '+displayName():'Cannot reach '+displayName()}. Draft preserved.</span>{#if connection==='auth'}<button onclick={()=>{pairingDraft.address=currentHost().origin;navigate('add',{returnTo:$state.snapshot(route)});}}>Pair computer</button>{:else}<button onclick={refresh}>Retry connection</button>{/if}</div>{/if}
      </div>
    {/snippet}
  </Pane>{/key}
{:else}
<main bind:this={main} onscroll={scheduleSave} class:screens-view={route.view === 'screens' && caps.windows && connection === 'ready'}>
  {#if route.view === 'add'}
    <AddMachine bind:draft={pairingDraft} onpaired={paired} oncancel={cancel} />
  {:else if route.view === 'new'}
    <h1 tabindex="-1">New terminal</h1>
    {#key hosts.current}<NewSession taken={sessions.map(s => s.session)} bind:draft={creationDrafts[hosts.current]} onchanged={created} oncancel={cancel} />{/key}
  {:else if route.view === 'management'}
    {#key hosts.current}<Management bind:page={route.settings} {onstatus} connected={connection === 'ready'} herdr={herdrManagement} onpair={() => navigate('add',{returnTo:$state.snapshot(route)},'settings-pair')} onwork={() => home()} />{/key}
  {:else if route.view === 'computer'}
    <h1>Computer</h1><p>{displayName()} · {connection==='ready'?'Connected':connection}</p>
  {:else if connection !== 'ready'}
    {#if connection === 'loading'}<h1 tabindex="-1">Loading work…</h1><p role="status">Connecting to {displayName()}.</p>
    {:else if connection === 'auth'}<h1 tabindex="-1">Pairing required</h1><p>Pair this device with {displayName()} to continue.</p><button class="primary" onclick={() => { pairingDraft.address = currentHost().origin; navigate('add'); }}>Pair this machine</button>
    {:else if connection === 'offline'}<h1 tabindex="-1">Cannot reach {displayName()}</h1><p>Cannot reach {displayName()}. Check the machine and your Tailscale connection.</p><button onclick={refresh}>Retry connection</button>
    {:else}<h1 tabindex="-1">Could not load work</h1><button onclick={refresh}>Try again</button>{/if}
  {:else if route.view === 'previews'}
    {#key hosts.current}{#if caps.previews}<Previews />{:else}<h1 tabindex="-1">Previews unavailable</h1><p>This machine does not support published task previews yet.</p>{/if}{/key}
  {:else if route.view === 'screens' && !caps.windows}<h1 tabindex="-1">Desktop unavailable</h1><p>This computer is headless or does not support desktop controls. Sessions and Previews remain available.</p>
  {:else if route.view === 'screens' && caps.windows}
    <div class="screen-heading">
      <h1 tabindex="-1">Desktop</h1>
      <label class="screen-picker"><span>Jump to</span><select aria-label="Desktop workspace" value={screen} onchange={e => showScreen(e.currentTarget.value)}>{#each workspaces as n}<option value={n}>Screen {n}</option>{/each}</select></label>
    </div>
    <p class="dim view-description">Manage windows, placement and screen captures. Find your work in Spaces.</p>
    <div class="screen-pager" aria-label="Screen navigation">
      <button class="screen-step" aria-label="Previous screen" disabled={screen === 1} onclick={() => showScreen(screen - 1)}>‹</button>
      <div class="screen-position" aria-live="polite">
        <span>Screen {screen} of {workspaces.length}</span>
        <div class="screen-dots" aria-hidden="true">
          {#each workspaces as n}<i class:on={n === screen} class:has={sessions.some(s => s.workspace === n) || windows.some(w => w.workspace === n)}></i>{/each}
        </div>
      </div>
      <button class="screen-step" aria-label="Next screen" disabled={screen === workspaces.length} onclick={() => showScreen(screen + 1)}>›</button>
    </div>
    {#if locked}<p class="dim">Desktop locked. Screenshots are unavailable.</p>
      {#if caps.unlock}<form onsubmit={unlock}><label>Desktop password<input type="password" bind:value={password} autocomplete="current-password" /></label><button disabled={unlocking || !password}>{unlocking ? 'Unlocking…' : 'Unlock desktop'}</button></form>{/if}
    {/if}
    <div class="screen-rail" bind:this={screenRail} onscroll={onScreenScroll} aria-label="Desktop screens">
      {#each workspaces as n}
        <section class="screen-page" aria-label={`Screen ${n}`} aria-hidden={n !== screen} inert={n !== screen}>
          {#each windows.filter(w => w.workspace === n) as win (win.address)}
            <WindowRow {win} {workspaces} {onstatus} onchanged={refresh}>
              {#snippet children()}
                {@const linked = sessions.filter(s => s.windows?.includes(win.address))}
                {#each linked as s (s.session)}<button class="window-terminal" onclick={() => open(s)}>Open terminal · {sessionTitle(s)}</button>{/each}
                {#if win.class==='herdr-app'}<button class="window-terminal" onclick={() => home()}>Open Herdr in Work</button>{/if}
                {#if isTerminalWindow(win) && conversations.length}
                  {@const chat = windowConversations.get(win.address)}
                  {#if chat}
                    {#if !linked.some(s=>s.codexThreadId===chat.id||s.session===chat.session)}<button class="window-terminal" data-conversation={chat.id} disabled={!!connecting} onclick={() => connectConversation(chat)}>{connecting===chat.id?'Connecting…':'Open terminal'} · {chat.title}</button>{/if}
                  {:else if !linked.length}
                    <button class="window-connect" onclick={() => { conversationPicker = { ...win }; }}>Connect conversation…</button>
                  {/if}
                {/if}
              {/snippet}
            </WindowRow>
          {:else}<p class="dim">No windows on Screen {n}.</p>{/each}
          {#each sessions.filter(s => (s.workspaces?.includes(n)||s.workspace===n) && !s.windows?.some(address=>windows.some(w=>w.workspace===n&&w.address===address))) as s (s.session)}<button class="window-terminal" onclick={() => open(s)}>Open terminal · {sessionTitle(s)}</button>{/each}
          <button id={`new-session-${n}`} class="primary screen-new" onclick={() => create(n, `new-session-${n}`)}>Start work on Screen {n}</button>
        </section>
      {/each}
    </div>
  {:else if route.view === 'terminal'}
    {#if !route.ref&&activeSource?.generation}<h1 tabindex="-1">Confirm saved work</h1><p>The earlier layout saved this view by name. Confirm the current work before opening it.</p><p><strong>{activeSource.name}</strong><br/>{displayName()} · {activeSource.source}<br/>{tilde(activeSource.cwd)}</p><button class="primary" onclick={()=>openSpaceItem(activeSource)}>Open current work</button><button onclick={()=>home()}>Browse Spaces</button>{:else}<h1 tabindex="-1">Work closed or changed</h1><p>This source is no longer available. Its drafts remain saved for its original identity.</p><button onclick={() => home()}>Browse Spaces</button>{/if}
  {:else}

    {#if !wide}{@render workNavigator()}{:else}<div class="work-welcome"><h1 tabindex="-1">Choose a terminal</h1><p>Select work from Spaces on the left, or create a terminal to begin.</p><button onclick={()=>create()}>New terminal</button></div>{/if}

  {/if}
</main>
{/if}
</div>
</div>
{#if computerOpen}<ComputerSheet hosts={hosts.list} current={hosts.current} {caps} onchoose={choose} onopen={computerDestination} onpair={pairFromComputer} onclose={closeComputer}/>{/if}
{#if picker&&!wide}<Sheet label="Spaces" onclose={closeSpaces} drawer initialScroll={spacePreferences[hosts.current]?.scroll||0} onscroll={scroll=>spacePreferences[hosts.current]={...spacePreferences[hosts.current],scroll}}>{@render workNavigator()}{#if spaceOpening}<p role="status">Opening work…</p>{/if}</Sheet>{/if}
{#if workActions}<Sheet label="Work actions" onclose={()=>workActions=false}><div class="work-actions-list"><button onclick={()=>{workActions=false;closeSpaces();create();}}>New terminal</button><button onclick={()=>{workActions=false;refresh();}}>Refresh work</button><button onclick={()=>{workActions=false;spaces.load(currentHost(),true);}}>Refresh organization</button>{#if herdrManagement?.available}<button onclick={()=>{workActions=false;herdrAction={kind:'library'};}}>Herdr management</button>{/if}</div></Sheet>{/if}
<OrganizationForms controller={spaces} model={spaceState} nativeAvailable={herdrManagement?.writable} onNative={target=>herdrAction=target}/>
{#if coverage}<Sheet label="Attention coverage" onclose={()=>coverage=false}><p>Codex does not report input requests. Unknown and offline work is not an all-clear.</p>{#each liveHosts as host}<p>{host.name} · {host.health}</p>{/each}</Sheet>{/if}
{#if legacyRestore&&legacyDraft}<Sheet label="Restore earlier draft" onclose={()=>legacyRestore=false}><p>This draft was saved by name in the earlier layout. Review it before adding it to {sessionTitle(selected)}.</p><pre class="legacy-text">{legacyDraft.input}</pre>{#if legacyDraft.clip}<p>Saved paste text</p><pre class="legacy-text">{legacyDraft.clip}</pre>{/if}<button onclick={()=>{const draft=drafts[draftKey];draft.input=[draft.input,legacyDraft.input].filter(Boolean).join('\n');draft.clip=[draft.clip,legacyDraft.clip].filter(Boolean).join('\n');delete drafts[legacyKey];legacyRestore=false;}}>Add to this terminal’s drafts</button></Sheet>{/if}

{#if conversationPicker && route.view === 'screens'}
  {@const picker = conversationPicker}
  <ConversationPicker win={picker} chats={conversations} {connecting} onconnect={connectConversation} onclose={() => dismissConversationPicker(picker)} />
{/if}
{#if herdrAction}{#key hosts.current}<HerdrActions management={herdrManagement} terminals={herdrTerminals} host={hosts.current} target={herdrAction} onclose={() => herdrAction=null} onchanged={herdrChanged} />{/key}{/if}

<style>
header { display:flex; flex-direction:column; gap:9px; padding:15px 16px 12px; border-bottom:1px solid var(--line); flex:none; }
.app-brand {display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;font-size:11px;letter-spacing:.08em;}

.view-description {font-size:12px;margin:0;line-height:1.5;} .shared-context {width:100%;font-size:12px;}


header button { flex:none; width:44px; font-size:18px; color:var(--ok);padding:6px; }

.session-pager { display:flex; align-items:center; flex:1; min-width:0; gap:.15rem; }
.session-step { flex:none; width:44px; padding:0; font-size:24px; border-color:transparent; }
main { flex:1; min-height:0; overflow:auto; padding:18px 16px; display:flex; flex-direction:column; gap:16px; overflow-wrap:anywhere; }
main > :global(*) { flex-shrink:0; }
.screens-view { overflow:hidden; }
.screens-view > .screen-rail {
  display:flex; flex:1 1 auto; min-width:0; min-height:0; overflow-x:auto;
  scroll-snap-type:x mandatory; overscroll-behavior-x:contain;
  scrollbar-width:none;
}
.screen-heading { display:flex; align-items:end; justify-content:space-between; gap:.7rem; }
.screen-picker { flex-direction:row; align-items:center; gap:.5rem; font-size:12px; }
.screen-picker select { width:auto; padding-block:.3rem; }
.screen-pager {
  display:flex; align-items:center; gap:.55rem; width:100%;
  border:1px solid var(--line); border-radius:var(--radius); background:var(--panel);
}
.screen-step { flex:none; width:44px; border:0; border-radius:calc(var(--radius) - 1px); font-size:24px; line-height:1; }
.screen-position { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:.2rem; font-size:12px; }
.screen-dots { display:flex; align-items:center; justify-content:center; gap:5px; height:8px; }
.screen-dots i { display:block; width:6px; height:6px; border-radius:50%; background:var(--line); }
.screen-dots i.has { background:var(--dim); }
.screen-dots i.on {
  width:8px; height:8px; background:var(--ok);
  box-shadow:0 0 8px -1px color-mix(in srgb, var(--ok) 70%, transparent);
}
.screen-rail::-webkit-scrollbar { display:none; }
.screen-rail:has(:global(.lightbox)) { overflow-x:hidden; scroll-snap-type:none; }
.screen-page {
  flex:0 0 100%; width:100%; min-width:0; min-height:0; overflow-y:auto;
  display:flex; flex-direction:column; gap:.7rem;
  scroll-snap-align:start; scroll-snap-stop:always; overscroll-behavior-y:contain;
}
.screen-page > :global(*) { flex-shrink:0; }
.screen-new { margin-top:auto; }
.feedback { padding:.4rem .7rem; overflow-wrap:anywhere; flex:none; font-size:12px; }
.session-menu { padding:.7rem; display:flex; flex-wrap:wrap; gap:.5rem; max-height:45%; overflow:auto; }
.session-menu label { flex:1; min-width:140px; }
@media(max-width:380px) {main {padding:16px 12px;}}
@media(max-height:480px) { header { padding:4px 8px;gap:3px; } .app-brand {font-size:10px;}   }

.app-header{height:64px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;padding:10px 18px;gap:12px;}
.app-brand{width:auto;display:flex;justify-content:flex-start;gap:9px;border:0;letter-spacing:-.2px;font-size:14px;padding:0;min-height:44px;}


.terminal-heading{width:100%;display:flex;flex-direction:column;gap:0;}.session-pager{width:100%;gap:0;}
.session-title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;border:0;padding:0 5px;overflow:hidden;}
.session-title .name{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--fg);}.session-title>.dim{font-size:10px;}
.terminal-context{display:flex;justify-content:space-between;gap:8px;height:22px;align-items:center;font-size:10px;color:var(--dim);overflow:hidden;}.terminal-context>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.terminal-context>span:first-child{max-width:45%;flex:none;}
.session-menu{padding:0;max-height:none;}.session-menu :global(button){min-height:46px;}.session-menu :global(.dim){width:100%;}

.feedback{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);}.feedback>span{flex:1;}.feedback>button{min-width:44px;height:44px;border:0;padding:0;font-size:20px;}.terminal-feedback{position:fixed;z-index:20;left:12px;right:12px;bottom:142px;border:1px solid var(--card-line);background:var(--panel);border-radius:10px;padding:5px 10px;box-shadow:0 8px 35px #0007;}
@media(max-height:520px){.terminal-feedback{bottom:75px;}}
.work-actions-list{display:flex;flex-direction:column;gap:8px}.work-actions-list button{min-height:44px}.terminal-location{width:100%;font-size:12px;line-height:1.65;color:var(--dim)}.legacy-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30dvh;overflow:auto}

.app-shell{display:grid;grid-template-columns:minmax(0,1fr);width:100%;height:100%;min-height:0;flex:1}.app-content{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.work-sidebar{padding:12px 12px 18px;background:var(--panel);border-right:1px solid var(--line);overflow:auto;min-height:0;overscroll-behavior:contain}.navigation-error{font-size:11px;line-height:1.6;color:var(--warn);padding:8px}.work-welcome{margin:auto;max-width:420px;padding:24px}.work-welcome p{font-size:14px;line-height:1.7;color:var(--dim)}.work-welcome button{margin-top:16px}.mobile-spaces{font-size:12px;border:0;flex:none;min-height:44px;padding:0 4px;gap:5px}.app-header{height:52px;padding:4px 12px;gap:8px}.app-header>button{width:auto;font-size:12px;color:var(--fg)}.app-header .app-brand{flex:1;font-size:14px}.terminal-heading{padding:0;gap:0}.session-pager{height:44px;flex:none}.session-title{padding:0 6px;justify-content:center}.session-title .name{font-size:13px}.session-title>.dim{font-size:10px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;max-width:100%}.terminal-context{display:flex;height:44px;flex:none;overflow:visible;gap:6px}.terminal-computer{font-size:11px;border:0;padding:0 3px;max-width:42%;min-height:44px;gap:5px;justify-content:flex-start}.terminal-computer>span:first-child{font-size:9px;color:var(--warn);flex:none}.terminal-computer>span.online{color:var(--ok)}.terminal-computer>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terminal-context .terminal-source{flex:1;min-width:0;max-width:none;font-size:10px;white-space:normal}.terminal-steps{display:flex;flex:none;gap:0}.connection-notice{display:flex;align-items:center;gap:8px;font-size:11px;background:var(--panel);padding:4px 8px;border:1px solid var(--warn);border-radius:8px;margin:3px 0}.connection-notice>span{flex:1}.connection-notice>button{font-size:11px;min-height:44px}.terminal-feedback{bottom:68px}.app-content :global(section.composing){padding:0 8px 4px;gap:2px}.app-content :global(.composing .composer){gap:0;margin-top:2px}.app-content :global(.composing .wrap){padding:4px 6px}
@media(min-width:960px){.app-shell{grid-template-columns:280px minmax(0,1fr)}.mobile-spaces{display:none}.app-header{padding-inline:20px}.terminal-heading{display:flex;flex-direction:row;align-items:center;gap:10px;height:72px}.session-pager{flex:1}.session-title .name{font-size:16px}.session-title>.dim{font-size:11px}.terminal-context{width:auto;flex:none;height:44px}.terminal-computer{display:none}.terminal-context .terminal-source{font-size:11px;flex:none}.app-content :global(section.composing){padding:0 12px 8px;gap:6px}.app-content :global(.composing .wrap){padding:8px 10px}}
</style>