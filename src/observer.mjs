import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureHost,request,socketPath } from './host.mjs';
import { DengError,safeError } from './config.mjs';
import { publicTask } from './live.mjs';

export async function startObserver(config,taskId,{idleMs=1800000,embedded=false}={}){
  if(taskId&&!/^[a-f0-9-]{36}$/.test(taskId))throw new DengError('TASK_ID','Specify a task UUID');
  if(!embedded)await ensureHost(config);
  if(taskId)await request(config,`/tasks/${taskId}/events?limit=1`);
  const path=`/view/${randomBytes(18).toString('hex')}/`;
  const nonce=randomBytes(18).toString('base64'),csrf=randomBytes(24).toString('hex');
  const html=(await readFile(new URL('./observer.html',import.meta.url),'utf8')).replaceAll('__NONCE__',nonce).replaceAll('__CSRF__',csrf);
  let origin,closing=false,lastRequest=Date.now(),idleTimer,connections=0;
  const server=http.createServer(async(req,res)=>{
    const headers={'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',
      'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`};
    const send=(status,value,type='application/json')=>{res.writeHead(status,{...headers,'content-type':type+'; charset=utf-8'});res.end(type==='application/json'?JSON.stringify(value):value);};
    try{
      if(req.headers.host!==new URL(origin).host){send(421,{error:'Unexpected host'});return;}
      const url=new URL(req.url,origin);
      if(!url.pathname.startsWith(path)){send(404,{error:'Not found'});return;}
      if((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Foreign origin'});return;}
      lastRequest=Date.now();
      if(req.method==='GET'&&url.pathname===path){send(200,html,'text/html');return;}
      const route=url.pathname.slice(path.length);
      if(req.method==='GET'&&route==='connection'){send(200,await request(config,'/connection'));return;}
      if(req.method==='POST'&&['model','control','input','connection','connection/probe'].includes(route)){
        if(req.headers.origin!==origin||req.headers['x-deng-csrf']!==csrf||req.headers['content-type']!=='application/json'){send(403,{error:'Invalid console request'});return;}
        const limit=route.startsWith('connection')?32768:route==='input'?20000:2048;
        let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw new Error('Request too large');}
        const body=JSON.parse(text);
        if(route.startsWith('connection')){send(200,await request(config,'/'+route,'POST',body));return;}
        if(url.pathname===path+'model'){
          if(Object.keys(body).some(key=>!['model','profile'].includes(key)))throw new Error('Only future-task model selection is allowed');
          const catalog=await request(config,'/models');
          if(!catalog.choices.some(p=>p.profile===body.profile&&p.model===body.model)&&!(catalog.default?.profile===body.profile&&catalog.default?.model===body.model))throw new Error('Choose a configured model');
          send(200,await request(config,'/models','POST',{model:body.model,profile:body.profile}));return;
        }
        if(route==='input'){if(Object.keys(body).some(k=>!['task_id','input','expected_revision'].includes(k))||!/^[a-f0-9-]{36}$/.test(body.task_id)||typeof body.input!=='string'||!body.input.trim()||body.input.length>16000||!Number.isSafeInteger(body.expected_revision))throw new Error('Invalid bounded clarification');const{task_id,...payload}=body;send(200,await request(config,`/tasks/${task_id}/input`,'POST',payload));return;}
        if(Object.keys(body).some(key=>!['task_id','action','expected_revision','allow_unknown_usage','allow_unknown_commands'].includes(key))||!/^[a-f0-9-]{36}$/.test(body.task_id)||!['pause','resume','cancel'].includes(body.action)||!Number.isSafeInteger(body.expected_revision))throw new Error('Invalid task control');
        for(const key of ['allow_unknown_usage','allow_unknown_commands'])if(body[key]!==undefined&&typeof body[key]!=='boolean')throw new Error('Acknowledgement must be explicit');
        const {task_id,...control}=body;send(200,publicTask(await request(config,`/tasks/${task_id}/control`,'POST',control)));return;
      }
      if(req.method!=='GET'){send(405,{error:'Method not allowed'});return;}
      if(url.pathname===path+'stream'){
        const upstream=http.request({socketPath:socketPath(config),path:'/console/stream'+(taskId?'?task='+taskId:''),headers:req.headers['last-event-id']?{'last-event-id':req.headers['last-event-id']}:{}},source=>{
          if(source.statusCode!==200){source.resume();send(502,{error:'Engine stream unavailable'});return;}
          connections++;res.writeHead(200,{...headers,'content-type':'text/event-stream; charset=utf-8'});res.flushHeaders();
          source.on('data',()=>{lastRequest=Date.now();});source.pipe(res);source.once('error',()=>res.destroy());
          res.once('close',()=>{connections--;source.destroy();});
        });
        upstream.once('error',()=>{if(!res.headersSent)send(502,{error:'Engine disconnected'});else res.destroy();});
        res.once('close',()=>upstream.destroy());upstream.end();return;
      }
      // Bounded history endpoint retained for CLI/debugging compatibility.
      if(url.pathname===path+'events'&&taskId){
        const after=Number(url.searchParams.get('after')??0);if(!Number.isSafeInteger(after)||after<0){send(400,{error:'Invalid event cursor'});return;}
        const page=await request(config,`/tasks/${taskId}/events?after=${after}&limit=100`);send(200,{...page,task:publicTask(page.task)});return;
      }
      send(404,{error:'Not found'});
    }catch(error){if(!res.headersSent)send(400,{error:safeError(error).message});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  const close=async()=>{if(closing)return;closing=true;clearInterval(idleTimer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  if(!embedded){idleTimer=setInterval(()=>{if(!connections&&Date.now()-lastRequest>idleMs)void close();},Math.min(idleMs,5000));idleTimer.unref();}
  return {url:origin+path,close,get connected(){return connections>0;},get closed(){return closing;}};
}
