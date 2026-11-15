import { initialState, draftKey } from '../src/model.js';
import { spacesFor, taskFor, taskSequence, findWork } from '../src/spaces-model.js';

type Work = {id:string;computer:string;source:string;name:string;status:string;generation:number;[key:string]:any};
type LocalSpace = {id:string;computer:string;name:string;tabs:{id:string;name:string}[]};
type State = Omit<ReturnType<typeof initialState>,'items'|'workSpaces'|'workAssignments'> & {items:Work[];workSpaces:LocalSpace[];workAssignments:Record<string,string>};
const makeState = ():State => initialState();

function equal(actual: unknown, expected: unknown) {
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

Deno.test('unassigned work stays distinct despite duplicate names and directories',()=>{
  const state=makeState();
  equal(spacesFor(state).find(s=>s.unassigned)?.tabs.length,8);
  equal(taskSequence(state,state.items.find(i=>i.id==='tmux-4')),['tmux-4']);
  equal(taskSequence(state,state.items.find(i=>i.id==='tmux-5')),['tmux-5']);
});

Deno.test('native space and tab IDs determine membership and pane order',()=>{
  const state=makeState();
  const item=state.items.find(i=>i.id==='herdr-0')!;
  const duplicate={...item,id:'another-source',spaceId:'different-space',tabId:'different-tab'};
  state.items.push(duplicate);
  equal(taskSequence(state,item),['herdr-0','herdr-1']);
  equal(taskSequence(state,duplicate),['another-source']);
});

Deno.test('explicit local grouping survives absent Herdr and does not change source identity',()=>{
  const state=makeState();
  state.items=state.items.filter(i=>i.source!=='Herdr');
  state.workSpaces=[{id:'local:test',computer:'studio',name:'Product',tabs:[{id:'task:test',name:'Mobile'}]}];
  for(const id of ['tmux-0','codex-0'])state.workAssignments[draftKey(state.items.find(i=>i.id===id))]='task:test';
  equal(taskSequence(state,state.items[0]),['tmux-0','codex-0']);
  equal(state.items[0].source,'Terminal');
  equal(taskFor(state,state.items[0])?.space.name,'Product');
  state.workSpaces=[];
  equal(taskFor(state,state.items[0])?.space.name,'Unassigned');
  equal(state.items.some(i=>i.closed),false);
});

Deno.test('local memberships never migrate to another computer or generation',()=>{
  const state=makeState();
  const item=state.items[0];
  state.workSpaces=[{id:'local:test',computer:'studio',name:'Product',tabs:[{id:'task:test',name:'Mobile'}]}];
  state.workAssignments[draftKey(item)]='task:test';
  state.items.push({...item,id:'replacement',generation:2},{...item,computer:'build'});
  equal(taskSequence(state,item),['tmux-0']);
  equal(taskFor(state,state.items.at(-2))?.space.name,'Unassigned');
  equal(taskFor(state,state.items.at(-1))?.space.name,'Unassigned');
});

Deno.test('attention search excludes offline reports and retains explicit coverage gaps',()=>{
  const state=makeState();
  state.items.find(i=>i.id==='travel-shell')!.status='needs';
  equal(findWork(state,'',true,true).map((i:Work)=>i.id),['tmux-0','herdr-0','herdr-4','build-job']);
  equal(findWork(state,'reconnect race').map((i:Work)=>i.id),['codex-1']);
  equal(findWork(state,'Mobile').map((i:Work)=>i.id),['codex-0','herdr-0','herdr-1']);
});
