import {readFile,mkdir,lstat,writeFile,rename,unlink,link,copyFile,chmod} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {loadConfig,normalizeConfig,DengError} from './config.mjs';
import {hash} from './store.mjs';

export const settingsRoot=()=>join(homedir(),'.config','dengagent');
export const globalConfigPath=()=>join(settingsRoot(),'global.json');
export const projectConfigPath=project=>join(settingsRoot(),`project-${hash(project).slice(0,16)}.json`);
export const runtimeConfigPath=project=>join(settingsRoot(),'projects',hash(project).slice(0,24),'runtime.json');
export async function atomicConfig(path,value,{exclusive=false}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{if((await lstat(path)).isSymbolicLink())throw new DengError('CONFIG_PATH','Configuration file cannot be a symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(dirname(path),`.deng-settings-${randomUUID()}`);
  try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});if(exclusive)await link(temporary,path);else await rename(temporary,path);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function loadGlobal(){
  try{const config=await loadConfig(globalConfigPath());if(config.scope!=='global')throw new DengError('GLOBAL_CONFIG','Global connection file has an invalid scope');return config;}
  catch(error){if(error.code==='ENOENT')throw new DengError('GLOBAL_NOT_CONFIGURED','Run deng init once to configure the user-level connection and Codex integration.');throw error;}
}
const defaults=config=>({provider:config.provider,models:config.models,budget:config.budget,retired_credential_files:config.retired_credential_files});
export async function syncDefaults(config){
  if(!config.defaults_file)return false;
  const global=await loadConfig(config.defaults_file);if(global.scope!=='global')throw new DengError('GLOBAL_CONFIG','Expected user-level connection settings');
  const revision=hash(defaults(global));if(config.defaults_revision===revision)return false;
  const raw=JSON.parse(await readFile(config.path,'utf8'));
  const retired=[...new Set([...(config.retired_credential_files??[]),...Object.values(config.models.profiles).map(p=>p.api_key_file).filter(Boolean),...global.retired_credential_files])];
  const next={...raw,provider:global.provider,models:global.models,budget:global.budget,retired_credential_files:retired,defaults_revision:revision};
  const normalized=await normalizeConfig(next,config.path);await atomicConfig(config.path,next);Object.assign(config,normalized);return true;
}
export async function resolveProject(project){
  if(!project||!isAbsolute(project))throw new DengError('PROJECT_REQUIRED','Pass the intended project as an absolute path. Do not infer it from the MCP process launch directory.');
  const {realpath,stat}=await import('node:fs/promises');const root=await realpath(project);
  if(!(await stat(root)).isDirectory())throw new DengError('PROJECT','Project must be an existing directory');
  const checked=config=>{if(config.scope!=='project'||config.workspace_root!==root)throw new DengError('CONFIG_PROJECT','Configuration belongs to another project; no routing or execution was performed');return config;};
  try{return checked(await loadConfig(projectConfigPath(root)));}catch(error){if(error.code!=='ENOENT')throw error;}
  const path=runtimeConfigPath(root);
  try{return checked(await loadConfig(path));}catch(error){if(error.code!=='ENOENT')throw error;}
  const global=await loadGlobal();
  const raw={schema_version:'0.1',scope:'project',workspace_root:root,provider:global.provider,models:global.models,budget:global.budget,tools:global.tools,idle_shutdown_ms:global.idle_shutdown_ms,retired_credential_files:global.retired_credential_files,defaults_file:global.path,defaults_revision:hash(defaults(global))};
  // Concurrent first callers must share the same runtime file without truncation.
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await atomicConfig(path,raw,{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;}
  return checked(await loadConfig(path));
}
async function migrationSource(project){
  const {realpath}=await import('node:fs/promises');const root=await realpath(resolve(project));
  const source=await loadConfig(projectConfigPath(root));
  if(source.scope!=='project'||source.workspace_root!==root)throw new DengError('CONFIG_PROJECT','Legacy connection belongs to another project');
  const {request}=await import('./host.mjs');
  try{await request(source,'/health');throw new DengError('MIGRATION_ENGINE_RUNNING','Finish current project work, then explicitly run deng stop-engine --project PATH before migrating this project. No task was stopped.');}
  catch(error){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
  const {setupCodex}=await import('./setup.mjs');await setupCodex(source,{apply:false,router:true});
  return source;
}
export async function importGlobal(project){
  const source=await migrationSource(project);const root=source.workspace_root;
  try{await lstat(globalConfigPath());return {imported_from:root,connection_imported:false,existing_global_preserved:true,credential_copied:false};}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(settingsRoot(),{recursive:true,mode:0o700});
  const {path,data_dir,defaults_file,defaults_revision,...raw}=source;
  const originals=Object.values(raw.models.profiles).map(profile=>profile.api_key_file).filter(Boolean);
  const copied=[],references=new Map();let committed=false;
  try{
    const folder=join(settingsRoot(),'credentials');await mkdir(folder,{recursive:true,mode:0o700});
    if((await lstat(folder)).isSymbolicLink())throw new DengError('CONFIG_PATH','Global credential directory cannot be a symlink');
    for(const profile of Object.values(raw.models.profiles)){
      if(!profile.api_key_file||profile.credential_source==='env')continue;
      const original=profile.api_key_file;
      if(references.has(original)){profile.api_key_file=references.get(original);continue;}
      const destination=join(folder,`key-${randomUUID()}`);
      try{await copyFile(original,destination,constants.COPYFILE_EXCL);copied.push(destination);await chmod(destination,0o600);references.set(original,destination);profile.api_key_file=destination;}
      catch(error){if(error.code!=='ENOENT')throw error;delete profile.api_key_file;}
    }
    const candidate={...raw,scope:'global',workspace_root:settingsRoot(),data_dir:join(settingsRoot(),'settings-engine'),retired_credential_files:[...new Set([...raw.retired_credential_files,...originals])]};
    await normalizeConfig(candidate,globalConfigPath());await atomicConfig(globalConfigPath(),candidate,{exclusive:true});committed=true;
    return {imported_from:root,connection_imported:true,credential_copied:copied.length>0,credential_files_copied:copied.length};
  }finally{if(!committed)for(const file of copied)await unlink(file).catch(()=>{});}
}
export async function linkLegacy(project){
  const source=await migrationSource(project),global=await loadGlobal();
  const original=await readFile(source.path,'utf8'),raw=JSON.parse(original);
  const backup=source.path+`.backup-global-${Date.now()}-${randomUUID().slice(0,8)}`;await copyFile(source.path,backup);await chmod(backup,0o600);
  const retired=[...new Set([...source.retired_credential_files,...Object.values(source.models.profiles).map(p=>p.api_key_file).filter(Boolean),...global.retired_credential_files])];
  const linked={...raw,scope:'project',provider:global.provider,models:global.models,budget:global.budget,retired_credential_files:retired,defaults_file:global.path,defaults_revision:hash(defaults(global))};
  await normalizeConfig(linked,source.path);await atomicConfig(source.path,linked);
  return {legacy_backup:backup,linked_global:true};
}
