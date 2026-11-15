// Local sample data only. This middleware never contacts Deskpilot or reads its
// credentials. Each fake computer has a separate document and tests use their
// own namespace so verification cannot overwrite the user's sample organization.
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOrganization, OrganizationError, ORGANIZATION_MAX_BYTES } from '../../server/organization.ts';
const root=fileURLToPath(new URL('./.prototype-state/',import.meta.url));

export function previewOrganization() {
  const install=server=>{server.middlewares.use(async(req,res,next)=>{
    const match=req.url?.split('?')[0].match(/^\/__prototype\/organization\/(studio|build|travel)$/);
    if(!match)return next();
    const namespace=req.headers['x-prototype-namespace']||'review';
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    if(typeof namespace!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace))return send(400,{error:'Invalid sample namespace'});
    const directory=resolve(root,namespace),path=resolve(directory,match[1]+'.json');
    const read=()=>{try{return validateOrganization(JSON.parse(readFileSync(path,'utf8')));}catch(e){if(e.code==='ENOENT')return {version:1,revision:0,spaces:[],assignments:[]};throw new OrganizationError('Sample organization is unreadable; it was not reset',503);}};
    let temp='';
    try{
      if(req.method==='GET')return send(200,read());
      if(req.method!=='POST')return send(405,{error:'Method not allowed'});
      let length=0;const chunks=[];
      req.setTimeout(10000,()=>req.destroy());
      for await(const chunk of req){length+=chunk.length;if(length>ORGANIZATION_MAX_BYTES)return send(413,{error:'Sample document too large'});chunks.push(chunk);}
      let candidate;try{candidate=validateOrganization(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){throw e instanceof OrganizationError?e:new OrganizationError('Invalid sample document');}
      const current=read();
      if(candidate.revision!==current.revision)return send(409,{error:'Organization changed in another browser. Refresh before saving again'});
      if(candidate.revision>=Number.MAX_SAFE_INTEGER)throw new OrganizationError('Sample organization revision limit reached',503);
      candidate.revision++;
      mkdirSync(directory,{recursive:true,mode:0o700});
      temp=path+'.'+crypto.randomUUID()+'.tmp';
      writeFileSync(temp,JSON.stringify(candidate)+'\n',{mode:0o600,flag:'wx'});
      const file=openSync(temp,'r');try{fsyncSync(file);}finally{closeSync(file);}
      renameSync(temp,path);temp='';
      const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
      return send(200,candidate);
    }catch(e){send(e instanceof OrganizationError?e.status:503,{error:e instanceof OrganizationError?e.message:'Sample organization could not be saved. Refresh to check its current state'});}
    finally{if(temp)try{rmSync(temp);}catch{}}
  });};
  return {name:'isolated-sample-organization',configureServer:install,configurePreviewServer:install};
}
