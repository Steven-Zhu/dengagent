import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine} from '../src/engine.mjs';
import {hash} from '../src/store.mjs';
import {commandIdentity} from '../src/process.mjs';
import {environment,completion,until} from './helpers.mjs';
const finish={name:'finish_task',arguments:{summary:'Product contract fixture verified'}};
const hold={name:'request_input',arguments:{question:'Fixture waiting'}};
const scope={read:['work'],write:['work']};
async function setup(t,overrides={}){const e=await environment(t,overrides);await mkdir(join(e.root,'work'));const engine=new Engine(e.config);t.after(()=>engine.close());return{...e,engine};}

test('idempotent original request survives default model and budget changes',async t=>{
 const{engine}=await setup(t);const spec={goal:'Keep original task identity',request_id:'stable',scope,offline_script:[hold,finish]};
 const first=await engine.submit(spec);await completion(engine,first.task.id);await until(()=>!engine.active);
 engine.config.budget.max_total_tokens--;engine.config.models.profiles.worker.model='changed-default';
 const retry=await engine.submit(spec);assert.equal(retry.duplicate,true);assert.equal(retry.task.id,first.task.id);assert.equal(retry.task.model,'offline-fixture');assert.equal(retry.task.usage.model_calls,1);
 await assert.rejects(engine.submit({...spec,goal:'Different request'}),{code:'IDEMPOTENCY_CONFLICT'});
});

test('legacy effective budgets use recorded requested overrides to recover idempotency',async t=>{
 const{engine}=await setup(t);const spec={goal:'Legacy retry with clipped budget',request_id:'legacy',budget:{max_total_tokens:999999999},scope,offline_script:[hold]};
 // Use a valid requested cap above the fixture configured limit.
 engine.config.budget.max_total_tokens=160000;spec.budget.max_total_tokens=500000;
 const first=await engine.submit(spec);await completion(engine,first.task.id);await until(()=>!engine.active);
 engine.store.db.prepare('UPDATE tasks SET request_digest=NULL WHERE id=?').run(first.task.id);engine.config.budget.max_total_tokens=320000;
 assert.equal((await engine.submit(spec)).task.id,first.task.id);
});

test('unsettled model reservations become unknown after recovery and cannot resume without acknowledgement',async t=>{
 const{engine}=await setup(t);const first=await engine.submit({goal:'Recover model reservation',scope,offline_script:[hold,finish]});await completion(engine,first.task.id);await until(()=>!engine.active);
 const task=engine.store.get(first.task.id);engine.store.reserveModel(task.id,'fixture-inflight',10000,{profile:'worker',model:'fixture'});engine.store.dispatchModel(task.id,'fixture-inflight');
 const running=engine.store.get(task.id);running.status='running';engine.store.save(running);engine.store.recover();
 const recovered=engine.get(task.id);assert.equal(recovered.status,'interrupted');assert.equal(recovered.usage.unknown_calls,1);assert.equal(recovered.usage_accounting.in_flight_reserved_tokens,0);assert.equal(recovered.usage_accounting.unknown_reserved_tokens,10000);
 await assert.rejects(engine.control(task.id,'resume',{input:'Finish'}),{code:'USAGE_UNKNOWN'});
 const reserved=recovered.usage.tokens;await engine.control(task.id,'resume',{input:'Finish',allow_unknown_usage:true});const done=await completion(engine,task.id);assert.equal(done.status,'completed');assert.ok(done.usage.tokens>=reserved);assert.equal(done.usage.unknown_reserved_tokens,10000);
});

