// Deterministic comparison; no live model is called and no private inputs used.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {taskSummary} from '../src/summary.mjs';
const baseline=resolve(process.argv[2]);
async function run(folder){
 const {Engine}=await import(pathToFileURL(join(folder,'src/engine.mjs')));
 const {loadConfig}=await import(pathToFileURL(join(folder,'src/config.mjs')));
 const dir=await mkdtemp(join(tmpdir(),'deng-summary-comparison-'));let engine;
 try{
  const config=join(dir,'config.json');await writeFile(config,JSON.stringify({workspace_root:dir,provider:'offline',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'fixture'}}},tools:{isolation:'host'}}));
  engine=new Engine(await loadConfig(config));
  const spec={goal:'Implement the supplied deterministic artifact. '.repeat(160),scope:{read:['.'],write:['.']},offline_script:[{name:'write_file',arguments:{path:'result.txt',content:'deterministic artifact'}},{name:'finish_task',arguments:{summary:'Deterministic artifact created'}}],acceptance:{required_files:['result.txt']}};
  const {task}=await engine.submit(spec);
  for(let i=0;i<100;i++){if(engine.get(task.id).status==='completed')break;await delay(20);}
  const full=engine.get(task.id);if(full.status!=='completed')throw new Error(JSON.stringify(full.error));
  return {full,usage:full.usage,status:full.status};
 }finally{await engine?.close();await rm(dir,{recursive:true,force:true});}
}
const before=await run(baseline),after=await run(resolve('.'));
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
console.log(JSON.stringify({fixture:'same task/model/offline settings; full legacy view vs MCP summary projection',before_bytes:bytes(before.full),after_bytes:bytes(taskSummary(after.full)),before_usage:before.usage,after_usage:after.usage,status:[before.status,after.status],real_provider_calls:0,main_model_token_savings:'not measured; response bytes are not token billing'},null,2));
