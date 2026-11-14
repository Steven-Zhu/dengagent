import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine} from '../src/engine.mjs';
import {loadConfig,configSchema} from '../src/config.mjs';
import {connectionSettings,saveConnection,probeConnection} from '../src/connection.mjs';
import {reasoningSettings,applyReasoning,recommendedGeneration,recommendedTotalTokens} from '../src/model-options.mjs';
import {hash} from '../src/store.mjs';
import {startHost} from '../src/host.mjs';
import {environment,completion,until} from './helpers.mjs';
import {terminal} from './pty.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
function invoke(args){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,...args],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',p=>stdout+=p);child.stderr.on('data',p=>stderr+=p);child.once('error',reject);
  child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.end();
 });
}
const profile={base_url:'https://example.invalid/v1',model:'deepseek/deepseek-flash',...recommendedGeneration,reasoning_effort:'medium',compat:{reasoning_format:'auto'}};

test('generation defaults explicitly use 256K, 32K, five minutes, enabled/low and 16M task allowance',()=>{
 const c=configSchema.parse({workspace_root:'.',models:{default:'worker',profiles:{worker:{base_url:profile.base_url,model:profile.model}}}});
 for(const[name,value]of Object.entries(recommendedGeneration))assert.equal(c.models.profiles.worker[name],value);
 assert.equal(c.budget.max_total_tokens,recommendedTotalTokens);
 assert.equal(c.budget.max_model_calls,null);assert.equal(c.budget.max_duration_ms,1800000);
 assert.deepEqual(reasoningSettings(c.models.profiles.worker).parameters,{thinking:{type:'enabled'},reasoning_effort:'low'});
});

test('wire policy distinguishes requested medium, DeepSeek mapping, generic effort, off, provider-default and unsupported formats',()=>{
 const ds=reasoningSettings(profile);assert.equal(ds.reasoning_effort,'medium');assert.equal(ds.wire_reasoning_effort,'high');
 assert.deepEqual(applyReasoning({model:'x',thinking:{type:'disabled'},reasoning_effort:'max'},profile),{model:'x',thinking:{type:'enabled'},reasoning_effort:'high'});
 assert.deepEqual(reasoningSettings({...profile,model:'other-model'}).parameters,{reasoning_effort:'medium'});
 assert.deepEqual(reasoningSettings({...profile,thinking:'disabled'}).parameters,{thinking:{type:'disabled'}});
 assert.deepEqual(reasoningSettings({...profile,thinking:'provider-default'}).parameters,{});
 assert.deepEqual(reasoningSettings({...profile,compat:{reasoning_format:'none'}}).parameters,{});
 assert.deepEqual(reasoningSettings({...profile,model:'other-model',thinking:'disabled'}).parameters,{reasoning_effort:'none'});
 for(const effort of ['low','high','max'])assert.equal(reasoningSettings({...profile,reasoning_effort:effort}).wire_reasoning_effort,effort);
});

test('historical task snapshots keep the alpha.9 wire policy without silently acquiring effort controls',()=>{
 for(const thinking of [undefined,'disabled','enabled']){
  const legacy={model:'deepseek/deepseek-flash',...(thinking?{thinking}:{}),compat:{include_usage:true,max_tokens_field:'max_tokens'}};
  assert.deepEqual(reasoningSettings(legacy).parameters,thinking?{thinking:{type:thinking}}:{});
  assert.equal(reasoningSettings(legacy).wire_reasoning_effort,null);
 }
});

test('first init persists the same explicit generation settings across old/new Tencent and other base URLs',async t=>{
 const{root}=await environment(t);
 for(const [index,base]of ['https://api.lkeap.cloud.tencent.com/plan/v3','https://tokenhub.tencentmaas.com/plan/v3','https://example.invalid/v1'].entries()){
  const project=join(root,'project-'+index);await mkdir(project);const path=join(root,'init-'+index+'.json');
  const result=await invoke(['init','--project',project,'--config',path,'--base-url',base,'--model-id','deepseek/deepseek-flash','--json']);
  assert.equal(result.code,0,result.stderr);const saved=JSON.parse(await readFile(path,'utf8')).models.profiles.worker;
  for(const[name,value]of Object.entries(recommendedGeneration))assert.equal(saved[name],value);
  assert.equal(saved.compat.reasoning_format,'auto');
  assert.equal(JSON.parse(await readFile(path,'utf8')).budget.max_total_tokens,16_000_000);
 }
});

