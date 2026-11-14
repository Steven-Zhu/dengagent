import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from './engine.mjs';
import { stopped,DengError } from './config.mjs';

export async function probeModel(config){
  const directory=await mkdtemp(join(tmpdir(),'deng-probe-'));const nonce=randomUUID();
  await writeFile(join(directory,'probe.txt'),nonce);
  const probe={...config,scope:'project',defaults_file:undefined,defaults_revision:undefined,workspace_root:directory,data_dir:join(directory,'.dengagent'),budget:{max_model_calls:3,max_total_tokens:24000,max_duration_ms:45000,max_repair_rounds:0}};
  const engine=new Engine(probe);
  try{
    const result=await engine.submit({goal:'Capability probe: emit a short public progress message, then read_file probe.txt using a native tool. Then finish_task with output {nonce: the exact file content}. Do not guess the nonce. This is a small paid API connectivity/tool probe.',
      scope:{read:['.'],write:[],commands:[]},...(config.provider==='offline'?{offline_script:[{name:'read_file',arguments:{path:'probe.txt'}},{name:'finish_task',arguments:{summary:'OFFLINE probe fixture',output:{nonce}}}]}:{})});
    while(!stopped(engine.store.get(result.task.id).status))await delay(25);
    const task=engine.store.get(result.task.id);const events=engine.store.events(task.id,0,500);
    const read=events.some(event=>event.type==='tool.completed'&&event.payload.name==='read_file'&&!event.payload.is_error);
    const verified=task.status==='completed'&&read&&task.result?.output?.nonce===nonce;
    return{passed:verified,provider:config.provider,model:task.profile.model,base_url:task.profile.base_url,native_tool_roundtrip:read,
      public_text_stream_observed:events.some(event=>event.type==='model.text_delta'),usage:task.usage,cost:null,
      error:task.error??null,last_model_response:task.last_model_response??null,usage_accounting:engine.get(task.id).usage_accounting,note:config.provider==='offline'?'Offline fixture; no real model was called':'Real provider calls were made within the displayed budget; not a model-quality evaluation'};
  }finally{await engine.close();await rm(directory,{recursive:true,force:true});}
}
