import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Engine} from '../src/engine.mjs';
import {environment,completion,until} from './helpers.mjs';
import {hash} from '../src/store.mjs';
import {probeModel} from '../src/probe.mjs';
import {usageBreakdown,WRITE_CHUNK_LIMIT} from '../src/protocol.mjs';

const malformed=await readFile(new URL('./fixtures/dsml-unexecuted.txt',import.meta.url),'utf8');
function stream(response,{text='',tool,broken=false,usage=true}={}){
 response.writeHead(200,{'content-type':'text/event-stream','x-request-id':'12345678-abcd-abcd-abcd-123456789abc'});
 const frame=delta=>response.write('data: '+JSON.stringify({model:'fixture',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
 if(text){const at=Math.floor(text.length/2);frame({content:text.slice(0,at)});frame({content:text.slice(at)});}
 if(tool)frame({tool_calls:[{index:0,id:'fixture-'+tool.name,type:'function',function:{name:tool.name,arguments:broken?'{"path":"work/partial':JSON.stringify(tool.args)}}]});
 response.write('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:broken?'length':tool?'tool_calls':'stop'}]})+'\n\n');
 if(usage)response.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:25}})+'\n\n');
 response.end('data: [DONE]\n\n');
}
async function live(t,handler,overrides={}){
 const requests=[];const server=http.createServer(async(req,res)=>{
  const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts));requests.push(body);
  await handler(body,res,requests.length);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const {profile:profileOverrides,...configOverrides}=overrides;
 const env=await environment(t,{provider:'compatible',...configOverrides,models:{default:'worker',profiles:{worker:{...overrides.profile,base_url:'http://127.0.0.1:'+server.address().port+'/v1',model:overrides.profile?.model??'fixture',api_key_env:'DENG_RECOVERY_PRIVATE_KEY'}}}});
 const old=process.env.DENG_RECOVERY_PRIVATE_KEY;process.env.DENG_RECOVERY_PRIVATE_KEY='fake-fixture-key';
 t.after(()=>{if(old===undefined)delete process.env.DENG_RECOVERY_PRIVATE_KEY;else process.env.DENG_RECOVERY_PRIVATE_KEY=old;});
 const engine=new Engine(env.config);t.after(()=>engine.close());return {...env,engine,requests};
}
const taskSpec={goal:'Exercise a small native tool workflow without executing text markup',scope:{read:['work'],write:['work']}};
const finish={name:'finish_task',args:{summary:'Fixture validated'}};

