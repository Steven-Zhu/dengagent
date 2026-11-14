import { mkdtemp,writeFile,rm,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig,stopped } from '../src/config.mjs';

export async function environment(t,overrides={}){
  const root=await realpath(await mkdtemp(join(tmpdir(),'deng-test-')));
  const path=join(root,'settings.json');
  const config={schema_version:'0.1',workspace_root:root,provider:'offline',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'offline-fixture'}}},tools:{isolation:'host'},idle_shutdown_ms:60000,...overrides};
  await writeFile(path,JSON.stringify(config));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return{root,path,config:await loadConfig(path)};
}
export async function until(predicate,timeout=10000){
  const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await delay(20);}throw new Error('Timed out waiting for condition');
}
export async function completion(engine,id){await until(()=>stopped(engine.store.get(id).status));return engine.store.get(id);}
