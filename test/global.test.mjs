import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,stat,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {parse} from 'smol-toml';
import {environment,until,completion} from './helpers.mjs';
import {loadConfig} from '../src/config.mjs';
import {atomicConfig} from '../src/global.mjs';
import {Engine} from '../src/engine.mjs';
import {hash} from '../src/store.mjs';
import {request} from '../src/host.mjs';
import {workspacePath} from '../src/paths.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url)),invoke=promisify(execFile);
async function fixture(t){
  const{root}=await environment(t);const home=join(root,'home'),cwd=join(root,'unrelated launch folder');await mkdir(home);await mkdir(cwd);
  const env={...process.env,HOME:home,TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''};
  const run=(args,input='')=>new Promise((resolve,reject)=>{
    if(!input){invoke(process.execPath,[cli,...args],{env,cwd,timeout:20000}).then(resolve,reject);return;}
    import('node:child_process').then(({spawn})=>{
      const child=spawn(process.execPath,[cli,...args],{env,cwd});let stdout='',stderr='';
      child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>code?reject(new Error(stderr)):resolve({stdout,stderr}));child.stdin.end(input);
    });
  });
  const globalPath=join(home,'.config/dengagent/global.json');
  async function stopAll(){
    for(const path of [globalPath,...(await readdir(join(home,'.config/dengagent/projects')).catch(()=>[])).map(name=>join(home,'.config/dengagent/projects',name,'runtime.json'))]){
      await run(['stop-engine','--config',path]).catch(()=>{});
    }
  }
  t.after(stopAll);return{root,home,cwd,env,run,globalPath,stopAll};
}

test('one user init installs global MCP/skill, and configure works independently of launch directory',async t=>{
  const f=await fixture(t);const initialized=JSON.parse((await f.run(['init','--offline'])).stdout);
  assert.equal(initialized.scope,'global');assert.equal(initialized.config,f.globalPath);
  const registration=parse(await readFile(join(f.home,'.codex/config.toml'),'utf8')).mcp_servers.dengagent;
  assert.deepEqual(registration.args.slice(-2),['mcp','--global']);assert.ok(!registration.args.includes('--config'));
  assert.match(await readFile(join(f.home,'.agents/skills/dengagent/SKILL.md'),'utf8'),/EVERY tool call/);
  await assert.rejects(stat(join(f.cwd,'.codex')),{code:'ENOENT'});
  const key='fake-global-connection-key';await f.run(['configure','--key-stdin'],key+'\n');
  const shown=JSON.parse((await f.run(['configure','--show'])).stdout);assert.equal(shown.scope,'global');assert.equal(shown.profiles[0].key_configured,true);
  assert.ok(!JSON.stringify(shown).includes(key));assert.ok(!JSON.stringify(shown).includes('api_key_file'));
  assert.equal((await stat(f.globalPath)).mode&0o077,0);
  await f.run(['model','user-selected-default','--global']);assert.equal(JSON.parse(await readFile(f.globalPath,'utf8')).models.profiles.worker.model,'user-selected-default');await f.stopAll();
});

