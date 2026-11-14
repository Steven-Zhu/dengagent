import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.mjs';
import { environment,completion,until } from './helpers.mjs';

const models={default:'worker',profiles:{
  worker:{base_url:'https://example.invalid/v1',model:'small',api_key_env:'DENG_PRIVATE_A'},
  reviewer:{base_url:'https://other.invalid/v1',model:'large',api_key_env:'DENG_PRIVATE_B'},
}};
const decision={goal:'Wait for a user decision before completing the fixture',offline_script:[
  {name:'request_input',arguments:{question:'Which format?'}},
  {name:'finish_task',arguments:{summary:'Resumed fixture completed'}},
]};

test('local default selection persists across restart; existing task snapshots do not change',async t=>{
  const{config}=await environment(t,{models});let engine=new Engine(config);
  try{
    const{id}=(await engine.submit(decision)).task;await completion(engine,id);
    const before=engine.get(id);assert.equal(before.model_info.model,'small');
    assert.equal(engine.models().default.model,'small');
    const result=engine.setModel({model:'reviewer'});assert.equal(result.selection_model_calls,0);
    assert.equal(result.existing_tasks_unchanged,true);assert.equal(engine.get(id).model,'small');
    assert.deepEqual(engine.get(id).usage,before.usage);
    await engine.close();engine=new Engine(config);
    assert.equal(engine.models().default.model,'large');assert.equal(engine.get(id).model,'small');
    const next=await engine.submit({goal:'Use the persisted selected default for a new task'});
    assert.equal(next.task.model_info.profile,'reviewer');assert.equal(next.task.model,'large');await completion(engine,next.task.id);
    const serialized=JSON.stringify(engine.models());assert.ok(!serialized.includes('DENG_PRIVATE'));
  }finally{await engine.close();}
});

test('running switch is rejected without stopping; manual pause, switch and resume preserve work and budgets',async t=>{
  const{config}=await environment(t,{models});const engine=new Engine(config);t.after(()=>engine.close());
  const command={argv:['node','-e',"console.log('still-working');setTimeout(()=>{},60000)"],cwd:'.'};
  const{id}=(await engine.submit({goal:'Switch only after the user manually stops the running process',scope:{read:['.'],commands:[command]},offline_script:[
    {name:'run_command',arguments:command},{name:'finish_task',arguments:{summary:'Continued after explicit resume'}},
  ]})).task;
  await until(()=>engine.store.events(id,0,500).some(event=>event.type==='tool.output'&&event.payload.text.includes('still-working')));
  const running=engine.get(id);const controller=engine.active.controller;
  assert.throws(()=>engine.setModel({task_id:id,model:'reviewer'}),{code:'MODEL_TASK_RUNNING'});
  assert.equal(controller.signal.aborted,false);assert.equal(engine.get(id).status,'running');assert.equal(engine.runner.active.size,1);
  assert.equal(engine.get(id).revision,running.revision);assert.equal(engine.get(id).model,'small');
  engine.setModel({model:'reviewer'});assert.equal(engine.get(id).model,'small');assert.equal(controller.signal.aborted,false);
  engine.setModel({model:'worker'});
  const paused=await engine.control(id,'pause');assert.equal(paused.status,'paused');assert.equal(engine.runner.active.size,0);
  const before=engine.store.get(id);
  const changed=engine.setModel({task_id:id,model:'reviewer',expected_revision:before.revision});
  assert.equal(changed.task.status,'paused');assert.equal(changed.resume_required,true);
  assert.equal(changed.task.model_info.model,'large');assert.equal(changed.task.model_history.length,2);
  await delay(80);const after=engine.store.get(id);assert.equal(engine.active,null);
  for(const field of ['messages','usage','spec','created_at','checkpoints','run_id'])assert.deepEqual(after[field],before[field]);
  await engine.control(id,'resume');const completed=await completion(engine,id);
  assert.equal(completed.status,'completed');assert.equal(completed.run_id,2);assert.equal(completed.usage.model_calls,before.usage.model_calls+1);
  const starts=engine.store.events(id,0,500).filter(event=>event.type==='task.started');assert.deepEqual(starts.map(event=>event.payload.model),['small','large']);
  assert.equal(engine.models().default.model,'small');
});

