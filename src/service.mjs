import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolveProject} from './global.mjs';
import {loadConfig,DengError} from './config.mjs';
import {ensureHost,request,prepareConsole} from './host.mjs';
import {workspacePath} from './paths.mjs';
import {detailPage} from './summary.mjs';
import {consoleSnapshot} from './mcp-app.mjs';
import {loadedIdentity} from './identity.mjs';
const readOnly=new Set(['prepare_console','get_task','get_task_details','wait_task','get_models','read_events','read_artifact','verify_delivery','runtime_status','console_snapshot']);
export async function executeService({tool,args={},global=true,config_path}){
 const config=global?await resolveProject(args.project):await loadConfig(config_path);
 const oldControl=(tool==='control_task'||tool==='console_control')&&['pause','cancel'].includes(args.action);
 const health=await ensureHost(config,{allowActiveOlder:readOnly.has(tool)||oldControl});
 switch(tool){
  case'prepare_console':return{...await prepareConsole(config),project:config.workspace_root,selection_model_calls:0};
  case'submit_task':{
   const path=await workspacePath(config,{spec:{scope:{read:['.'],write:[]}}},args.task_file),info=await lstat(path);
   if(!info.isFile()||info.size>1000000)throw new DengError('TASK_SIZE','Task JSON must be a regular file up to 1 MB');
   let raw;try{raw=JSON.parse(await readFile(path,'utf8'));}catch{throw new DengError('TASK_JSON','Task file is not valid JSON');}
   const value=await request(config,'/tasks','POST',raw),health=await request(config,'/health');
   const argv=[fileURLToPath(new URL('../bin/deng.mjs',import.meta.url)),'watch',value.task.id,'--config',config.path];const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
   return{...value,watch:{executable:process.execPath,args:argv,shell_command:[process.execPath,...argv].map(quote).join(' '),location:'Codex integrated terminal',panel_url:health.console_url,panel_location:'Codex right browser panel',panel_note:'Reuse this project console; observations do not call a model.'}};
  }
  case'get_task':return request(config,`/tasks/${args.task_id}`);
  case'get_task_details':return detailPage(await request(config,`/tasks/${args.task_id}`),{offset:args.offset??0,limit:args.limit??4096});
  case'wait_task':return request(config,`/tasks/${args.task_id}/wait?after=${args.after_seq??0}&timeout=${args.timeout_ms??25000}`);
  case'get_models':return request(config,'/models');
  case'set_model':{const{project,...payload}=args;return request(config,'/models','POST',payload);}
  case'control_task':case'console_control':{const{task_id,project,...payload}=args;return request(config,`/tasks/${task_id}/control`,'POST',payload);}
  case'send_input':case'console_input':return request(config,`/tasks/${args.task_id}/input`,'POST',{input:args.input,expected_revision:args.expected_revision});
  case'verify_delivery':return request(config,`/tasks/${args.task_id}/delivery`);
  case'read_events':return request(config,`/tasks/${args.task_id}/events?after=${args.after_seq??0}&limit=${args.limit??50}`);
  case'read_artifact':return request(config,`/tasks/${args.task_id}/artifact?offset=${args.offset??0}&limit=${args.limit??4096}`);
  case'runtime_status':return{client:loadedIdentity,engine:health,model_calls:0};
  case'console_snapshot':{const page=await consoleSnapshot(config,args);return{...page,project:config.workspace_root,panel:await prepareConsole(config)};}
  case'console_select_model':{
   const catalog=await request(config,'/models');if(!catalog.choices.some(p=>p.profile===args.profile&&p.model===args.model)&&!(catalog.default?.profile===args.profile&&catalog.default?.model===args.model))throw new DengError('MODEL_SELECTION','Choose a configured future-task model');
   return request(config,'/models','POST',{model:args.model,profile:args.profile});
  }
  default:throw new DengError('TOOL','Unknown Deng service operation');
 }
}
