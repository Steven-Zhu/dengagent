import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {ensureHost,request,prepareConsole} from './host.mjs';
import {publicTask} from './live.mjs';
import {safeError} from './config.mjs';
import {hash} from './store.mjs';

export const APP_URI='ui://dengagent/console-v1.html';
export const APP_MIME='text/html;profile=mcp-app';
export function uiCapability(capabilities){
  const extension=capabilities?.extensions?.['io.modelcontextprotocol/ui']??capabilities?.experimental?.['io.modelcontextprotocol/ui'];
  return Boolean(extension?.mimeTypes?.includes(APP_MIME));
}
export async function consoleSnapshot(config,{task_id,after_seq=0}={}){
  await ensureHost(config,{allowActiveOlder:true});
  const [tasks,catalog]=await Promise.all([request(config,'/tasks'),request(config,'/models')]);
  const latest=tasks.at(-1);const selected=task_id&&tasks.find(t=>t.id===task_id);
  // Follow a newly submitted task; a new task always starts from its first event.
  const task=latest??selected;const after=task?.id===task_id?after_seq:0;
  const page=task?await request(config,`/tasks/${task.id}/events?after=${after}&limit=100`):{events:[],next_seq:0,task:null};
  return {task:publicTask(page.task),events:page.events,next_seq:page.next_seq,models:{default:catalog.default,choices:catalog.choices,default_error:catalog.default_error}};
}
export function registerConsoleApp(server,configuration,{global=false,service}={}){
  const projectSchema=global?{project:z.string().min(1).max(4096)}:{};
  const resolveConfig=args=>typeof configuration==='function'?configuration(args):configuration;
  const panelFor=async args=>service?await service('prepare_console',args):await prepareConsole(await resolveConfig(args));
  const snapshotFor=async args=>service?await service('console_snapshot',args):await consoleSnapshot(await resolveConfig(args),args);
  const clients=new Map();
  const connection=(config,panel,args={})=>{
    const now=Date.now(),consoleId=hash((panel.project??config.workspace_root??config.path)+'\n'+panel.panel_url).slice(0,24);let sessions=clients.get(consoleId)??new Map();
    for(const [id,value]of sessions)if(now-value.at>10000)sessions.delete(id);
    if(args.ui_session_id){sessions.set(args.ui_session_id,{at:now,visible:args.ui_visible===true});}
    while(sessions.size>16)sessions.delete(sessions.keys().next().value);
    clients.set(consoleId,sessions);while(clients.size>128)clients.delete(clients.keys().next().value);
    const values=[...sessions.values()];
    return {console_id:consoleId,browser_connected:Boolean(panel.connected),
      ui_client_connected:values.length>0,ui_visible:values.some(v=>v.visible),
      ui_acknowledged_at:values.length?new Date(Math.max(...values.map(v=>v.at))).toISOString():null,
      note:'A UI-client heartbeat confirms client execution, not pixels or native chat-message streaming. Reuse this console; queued host opens are not visibility acknowledgments.'};
  };
  server.server.registerCapabilities({extensions:{'io.modelcontextprotocol/ui':{}}});
  server.registerResource('deng-console',APP_URI,{title:'Deng 控制台',mimeType:APP_MIME,_meta:{ui:{}}},async()=>({contents:[{
    uri:APP_URI,mimeType:APP_MIME,text:await readFile(new URL('./mcp-app.html',import.meta.url),'utf8'),
    _meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}}},
  }]}));
  const wrap=fn=>async(args,extra)=>{
    try{return await fn(args,extra);}catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({error:safeError(error)})}]};}
  };
  const snapshotReply=page=>({content:[{type:'text',text:'Deng console updated.'}],structuredContent:page});
  server.registerTool('render_console',{
    title:'Deng 控制台',description:'Render the Deng MCP App inside a compatible host when UI is available. Console display is optional for backend task execution: a locked screen, disabled browser or queued open must not block authorized work. The single model selector affects future tasks only. ui_capability_declared reports negotiation, not proof of rendering. Confirm actual visibility before claiming display success; try prepare_console browser fallback when UI access is available.',
    inputSchema:{...projectSchema,},annotations:{readOnlyHint:true,openWorldHint:false},
    _meta:{ui:{resourceUri:APP_URI},'openai/outputTemplate':APP_URI,'openai/widgetAccessible':true},
  },wrap(async args=>{
    const page=await snapshotFor(args),config={workspace_root:page.project??(await resolveConfig(args)).workspace_root};if(global)page.project=config.workspace_root;const supported=uiCapability(server.server.getClientCapabilities());const panel=page.panel??await panelFor(args);
    page.connection=connection(config,panel);
    return {content:[{type:'text',text:supported?'Deng 控制台已准备。请在嵌入界面中查看事件和操作。':'Deng 嵌入资源已准备；本连接未声明 UI 能力，是否展示由宿主决定。本地控制台地址也已提供。'}],
      structuredContent:{...(global?{project:config.workspace_root}:{}),ui_capability_declared:supported,...page.connection,panel_url:panel.panel_url,launch_grace_ms:panel.launch_grace_ms,task_id:page.task?.id??null,status:page.task?.status??'idle'},
      _meta:{consoleSnapshot:page,'openai/outputTemplate':APP_URI}};
  }));
  server.registerTool('console_status',{description:'Read browser connection and recent embedded UI-client acknowledgments before opening a fallback. Reuse the same console_id; capability or a queued host open alone never confirms visibility. No model calls.',inputSchema:{...projectSchema},annotations:{readOnlyHint:true,openWorldHint:false}},wrap(async args=>{
    const panel=await panelFor(args),config={workspace_root:panel.project??(await resolveConfig(args)).workspace_root};
    return {content:[{type:'text',text:'Deng console connection state.'}],structuredContent:{...connection(config,panel),panel_url:panel.panel_url}};
  }));
  const appMeta={ui:{visibility:['app']}};
  server.registerTool('console_snapshot',{description:'UI-only: bounded public events and client heartbeat after UI initialization. No model call.',inputSchema:{...projectSchema,task_id:z.string().uuid().optional(),after_seq:z.number().int().nonnegative().default(0),ui_session_id:z.string().uuid().optional(),ui_visible:z.boolean().optional()},annotations:{readOnlyHint:true,openWorldHint:false},_meta:appMeta},wrap(async args=>{
    const page=await snapshotFor(args);const config={workspace_root:page.project??(await resolveConfig(args)).workspace_root};if(global)page.project=config.workspace_root;
    const panel=page.panel??await panelFor(args);page.connection=connection(config,panel,args);delete page.panel;return snapshotReply(page);
  }));
  server.registerTool('console_select_model',{description:'UI-only: select one configured model for FUTURE tasks. Never pauses or changes any existing task.',inputSchema:{...projectSchema,profile:z.string().min(1).max(256),model:z.string().min(1).max(256)},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},_meta:appMeta},wrap(async args=>{
    if(service)return{content:[{type:'text',text:'Selection saved.'}],structuredContent:await service('console_select_model',args)};
    const config=await resolveConfig(args);await ensureHost(config);const catalog=await request(config,'/models');
    if(!catalog.choices.some(p=>p.profile===args.profile&&p.model===args.model)&&!(catalog.default?.profile===args.profile&&catalog.default?.model===args.model))throw new Error('Choose a configured model');
    const {project,...selection}=args;const result=await request(config,'/models','POST',selection);
    return {content:[{type:'text',text:'Selection saved.'}],structuredContent:result};
  }));
  server.registerTool('console_input',{description:'UI-only: queue a same-scope clarification through Pi steering without pausing or auto-resuming a task.',inputSchema:{...projectSchema,task_id:z.string().uuid(),input:z.string().min(1).max(16000),expected_revision:z.number().int().positive().optional()},annotations:{readOnlyHint:false,openWorldHint:false},_meta:appMeta},wrap(async args=>{
    if(service)return{content:[{type:'text',text:'Clarification queued.'}],structuredContent:await service('console_input',args)};
    const config=await resolveConfig(args);await ensureHost(config);return{content:[{type:'text',text:'Clarification queued.'}],structuredContent:await request(config,`/tasks/${args.task_id}/input`,'POST',{input:args.input,expected_revision:args.expected_revision})};
  }));
  server.registerTool('console_control',{description:'UI-only: explicit pause, resume or cancel for the specified task revision. Unknown outcomes require the user to check their separate acknowledgment boxes.',inputSchema:{...projectSchema,task_id:z.string().uuid(),action:z.enum(['pause','resume','cancel']),expected_revision:z.number().int().positive(),allow_unknown_usage:z.boolean().optional(),allow_unknown_commands:z.boolean().optional()},annotations:{readOnlyHint:false,openWorldHint:false},_meta:appMeta},wrap(async({task_id,...args})=>{
    if(service)return{content:[{type:'text',text:'Task control settled.'}],structuredContent:{task:publicTask(await service('console_control',{task_id,...args}))}};
    const config=await resolveConfig(args);delete args.project;await ensureHost(config);return {content:[{type:'text',text:'Task control settled.'}],structuredContent:{task:publicTask(await request(config,`/tasks/${task_id}/control`,'POST',args))}};
  }));
}
