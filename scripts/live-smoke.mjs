import { parseArgs } from 'node:util';
import { readFile,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig,safeError } from '../src/config.mjs';
import { probeModel } from '../src/probe.mjs';

const{values}=parseArgs({options:{'key-file':{type:'string'},'base-url':{type:'string',default:'https://api.lkeap.cloud.tencent.com/plan/v3'},model:{type:'string',default:'deepseek/deepseek-flash'},report:{type:'string'}}});
const directory=await mkdtemp(join(tmpdir(),'deng-live-config-'));const previous=process.env.TENCENT_TOKENHUB_API_KEY;
try{
  if(!previous&&values['key-file'])process.env.TENCENT_TOKENHUB_API_KEY=(await readFile(values['key-file'],'utf8')).trim();
  const path=join(directory,'config.json');await writeFile(path,JSON.stringify({workspace_root:directory,models:{default:'worker',profiles:{worker:{base_url:values['base-url'],model:values.model,api_key_env:'TENCENT_TOKENHUB_API_KEY',thinking:'disabled',max_output_tokens:1024,timeout_ms:45000}}}}));
  const proof=await probeModel(await loadConfig(path));
  if(values.report)await writeFile(values.report,JSON.stringify(proof,null,2)+'\n');
  process.stdout.write(JSON.stringify(proof,null,2)+'\n');if(!proof.passed)process.exitCode=1;
}catch(error){process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;}
finally{if(previous===undefined)delete process.env.TENCENT_TOKENHUB_API_KEY;else process.env.TENCENT_TOKENHUB_API_KEY=previous;await rm(directory,{recursive:true,force:true});}
