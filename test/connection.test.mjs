import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,stat,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { environment } from './helpers.mjs';
import { loadConfig,getCredential } from '../src/config.mjs';
import { connectionSettings,saveConnection,probeConnection } from '../src/connection.mjs';
import { Engine } from '../src/engine.mjs';
import { workspacePath } from '../src/paths.mjs';

async function setup(t){
  const env=await environment(t,{provider:'compatible'});
  const key=join(env.root,'private-original.credential');await writeFile(key,'original-fixture-value-123\n',{mode:0o600});
  const raw=JSON.parse(await readFile(env.path,'utf8'));
  raw.models.profiles.worker={base_url:'https://example.invalid/v1',model:'original-model',api_key_file:key,api_key_env:'DENG_CONNECTION_FIXTURE',credential_source:'file'};
  await writeFile(env.path,JSON.stringify(raw));
  return {...env,config:await loadConfig(env.path),key};
}
async function form(config,extra={}){
  const settings=await connectionSettings(config);const p=settings.profiles[0];
  return {profile:p.profile,base_url:p.base_url,model:p.model,expected_revision:settings.revision,...extra};
}

test('connection update is atomic, hides credentials and preserves old task connection snapshots',async t=>{
  const {root,config,path,key}=await setup(t);
  const previous=structuredClone(config.models.profiles.worker);
  const oldEnv=process.env.DENG_CONNECTION_FIXTURE;process.env.DENG_CONNECTION_FIXTURE='environment-must-not-shadow-explicit-key';
  t.after(()=>{if(oldEnv===undefined)delete process.env.DENG_CONNECTION_FIXTURE;else process.env.DENG_CONNECTION_FIXTURE=oldEnv;});
  const result=await saveConnection(config,await form(config,{model:'updated-model',api_key:'updated-fixture-value-456'}));
  assert.equal(result.model_calls,0);assert.equal(result.existing_tasks_unchanged,true);
  assert.equal(await getCredential(config.models.profiles.worker),'updated-fixture-value-456');
  assert.equal(await getCredential(previous),'original-fixture-value-123');
  assert.ok(config.retired_credential_files.includes(key));
  assert.equal((await stat(config.models.profiles.worker.api_key_file)).mode&0o077,0);
  assert.equal((await stat(path)).mode&0o077,0);
  const publicText=JSON.stringify([result,await connectionSettings(config),JSON.parse(await readFile(path,'utf8'))]);
  assert.ok(!publicText.includes('updated-fixture-value-456'));assert.ok(!publicText.includes('original-fixture-value-123'));
  await assert.rejects(workspacePath(config,{spec:{scope:{read:['.'],write:['.']}}},key),{code:'PATH_SCOPE'});
  assert.ok(config.models.profiles.worker.api_key_file.startsWith(join(root,'.dengagent')));
});

test('blank Key retains credentials; destination change requires a new Key or explicit reuse',async t=>{
  const {config,key}=await setup(t);
  await saveConnection(config,await form(config,{api_key:''}));
  assert.equal(config.models.profiles.worker.api_key_file,key);
  await assert.rejects(saveConnection(config,await form(config,{base_url:'https://new.example.invalid/v1'})),{code:'CREDENTIAL_REUSE'});
  await saveConnection(config,await form(config,{base_url:'https://new.example.invalid/v1',reuse_credential:true}));
  assert.equal(config.models.profiles.worker.api_key_file,key);
  assert.equal(config.models.profiles.worker.base_url,'https://new.example.invalid/v1');
});

test('stale edits and invalid endpoint changes leave configuration and credential files untouched',async t=>{
  const {config,path}=await setup(t);const before=await readFile(path,'utf8');
  await assert.rejects(saveConnection(config,await form(config,{expected_revision:'0'.repeat(64),api_key:'must-not-persist'})),{code:'REVISION_CONFLICT'});
  await assert.rejects(saveConnection(config,await form(config,{base_url:'http://example.invalid/v1',reuse_credential:true,api_key:'must-not-persist'})),{code:'CONFIG'});
  assert.equal(await readFile(path,'utf8'),before);
  await assert.rejects(readdir(join(config.data_dir,'credentials')),{code:'ENOENT'});
});

test('connection saving rejects executing work without pausing or changing the task',async t=>{
  const {config}=await setup(t);const engine=new Engine(config);t.after(()=>engine.close());
  const changes=await form(config,{model:'other'});
  engine.active={id:'running-placeholder'};
  try{await assert.rejects(engine.configureConnection(changes),{code:'CONNECTION_BUSY'});assert.equal(engine.active.id,'running-placeholder');}
  finally{engine.active=null;}
  assert.equal(config.models.profiles.worker.model,'original-model');
});

test('connection probe is explicit, bounded, non-persistent and never returns a provider body',async t=>{
  const {config,path}=await setup(t);const original=await readFile(path,'utf8');let calls=0;
  const changes=await form(config,{api_key:'probe-only-secret'});
  const fetchImpl=async(_url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer probe-only-secret');assert.equal(JSON.parse(options.body).max_tokens,32);return new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:12,completion_tokens:1}}),{status:200});};
  await assert.rejects(probeConnection(config,changes,{fetchImpl}),{code:'PROBE_CONFIRMATION'});assert.equal(calls,0);
  const result=await probeConnection(config,{...changes,confirm_model_call:true},{fetchImpl});
  assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.model_calls,1);assert.equal(await readFile(path,'utf8'),original);
  const bad=await probeConnection(config,{...changes,confirm_model_call:true},{fetchImpl:async()=>new Response('private-provider-error',{status:401})});
  assert.equal(bad.http_status,401);assert.ok(!JSON.stringify(bad).includes('private-provider-error'));
  assert.ok(!JSON.stringify(result).includes('probe-only-secret'));
});
