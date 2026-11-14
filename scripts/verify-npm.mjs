import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {parse} from 'smol-toml';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {terminal} from '../test/pty.mjs';

const{values}=parseArgs({options:{package:{type:'string'},'npm-cli':{type:'string'},out:{type:'string'}}});
if(!values.package)throw new Error('Pass --package PATH');
const npm=resolve(values['npm-cli']??process.env.npm_execpath??'');if(!npm.endsWith('npm-cli.js'))throw new Error('Pass --npm-cli PATH');
const archive=resolve(values.package),root=await realpath(await mkdtemp(join(tmpdir(),'deng-npm-global-proof-')));
const prefix=join(root,'global prefix'),home=join(root,'offline user'),onlineHome=join(root,'online settings user'),launch=join(root,'unrelated launch folder'),a=join(root,'project A'),b=join(root,'project B');
for(const path of[prefix,home,onlineHome,launch,a,b])await mkdir(path);
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:process.env.TMPDIR??'/tmp',npm_config_userconfig:join(home,'empty.npmrc'),TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''},onlineEnv={...env,HOME:onlineHome};
const launcher=join(prefix,'bin/deng'),app=join(prefix,'lib/node_modules/dengagent'),globalPath=join(home,'.config/dengagent/global.json'),onlinePath=join(onlineHome,'.config/dengagent/global.json');
const npmArgs=['--prefix',prefix,'--cache',join(root,'npm-cache'),'--no-audit','--no-fund','--offline'];
function invoke(command,args,{input='',environment=env}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{env:environment,cwd:launch,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),90000);
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(input);
 });
}
async function run(args,options){const result=await invoke(launcher,args,options);assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}
let client,proof;const started=[];
async function stop(args,environment=env){await invoke(launcher,['stop-engine',...args],{environment}).catch(()=>{});}
async function verifyInstalledRecovery(){
 const project=join(root,'installed native closure');await mkdir(project);await mkdir(join(project,'work'));
 const credential=join(root,'fake-native.credential');await writeFile(credential,'fake-installed-loopback-key\n',{mode:0o600});
 const {Engine}=await import(pathToFileURL(join(app,'src/engine.mjs')));
 const {normalizeConfig}=await import(pathToFileURL(join(app,'src/config.mjs')));
 const digest=value=>createHash('sha256').update(value).digest('hex');let calls=0,auth=false;const recorded=[];
 const server=http.createServer(async(req,res)=>{
  const parts=[];for await(const chunk of req)parts.push(chunk);const body=JSON.parse(Buffer.concat(parts));recorded.push(body);calls++;
  if(auth){res.writeHead(401);res.end('private fixture error body');return;}
  assert.equal(body.thinking.type,'enabled');assert.equal(body.reasoning_effort,'low');assert.equal(body.max_tokens,calls===1?32768:8192);
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason}]})+'\n\n');
  if(calls>=3)emit({reasoning_content:'private-installed-reasoning-'+calls});
  if(calls===1){emit({tool_calls:[{index:0,id:'broken',type:'function',function:{name:'write_file',arguments:'{"path":"work/partial'}}]});emit({},'length');}
  else if(calls===2){emit({content:'<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="write_file">unexecuted</｜｜DSML｜｜ calls>'});emit({},'stop');}
  else{
   const action=calls===3?{name:'write_file',args:{path:'work/result.txt',content:'one\n'}}:calls===4?{name:'append_file',args:{path:'work/result.txt',content:'two\n',expected_sha256:digest('one\n')}}:{name:'finish_task',args:{summary:'Installed protocol closure passed'}};
   emit({tool_calls:[{index:0,id:'native-'+calls,type:'function',function:{name:action.name,arguments:JSON.stringify(action.args)}}]});emit({},'tool_calls');
  }
  res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:25}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let engine;
 try{
  const config=await normalizeConfig({workspace_root:project,provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:'http://127.0.0.1:'+server.address().port+'/v1',model:'deepseek/deepseek-flash',api_key_file:credential,credential_source:'file'}}},tools:{isolation:'macos'}},join(root,'installed-native-config.json'));
  engine=new Engine(config);
  const command={argv:['node','-e',"if(require('fs').readFileSync('result.txt','utf8')!=='one\\ntwo\\n')process.exit(9)"],cwd:'work'};
  const {task}=await engine.submit({goal:'Installed native tools recover a length error and DSML text without replaying partial writes',scope:{read:['work'],write:['work']},acceptance:{commands:[command],required_files:['work/result.txt']}});
  const wait=async id=>{for(let i=0;i<400;i++){const value=engine.get(id);if(['completed','failed','waiting_input','budget_exceeded'].includes(value.status))return value;await delay(25);}throw new Error('Installed recovery timed out');};
  const done=await wait(task.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.acceptance.passed,true);assert.equal(done.repairs,2);assert.equal(calls,5);
  for(const turn of recorded[4].messages.filter(m=>m.role==='assistant'))assert.match(turn.reasoning_content,/^private-installed-reasoning-/);
  assert.ok(!JSON.stringify(engine.store.events(task.id,0,500)).includes('private-installed-reasoning-'));
  assert.equal(await readFile(join(project,'work/result.txt'),'utf8'),'one\ntwo\n');await assert.rejects(stat(join(project,'work/partial')),{code:'ENOENT'});
  assert.deepEqual(done.recovery_history.map(x=>x.code),['OUTPUT_TRUNCATED','TOOL_PROTOCOL_MISMATCH']);
  await delay(20);auth=true;const rejected=(await engine.submit({goal:'Verify installed HTTP failure class and reservation'})).task;
  const failure=await wait(rejected.id);assert.equal(failure.error.code,'UPSTREAM_HTTP');assert.equal(failure.usage_accounting.settled_tokens,0);assert.ok(failure.usage_accounting.unknown_reserved_tokens>0);assert.equal(calls,6);
  return {passed:true,loopback_http_calls:calls,real_provider_calls:0,recovery_chain:['OUTPUT_TRUNCATED','TOOL_PROTOCOL_MISMATCH'],native_write_append_and_fixed_check:true,http_401_reservation:true,reasoning_replay:true,requested_effort:'low',wire_effort:'low',max_output_tokens:32768};
 }finally{await engine?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
try{
 const installed=await invoke(process.execPath,[npm,'install','--global',archive,...npmArgs]);assert.equal(installed.code,0,installed.stderr);
 await assert.rejects(stat(join(home,'.config/dengagent')),{code:'ENOENT'});await assert.rejects(stat(join(launch,'.codex')),{code:'ENOENT'});
 const manifest=JSON.parse(await readFile(join(app,'package.json'),'utf8'));const versionCheck=await invoke(launcher,['--version']);assert.equal(versionCheck.code,0,versionCheck.stderr);assert.equal(versionCheck.stdout.trim(),manifest.version);
 // Normal first-time user setup has no project-folder prompt or provider/model defaults.
 const online=await terminal([launcher,'init'],[
  {wait:'Model base URL / 模型接口（必填）: ',send:'https://npm-fixture.invalid/v1\n'},
  {wait:'Model ID / 模型名称（必填）: ',send:'online-fixture-model\n'},
  {wait:'API Key（',send:'\r'},
 ],{env:onlineEnv,cwd:launch});assert.equal(online.code,0,online.output);assert.equal(online.steps,3);assert.match(online.output,/用户级接入完成/);assert.ok(!online.output.includes('Project folder'));
 const timed=JSON.parse(await readFile(onlinePath,'utf8'));timed.idle_shutdown_ms=1000;await writeFile(onlinePath,JSON.stringify(timed));
 started.push({args:['--global'],env:onlineEnv});
 const edited=await terminal([launcher,'configure'],[
  {wait:'API URL（留空保留）',send:'\n'},
  {wait:'模型 ID（留空保留）',send:'\n'},
  {wait:'API Key（不回显',send:'fake-installed-global-key\r',delay_ms:2400},
  {wait:'保存连接设置？',send:'\n',delay_ms:2400},
 ],{env:onlineEnv,cwd:launch});assert.equal(edited.code,0,edited.output);assert.equal(edited.steps,4);assert.ok(!edited.output.includes('fake-installed-global-key'));
 const publicSettings=await run(['configure','--show'],{environment:onlineEnv});assert.equal(publicSettings.scope,'global');assert.equal(publicSettings.profiles[0].context_window,262144);assert.equal(publicSettings.profiles[0].max_output_tokens,32768);assert.equal(publicSettings.profiles[0].timeout_ms,300000);assert.equal(publicSettings.profiles[0].thinking,'enabled');assert.equal(publicSettings.profiles[0].reasoning_effort,'low');assert.equal(publicSettings.budget.max_total_tokens,16000000);assert.equal(publicSettings.profiles[0].key_configured,true);assert.ok(!JSON.stringify(publicSettings).includes('api_key_file'));
 const onlineConsole=await run(['console'],{environment:onlineEnv});assert.match(await(await fetch(onlineConsole.panel_url)).text(),/settings-form/);await stop(['--global'],onlineEnv);
 const legacy=join(root,'legacy online project');await mkdir(legacy);
 const old=await run(['init','--project',legacy,'--offline'],{environment:onlineEnv});
 const oldText=await readFile(old.config,'utf8'),globalBeforeMigration=await readFile(onlinePath,'utf8');
 const migrated=await run(['init','--from-project',legacy,'--offline'],{environment:onlineEnv});
 assert.equal(migrated.migration.existing_global_preserved,true);assert.equal(migrated.migration.linked_global,true);
 assert.equal(await readFile(migrated.migration.legacy_backup,'utf8'),oldText);assert.equal(await readFile(onlinePath,'utf8'),globalBeforeMigration);
 assert.equal(parse(await readFile(join(legacy,'.codex/config.toml'),'utf8')).mcp_servers?.dengagent,undefined);
 await assert.rejects(stat(join(legacy,'.agents/skills/dengagent/SKILL.md')),{code:'ENOENT'});
 // A second isolated user uses deterministic offline execution; no real provider is called.
 const initialized=await run(['init','--offline']);assert.equal(initialized.scope,'global');
 const registration=parse(await readFile(join(home,'.codex/config.toml'),'utf8')).mcp_servers.dengagent;
 assert.deepEqual(registration.args,[join(app,'bin/deng.mjs'),'mcp','--global']);assert.ok(!JSON.stringify(registration).includes('_npx'));
 const skill=await readFile(join(home,'.agents/skills/dengagent/SKILL.md'),'utf8');assert.ok(skill.includes('使用 Deng 开发')&&skill.includes('使用 DengAgent 开发'));assert.ok(skill.includes('EVERY tool call'));
 started.push({args:['--global'],env});await run(['configure','--key-stdin'],{input:'fake-offline-presence-key\n'});
 const command={argv:['node','--test','test/fixed.test.mjs'],cwd:'.'};await mkdir(join(a,'src'));await mkdir(join(a,'test'));
 await writeFile(join(a,'test/fixed.test.mjs'),"import assert from 'node:assert/strict';import {answer} from '../src/answer.mjs';assert.equal(answer,42);\n");
 await writeFile(join(a,'task.json'),JSON.stringify({goal:'Write only in project A and pass a real fixed test',scope:{read:['.'],write:['src'],commands:[command]},acceptance:{commands:[command],required_files:['src/answer.mjs']},offline_script:[{name:'write_file',arguments:{path:'src/answer.mjs',content:'export const answer=42;\n'}},{name:'finish_task',arguments:{summary:'Global MCP A fixture passed'}}]}));
 await writeFile(join(b,'task.json'),JSON.stringify({goal:'Write only the selected project B result',scope:{read:['.'],write:['.']},acceptance:{required_files:['answer.txt']},offline_script:[{name:'write_file',arguments:{path:'answer.txt',content:'project B'}},{name:'finish_task',arguments:{summary:'Global MCP B fixture passed'}}]}));
 client=new Client({name:'global-npm-verifier',version:'1.0.0'});await client.connect(new StdioClientTransport({command:registration.command,args:registration.args,env,cwd:launch,stderr:'pipe'}));
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result.content));return JSON.parse(result.content[0].text);};
 const tools=(await client.listTools()).tools;assert.ok(tools.find(t=>t.name==='submit_task').inputSchema.required.includes('project'));
 started.push({args:['--project',a],env},{args:['--project',b],env});
 const[pa,pb]=await Promise.all([call('prepare_console',{project:a}),call('prepare_console',{project:b})]);assert.notEqual(pa.panel_url,pb.panel_url);
 const[ta,tb]=await Promise.all([call('submit_task',{project:a,task_file:'task.json'}),call('submit_task',{project:b,task_file:'task.json'})]);
 for(const[project,task]of[[a,ta.task],[b,tb.task]]){
  let value;for(let i=0;i<400;i++){value=await call('get_task',{project,task_id:task.id});if(value.status==='completed')break;if(['failed','budget_exceeded','waiting_input'].includes(value.status))throw new Error(JSON.stringify(value.error));await delay(25);}
  assert.equal(value.status,'completed');assert.equal(value.checks.final,true);
 }
 assert.equal(await readFile(join(a,'src/answer.mjs'),'utf8'),'export const answer=42;\n');assert.equal(await readFile(join(b,'answer.txt'),'utf8'),'project B');assert.equal(await readFile(join(a,'.dengagent/.gitignore'),'utf8'),'*\n');
 const wrong=await client.callTool({name:'get_task',arguments:{project:b,task_id:ta.task.id}});assert.equal(JSON.parse(wrong.content[0].text).error.code,'NOT_FOUND');
 await assert.rejects(stat(join(a,'.codex')),{code:'ENOENT'});await assert.rejects(stat(join(b,'.agents')),{code:'ENOENT'});
 await run(['configure','--model-id','updated-global-default']);assert.equal((await call('get_models',{project:a})).default.model,'updated-global-default');assert.equal((await call('get_task',{project:a,task_id:ta.task.id})).model_info.model,ta.task.model_info.model);
 await run(['configure','--project',b,'--model-id','project-specific']);await run(['configure','--model-id','third-global-default']);
 assert.equal((await call('get_models',{project:a})).default.model,'third-global-default');assert.equal((await call('get_models',{project:b})).default.model,'project-specific');
 const recovery=await verifyInstalledRecovery();
 let dependencies=0;const lock=JSON.parse(await readFile(join(app,'npm-shrinkwrap.json'),'utf8'));for(const[location,item]of Object.entries(lock.packages)){if(!location)continue;assert.equal(JSON.parse(await readFile(join(app,location,'package.json'),'utf8')).version,item.version,location);dependencies++;}
 await client.close();client=null;for(const item of started)await stop(item.args,item.env);
 const before=await readFile(globalPath,'utf8');const reinstalled=await invoke(process.execPath,[npm,'install','--global',archive,...npmArgs]);assert.equal(reinstalled.code,0,reinstalled.stderr);await run(['init','--offline']);assert.equal(await readFile(globalPath,'utf8'),before);
 const removed=await invoke(process.execPath,[npm,'uninstall','--global','dengagent',...npmArgs]);assert.equal(removed.code,0,removed.stderr);assert.equal(await readFile(globalPath,'utf8'),before);assert.equal(await readFile(join(b,'answer.txt'),'utf8'),'project B');
 proof={passed:true,recovery,version:manifest.version,node:process.version,platform:process.platform,arch:process.arch,package_file:archive.split('/').at(-1),package_sha256:createHash('sha256').update(await readFile(archive)).digest('hex'),locked_dependencies_verified:dependencies,verified_at:new Date().toISOString(),real_provider_tested:false,checks:['offline npm global install','no user/project setup during npm install','global first-run URL/model/hidden-Key prompts without a project prompt','user-wide Codex MCP and skill registration','backed-up legacy migration removes shadowing project integration and preserves existing user connection','stable installed package path','configure works from unrelated cwd','delayed input exceeds fixture idle timeout and still saves','public metadata omits Key values and paths','global settings browser console reachable','global MCP explicitly requires project on every tool','two projects run concurrently without per-project init','separate project console endpoints and ledgers','cross-project task lookup rejected','real scoped file writes','fixed test through macOS command sandbox','global updates refresh future defaults without rewriting old task snapshots','project override survives later global updates','every bundled dependency matches lock','reinstall and repeated init preserve settings','uninstall preserves settings, credentials and project outputs']};
 if(values.out)await writeFile(resolve(values.out),JSON.stringify(proof,null,2)+'\n');process.stdout.write(JSON.stringify(proof,null,2)+'\n');
}finally{await client?.close();if(!proof)for(const item of started)await stop(item.args,item.env);if(proof)await rm(root,{recursive:true,force:true});}
