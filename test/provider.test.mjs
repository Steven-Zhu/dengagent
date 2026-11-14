import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile,readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { environment,completion,until } from './helpers.mjs';
import { hash } from '../src/store.mjs';

async function service(t,handler){
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return `http://127.0.0.1:${server.address().port}/v1`;
}
function frame(response,value){response.write(`data: ${JSON.stringify(value)}\n\n`);}
async function incoming(request){const parts=[];for await(const part of request)parts.push(part);return JSON.parse(Buffer.concat(parts).toString());}
function sendTool(response,name,args,{usage=true,broken=false}={}){
  response.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=delta=>({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-native',choices:[{index:0,delta,finish_reason:null}]});
  frame(response,chunk({role:'assistant',content:'Inspecting '}));
  frame(response,chunk({content:'fixture input. '}));
  const raw=JSON.stringify(args);const middle=Math.floor(raw.length/2);
  frame(response,chunk({tool_calls:[{index:0,id:'call-'+name,type:'function',function:{name,arguments:raw.slice(0,middle)}}]}));
  frame(response,chunk({tool_calls:[{index:0,function:{arguments:broken?'':raw.slice(middle)}}]}));
  frame(response,{...chunk({}),choices:[{index:0,delta:{},finish_reason:broken?'length':'tool_calls'}]});
  if(usage)frame(response,{...chunk({}),choices:[],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}});
  response.end('data: [DONE]\n\n');
}

test('real Pi AI HTTP/SSE adapter handles fragmented native tools and streaming usage',async t=>{
  const requests=[];
  const endpoint=await service(t,async(req,res)=>{
    const body=await incoming(req);requests.push({body,key:req.headers.authorization});
    if(requests.length===1)sendTool(res,'read_file',{path:'input.txt'});
    else sendTool(res,'finish_task',{summary:'HTTP fixture read successfully',output:{native:true}});
  });
  const{root,config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_TEST_KEY'}}}});
  const before=process.env.DENG_TEST_KEY;process.env.DENG_TEST_KEY='fixture-private-key';t.after(()=>{if(before===undefined)delete process.env.DENG_TEST_KEY;else process.env.DENG_TEST_KEY=before;});
  await writeFile(join(root,'input.txt'),'fixture source');const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Read the fixture source using actual native tool protocol'})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed');assert.equal(requests.length,2);assert.equal(requests[0].key,'Bearer fixture-private-key');
  assert.equal(requests[0].body.stream,true);assert.ok(requests[1].body.messages.some(message=>message.role==='tool'));
  assert.equal(task.usage.tokens,336);assert.equal(task.usage.input_tokens,246);assert.equal(task.usage.output_tokens,90);
  assert.ok(engine.store.events(id,0,500).some(event=>event.type==='model.text_delta'));
  assert.ok(!JSON.stringify(engine.store.list()).includes('fixture-private-key'));
  assert.equal(engine.get(id).last_reported_model.model,'fixture-native');
});

test('stopped task switches actual HTTP model and credentials only on explicit resume, with per-call model evidence',async t=>{
  const requests=[];
  const first=await service(t,async(req,res)=>{requests.push({body:await incoming(req),key:req.headers.authorization,endpoint:'first'});sendTool(res,'request_input',{question:'Pause here for model choice'});});
  const second=await service(t,async(req,res)=>{requests.push({body:await incoming(req),key:req.headers.authorization,endpoint:'second'});sendTool(res,'finish_task',{summary:'Second model continued with checkpoint'});});
  const{config}=await environment(t,{provider:'compatible',models:{default:'one',profiles:{
    one:{base_url:first,model:'requested-small',api_key_env:'DENG_SWITCH_A'},
    two:{base_url:second,model:'requested-large',api_key_env:'DENG_SWITCH_B'},
  }}});
  const oldA=process.env.DENG_SWITCH_A,oldB=process.env.DENG_SWITCH_B;
  process.env.DENG_SWITCH_A='local-fixture-a';process.env.DENG_SWITCH_B='local-fixture-b';
  t.after(()=>{for(const[name,value]of[['DENG_SWITCH_A',oldA],['DENG_SWITCH_B',oldB]])if(value===undefined)delete process.env[name];else process.env[name]=value;});
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Continue a real Pi protocol conversation after an explicit model switch'})).task;
  assert.equal((await completion(engine,id)).status,'waiting_input');await until(()=>!engine.active);
  const before=engine.get(id);engine.setModel({task_id:id,model:'two'});
  assert.equal(requests.length,1);assert.equal(engine.get(id).status,'waiting_input');
  assert.deepEqual(engine.get(id).usage,before.usage);assert.equal(engine.get(id).last_reported_model,undefined);
  await engine.control(id,'resume',{input:'Continue with the second configured model'});
  const done=await completion(engine,id);assert.equal(done.status,'completed');assert.equal(requests.length,2);
  assert.deepEqual(requests.map(request=>[request.endpoint,request.body.model,request.key]),[
    ['first','requested-small','Bearer local-fixture-a'],['second','requested-large','Bearer local-fixture-b'],
  ]);
  assert.ok(requests[1].body.messages.some(message=>message.role==='tool'));
  assert.equal(done.usage.tokens,336);
  const settlements=engine.store.events(id,0,500).filter(event=>event.type==='usage.settled');
  assert.deepEqual(settlements.map(event=>event.payload.model_info.model),['requested-small','requested-large']);
  assert.deepEqual(settlements.map(event=>event.payload.reported_model),['fixture-native','fixture-native']);
  assert.equal(engine.get(id).last_reported_model.requested_model,'requested-large');
});

test('HTTP error bodies are sanitized and are never silently retried',async t=>{
  let calls=0;
  const endpoint=await service(t,async(req,res)=>{await incoming(req);calls++;res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'do-not-leak-secret-body'}}));});
  const{config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_TEST_KEY'}}}});
  const old=process.env.DENG_TEST_KEY;process.env.DENG_TEST_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.DENG_TEST_KEY;else process.env.DENG_TEST_KEY=old;});
  const engine=new Engine(config);t.after(()=>engine.close());const{id}=(await engine.submit({goal:'Verify provider error privacy and request accounting'})).task;
  const task=await completion(engine,id);assert.equal(task.status,'failed');assert.equal(calls,1);assert.equal(task.usage.unknown_calls,1);
  assert.ok(!JSON.stringify(task).includes('do-not-leak-secret-body'));assert.ok(!JSON.stringify(engine.store.events(id,0,500)).includes('do-not-leak-secret-body'));
});