test('destination changes and partial edits preserve explicit thinking/effort/timeouts and do not call a model',async t=>{
 const{root,path}=await environment(t);let raw=JSON.parse(await readFile(path,'utf8'));
 raw.models.profiles.worker={...profile,thinking:'disabled',reasoning_effort:'low',timeout_ms:420000};await writeFile(path,JSON.stringify(raw));
 const config=await loadConfig(path),settings=await connectionSettings(config);
 const saved=await saveConnection(config,{profile:'worker',base_url:'https://new.invalid/v1',model:'deepseek/deepseek-flash',reuse_credential:true,expected_revision:settings.revision});
 assert.equal(saved.model_calls,0);assert.equal(config.models.profiles.worker.thinking,'disabled');assert.equal(config.models.profiles.worker.reasoning_effort,'low');assert.equal(config.models.profiles.worker.timeout_ms,420000);
 const shown=await connectionSettings(config);assert.equal(shown.profiles[0].wire_reasoning_effort,null);assert.equal(shown.profiles[0].thinking,'disabled');
});

test('configure --recommended upgrades only future defaults and retains the credential and old task snapshot',async t=>{
 const{root,path}=await environment(t,{budget:{max_total_tokens:160000},models:{default:'worker',profiles:{worker:{base_url:profile.base_url,model:profile.model,context_window:131072,max_output_tokens:4096,timeout_ms:120000,thinking:'disabled'}}}});
 const key=join(root,'fake.credential');await writeFile(key,'retained-only-fixture-key',{mode:0o600});
 let raw=JSON.parse(await readFile(path,'utf8'));raw.models.profiles.worker.api_key_file=key;raw.models.profiles.worker.credential_source='file';await writeFile(path,JSON.stringify(raw));
 const config=await loadConfig(path),host=await startHost(config);t.after(()=>host.close());
 const original=(await host.engine.submit({goal:'Hold original model and budget snapshots',offline_script:[{name:'request_input',arguments:{question:'Hold'}}]})).task;
 await until(()=>host.engine.get(original.id).status==='waiting_input'&&!host.engine.active);
 const before=host.engine.store.get(original.id),result=await invoke(['configure','--config',path,'--recommended']);
 assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).model_calls,0);
 const shown=await connectionSettings(host.engine.config);
 assert.equal(shown.budget.max_total_tokens,16000000);assert.equal(shown.profiles[0].context_window,262144);assert.equal(shown.profiles[0].max_output_tokens,32768);
 assert.equal(shown.profiles[0].thinking,'enabled');assert.equal(shown.profiles[0].reasoning_effort,'low');assert.equal(shown.profiles[0].wire_reasoning_effort,'low');
 const after=host.engine.store.get(original.id);assert.deepEqual(after.profile,before.profile);assert.deepEqual(after.spec.budget,before.spec.budget);assert.deepEqual(after.usage,before.usage);
 assert.equal(host.engine.config.models.profiles.worker.api_key_file,key);assert.equal(await readFile(key,'utf8'),'retained-only-fixture-key');
 const future=(await host.engine.submit({goal:'New tasks inherit explicitly applied generation settings'})).task;assert.equal(future.budget.max_total_tokens,16000000);assert.equal(future.model_info.max_output_tokens,32768);
});