test('sanitized incident text is detected, never executed, and stops after one bounded protocol repair',async t=>{
 const{root,engine,requests}=await live(t,(_body,res)=>stream(res,{text:malformed}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;const done=await completion(engine,id);
 assert.equal(done.status,'waiting_input');assert.equal(done.error.code,'TOOL_PROTOCOL_MISMATCH');assert.equal(requests.length,2);assert.equal(done.protocol_repairs,1);
 assert.equal(done.last_model_response.provider_tool_deltas,0);assert.equal(done.last_model_response.provider_text_deltas,2);assert.equal(done.last_model_response.protocol_marker,true);
 assert.equal(done.last_model_response.request_id,'12345678-abcd-abcd-abcd-123456789abc');
 assert.equal(done.recovery_history.length,2);assert.equal(done.usage.tokens,250);
 assert.ok(!engine.store.events(id,0,500).some(e=>e.type==='tool.started'||e.type==='file.changed'));
 await assert.rejects(stat(join(root,'work/result.txt')),{code:'ENOENT'});
 assert.ok(!JSON.stringify(engine.store.events(id,0,500)).includes('fake-fixture-key'));
});

test('length then DSML text preserves the full recovery chain, completed hashes, budgets and original task',async t=>{
 const{root,engine,requests}=await live(t,(_body,res,n)=>{
  if(n===1)stream(res,{tool:{name:'write_file',args:{path:'work/result.txt',content:'kept\n'}}});
  else if(n===2)stream(res,{tool:{name:'append_file'},broken:true});
  else stream(res,{text:malformed});
 });await mkdir(join(root,'work'));
 const initial=(await engine.submit({...taskSpec,budget:{max_repair_rounds:2}})).task;
 const done=await completion(engine,initial.id);
 assert.equal(done.status,'waiting_input');assert.equal(done.error.code,'TOOL_PROTOCOL_MISMATCH');assert.equal(done.id,initial.id);
 assert.deepEqual(done.recovery_history.map(x=>x.code),['OUTPUT_TRUNCATED','TOOL_PROTOCOL_MISMATCH','TOOL_PROTOCOL_MISMATCH']);
 assert.equal(done.last_failure_reason.code,'TOOL_PROTOCOL_MISMATCH');
 assert.equal(await readFile(join(root,'work/result.txt'),'utf8'),'kept\n');
 assert.equal(done.changes['work/result.txt'].after,hash('kept\n'));assert.equal(done.repairs,2);
 assert.equal(done.created_at,initial.created_at);assert.deepEqual(done.spec.budget,initial.budget);assert.equal(requests.length,4);
 const recovery=requests[2].messages.filter(m=>m.role==='user').at(-1).content;
 assert.ok(JSON.stringify(recovery).includes(hash('kept\n')));
 assert.equal(engine.store.list().length,1);
});

test('valid native write, append, finish and fixed command checks still complete after protocol repair',async t=>{
 const{root,engine,requests}=await live(t,(_body,res,n)=>{
  if(n===1)stream(res,{text:malformed});
  else if(n===2)stream(res,{tool:{name:'write_file',args:{path:'work/result.txt',content:'one\n'}}});
  else if(n===3)stream(res,{tool:{name:'append_file',args:{path:'work/result.txt',content:'two\n',expected_sha256:hash('one\n')}}});
  else stream(res,{tool:finish});
 });await mkdir(join(root,'work'));
 const check={argv:['node','-e',"if(require('fs').readFileSync('result.txt','utf8')!=='one\\ntwo\\n')process.exit(9)"],cwd:'work'};
 const initial=(await engine.submit({...taskSpec,acceptance:{required_files:['work/result.txt'],commands:[check]}})).task;
 const done=await completion(engine,initial.id);assert.equal(done.status,'completed');assert.equal(done.acceptance.passed,true);assert.equal(requests.length,4);
 assert.equal(done.usage.tokens,500);assert.equal(done.repairs,1);assert.equal(done.last_failure_reason.code,'TOOL_PROTOCOL_MISMATCH');
 assert.equal(done.recovery_history.length,1);assert.equal(done.last_model_response.provider_tool_deltas,1);
});

test('a native call sharing a response with protocol text is also rejected as an entire untrusted response',async t=>{
 const{root,engine}=await live(t,(_body,res)=>stream(res,{text:malformed,tool:{name:'write_file',args:{path:'work/result.txt',content:'bad'}}}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit({...taskSpec,budget:{max_repair_rounds:0}})).task;
 assert.equal((await completion(engine,id)).error.code,'TOOL_PROTOCOL_MISMATCH');
 await assert.rejects(stat(join(root,'work/result.txt')),{code:'ENOENT'});
});

test('ordinary stop without finish_task gets one bounded repair and a specific resumable reason',async t=>{
 const{root,engine,requests}=await live(t,(_body,res)=>stream(res,{text:'I will do it soon.'}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;const done=await completion(engine,id);
 assert.equal(done.status,'waiting_input');assert.equal(done.error.code,'MISSING_FINISH_TASK');assert.equal(requests.length,2);assert.equal(done.usage.tokens,250);
});

test('HTTP 401 keeps its exact failure class, safe correlation ID and unknown reservation without retry',async t=>{
 const{engine,requests}=await live(t,(_body,res)=>{res.writeHead(401,{'x-request-id':'12345678-abcd-abcd-abcd-123456789abc'});res.end('private-body-must-not-leak');});
 const{id}=(await engine.submit({goal:'Preserve actionable HTTP authentication failure'})).task;const done=await completion(engine,id);
 assert.equal(done.status,'failed');assert.equal(done.error.code,'UPSTREAM_HTTP');assert.match(done.error.message,/401/);assert.equal(requests.length,1);
 const accounting=engine.get(id).usage_accounting;assert.equal(accounting.settled_tokens,0);assert.equal(accounting.in_flight_reserved_tokens,0);assert.ok(accounting.unknown_reserved_tokens>0);
 assert.equal(accounting.accounted_tokens,done.usage.tokens);assert.equal(done.usage.unknown_calls,1);
 assert.ok(!JSON.stringify(engine.store.events(id,0,500)).includes('private-body-must-not-leak'));
 assert.equal(done.last_model_response.http_status,401);
});

test('protocol mismatch with missing usage makes no repair request or automatic usage acknowledgment',async t=>{
 const{root,engine,requests}=await live(t,(_body,res)=>stream(res,{text:malformed,usage:false}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;const done=await completion(engine,id);
 assert.equal(done.status,'waiting_input');assert.equal(requests.length,1);assert.equal(done.repairs,0);assert.equal(done.usage.unknown_calls,1);
 await until(()=>!engine.active);await assert.rejects(engine.control(id,'resume'),{code:'USAGE_UNKNOWN'});
 assert.equal(engine.get(id).usage_accounting.unknown_reserved_tokens,done.usage.tokens);
});

test('command cwd failures identify scope/acceptance fields and never create a task or call a model',async t=>{
 const{root,config}=await environment(t);await mkdir(join(root,'work'));const engine=new Engine(config);t.after(()=>engine.close());
 const command={argv:['node','-e','process.exit(0)'],cwd:'.'};
 for(const field of ['scope','acceptance']){
  const raw={...taskSpec,[field]:field==='scope'?{...taskSpec.scope,commands:[command]}:{commands:[command]}};
  await assert.rejects(engine.submit(raw),e=>e.code==='COMMAND_CWD_SCOPE'&&e.message.includes(field+'.commands[0].cwd'));
 }
 assert.equal(engine.store.list().length,0);
 const ok=(await engine.submit({...taskSpec,acceptance:{commands:[{...command,cwd:'work'}]}})).task;
 assert.equal((await completion(engine,ok.id)).status,'completed');
});

test('command events distinguish exit failure, stderr-only warning, timeout and signal termination',async t=>{
 for(const kind of ['failure','warning','timeout','signal']){
  const{config}=await environment(t,{tools:{isolation:'host',command_timeout_ms:kind==='timeout'?150:5000}});
  const code=kind==='failure'?"process.exit(7)":kind==='warning'?"console.error('non-fatal warning')":kind==='timeout'?"setTimeout(()=>{},60000)":"process.kill(process.pid,'SIGTERM')";
  const command={argv:['node','-e',code],cwd:'.'};const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Inspect actual command outcome '+kind,scope:{read:['.'],commands:[command]},offline_script:[{name:'run_command',arguments:command},{name:'finish_task',arguments:{summary:'Command result inspected'}}]})).task;
  await completion(engine,id);
  const events=engine.store.events(id,0,500),event=events.find(e=>e.type==='command.completed'),tool=events.find(e=>e.type==='tool.completed'&&e.payload.name==='run_command');
  assert.ok(event);assert.equal(event.payload.replay_safe,false);assert.equal(tool.payload.is_error,kind!=='warning');
  assert.equal(tool.payload.command_code,kind==='failure'?7:kind==='warning'?0:null);
  assert.equal(tool.payload.timed_out,kind==='timeout');assert.equal(Boolean(tool.payload.signal),['timeout','signal'].includes(kind));
  assert.equal(events.filter(e=>e.type==='tool.started'&&e.payload.name==='run_command').length,1);
 }
});

test('one chunk limit governs write, append and edits; scoped listing needs no shell permission',async t=>{
 const{root,config}=await environment(t,{budget:{max_no_progress_calls:5}});await mkdir(join(root,'work'));await writeFile(join(root,'work/kept.txt'),'unchanged');
 const engine=new Engine(config);t.after(()=>engine.close());
 const{id}=(await engine.submit({...taskSpec,budget:{max_no_progress_calls:5},offline_script:[
  {name:'write_file',arguments:{path:'work/too-large.txt',content:'x'.repeat(WRITE_CHUNK_LIMIT+1)}},
  {name:'append_file',arguments:{path:'work/kept.txt',content:'x'.repeat(WRITE_CHUNK_LIMIT+1),expected_sha256:hash('unchanged')}},
  {name:'edit_file',arguments:{path:'work/kept.txt',old_text:'unchanged',new_text:'x'.repeat(WRITE_CHUNK_LIMIT+1),expected_sha256:hash('unchanged')}},
  {name:'list_files',arguments:{path:'work'}},
  {name:'finish_task',arguments:{summary:'Rejected oversized writes; listed scoped directory'}},
 ]})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed');assert.equal(await readFile(join(root,'work/kept.txt'),'utf8'),'unchanged');
 await assert.rejects(stat(join(root,'work/too-large.txt')),{code:'ENOENT'});
 assert.equal(engine.store.events(id,0,500).filter(e=>e.type==='tool.completed'&&e.payload.is_error).length,3);
 const listed=done.messages.find(m=>m.role==='toolResult'&&m.toolName==='list_files');assert.match(JSON.stringify(listed),/kept.txt/);
});

test('cancel during a recovery response aborts before any late native write can execute',async t=>{
 let announce;const started=new Promise(resolve=>announce=resolve);
 const{root,engine,requests}=await live(t,async(_body,res,n)=>{
  if(n===1)return stream(res,{text:malformed});
  announce();await delay(500);if(!res.destroyed)stream(res,{tool:{name:'write_file',args:{path:'work/late.txt',content:'bad'}}});
 });await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;await started;
 const before=engine.get(id);const cancelled=await engine.control(id,'cancel');assert.equal(cancelled.status,'cancelled');
 await delay(600);await assert.rejects(stat(join(root,'work/late.txt')),{code:'ENOENT'});
 assert.equal(requests.length,2);assert.equal(engine.get(id).budget.max_model_calls,before.budget.max_model_calls);
 assert.equal(engine.runner.active.size,0);
});

test('legacy unknown reservations and explicit new accounting remain separate from settled usage',()=>{
 assert.deepEqual(usageBreakdown({input_tokens:10,output_tokens:5,tokens:1015,unknown_calls:1}),{settled_tokens:15,in_flight_reserved_tokens:0,unknown_reserved_tokens:1000,accounted_tokens:1015});
 assert.deepEqual(usageBreakdown({input_tokens:10,output_tokens:5,tokens:1515,unknown_reserved_tokens:1000}),{settled_tokens:15,in_flight_reserved_tokens:500,unknown_reserved_tokens:1000,accounted_tokens:1515});
});

test('user-level doctor probe uses an isolated project rather than submitting to the settings engine',async t=>{
 const{config}=await environment(t);const result=await probeModel({...config,scope:'global'});
 assert.equal(result.passed,true);assert.equal(result.native_tool_roundtrip,true);assert.equal(result.provider,'offline');
 assert.equal(result.usage_accounting.settled_tokens,300);
});

test('pause during protocol recovery preserves the checkpoint, and explicit resume never replays the aborted write',async t=>{
 let announce;const started=new Promise(resolve=>announce=resolve);
 const{root,engine,requests}=await live(t,async(_body,res,n)=>{
  if(n===1)return stream(res,{text:malformed});
  if(n>2)return stream(res,{tool:finish});
  announce();await delay(400);if(!res.destroyed)stream(res,{tool:{name:'write_file',args:{path:'work/late.txt',content:'bad'}}});
 });await mkdir(join(root,'work'));
 const initial=(await engine.submit(taskSpec)).task;await started;
 const paused=await engine.control(initial.id,'pause');assert.equal(paused.status,'paused');
 await delay(500);await assert.rejects(stat(join(root,'work/late.txt')),{code:'ENOENT'});
 const before=engine.get(initial.id);assert.equal(before.usage.unknown_calls,1);
 await assert.rejects(engine.control(initial.id,'resume'),{code:'USAGE_UNKNOWN'});
 await engine.control(initial.id,'resume',{allow_unknown_usage:true,input:'Acknowledge retained fixture reservation; continue without replaying the aborted write.'});
 const done=await completion(engine,initial.id);assert.equal(done.status,'completed');assert.equal(requests.length,3);
 assert.equal(done.created_at,initial.created_at);assert.deepEqual(done.spec.budget,initial.budget);assert.equal(done.repairs,before.repairs);
 assert.ok(done.usage.tokens>before.usage.tokens);assert.ok(engine.get(initial.id).usage_accounting.unknown_reserved_tokens>0);
 await assert.rejects(stat(join(root,'work/late.txt')),{code:'ENOENT'});
});

test('truncation changes execution strategy, lowers cap/effort, keeps budget and executes a minimal slice',async t=>{
 const{root,engine,requests}=await live(t,(_body,res,n)=>{
  if(n===1)stream(res,{tool:{name:'write_file'},broken:true});
  else if(n===2)stream(res,{tool:{name:'write_file',args:{path:'work/result.txt',content:'minimal'}}});
  else stream(res,{tool:finish});
 },{profile:{reasoning_effort:'high'}});await mkdir(join(root,'work'));
 const initial=(await engine.submit(taskSpec)).task,done=await completion(engine,initial.id);
 assert.equal(done.status,'completed');assert.equal(requests[0].max_tokens,32768);
 assert.equal(requests[0].reasoning_effort,'high');
 assert.equal(requests[1].max_tokens,8192);assert.equal(requests[1].reasoning_effort,'low');
 assert.match(JSON.stringify(requests[1].messages),/smallest runnable slice/);
 assert.deepEqual(done.spec.budget,initial.budget);
 assert.equal(await readFile(join(root,'work/result.txt'),'utf8'),'minimal');
});

test('read-only tool loops stop at no-progress limit, and resume needs narrowed input',async t=>{
 const{root,engine,requests}=await live(t,(_body,res)=>stream(res,{tool:{name:'list_files',args:{path:'work'}}}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit({...taskSpec,budget:{max_no_progress_calls:3}})).task;
 const done=await completion(engine,id);assert.equal(done.status,'waiting_input');assert.equal(done.error.code,'NO_PROGRESS');assert.equal(requests.length,4); // First distinct directory observation is bounded discovery.
 await until(()=>!engine.active);await assert.rejects(engine.control(id,'resume'),{code:'NO_PROGRESS'});
});

test('oversized tool argument failures are bounded without echoing code into future requests or checkpoints',async t=>{
 const payload='SENSITIVE_CODE_SENTINEL'+'x'.repeat(WRITE_CHUNK_LIMIT+1);
 const{root,engine,requests}=await live(t,(_body,res,n)=>stream(res,{tool:n===1?{name:'append_file',args:{path:'work/a',content:payload,expected_sha256:'missing'}}:finish}));await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;const done=await completion(engine,id);
 assert.equal(done.status,'completed');
 const result=requests[1].messages.find(m=>m.role==='tool').content;
 assert.match(JSON.stringify(result),new RegExp(String(WRITE_CHUNK_LIMIT)));assert.ok(!JSON.stringify(result).includes('SENSITIVE_CODE_SENTINEL'));assert.ok(JSON.stringify(result).length<700);
 const stored=done.messages.find(m=>m.role==='toolResult'&&m.isError);assert.ok(!JSON.stringify(stored).includes('SENSITIVE_CODE_SENTINEL'));
});

test('fragmented SSE native calls preserve mandatory reasoning history and native pairing',async t=>{
 const{root,engine,requests}=await live(t,(body,res,n)=>{
  if(n===2)assert.equal(body.messages.filter(m=>m.role==='assistant').length,1,'mandatory execution chain must remain');
  if(n===3){const a=body.messages.filter(m=>m.role==='assistant');assert.equal(a.length,2);assert.equal(a[0].reasoning_content,'r'.repeat(24000));assert.equal(a[1].reasoning_content,'private-reasoning-2');}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=delta=>res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  emit({reasoning_content:n===1?'r'.repeat(24000):'private-reasoning-'+n});
  const name=n===1?'write_file':n===2?'append_file':'finish_task';
  const args=n===1?{path:'work/result.txt',content:'一'}:n===2?{path:'work/result.txt',content:'二',expected_sha256:hash('一')}:{summary:'Native protocol after compaction'};
  const text=JSON.stringify(args),at=Math.floor(text.length/2);
  emit({tool_calls:[{index:0,id:'fragment-'+n,type:'function',function:{name,arguments:text.slice(0,at)}}]});
  emit({tool_calls:[{index:0,function:{arguments:text.slice(at)}}]});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n');
  res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:25}})+'\n\n');res.end('data: [DONE]\n\n');
 },{profile:{model:'deepseek/deepseek-flash',context_window:96000,max_output_tokens:4096,thinking:'enabled'}});await mkdir(join(root,'work'));
 const{id}=(await engine.submit(taskSpec)).task;const done=await completion(engine,id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(requests.length,3);
 assert.equal(await readFile(join(root,'work/result.txt'),'utf8'),'一二');
 const publicEvents=JSON.stringify(engine.store.events(id,0,500));assert.ok(!publicEvents.includes('private-reasoning'));
 assert.ok(engine.store.events(id,0,500).some(e=>e.type==='model.request'&&e.payload.tool_count>0));
});
