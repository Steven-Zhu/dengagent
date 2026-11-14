import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,mkdir,symlink,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.mjs';
import { hash } from '../src/store.mjs';
import { workspacePath } from '../src/paths.mjs';
import { environment,completion,until } from './helpers.mjs';

test('Pi native tools write a candidate, fixed tests execute, public text is streamed and usage settles',async t=>{
  const{root,config}=await environment(t);await mkdir(join(root,'src'));await mkdir(join(root,'test'));
  await writeFile(join(root,'test','feature.test.mjs'),`import assert from 'node:assert/strict';import {add} from '../src/add.mjs';assert.equal(add(2,3),5);`);
  const command={argv:['node','--test','test/feature.test.mjs'],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}= (await engine.submit({goal:'Implement add and pass the fixed addition test',scope:{read:['.'],write:['src'],commands:[command]},acceptance:{commands:[command],required_files:['src/add.mjs']},offline_script:[
    {name:'write_file',arguments:{path:'src/add.mjs',content:'export const add=(a,b)=>a+b;\n'}},
    {name:'finish_task',arguments:{summary:'OFFLINE implementation fixture',output:{file:'src/add.mjs'}}},
  ]})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed');assert.equal(task.acceptance.checks.at(-1).code,0);
  assert.equal(task.usage.model_calls,2);assert.equal(task.usage.tokens,300);assert.equal(task.usage.unknown_calls,0);
  const events=engine.store.events(id,0,500);assert.ok(events.some(event=>event.type==='model.text_delta'));assert.ok(events.some(event=>event.type==='file.changed'));
  assert.ok(events.findIndex(event=>event.type==='model.text_delta')<events.findIndex(event=>event.type==='task.completed'));
  assert.equal(engine.get(id).result,undefined);assert.ok(engine.get(id).result_ref);
});

test('fixed acceptance failure cannot be overridden by worker success text',async t=>{
  const{config}=await environment(t);const command={argv:['node','-e','process.exit(7)'],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'A fixture claiming success must still fail the actual acceptance',scope:{read:['.'],write:[],commands:[]},acceptance:{commands:[command]},budget:{max_repair_rounds:0},offline_script:[{name:'finish_task',arguments:{summary:'All tests passed (deliberately false fixture)'}}]})).task;
  const task=await completion(engine,id);assert.equal(task.status,'failed');assert.equal(task.error.code,'ACCEPTANCE_FAILED');assert.equal(task.acceptance.checks[0].code,7);
});

test('call budget stops the Pi loop before an extra model request',async t=>{
  const{root,config}=await environment(t);await writeFile(join(root,'input.txt'),'source');const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Read a file then finish within a one-call budget',budget:{max_model_calls:1},offline_script:[{name:'read_file',arguments:{path:'input.txt'}}]})).task;
  const task=await completion(engine,id);assert.equal(task.status,'budget_exceeded');assert.equal(task.usage.model_calls,1);
});

test('failed fixed tests trigger a bounded repair and are re-executed unchanged',async t=>{
  const{root,config}=await environment(t);await mkdir(join(root,'src'));
  const command={argv:['node','-e',`import('./src/value.mjs').then(m=>{if(m.value!==42)process.exit(8)})`],cwd:'.'};
  const bad='export const value=0;\n';const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Repair after an actual fixed test failure',scope:{read:['.'],write:['src']},acceptance:{commands:[command]},budget:{max_repair_rounds:1},offline_script:[
    {name:'write_file',arguments:{path:'src/value.mjs',content:bad}},
    {name:'finish_task',arguments:{summary:'Initial deliberately incorrect fixture'}},
    {name:'write_file',arguments:{path:'src/value.mjs',content:'export const value=42;\n',expected_sha256:hash(bad)}},
    {name:'finish_task',arguments:{summary:'Repaired fixture'}},
  ]})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed');assert.equal(task.repairs,1);
  const checks=engine.store.events(id,0,500).filter(event=>event.type==='acceptance.completed');assert.equal(checks.length,2);assert.equal(checks[0].payload.checks[0].code,8);assert.equal(checks[1].payload.checks[0].code,0);
});

test('path traversal, symlinks, private files and task scopes are enforced',async t=>{
  const{root,config}=await environment(t);await mkdir(join(root,'allowed'));await symlink('/tmp',join(root,'allowed','link'));
  const task={spec:{scope:{read:['allowed'],write:['allowed']}}};
  for(const path of ['../outside','allowed/link/file','.env','.git/config','settings.json','.dengagent/tasks.sqlite'])await assert.rejects(workspacePath(config,task,path),/scope|protected|Symlink/i);
  assert.equal(await workspacePath(config,task,'allowed/new.txt',true),join(root,'allowed','new.txt'));
});