test('settlement is idempotent and task/operation/event transactions roll back together',async t=>{
 const{engine}=await setup(t);const a=await engine.submit({goal:'Settle a single journal record',scope,offline_script:[hold]});await completion(engine,a.task.id);await until(()=>!engine.active);
 engine.store.reserveModel(a.task.id,'once',1000,{model:'fixture'});const one=engine.store.settleModel(a.task.id,'once',{prompt_tokens:10,completion_tokens:5});
 assert.equal(engine.store.settleModel(a.task.id,'once',{prompt_tokens:10,completion_tokens:5}).usage.tokens,one.usage.tokens);
 const before=engine.store.get(a.task.id);assert.throws(()=>engine.store.transaction(()=>{engine.store.reserveModel(a.task.id,'rollback',1000,{model:'fixture'});throw new Error('rollback');}));
 assert.equal(engine.store.operation('rollback'),undefined);assert.equal(engine.store.get(a.task.id).usage.tokens,before.usage.tokens);assert.ok(!engine.store.events(a.task.id,0,500).some(e=>e.payload.call_id==='rollback'));
});

test('unknown unsafe command outcomes require separate acknowledgement before replay',async t=>{
 const{engine}=await setup(t);const command={argv:['node','-e',"console.log('done')"],cwd:'work'};
 const a=await engine.submit({goal:'Recover command side effect state',scope:{...scope,commands:[command]},offline_script:[hold,finish]});await completion(engine,a.task.id);await until(()=>!engine.active);
 const task=engine.store.get(a.task.id),id=engine.store.beginCommand(task,command,commandIdentity(command));engine.store.startCommand(id,12345);task.status='running';engine.store.save(task);engine.store.recover();
 assert.equal(engine.store.operation(id).state,'unknown');await assert.rejects(engine.control(task.id,'resume',{input:'Continue'}),{code:'COMMAND_OUTCOME_UNKNOWN'});
 await engine.control(task.id,'resume',{input:'Finish only',allow_unknown_commands:true});assert.equal((await completion(engine,task.id)).status,'completed');assert.ok(engine.store.operation(id).acknowledged_at);
});

test('authorized per-command timeout survives a shorter global default; runtime cannot enlarge it',async t=>{
 const{engine}=await setup(t,{tools:{isolation:'host',command_timeout_ms:100,max_command_timeout_ms:1000}});
 const command={argv:['node','-e',"setTimeout(()=>console.log('finished'),200)"],cwd:'work',timeout_ms:700,replay_safe:true};
 const a=await engine.submit({goal:'Allow bounded long command policy',scope:{...scope,commands:[command]},offline_script:[{name:'run_command',arguments:{argv:command.argv,cwd:'work'}},finish]});
 const done=await completion(engine,a.task.id);assert.equal(done.status,'completed');const op=engine.store.operations(done.id,'command')[0];assert.equal(op.state,'completed');assert.equal(op.outcome.code,0);
 await assert.rejects(engine.runner.run(done,{...command,timeout_ms:900},new AbortController().signal),{code:'COMMAND_SCOPE'});
 await assert.rejects(engine.submit({goal:'Reject above ceiling',scope:{...scope,commands:[{...command,timeout_ms:1001}]}}),{code:'COMMAND_TIMEOUT_SCOPE'});
});

test('artifact changes during final acceptance invalidate a candidate',async t=>{
 const{engine,root}=await setup(t);await writeFile(join(root,'work/a'),'before');
 const command={argv:['node','-e',"require('fs').writeFileSync('a','after')"],cwd:'work'};
 const a=await engine.submit({goal:'Detect changed delivery during acceptance',scope,acceptance:{required_files:['work/a'],commands:[command]},budget:{max_repair_rounds:0},offline_script:[finish]});
 const done=await completion(engine,a.task.id);assert.equal(done.status,'failed');assert.ok(done.acceptance.checks.some(c=>c.code==='ARTIFACT_CHANGED_DURING_ACCEPTANCE'));assert.equal(done.delivery,undefined);
});

