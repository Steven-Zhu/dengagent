import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {DengError,terminal,taskSchema} from './config.mjs';
import {modelInfo} from './selection.mjs';
import {EventEmitter} from 'node:events';
import {usageBreakdown} from './protocol.mjs';

export const hash=value=>createHash('sha256').update(typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const requestFingerprint=spec=>hash({version:1,request:canonical(spec)});
export class Store{
 constructor(directory){
  this.updates=new EventEmitter();this.updates.setMaxListeners(0);this.notifications=null;
  const{DatabaseSync}=createRequire(import.meta.url)('node:sqlite');mkdirSync(directory,{recursive:true,mode:0o700});
  const path=join(directory,'tasks.sqlite');this.db=new DatabaseSync(path);chmodSync(path,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,request_id TEXT UNIQUE,digest TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS events_task ON events(task_id,seq);
   CREATE INDEX IF NOT EXISTS operations_task ON operations(task_id,kind);`);
  if(!this.db.prepare('PRAGMA table_info(tasks)').all().some(c=>c.name==='request_digest'))this.db.exec('ALTER TABLE tasks ADD COLUMN request_digest TEXT');
 }
 emit(name,...args){if(this.notifications)this.notifications.push([name,args]);else this.updates.emit(name,...args);}
 transaction(fn){
  if(this.notifications)return fn();
  this.db.exec('BEGIN IMMEDIATE');this.notifications=[];let value,events;
  try{value=fn();if(value?.then)throw new Error('Store transaction callback must be synchronous');this.db.exec('COMMIT');events=this.notifications;}
  catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.notifications=null;}
  for(const[name,args]of events)this.updates.emit(name,...args);return value;
 }
 setting(key){const row=this.db.prepare('SELECT body FROM settings WHERE key=?').get(key);return row?JSON.parse(row.body):undefined;}
 setSetting(key,value){this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(value));this.emit('change');}
 duplicate(spec,fingerprint){
  if(!spec.request_id)return null;
  const row=this.db.prepare('SELECT id,request_digest FROM tasks WHERE request_id=?').get(spec.request_id);if(!row)return null;
  const task=this.get(row.id);
  // Legacy records retain their requested overrides separately from effective limits.
  const old=row.request_digest??requestFingerprint(taskSchema.parse({...task.spec,budget:task.budget_resolution?.requested??task.spec.budget}));
  if(old!==fingerprint)throw new DengError('IDEMPOTENCY_CONFLICT','request_id already refers to a different original request');
  if(!row.request_digest)this.db.prepare('UPDATE tasks SET request_digest=? WHERE id=?').run(fingerprint,row.id);
  return{task,duplicate:true};
 }
 create(spec,profile,profileName,provider,{request_digest}={}){
  return this.transaction(()=>{
   const digest=hash(spec);
   if(request_digest){const old=this.duplicate(spec,request_digest);if(old)return old;}
   else if(spec.request_id){const row=this.db.prepare('SELECT id,digest FROM tasks WHERE request_id=?').get(spec.request_id);if(row){if(row.digest!==digest)throw new DengError('IDEMPOTENCY_CONFLICT','request_id already refers to different task contents');return{task:this.get(row.id),duplicate:true};}}
   const now=new Date().toISOString();
   const task={id:randomUUID(),status:'queued',created_at:now,updated_at:now,spec,profile,profile_name:profileName,provider_mode:provider,model_history:[{at:now,revision:1,...modelInfo(profile,profileName,provider)}],run_id:0,revision:1,messages:[],input_revisions:[],checkpoints:[],usage:{model_calls:0,input_tokens:0,output_tokens:0,tokens:0,unknown_calls:0,unknown_reserved_tokens:0},repairs:0};
   this.db.prepare('INSERT INTO tasks(id,request_id,digest,body,request_digest) VALUES(?,?,?,?,?)').run(task.id,spec.request_id??null,digest,JSON.stringify(task),request_digest??null);
   this.event(task,'task.queued',{goal:spec.goal,model_info:modelInfo(profile,profileName,provider)});return{task,duplicate:false};
  });
 }
 get(id){const row=this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id);if(!row)throw new DengError('NOT_FOUND','Task not found');return JSON.parse(row.body);}
 list(){return this.db.prepare('SELECT body FROM tasks ORDER BY rowid').all().map(r=>JSON.parse(r.body));}
 save(task){task.updated_at=new Date().toISOString();this.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);this.emit('change');}
 event(task,type,payload={}){
  const event={task_id:task.id,run_id:task.run_id,timestamp:new Date().toISOString(),type,payload};
  const row=this.db.prepare('INSERT INTO events(task_id,body) VALUES(?,?)').run(task.id,JSON.stringify(event));this.emit('change');
  if(['task.completed','task.failed','task.input_required','task.state_changed'].includes(type))this.emit('task-notification',{task_id:task.id,type});return{...event,seq:Number(row.lastInsertRowid)};
 }
 saveEvent(task,type,payload={}){return this.transaction(()=>{this.save(task);return this.event(task,type,payload);});}
 events(id,after=0,limit=100){this.get(id);return this.db.prepare('SELECT seq,body FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT ?').all(id,after,Math.max(1,Math.min(500,limit))).map(r=>({...JSON.parse(r.body),seq:Number(r.seq)}));}
 operation(id){const row=this.db.prepare('SELECT body FROM operations WHERE id=?').get(id);return row?JSON.parse(row.body):undefined;}
 operations(taskId,kind){return this.db.prepare('SELECT body FROM operations WHERE task_id=?'+(kind?' AND kind=?':'')+' ORDER BY rowid').all(...(kind?[taskId,kind]:[taskId])).map(r=>JSON.parse(r.body));}
 saveOperation(op){op.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO operations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(op.id,op.task_id,op.kind,JSON.stringify(op));}
 reserveModel(taskId,callId,reserved,info){
  return this.transaction(()=>{
   if(this.operation(callId))throw new DengError('DUPLICATE_CALL','Model call already reserved');
   const task=this.get(taskId);task.usage.model_calls++;task.usage.tokens+=reserved;task.phase={name:'request_reserved',call_id:callId};
   this.saveOperation({id:callId,task_id:taskId,kind:'model',state:'reserved',reserved_tokens:reserved,model_info:info,created_at:new Date().toISOString()});
   this.save(task);this.event(task,'usage.reserved',{call_id:callId,reserved_tokens:reserved,model:info.model,model_info:info});return task;
  });
 }
 dispatchModel(taskId,callId){return this.transaction(()=>{const op=this.operation(callId);if(!op||op.state!=='reserved')throw new DengError('REPLAY_BLOCKED','Model call is not in the reserved state');op.state='dispatched';this.saveOperation(op);const task=this.get(taskId);if(task.status==='running'){task.phase={name:'model_generation',call_id:callId};this.save(task);}this.event(task,'usage.dispatched',{call_id:callId});});}
 settleModel(taskId,callId,usage,reportedModel){
  return this.transaction(()=>{
   const op=this.operation(callId);if(!op)throw new DengError('CALL_NOT_FOUND','Unknown model reservation');if(op.state==='settled')return this.get(taskId);
   const task=this.get(taskId),input=usage.prompt_tokens,output=usage.completion_tokens;
   if(![input,output].every(x=>Number.isSafeInteger(x)&&x>=0)||!Number.isSafeInteger(input+output))throw new DengError('USAGE_INVALID','Provider returned invalid usage counts');
   if(op.state==='unknown'){task.usage.unknown_reserved_tokens=Math.max(0,(task.usage.unknown_reserved_tokens??0)-op.reserved_tokens);if(!op.acknowledged_at)task.usage.unknown_calls=Math.max(0,task.usage.unknown_calls-1);}
   task.usage.tokens+=input+output-op.reserved_tokens;task.usage.input_tokens+=input;task.usage.output_tokens+=output;
   const cached=Math.max(0,Math.min(input,Number.isSafeInteger(usage.prompt_tokens_details?.cached_tokens)?usage.prompt_tokens_details.cached_tokens:0));
   const reasoning=Math.max(0,Math.min(output,Number.isSafeInteger(usage.completion_tokens_details?.reasoning_tokens)?usage.completion_tokens_details.reasoning_tokens:0));
   task.usage.cached_input_tokens=(task.usage.cached_input_tokens??0)+cached;task.usage.reasoning_output_tokens=(task.usage.reasoning_output_tokens??0)+reasoning;
   op.state='settled';op.usage={input_tokens:input,output_tokens:output,cached_tokens:cached,reasoning_tokens:reasoning};op.reported_model=reportedModel;this.saveOperation(op);this.save(task);
   this.event(task,'usage.settled',{call_id:callId,model_info:op.model_info,reported_model:reportedModel,...op.usage,cost:null});return task;
  });
 }
 unknownModel(taskId,callId,reason='response_unsettled'){
  return this.transaction(()=>{
   const op=this.operation(callId);if(!op||['unknown','settled'].includes(op.state))return this.get(taskId);
   const task=this.get(taskId);op.state='unknown';op.reason=reason;this.saveOperation(op);task.usage.unknown_calls++;task.usage.unknown_reserved_tokens=(task.usage.unknown_reserved_tokens??0)+op.reserved_tokens;this.save(task);
   this.event(task,'usage.unknown',{call_id:callId,model_info:op.model_info,reservation_retained:true,reserved_tokens:op.reserved_tokens,reason});return task;
  });
 }
 acknowledgeUnknown(task){
  for(const op of this.operations(task.id,'model')){if(op.state==='unknown'&&!op.acknowledged_at){op.acknowledged_at=new Date().toISOString();this.saveOperation(op);}}
  task.usage.acknowledged_unknown_calls=(task.usage.acknowledged_unknown_calls??0)+task.usage.unknown_calls;task.usage.unknown_calls=0;
 }
 beginCommand(task,command,signature,{call_id,acceptance=false}={}){
  return this.transaction(()=>{
   if(!command.replay_safe&&this.operations(task.id,'command').some(o=>o.signature===signature&&o.state==='unknown'&&!o.acknowledged_at))throw new DengError('COMMAND_OUTCOME_UNKNOWN','A previous invocation has an unknown outcome. Inspect it and explicitly acknowledge before replaying; no command was started.');
   const op={id:randomUUID(),task_id:task.id,kind:'command',state:'planned',signature,command,call_id,acceptance,created_at:new Date().toISOString()};this.saveOperation(op);this.event(this.get(task.id),'command.planned',{operation_id:op.id,tool_call_id:call_id,argv:command.argv,cwd:command.cwd});return op.id;
  });
 }
 startCommand(id,pid){this.transaction(()=>{const op=this.operation(id);op.state='started';op.pid=pid;this.saveOperation(op);this.event(this.get(op.task_id),'command.started',{operation_id:id,pid:pid??null});});}
 endCommand(id,value){this.transaction(()=>{const op=this.operation(id);op.state='completed';op.outcome={code:value.code,signal:value.signal,timed_out:value.timed_out,executed:value.executed??true};this.saveOperation(op);this.event(this.get(op.task_id),'command.settled',{operation_id:id,...op.outcome});});}
 recover(){
  for(const initial of this.list())this.transaction(()=>{
   for(const op of this.operations(initial.id)){
    if(op.kind==='model'&&['reserved','dispatched'].includes(op.state))this.unknownModel(initial.id,op.id,'engine_interrupted');
    else if(op.kind==='command'&&['planned','started'].includes(op.state)){op.state='unknown';op.reason='engine_interrupted';this.saveOperation(op);this.event(this.get(initial.id),'command.unknown',{operation_id:op.id,signature:op.signature});}
   }
   let task=this.get(initial.id);
   const unsettled=Math.max(0,task.usage.tokens-task.usage.input_tokens-task.usage.output_tokens-(task.usage.unknown_reserved_tokens??0));
   if(unsettled>0){const id='legacy-unsettled-'+task.id;this.saveOperation({id,task_id:task.id,kind:'model',state:'reserved',reserved_tokens:unsettled,legacy:true});this.unknownModel(task.id,id,'legacy_reservation_recovery');task=this.get(task.id);}
   if(['running','pausing','cancelling'].includes(task.status)){task.status='interrupted';task.error={code:'INTERRUPTED',message:'Engine exited; inspect unsettled requests and command outcomes before resuming'};this.saveEvent(task,'task.state_changed',{status:task.status});}
  });
 }
 view(task){
  const{spec,messages,profile,result,acceptance,...view}=task;
  const unknownCommands=this.operations(task.id,'command').filter(o=>o.state==='unknown'&&!o.acknowledged_at);
  return{...view,usage_accounting:usageBreakdown(task.usage),goal:spec.goal,model:profile.model,model_info:modelInfo(profile,task.profile_name,task.provider_mode),budget:spec.budget,effective_isolation:spec.scope.commands.length||spec.acceptance.commands.length?task.effective_isolation:'file-tools',unknown_command_count:unknownCommands.length,result_ref:task.result?{task_id:task.id,read_tool:'read_artifact'}:undefined,result_summary:result?{summary:result.summary,limitations:result.limitations??[]}:undefined,acceptance:acceptance?{passed:acceptance.passed,semantic:acceptance.semantic,checks:acceptance.checks.map(({output,...c})=>c)}:undefined,checkpoints:task.checkpoints.slice(-5),input_revisions:task.input_revisions.map(i=>({revision:i.revision,at:i.at,type:i.type??'resume'}))};
 }
 close(){this.db.close();}
}
