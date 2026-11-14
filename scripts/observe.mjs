import { parseArgs } from 'node:util';
import { loadConfig,safeError } from '../src/config.mjs';
import { startObserver } from '../src/observer.mjs';

try{
  const {values}=parseArgs({options:{config:{type:'string'},task:{type:'string'}}});
  if(!values.config)throw new Error('Specify --config');
  const observer=await startObserver(await loadConfig(values.config),values.task);
  process.stdout.write(JSON.stringify({task_id:values.task,panel_url:observer.url,model_calls:0})+'\n');
  process.once('SIGINT',()=>void observer.close());process.once('SIGTERM',()=>void observer.close());
}catch(error){process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;}