test('stale file hashes prevent unintended overwrites',async t=>{
  const{root,config}=await environment(t);await writeFile(join(root,'target.txt'),'user changed it');const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Attempt a stale edit without overwriting user changes',scope:{read:['.'],write:['target.txt']},offline_script:[
    {name:'write_file',arguments:{path:'target.txt',content:'lost update',expected_sha256:hash('old content')}},
    {name:'finish_task',arguments:{summary:'Fixture continues after rejected write'}},
  ]})).task;
  await completion(engine,id);assert.equal(await readFile(join(root,'target.txt'),'utf8'),'user changed it');
  assert.ok(engine.store.events(id,0,500).some(event=>event.type==='tool.completed'&&event.payload.is_error));
});

test('pause terminates a running process, then resume keeps history and budget',async t=>{
  const{root,config}=await environment(t);
  const command={argv:['node','-e',`process.stdout.write('process-is-running');setTimeout(()=>require('fs').writeFileSync('late-write.txt','bad'),2500);setTimeout(()=>{},60000);`],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Pause a long-running process and resume at a confirmed tool boundary',scope:{read:['.'],write:['.'],commands:[command]},offline_script:[
    {name:'run_command',arguments:command},{name:'finish_task',arguments:{summary:'OFFLINE resumed fixture; interrupted command not claimed successful'}},
  ]})).task;
  await until(()=>engine.store.events(id,0,500).some(event=>event.type==='tool.output'&&event.payload.text.includes('process-is-running')));
  const before=engine.store.get(id).usage.model_calls;
  const paused=await engine.control(id,'pause');assert.equal(paused.status,'paused');assert.equal(engine.runner.active.size,0);
  await delay(2700);await assert.rejects(stat(join(root,'late-write.txt')),{code:'ENOENT'});
  await engine.control(id,'resume',{input:'The stopped command was interrupted; retain that limitation.'});
  const task=await completion(engine,id);assert.equal(task.status,'completed');assert.equal(task.run_id,2);assert.ok(task.usage.model_calls>before);assert.equal(task.spec.budget.max_model_calls,config.budget.max_model_calls);
  assert.ok(task.messages.some(message=>message.role==='toolResult'&&message.toolName==='run_command'));
});

test('cancel is terminal and request_id is deduplicated with content conflict detection',async t=>{
  const{config}=await environment(t);const engine=new Engine(config);t.after(()=>engine.close());
  const spec={goal:'Deduplicate a fixture task before it executes',request_id:'same-request'};
  const first=await engine.submit(spec);const duplicate=await engine.submit(spec);assert.equal(first.task.id,duplicate.task.id);assert.equal(duplicate.duplicate,true);
  await assert.rejects(engine.submit({...spec,goal:'Different task with the same request ID'}),{code:'IDEMPOTENCY_CONFLICT'});
  const cancelled=await engine.control(first.task.id,'cancel');assert.equal(cancelled.status,'cancelled');
  assert.equal((await engine.control(first.task.id,'resume')).status,'cancelled');
});

test('request_input pauses for a decision and persists across engine restart',async t=>{
  const{config}=await environment(t);let engine=new Engine(config);
  const{id}=(await engine.submit({goal:'Ask for a product decision, then resume after a restart',offline_script:[{name:'request_input',arguments:{question:'Which output format?'}},{name:'finish_task',arguments:{summary:'OFFLINE after decision'}}]})).task;
  assert.equal((await completion(engine,id)).status,'waiting_input');await engine.close();engine=new Engine(config);t.after(()=>engine.close());
  assert.equal(engine.get(id).input_required.question,'Which output format?');await engine.control(id,'resume',{input:'Use JSON.'});assert.equal((await completion(engine,id)).status,'completed');
});

test('test processes do not inherit supplier credentials',async t=>{
  const{config}=await environment(t);const name='TENCENT_TOKENHUB_API_KEY';const previous=process.env[name];process.env[name]='not-for-child-processes';
  t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
  const command={argv:['node','-e',`if(process.env.${name})process.exit(33);console.log('credential absent')`],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());const{id}=(await engine.submit({goal:'Check child environment isolation from model credentials',acceptance:{commands:[command]}})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed');assert.match(task.acceptance.checks[0].output,/credential absent/);
});
