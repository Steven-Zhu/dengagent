import{spawn}from'node:child_process';
import{writeFile}from'node:fs/promises';
const child=spawn('codex',['--enable','enable_mcp_apps','-c','features.apps=false','-c','features.plugins=false','app-server','--stdio'],{cwd:new URL('../..',import.meta.url),stdio:['pipe','pipe','pipe']});
let id=0,buffer='',stderr='';const pending=new Map();
child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
child.stdout.on('data',chunk=>{buffer+=chunk;let split;while((split=buffer.indexOf('\n'))>=0){const text=buffer.slice(0,split);buffer=buffer.slice(split+1);try{const value=JSON.parse(text);const call=pending.get(value.id);if(call){pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(new Error(value.error.message)):call.resolve(value.result);}}catch{}}});
function rpc(method,params){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('Timed out: '+method));},45000);pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});}
try{
 const init=await rpc('initialize',{clientInfo:{name:'deng-ui-check',version:'0.1.0',title:'Deng UI compatibility check'},capabilities:{experimentalApi:true,requestAttestation:false}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const status=await rpc('mcpServerStatus/list',{limit:100});const deng=status.data.find(server=>server.name==='dengagent');if(!deng)throw new Error('Deng server missing from this Codex backend');
 const render=deng.tools.render_console;const resource=await rpc('mcpServer/resource/read',{server:'dengagent',uri:'ui://dengagent/console-v1.html'});
 const proof={checked_at:new Date().toISOString(),userAgent:init.userAgent,server:deng.name,render_tool_present:Boolean(render),tool_ui_metadata:render?._meta??null,ui_resource_readable:Boolean(resource?.contents?.[0]?.text||resource?.result?.contents?.[0]?.text),resource_keys:Object.keys(resource),native_frontend_rendered:false,note:'Actual local Codex app-server transport and MCP resource discovery checked. This does not create a UI in the active desktop conversation.'};
 await writeFile(new URL('../docs/mcp-app-codex-check.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
}catch(error){console.error(error.message);if(stderr)console.error(stderr);process.exitCode=1;}finally{for(const call of pending.values())clearTimeout(call.timer);child.stdin.end();child.kill('SIGTERM');}
