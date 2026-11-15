// Only UI state belongs here. Never persist terminal output, credentials,
// pairing codes, desktop passwords, or in-flight actions.
export const RESUME_KEY = "dp_resume_v1";
const views = new Set([
  "sessions",
  "screens",
  "previews",
  "terminal",
  "new",
  "management",
  "attention",
  "computer",
]);
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value : "";
/** @typedef {{ref?: any,scope?: string,order?:any[],across?:boolean,task?:any,host: string, view: string, session?: string, query?: string, filter?: string, settings?: string, review?: any[], reviewIndex?: number, returnTo?: ResumeRoute}} ResumeRoute */

export function resumeRoute(value, origins, depth = 0) {
  if (
    !record(value) || !origins.includes(value.host) || !views.has(value.view)
  ) return null;
  /** @type {ResumeRoute} */
  const route = { host: value.host, view: value.view };
  if (value.view === "terminal") {
    if (!text(value.session)) return null;
    route.session = value.session;
  }
  const ref=r=>record(r)&&['session','conversation','herdr'].includes(r.kind)&&text(r.id)&&r.id.length<=512&&text(r.generation)&&r.generation.length<=160?{kind:r.kind,id:r.id,generation:r.generation}:null;
  if(ref(value.ref))route.ref=ref(value.ref);
  if(typeof value.across==='boolean')route.across=value.across;
  if(text(value.scope))route.scope=value.scope.slice(0,1000);
  if(Array.isArray(value.order))route.order=value.order.map(ref).filter(Boolean).slice(0,200);
  if(value.view==='new'&&record(value.task)&&value.task.host===value.host&&text(value.task.spaceId)&&text(value.task.taskId))route.task={host:value.host,spaceId:value.task.spaceId.slice(0,96),taskId:value.task.taskId.slice(0,96)};
  if (text(value.query)) route.query = value.query.slice(0, 500);
  if (["all", "blocked", "working"].includes(value.filter)) {
    route.filter = value.filter;
  }
  if (
    [
      "home",
      "machines",
      "devices",
      "notifications",
      "usage",
      "connections",
      "app",
    ].includes(value.settings)
  ) route.settings = value.settings;
  if (value.view === "terminal" && Array.isArray(value.review)) {
    const review = value.review.filter((e) =>
      record(e) && origins.includes(e.host) &&
      ["session", "conversation", "herdr"].includes(e.kind) && text(e.id)
    ).slice(0, 200).map((e) => ({
      host: e.host,
      kind: e.kind,
      id: e.id,
      session: text(e.session),
      title: text(e.title),
    }));
    if (
      review.length && Number.isInteger(value.reviewIndex) &&
      value.reviewIndex >= 0 && value.reviewIndex < review.length
    ) {
      route.review = review;
      route.reviewIndex = value.reviewIndex;
    }
  }
  if (depth < 3 && value.returnTo) {
    const parent = resumeRoute(value.returnTo, origins, depth + 1);
    if (
      parent &&
      ["sessions", "screens", "attention", "management", "computer", "terminal"]
        .includes(parent.view)
    ) route.returnTo = parent;
  }
  return route;
}

function clean(value, origins) {
  if (!record(value) || value.version !== 1) return null;
  const route = resumeRoute(value.route, origins);
  /** @type {Record<string, {input: string, clip: string}>} */
  const drafts = {};
  /** @type {Record<string, {name: string, dir: string, command: string, workspace: number | null}>} */
  const creationDrafts = {};
  if (record(value.drafts)) {
    for (const [key, draft] of Object.entries(value.drafts)) {
      try {
        const parts=JSON.parse(key),[host,name,id,generation]=parts;
        const valid=parts.length===2?!!text(name):parts.length===4&&['session','conversation','herdr'].includes(name)&&text(id)&&text(generation);
        if(!origins.includes(host)||!valid||!record(draft))continue;
        const input=text(draft.input),clip=text(draft.clip);
        if(input||clip)drafts[JSON.stringify(parts)]={input,clip};
      } catch {
        /* malformed key */
      }
    }
  }
  if (record(value.creationDrafts)) {
    for (const host of origins) {
      const draft = value.creationDrafts[host];
      if (!record(draft)) continue;
      creationDrafts[host] = {
        name: text(draft.name),
        dir: text(draft.dir),
        command: text(draft.command),
        workspace: Number.isInteger(draft.workspace) && draft.workspace >= 1 &&
            draft.workspace <= 10
          ? draft.workspace
          : null,
      };
    }
  }
  const screens = Array.isArray(value.screens)
    ? value.screens.filter((entry) =>
      Array.isArray(entry) && origins.includes(entry[0]) &&
      Number.isInteger(entry[1]) && entry[1] >= 1 && entry[1] <= 10
    )
    : [];
  const positions = Array.isArray(value.positions)
    ? value.positions.filter((entry) => {
      if (!Array.isArray(entry) || !Number.isFinite(entry[1]) || entry[1] < 0) {
        return false;
      }
      try {
        const [host, view] = JSON.parse(entry[0]);
        return origins.includes(host) && views.has(view);
      } catch {
        return false;
      }
    })
    : [];
  const order = Array.isArray(value.order)
    ? [...new Set(value.order.filter((name) => text(name)))]
    : [];
  /** @type {Record<string, ResumeRoute>} */
  const visits = {};
  /** @type {Record<string, {kind:string,id:string}[]>} */
  const recent = {};
  if (record(value.visits)) {
    for (const host of origins) {
      const visit = resumeRoute(value.visits[host], origins);
      if (visit && visit.host === host) visits[host] = visit;
    }
  }
  if (record(value.recent)) {
    for (const host of origins) {
      if (Array.isArray(value.recent[host])) {
        recent[host] = value.recent[host].filter((e) =>
          record(e) && ["session", "conversation", "herdr"].includes(e.kind) &&
          text(e.id)
        ).slice(0, 8).map((e) => ({ kind: e.kind, id: e.id }));
      }
    }
  }
  /** @type {Record<string,{expanded:Record<string,boolean>,scroll:number,showHidden?:boolean}>} */
  const spaces={};
  if(record(value.spaces))for(const host of origins){const pref=value.spaces[host];if(record(pref)){const expanded=/** @type {Record<string,boolean>} */({});if(record(pref.expanded))for(const [id,v]of Object.entries(pref.expanded).slice(0,128))if(typeof v==='boolean')expanded[id]=v;spaces[host]={expanded,...(pref.showHidden?{showHidden:true}:{}),scroll:Number.isFinite(pref.scroll)?Math.max(0,pref.scroll):0};}}
  return {
    version: 1,
    route,
    drafts,
    creationDrafts,
    screens,
    positions,
    order,
    visits,
    recent,spaces,
  };
}

export function readResume(storage, origins) {
  try {
    return clean(JSON.parse(storage.getItem(RESUME_KEY)), origins);
  } catch {
    return null;
  } // Corrupt data or unavailable browser storage is nonfatal.
}

export function writeResume(storage, state, origins) {
  try {
    storage.setItem(
      RESUME_KEY,
      JSON.stringify(clean({ ...state, version: 1 }, origins)),
    );
  } catch {
    /* Storage can be full or disabled; the live app must still work. */
  }
}