test('truncated tool parameters cannot execute a partial write',async t=>{
  const endpoint=await service(t,async(req,res)=>{await incoming(req);sendTool(res,'write_file',{path:'bad.txt',content:'must not write'},{broken:true});});
  const{root,config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_TEST_KEY'}}}});
  const old=process.env.DENG_TEST_KEY;process.env.DENG_TEST_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.DENG_TEST_KEY;else process.env.DENG_TEST_KEY=old;});
  const engine=new Engine(config);t.after(()=>engine.close());const{id}=(await engine.submit({goal:'Reject incomplete native tool arguments',scope:{read:['.'],write:['.']}})).task;
  const task=await completion(engine,id);assert.equal(task.status,'waiting_input');assert.equal(task.error.code,'OUTPUT_TRUNCATED');assert.equal(task.repairs,task.spec.budget.max_repair_rounds);assert.ok(!engine.store.events(id,0,500).some(event=>event.type==='file.changed'));
});

test('missing streaming usage retains reservation and prevents automatic next request',async t=>{
  let calls=0;const endpoint=await service(t,async(req,res)=>{await incoming(req);calls++;sendTool(res,'read_file',{path:'input.txt'},{usage:false});});
  const{root,config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_TEST_KEY'}}}});
  const old=process.env.DENG_TEST_KEY;process.env.DENG_TEST_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.DENG_TEST_KEY;else process.env.DENG_TEST_KEY=old;});
  await writeFile(join(root,'input.txt'),'source');const engine=new Engine(config);t.after(()=>engine.close());const{id}=(await engine.submit({goal:'Retain unknown usage without silently replaying requests'})).task;
  const task=await completion(engine,id);assert.equal(task.status,'failed');assert.equal(task.usage.unknown_calls,1);assert.ok(task.usage.tokens>100);assert.equal(calls,1);
});

