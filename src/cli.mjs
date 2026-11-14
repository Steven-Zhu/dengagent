import { parseArgs } from 'node:util';
import { readFile,writeFile,mkdir,stat,lstat,realpath } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig,normalizeConfig,getCredential,safeError,DengError,stopped,validateEndpoint } from './config.mjs';
import { hash } from './store.mjs';
import { privateWrite } from './paths.mjs';
import { startHost,ensureHost,request,prepareConsole } from './host.mjs';
import { setupCodex,migrateProjectIntegration } from './setup.mjs';
import { VERSION } from './version.mjs';
import { chooseProject } from './setup-prompts.mjs';
import {settingsRoot,globalConfigPath,loadGlobal,resolveProject,importGlobal,projectConfigPath,linkLegacy} from './global.mjs';
import {recommendedGeneration,recommendedTotalTokens,generationOptions} from './model-options.mjs';

const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const help=`DengAgent ${VERSION} — Pi agent-core + your configured worker model

  init [--global] [--offline]                    Configure user connection and install user-wide MCP + skill once
        [--from-project PATH]                     Migrate a legacy project; private file Keys are copied without display
        [--project PATH] [--config PATH]           Legacy project-specific integration / override
        [--base-url URL --model-id ID]             Required in noninteractive first-time online setup; no provider defaults
        [--json]                                  Machine-readable completion; terminal default is a readable summary
  configure [--project PATH] [--config PATH]        Edit user connection by default; --project creates/edits an override
        [--show] [--advanced] [--probe]             Show settings; optional one-request billable connection test
        [--base-url URL] [--model-id ID] [--key-stdin]  Noninteractive configuration; never put a Key in argv
        [--recommended]                            Apply 256K context, 32K output, 5min, thinking on/low, 16M future-task tokens
        [--thinking enabled|disabled|provider-default] [--reasoning-effort low|medium|high|max]
        [--timeout-ms MS] [--max-total-tokens N] [--max-model-calls N|unlimited] [--reasoning-format auto|deepseek|openai|none]
  doctor --config PATH                            Static checks, no model calls
  doctor --config PATH --probe                    Small billable native-tool/streaming probe
  setup --config PATH [--apply]                   Preview/apply MCP + skill registration
  run --config PATH --task PATH [--watch]          Submit a task; optional live foreground observer
  watch TASK_ID --config PATH                     Observe; Ctrl+C only disconnects
  observe TASK_ID --config PATH                   Open task-specific live console; prints panel URL
  console --config PATH                           Prepare reusable live console before submitting work
  status [TASK_ID] --config PATH                   Compact task state
  models --config PATH                            List default, configured profiles and task models (no model calls)
  model [PROFILE_OR_MODEL] --config PATH           Select future-task default; interactive menu when omitted
        [--task TASK_ID] [--profile PROFILE]       Change a stopped task; never pauses or resumes it
  pause|cancel TASK_ID --config PATH               Stop and wait for acknowledgement
  resume TASK_ID --config PATH [--input PATH]       Continue with original budget/deadline
        [--allow-unknown-usage] [--allow-unknown-commands]  Explicitly acknowledge inspected unknown outcomes
  input TASK_ID --config PATH --input PATH          Queue same-scope steering; does not resume stopped work
  delivery TASK_ID --config PATH                   Recheck completed artifact hashes without model calls
  artifact TASK_ID --config PATH                   Read delivery evidence
  mcp [--global]                                  User-wide router; every tool names its project
        --config PATH                              Legacy fixed-project MCP adapter
  stop-engine --config PATH                       Pause active work and stop engine

Install with npm and Node.js 24+. Run deng init once for user-wide integration.
Connection settings default to user scope; execution uses --project PATH or the CLI cwd.
Global MCP tools always require an explicit absolute project path.
`;
async function secretPrompt(label){
  const input=process.stdin;const wasRaw=input.isRaw;input.setRawMode(true);
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error)=>{input.off('data',onData);input.setRawMode(Boolean(wasRaw));input.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const onData=chunk=>{for(const character of chunk.toString('utf8')){
      if(character==='\r'||character==='\n'){finish();return;}
      if(character==='\u0003'){finish(new DengError('CANCELLED','Setup cancelled'));return;}
      if(character==='\u007f'||character==='\b')value=value.slice(0,-1);else if(character>=' ')value+=character;
    }};input.on('data',onData);input.resume();process.stdout.write(label);
  });
}
async function initStep(phase,action,{connectionSaved}={}){
  try{return await action();}catch(error){
    const safe=safeError(error),failure=new DengError(safe.code,safe.message);
    failure.phase=phase;if(connectionSaved!==undefined)failure.connection_saved=connectionSaved;
    throw failure;
  }
}
export async function initialize(values){
  if(process.stdin.isTTY&&!values.json)process.stdout.write(`DengAgent ${VERSION} · 项目初始化\n`);
  if(values.global&&(values.project||values.config))throw new DengError('SETUP_SCOPE','Use --from-project PATH to import a legacy project into global settings.');
  let imported;if(values.global&&values['from-project'])imported=await importGlobal(values['from-project']);
  const register=(config,options)=>setupCodex(config,{...options,user:Boolean(values.global)});
  let project=values.global?settingsRoot():values.project;
  if(!project&&process.stdin.isTTY)project=await chooseProject();
  if(!project)throw new DengError('PROJECT','Specify --project PATH');
  project=resolve(project);project=await initStep('project_directory',async()=>{await mkdir(project,{recursive:true});return realpath(project);});
  const configFile=values.global?globalConfigPath():resolve(values.config??join(homedir(),'.config','dengagent',`project-${hash(project).slice(0,16)}.json`));
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const settingsCommands={configure_command:`deng configure --config ${quote(configFile)}`,console_command:`deng console --config ${quote(configFile)}`};
  const existing=await initStep('configuration_read',async()=>{try{await stat(configFile);return true;}catch(error){if(error.code!=='ENOENT')throw error;return false;}});
  if(existing){
    let loaded=await initStep('configuration_read',()=>loadConfig(configFile));
    if(loaded.workspace_root!==await realpath(project))throw new DengError('CONFIG_PROJECT','Existing configuration belongs to another project; choose its project or a different config path');
    await initStep('codex_validation',()=>register(loaded,{apply:false}),{connectionSaved:false});
    let connection;
    if(process.stdin.isTTY&&!values.offline){
      process.stdout.write('检测到已有项目配置，继续核对或修改连接。URL、模型和 Key 留空会保留原值；Key 不会显示。\n');
      const {configureCli}=await import('./configure-cli.mjs');
      connection=await initStep('connection_settings',()=>configureCli(loaded,values,{secretPrompt}));
      loaded=await initStep('configuration_reload',()=>loadConfig(configFile),{connectionSaved:Boolean(connection.saved)});
    }
    const {connectionSettings}=await import('./connection.mjs');
    const settings=await initStep('configuration_read',()=>connectionSettings(loaded),{connectionSaved:Boolean(connection?.saved)});
    const selected=settings.profiles.find(profile=>profile.profile===settings.default_profile);
    const installation=await initStep('codex_registration',()=>register(loaded,{apply:true}),{connectionSaved:Boolean(connection?.saved)});
    if(imported){Object.assign(imported,await linkLegacy(imported.imported_from));imported.project_integration=await initStep('codex_registration',async()=>migrateProjectIntegration(await loadConfig(projectConfigPath(imported.imported_from)),{apply:true}),{connectionSaved:true});}
    return {config:configFile,provider:loaded.provider,configuration_reused:true,...(imported?{migration:imported}:{}),connection_edit_cancelled:Boolean(connection?.cancelled),key_configured:selected?.key_configured??false,...installation,...settingsCommands,next:'在项目目录运行 deng configure 修改连接和 Key，或运行 deng console 打开输出的 panel_url，在连接设置中修改。请重新加载/信任此项目或新开 Codex 会话。'};
  }
  let endpoint=values['base-url']?.trim()??'',model=values['model-id']?.trim()??'';
  if(values.offline){endpoint||='https://example.invalid/v1';model||='offline-fixture';}
  if(process.stdin.isTTY&&!values.offline){
    const rl=createInterface({input:process.stdin,output:process.stdout});
    const controller=new AbortController();const cancel=()=>controller.abort();rl.once('SIGINT',cancel);rl.once('close',cancel);
    try{
      while(!endpoint){
        const value=(await rl.question('Model base URL / 模型接口（必填）: ',{signal:controller.signal})).trim();
        try{validateEndpoint(value);endpoint=value;break;}catch{process.stdout.write('请输入有效的 HTTPS API 基址，不包含 Key、查询参数或片段。\n');}
      }
      while(!model){
        const value=(await rl.question('Model ID / 模型名称（必填）: ',{signal:controller.signal})).trim();
        if(value.length>0&&value.length<=256){model=value;break;}process.stdout.write('请输入模型 ID，长度为 1–256 个字符。\n');
      }
    }catch{throw new DengError('CANCELLED','模型配置已取消，尚未保存配置或 Key。');}finally{rl.close();}
  }
  if(!endpoint||!model)throw new DengError('MODEL_REQUIRED','首次配置没有默认模型接口或模型名称。请在终端运行 deng init，或提供 --base-url URL --model-id ID。');
  validateEndpoint(endpoint);
  if(model.length>256)throw new DengError('CONFIG','模型 ID 不能超过 256 个字符。');
  const {max_total_tokens=recommendedTotalTokens,max_model_calls=null,reasoning_format='auto',...generation}=generationOptions(values);
  const profile={...recommendedGeneration,...generation,compat:{reasoning_format},base_url:endpoint,model,api_key_env:validateEndpoint(endpoint).hostname==='api.lkeap.cloud.tencent.com'?'TENCENT_TOKENHUB_API_KEY':'DENG_API_KEY'};
  const config={schema_version:'0.1',scope:values.global?'global':'project',...(values.global?{data_dir:join(settingsRoot(),'settings-engine')}:{}),workspace_root:project,provider:values.offline?'offline':'compatible',models:{default:'worker',profiles:{worker:profile}},budget:{max_total_tokens,max_model_calls},tools:{isolation:'macos'}};
  await initStep('codex_validation',async()=>register(await normalizeConfig(config,configFile),{apply:false}),{connectionSaved:false});
  if(!values.offline&&!process.env[profile.api_key_env]&&process.stdin.isTTY){
    const secret=await secretPrompt('API Key（输入不回显；留空跳过，稍后在项目目录运行 deng configure，或 deng console → 连接设置）: ');
    if(secret){const path=configFile+'.credential';await initStep('credential_write',()=>privateWrite(path,secret+'\n'),{connectionSaved:false});profile.api_key_file=path;profile.credential_source='file';}
  }
  await initStep('configuration_write',()=>privateWrite(configFile,JSON.stringify(config,null,2)+'\n'),{connectionSaved:false});
  const loaded=await initStep('configuration_reload',()=>loadConfig(configFile),{connectionSaved:true});
  const installation=await initStep('codex_registration',()=>register(loaded,{apply:true}),{connectionSaved:true});
  if(!values.global)await initStep('project_ignore',async()=>{
  const ignore=join(project,'.gitignore');let original='';try{original=await readFile(ignore,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  try{if((await lstat(ignore)).isSymbolicLink())throw new DengError('SETUP_SYMLINK','Setup refuses a symlinked .gitignore');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!original.split('\n').includes('.dengagent/'))await writeFile(ignore,original+(original&&!original.endsWith('\n')?'\n':'')+'.dengagent/\n');
  },{connectionSaved:true});
  return{config:configFile,provider:config.provider,...installation,...settingsCommands,key_configured:Boolean(profile.api_key_file||process.env[profile.api_key_env]?.trim()),next:'项目接入完成。请重新加载/信任此项目或新开 Codex 会话。在项目目录运行 deng configure 补填或修改 Key、URL 和模型；也可运行 deng console，打开输出的 panel_url，在连接设置中填写。配置输出仅含文件路径，不显示 Key。'};
}
function printInitialization(result,{json=false}={}){
  if(json||!process.stdout.isTTY){print(result);return;}
  process.stdout.write(result.scope==='global'?`\n用户级接入完成。新会话可调用 Deng，无需为每个项目重复安装。\n连接配置：${result.config}\n`:`\n项目接入完成${result.configuration_reused?'（已有项目）':''}。\n项目目录：${result.project}\n配置文件：${result.config}\n`);
  if(result.connection_edit_cancelled)process.stdout.write('连接修改已取消，原连接配置已保留。\n');
  process.stdout.write(result.provider==='offline'?'运行模式：离线验收，不调用真实模型。\n':`API Key：${result.key_configured?'已配置（不显示）':'未配置，可稍后补填'}\n`);
  process.stdout.write(`修改连接：${result.configure_command}\n浏览器设置：${result.console_command}\n运行控制台命令后打开输出的 panel_url，在“连接设置”中修改。\n请在 Codex 重启 MCP 或新开会话；调用时明确目标项目。Key 值不会显示在完成信息或配置 JSON 中。\n`);
}
async function watch(config,id,{pauseOnInterrupt=false,json=false}={}){
  let interrupted=false,after=0;
  const interrupt=()=>{interrupted=true;};process.on('SIGINT',interrupt);
  try{
    if(!json){
      const task=await request(config,`/tasks/${id}`);
      process.stdout.write(`[Deng model] ${task.model_info.profile??'legacy'} / ${task.model_info.model} (${task.model_info.provider_mode??config.provider}) | ${task.model_info.base_url}\n`);
    }
    while(!interrupted){
      const page=await request(config,`/tasks/${id}/events?after=${after}&limit=100`);
      for(const event of page.events){
        if(json)process.stdout.write(JSON.stringify(event)+'\n');
        else if(event.type==='model.text_delta')process.stdout.write(event.payload.text);
        else if(event.type==='tool.output')process.stdout.write(event.payload.text);
        else process.stdout.write(`\n[${event.type}] ${JSON.stringify(event.payload)}\n`);
      }
      after=page.next_seq;
      // Drain event pages before terminating the observer.
      if(stopped(page.task.status)&&page.events.length<100){print({task:page.task});return page.task;}
      await delay(150);
    }
    if(pauseOnInterrupt){const task=await request(config,`/tasks/${id}/control`,'POST',{action:'pause'});print({task});return task;}
    process.stdout.write('\nObserver disconnected. Deng task continues; use deng pause to stop it.\n');
  }finally{process.off('SIGINT',interrupt);}
}
async function main(){
  const command=process.argv[2];if(!command||['help','--help','-h'].includes(command)){process.stdout.write(help);return;}
  if(['--version','-v'].includes(command)){process.stdout.write(`${VERSION}\n`);return;}
  const parsed=parseArgs({args:process.argv.slice(3),allowPositionals:true,options:{config:{type:'string'},project:{type:'string'},task:{type:'string'},profile:{type:'string'},input:{type:'string'},watch:{type:'boolean'},json:{type:'boolean'},apply:{type:'boolean'},probe:{type:'boolean'},offline:{type:'boolean'},show:{type:'boolean'},advanced:{type:'boolean'},'base-url':{type:'string'},'model-id':{type:'string'},'key-stdin':{type:'boolean'},'reuse-credential':{type:'boolean'},'context-window':{type:'string'},'max-output-tokens':{type:'string'},'thinking':{type:'string'},'reasoning-effort':{type:'string'},'reasoning-format':{type:'string'},'timeout-ms':{type:'string'},'max-total-tokens':{type:'string'},'max-model-calls':{type:'string'},recommended:{type:'boolean'},'allow-unknown-usage':{type:'boolean'},'allow-unknown-commands':{type:'boolean'},global:{type:'boolean'},'from-project':{type:'string'}}});
  const {values,positionals}=parsed;
  if(command==='init'){
    values.global=values.global||Boolean(values['from-project'])||(!values.project&&!values.config);
    printInitialization(await initialize(values),values);return;
  }
  if(command==='mcp'&&!values.config&&!values.project){const{startMcp}=await import('./mcp.mjs');await startMcp(null,{global:true});return;}
  const userCommand=['configure','console','models','doctor','setup'].includes(command);
  let config;
  try{
    if(values.config)config=await loadConfig(values.config);
    else if(values.project)config=await resolveProject(await realpath(resolve(values.project)));
    else if(values.global||userCommand)config=await loadGlobal();
    else config=await resolveProject(await realpath(resolve(values.project??process.cwd())));
  }catch(error){
    if(error.code==='ENOENT')throw new DengError('PROJECT_NOT_CONFIGURED','This project is not configured. Run deng init once for user-wide integration, or specify --project PATH / --config PATH.');
    throw error;
  }
  if(command==='configure'){const{configureCli}=await import('./configure-cli.mjs');print(await configureCli(config,values,{secretPrompt}));return;}
  if(command==='stop-engine'){
    try{print(await request(config,'/shutdown','POST',{}));}catch(error){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;print({stopping:false,reason:'Engine is not running'});}return;
  }
  if(command==='doctor'){
    await ensureHost(config);const selected=(await request(config,'/models')).default;
    if(!selected)throw new DengError('MODEL_PROFILE','Saved default profile is unavailable; use deng model to select a configured profile');
    if(config.defaults_file)config=await loadConfig(config.path);
    const profile={...config.models.profiles[selected.profile],model:selected.model};
    let credential=config.provider==='offline';try{if(!credential)credential=Boolean(await getCredential(profile));}catch{}
    if(!values.probe){print({ready:credential,node:process.version,runtime:'pi-agent-core 1.3.0',engine:await request(config,'/health'),provider:config.provider,model_info:selected,credential_present:credential,workspace:config.workspace_root,command_isolation:config.tools.isolation,network_tested:false});if(!credential)process.exitCode=1;return;}
    const {probeModel}=await import('./probe.mjs');print(await probeModel({...config,models:{default:selected.profile,profiles:{...config.models.profiles,[selected.profile]:profile}}}));return;
  }
  if(command==='setup'){if(values.global&&values.project){await loadGlobal();print(await migrateProjectIntegration(config,{apply:values.apply}));}else print(await setupCodex(config,{apply:values.apply,user:config.scope==='global'}));return;}
  if(command==='serve'){
    const host=await startHost(config);let closing=false;
    const close=async()=>{if(closing)return;closing=true;await host.close();};
    process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());return;
  }
  if(command==='mcp'){const{startMcp}=await import('./mcp.mjs');await startMcp(config);return;}
  await ensureHost(config,{allowActiveOlder:['status','watch','observe','artifact','pause','cancel'].includes(command)});const id=positionals[0];
  if(command==='console'){print({...await prepareConsole(config),model_calls:0});return;}
  if(command==='models'){print(await request(config,'/models'));return;}
  if(command==='model'){
    let selector=positionals[0];
    const catalog=await request(config,'/models');
    const target=values.task?catalog.tasks.find(task=>task.task_id===values.task):undefined;
    if(values.task&&!target)throw new DengError('TASK_ID','Select an unfinished task UUID');
    if(target&&!['queued','paused','waiting_input','interrupted'].includes(target.status))throw new DengError('MODEL_TASK_RUNNING','Manually pause this task and wait for acknowledgement before switching. No pause or switch was performed.');
    if(!selector){
      if(!process.stdin.isTTY||values.json){print(catalog);return;}
      const current=target?.model_info??catalog.default;
      process.stdout.write(`Current ${target?'task':'future-task default'}: ${current?`${current.profile} / ${current.model}`:'unavailable; choose a configured profile'}\n`);
      catalog.profiles.forEach((profile,index)=>process.stdout.write(`${index+1}. ${profile.profile} / ${profile.model} | ${profile.base_url}\n`));
      const rl=createInterface({input:process.stdin,output:process.stdout});let choice;
      try{choice=(await rl.question('Choose number, profile or model ID (empty cancels): ')).trim();}finally{rl.close();}
      if(!choice){print({cancelled:true});return;}
      const numbered=/^\d+$/.test(choice)?catalog.profiles[Number(choice)-1]:undefined;
      if(/^\d+$/.test(choice)&&!numbered)throw new DengError('MODEL_SELECTION','Model menu number is out of range');
      selector=numbered?.profile??choice;
    }
    print(await request(config,'/models','POST',{model:selector,profile:values.profile,task_id:values.task,expected_revision:target?.revision}));return;
  }
  if(command==='run'){
    if(!values.task)throw new DengError('TASK','Specify --task PATH');
    const spec=JSON.parse(await readFile(resolve(values.task),'utf8'));const result=await request(config,'/tasks','POST',spec);print(result);
    if(values.watch){const task=await watch(config,result.task.id,{pauseOnInterrupt:true,json:values.json});if(task&&task.status!=='completed')process.exitCode=1;}
    return;
  }
  if(command==='status'){print(await request(config,id?`/tasks/${id}`:'/tasks'));return;}
  if(!id||!/^[a-f0-9-]{36}$/.test(id))throw new DengError('TASK_ID','Specify a task UUID');
  if(command==='watch'){await watch(config,id,{json:values.json});return;}
  if(command==='observe'){
    const {startObserver}=await import('./observer.mjs');const observer=await startObserver(config,id);
    print({task_id:id,panel_url:observer.url,model_calls:0});
    process.once('SIGINT',()=>void observer.close());process.once('SIGTERM',()=>void observer.close());return;
  }
  if(command==='delivery'){print(await request(config,`/tasks/${id}/delivery`));return;}
  if(command==='input'){if(!values.input)throw new DengError('INPUT','Specify --input PATH');print(await request(config,`/tasks/${id}/input`,'POST',{input:await readFile(values.input,'utf8')}));return;}
  if(command==='artifact'){print(await request(config,`/tasks/${id}/artifact?limit=16384`));return;}
  if(['pause','cancel','resume'].includes(command)){
    print(await request(config,`/tasks/${id}/control`,'POST',{action:command,input:values.input?await readFile(values.input,'utf8'):undefined,allow_unknown_usage:values['allow-unknown-usage']??false,allow_unknown_commands:values['allow-unknown-commands']??false}));return;
  }
  throw new DengError('COMMAND','Unknown command; run deng help');
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;});
