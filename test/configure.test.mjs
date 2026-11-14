import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { environment,until } from './helpers.mjs';
import { terminal } from './pty.mjs';
import { startHost,request } from '../src/host.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
function invoke(args,input=''){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('error',reject);
    child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
  });
}

test('terminal configure changes a hidden Key, preserves it on blank, and can cancel without writes',async t=>{
  const {config,path}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
  const key='fake-configure-terminal-key';
  const first=await terminal([process.execPath,cli,'configure','--config',path],[
    {wait:'API URL（留空保留）',send:'https://new.invalid/v1\n'},
    {wait:'模型 ID（留空保留）',send:'new-model\n'},
    {wait:'API Key（不回显',send:key+'\r'},
    {wait:'保存连接设置？',send:'\n'},
  ]);
  assert.equal(first.code,0,first.output);assert.ok(!first.output.includes(key));assert.equal(first.steps,4);
  const saved=JSON.parse(await readFile(path,'utf8'));const profile=saved.models.profiles.worker;
  assert.equal(profile.base_url,'https://new.invalid/v1');assert.equal(profile.model,'new-model');
  assert.equal(await readFile(profile.api_key_file,'utf8'),key+'\n');assert.equal((await stat(profile.api_key_file)).mode&0o077,0);
  const blank=await terminal([process.execPath,cli,'configure','--config',path],[
    {wait:'API URL（留空保留）',send:'\n'},{wait:'模型 ID（留空保留）',send:'\n'},
    {wait:'API Key（不回显',send:'\r'},{wait:'保存连接设置？',send:'\n'},
  ]);
  assert.equal(blank.code,0,blank.output);assert.equal(JSON.parse(await readFile(path,'utf8')).models.profiles.worker.api_key_file,profile.api_key_file);
  const before=await readFile(path,'utf8');
  const cancel=await terminal([process.execPath,cli,'configure','--config',path],[
    {wait:'API URL（留空保留）',send:'\n'},{wait:'模型 ID（留空保留）',send:'cancelled-model\n'},
    {wait:'API Key（不回显',send:'\r'},{wait:'保存连接设置？',send:'n\n'},
  ]);
  assert.equal(cancel.code,0,cancel.output);assert.match(cancel.output,/cancelled/);assert.equal(await readFile(path,'utf8'),before);
});

test('noninteractive configure accepts Key from standard input and public show never returns it',async t=>{
  const {config,path}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
  const key='fake-stdin-only-key';
  const result=await invoke(['configure','--config',path,'--base-url','https://stdin.invalid/v1','--model-id','stdin-model','--key-stdin'],key+'\n');
  assert.equal(result.code,0,result.stderr);assert.ok(!result.stdout.includes(key));assert.equal(JSON.parse(result.stdout).model_calls,0);
  const shown=await invoke(['configure','--config',path,'--show']);assert.equal(shown.code,0,shown.stderr);
  assert.equal(JSON.parse(shown.stdout).profiles[0].key_configured,true);assert.ok(!shown.stdout.includes(key));assert.ok(!shown.stdout.includes('api_key_file'));
});

test('browser connection routes require origin and CSRF, retain credentials, and never stop active work',async t=>{
  const {config,path,root}=await environment(t);const oldKey='fake-browser-retained-key';const keyPath=join(root,'key');
  await writeFile(keyPath,oldKey,{mode:0o600});
  const raw=JSON.parse(await readFile(path,'utf8'));raw.models.profiles.worker.api_key_file=keyPath;
  await writeFile(path,JSON.stringify(raw));const {loadConfig}=await import('../src/config.mjs');Object.assign(config,await loadConfig(path));
  const host=await startHost(config);t.after(()=>host.close());const url=(await request(config,'/health')).console_url;
  const html=await(await fetch(url)).text();const csrf=/x-deng-csrf':'([^']+)'/.exec(html)[1];
  const settings=await(await fetch(url+'connection')).json();assert.equal(settings.profiles[0].key_configured,true);
  assert.ok(!JSON.stringify(settings).includes(oldKey));assert.ok(!JSON.stringify(settings).includes(keyPath));
  const payload={profile:'worker',base_url:'https://example.invalid/v1',model:'browser-model',api_key:'',expected_revision:settings.revision};
  const headers={Origin:new URL(url).origin,'content-type':'application/json','x-deng-csrf':csrf};
  assert.equal((await fetch(url+'connection',{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:JSON.stringify(payload)})).status,403);
  assert.equal((await fetch(url+'connection',{method:'POST',headers:{Origin:headers.Origin,'content-type':'application/json'},body:JSON.stringify(payload)})).status,403);
  const saved=await fetch(url+'connection',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(saved.status,200);
  assert.equal((await saved.json()).model_calls,0);assert.equal(await readFile(keyPath,'utf8'),oldKey);
  assert.equal(JSON.parse(await readFile(path,'utf8')).models.profiles.worker.api_key_file,keyPath);
  assert.equal((await fetch(url+'connection',{method:'POST',headers,body:JSON.stringify(payload)})).status,400);
  const revision=(await(await fetch(url+'connection')).json()).revision;
  const command={argv:[process.execPath,'-e','setTimeout(()=>{},1000)'],cwd:'.'};
  const {task}=await host.engine.submit({goal:'Continue running during an attempted configuration change',scope:{read:['.'],commands:[command]},offline_script:[{name:'run_command',arguments:command}]});
  await until(()=>host.engine.active);const before=await readFile(path,'utf8');
  const denied=await fetch(url+'connection',{method:'POST',headers,body:JSON.stringify({...payload,expected_revision:revision})});
  assert.equal(denied.status,400);assert.equal(host.engine.get(task.id).status,'running');assert.equal(await readFile(path,'utf8'),before);
  const probe=await fetch(url+'connection/probe',{method:'POST',headers,body:JSON.stringify({...payload,expected_revision:revision})});
  assert.equal(probe.status,400);assert.match((await probe.json()).error,/Explicitly confirm/);
  await host.close();
});
