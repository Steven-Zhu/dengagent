import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {StringDecoder} from 'node:string_decoder';
import {workspacePath,commandCwd} from './paths.mjs';
import {DengError} from './config.mjs';
import {hash} from './store.mjs';
const quote=path=>JSON.stringify(path);
export const commandIdentity=command=>hash({argv:command.argv,cwd:command.cwd??'.'});
export class ProcessRunner{
 constructor(config,{store}={}){this.config=config;this.store=store;this.active=new Map();}
 async run(task,command,signal,onOutput=()=>{},{acceptance=false,onExit=()=>{},call_id}={}){
  signal.throwIfAborted();const{config,store}=this;
  const permitted=[...task.spec.scope.commands,...task.spec.acceptance.commands,...(task.spec.milestones??[]).flatMap(m=>m.commands)];
  const authorized=permitted.find(item=>commandIdentity(item)===commandIdentity(command));
  if(!authorized||['timeout_ms','replay_safe'].some(k=>command[k]!==undefined&&command[k]!==authorized[k]))throw new DengError('COMMAND_SCOPE','Command must match an authorized argv/cwd and its declared execution policy');
  const policy=task.command_policies?.[commandIdentity(authorized)]??authorized;
  const requested=policy.timeout_ms??config.tools.command_timeout_ms;
  if(requested>(config.tools.max_command_timeout_ms??600000))throw new DengError('COMMAND_TIMEOUT_SCOPE','Authorized command timeout exceeds the product maximum');
  const remaining=task.created_at&&task.spec.budget?.max_duration_ms?task.spec.budget.max_duration_ms-(Date.now()-Date.parse(task.created_at)):Infinity;
  if(remaining<=0)throw new DengError('DEADLINE','Original task deadline elapsed; no command was started');
  const timeoutMs=Math.max(1,Math.min(requested,remaining));
  const cwd=await commandCwd(config,task,command.cwd??'.');const temp=join(config.data_dir,'tmp',task.id);await mkdir(temp,{recursive:true,mode:0o700});
  const env={};for(const name of config.tools.child_env_allowlist){if(/key|token|secret|password|credential|auth/i.test(name))continue;if(process.env[name]!==undefined)env[name]=process.env[name];}
  env.PATH=`${dirname(process.execPath)}:${env.PATH??'/usr/bin:/bin:/usr/sbin:/sbin'}`;env.TMPDIR=temp;env.TMP=temp;env.TEMP=temp;env.HOME=temp;
  let[executable,...args]=command.argv;if(executable==='node')executable=process.execPath;
  if(config.tools.isolation==='macos'){
   if(process.platform!=='darwin')throw new DengError('ISOLATION_UNAVAILABLE','macOS command isolation is unavailable; choose a supported backend');
   const writable=task.spec.scope.write.map(p=>join(config.workspace_root,p));for(const p of task.spec.scope.write)await workspacePath(config,task,p,true);
   const protectedPaths=[config.data_dir,join(config.workspace_root,'.git'),join(config.workspace_root,'.codex'),join(config.workspace_root,'.agents'),join(homedir(),'.ssh'),join(homedir(),'.aws'),join(homedir(),'.codex'),join(homedir(),'.agents'),join(homedir(),'.config','dengagent'),config.path,...(config.defaults_file?[config.defaults_file,dirname(config.defaults_file)]:[]),...Object.values(config.models.profiles).map(p=>p.api_key_file).filter(Boolean),...(config.retired_credential_files??[]),...([task.profile?.api_key_file].filter(Boolean))];
   const immutable=(task.spec.acceptance.protected_files??[]).map(p=>join(config.workspace_root,p));
   const profile=`(version 1) (allow default) (deny network*) (deny file-write*)
    (allow file-write* ${[...writable,temp].map(p=>`(subpath ${quote(p)})`).join(' ')} (literal "/dev/null"))
    (deny file-read* file-write* ${protectedPaths.map(p=>`(subpath ${quote(p)})`).join(' ')} (regex #".*/[.]env([.].*)?$"))
    ${immutable.length?`(deny file-write* ${immutable.map(p=>`(literal ${quote(p)})`).join(' ')})`:''}
    (allow file-read* file-write* (subpath ${quote(temp)}))`;
   args=['-p',profile,executable,...args];executable='/usr/bin/sandbox-exec';
  }
  const operationId=store?.beginCommand(task,policy,commandIdentity(authorized),{call_id,acceptance});
  if(store){const current=store.get(task.id);current.phase={name:acceptance?'accepting':'executing_command',operation_id:operationId,started_at:new Date().toISOString(),timeout_ms:timeoutMs};store.saveEvent(current,'task.phase',current.phase);}
  let child;try{child=spawn(executable,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}catch(e){if(operationId)store.endCommand(operationId,{code:null,signal:null,timed_out:false,executed:false});throw e;}
  const group=child.pid;if(group){this.active.set(group,child);if(operationId)store.startCommand(operationId,group);}
  let output='',rawBytes=0,truncated=false,timedOut=false,killTimer,ended=false;
  const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
  const append=(channel,text)=>{const left=Math.max(0,config.tools.max_output_bytes-Buffer.byteLength(output));if(Buffer.byteLength(text)>left){text=Buffer.from(text).subarray(0,left).toString('utf8').replace(/\uFFFD$/,'');truncated=true;}if(text){output+=text;onOutput({channel,text});}};
  const read=(channel,chunk)=>{const left=Math.max(0,config.tools.max_output_bytes-rawBytes);const take=chunk.subarray(0,left);rawBytes+=take.length;append(channel,decoders[channel].write(take));if(chunk.length>left)truncated=true;};
  const kill=()=>{if(!group)return;const send=name=>{try{process.platform==='win32'?child.kill(name):process.kill(-group,name);}catch(e){if(e.code!=='ESRCH')throw e;}};send('SIGTERM');killTimer=setTimeout(()=>send('SIGKILL'),500);killTimer.unref();};
  child.stdout.on('data',chunk=>read('stdout',chunk));child.stderr.on('data',chunk=>read('stderr',chunk));
  const timeout=setTimeout(()=>{timedOut=true;kill();},timeoutMs);timeout.unref();signal.addEventListener('abort',kill,{once:true});if(signal.aborted)kill();
  try{
   const value=await new Promise((resolve,reject)=>{child.once('error',()=>reject(new DengError('COMMAND_START','Could not start authorized command')));child.once('close',(code,exitSignal)=>{if(!truncated)for(const k of ['stdout','stderr'])append(k,decoders[k].end());resolve({argv:command.argv,cwd:command.cwd??'.',code,signal:exitSignal,output,truncated,timed_out:timedOut,acceptance,timeout_ms:timeoutMs,replay_safe:policy.replay_safe===true,executed:true,operation_id:operationId});});});
   if(operationId){store.endCommand(operationId,value);ended=true;const current=store.get(task.id);if(current.status==='running'){current.phase={name:acceptance?'accepting':'awaiting_model'};store.save(current);}}
   onExit(value);signal.throwIfAborted();return value;
  }catch(e){if(operationId&&!ended&&e.code==='COMMAND_START')store.endCommand(operationId,{code:null,signal:null,timed_out:false,executed:false});throw e;}
  finally{clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',kill);if(group)this.active.delete(group);if(group&&process.platform!=='win32')try{process.kill(-group,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
 }
}
