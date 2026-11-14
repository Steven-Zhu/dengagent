import { readFile,writeFile,mkdir,lstat,stat,rename,unlink } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DengError,normalizeConfig,getCredential,generationBounds,budgetBounds } from './config.mjs';
import {recommendedGeneration,recommendedTotalTokens} from './model-options.mjs';
import { hash } from './store.mjs';
import { modelInfo } from './selection.mjs';
import {applyReasoning,reasoningSettings} from './model-options.mjs';

const changesSchema=z.object({
  profile:z.string().min(1).max(100),base_url:z.string().url(),model:z.string().min(1).max(256),
  api_key:z.string().max(8192).optional(),reuse_credential:z.boolean().default(false),
  ...Object.fromEntries(Object.entries(generationBounds).map(([name,schema])=>[name,schema.optional()])),
  reasoning_format:z.enum(['auto','deepseek','openai','none']).optional(),
  max_total_tokens:budgetBounds.max_total_tokens.optional(),
  max_model_calls:budgetBounds.max_model_calls.optional(),
  expected_revision:z.string().length(64),confirm_model_call:z.boolean().optional(),
}).strict();

async function disk(config){
  const info=await lstat(config.path);
  if(!info.isFile()||info.isSymbolicLink())throw new DengError('CONFIG_PATH','Connection settings require a regular configuration file, not a symlink');
  const text=await readFile(config.path,'utf8');
  return {raw:JSON.parse(text),revision:hash(text)};
}

async function keyPresent(profile){
  if(profile.credential_source!=='file'&&process.env[profile.api_key_env]?.trim())return true;
  if(profile.credential_source!=='env'&&profile.api_key_file){
    try{const info=await stat(profile.api_key_file);return info.isFile()&&info.size>0&&(process.platform==='win32'||(info.mode&0o077)===0);}catch{return false;}
  }
  return false;
}

export async function connectionSettings(config){
  const current=await disk(config);
  if(hash(await normalizeConfig(current.raw,config.path))!==hash(config))throw new DengError('CONFIG_CHANGED','Configuration was edited outside this engine. Reload the service before editing connection settings.');
  return {revision:current.revision,scope:config.scope,inherits_global:Boolean(config.defaults_file),default_profile:config.models.default,provider:config.provider,budget:config.budget,recommended_task_tokens:recommendedTotalTokens,
    profiles:await Promise.all(Object.entries(config.models.profiles).map(async([name,p])=>({
      profile:name,base_url:p.base_url,model:p.model,context_window:p.context_window,max_output_tokens:p.max_output_tokens,
      timeout_ms:p.timeout_ms,thinking:p.thinking,reasoning_effort:p.reasoning_effort,reasoning_format:p.compat.reasoning_format,
      resolved_reasoning_format:reasoningSettings(p).reasoning_format,wire_reasoning_effort:reasoningSettings(p).wire_reasoning_effort,
      recommended_differences:Object.fromEntries(Object.entries(recommendedGeneration).filter(([k,v])=>p[k]!==v).map(([k,v])=>[k,{current:p[k],recommended:v}])),
      key_configured:await keyPresent(p),credential_source:p.credential_source,
    }))),model_calls:0};
}

async function stage(config,raw){
  const changes=changesSchema.parse(raw);
  const current=await disk(config);
  if(changes.expected_revision!==current.revision)throw new DengError('REVISION_CONFLICT','Connection settings changed. Reload before saving; nothing was overwritten.');
  const old=config.models.profiles[changes.profile];
  if(!old)throw new DengError('MODEL_PROFILE','Choose an existing connection profile');
  const destinationChanged=old.base_url.replace(/\/+$/,'')!==changes.base_url.replace(/\/+$/,'');
  const key=changes.api_key?.trim();
  if(destinationChanged&&!key&&!changes.reuse_credential)throw new DengError('CREDENTIAL_REUSE','Changing API URL requires a new Key or explicit confirmation to reuse the existing credential');
  const profile={...old,base_url:changes.base_url,model:changes.model};
  for(const name of Object.keys(generationBounds))if(changes[name]!==undefined)profile[name]=changes[name];
  if(changes.reasoning_format!==undefined)profile.compat={...profile.compat,reasoning_format:changes.reasoning_format};
  if(profile.max_output_tokens>profile.context_window)throw new DengError('CONFIG','Output limit cannot exceed context window');
  const candidate={...current.raw,models:{...current.raw.models,default:changes.profile,profiles:{...current.raw.models.profiles,[changes.profile]:profile}}};
  if(changes.max_total_tokens!==undefined||changes.max_model_calls!==undefined)candidate.budget={...config.budget,...Object.fromEntries(['max_total_tokens','max_model_calls'].filter(key=>changes[key]!==undefined).map(key=>[key,changes[key]]))};
  // An explicit project edit becomes an override; global edits stay user-wide.
  delete candidate.defaults_file;delete candidate.defaults_revision;
  if(destinationChanged)candidate.models.choices=(candidate.models.choices??[]).filter(choice=>choice.profile!==changes.profile);
  await normalizeConfig(candidate,config.path);
  return {changes,current,old,profile,candidate,key};
}

