import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Engine} from '../src/engine.mjs';
import {hash} from '../src/store.mjs';
import {waitTask} from '../src/wait.mjs';
import {checkProgress} from '../src/guardrails.mjs';
import {environment,completion,until} from './helpers.mjs';
const finish={name:'finish_task',arguments:{summary:'Bounded fixture completed'}};
const scope={read:['work'],write:['work']};

test('batch writes and appends commit with hashes in one roundtrip and retain file scopes',async t=>{
 const{root,config}=await environment(t);await mkdir(join(root,'work'));const engine=new Engine(config);t.after(()=>engine.close());
 const{id}=(await engine.submit({goal:'Write and append using bounded batches',scope,offline_script:[
  {name:'write_files',arguments:{files:[{path:'work/a',content:'a'.repeat(6000)},{path:'work/b',content:'b'}]}},
  {name:'write_files',arguments:{files:[{path:'work/b',content:'c',mode:'append',expected_sha256:hash('b')}]}},finish,
 ]})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed');assert.equal(done.usage.model_calls,3);
 assert.equal((await readFile(join(root,'work/a'),'utf8')).length,6000);assert.equal(await readFile(join(root,'work/b'),'utf8'),'bc');
 assert.equal(done.progress.revision,3);
});

test('batch preflight rejects scope, hash, duplicate aliases and aggregate limits before any write',async t=>{
 const{root,config}=await environment(t,{budget:{max_no_progress_calls:6}});await mkdir(join(root,'work'));const engine=new Engine(config);t.after(()=>engine.close());
 const{id}=(await engine.submit({goal:'Reject invalid batches without partial writes',scope,offline_script:[
  {name:'write_files',arguments:{files:[{path:'work/a',content:'good'},{path:'outside',content:'bad'}]}},
  {name:'write_files',arguments:{files:[{path:'work/a',content:'a'},{path:'work/./a',content:'b'}]}},
  {name:'write_files',arguments:{files:[...['a','b','c','d'].map(name=>({path:'work/'+name,content:'x'.repeat(16000)})),{path:'work/e',content:'x'}]}},finish,
 ]})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed');assert.equal(Object.keys(done.changes??{}).length,0);
 await assert.rejects(stat(join(root,'work/a')),{code:'ENOENT'});
});

test('milestones enforce order and final completion requires declared checks',async t=>{
 const{root,config}=await environment(t);await mkdir(join(root,'work'));const engine=new Engine(config);t.after(()=>engine.close());
 const command={argv:['node','-e',"if(require('fs').readFileSync('a','utf8')!=='ok')process.exit(2)"],cwd:'work'};
 const{id}=(await engine.submit({goal:'Build smallest artifact before final acceptance',scope,milestones:[{name:'one-frame',required_files:['work/a'],commands:[command]},{name:'short-clip',required_files:['work/a']}],offline_script:[
  finish,{name:'check_milestone',arguments:{name:'short-clip'}},
  {name:'write_file',arguments:{path:'work/a',content:'ok'}},
  {name:'check_milestone',arguments:{name:'one-frame'}},
  {name:'check_milestone',arguments:{name:'short-clip'}},finish,
 ]})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed');assert.equal(done.milestones['one-frame'].passed,true);
 assert.equal(done.milestones['short-clip'].passed,true);assert.equal(done.milestones['one-frame'].checks[1].code,0);
 assert.equal(engine.store.events(id,0,500).filter(e=>e.type==='tool.completed'&&e.payload.is_error).length,2);
 await assert.rejects(engine.submit({goal:'Reject milestone commands outside the read scope',scope,milestones:[{name:'bad',commands:[{...command,cwd:'.'}]}]}),e=>e.code==='COMMAND_CWD_SCOPE');
});

test('notification wait ignores logs, wakes at completion, and suppresses delivered notifications',async t=>{
 const{config}=await environment(t);const engine=new Engine(config);t.after(()=>engine.close());
 const{id}=(await engine.submit({goal:'Wait for compact meaningful state without extra inference',offline_script:[{name:'request_input',arguments:{question:'Hold'}}]})).task;
 await completion(engine,id);await until(()=>!engine.active);
 const first=await waitTask(engine,id,{timeout:100});assert.equal(first.notification.status,'waiting_input');assert.equal(first.model_calls,0);
 const calls=engine.get(id).usage.model_calls;
 const pending=waitTask(engine,id,{after:first.cursor,timeout:150});let woke=false;pending.then(()=>woke=true);
 engine.store.event(engine.store.get(id),'model.text_delta',{text:'progress noise'});await delay(30);assert.equal(woke,false);
 const task=engine.store.get(id);task.status='completed';engine.store.save(task);engine.store.event(task,'task.completed',{summary:'done'});
 const done=await pending;assert.equal(done.notification.status,'completed');assert.equal(done.timed_out,false);assert.equal(engine.get(id).usage.model_calls,calls);
 const quiet=await waitTask(engine,id,{after:done.cursor,timeout:10});assert.equal(quiet.notification,null);assert.equal(quiet.timed_out,true);
 assert.equal(engine.store.updates.listenerCount('change'),0);
});

test('disconnected waits remove listeners and never stop the task',async t=>{
 const{config}=await environment(t);const engine=new Engine(config);t.after(()=>engine.close());
 const{id}=(await engine.submit({goal:'Observe without interfering with user task'})).task;await completion(engine,id);
 const first=await waitTask(engine,id,{timeout:0}),controller=new AbortController();
 const wait=waitTask(engine,id,{after:first.cursor,timeout:200,signal:controller.signal});controller.abort();
 await assert.rejects(wait,{code:'STOPPED'});assert.equal(engine.get(id).status,'completed');assert.equal(engine.store.updates.listenerCount('change'),0);
});

test('new successful progress resets the guard; identical response observations do not count twice',()=>{
 const task={spec:{budget:{max_no_progress_calls:2}},last_model_response:{call_id:'a'}};
 checkProgress(task);checkProgress(task);assert.equal(task.progress_guard.consecutive,1);
 task.progress={revision:1};task.last_model_response={call_id:'b'};checkProgress(task);assert.equal(task.progress_guard.consecutive,0);
 task.last_model_response={call_id:'c'};checkProgress(task);task.last_model_response={call_id:'d'};
 assert.throws(()=>checkProgress(task),{code:'NO_PROGRESS'});
});


test('deleted files with expected hashes are not silently recreated, including batch preflight',async t=>{
 const{root,config}=await environment(t);await mkdir(join(root,'work'));await writeFile(join(root,'work/gone'),'old');const engine=new Engine(config);t.after(()=>engine.close());
 const command={argv:['node','-e',"require('fs').unlinkSync('gone')"],cwd:'work'};
 const{id}=(await engine.submit({goal:'Preserve deleted file conflict semantics',scope:{...scope,commands:[command]},offline_script:[
  {name:'run_command',arguments:command},
  {name:'write_file',arguments:{path:'work/gone',content:'new',expected_sha256:hash('old')}},
  {name:'write_files',arguments:{files:[{path:'work/untouched',content:'new'},{path:'work/gone',content:'new',expected_sha256:hash('old')}]}},finish,
 ]})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed');
 await assert.rejects(stat(join(root,'work/gone')),{code:'ENOENT'});await assert.rejects(stat(join(root,'work/untouched')),{code:'ENOENT'});
 assert.equal(engine.store.events(id,0,500).filter(e=>e.type==='tool.completed'&&e.payload.is_error).length,2);
});
