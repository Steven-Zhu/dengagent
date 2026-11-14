import http from 'node:http';
import { spawn } from 'node:child_process';
import { open, readFile, writeFile,unlink, chmod, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from './engine.mjs';
import { DengError, safeError,loadConfig } from './config.mjs';
import { hash } from './store.mjs';
import { VERSION } from './version.mjs';
import {loadedIdentity} from './identity.mjs';
import {waitTask} from './wait.mjs';
import { liveStream } from './live.mjs';

export const socketPath=config=>join('/tmp',`deng-${process.getuid?.()??'user'}-${hash(config.data_dir).slice(0,20)}.sock`);
const configHash=config=>hash(config);
async function acquireLock(config){
  const path=join(config.data_dir,'engine.lock');
  await mkdir(config.data_dir,{recursive:true,mode:0o700});
  for(let attempt=0;attempt<3;attempt++){
    try{const handle=await open(path,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();return async()=>{await unlink(path).catch(()=>{});};}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let owner;try{owner=JSON.parse(await readFile(path,'utf8'));}catch{throw new DengError('ENGINE_BUSY','Engine lock is being initialized; retry shortly');}
      try{process.kill(owner.pid,0);throw new DengError('ENGINE_BUSY','An engine already owns this project');}
      catch(check){if(check.code!=='ESRCH')throw check;}
      await unlink(path).catch(()=>{});
    }
  }
  throw new DengError('ENGINE_BUSY','Could not acquire engine ownership');
}
function json(response,status,value){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));}
async function body(request){
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>1_000_000)throw new DengError('REQUEST_SIZE','Request exceeds 1 MB');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new DengError('JSON','Invalid request JSON');}
}
export async function startHost(config){
  const release=await acquireLock(config);let engine;
  try{
    if(config.data_dir===join(config.workspace_root,'.dengagent')){
      try{await writeFile(join(config.data_dir,'.gitignore'),'*\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    engine=new Engine(config);
  }catch(error){await release();throw error;}
  const socket=socketPath(config);await unlink(socket).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const waiters=new Set();
  let closing=false,lastActivity=Date.now(),consolePreparedUntil=0,idleTimer,consolePanel;
  const server=http.createServer(async(request,response)=>{
    lastActivity=Date.now();
    try{
      const url=new URL(request.url,'http://localhost');
      if(url.pathname==='/health'){json(response,200,{...loadedIdentity,config_hash:configHash(config),pid:process.pid,workspace:config.workspace_root,console_url:consolePanel?.url,console_connected:consolePanel?.connected??false});return;}
      if(request.method==='POST'&&url.pathname==='/console/prepare'){
        consolePreparedUntil=Date.now()+600000;
        json(response,200,{panel_url:consolePanel.url,connected:consolePanel.connected,launch_grace_ms:600000,ready_until:new Date(consolePreparedUntil).toISOString()});return;
      }
      if(request.method==='GET'&&url.pathname==='/console/stream'){liveStream(engine,request,response,{touch:()=>{lastActivity=Date.now();}});return;}
      if(request.method==='GET'&&url.pathname==='/models'){await engine.refreshDefaults();json(response,200,engine.models());return;}
      if(request.method==='GET'&&url.pathname==='/connection'){json(response,200,await engine.connectionSettings());return;}
      if(request.method==='POST'&&url.pathname==='/connection'){json(response,200,await engine.configureConnection(await body(request)));return;}
      if(request.method==='POST'&&url.pathname==='/connection/probe'){json(response,200,await engine.probeConnection(await body(request)));return;}
      if(request.method==='POST'&&url.pathname==='/models'){await engine.refreshDefaults();const selection=await body(request);json(response,200,engine.config.scope==='global'?await engine.setGlobalModel(selection):engine.setModel(selection));return;}
      if(request.method==='POST'&&url.pathname==='/tasks'){json(response,200,await engine.submit(await body(request)));return;}
      if(request.method==='GET'&&url.pathname==='/tasks'){json(response,200,engine.store.list().map(task=>engine.store.view(task)));return;}
      if(request.method==='POST'&&url.pathname==='/shutdown'){json(response,200,{stopping:true});void close();return;}
      const match=/^\/tasks\/([a-f0-9-]{36})(?:\/(events|control|artifact|wait|input|delivery))?$/.exec(url.pathname);
      if(!match)throw new DengError('NOT_FOUND','Unknown local endpoint');
      const [,id,action]=match;
      if(request.method==='GET'&&!action){json(response,200,engine.get(id));return;}
      if(request.method==='POST'&&action==='input'){const value=await body(request);json(response,200,await engine.input(id,value.input,{expected_revision:value.expected_revision}));return;}
      if(request.method==='GET'&&action==='delivery'){json(response,200,await engine.verifyDelivery(id));return;}
      if(request.method==='GET'&&action==='wait'){
        const controller=new AbortController();waiters.add(controller);response.once('close',()=>controller.abort());
        try{const value=await waitTask(engine,id,{after:Number(url.searchParams.get('after')??0),timeout:Number(url.searchParams.get('timeout')??25000),signal:controller.signal});
          if(!response.destroyed)json(response,200,value);
        }finally{waiters.delete(controller);}return;
      }
      if(request.method==='GET'&&action==='events'){
        const after=Number(url.searchParams.get('after')??0);const limit=Number(url.searchParams.get('limit')??100);
        if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1)throw new DengError('CURSOR','Invalid event cursor');
        const events=engine.store.events(id,after,limit);json(response,200,{events,next_seq:events.at(-1)?.seq??after,task:engine.get(id)});return;
      }
      if(request.method==='POST'&&action==='control'){
        const {action:control,...options}=await body(request);json(response,200,await engine.control(id,control,options));return;
      }
      if(request.method==='GET'&&action==='artifact'){
        const task=engine.store.get(id);const text=JSON.stringify({result:task.result??null,acceptance:task.acceptance??null,changes:task.changes??{},error:task.error??null},null,2);
        const offset=Number(url.searchParams.get('offset')??0);const limit=Math.min(16384,Number(url.searchParams.get('limit')??4096));
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw new DengError('CURSOR','Invalid artifact cursor');
        // Character offsets keep UTF-8 text valid even across multibyte characters.
        const content=text.slice(offset,offset+limit);json(response,200,{task_id:id,sha256:hash(text),format:'json-fragment',offset,next_offset:offset+content.length<text.length?offset+content.length:null,content});return;
      }
      throw new DengError('NOT_FOUND','Unknown local endpoint');
    }catch(error){if(!response.headersSent)json(response,error.code==='NOT_FOUND'?404:400,{error:safeError(error)});else response.end();}
  });
  const close=async()=>{
    if(closing)return;closing=true;clearInterval(idleTimer);
    for(const controller of waiters)controller.abort();
    await consolePanel?.close();await engine.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await unlink(socket).catch(()=>{});await release();
  };
  try{
    const {startObserver}=await import('./observer.mjs');consolePanel=await startObserver(config,undefined,{embedded:true,idleMs:3600000});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);
  }catch(error){await consolePanel?.close();await engine.close();await release();throw error;}
  idleTimer=setInterval(()=>{
    if(!engine.active&&!engine.store.list().some(task=>task.status==='queued')&&Date.now()>consolePreparedUntil&&Date.now()-lastActivity>config.idle_shutdown_ms)void close();
  },Math.min(config.idle_shutdown_ms,1000));idleTimer.unref();
  return {engine,server,socket,close};
}
export async function request(config,path,method='GET',payload){
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:socketPath(config),path,method,headers:{'content-type':'application/json'},timeout:30000},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>2_000_000){req.destroy(new DengError('RESPONSE_SIZE','Local response too large'));return;}chunks.push(chunk);});
      response.on('end',()=>{
        try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(response.statusCode>=400)reject(new DengError(result.error?.code??'LOCAL_HTTP',result.error?.message??'Local engine request failed'));else resolve(result);}catch(error){reject(error);}
      });
    });
    req.once('error',reject);req.once('timeout',()=>req.destroy(new DengError('TIMEOUT','Local request timed out')));
    if(payload!==undefined)req.write(JSON.stringify(payload));req.end();
  });
}
export async function ensureHost(config,{allowActiveOlder=false}={}){
 const check=async()=>{
  const health=await request(config,'/health');
  if(health.workspace!==undefined&&health.workspace!==config.workspace_root)throw new DengError('CONFIG_PROJECT','Engine workspace does not match this explicit project');
  if((health.protocol??1)>loadedIdentity.protocol)throw new DengError('ENGINE_PROTOCOL_CHANGED','Engine protocol is newer than this client; refresh the Deng connection. No task was stopped.');
  const changed=health.version!==VERSION||health.build_id!==loadedIdentity.build_id||health.config_hash!==configHash(config);
  if(!changed)return health;
  if(health.workspace!==config.workspace_root)throw new DengError('ENGINE_VERSION_CHANGED','Legacy engine cannot be upgraded safely. Finish work and use stop-engine before reconnecting.');
  const tasks=await request(config,'/tasks');const active=tasks.some(t=>['running','queued','pausing','cancelling'].includes(t.status));
  if(active){if(allowActiveOlder)return{...health,upgrade_pending:true};throw new DengError('ENGINE_UPGRADE_PENDING','The engine has active work. Finish it before the idle upgrade; no task was paused or cancelled.');}
  await request(config,'/shutdown','POST',{});
  for(let i=0;i<100;i++){await delay(50);try{await request(config,'/health');}catch(e){if(['ENOENT','ECONNREFUSED','ECONNRESET'].includes(e.code))throw new DengError('ECONNREFUSED','Idle engine stopped for upgrade');throw e;}}
  throw new DengError('ENGINE_STOP','Idle engine did not stop; no replacement was started');
 };
 try{return await check();}catch(e){if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(e.code))throw e;}
 await mkdir(config.data_dir,{recursive:true,mode:0o700});const log=await open(join(config.data_dir,'engine.log'),'a',0o600);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/deng.mjs',import.meta.url)),'serve','--config',config.path],{detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});child.unref();await log.close();
 for(let i=0;i<100;i++){await delay(100);try{return await check();}catch(e){if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(e.code))throw e;}}
 throw new DengError('ENGINE_START','Engine did not start; inspect the project engine log');
}

export async function prepareConsole(config){
  await ensureHost(config,{allowActiveOlder:true});
  try{return await request(config,'/console/prepare','POST',{});}
  catch(error){
    if(error.code!=='NOT_FOUND')throw error;
    const health=await request(config,'/health');
    return {panel_url:health.console_url,connected:health.console_connected,launch_grace_ms:0,warning:'The running legacy engine has no launch grace period. Refresh the console URL when reopening.'};
  }
}
