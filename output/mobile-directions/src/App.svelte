<script>
  import { onMount, tick } from 'svelte';
  import WorkRows from './WorkRows.svelte';
  import PreviewArt from './PreviewArt.svelte';
  import SpacesWorkbench from '../../../web/src/lib/spaces/SpacesWorkbench.svelte';
  import SpacesToolbar from '../../../web/src/lib/spaces/SpacesToolbar.svelte';
  import SpaceBrowser from '../../../web/src/lib/spaces/SpaceBrowser.svelte';
  import { sampleOrganization } from './sample-organization.js';
  import { organizationDocument, restoreOrganization } from '../../../web/src/lib/spaces/organization-client.js';
  import { spacesFor, taskFor, taskSequence } from './spaces-model.js';
  import { directions, initialState, loadState, persist, namespace, searchItems, sequenceFor, outputFor, draftKey } from './model.js';

  let direction = location.pathname.split('/')[1];
  if (!directions[direction]) direction = '';
  let state = direction ? loadState(direction) : initialState();
  let sheets = [], message = '', focused = false, scroller, composer;
  let mounted = false, pendingAfterPop = null;
  let formName = '', formFolder = '', formCommand = '', formWorkspace = '1';
  let pairMode = 'link', pairAddress = '', pairCode = '', pairError = '', busy = false;
  let confirmReview = null, selectedPreview = 'preview-mobile', actualSize = false, captured = false;
  let organizationReady=false,organizationBusy=false,organizationErrors={},organizationRevisions={};
  let spaceName = '', taskName = 'Work', assignTab = '';
  $: workContext = direction === 'spaces' ? taskFor(state,item) : null;
  $: siblingTasks = workContext?.space.tabs || [];
  let touchStart = null, focusCounter = 0, notificationState = 'supported';
  $: computer = state.computers.find(c => c.id === state.computer) || state.computers[0];
  $: item = state.items.find(i => i.id === state.selected);
  $: sheet = sheets[sheets.length - 1];
  $: recoveryComputer = state.computers.find(c=>c.id===sheet?.data?.computer) || computer;
  $: attention = state.items.filter(i => !i.closed && i.status === 'needs' && state.computers.find(c => c.id === i.computer)?.health === 'online').sort((a,b) => state.computers.findIndex(c => c.id === a.computer) - state.computers.findIndex(c => c.id === b.computer) || a.name.localeCompare(b.name));
  $: computerPreviews = state.previews.filter(p => p.computer === computer.id);
  $: activeKey = draftKey(item);
  $: matches = searchItems(state, { allComputers: direction === 'explorer' && state.view === 'home' || state.view === 'computers' || direction === 'inbox' && state.view === 'library', source: state.view === 'native' ? 'Herdr' : state.source, native: state.view === 'native' && !state.query }).filter(i => !(direction === 'explorer' && state.view === 'sessions') || i.source !== 'Herdr');
  $: if (direction) persist(direction, { ...state, savedSheets: sheets.filter(s => !['pair','connect','review','revoke','disconnect','forget','remove-preview'].includes(s.type)) });
  $: if (direction && mounted && state && sheets) markHistory(true);
  $: if (sheet?.type === 'create') state.creationDraft = { name: formName, folder: formFolder, command: formCommand, workspace: formWorkspace };
  $: if (direction) document.title = `${directions[direction].name} · Deskpilot prototype`;

  const routeKeys = ['workQuery','workNeeds','workAcross','view', 'computer', 'selected', 'origin', 'sequence', 'sequenceGenerations', 'query', 'filter', 'source', 'nativeSpace', 'nativeTab', 'workspace'];
  function route() { return Object.fromEntries(routeKeys.map(k => [k, structuredClone(state[k])])); }
  function rememberScroll() { if (scroller) state.scrolls[`${state.view}:${state.computer}`] = scroller.scrollTop; }
  async function restoreScroll() { await tick(); if(sheet?.type==='work-drawer'){const panel=document.querySelector('.sheet-body');if(panel)panel.scrollTop=state.workDrawerScroll||0;} if (scroller) scroller.scrollTop = state.scrolls[`${state.view}:${state.computer}`] || 0; }
  function historyValue() { return { prototype: direction, route: route(), sheets }; }
  function markHistory(replace = false) { history[replace ? 'replaceState' : 'pushState'](historyValue(), '', `/${direction}`); }
  function go(view, changes = {}, replace = false) {
    rememberScroll();
    if (sheets.length) { pendingAfterPop = () => go(view, changes, replace); history.go(-sheets.length); return; }
    state.visits[state.computer] = route();
    focused = false; sheets = []; message = ''; state = { ...state, ...changes, view }; markHistory(replace); restoreScroll();
  }
  function home() { go('home', { query: '', filter: 'all', source: 'all' }); }
  function switchComputer(id) {
    if (id === state.computer) { closeSheet(); return; }
    state.visits[state.computer] = route();
    const saved = state.visits[id];
    const firstNative = state.items.find(i => i.computer === id && i.source === 'Herdr' && !i.closed);
    go(saved?.view || (direction === 'explorer' ? 'computer' : 'home'), { ...(saved || { selected: null, query: '', filter: 'all', source: 'all', nativeSpace: firstNative?.spaceId, nativeTab: firstNative?.tabId }), computer: id });
  }
  async function showSheet(type, data = {}) {
    const el = document.activeElement;
    if (el && el !== document.body && !el.id) el.id = `return-control-${++focusCounter}`;
    sheets = [...sheets, { type, data, focusId: el?.id }];
    pairError = ''; message = ''; markHistory();
    await tick(); if(type==='work-drawer'){const panel=document.querySelector('.sheet-body');if(panel)panel.scrollTop=state.workDrawerScroll||0;} (type==='work-drawer'?document.querySelector('.sheet-header button'):document.querySelector('.sheet [data-autofocus], .sheet input, .sheet button'))?.focus({preventScroll:true});
  }
  function closeSheet() { history.back(); }
  function back() {
    if (focused) { composer?.blur(); focused = false; return; }
    if (sheets.length) { closeSheet(); return; }
    if (state.view === 'terminal' || state.view === 'missing') {
      const origin = state.origin;
      if (origin) go(origin.view, origin, true); else home();
      return;
    }
    history.back();
  }
  async function openItem(target, customSequence = null) {
    if (target.closed) { message = 'This work has closed. It will not be recreated.'; return; }
    const host = state.computers.find(c => c.id === target.computer);
    if (host.health !== 'online') { showSheet('recovery', {computer:host.id}); return; }
    if (!target.connected) { showSheet('connect', { id: target.id, sequence: customSequence }); return; }
    const origin = state.view === 'terminal' ? state.origin : route();
    const sequence = customSequence || (direction === 'spaces' ? taskSequence(state,target) : sequenceFor(state, target));
    go('terminal', { computer: target.computer, selected: target.id, origin, sequence, sequenceGenerations: Object.fromEntries(sequence.map(id => [id, state.items.find(i => i.id === id)?.generation])) }, direction === 'spaces' && state.view === 'terminal');
    state.recent = [target.id, ...state.recent.filter(id => id !== target.id)].slice(0, 8);
  }
  async function connectItem(id) {
    busy = true;
    const hostId = state.computer, target = state.items.find(i => i.id === id), generation = target?.generation, sheetRef = sheet;
    await new Promise(r => setTimeout(r, 450)); busy = false;
    if (!target || target.closed || target.generation !== generation || state.computers.find(c=>c.id===target.computer)?.health !== 'online') { message = 'This source changed or closed. Refresh the list; no work was created.'; return; }
    target.connected = true; target.attachment = target.attachment || 'mobile-' + crypto.randomUUID(); state = state;
    if (sheet !== sheetRef || state.computer !== hostId) return;
    pendingAfterPop = () => { if(direction==='spaces'){openItem(target,sheetRef.data.sequence);return;} if (state.view === 'terminal') { state.sequence = direction === 'spaces' ? taskSequence(state,target) : sequenceFor(state,target); state.sequenceGenerations = Object.fromEntries(state.sequence.map(id => [id,state.items.find(i=>i.id===id)?.generation])); state.selected = target.id; state.computer = target.computer; markHistory(true); } else openItem(target, sheetRef.data.sequence); }; history.go(-sheets.length);
  }
  async function step(delta) {
    const id = state.sequence[state.sequence.indexOf(state.selected) + delta], target = state.items.find(i => i.id === id);
    if (!target || target.closed || state.sequenceGenerations?.[id] && target.generation !== state.sequenceGenerations[id]) { message = 'That neighbor has closed or changed. Your current terminal is unchanged.'; return; }
    const host = state.computers.find(c => c.id === target.computer);
    if (host.health !== 'online') { message = `${host.name} is ${host.health}. Your current terminal is unchanged.`; return; }
    if (target.computer !== state.computer) state.visits[state.computer] = route();
    target.connected = true; target.attachment = target.attachment || 'mobile-' + crypto.randomUUID(); state = { ...state, selected: id, computer: target.computer }; markHistory(true);
    if (focused) { await tick(); composer?.focus({ preventScroll: true }); }
  }
  function swipeEnd(e) {
    if (!touchStart) return;
    const end = e.changedTouches[0], dx = end.clientX - touchStart.x, dy = end.clientY - touchStart.y;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) state.view === 'terminal' ? step(dx < 0 ? 1 : -1) : state.workspace = Math.max(1, Math.min(4, state.workspace + (dx < 0 ? 1 : -1)));
    touchStart = null;
  }
  function append(id, text) { const target = state.items.find(i => i.id === id); if (!target) return; const key = draftKey(target); state.logs[key] = (state.logs[key] || '') + text; }
  async function sendPrompt() {
    if (!item || computer.health !== 'online') { message = 'Input was not sent. Your draft is preserved; recover the connection first.'; return; }
    const id = item.id, text = state.drafts[draftKey(item)] || '', hostId = item.computer, generation = item.generation;
    if (!text.trim()) return;
    append(id, `\n› ${text}\n[Simulated input accepted by ${hostId} / ${id}]\n`);
    state.drafts[draftKey(item)] = ''; item.status = 'working'; item.outputActive = true; state = state;
    setTimeout(() => { const target = state.items.find(i => i.id === id); if (!target?.closed && target?.generation === generation) append(id, '\nReceived. Continuing the task…\n'); }, 500);
    composer?.focus();
  }
  function inputKey(key) {
    if (computer.health !== 'online') { message = 'Key was not sent. Recover the connection first.'; return; }
    append(item.id, `\n[Simulated key: ${key}]\n`); message = `${key} sent to ${item.name}.`;
  }
  function createForm(kind, task = null) { const draft = state.creationDraft; formName = draft?.name || ''; formFolder = draft?.folder || '~/Projects/deskpilot'; formCommand = draft?.command || '$SHELL -l'; formWorkspace = computer.desktop ? draft?.workspace || String(state.workspace) : 'none'; showSheet('create', { kind, task }); }
  async function createWork() {
    if (!formName.trim()) { message = 'Give this work a name.'; return; }
    const kind = sheet.data.kind;
    if (kind !== 'Terminal' && !computer.management) { message = 'Native management is unavailable on this computer.'; return; }
    const creationSheet=sheet;
    const serial = Date.now().toString(36);
    if (kind === 'Space' || kind === 'Tab') {
      const spaceId = kind === 'Space' ? `space-${serial}` : state.nativeSpace, tabId = `tab-${serial}`;
      state.items = [...state.items, { id: `herdr-${serial}`, computer: computer.id, source: 'Herdr', name: 'Shell', cwd: formFolder, command: formCommand, workspace: 4, status: 'idle', connected: true, attachment: `mobile-${serial}`, generation: 1, space: kind === 'Space' ? formName : state.items.find(i => i.spaceId === spaceId)?.space || 'New space', spaceId, tab: kind === 'Space' ? 'New tab' : formName, tabId, pane: 1, native: `term-${serial}` }];
      state.nativeSpace = spaceId; state.nativeTab = tabId;
    } else {
      const native = kind === 'Split', exemplar = state.items.find(i => i.tabId === state.nativeTab && i.computer === computer.id);
      state.items = [...state.items, { ...(native ? exemplar : {}), id: `${native ? 'herdr' : 'tmux'}-${serial}`, computer: computer.id, source: native ? 'Herdr' : 'Terminal', name: formName, cwd: formFolder, command: formCommand, workspace: native ? 4 : formWorkspace === 'none' ? null : Number(formWorkspace), status: 'idle', connected: true, attachment: `mobile-${serial}`, generation: 1, ...(native ? { pane: Math.max(0, ...state.items.filter(i => i.tabId === state.nativeTab).map(i => i.pane)) + 1, native: `term-${serial}` } : {}) }];
    }
    const created=state.items.at(-1);
    if(sheet.data.task){
      const task=sheet.data.task;
      if(task.computer!==computer.id||!(state.workSpaces||[]).some(s=>s.id===task.spaceId&&s.tabs.some(t=>t.id===task.taskId))){message='The destination task changed. The new terminal remains Unassigned.';state.creationDraft=null;return;}
      const candidate=layoutCandidate();candidate.workAssignments={...candidate.workAssignments,[draftKey(created)]:task.taskId};
      state.creationDraft=null;if(await saveOrganization(candidate))openItem(created);else if(sheet===creationSheet&&state.computer===created.computer){closeSheet();message='Terminal created. Refresh organization to check its task.';}return;
    }
    state.creationDraft = null; closeSheet(); message = `${formName} created in the simulation.`;
  }
  function review(scope, id) {
    const targets = state.items.filter(i => !i.closed && i.computer === computer.id && (scope === 'space' ? i.spaceId === id : scope === 'tab' ? i.tabId === id : i.id === id));
    confirmReview = { scope, id, targets: targets.map(i => ({ id: i.id, generation: i.generation, name: i.name, cwd: i.cwd })), digest: targets.map(i => `${i.id}:${i.generation}`).join('|') };
    showSheet('review');
  }
  function commitReview() {
    const r = confirmReview, current = state.items.filter(i => !i.closed && i.computer === computer.id && (r.scope === 'space' ? i.spaceId === r.id : r.scope === 'tab' ? i.tabId === r.id : i.id === r.id));
    if (current.map(i => `${i.id}:${i.generation}`).join('|') !== r.digest) { message = 'Review is stale. Programs changed; nothing was stopped. Close this review and review again.'; return; }
    current.forEach(i => i.closed = true); state = state;
    go(state.view === 'terminal' ? 'missing' : state.view, {}, true); message = 'Reviewed programs stopped in the simulation.';
  }
  function simulate(health) { computer.health = health; state = state; message = `${computer.name}: ${health}. Drafts are preserved.`; }
  function setNative(spaceId, tabId) { state.nativeSpace = spaceId; state.nativeTab = tabId || state.items.find(i => i.spaceId === spaceId && !i.closed)?.tabId; state.query = ''; state.filter = 'all'; }
  function renameTarget() {
    const d = sheet.data;
    if (!formName.trim()) return;
    if (d.kind === 'computer') state.computers.find(c => c.id === d.id).name = formName;
    else if (d.kind === 'device') state.devices.find(i => i.id === d.id).name = formName;
    else state.items.filter(i => d.kind === 'space' ? i.spaceId === d.id : d.kind === 'tab' ? i.tabId === d.id : i.id === d.id).forEach(i => i[d.kind === 'space' ? 'space' : d.kind === 'tab' ? 'tab' : 'name'] = formName);
    state = state; closeSheet();
  }
  function startRename(kind, id, value) { formName = value; showSheet('rename', { kind, id }); }
  function reorderNative(kind, delta) {
    const field = kind === 'space' ? 'spaceId' : 'tabId', id = kind === 'space' ? state.nativeSpace : state.nativeTab;
    const groups = [...new Set(state.items.filter(i => i.computer === computer.id && i.source === 'Herdr' && (kind === 'space' || i.spaceId === state.nativeSpace)).map(i => i[field]))];
    const at = groups.indexOf(id), to = at + delta;
    if (to < 0 || to >= groups.length) { message = 'Already at this end of the native order.'; return; }
    [groups[at], groups[to]] = [groups[to], groups[at]];
    const changed = state.items.filter(i => groups.includes(i[field])).sort((a,b) => groups.indexOf(a[field]) - groups.indexOf(b[field]) || a.pane - b.pane);
    state.items = [...state.items.filter(i => !groups.includes(i[field])), ...changed]; message = 'Native order updated. Existing terminal swipe neighbors stay fixed during this visit.';
  }
  async function loadOrganizations() {
    organizationReady=false;
    await Promise.all(state.computers.map(async host=>{
      try {
        let document=await sampleOrganization(host.id).read();
        const cached=organizationDocument(state,host.id,0);
        if(document.revision===0&&cached.spaces.length){
          // Preserve the old browser-only trial before migrating its sample data.
          localStorage.setItem(namespace+'spaces-browser-backup:'+host.id,JSON.stringify(cached));
          try{document=await sampleOrganization(host.id).save(cached);}catch(e){if(e.status===409)document=await sampleOrganization(host.id).read();else throw e;}
        }
        state=restoreOrganization(state,host.id,document);organizationRevisions[host.id]=document.revision;organizationErrors[host.id]='';
      } catch(e){organizationErrors[host.id]=e.message;}
    }));
    organizationErrors={...organizationErrors};organizationReady=true;
  }
  async function saveOrganization(candidate) {
    const host=computer.id,invoker=sheet;
    if(organizationBusy||organizationRevisions[host]===undefined){message='Load this computer’s organization before saving.';return false;}
    organizationBusy=true;
    try {
      const document=await sampleOrganization(host).save(organizationDocument(candidate,host,organizationRevisions[host]));
      organizationRevisions[host]=document.revision;organizationErrors[host]='';state=restoreOrganization(state,host,document);
      return sheet===invoker&&state.computer===host;
    } catch(e){organizationErrors={...organizationErrors,[host]:e.message};message=e.message;return false;}
    finally{organizationBusy=false;}
  }
  function layoutCandidate(){return structuredClone(state);}
  function manageSpace(space) {
    if(space.native) {
      const first=space.tabs.flatMap(t=>t.items)[0];state.nativeSpace=first?.spaceId;state.nativeTab=first?.tabId;
      showSheet('native-manage');return;
    }
    spaceName=space.name;taskName='';showSheet('work-space',{id:space.id});
  }
  function newWorkSpace() {if(!organizationReady)return;spaceName='';taskName='Work';showSheet('new-work-space');}
  async function saveWorkSpace() {
    if(!spaceName.trim()||!taskName.trim())return;
    const id='local:'+crypto.randomUUID(),candidate=layoutCandidate();
    candidate.workSpaces=[...(candidate.workSpaces||[]),{id,computer:computer.id,name:spaceName.trim(),tabs:[{id:'task:'+crypto.randomUUID(),name:taskName.trim()}]}];
    if(await saveOrganization(candidate)){state.workExpanded={...state.workExpanded,[id]:true};state=state;closeSheet();}
  }
  function openTask(space,tab) {
    if(tab.items.length)return chooseTask(tab.items.find(i=>i.id===state.selected)||tab.items[0]);
    showSheet('empty-task',{spaceId:space.id,taskId:tab.id,name:tab.name,computer:computer.id});
  }
  function newTask() {
    const space=workContext?.space;
    if(!space||space.unassigned||space.available||space.hidden)return newWorkSpace();
    if(space.native){const first=space.tabs.flatMap(t=>t.items)[0];state.nativeSpace=first.spaceId;return createForm('Tab');}
    taskName='';showSheet('new-task',{spaceId:space.id,computer:computer.id});
  }
  async function saveTask() {
    const candidate=layoutCandidate(),space=(candidate.workSpaces||[]).find(s=>s.id===sheet.data.spaceId&&s.computer===sheet.data.computer);
    if(!space||!taskName.trim()){message='Choose a task name and an available space.';return;}
    const task={id:'task:'+crypto.randomUUID(),name:taskName.trim()};space.tabs=[...space.tabs,task];
    if(await saveOrganization(candidate)){sheets=[...sheets.slice(0,-1),{...sheet,type:'empty-task',data:{spaceId:space.id,taskId:task.id,name:task.name,computer:space.computer}}];markHistory(true);}
  }
  async function editSpace(id,change) {
    const candidate=layoutCandidate(),local=candidate.workSpaces.find(s=>s.id===id&&s.computer===computer.id);
    if(!local||organizationBusy)return;
    change(local,candidate);
    if(await saveOrganization(candidate)){message='Organization saved on this sample computer.';taskName='';}
  }
  async function removeSpace(local) {
    const candidate=layoutCandidate();candidate.workSpaces=candidate.workSpaces.filter(s=>s.id!==local.id);
    if(await saveOrganization(candidate)){
      const active=state.items.find(i=>i.id===state.selected&&i.computer===state.computer&&!i.closed);
      if(active&&state.view==='terminal'){state.sequence=taskSequence(state,active);state.sequenceGenerations=Object.fromEntries(state.sequence.map(id=>[id,state.items.find(i=>i.id===id)?.generation]));}
      closeSheet();
    }
  }
  async function addExisting(target) {
    const task=sheet.data;
    if(target.source==='Herdr'||target.closed||target.computer!==task.computer||!(state.workSpaces||[]).some(s=>s.id===task.spaceId&&s.computer===task.computer&&s.tabs.some(t=>t.id===task.taskId))){message='This work or task changed. Nothing was moved.';return;}
    const candidate=layoutCandidate();candidate.workAssignments={...candidate.workAssignments,[draftKey(target)]:task.taskId};
    if(await saveOrganization(candidate))openItem(state.items.find(i=>i.id===target.id));
  }
  function organizeWork() {assignTab=state.workAssignments?.[activeKey]||'';showSheet('organize-work',{id:item.id,generation:item.generation,computer:item.computer});}
  async function applyOrganization() {
    const target=state.items.find(i=>i.id===sheet.data.id&&i.computer===sheet.data.computer&&i.generation===sheet.data.generation&&!i.closed);
    const valid=!assignTab||(state.workSpaces||[]).some(s=>s.computer===target?.computer&&s.tabs.some(t=>t.id===assignTab));
    if(!target||target.source==='Herdr'||!valid){message='This work changed. Nothing was moved.';return;}
    const candidate=layoutCandidate();candidate.workAssignments={...candidate.workAssignments,[draftKey(target)]:assignTab};
    if(await saveOrganization(candidate)){
      if(state.view==='terminal'&&state.selected===target.id){state.sequence=taskSequence(state,target);state.sequenceGenerations=Object.fromEntries(state.sequence.map(id=>[id,state.items.find(i=>i.id===id)?.generation]));}
      state=state;closeSheet();
    }
  }
  async function chooseTask(target) {
    const keepFocus=focused;
    await openItem(target);
    if(keepFocus&&!sheets.length){await tick();composer?.focus({preventScroll:true});}
  }
  async function reset() { if(direction==='spaces'){try{await Promise.all(state.computers.map(async h=>{const client=sampleOrganization(h.id),document=await client.read();await client.save({...document,spaces:[],assignments:[]});}));}catch(e){message='Sample reset could not finish: '+e.message;return;}} try { localStorage.removeItem(namespace + direction); } catch {} state = initialState(); sheets = []; markHistory(true); message = 'This direction has fresh fixtures.';if(direction==='spaces')loadOrganizations(); }

  onMount(() => {
    if (!direction) return;
    if(direction==='spaces'&&!state.spaceTrialStarted){state.spaceTrialStarted=true;const target=state.items.find(i=>i.id===state.recent[0]&&!i.closed);if(target){state.origin={...route(),view:'home'};state.view='terminal';state.selected=target.id;state.sequence=taskSequence(state,target);state.sequenceGenerations=Object.fromEntries(state.sequence.map(id=>[id,state.items.find(i=>i.id===id)?.generation]));}}
    const saved = history.state?.prototype === direction ? history.state.route : route();
    state = { ...state, ...saved };
    if (state.view === 'terminal' && !state.items.some(i => i.id === state.selected && !i.closed)) state.view = 'missing';
    const retained = (history.state?.prototype === direction ? history.state.sheets : state.savedSheets || []).filter(s => !['pair','connect','review','revoke','disconnect','forget','remove-preview'].includes(s.type));
    // Reconstruct a safe parent for a fresh launch. Ephemeral confirmations are never restored.
    history.replaceState({ prototype: direction, route: state.origin || { ...route(), view: 'home' }, sheets: [] }, '', `/${direction}`);
    if (state.view !== 'home') history.pushState({ prototype: direction, route: route(), sheets: [] }, '', `/${direction}`);
    for (let n = 0; n < retained.length; n++) history.pushState({ prototype: direction, route: route(), sheets: retained.slice(0, n + 1) }, '', `/${direction}`);
    sheets = retained;
    if (sheets.at(-1)?.type === 'create') {
      const draft = state.creationDraft || {};
      formName = draft.name || ''; formFolder = draft.folder || '~/Projects/deskpilot'; formCommand = draft.command || '$SHELL -l'; formWorkspace = draft.workspace || '1';
    }
    const resize=()=>document.documentElement.style.setProperty('--preview-h',`${window.visualViewport?.height??innerHeight}px`);
    window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
    mounted = true; restoreScroll();if(direction==='spaces')loadOrganizations();
    const pop = async e => {
      if (e.state?.prototype !== direction) return;
      const previous = sheet, dismissing = sheets.length > (e.state.sheets || []).length && e.state.route.view === state.view;
      if (!dismissing) state = { ...state, ...e.state.route };
      sheets = e.state.sheets || []; focused = false; message = '';
      await restoreScroll();
      if (previous?.focusId) document.getElementById(previous.focusId)?.focus({ preventScroll: true });
      const action = pendingAfterPop; pendingAfterPop = null; action?.();
    };
    const preventHorizontalDefault = e => { if (!touchStart || !e.target.closest?.('.terminal-frame,.desktop-map')) return; const dx = e.touches[0].clientX-touchStart.x, dy = e.touches[0].clientY-touchStart.y; if (Math.abs(dx)>20 && Math.abs(dx)>Math.abs(dy)*1.6) e.preventDefault(); };
    document.addEventListener('touchmove',preventHorizontalDefault,{passive:false});
    const flush = () => { rememberScroll(); persist(direction, state); };
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); back(); } };
    window.addEventListener('popstate', pop); document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', flush); window.addEventListener('keydown', escape);
    return () => {window.visualViewport?.removeEventListener('resize',resize);window.removeEventListener('resize',resize); document.removeEventListener('touchmove',preventHorizontalDefault); window.removeEventListener('popstate', pop); document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); window.removeEventListener('keydown', escape); };
  });
