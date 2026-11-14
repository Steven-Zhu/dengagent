import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative} from 'node:path';
import {workspacePath} from './paths.mjs';
import {hash} from './store.mjs';
import {DengError} from './config.mjs';

export async function digestFile(path,signal){
 signal?.throwIfAborted();const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let stream;
 try{
  const before=await handle.stat();if(!before.isFile())throw new DengError('ARTIFACT_TYPE','Artifact must be a regular file');
  const digest=createHash('sha256');stream=handle.createReadStream({autoClose:false});
  const abort=()=>stream.destroy(signal.reason);signal?.addEventListener('abort',abort,{once:true});
  try{for await(const chunk of stream){signal?.throwIfAborted();digest.update(chunk);}}finally{signal?.removeEventListener('abort',abort);}
  const after=await handle.stat(),current=await lstat(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==current.ino||before.dev!==current.dev)throw new DengError('ARTIFACT_CHANGED','Artifact changed while hashing; no stable version was accepted');
  return{sha256:digest.digest('hex'),bytes:after.size};
 }finally{await handle.close();}
}
export async function fileManifest(config,task,paths,signal){
 const files=[];
 for(const path of [...new Set(paths)].sort()){
  const absolute=await workspacePath(config,task,path);const file={path:relative(config.workspace_root,absolute),...await digestFile(absolute,signal)};
  if(files.some(f=>f.path===file.path))continue;files.push(file);
 }
 return{files,version:hash(files)};
}
export async function captureProtected(config,task,signal){return fileManifest(config,task,task.spec.acceptance.protected_files??[],signal);}
export async function verifyDelivery(config,task,signal){
 if(!task.delivery)return{task_id:task.id,valid:false,reason:'No completed delivery'};
 const changed=[];
 for(const expected of task.delivery.files){
  try{const path=await workspacePath(config,task,expected.path),actual=await digestFile(path,signal);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)changed.push(expected.path);}
  catch{changed.push(expected.path);}
 }
 return{task_id:task.id,delivery_id:task.delivery.id,valid:changed.length===0,changed_files:changed,checked_files:task.delivery.files.length};
}
export async function checkDelivery(config,task,runner,store,signal){
 const checks=[],paths=task.spec.acceptance.required_files;
 let before;
 try{before=await fileManifest(config,task,paths,signal);for(const file of before.files)checks.push({type:'required_file',...file,passed:true});}
 catch(error){checks.push({type:'required_files',passed:false,code:error.code??'MISSING_FILE'});}
 const protectedNow=await captureProtected(config,task,signal);
 if(task.protected_manifest&&protectedNow.version!==task.protected_manifest.version){
  checks.push({type:'protected_dependencies',passed:false,code:'ACCEPTANCE_PROTECTED_CHANGED'});
  return{passed:false,checks,semantic:'not_checked',quality_scope:'current_final_acceptance'};
 }
 for(const command of task.spec.acceptance.commands){
  signal.throwIfAborted();store.event(store.get(task.id),'acceptance.started',{argv:command.argv,cwd:command.cwd});
  const value=await runner.run(store.get(task.id),command,signal,p=>store.event(store.get(task.id),'tool.output',{acceptance:true,...p}),{acceptance:true});
  checks.push({type:'command',...value,passed:value.code===0&&!value.timed_out&&!value.signal});
 }
 let after;
 try{after=await fileManifest(config,task,paths,signal);}catch(error){checks.push({type:'artifact_stability',passed:false,code:error.code??'ARTIFACT_CHANGED'});}
 if(before&&after&&before.version!==after.version)checks.push({type:'artifact_stability',passed:false,code:'ARTIFACT_CHANGED_DURING_ACCEPTANCE'});
 const protectedAfter=await captureProtected(config,task,signal);
 if(protectedAfter.version!==protectedNow.version)checks.push({type:'protected_dependencies',passed:false,code:'ACCEPTANCE_PROTECTED_CHANGED'});
 const passed=checks.every(c=>c.passed)&&Boolean(after);
 const delivery=passed?{id:hash({task_id:task.id,version:after.version,protected_version:protectedAfter.version,commands:task.spec.acceptance.commands}),artifact_version:after.version,files:after.files,protected_files:protectedAfter.files,checked_at:new Date().toISOString(),quality_scope:'current_final_acceptance',semantic:'not_checked',command_checks:task.spec.acceptance.commands.length}:undefined;
 return{passed,checks,semantic:'not_checked',quality_scope:'current_final_acceptance',...(delivery?{delivery}:{})};
}