test('one global MCP routes concurrent projects explicitly and never borrows another project task',async t=>{
  const f=await fixture(t);await f.run(['init','--offline']);
  const a=join(f.root,'project A'),b=join(f.root,'project B');await mkdir(a);await mkdir(b);
  for(const [project,value]of[[a,'A'],[b,'B']])await writeFile(join(project,'task.json'),JSON.stringify({goal:'Write the selected project result only',scope:{read:['.'],write:['.']},acceptance:{required_files:['answer.txt']},offline_script:[{name:'write_file',arguments:{path:'answer.txt',content:value}},{name:'finish_task',arguments:{summary:'Project fixture finished'}}]}));
  const client=new Client({name:'global-routing-test',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'mcp','--global'],env:f.env,cwd:f.cwd,stderr:'pipe'}));
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});const value=JSON.parse(result.content[0].text);if(result.isError)throw Object.assign(new Error(JSON.stringify(value)),value.error);return value;};
  try{
    const tools=(await client.listTools()).tools;assert.ok(tools.find(x=>x.name==='submit_task').inputSchema.required.includes('project'));
    const relative=await client.callTool({name:'get_models',arguments:{project:'.'}});assert.equal(JSON.parse(relative.content[0].text).error.code,'PROJECT_REQUIRED');
    await Promise.all([call('get_models',{project:a}),call('get_models',{project:a})]);
    const [pa,pb]=await Promise.all([call('prepare_console',{project:a}),call('prepare_console',{project:b})]);assert.notEqual(pa.panel_url,pb.panel_url);
    const [ta,tb]=await Promise.all([call('submit_task',{project:a,task_file:'task.json'}),call('submit_task',{project:b,task_file:'task.json'})]);
    for(const[project,task]of[[a,ta.task],[b,tb.task]])await until(async()=>{const current=await call('get_task',{project,task_id:task.id});assert.ok(!['failed','budget_exceeded'].includes(current.status),JSON.stringify(current));return current.status==='completed';});
    assert.equal(await readFile(join(a,'answer.txt'),'utf8'),'A');assert.equal(await readFile(join(b,'answer.txt'),'utf8'),'B');
    const wrong=await client.callTool({name:'get_task',arguments:{project:b,task_id:ta.task.id}});assert.equal(JSON.parse(wrong.content[0].text).error.code,'NOT_FOUND');
    const app=await client.callTool({name:'render_console',arguments:{project:a}});assert.equal(app._meta.consoleSnapshot.project,a);
    await assert.rejects(stat(join(a,'.codex')),{code:'ENOENT'});await assert.rejects(stat(join(b,'.agents')),{code:'ENOENT'});
    await f.run(['configure','--project',b,'--model-id','project-override']);
    assert.equal(JSON.parse((await f.run(['configure','--project',b,'--show'])).stdout).inherits_global,false);
    await f.run(['configure','--model-id','new-global-default']);
    assert.equal((await call('get_models',{project:a})).default.model,'new-global-default');
    assert.equal((await call('get_models',{project:b})).default.model,'project-override');
  }finally{await client.close();await f.stopAll();}
});

test('global updates affect future tasks while old checkpoints retain provider, model, credential and budget',async t=>{
  const{root}=await environment(t);const project=join(root,'project'),folder=join(root,'global');await mkdir(project);await mkdir(folder);
  const oldKey=join(project,'old-key'),newKey=join(folder,'new-key');await writeFile(oldKey,'fake-old-key',{mode:0o600});await writeFile(newKey,'fake-new-key',{mode:0o600});
  const globalPath=join(folder,'global.json'),path=join(folder,'runtime.json');
  const template={schema_version:'0.1',scope:'global',workspace_root:folder,provider:'offline',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'original',api_key_file:oldKey,credential_source:'file'}}},tools:{isolation:'host'}};
  await atomicConfig(globalPath,template);await atomicConfig(path,{...template,scope:'project',workspace_root:project,defaults_file:globalPath});
  let providerCalls=0;const engine=new Engine(await loadConfig(path),{testFetch:async()=>{providerCalls++;throw new Error('No provider calls allowed');}});let closed=false;t.after(()=>closed?undefined:engine.close());
  const original=(await engine.submit({goal:'Retain an old confirmed checkpoint',offline_script:[{name:'request_input',arguments:{question:'Hold'}},{name:'finish_task',arguments:{summary:'Old offline task resumed'}}]})).task;
  await until(()=>engine.get(original.id).status==='waiting_input');const before=engine.store.get(original.id);
  await atomicConfig(globalPath,{...template,provider:'compatible',models:{default:'worker',profiles:{worker:{...template.models.profiles.worker,model:'new-default',api_key_file:newKey}}}});
  engine.active={id:'fixture-block-pump'};
  await engine.refreshDefaults();const next=(await engine.submit({goal:'Capture new global defaults without executing'})).task;
  assert.equal(next.model_info.model,'new-default');assert.equal(next.model_info.provider_mode,'compatible');
  const retained=engine.store.get(original.id);assert.equal(retained.profile.model,'original');assert.equal(retained.profile.api_key_file,oldKey);assert.deepEqual(retained.spec.budget,before.spec.budget);
  await assert.rejects(workspacePath(engine.config,{spec:{scope:{read:['.'],write:['.']}}},oldKey),{code:'PATH_SCOPE'});
  await engine.control(next.id,'cancel');engine.active=null;await engine.control(original.id,'resume');
  assert.equal((await completion(engine,original.id)).status,'completed');assert.equal(providerCalls,0);await engine.close();closed=true;
});

