'use strict';
// Observe failed requests only. Do not intercept requests or collect URL paths/bodies.
// Electron permits one listener per webRequest event; keep these two hooks centralized.
const owners=new WeakMap();
function captureFailures(session,journal,context){
  const owner={};owners.set(session,owner);
  const record=(details,httpError=false)=>{
    try{
      if(owners.get(session)!==owner||details.error==='net::ERR_ABORTED')return;
      const current=context();if(!current)return;
      const url=new URL(details.url);if(!['http:','https:'].includes(url.protocol))return;
      const id=journal.begin({operation:'page-request',...current,host:url.hostname});
      journal.record(id,{stage:httpError?'http-error':'request-error',method:details.method,resourceType:details.resourceType,webContentsId:details.webContentsId,...(httpError?{status:details.statusCode}:{code:String(details.error||'').replace(/^net::/,''),reason:details.error})});
      journal.finish(id,{result:'failed'});
    }catch{/* Diagnostics must never change request handling. */}
  };
  const filter={urls:['http://*/*','https://*/*']};
  session.webRequest.onErrorOccurred(filter,details=>record(details));
  session.webRequest.onCompleted(filter,details=>{if(details.statusCode>=400)record(details,true);});
  return ()=>{if(owners.get(session)!==owner)return;owners.delete(session);session.webRequest.onErrorOccurred(null);session.webRequest.onCompleted(null);};
}
module.exports={captureFailures};
