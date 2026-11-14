import test from 'node:test';
import assert from 'node:assert/strict';
import {taskSummary,compactResponse,detailPage} from '../src/summary.mjs';
import {prepareContext} from '../src/context.mjs';
import {Engine} from '../src/engine.mjs';
import {environment,completion} from './helpers.mjs';

const task={id:'a',revision:1,status:'running',usage:{tokens:15,model_calls:1},usage_accounting:{settled_tokens:15},model:'fixture',budget:{max_total_tokens:160000},model_info:{profile:'worker',model:'fixture'}};
test('bounded summaries remain stable across very large goals, checks, histories and UTF-8 errors',()=>{
 const huge={...task,goal:'设计'.repeat(100000),model_history:Array(500).fill({model:'x'}),recovery_history:Array(500).fill({message:'r'.repeat(1000)}),checkpoints:Array(500).fill({}),input_revisions:Array(500).fill({}),changes:Object.fromEntries(Array.from({length:500},(_,i)=>['file'+i,{}])),error:{code:'BUDGET_EXCEEDED',message:'预算'.repeat(5000)},acceptance:{passed:false,checks:Array(500).fill({passed:false,output:'logs'.repeat(1000)})}};
 const s=taskSummary(huge);assert.ok(Buffer.byteLength(JSON.stringify(s))<=4096);assert.equal(s.changed_file_count,500);assert.equal(s.error.truncated,true);assert.equal(s.checks.total,500);assert.ok(!('goal' in s));assert.ok(!('model_history' in s));assert.equal(huge.goal.length,200000);
});
test('submit/control/events projections and waiting failure summaries use the same bounded schema',()=>{
 for(const value of [{task},{task,duplicate:false},task]){
  const c=compactResponse(value),s=c.task??c;assert.equal(s.schema,'deng.task-summary.v1');assert.equal(s.id,task.id);
 }
 const n=compactResponse({notification:{status:'waiting_input',error:{code:'X',message:'x'.repeat(90000)},input_required:{question:'q'.repeat(20000)},result_summary:{summary:'r'.repeat(20000)}}});
 assert.ok(Buffer.byteLength(JSON.stringify(n))<1500);
});
test('details can be reassembled with the same hash and preserve complete history',()=>{
 const t={...task,goal:'中文'.repeat(5000)},parts=[];let offset=0,first;
 do{const p=detailPage(t,{offset,limit:97});first??=p.sha256;assert.equal(p.sha256,first);parts.push(p.content);offset=p.next_offset;}while(offset!==null);
 assert.deepEqual(JSON.parse(parts.join('')),t);
});
test('task budget clipping is explicit while config ceilings and old usage remain intact',async t=>{
 const {config}=await environment(t,{budget:{max_total_tokens:160000}}),engine=new Engine(config);t.after(()=>engine.close());
 const result=await engine.submit({goal:'Report a requested allowance above the configured cap',budget:{max_total_tokens:500000}});
 const r=result.task.budget_resolution;assert.equal(r.requested.max_total_tokens,500000);assert.equal(r.effective.max_total_tokens,160000);assert.deepEqual(r.limited_fields,['max_total_tokens']);
 await completion(engine,result.task.id);assert.equal(engine.get(result.task.id).budget.max_total_tokens,160000);
});
test('UTF-8 byte reservation rejection explains estimator, remaining allowance and protected input',()=>{
 const context={systemPrompt:'policy',messages:[{role:'user',content:'中文'.repeat(10000)}],tools:[]};
 try{prepareContext(context,{spec:{budget:{max_total_tokens:160000}},usage:{tokens:140000},changes:{}},{context_window:262144,max_output_tokens:32768});assert.fail('should reject');}
 catch(e){assert.equal(e.code,'BUDGET_EXCEEDED');assert.equal(e.admission.estimator,'utf8_bytes_upper_bound');assert.equal(e.admission.remaining_tokens,20000);assert.ok(e.admission.required_input_reserve>20000);assert.ok(!JSON.stringify(e.admission).includes('中文'));}
});
