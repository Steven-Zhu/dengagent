import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine} from '../src/engine.mjs';
import {configSchema,taskSchema} from '../src/config.mjs';
import {connectionSettings,saveConnection} from '../src/connection.mjs';
import {generationOptions} from '../src/model-options.mjs';
import {hash} from '../src/store.mjs';
import {environment,completion} from './helpers.mjs';

test('unlimited calls are explicit null, serializable and selected by recommended/CLI options',()=>{
 const base={workspace_root:'.',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'fixture'}}}};
 assert.equal(configSchema.parse(base).budget.max_model_calls,null);
 assert.equal(taskSchema.parse({goal:'Unlimited calls requested',budget:{max_model_calls:null}}).budget.max_model_calls,null);
 assert.equal(generationOptions({'max-model-calls':'unlimited'}).max_model_calls,null);
 assert.equal(generationOptions({'max-model-calls':'12'}).max_model_calls,12);
 assert.equal(generationOptions({recommended:true}).max_model_calls,null);
 for(const value of [0,-1,201,1.5,'unlimited'])assert.throws(()=>configSchema.parse({...base,budget:{max_model_calls:value}}));
});

test('unlimited tasks can make more than 30 actual native tool calls and pass acceptance',async t=>{
 const {root,config}=await environment(t);
 const engine=new Engine(config);t.after(()=>engine.close());
 let content='';const script=[];
 for(let i=0;i<32;i++){
  const chunk=`line ${i}\n`;
  script.push({name:i?'append_file':'write_file',arguments:{path:'result.txt',content:chunk,...(i?{expected_sha256:hash(content)}:{})}});
  content+=chunk;
 }
 script.push({name:'finish_task',arguments:{summary:'Completed more than the former 30-call default'}});
 const {task}=await engine.submit({goal:'Complete 32 progressing writes without a model call cap',scope:{read:['.'],write:['result.txt']},acceptance:{required_files:['result.txt']},offline_script:script});
 const done=await completion(engine,task.id);
 assert.equal(done.status,'completed');assert.equal(done.usage.model_calls,33);
 assert.equal(done.spec.budget.max_model_calls,null);
 assert.equal(await readFile(join(root,'result.txt'),'utf8'),content);
});

for(const [configured,requested,effective]of [[null,2,2],[2,null,2],[2,undefined,2],[null,null,null]]){
 test(`submission resolves configured ${configured} and requested ${requested} correctly`,async t=>{
  const {config}=await environment(t,{budget:{max_model_calls:configured}});
  const engine=new Engine(config);t.after(()=>engine.close());
  const {task}=await engine.submit({goal:'Resolve call budget without null becoming zero',budget:requested===undefined?{}:{max_model_calls:requested},offline_script:[{name:'request_input',arguments:{question:'Wait'}}]});
  const done=await completion(engine,task.id);assert.equal(done.spec.budget.max_model_calls,effective);
  assert.equal(done.status,'waiting_input');
  assert.deepEqual(task.budget_resolution.limited_fields,configured===2&&requested===null?['max_model_calls']:[]);
 });
}

test('changing future-task calls preserves other limits, profile and an existing task snapshot',async t=>{
 const {config}=await environment(t,{budget:{max_model_calls:30,max_total_tokens:42000,max_duration_ms:90000}});
 const engine=new Engine(config);t.after(()=>engine.close());
 const {task}=await engine.submit({goal:'Retain original snapshot while changing future task calls',offline_script:[{name:'request_input',arguments:{question:'Wait'}}]});
 await completion(engine,task.id);
 const budget={...config.budget},models=structuredClone(config.models),settings=await connectionSettings(config);
 const p=settings.profiles[0];
 await saveConnection(config,{profile:p.profile,base_url:p.base_url,model:p.model,expected_revision:settings.revision,max_model_calls:null});
 assert.deepEqual(config.budget,{...budget,max_model_calls:null});assert.deepEqual(config.models,models);
 assert.equal(engine.store.get(task.id).spec.budget.max_model_calls,30);
 const {task:next}=await engine.submit({goal:'A new task inherits the unlimited call allowance',offline_script:[{name:'request_input',arguments:{question:'Wait'}}]});
 assert.equal(next.budget.max_model_calls,null);await completion(engine,next.id);
});