test('completed delivery records streaming digests and later workspace changes cannot reuse its version',async t=>{
 const{engine,root}=await setup(t);const content='large-artifact\n'.repeat(400000);await writeFile(join(root,'work/a'),content);
 const a=await engine.submit({goal:'Version a large stable artifact',scope,acceptance:{required_files:['work/a']},offline_script:[finish]});const done=await completion(engine,a.task.id);
 assert.equal(done.status,'completed');assert.equal(done.delivery.files[0].sha256,hash(content));assert.equal((await engine.verifyDelivery(done.id)).valid,true);
 await writeFile(join(root,'work/a'),'changed');const check=await engine.verifyDelivery(done.id);assert.equal(check.valid,false);assert.equal(check.delivery_id,done.delivery.id);assert.deepEqual(check.changed_files,['work/a']);
});

test('declared protected acceptance files cannot be edited through file tools',async t=>{
 const{engine,root}=await setup(t);await writeFile(join(root,'work/check.mjs'),'original');
 const a=await engine.submit({goal:'Keep explicit acceptance dependency immutable',scope,acceptance:{protected_files:['work/check.mjs']},offline_script:[{name:'write_file',arguments:{path:'work/check.mjs',content:'changed',expected_sha256:hash('original')}},finish]});
 const done=await completion(engine,a.task.id);assert.equal(done.status,'completed');assert.equal(await readFile(join(root,'work/check.mjs'),'utf8'),'original');assert.equal(done.messages.find(m=>m.role==='toolResult').isError,true);
});

test('bounded distinct reads do not trip the repeated-turn guard',async t=>{
 const{engine,root}=await setup(t,{budget:{max_no_progress_calls:3}});for(let i=0;i<6;i++)await writeFile(join(root,'work/f'+i),'source-'+i);
 const a=await engine.submit({goal:'Read relevant implementation slices before coding',scope,offline_script:[...Array.from({length:6},(_,i)=>({name:'read_file',arguments:{path:'work/f'+i}})),finish]});assert.equal((await completion(engine,a.task.id)).status,'completed');
});

test('same-scope runtime input uses Pi steering without a pause, while preserving task limits',async t=>{
 const{engine}=await setup(t);const command={argv:['node','-e',"setTimeout(()=>console.log('done'),300)"],cwd:'work'};
 const a=await engine.submit({goal:'Receive a bounded clarification while a tool runs',scope:{...scope,commands:[command]},offline_script:[{name:'run_command',arguments:command},finish]});
 await until(()=>engine.store.operations(a.task.id,'command').some(o=>o.state==='started'));const before=engine.store.get(a.task.id);
 await engine.input(a.task.id,'Keep the existing output format.',{expected_revision:before.revision});const done=await completion(engine,a.task.id);
 assert.equal(done.status,'completed');assert.deepEqual(done.spec.budget,before.spec.budget);assert.equal(done.created_at,before.created_at);assert.equal(done.delivered_input_revision,2);assert.ok(done.messages.some(m=>m.role==='user'&&JSON.stringify(m).includes('Keep the existing output format.')));assert.ok(!engine.store.events(done.id,0,500).some(e=>e.payload.status==='pausing'));
});

test('resume inputs are incremental and immutable reference text is not repeated',async t=>{
 const{engine,root}=await setup(t);const sentinel='REFERENCE_SENT_ONCE_'+'.'.repeat(2000);await writeFile(join(root,'work/input'),sentinel);
 const a=await engine.submit({goal:'Resume without resending fixed input',scope,inputs:['work/input'],offline_script:[hold,hold,finish]});await completion(engine,a.task.id);await until(()=>!engine.active);
 await engine.control(a.task.id,'resume',{input:'First clarification'});await completion(engine,a.task.id);await until(()=>!engine.active);
 await engine.control(a.task.id,'resume',{input:'Second clarification'});const done=await completion(engine,a.task.id);assert.equal(done.status,'completed');
 const text=JSON.stringify(done.messages.filter(m=>m.role==='user'));assert.equal(text.split('REFERENCE_SENT_ONCE_').length-1,1);assert.equal(text.split('First clarification').length-1,1);assert.equal(text.split('Second clarification').length-1,1);
});