</script>

{#if !direction}
  <main class="launcher">
    <div class="brand"><span class="brand-mark">d.</span> DESKPILOT <span class="eyebrow">/ MOBILE STUDIES</span></div>
    <div class="launch-intro"><span class="eyebrow">A SIMPLER WAY BACK TO WORK</span><h1>Less navigating.<br /><em>More continuing.</em></h1><p>Try organizing all your work into spaces and task tabs.<br />The previous layouts remain available for comparison.</p></div>
    <a class="selected-direction spaces-feature" href="/spaces"><span class="eyebrow">NEW TRIAL · HERDR-INSPIRED ORGANIZATION</span><h2>Your work. In its place.</h2><p>One terminal, spaces for your projects, and tabs for your tasks. Works with or without Herdr.</p><span class="selected-cta">Try Spaces <span>↗</span></span><small>Interactive sample data · Your running app is unchanged.</small></a>
    <a class="selected-direction" href="/combined"><span class="eyebrow">PREVIOUS VERSION · A + B</span><h2>Focus + Attention</h2><p>Resume your terminal. Search Sessions. Review requests across computers when you choose.</p><span class="selected-cta">Open the combined preview <span>↗</span></span><small>Simulated data · The real app implementation lives in web/.</small></a>
    <h2 class="earlier-title">Earlier comparisons</h2>
    <div class="direction-grid">
      {#each Object.entries(directions).filter(([key])=>key!=='combined'&&key!=='spaces') as [key, d]}
        <a class="direction-card" href={'/' + key}><span class="direction-top"><span class="study-letter">{d.letter}</span><span class="eyebrow">{key === 'explorer' ? 'SET ASIDE' : 'EARLIER VERSION'}</span></span><div class="mini-preview">{#if key === 'focus'}<span class="mini-line">STUDIO / deskpilot</span><div class="mini-terminal">› The changes are ready.<br /><br /><span>May I continue?</span><br />▍</div><div class="mini-input">Reply to this session <span>↑</span></div>{:else if key === 'inbox'}<span class="mini-line">REPORTED ATTENTION</span>{#each ['deskpilot · Studio', 'Frontend · Studio', 'release · Build server'] as text}<div class="mini-row"><span class="dot"></span>{text}<span>↗</span></div>{/each}{:else}<span class="mini-line">YOUR COMPUTERS</span>{#each ['Studio', 'Build server', 'Travel laptop'] as text, n}<div class="mini-row"><span class="computer-glyph">▣</span>{text}<span class:dim={n === 2}>{n === 2 ? 'Offline' : '→'}</span></div>{/each}{/if}</div><h2>{d.name}</h2><p>{d.description}</p><span class="card-cta">Try direction {d.letter} <span>↗</span></span></a>
      {/each}
    </div>
    <footer class="launch-footer"><span>LOCAL PROTOTYPE · ALL TRANSPORT & MANAGEMENT SIMULATED</span><span>The combined preview and earlier directions have separate saved state.</span></footer>
  </main>
{:else}
  <div class="app-shell" inert={sheets.length > 0} data-organization-ready={direction!=='spaces'||organizationReady} class:spaces-mode={direction==='spaces'} class:terminal-mode={state.view === 'terminal'} class:keyboard={focused} class:still={state.browserMotion}>
    {#if direction==='spaces' && (state.view==='terminal'&&item || ['home','sessions'].includes(state.view))}
      <SpacesWorkbench bind:state {computer} {item} simulated output={outputFor(item)+(state.logs[activeKey]||'')} bind:focused bind:composer bind:scroller bind:touchStart {showSheet} step={step} {chooseTask} {openTask} {newTask} {swipeEnd} {sendPrompt} {openItem} {newWorkSpace} {manageSpace} {rememberScroll}/>
    {:else if state.view === 'terminal' && item}
      <header class="terminal-header">
        <button class="icon-button" aria-label="Back to origin" onclick={back}>←</button>
        <button class="title-picker" aria-label="Choose session" onclick={() => { showSheet('sessions'); }}><strong>{item.name}</strong><span>{item.source} ⌄</span></button>
        <button class="icon-button" aria-label="Previous session" disabled={state.sequence.indexOf(item.id) <= 0} onpointerdown={e => e.preventDefault()} onclick={() => step(-1)}>‹</button>
        <button class="icon-button" aria-label="Next session" disabled={state.sequence.indexOf(item.id) >= state.sequence.length - 1} onpointerdown={e => e.preventDefault()} onclick={() => step(1)}>›</button>
        <button class="icon-button" aria-label="Session actions" onclick={() => showSheet('session-actions')}>⋯</button>
      </header>
      <div class="terminal-context"><span><i class:online={computer.health === 'online'}></i>{computer.name} · {computer.health}</span><span title={item.source === 'Herdr' ? `${item.space} / ${item.tab} / Pane ${item.pane}` : item.cwd}>{item.source === 'Herdr' ? `${item.space} / ${item.tab} / Pane ${item.pane}` : item.cwd}</span></div>
      {#if computer.health !== 'online'}<button class="connection-banner" onclick={() => showSheet('recovery')}>Stale output · {computer.health} · Recover connection →</button>{/if}
      <div class="terminal-frame" class:output-active={item.outputActive} ontouchstart={e => touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }} ontouchend={swipeEnd} role="region" aria-label="Simulated terminal output">
        <pre class="terminal-output" style:font-size={state.textSize + 'px'}>{outputFor(item)}{state.logs[activeKey] || ''}<span class="cursor">▍</span></pre>
        <span class="terminal-tag">{item.outputActive ? 'Output active · ' : ''}{item.status === 'needs' ? 'Reported request' : item.source === 'Codex' || item.status === 'unknown' ? 'Requests unknown' : 'No reported requests'} · {state.sequence.indexOf(item.id) + 1}/{state.sequence.length}</span>
      </div>
      <form class="composer" onsubmit={e => { e.preventDefault(); sendPrompt(); }}>
        <button type="button" class="icon-button tools-trigger" aria-label="Input tools" onpointerdown={e => e.preventDefault()} onclick={() => showSheet('tools')}>＋</button>
        <textarea bind:this={composer} aria-label="Reply to this session" placeholder="Reply to this session…" rows="1" value={state.drafts[activeKey] || ''} oninput={e => { state.drafts[activeKey] = e.currentTarget.value; }} onfocus={() => focused = true} onblur={() => focused = false}></textarea>
        <button class="send-button" aria-label="Send prompt" disabled={computer.health !== 'online'}>↑</button>
      </form>
    {:else}
      <header class="app-header"><div class="header-context">{#if state.view !== "home"}<button class="icon-button" aria-label="Back" onclick={back}>←</button>{/if}<a href="/" class="brand compact" aria-label="Compare directions"><span class="brand-mark">d.</span>{#if state.view === "home"}<span>deskpilot</span>{/if}</a></div><button class="computer-picker" onclick={() => showSheet('computer')}><i class:online={computer.health === 'online'}></i>{computer.name}<span>⌄</span></button></header>
      <main class="app-main" bind:this={scroller} onscroll={rememberScroll}>
        {#if state.view === 'home' && direction === 'focus'}
          <div class="page-intro"><span class="eyebrow">FOCUS DECK / DIRECTION A</span><h1>Pick up where<br />you left off.</h1><p>{attention.filter(i => i.computer === computer.id).length} reported requests on {computer.name}.</p></div>
          <button class="search-entry" onclick={() => go('sessions', { query: '', filter: 'all', source: 'all' })}>⌕ <span>Find a session, conversation, or pane</span><span>↗</span></button>
          <div class="section-title"><h2>Recent work</h2><button onclick={() => go('sessions', { query: '', filter: 'all', source: 'all' })}>See all {state.items.filter(i => i.computer === computer.id && !i.closed).length} →</button></div>
          <WorkRows items={state.recent.map(id => state.items.find(i => i.id === id)).filter(i => i && i.computer === computer.id && !i.closed)} computers={state.computers} open={openItem} />
          <div class="section-title"><h2>Reported attention</h2></div><WorkRows items={attention.filter(i => i.computer === computer.id)} open={openItem} />
          <p class="coverage">Codex does not report input requests. Unknown status is not an all-clear. <button onclick={() => showSheet('coverage')}>Coverage details</button></p>
        {:else if state.view === 'home' && direction === 'inbox' || state.view === 'attention' && direction === 'combined'}
          <div class="page-intro"><span class="eyebrow">{direction==='combined'?'REPORTED REQUESTS / ALL COMPUTERS':'ATTENTION INBOX / DIRECTION B'}</span><h1>A few things<br />need your eyes.</h1><p>{attention.length} reported requests across your computers.</p></div>
          <button class="primary full" disabled={!attention.length} onclick={() => openItem(attention[0], attention.map(i => i.id))}>Review across computers <span>→</span></button>
          <div class="section-title"><h2>Reported requests</h2><span>{attention.length}</span></div>
          <WorkRows items={attention} computers={state.computers} open={openItem} showComputer />
          <button class="coverage coverage-link" onclick={() => showSheet('coverage')}>△ Coverage gaps · Codex attention unknown; Travel laptop offline. <span>Details →</span></button>
          <div class="section-title"><h2>Recent work</h2><button onclick={() => go(direction==='combined'?'sessions':'library', { query: '', filter: 'all', source: 'all' })}>{direction==='combined'?'Sessions →':'Open Library →'}</button></div><WorkRows items={state.recent.map(id => state.items.find(i => i.id === id)).filter(i => i && !i.closed)} computers={state.computers} open={openItem} showComputer />
        {:else if state.view === 'home' && direction === 'explorer' || state.view === 'computers'}
          <div class="page-intro"><span class="eyebrow">{direction === 'explorer' ? 'COMPUTER EXPLORER / DIRECTION C' : 'PAIRED COMPUTERS'}</span><h1>Your computers.</h1><p>Find work by the place you left it.</p></div>
          <label class="search"><span>⌕</span><input aria-label="Search all computers" placeholder="Search work across computers" bind:value={state.query} /></label>
          {#if state.query}<WorkRows items={matches} computers={state.computers} open={openItem} showComputer />{:else}{#each state.computers as host}<button class="computer-card" onclick={() => { if (host.id === state.computer) go('computer'); else switchComputer(host.id); }}><span class="computer-symbol">▣</span><span><strong>{host.name}</strong><span class="muted">{host.health} · {host.desktop ? 'Desktop available' : 'Headless'}</span></span><span>→</span></button>{/each}{/if}
          <button class="secondary full" id="pair-from-computers" onclick={() => showSheet('pair')}>＋ Pair computer</button>
        {:else if state.view === 'computer'}
          <div class="page-intro"><span class="eyebrow">{computer.hostname} / {computer.health}</span><h1>{computer.name}.</h1><p>{computer.desktop ? 'Your desktop, sessions, and native work.' : 'A complete terminal workspace. No desktop required.'}</p></div>
          {#if computer.health !== 'online'}<button class="coverage coverage-link" onclick={() => showSheet('recovery')}>Stale inventory · {computer.health}. Recover connection →</button>{/if}
          {#each [['sessions','Sessions','Ordinary terminals and supported conversations','>_'],['native','Herdr','Spaces → tabs → terminal panes','⊞'],['desktop','Desktop',computer.desktop ? 'Screens, windows, and placement' : 'Unavailable on this headless computer','▣'],['previews','Previews','Explicitly published images, independent of sessions','▧'],['settings','Computer settings','Devices, pairing, notifications, and diagnostics','⚙']] as [view, title, description, icon]}<button class="destination" onclick={() => go(view, { query: '', filter: 'all', source: 'all' })}><span class="destination-icon">{icon}</span><span><strong>{title}</strong><span class="muted">{description}</span></span><span>→</span></button>{/each}
        {:else if ['sessions','library','native'].includes(state.view) || direction==='combined'&&state.view==='home'}
          <div class="page-heading"><div><span class="eyebrow">{state.view === 'library' ? 'ALL COMPUTERS' : computer.name}</span><h1>{state.view === 'native' ? 'Herdr' : state.view === 'library' ? 'Library' : 'Sessions'}</h1></div><button class="secondary" onclick={() => state.view === 'native' ? createForm('Space') : createForm('Terminal')}>＋ New</button></div>
          <label class="search"><span>⌕</span><input aria-label="Search work" placeholder={state.view === 'native' ? 'Search all native panes' : 'Name, folder, source, or native context'} bind:value={state.query} /></label>
          {#if direction==='combined'&&state.view!=='native'&&!state.query&&state.filter==='all'}<div class="section-title"><h2>Recent work</h2></div><WorkRows items={state.recent.map(id=>state.items.find(i=>i.id===id)).filter(i=>i&&!i.closed&&i.computer===computer.id)} open={openItem}/>{/if}
          <div class="filter-row"><button class:chosen={state.filter === 'all'} onclick={() => state.filter = 'all'}>All work</button><button class:chosen={state.filter === 'needs'} onclick={() => state.filter = 'needs'}>Needs you</button><button class:chosen={state.filter === 'working'} onclick={() => state.filter = 'working'}>Working</button></div>
          {#if state.view !== 'native'}<div class="filter-row sources"><button class:chosen={state.source === 'all'} onclick={() => state.source = 'all'}>All sources</button>{#each direction === 'explorer' && state.view === 'sessions' ? ['Terminal','Codex'] : ['Terminal','Codex','Herdr'] as source}<button class:chosen={state.source === source} onclick={() => state.source = source}>{source}</button>{/each}</div><button class="native-browser-link" onclick={() => go('native', { query: '', filter: 'all', source: 'all' })}>⊞ Browse Herdr spaces & tabs <span>→</span></button>{/if}
          {#if state.view === 'native'}
            <div class="native-breadcrumb">{computer.name} / {state.items.find(i => i.spaceId === state.nativeSpace)?.space || 'Spaces'} / {state.items.find(i => i.tabId === state.nativeTab)?.tab || 'Tabs'}</div>
            <label class="field">Space<select aria-label="Herdr space" value={state.nativeSpace} onchange={e => setNative(e.currentTarget.value)}>{#each [...new Set(state.items.filter(i => i.computer === computer.id && i.source === 'Herdr' && !i.closed).map(i => i.spaceId))] as id}<option value={id}>{state.items.find(i => i.spaceId === id)?.space}</option>{/each}</select></label>
            <div class="native-tabs">{#each [...new Set(state.items.filter(i => i.computer === computer.id && i.spaceId === state.nativeSpace && !i.closed).map(i => i.tabId))] as id}<button class:chosen={state.nativeTab === id} onclick={() => setNative(state.nativeSpace, id)}>{state.items.find(i => i.tabId === id)?.tab}</button>{/each}</div>
            <button class="secondary full" onclick={() => showSheet('native-manage')}>Manage this space & tab <span>⋯</span></button>
            {#if !computer.management}<p class="coverage">Herdr app management unavailable. Core terminal access still works.</p>{/if}
          {/if}
          <p class="list-caption">{matches.length} matching items · {state.view === 'native' ? 'Native pane order within a tab' : 'Desktop location, then name'}</p>
          <WorkRows items={state.view === 'native' ? [...matches].sort((a,b) => a.pane-b.pane) : matches} computers={state.computers} open={openItem} showComputer={state.view === 'library'} />
          <p class="coverage">No reported requests is not an all-clear. Codex cannot detect requests; unknown and offline items need checking. <button onclick={() => showSheet('coverage')}>Coverage details</button></p>
        {:else if state.view === 'desktop'}
          <div class="page-heading"><div><span class="eyebrow">{computer.name}</span><h1>Desktop</h1></div><button class="secondary" onclick={() => createForm('Terminal')}>＋ Session</button></div>
          {#if !computer.desktop}<div class="empty"><strong>No desktop on this computer</strong><p>Sessions, Previews, and Computer settings remain available.</p><button class="primary" onclick={() => go('sessions')}>Open Sessions</button></div>{:else}
            <div class="workspace-controls"><button class="icon-button" aria-label="Previous desktop" disabled={state.workspace === 1} onclick={() => state.workspace--}>‹</button>{#each [1,2,3,4] as ws}<button class:chosen={state.workspace === ws} onclick={() => { state.workspace = ws; captured = false; }}> {ws} </button>{/each}<button class="icon-button" aria-label="Next desktop" disabled={state.workspace === 4} onclick={() => state.workspace++}>›</button></div>
            <div class="desktop-map" ontouchstart={e => touchStart = {x:e.touches[0].clientX,y:e.touches[0].clientY}} ontouchend={swipeEnd} role="region" aria-label="Desktop workspace"><span class="eyebrow">SCREEN {state.workspace} · {computer.locked ? 'LOCKED' : 'UNLOCKED'} · SIMULATED</span><div class="window-diagram" class:tiled={state.tiled[computer.id + ":" + state.workspace]}><span>>_ {state.items.find(i => i.workspace === state.workspace)?.name || 'Browser'}</span><span>Editor<br /><small>Deskpilot source</small></span></div></div>
            <div class="button-row"><button class="secondary" onclick={() => { if (computer.locked || computer.health !== 'online') message = 'Capture refused: desktop is locked or connection unavailable.'; else { captured = true; message = 'Explicit simulated capture made.'; } }}>Capture screen</button><button class="secondary" onclick={() => { if (computer.health !== 'online') message = 'Desktop unavailable while disconnected.'; else { computer.locked = !computer.locked; state = state; } }}>{computer.locked ? 'Unlock' : 'Lock'} desktop</button><button class="secondary" onclick={() => { state.tiled[computer.id + ':' + state.workspace] = !state.tiled[computer.id + ':' + state.workspace]; message = 'Simulated window layout updated.'; }}>Tile windows</button></div>
            {#if captured}<button class="capture" aria-label="Enlarge screen capture" onclick={() => showSheet('capture')}><PreviewArt /><span>Enlarge simulated capture ↗</span></button>{/if}
            <div class="section-title"><h2>Windows on screen {state.workspace}</h2></div>
            {#each state.items.filter(i => !i.closed && i.computer === computer.id && i.workspace === state.workspace && i.source !== 'Herdr') as window}<div class="window-row"><strong>{window.name}</strong><span class="muted">{window.source} · {window.id}</span><div class="button-row"><button class="secondary" onclick={() => openItem(window)}>{window.connected ? 'Open terminal' : 'Connect conversation'}</button><button class="secondary" onclick={() => { formWorkspace = String(window.workspace); showSheet('placement', { id: window.id }); }}>Move window</button><button class="secondary" onclick={() => { if (computer.locked) message = 'Capture refused while locked.'; else showSheet('capture'); }}>Capture window</button></div></div>{:else}<p class="muted">No associated terminal window. Browser and editor remain desktop-only.</p>{/each}
            {#if state.workspace === 4}<button class="destination" onclick={() => go('native')}><span>⊞</span><span><strong>Herdr app</strong><span class="muted">Native panes share one app window.</span></span><span>→</span></button>{/if}
          {/if}
        {:else if state.view === 'previews'}
          <div class="page-heading"><div><span class="eyebrow">{computer.name} / INDEPENDENT ARTIFACTS</span><h1>Previews</h1></div><button class="secondary" onclick={() => message = `Preview history refreshed at ${new Date().toLocaleTimeString()}.`}>Refresh</button></div>
          <p class="muted">Published images stay available independently of terminals. Matching task names do not establish ownership.</p>
          {#if computerPreviews.length}{@const preview = computerPreviews.find(p => p.id === selectedPreview) || computerPreviews[0]}<button class="preview-image" aria-label="Enlarge published preview" onclick={() => { selectedPreview = preview.id; showSheet('preview'); }}><PreviewArt kind={preview.kind} /></button><h2>{preview.name}</h2><p>{preview.caption}</p><p class="eyebrow">{preview.dimensions} · TODAY {preview.time} · PNG · SIMULATED</p><div class="button-row"><button class="secondary" onclick={() => showSheet('publish')}>Publish an image</button><button class="secondary danger-text" onclick={() => showSheet('remove-preview', { id: preview.id })}>Remove preview</button></div><div class="section-title"><h2>Published history</h2></div>{#each computerPreviews as p}<button class="destination" onclick={() => selectedPreview = p.id}><span>▧</span><span><strong>{p.name}</strong><span class="muted">Today {p.time} · {p.dimensions}</span></span><span>{selectedPreview === p.id ? '✓' : '→'}</span></button>{/each}{:else}<div class="empty"><h2>No published images</h2><button class="primary" onclick={() => showSheet('publish')}>Publish an image</button></div>{/if}
        {:else if state.view === 'settings'}
          <div class="page-intro"><span class="eyebrow">{computer.name} / COMPUTER SCOPE</span><h1>Computer settings</h1><p>Access and preferences for {computer.hostname}.</p></div>
          {#each [['machines','Machines & pairing','Local labels, pair, and forget'],['devices','Authorized devices','Rename or revoke a device credential'],['notifications','Notifications','Permission, registration, and test push'],['usage','Usage','Allowances and collector status'],['diagnostics','Connection diagnostics','Health, capabilities, and recovery'],['browser','Browser preferences','Installation, motion, and text size']] as [type,title,description]}<button class="destination" id={'settings-'+type} onclick={() => showSheet(type)}><span><strong>{title}</strong><span class="muted">{description}</span></span><span>→</span></button>{/each}
        {:else if state.view === 'missing'}<div class="empty"><h1>This work has closed.</h1><p>Your drafts remain saved for its original identity. Nothing was recreated or sent.</p><button class="primary" onclick={back}>Return to origin</button></div>{/if}
      </main>
    {/if}
    {#if direction==='spaces'&&(!organizationReady||organizationErrors[computer.id])}<div class="organization-status" role="status">{!organizationReady?'Loading organization…':organizationErrors[computer.id]}{#if organizationReady}<button onclick={loadOrganizations}>Refresh organization</button>{/if}</div>{/if}
    {#if message}<div class="toast" role="status"><span>{message}</span><button class="icon-button" aria-label="Dismiss message" onclick={() => message = ''}>×</button></div>{/if}
    {#if direction==='spaces'}<SpacesToolbar keyboard={focused} terminal={state.view==='terminal'} needs={attention.length} openSpaces={()=>showSheet('work-drawer')} openAttention={()=>{state.workQuery='';state.workNeeds=true;state.workAcross=true;showSheet('work-drawer');}} openComputer={()=>showSheet('computer')}/>{:else if direction==='combined'}<nav class="bottom-dock" aria-label="Main navigation"><button aria-label="Sessions" class:active={['home','sessions','native'].includes(state.view)} onclick={()=>go('sessions',{query:'',filter:'all',source:'all'})}><span>☷</span>Sessions</button><button aria-label="Attention" class:active={state.view==='attention'||state.origin?.view==='attention'&&state.view==='terminal'} onclick={()=>go('attention')}><span>◉</span>Attention <small>{attention.length}</small></button><button aria-label="Computer" onclick={()=>showSheet('computer')}><span>▣</span>Computer</button></nav>{:else}
    <nav class="bottom-dock" aria-label="Main navigation">
      <button class:active={state.view === 'home'} onclick={home}><span>{direction === 'inbox' ? '◉' : direction === 'explorer' ? '▣' : '⌂'}</span>{direction === 'inbox' ? 'Attention' : direction === 'explorer' ? 'Computers' : 'Home'}</button>
      <button class:active={['sessions','library','native'].includes(state.view)} onclick={() => go(direction === 'inbox' ? 'library' : 'sessions', { query: '', filter: 'all', source: 'all' })}><span>☷</span>{direction === 'inbox' ? 'Library' : 'Sessions'}</button>
      <button class:active={['desktop','previews','settings','computer','computers'].includes(state.view)} onclick={() => direction === 'inbox' ? go('computers', { query: '' }) : showSheet('computer')}><span>▣</span>{direction === 'inbox' ? 'Computers' : 'Computer'}</button>
    </nav>
    {/if}
    <div class="prototype-strip"><a href="/">{directions[direction].letter} · Compare</a><span>SIMULATED</span><button onclick={() => showSheet('lab')}>Test states</button></div>
  </div>
  {#if sheet}
    <div class="sheet-backdrop" class:work-drawer={sheet.type==='work-drawer'} role="presentation" onclick={e => { if (e.target === e.currentTarget) closeSheet(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={sheet.type.replaceAll('-', ' ')} tabindex="-1" onkeydown={e => { if (e.key !== 'Tab') return; const controls = [...e.currentTarget.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')]; if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus(); } }}>
        <div class="sheet-handle"></div><header class="sheet-header"><span class="eyebrow">{computer.name} · SIMULATED</span><button class="icon-button" aria-label="Close panel" onclick={closeSheet}>×</button></header>
        <div class="sheet-body" onscroll={e=>{if(sheet.type==='work-drawer')state.workDrawerScroll=e.currentTarget.scrollTop;}}>
          {#if sheet.type === 'work-drawer'}
            <SpaceBrowser bind:state open={openItem} create={newWorkSpace} manage={manageSpace} {openTask} computer={()=>showSheet('computer')} coverage={()=>showSheet('coverage')} drawer/>
            <button class="destination" onclick={()=>createForm('Terminal')}>＋ New terminal <span>→</span></button>
          {:else if sheet.type === 'new-work-space'}
            <h1>New space</h1><p>A space organizes work on {computer.name}. You can move existing terminals into it without restarting them.</p><form onsubmit={e=>{e.preventDefault();saveWorkSpace();}}><label class="field">Space name<input aria-label="Space name" required bind:value={spaceName} placeholder="Project or group" maxlength="100"/></label><label class="field">First task name<input aria-label="First task name" required bind:value={taskName} maxlength="100"/></label><button class="primary full" disabled={organizationBusy||!organizationReady}>Create space</button></form>
          {:else if sheet.type === 'new-task'}
            <h1>New task</h1><form onsubmit={e=>{e.preventDefault();saveTask();}}><label class="field">Task name<input aria-label="Task name" required bind:value={taskName} maxlength="100"/></label><button class="primary full" disabled={organizationBusy||!organizationReady}>Create task</button></form>
          {:else if sheet.type === 'empty-task'}
            <h1>{sheet.data.name}</h1><p>No terminals in this task yet.</p><button class="primary full" onclick={()=>createForm('Terminal',sheet.data)}>Start terminal</button><button class="secondary full" onclick={()=>showSheet('task-add-work',sheet.data)}>Add existing work</button>
          {:else if sheet.type === 'task-add-work'}
            <h1>Add existing work</h1><p>Move a terminal or conversation into {sheet.data.name}. Its draft stays with it.</p><WorkRows items={state.items.filter(i=>!i.closed&&i.computer===sheet.data.computer&&i.source!=='Herdr')} open={addExisting}/>
          {:else if sheet.type === 'work-space'}
            {@const local=(state.workSpaces||[]).find(s=>s.id===sheet.data.id&&s.computer===computer.id)}
            {#if local}<h1>Manage {local.name}</h1><p>Organization only. Your running terminals keep their original identities.</p><form onsubmit={e=>{e.preventDefault();if(spaceName.trim())editSpace(local.id,s=>s.name=spaceName.trim());}}><label class="field">Space name<input aria-label="Space name" required bind:value={spaceName} maxlength="100"/></label><button class="secondary full" disabled={organizationBusy||!organizationReady}>Save space name</button></form>
            <h2>Task tabs</h2>{#each local.tabs as tab,index (tab.id)}<div class="task-editor"><label class="field">Task {index+1}<input aria-label={`Task name: ${tab.name}`} value={tab.name} maxlength="100" onchange={e=>{if(e.currentTarget.value.trim()){const name=e.currentTarget.value.trim();editSpace(local.id,s=>s.tabs.find(t=>t.id===tab.id).name=name);}}}/></label><button aria-label={`Move task earlier: ${tab.name}`} disabled={index===0} onclick={()=>{editSpace(local.id,s=>{[s.tabs[index-1],s.tabs[index]]=[s.tabs[index],s.tabs[index-1]];});}}>↑</button></div>{/each}
            <form onsubmit={e=>{e.preventDefault();if(taskName.trim()){const name=taskName.trim();editSpace(local.id,s=>s.tabs=[...s.tabs,{id:'task:'+crypto.randomUUID(),name}]);}}}><label class="field">New task name<input aria-label="New task name" bind:value={taskName} placeholder="Another task" maxlength="100" required/></label><button class="secondary full" disabled={organizationBusy||!organizationReady}>Add task</button></form><p>Removing this space returns its work to Unassigned. No terminal is stopped.</p><button class="secondary full" disabled={organizationBusy} onclick={()=>removeSpace(local)}>Remove organization</button>{:else}<p>This space is no longer available.</p>{/if}
          {:else if sheet.type === 'organize-work'}
            <h1>Move to task</h1><p>{item?.name} · {computer.name}</p>{#if item?.source==='Herdr'}<p>This terminal follows its existing Herdr space and tab. Manage its native organization from the space menu.</p>{:else}<form onsubmit={e=>{e.preventDefault();applyOrganization();}}><label class="field">Space / task<select aria-label="Destination task" bind:value={assignTab}><option value="">Unassigned</option>{#each (state.workSpaces||[]).filter(s=>s.computer===computer.id) as space}<optgroup label={space.name}>{#each space.tabs as tab}<option value={tab.id}>{space.name} / {tab.name}</option>{/each}</optgroup>{/each}</select></label><button class="primary full" disabled={organizationBusy||!organizationReady}>Move work</button></form><button class="secondary full" onclick={newWorkSpace}>＋ New space</button><p>Changes grouping only. Drafts stay with their exact recipient.</p>{/if}
          {:else if sheet.type === 'computer'}
            <h1>Computer</h1><p class="muted">Switching restores that computer’s previous view.</p>
            {#each state.computers as host}<button class="destination" onclick={() => switchComputer(host.id)}><span class="computer-symbol">▣</span><span><strong>{host.name}</strong><span class="muted">{host.health} · {host.desktop ? 'Desktop' : 'Headless'}</span></span><span>{host.id === computer.id ? '✓' : '→'}</span></button>{/each}
            <div class="sheet-links">{#each [['desktop','Desktop'],['previews','Previews'],['settings','Computer settings']] as [view,label]}<button class="destination" onclick={() => go(view)}><strong>{label}</strong><span>→</span></button>{/each}<button class="destination" id="pair-from-computer" onclick={() => showSheet('pair')}><strong>＋ Pair computer</strong><span>→</span></button></div>
          {:else if sheet.type === 'sessions'}
            <h1>Switch session</h1><label class="search"><span>⌕</span><input data-autofocus aria-label="Search sessions" placeholder="Name, source, space, or tab" bind:value={state.switchQuery} /></label><WorkRows items={searchItems({ ...state, query: state.switchQuery, filter: "all", source: "all" })} open={target => { if (!target.connected) { showSheet('connect', { id: target.id }); return; } state.sequence = direction === 'spaces' ? taskSequence(state,target) : sequenceFor(state,target); state.sequenceGenerations = Object.fromEntries(state.sequence.map(id => [id,state.items.find(i=>i.id===id)?.generation])); state.selected = target.id; markHistory(true); closeSheet(); }} /><button class="secondary full" onclick={() => go('native', { query: '' })}>Browse Herdr hierarchy →</button>
          {:else if sheet.type === 'connect'}
            {@const target = state.items.find(i => i.id === sheet.data.id)}<h1>Connect {target?.source}</h1><h2>{target?.name}</h2><p class="muted">{target?.cwd}</p><code>{target?.id} · generation {target?.generation}</code><p>This attaches a mobile view to the exact running source. Its original program continues when you leave.</p><button class="primary full" disabled={busy} onclick={() => connectItem(target.id)}>{busy ? 'Connecting…' : 'Connect mobile view'}</button><button class="secondary full" onclick={closeSheet}>Cancel connection</button>
          {:else if sheet.type === 'session-actions'}
            <h1>Session actions</h1><p class="muted">{item?.name} · {item?.id} · generation {item?.generation}</p><details class="identity-details"><summary>Source & attachment identity</summary><dl><dt>Computer</dt><dd>{computer.name} · {computer.id}</dd><dt>Source</dt><dd>{item?.core || item?.source} / {item?.native || item?.id}</dd><dt>Generation</dt><dd>{item?.generation}</dd><dt>Mobile attachment</dt><dd>{item?.attachment || 'No adapter attachment'}</dd></dl></details>
            {#if direction==='spaces'}<button class="destination" onclick={organizeWork}>Move to task <span>→</span></button>{#if workContext?.space.native}<button class="destination" onclick={()=>manageSpace(workContext.space)}>Manage native space <span>→</span></button>{/if}{/if}
            <button class="destination" onclick={() => showSheet('computer')}>Computer tools <span>→</span></button><button class="destination" onclick={() => startRename('item', item.id, item.name)}>Rename {item.source === 'Terminal' ? 'session' : 'mobile label'} <span>→</span></button><button class="destination" onclick={() => { formWorkspace = String(item.workspace || state.workspace); showSheet('placement', { id: item.id }); }}>Desktop placement <span>→</span></button><button class="destination" onclick={() => go('desktop', { workspace: item.workspace || 1 })}>Open contextual Desktop <span>→</span></button><button class="destination" onclick={() => go('previews')}>Published previews <span>→</span></button><button class="destination" onclick={() => showSheet('recovery')}>Connection recovery <span>→</span></button>
            {#if item.source !== 'Terminal'}<button class="destination" onclick={() => showSheet('disconnect')}>Disconnect mobile view <span>→</span></button>{/if}{#if item.source !== 'Codex'}<button class="destination danger-text" disabled={item.source === 'Herdr' && !computer.management} onclick={() => review('terminal', item.id)}>{item.source === 'Herdr' ? 'Stop Herdr terminal' : 'End session'} <span>→</span></button>{/if}
          {:else if sheet.type === 'disconnect'}
            <h1>Disconnect mobile view?</h1><p>The adapter attachment closes. The original {item.source} work keeps running. Leaving the page also preserves work.</p><button class="primary full" onclick={() => { item.connected = false; item.attachment = null; state = state; go(state.origin?.view || 'sessions', { ...(state.origin || {}) }); }}>Disconnect mobile view</button>
          {:else if sheet.type === 'tools'}
            <h1>Input tools</h1><p class="muted">Recipient: {item.name} · {item.id}</p><div class="key-grid">{#each ['Enter','Escape','Tab','Ctrl+C','Ctrl+D','Ctrl+A','↑','↓','←','→'] as key}<button class="secondary" onclick={() => inputKey(key)}>{key}</button>{/each}</div><button class="destination" onclick={() => showSheet('paste')}>Paste without Enter <span>→</span></button><button class="destination" onclick={() => showSheet('copy')}>Select & copy output <span>→</span></button><button class="destination" onclick={() => showSheet('history')}>Input history <span>→</span></button><label class="field">Terminal text size<select aria-label="Terminal text size" bind:value={state.textSize}><option value={12}>Compact · 12px</option><option value={13}>Default · 13px</option><option value={16}>Readable · 16px</option><option value={19}>Large · 19px</option></select></label>
          {:else if sheet.type === 'paste'}
            <h1>Paste without Enter</h1><p>Text is typed into {item.name}. It will not be submitted. This draft is separate from your prompt.</p><textarea class="large-input" aria-label="Paste draft" value={state.pasteDrafts[activeKey] || ''} oninput={e => state.pasteDrafts[activeKey] = e.currentTarget.value}></textarea><button class="primary full" onclick={() => { if (computer.health !== 'online') { message = 'Paste was not sent. Your paste draft is preserved.'; return; } append(item.id, '\n[Typed without Enter] ' + (state.pasteDrafts[activeKey] || '')); state.pasteDrafts[activeKey] = ''; message = 'Text typed without Enter (simulated).'; }}>Type text without Enter</button>
          {:else if sheet.type === 'copy'}
            <h1>Select & copy output</h1><textarea class="large-input copy-output" aria-label="Selectable terminal output" readonly value={outputFor(item) + (state.logs[activeKey] || '')}></textarea><button class="secondary full" onclick={() => { document.querySelector('.copy-output')?.select(); message = 'Output selected. Use your browser’s Copy action.'; }}>Select all output</button><button class="primary full" onclick={async () => { try { await navigator.clipboard.writeText(outputFor(item) + (state.logs[activeKey] || '')); message = 'Output copied.'; } catch { message = 'Clipboard unavailable. Select output and use browser Copy.'; } }}>Copy output</button>
          {:else if sheet.type === 'history'}<h1>Input history</h1><pre class="history-output">{state.logs[activeKey] || 'No input sent in this prototype yet.'}</pre>
          {:else if sheet.type === 'create'}
            <h1>Create {sheet.data.kind.toLowerCase()}</h1><form onsubmit={e => { e.preventDefault(); createWork(); }}><label class="field">Name<input required bind:value={formName} placeholder="A recognizable name" /></label><label class="field">Working directory<input bind:value={formFolder} /></label><label class="field">Command<input bind:value={formCommand} /></label><label class="field">Preset<select aria-label="Command preset" onchange={e => formCommand = e.currentTarget.value}><option value="$SHELL -l">Login shell</option><option value="codex --no-alt-screen">Codex</option><option value="codex resume --no-alt-screen">Continue Codex</option></select></label>{#if sheet.data.kind === 'Terminal'}<label class="field">Desktop placement<select bind:value={formWorkspace}><option value="none">Detached</option>{#if computer.desktop}{#each [1,2,3,4] as ws}<option value={String(ws)}>Desktop {ws}</option>{/each}{/if}</select></label>{/if}<button class="primary full" disabled={sheet.data.kind !== 'Terminal' && !computer.management}>Create {sheet.data.kind.toLowerCase()}</button></form>
          {:else if sheet.type === 'rename'}
            <h1>Rename {sheet.data.kind}</h1><form onsubmit={e => { e.preventDefault(); renameTarget(); }}><label class="field">Display name<input required bind:value={formName} /></label><p class="muted">Names do not change source identity or attachment ownership.</p><button class="primary full">Save name</button></form>
          {:else if sheet.type === 'placement'}
            <h1>Desktop placement</h1><p class="muted">{state.items.find(i => i.id === sheet.data.id)?.name}</p>{#if computer.desktop}<label class="field">Destination<select aria-label="Desktop destination" bind:value={formWorkspace}>{#each [1,2,3,4] as ws}<option value={String(ws)}>Desktop {ws}</option>{/each}<option value="none">Detach from desktop</option></select></label><button class="primary full" onclick={() => { const target = state.items.find(i => i.id === sheet.data.id); target.workspace = formWorkspace === 'none' ? null : Number(formWorkspace); state = state; closeSheet(); }}>Apply placement</button>{:else}<p>Desktop placement is unavailable on this headless computer.</p>{/if}
          {:else if sheet.type === 'native-manage'}
            {@const exemplar = state.items.find(i => i.tabId === state.nativeTab && i.computer === computer.id)}<h1>Native management</h1><p class="native-breadcrumb">{computer.name} / {exemplar?.space} / {exemplar?.tab}</p><p class="muted">Cross-space tab transfer is unavailable in Herdr.</p>{#if !computer.management}<p class="coverage">Herdr app unavailable. You can still connect to the core’s terminals.</p>{/if}
            <fieldset disabled={!computer.management}><legend>Space · {exemplar?.space}</legend><div class="button-row"><button class="secondary" onclick={() => createForm('Space')}>Create space</button><button class="secondary" onclick={() => startRename('space', state.nativeSpace, exemplar?.space)}>Rename space</button><button class="secondary" onclick={() => reorderNative('space', -1)}>Move space earlier</button><button class="secondary" onclick={() => reorderNative('space', 1)}>Move space later</button><button class="secondary danger-text" onclick={() => review('space',state.nativeSpace)}>Review close space</button></div></fieldset><fieldset disabled={!computer.management}><legend>Tab · {exemplar?.tab}</legend><div class="button-row"><button class="secondary" onclick={() => createForm('Tab')}>Create tab</button><button class="secondary" onclick={() => startRename('tab',state.nativeTab,exemplar?.tab)}>Rename tab</button><button class="secondary" onclick={() => reorderNative('tab', -1)}>Move tab earlier</button><button class="secondary" onclick={() => reorderNative('tab', 1)}>Move tab later</button><button class="secondary" onclick={() => createForm('Split')}>Split terminal</button><button class="secondary danger-text" onclick={() => review('tab',state.nativeTab)}>Review close tab</button></div></fieldset>
          {:else if sheet.type === 'review'}
            <h1>{confirmReview?.scope === 'terminal' ? 'Stop this program?' : `Close this ${confirmReview?.scope}?`}</h1><p>This stops the original running work. Review the exact affected programs:</p>{#each confirmReview?.targets || [] as target}<div class="review-item"><strong>{target.name}</strong><span class="muted">{target.cwd}</span><code>{target.id} · generation {target.generation}</code></div>{/each}<button class="primary danger full" onclick={commitReview}>Stop reviewed programs</button><button class="secondary full" onclick={() => { const target = state.items.find(i => i.id === confirmReview.targets[0]?.id); if (target) target.generation++; state = state; message = 'Simulated a source generation change. This review is now stale.'; }}>Simulate changed subtree</button><button class="secondary full" onclick={closeSheet}>Keep running</button>
          {:else if sheet.type === 'pair'}
            <h1>Pair computer</h1><p class="muted">Simulated pairing only. Use example values; no camera, keys, or network services are accessed.</p><div class="filter-row">{#each ['link','code','camera'] as mode}<button class:chosen={pairMode === mode} onclick={() => { pairMode = mode; pairError = ''; }}>{mode === 'link' ? 'Pairing link' : mode === 'code' ? 'Address + code' : 'QR camera'}</button>{/each}</div>
            {#if pairMode === 'camera'}<div class="camera-simulation"><span>⌗</span><p>SIMULATED CAMERA · No camera permission requested</p><button class="secondary" onclick={() => { pairAddress = 'https://example.invalid/pair#demo'; pairMode = 'link'; }}>Simulate QR scan</button></div>{:else}<label class="field">{pairMode === 'link' ? 'Example pairing link' : 'Example computer address'}<input aria-label="Pairing address" placeholder="https://example.invalid/pair#demo" bind:value={pairAddress} /></label>{#if pairMode !== 'link'}<label class="field">Example one-time code<input aria-label="Pairing code" bind:value={pairCode} /></label>{/if}{/if}<p class="error" role="status">{pairError}</p><button class="primary full" onclick={() => { if (!pairAddress) { pairError = 'Enter an example link or simulate a QR scan.'; return; } if (sheet.data.recoveryComputer) { const host = state.computers.find(c => c.id === sheet.data.recoveryComputer); host.health = 'online'; state = state; closeSheet(); return; } if (pairMode === 'code' && !pairCode) { pairError = 'Enter an example one-time code.'; return; } const id = 'paired-demo'; if (state.computers.some(c => c.id === id)) { pairError = 'This example computer is already paired. Your existing view is unchanged.'; return; } state.computers = [...state.computers, { id, name: 'New computer', hostname: 'demo-linux', health: 'online', desktop: false, management: false }]; closeSheet(); }}>Pair example computer</button><button class="secondary full" onclick={() => pairError = 'Example pairing code expired. Generate a new code on the computer and try again.'}>Simulate expired code</button><button class="secondary full" onclick={closeSheet}>Cancel pairing</button>
          {:else if sheet.type === 'machines'}
            <h1>Machines & pairing</h1><p class="muted">Labels are local to this browser. Credentials are simulated.</p>{#each state.computers as host}<button class="destination" onclick={() => startRename('computer',host.id,host.name)}><strong>{host.name}</strong><span>Rename →</span></button>{/each}<button class="primary full" id="pair-from-machines" onclick={() => showSheet('pair')}>Pair computer</button><button class="secondary full" onclick={() => { computer.name = computer.hostname; state = state; }}>Reset selected computer label</button><button class="secondary full danger-text" onclick={() => showSheet('forget')}>Forget selected computer locally</button>
          {:else if sheet.type === 'forget'}<h1>Forget {computer.name}?</h1><p>Removes the local example entry. Original work continues.</p><button class="primary danger full" disabled={state.computers.length < 2} onclick={() => { const id = computer.id; state.computers = state.computers.filter(c => c.id !== id); go('home', { computer: state.computers[0].id, selected: null }); }}>Forget local computer</button>
          {:else if sheet.type === 'devices'}
            <h1>Authorized devices</h1><p class="muted">Computer scope · {computer.name}. Last seen reflects simulated activity.</p>{#each state.devices.filter(d => d.computer === computer.id) as device}<div class="window-row"><strong>{device.name}</strong><p class="muted">Last seen {device.seen}</p><div class="button-row"><button class="secondary" onclick={() => startRename('device',device.id,device.name)}>Rename device</button><button class="secondary danger-text" onclick={() => showSheet('revoke', { id: device.id })}>Revoke device</button></div></div>{/each}<button class="secondary full" onclick={() => showSheet('pair')}>Re-pair this browser</button>
          {:else if sheet.type === 'revoke'}<h1>Revoke device?</h1><p>This example device loses access. Revoking this browser preserves its unsent drafts.</p><button class="primary danger full" onclick={() => { state.devices = state.devices.filter(d => d.id !== sheet.data.id); if (sheet.data.id.startsWith('phone')) computer.health = 'unauthorized'; state = state; closeSheet(); }}>Revoke credential</button>
          {:else if sheet.type === 'notifications'}
            <h1>Notifications</h1><p class="muted">Computer scope · {computer.name}. Push delivery is simulated.</p><label class="field">Browser permission<select aria-label="Notification permission" bind:value={notificationState}><option value="supported">Supported</option><option value="denied">Permission denied</option><option value="unsupported">Unsupported</option></select></label><p>{notificationState === 'denied' ? 'Permission denied. Change site notification permission in Android Chrome settings.' : notificationState === 'unsupported' ? 'Push is unsupported in this example browser.' : state.notifyEnabled[computer.id] ? state.pushRegistrations[computer.id] ? 'Enabled · registration healthy' : 'Enabled · registration missing' : 'Disabled'}</p><button class="primary full" disabled={notificationState !== 'supported'} onclick={() => { state.notifyEnabled[computer.id] = !state.notifyEnabled[computer.id]; state.pushRegistrations[computer.id] = state.notifyEnabled[computer.id]; }}>{state.notifyEnabled[computer.id] ? 'Disable notifications' : 'Enable notifications'}</button><button class="secondary full" disabled={!state.notifyEnabled[computer.id] || notificationState !== 'supported'} onclick={() => message = 'Simulated test notification delivered.'}>Send test notification</button><button class="secondary full" onclick={() => { state.pushRegistrations[computer.id] = true; message = 'Simulated missing push registration repaired.'; }}>Repair registration</button>
          {:else if sheet.type === 'usage'}
            <h1>Usage</h1><label class="field">Collector state<select aria-label="Usage collector state" value={state.usageModes[computer.id] || 'current'} onchange={e => state.usageModes[computer.id] = e.currentTarget.value}><option value="current">Current</option><option value="loading">Loading</option><option value="empty">No allowance data</option><option value="stale">Stale / unavailable</option></select></label>{#if state.usageModes[computer.id] === 'loading'}<p role="status">Loading usage…</p>{:else if state.usageModes[computer.id] === 'empty'}<p>No allowance data reported by this computer.</p>{:else}{#if state.usageModes[computer.id] === 'stale'}<p class="coverage">Collector unavailable. These last-known allowances are stale.</p>{/if}<p class="muted">Computer scope · fixture collector · last updated 8 minutes ago</p><div class="usage"><strong>Session allowance</strong><span>72% remaining</span><progress value="72" max="100"></progress><span>Resets in 3h 12m</span></div><div class="usage"><strong>Weekly allowance</strong><span>41% remaining</span><progress value="41" max="100"></progress><span>Resets Friday</span></div><button class="secondary full" onclick={() => state.usageModes[computer.id] = 'stale'}>Simulate stale collector</button>{/if}
          {:else if sheet.type === 'diagnostics' || sheet.type === 'recovery'}
            <h1>{sheet.type === 'recovery' ? 'Connection recovery' : 'Connection diagnostics'}</h1><dl><dt>Computer</dt><dd>{recoveryComputer.name} / {recoveryComputer.hostname}</dd><dt>Health</dt><dd>{recoveryComputer.health}</dd><dt>Desktop</dt><dd>{recoveryComputer.desktop ? 'Supported' : 'Unsupported · headless'}</dd><dt>Herdr management</dt><dd>{recoveryComputer.management ? 'Available' : 'Unavailable · core attachment still supported'}</dd><dt>Transport</dt><dd>In-memory simulation · no production API</dd></dl><p>{recoveryComputer.health === 'unauthorized' ? 'This browser credential is no longer authorized. Re-pair to restore access.' : recoveryComputer.health === 'offline' ? 'Computer is unreachable. The inventory and output are stale.' : recoveryComputer.health === 'reconnecting' ? 'Reconnecting. Input remains unsent and drafts are preserved.' : 'Connection healthy. Work activity and attention are separate signals.'}</p><button class="primary full" disabled={recoveryComputer.health === 'unauthorized'} onclick={() => { recoveryComputer.health='online';state=state; message = 'Simulated connection restored. No input was replayed.'; }}>Retry connection</button><button class="secondary full" onclick={() => showSheet('pair', { recoveryComputer: recoveryComputer.id })}>Recover credentials / re-pair</button>
          {:else if sheet.type === 'browser'}
            <h1>Browser preferences</h1><p class="muted">Applies only to this browser’s prototype. Prototype builds do not install a service worker.</p><button class="secondary full" onclick={() => showSheet('install')}>Install / add to home screen</button><label class="checkbox"><input type="checkbox" bind:checked={state.browserMotion} />Static terminal outline</label><label class="field">Text size<select bind:value={state.textSize}><option value={13}>Default</option><option value={16}>Readable</option><option value={19}>Large</option></select></label><p class="eyebrow">PROTOTYPE V1 · LOCAL SVELTE BUILD</p>
          {:else if sheet.type === 'install'}<h1>Add to home screen</h1><p>Android Chrome: open the browser menu and choose “Add to home screen.” This prototype can be saved as a shortcut; offline PWA behavior is not simulated.</p><p>iOS Safari: Share → Add to Home Screen. Physical keyboard behavior remains an on-device compatibility check.</p>
          {:else if sheet.type === 'preview' || sheet.type === 'capture'}
            <h1>{sheet.type === 'capture' ? 'Screen capture' : 'Published preview'}</h1><div class="image-viewport" class:actual={actualSize}><PreviewArt kind={state.previews.find(p => p.id === selectedPreview)?.kind || 'layout'} /></div><div class="button-row"><button class="secondary" class:chosen={!actualSize} onclick={() => actualSize = false}>Fit image</button><button class="secondary" class:chosen={actualSize} onclick={() => actualSize = true}>Actual size</button></div><p class="muted">Simulated image · {sheet.type === 'capture' ? 'Explicit desktop capture' : 'Independent published artifact'}</p>
          {:else if sheet.type === 'publish'}<h1>Publish an image</h1><p>Simulated publishing access is independent of terminal sharing. No file is uploaded.</p><label class="field">Task label<input bind:value={formName} placeholder="A task label" /></label><button class="primary full" onclick={() => { const id = 'preview-' + Date.now(); state.previews = [{ id, computer: computer.id, name: formName || 'New published image', caption: 'Explicit example publication. No terminal ownership inferred.', time: new Date().toLocaleTimeString(), dimensions: '1440 × 960', kind: 'layout' }, ...state.previews]; selectedPreview = id; closeSheet(); }}>Publish sample image</button>
          {:else if sheet.type === 'remove-preview'}<h1>Remove published image?</h1><p>This removes only the example artifact. Terminal work is unaffected.</p><button class="primary danger full" onclick={() => { state.previews = state.previews.filter(p => p.id !== sheet.data.id); selectedPreview = state.previews[0]?.id; closeSheet(); }}>Remove image</button>
          {:else if sheet.type === 'coverage'}<h1>What status tells you</h1><dl><dt>Connection</dt><dd>Online, reconnecting, unauthorized, or offline. Offline output is stale.</dd><dt>Activity</dt><dd>Working or idle. An animated terminal outline means output activity.</dd><dt>Reported attention</dt><dd>Supported terminals and Herdr may report a request. The outline does not signal attention.</dd><dt>Coverage gap</dt><dd>Codex does not detect requests. Unknown status, missing discovery, or an offline computer never means all-clear.</dd></dl>
          {:else if sheet.type === 'lab'}
            <h1>Test states</h1>{#if direction==='spaces'}<button class="secondary full" onclick={()=>{state.items=state.items.filter(i=>i.computer!==computer.id||i.source!=='Herdr');state=state;message='Herdr sample removed from this computer. Ordinary work and local spaces remain.';}}>Simulate no Herdr installed</button>{/if}<p class="muted">Only this direction’s in-browser fixtures change. Nothing is sent to your computers.</p><div class="button-row">{#each ['online','offline','reconnecting','unauthorized'] as health}<button class="secondary" onclick={() => simulate(health)}>{health}</button>{/each}</div><button class="secondary full" onclick={() => { computer.management = !computer.management; state = state; }}>Toggle Herdr management ({computer.management ? 'available' : 'unavailable'})</button><button class="secondary full" disabled={!item} onclick={() => { item.outputActive = !item.outputActive; state = state; message = 'Output activity changed independently of attention.'; }}>Toggle terminal output activity</button><button class="secondary full" disabled={!item} onclick={() => { item.closed = true; state = state; go('missing', {}, true); }}>Simulate active work closing</button><button class="secondary full" onclick={() => { state.items = state.items.map(i => i.computer === computer.id ? { ...i, status: 'unknown' } : i); message = 'All selected-computer attention is unknown.'; }}>Simulate unknown attention</button><button class="secondary full" onclick={() => { if (state.sequence.length > 1) { const neighbor = state.items.find(i => i.id === state.sequence.at(-1)); neighbor.closed = true; state = state; message = 'A sequence neighbor closed. It will not be recreated.'; } }}>Close a swipe neighbor</button><button class="secondary danger-text full" onclick={reset}>Reset this direction’s fixtures</button><a class="text-link" href="/">Back to comparison launcher →</a>
          {/if}
          {#if message}<div class="sheet-message" role="status">{message}{#if direction==='spaces'&&organizationErrors[computer.id]}<button class="secondary full" onclick={loadOrganizations}>Refresh organization</button>{/if}</div>{/if}
        </div>
      </div>
    </div>
  {/if}
{/if}
