import { organizationClient } from '../../../web/src/lib/spaces/organization-client.js';

export const sampleOrganization = computer => organizationClient({id:computer}, async(method,document,host)=>{
  const namespace=localStorage.getItem('deskpilot-mobile-directions:sample-namespace')||'review';
  const response=await fetch(`/__prototype/organization/${host.id}`,{
    method,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000),
    headers:{'content-type':'application/json','x-prototype-namespace':namespace},
    ...(method==='POST'?{body:JSON.stringify(document)}:{}),
  });
  const body=await response.json();
  if(!response.ok){const error=new Error(body.error||'Sample organization unavailable');error.status=response.status;throw error;}
  return body;
});