test('a truncated response is repaired within the original allowance and long files use atomic append chunks',async t=>{
  let calls=0;
  const endpoint=await service(t,async(req,res)=>{
    await incoming(req);calls++;
    if(calls===1)sendTool(res,'write_file',{path:'partial.txt',content:'must never execute'},{broken:true});
    else if(calls===2)sendTool(res,'write_file',{path:'result.txt',content:'first\n',executable:true});
    else if(calls===3)sendTool(res,'append_file',{path:'result.txt',content:'second\n',expected_sha256:hash('first\n')});
    else sendTool(res,'finish_task',{summary:'Recovered using separate complete chunks'});
  });
  const{root,config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_RECOVERY_FIXTURE'}}}});
  const old=process.env.DENG_RECOVERY_FIXTURE;process.env.DENG_RECOVERY_FIXTURE='local-fixture';t.after(()=>{if(old===undefined)delete process.env.DENG_RECOVERY_FIXTURE;else process.env.DENG_RECOVERY_FIXTURE=old;});
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Recover truncated parameters, write independent chunks and pass fixed file acceptance',scope:{read:['.'],write:['.']},acceptance:{required_files:['result.txt']}})).task;
  const task=await completion(engine,id);
  assert.equal(task.status,'completed');assert.equal(task.repairs,1);assert.equal(calls,4);
  assert.equal(await readFile(join(root,'result.txt'),'utf8'),'first\nsecond\n');
  assert.equal((await stat(join(root,'result.txt'))).mode&0o111,0o111);
  await assert.rejects(readFile(join(root,'partial.txt')),{code:'ENOENT'});
  assert.equal(task.usage.tokens,4*168);
  assert.equal(task.changes['result.txt'].before,null);assert.equal(task.changes['result.txt'].after,hash('first\nsecond\n'));
  assert.equal(engine.store.events(id,0,500).filter(event=>event.type==='task.recovery_started').length,1);
});

for(const thinking of [false,true]) test(`long ${thinking?'DeepSeek':'ordinary'} tool history retains policy and tools in compacted HTTP requests and the full ledger`,async t=>{
  const requests=[];const endpoint=await service(t,async(req,res)=>{
    requests.push(await incoming(req));
    if(requests.length<=5)sendTool(res,'read_file',{path:'large.txt',start_line:1,end_line:80});
    else sendTool(res,'finish_task',{summary:'Compacted fixture completed'});
  });
  const {root,config}=await environment(t,{provider:'compatible',budget:{max_no_progress_calls:8},models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_HISTORY_KEY',context_window:22000,max_output_tokens:2048,thinking:thinking?'enabled':'disabled',reasoning_effort:'low',compat:{reasoning_format:'deepseek'}}}}});
  const old=process.env.DENG_HISTORY_KEY;process.env.DENG_HISTORY_KEY='fake-history-key';
  t.after(()=>{if(old===undefined)delete process.env.DENG_HISTORY_KEY;else process.env.DENG_HISTORY_KEY=old;});
  await writeFile(join(root,'large.txt'),('retained fixture source line '+'.'.repeat(110)+'\n').repeat(80));
  const engine=new Engine(config);t.after(()=>engine.close());
  const {task}=await engine.submit({goal:'Unique immutable requirement: preserve this exact user instruction while processing large tool results',budget:{max_no_progress_calls:8}});
  const done=await completion(engine,task.id);
  if(thinking){
    // contextfix.1 deliberately retains the mandatory reasoning/tool chain.
    assert.equal(done.status,'waiting_input');assert.equal(done.error.code,'CONTEXT_LIMIT');
    assert.ok(done.messages.some(m=>m.role==='toolResult'&&m.toolName==='read_file'));
    assert.equal(done.last_admission.reason,'required_execution_evidence_does_not_fit');
    return;
  }
  assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(requests.length,6);
  const expectedTools=requests[0].tools.map(tool=>tool.function.name).sort();
  assert.ok(expectedTools.length>0);
  for(const body of requests){
    assert.ok(body.messages.some(message=>JSON.stringify(message).includes('Unique immutable requirement')));
    assert.ok(body.messages.some(message=>message.role==='system'&&JSON.stringify(message).includes('You are DengAgent')));
    assert.deepEqual((body.tools??[]).map(tool=>tool.function.name).sort(),expectedTools);
  }
  assert.ok(requests.slice(1).some(body=>body.messages.some(message=>JSON.stringify(message).includes('deterministic history checkpoint'))));
  const events=engine.store.events(task.id,0,1000);assert.ok(events.some(event=>event.type==='context.compacted'));
  assert.equal(done.usage.model_calls,6);assert.equal(done.usage.tokens,6*168);assert.equal(done.spec.budget.max_total_tokens,task.budget.max_total_tokens);
  assert.equal(done.messages.filter(message=>message.role==='toolResult').length,6);
});

test('stale append hashes fail without changing an existing executable file',async t=>{
  let calls=0;const endpoint=await service(t,async(req,res)=>{await incoming(req);calls++;
    if(calls===1)sendTool(res,'append_file',{path:'launcher.sh',content:'unexpected\n',expected_sha256:hash('stale')});
    else sendTool(res,'finish_task',{summary:'Stale append was rejected'});
  });
  const {root,config}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:endpoint,model:'fixture-native',api_key_env:'DENG_APPEND_KEY'}}}});
  const old=process.env.DENG_APPEND_KEY;process.env.DENG_APPEND_KEY='fake-append-key';t.after(()=>{if(old===undefined)delete process.env.DENG_APPEND_KEY;else process.env.DENG_APPEND_KEY=old;});
  const path=join(root,'launcher.sh');await writeFile(path,'#!/bin/sh\n',{mode:0o755});
  const engine=new Engine(config);t.after(()=>engine.close());const {task}=await engine.submit({goal:'Reject stale chunk writes',scope:{read:['.'],write:['.']}});
  assert.equal((await completion(engine,task.id)).status,'completed');assert.equal(await readFile(path,'utf8'),'#!/bin/sh\n');assert.equal((await stat(path)).mode&0o777,0o755);
  assert.ok(engine.store.events(task.id,0,500).some(event=>event.type==='tool.completed'&&event.payload.is_error));
});