test('unknown reservations, revision checks, stopping states and terminal tasks cannot be bypassed by selection',async t=>{
  const{config}=await environment(t,{models});const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit(decision)).task;await completion(engine,id);
  await until(()=>!engine.active);
  const task=engine.store.get(id);task.usage.unknown_calls=1;task.usage.tokens+=5000;engine.store.save(task);
  assert.throws(()=>engine.setModel({task_id:id,model:'reviewer',expected_revision:99}),{code:'REVISION_CONFLICT'});
  for(const status of ['pausing','cancelling','running']){
    task.status=status;engine.store.save(task);assert.throws(()=>engine.setModel({task_id:id,model:'reviewer'}),{code:'MODEL_TASK_RUNNING'});
  }
  task.status='waiting_input';engine.store.save(task);engine.setModel({task_id:id,model:'reviewer'});
  assert.deepEqual(engine.get(id).usage,task.usage);
  await assert.rejects(engine.control(id,'resume'),{code:'USAGE_UNKNOWN'});
  await engine.control(id,'cancel');assert.throws(()=>engine.setModel({task_id:id,model:'worker'}),{code:'STATE'});
});

test('model IDs retain the chosen configured endpoint and credentials; ambiguous and invalid selections fail',async t=>{
  const{config}=await environment(t,{models});const engine=new Engine(config);t.after(()=>engine.close());
  engine.setModel({model:'custom/model-v2'});
  assert.equal(engine.models().default.base_url,models.profiles.worker.base_url);
  assert.equal(engine.defaultSelection().profile.api_key_env,'DENG_PRIVATE_A');
  engine.setModel({model:'custom/model-v3',profile:'reviewer'});
  assert.equal(engine.models().default.base_url,models.profiles.reviewer.base_url);
  assert.equal(engine.defaultSelection().profile.api_key_env,'DENG_PRIVATE_B');
  assert.equal(engine.store.list().length,0);
  assert.throws(()=>engine.setModel({model:'new',profile:'missing'}),{code:'MODEL_PROFILE'});
  assert.throws(()=>engine.setModel({model:'worker',profile:'reviewer'}),{code:'MODEL_PROFILE_CONFLICT'});
  assert.throws(()=>engine.setModel({model:'bad\nmodel'}));
  assert.throws(()=>engine.setModel({model:'new',base_url:'https://unauthorized.invalid'}));
  config.models.profiles.duplicate={...config.models.profiles.worker};
  assert.throws(()=>engine.setModel({model:'small'}),{code:'MODEL_AMBIGUOUS'});
  assert.equal(engine.setModel({model:'small',profile:'worker'}).model_info.profile,'worker');
});

test('removed saved profile fails closed for new tasks but can be repaired with local selection',async t=>{
  const{config}=await environment(t,{models});const engine=new Engine(config);t.after(()=>engine.close());
  engine.setModel({model:'reviewer'});delete config.models.profiles.reviewer;
  assert.equal(engine.models().default,null);assert.equal(engine.models().default_error.code,'MODEL_PROFILE');
  await assert.rejects(engine.submit({goal:'Do not silently substitute another endpoint or model'}),{code:'MODEL_PROFILE'});
  engine.setModel({model:'worker'});assert.equal(engine.models().default.model,'small');assert.equal(engine.store.list().length,0);
});

test('saved model IDs are not reinterpreted as another profile name',async t=>{
  const{config}=await environment(t,{models:{default:'worker',profiles:{
    worker:{base_url:'https://example.invalid/v1',model:'reviewer'},
    reviewer:{base_url:'https://other.invalid/v1',model:'other-model'},
  }}});
  const engine=new Engine(config);t.after(()=>engine.close());engine.setModel({model:'worker'});
  assert.equal(engine.models().default.model,'reviewer');assert.equal(engine.models().default.profile,'worker');
  const task=(await engine.submit({goal:'Keep the saved model ID on its explicitly chosen profile'})).task;
  assert.equal(task.model_info.base_url,'https://example.invalid/v1');await completion(engine,task.id);
});
