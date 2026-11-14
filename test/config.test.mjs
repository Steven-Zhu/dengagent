import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema,taskSchema } from '../src/config.mjs';
import { environment,completion } from './helpers.mjs';
import { Engine } from '../src/engine.mjs';

test('Zod 4 migration retains nested defaults and leaves task budget overrides genuinely partial',()=>{
  const config=configSchema.parse({workspace_root:'.',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'fixture'}}}});
  assert.equal(config.budget.max_total_tokens,16000000);assert.equal(config.tools.command_timeout_ms,120000);
  assert.equal(config.models.profiles.worker.compat.max_tokens_field,'max_tokens');assert.equal(config.models.profiles.worker.compat.include_usage,true);
  const task=taskSchema.parse({goal:'A task with no explicit limits'});
  assert.deepEqual(task.budget,{});assert.deepEqual(task.scope,{read:['.'],write:[],commands:[]});assert.deepEqual(task.acceptance,{commands:[],required_files:[],protected_files:[]});
  assert.deepEqual(taskSchema.parse({goal:'A task with one override',budget:{max_model_calls:2}}).budget,{max_model_calls:2});
  assert.throws(()=>taskSchema.parse({goal:'No unknown budget keys',budget:{extra:1}}));
});

test('a submitted task inherits custom project limits while overriding only its explicit field',async t=>{
  const limits={max_model_calls:7,max_total_tokens:42000,max_duration_ms:90000,max_repair_rounds:1};
  const {config}=await environment(t,{budget:limits});const engine=new Engine(config);t.after(()=>engine.close());
  const {task}=await engine.submit({goal:'Preserve project allowance across the schema upgrade',budget:{max_model_calls:2},offline_script:[{name:'request_input',arguments:{question:'Wait for input'}}]});
  const done=await completion(engine,task.id);assert.deepEqual(done.spec.budget,{...limits,max_no_progress_calls:4,max_model_calls:2});assert.equal(done.status,'waiting_input');
});


test('16M is accepted for configuration and explicit task budgets, with old lower overrides retained',()=>{
 const base={workspace_root:'.',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'fixture'}}}};
 assert.equal(configSchema.parse(base).budget.max_total_tokens,16_000_000);
 for(const amount of [1024,1_000_000,16_000_000]){
  assert.equal(configSchema.parse({...base,budget:{max_total_tokens:amount}}).budget.max_total_tokens,amount);
  assert.equal(taskSchema.parse({goal:'Explicit budget boundary',budget:{max_total_tokens:amount}}).budget.max_total_tokens,amount);
 }
 for(const amount of [1023,16_000_001]){
  assert.throws(()=>configSchema.parse({...base,budget:{max_total_tokens:amount}}));
  assert.throws(()=>taskSchema.parse({goal:'Reject out of range budget',budget:{max_total_tokens:amount}}));
 }
});