export async function saveConnection(config,raw){
  const staged=await stage(config,raw);
  let credentialFile;
  const temporary=join(dirname(config.path),`.deng-config-${randomUUID()}`);
  try{
    if(staged.key){
      const folder=join(config.data_dir,'credentials');
      await mkdir(folder,{recursive:true,mode:0o700});
      if((await lstat(folder)).isSymbolicLink())throw new DengError('CONFIG_PATH','Credential directory cannot be a symlink');
      credentialFile=join(folder,`key-${randomUUID()}`);
      await writeFile(credentialFile,staged.key+'\n',{flag:'wx',mode:0o600});
      staged.profile.api_key_file=credentialFile;
      staged.profile.credential_source='file';
      // Old task snapshots retain their old Key reference. Keep those references
      // protected even if the active profile now uses a different file.
      if(staged.old.api_key_file)staged.candidate.retired_credential_files=[...new Set([...(staged.candidate.retired_credential_files??[]),staged.old.api_key_file])];
    }
    const normalized=await normalizeConfig(staged.candidate,config.path);
    if((await disk(config)).revision!==staged.current.revision)throw new DengError('REVISION_CONFLICT','Connection settings changed during editing; reload before saving');
    await writeFile(temporary,JSON.stringify(staged.candidate,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,config.path);
    delete config.defaults_file;delete config.defaults_revision;Object.assign(config,normalized);
    return {saved:true,scope:'future_tasks',model_info:modelInfo(normalized.models.profiles[staged.changes.profile],staged.changes.profile,config.provider),existing_tasks_unchanged:true,model_calls:0};
  }catch(error){if(credentialFile)await unlink(credentialFile).catch(()=>{});throw error;}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function probeConnection(config,raw,{fetchImpl=fetch}={}){
  const staged=await stage(config,raw);
  if(!staged.changes.confirm_model_call)throw new DengError('PROBE_CONFIRMATION','A connection test makes one small model request. Explicitly confirm this call before testing.');
  if(config.provider==='offline')throw new DengError('OFFLINE_MODE','Offline fixture configuration cannot test a real provider');
  const key=staged.key||await getCredential(staged.profile);
  const payload={model:staged.profile.model,messages:[{role:'user',content:'Reply with OK.'}],stream:false,[staged.profile.compat.max_tokens_field]:32};
  // Connectivity-only probe stays small; doctor --probe checks the full selected reasoning/tool mode.
  applyReasoning(payload,{...staged.profile,thinking:'disabled'});
  const started=Date.now();
  let response;
  try{response=await fetchImpl(staged.profile.base_url.replace(/\/+$/,'')+'/chat/completions',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(payload),
  });}catch{throw new DengError('PROBE_FAILED','Connection test did not finish. No automatic retry was made; the provider may have received one request.');}
  // Do not expose provider error bodies, response text or credentials.
  if(!response.ok){await response.body?.cancel();return {ok:false,http_status:response.status,model_calls:1,probe_mode:'connectivity_no_thinking',elapsed_ms:Date.now()-started,cost:null};}
  let text='';
  for await(const chunk of response.body??[]){text+=Buffer.from(chunk).toString('utf8');if(Buffer.byteLength(text)>32768){await response.body?.cancel().catch(()=>{});throw new DengError('PROBE_RESPONSE','Provider response exceeded the bounded connection-test size');}}
  let value;try{value=JSON.parse(text);}catch{throw new DengError('PROBE_RESPONSE','Provider did not return the expected JSON response');}
  if(!Array.isArray(value.choices)||!value.choices.length)throw new DengError('PROBE_RESPONSE','Provider response did not contain a chat completion');
  const usage=value.usage;
  const known=Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0;
  return {ok:true,http_status:response.status,model_calls:1,max_output_tokens:32,probe_mode:'connectivity_no_thinking',elapsed_ms:Date.now()-started,
    usage:known?{input_tokens:usage.prompt_tokens,output_tokens:usage.completion_tokens}:null,cost:null};
}