test('generation controls validate before persistence, including output/context relation and effort enum',async t=>{
 const{config,path}=await environment(t);const settings=await connectionSettings(config),before=await readFile(path,'utf8');
 for(const extra of [{reasoning_effort:'unknown'},{thinking:'enable'},{timeout_ms:600001},{max_total_tokens:16000001},{context_window:4096,max_output_tokens:8192}]){
  await assert.rejects(saveConnection(config,{profile:'worker',base_url:config.models.profiles.worker.base_url,model:'fixture',expected_revision:settings.revision,...extra}));
  assert.equal(await readFile(path,'utf8'),before);
 }
});

test('interactive advanced configure edits the complete generation policy while keeping Key input private',async t=>{
 const{config,path}=await environment(t),host=await startHost(config);t.after(()=>host.close());
 const result=await terminal([process.execPath,cli,'configure','--config',path,'--advanced'],[
  {wait:'API URL（留空保留）',send:'\n'},{wait:'模型 ID（留空保留）',send:'\n'},
  {wait:'上下文上限 [',send:'262144\n'},{wait:'单次输出上限 [',send:'32768\n'},
  {wait:'模型请求超时（毫秒） [',send:'300000\n'},{wait:'未来任务累计 token 上限 [',send:'16000000\n'},
  {wait:'thinking（enabled / disabled / provider-default）',send:'enabled\n'},
  {wait:'reasoning_effort（low / medium / high / max）',send:'medium\n'},
  {wait:'reasoning 格式（auto / deepseek / openai / none）',send:'deepseek\n'},
  {wait:'API Key（不回显',send:'fake-private-advanced-key\r'},{wait:'保存连接设置？',send:'\n'},
 ]);
 assert.equal(result.code,0,result.output);assert.ok(!result.output.includes('fake-private-advanced-key'));
 const saved=await loadConfig(path),p=saved.models.profiles.worker;
 for(const[name,value]of Object.entries({...recommendedGeneration,reasoning_effort:'medium'}))assert.equal(p[name],value);
 assert.equal(p.compat.reasoning_format,'deepseek');assert.equal(saved.budget.max_total_tokens,16000000);
});