test('explicit migration backs up old config, preserves Key references and removes only shadowing project integration',async t=>{
  const f=await fixture(t);const project=join(f.root,'legacy project');await mkdir(project);
  const legacy=JSON.parse((await f.run(['init','--project',project,'--offline'])).stdout);
  await f.run(['configure','--config',legacy.config,'--key-stdin'],'fake-migration-key\n');
  await f.run(['stop-engine','--config',legacy.config]);
  const moved=JSON.parse(await readFile(legacy.config,'utf8'));moved.models.profiles.worker.api_key_file=join(project,'manual-key');await writeFile(moved.models.profiles.worker.api_key_file,'fake-migration-key\n',{mode:0o600});await writeFile(legacy.config,JSON.stringify(moved));
  const before=await readFile(legacy.config,'utf8'),old=JSON.parse(before);
  await writeFile(join(project,'.codex/config.toml'),(await readFile(join(project,'.codex/config.toml'),'utf8'))+'\n[mcp_servers.unrelated]\ncommand = \"other\"\n');
  const imported=JSON.parse((await f.run(['init','--from-project',project,'--offline'])).stdout);
  assert.equal(imported.migration.credential_copied,true);assert.equal(await readFile(imported.migration.legacy_backup,'utf8'),before);assert.equal(imported.migration.linked_global,true);
  const global=JSON.parse(await readFile(f.globalPath,'utf8'));assert.notEqual(global.models.profiles.worker.api_key_file,old.models.profiles.worker.api_key_file);assert.ok(global.models.profiles.worker.api_key_file.startsWith(join(f.home,'.config/dengagent/credentials')));assert.equal((await stat(global.models.profiles.worker.api_key_file)).mode&0o077,0);
  assert.equal(await readFile(global.models.profiles.worker.api_key_file,'utf8'),'fake-migration-key\n');assert.equal(await readFile(old.models.profiles.worker.api_key_file,'utf8'),'fake-migration-key\n');assert.ok(global.retired_credential_files.includes(old.models.profiles.worker.api_key_file));
  await assert.rejects(workspacePath(await loadConfig(legacy.config),{spec:{scope:{read:['.'],write:['.']}}},old.models.profiles.worker.api_key_file),{code:'PATH_SCOPE'});
  const migrated=parse(await readFile(join(project,'.codex/config.toml'),'utf8'));assert.equal(migrated.mcp_servers.dengagent,undefined);assert.equal(migrated.mcp_servers.unrelated.command,'other');
  await assert.rejects(stat(join(project,'.agents/skills/dengagent/SKILL.md')),{code:'ENOENT'});
  await f.stopAll();
});


test('project config binding prevents routing through a copied config for another root',async t=>{
  const f=await fixture(t);const a=join(f.root,'a'),b=join(f.root,'b');await mkdir(a);await mkdir(b);
  const initialized=JSON.parse((await f.run(['init','--project',a,'--offline'])).stdout);
  await writeFile(join(f.home,'.config/dengagent',`project-${hash(b).slice(0,16)}.json`),await readFile(initialized.config));
  await assert.rejects(f.run(['configure','--project',b,'--show']),error=>{assert.equal(JSON.parse(error.stderr).error.code,'CONFIG_PROJECT');return true;});
  await assert.rejects(stat(join(b,'.dengagent')),{code:'ENOENT'});await f.stopAll();
});

test('migration refuses a running project engine without stopping it or creating global settings',async t=>{
  const f=await fixture(t);const project=join(f.root,'running project');await mkdir(project);
  const initialized=JSON.parse((await f.run(['init','--project',project,'--offline'])).stdout);
  await f.run(['configure','--project',project,'--show']);const config=await loadConfig(initialized.config);const before=await request(config,'/health');
  try{
    await assert.rejects(f.run(['init','--from-project',project,'--offline']),error=>{assert.equal(JSON.parse(error.stderr).error.code,'MIGRATION_ENGINE_RUNNING');return true;});
    assert.equal((await request(config,'/health')).pid,before.pid);await assert.rejects(stat(f.globalPath),{code:'ENOENT'});
  }finally{await f.run(['stop-engine','--config',initialized.config]);await f.stopAll();}
});
