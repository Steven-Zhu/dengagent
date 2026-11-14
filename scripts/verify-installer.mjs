import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,stat,realpath,symlink,readlink } from 'node:fs/promises';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setTimeout as delay } from 'node:timers/promises';
import { terminal } from '../test/pty.mjs';

const installer=resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Pass the .command installer path');
const root=await realpath(await mkdtemp(join(tmpdir(),'deng-installer-proof-')));const project=join(root,'project with spaces');await mkdir(project);
const config=join(root,'config.json');const destination=join(root,'installed');
const home=join(root,'home');await mkdir(join(home,'.local','bin'),{recursive:true});
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:process.env.TMPDIR??'/tmp'};
const oldLauncher=join(destination,'versions','old-fixture','bin','deng');await mkdir(dirname(oldLauncher),{recursive:true});await writeFile(oldLauncher,'old fixture');
const launcher=join(home,'.local','bin','deng');await symlink(oldLauncher,launcher);
async function invoke(command,args,input=''){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdin.end(input);
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
  });
}
async function waitFor(fn){for(let attempt=0;attempt<400;attempt++){const result=await fn();if(result)return result;await delay(25);}throw new Error('Timed out');}
const installed=await terminal(['/bin/bash',installer,'--destination',destination,'--config',config,'--offline'],[
  {wait:'（回车使用默认目录）: ',send:oldLauncher+'\n'},
  {wait:'（回车使用默认目录）: ',send:"'"+project+"'\n"},
],{env,timeout:90000});
assert.equal(installed.code,0,installed.output);assert.equal(installed.steps,2);
assert.match(installed.output,/无法使用这个路径/);assert.match(installed.output,/项目接入完成/);assert.ok(!installed.output.includes('ExperimentalWarning'));
const codex=parse(await readFile(join(project,'.codex','config.toml'),'utf8'));const registration=codex.mcp_servers.dengagent;
const modelConfig=JSON.parse(await readFile(config,'utf8'));assert.equal(modelConfig.models.profiles.worker.base_url,'https://example.invalid/v1');
assert.ok(registration.command.startsWith(destination));assert.ok(!registration.command.includes('.cache/codex-runtimes'));
const node=registration.command,cli=registration.args[0];
assert.equal(await readlink(launcher),join(dirname(dirname(node)),'bin','deng'));
const linkedHelp=await invoke(launcher,['help']);assert.equal(linkedHelp.code,0,linkedHelp.stderr);assert.match(linkedHelp.stdout,/DengAgent/);
const originalConfig=await readFile(config,'utf8');
const repeated=await invoke('/bin/bash',[installer,'--destination',destination,'--project',project,'--config',config,'--offline']);
assert.equal(repeated.code,0,repeated.stdout+repeated.stderr);assert.match(repeated.stdout,/configuration_reused/);
assert.equal(await readFile(config,'utf8'),originalConfig);
const doctor=await invoke(node,[cli,'doctor','--config',config,'--probe']);assert.equal(doctor.code,0,doctor.stderr);assert.equal(JSON.parse(doctor.stdout).passed,true);
const configured=await invoke(node,[cli,'configure','--config',config,'--base-url','https://example.invalid/v1','--model-id','installed-settings-fixture','--key-stdin'],'fake-installed-credential\n');
assert.equal(configured.code,0,configured.stderr);assert.equal(JSON.parse(configured.stdout).model_calls,0);assert.ok(!configured.stdout.includes('fake-installed-credential'));
const connection=await invoke(node,[cli,'configure','--config',config,'--show']);assert.equal(connection.code,0,connection.stderr);
assert.equal(JSON.parse(connection.stdout).profiles[0].model,'installed-settings-fixture');assert.equal(JSON.parse(connection.stdout).profiles[0].key_configured,true);
assert.ok(!connection.stdout.includes('fake-installed-credential'));assert.ok(!connection.stdout.includes('api_key_file'));
await mkdir(join(project,'src'));await mkdir(join(project,'test'));
await writeFile(join(project,'test','fixed.test.mjs'),`import assert from 'node:assert/strict';import {double} from '../src/double.mjs';assert.equal(double(21),42);`);
const command={argv:['node','--test','test/fixed.test.mjs'],cwd:'.'};
await writeFile(join(project,'task.json'),JSON.stringify({goal:'Installed-package fixture: implement double and pass the fixed test',request_id:'installed-smoke',scope:{read:['.'],write:['src'],commands:[command]},acceptance:{commands:[command],required_files:['src/double.mjs']},offline_script:[{name:'write_file',arguments:{path:'src/double.mjs',content:'export const double=x=>x*2;\n'}},{name:'finish_task',arguments:{summary:'Installed-package OFFLINE fixture completed real file/test operations'}}]}));
const client=new Client({name:'deng-installer-verifier',version:'1.0.0'});
const transport=new StdioClientTransport({command:node,args:[cli,'mcp','--config',config],env,stderr:'pipe'});
let task,observation;
try{
  await client.connect(transport);
  const names=(await client.listTools()).tools.map(tool=>tool.name);assert.ok(names.includes('get_models')&&names.includes('set_model'));
  assert.ok(names.includes('prepare_console'));
  const prepared=JSON.parse((await client.callTool({name:'prepare_console',arguments:{}})).content[0].text);
  const page=await fetch(prepared.panel_url);assert.equal(page.status,200);assert.match(await page.text(),/EventSource/);
  const selected=await client.callTool({name:'set_model',arguments:{model:'installed-model-fixture'}});assert.ok(!selected.isError);
  assert.equal(JSON.parse(selected.content[0].text).selection_model_calls,0);
  const catalog=await invoke(node,[cli,'models','--config',config]);assert.equal(catalog.code,0,catalog.stderr);
  assert.equal(JSON.parse(catalog.stdout).default.model,'installed-model-fixture');
  const longCommand={argv:['node','-e',"console.log('installed-running');setTimeout(()=>{},60000)"],cwd:'.'};
  await writeFile(join(project,'switch-task.json'),JSON.stringify({goal:'Installed-package fixture: require manual pause before a model switch',scope:{read:['.'],commands:[longCommand]},offline_script:[
    {name:'run_command',arguments:longCommand},{name:'finish_task',arguments:{summary:'Installed switch fixture continued after explicit resume'}},
  ]}));
  const switching=JSON.parse((await client.callTool({name:'submit_task',arguments:{task_file:'switch-task.json'}})).content[0].text).task;
  await waitFor(async()=>{
    const page=JSON.parse((await client.callTool({name:'read_events',arguments:{task_id:switching.id,limit:100}})).content[0].text);
    return page.events.some(event=>event.type==='tool.output'&&event.payload.text.includes('installed-running'));
  });
  const denied=await client.callTool({name:'set_model',arguments:{model:'installed-switched-fixture',task_id:switching.id}});
  assert.equal(denied.isError,true);assert.equal(JSON.parse(denied.content[0].text).error.code,'MODEL_TASK_RUNNING');
  assert.equal(JSON.parse((await client.callTool({name:'get_task',arguments:{task_id:switching.id}})).content[0].text).status,'running');
  const paused=JSON.parse((await client.callTool({name:'control_task',arguments:{task_id:switching.id,action:'pause'}})).content[0].text);
  assert.equal(paused.status,'paused');
  const changed=JSON.parse((await client.callTool({name:'set_model',arguments:{model:'installed-switched-fixture',task_id:switching.id,expected_revision:paused.revision}})).content[0].text);
  assert.equal(changed.task.status,'paused');assert.deepEqual(changed.task.usage,paused.usage);
  assert.equal(changed.task.model_info.model,'installed-switched-fixture');
  const state=JSON.parse((await client.callTool({name:'get_task',arguments:{task_id:switching.id}})).content[0].text);
  assert.equal(state.status,'paused');assert.equal(state.usage.model_calls,paused.usage.model_calls);
  await client.callTool({name:'control_task',arguments:{task_id:switching.id,action:'resume'}});
  await waitFor(async()=>{
    const value=JSON.parse((await client.callTool({name:'get_task',arguments:{task_id:switching.id}})).content[0].text);
    if(['failed','budget_exceeded','cancelled'].includes(value.status))throw new Error(JSON.stringify(value));return value.status==='completed';
  });
  const result=await client.callTool({name:'submit_task',arguments:{task_file:'task.json'}});assert.ok(!result.isError,result.content[0]?.text);
  const submission=JSON.parse(result.content[0].text);
  assert.equal(submission.watch.panel_url,prepared.panel_url);
  assert.equal(submission.task.model_info.model,'installed-model-fixture');
  // Observe through the installed, self-contained executable with no Node/npm on PATH.
  const watcher=invoke(submission.watch.executable,submission.watch.args);
  task=await waitFor(async()=>{
    const state=await client.callTool({name:'get_task',arguments:{task_id:submission.task.id}});const value=JSON.parse(state.content[0].text);
    if(['failed','budget_exceeded','cancelled'].includes(value.status))throw new Error(JSON.stringify(value));return value.status==='completed'?value:null;
  });
  observation=await watcher;assert.equal(observation.code,0,observation.stderr);assert.match(observation.stdout,/\[Deng model\] worker \/ installed-model-fixture/);assert.match(observation.stdout,/acceptance.completed/);
  assert.equal(task.acceptance.passed,true);assert.equal(task.acceptance.checks.find(check=>check.type==='command').code,0);
  assert.equal(task.effective_isolation,'macos-write-network');assert.equal(await readFile(join(project,'src','double.mjs'),'utf8'),'export const double=x=>x*2;\n');
}finally{
  await client.close();await invoke(node,[cli,'stop-engine','--config',config]);
}
const proof={passed:true,installer,installer_bytes:(await stat(installer)).size,installer_sha256:createHash('sha256').update(await readFile(installer)).digest('hex'),verified_at:new Date().toISOString(),workspace:root,
  checks:['single-file extraction','bundled Node and dependencies without development PATH','real terminal setup rejects an existing file as project path','Finder-quoted project path with spaces','no SQLite initialization warning in setup','managed launcher updates to installed build','repeat install preserves existing model configuration','first-run Codex MCP and skill installation','offline native-tool probe','installed connection configuration through stdin without Key echo','public installed connection metadata without Key paths','installed MCP model selection without model calls','CLI model metadata','running-task switch rejected without stopping','manual pause then switch preserves usage and stays paused','explicit resume continues with selected model','installed MCP task submission with selected default','real scoped file write','real fixed test through macOS sandbox','direct terminal event observation with model banner','compact result and usage','explicit engine shutdown'],
  task_id:task.id,model_info:task.model_info,usage:task.usage,real_provider_tested:false,note:'Deterministic model fixture; actual Pi, tools, processes, IPC, MCP and packaged runtime executed.'};
await writeFile(join(root,'verification.json'),JSON.stringify(proof,null,2)+'\n');process.stdout.write(JSON.stringify(proof,null,2)+'\n');