async function fixture(t,handler,overrides={}){
 const requests=[];const server=http.createServer(async(req,res)=>{
  const parts=[];for await(const p of req)parts.push(p);const body=JSON.parse(Buffer.concat(parts));requests.push(body);await handler(body,res,requests.length);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const {root,path}=await environment(t);const key=join(root,'wire.credential');await writeFile(key,'fake-reasoning-fixture-key',{mode:0o600});
 const raw=JSON.parse(await readFile(path,'utf8'));raw.provider='compatible';raw.models.profiles.worker={...profile,base_url:'http://127.0.0.1:'+server.address().port+'/v1',api_key_file:key,credential_source:'file',...overrides};await writeFile(path,JSON.stringify(raw));
 const engine=new Engine(await loadConfig(path));t.after(()=>engine.close());return {root,engine,requests};
}
function send(res,name,args,index,{thinking=true}={}){
 res.writeHead(200,{'content-type':'text/event-stream'});
 const emit=delta=>res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
 if(thinking){emit({reasoning_content:'private-fixture-reasoning-'+index+'-'});emit({reasoning_content:'continued'});}
 emit({tool_calls:[{index:0,id:'call-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 res.write('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n');
 res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:50,completion_tokens_details:{reasoning_tokens:30}}})+'\n\n');res.end('data: [DONE]\n\n');
}

test('actual SSE reasoning/tool turns preserve reasoning_content, send the selected effort/cap and keep reasoning private',async t=>{
 const{root,engine,requests}=await fixture(t,(body,res,n)=>{
  assert.equal(body.thinking.type,'enabled');assert.equal(body.reasoning_effort,'high');assert.equal(body.max_tokens,32768);
  for(const m of body.messages.filter(m=>m.role==='assistant'))assert.match(m.reasoning_content,/^private-fixture-reasoning-/);
  if(n===1)send(res,'write_file',{path:'result.txt',content:'one\n'},n);
  else if(n===2)send(res,'append_file',{path:'result.txt',content:'two\n',expected_sha256:hash('one\n')},n);
  else send(res,'finish_task',{summary:'Reasoning tool closure verified'},n);
 });
 const{id}=(await engine.submit({goal:'Verify a bounded native reasoning write/append/finish loop',scope:{read:['.'],write:['.']},acceptance:{required_files:['result.txt']}})).task;
 const done=await completion(engine,id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(requests.length,3);
 assert.equal(await readFile(join(root,'result.txt'),'utf8'),'one\ntwo\n');
 assert.equal(requests[2].messages.filter(m=>m.role==='assistant').length,2);assert.equal(done.usage.output_tokens,150);
 const publicData=JSON.stringify([engine.get(id),engine.store.events(id,0,500)]);assert.ok(!publicData.includes('private-fixture-reasoning-'));assert.ok(!publicData.includes('fake-reasoning-fixture-key'));
 assert.equal(done.last_model_response.requested_reasoning_effort,'medium');assert.equal(done.last_model_response.wire_reasoning_effort,'high');assert.equal(done.last_model_response.output_token_limit,32768);
});

test('disabled thinking omits effort even if an enabled effort was previously saved',async t=>{
 const{engine,requests}=await fixture(t,(body,res,n)=>{assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.reasoning_effort,undefined);send(res,'finish_task',{summary:'Off policy verified'},n,{thinking:false});},{thinking:'disabled',reasoning_effort:'max'});
 const{id}=(await engine.submit({goal:'Keep thinking disabled explicitly'})).task;assert.equal((await completion(engine,id)).status,'completed');assert.equal(requests.length,1);
});

test('configured request timeout aborts once, retains unknown usage and never retries the request',async t=>{
 const{engine,requests}=await fixture(t,()=>{},{timeout_ms:100});
 const{id}=(await engine.submit({goal:'Exercise a deliberately short local request timeout'})).task;const done=await completion(engine,id);
 assert.equal(done.status,'failed');assert.equal(requests.length,1);assert.equal(done.usage.unknown_calls,1);assert.ok(engine.get(id).usage_accounting.unknown_reserved_tokens>0);
});

test('connectivity probe uses disabled thinking and 32-token cap without changing the selected reasoning policy',async t=>{
 const{path}=await environment(t,{provider:'compatible',models:{default:'worker',profiles:{worker:profile}}});const config=await loadConfig(path);
 let calls=0;const settings=await connectionSettings(config);
 const reply=await probeConnection(config,{profile:'worker',base_url:profile.base_url,model:profile.model,api_key:'fake-probe-key',expected_revision:settings.revision,confirm_model_call:true},{fetchImpl:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.reasoning_effort,undefined);assert.equal(body.max_tokens,32);
  return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}),{status:200});
 }});
 assert.equal(reply.ok,true);assert.equal(reply.probe_mode,'connectivity_no_thinking');assert.equal(calls,1);assert.equal(config.models.profiles.worker.thinking,'enabled');
});


test('browser settings persist the 16M ceiling, share validation, and make no provider call',async t=>{
 const{config,path}=await environment(t,{budget:{max_total_tokens:1_000_000}});
 const beforeModels=structuredClone(config.models);
 const settings=await connectionSettings(config);
 const saved=await saveConnection(config,{profile:'worker',base_url:config.models.profiles.worker.base_url,model:config.models.profiles.worker.model,expected_revision:settings.revision,max_total_tokens:16_000_000});
 assert.equal(saved.model_calls,0);
 const after=JSON.parse(await readFile(path,'utf8'));
 assert.equal(after.budget.max_total_tokens,16_000_000);
 assert.deepEqual((await loadConfig(path)).models,beforeModels);
 assert.equal((await connectionSettings(config)).recommended_task_tokens,16_000_000);
 const html=await readFile(new URL('../src/observer.html',import.meta.url),'utf8');
 assert.match(html,/id="settings-total"[^>]*max="16000000"/);
 assert.match(html,/id="settings-context"[^>]*max="2000000"/);
});
