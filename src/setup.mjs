import { readFile,writeFile,mkdir,copyFile,lstat,realpath,unlink } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse,stringify } from 'smol-toml';
import { DengError } from './config.mjs';
import {homedir} from 'node:os';

export const packageRoot=fileURLToPath(new URL('..',import.meta.url));
async function optional(path){try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}}
async function safeTarget(root,target){
  let path=root;
  for(const part of target.slice(root.length).split('/').filter(Boolean)){
    path=join(path,part);try{if((await lstat(path)).isSymbolicLink())throw new DengError('SETUP_SYMLINK','Setup refuses symlinked configuration paths');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
export async function setupCodex(config,{apply=false,user=false,router=false}={}){
  const root=await realpath(user?homedir():config.workspace_root);
  const configFile=join(root,'.codex','config.toml');const skillFile=join(root,'.agents','skills','dengagent','SKILL.md');
  await safeTarget(root,configFile);await safeTarget(root,skillFile);
  const original=await optional(configFile);let parsed;
  try{parsed=original?parse(original):{};}catch{throw new DengError('SETUP_TOML','项目 .codex/config.toml 不是有效的 TOML。请修复格式后重试；原文件未被覆盖。');}
  if(parsed.mcp_servers!==undefined&&(typeof parsed.mcp_servers!=='object'||Array.isArray(parsed.mcp_servers)))throw new DengError('SETUP_CONFIG','mcp_servers must be a table');
  const registration={command:process.execPath,args:[resolve(packageRoot,'bin/deng.mjs'),'mcp',...(user||router?['--global']:['--config',config.path])],env_vars:[...new Set(Object.values(config.models.profiles).map(profile=>profile.api_key_env))],startup_timeout_sec:20,tool_timeout_sec:45};
  const skill=await readFile(resolve(packageRoot,'skills/dengagent/SKILL.md'),'utf8');const oldSkill=await optional(skillFile);
  const unchanged=JSON.stringify(parsed.mcp_servers?.dengagent)===JSON.stringify(registration)&&oldSkill===skill;
  const plan={project:root,scope:user?'global':'project',config_file:configFile,skill_file:skillFile,registration,unchanged,applied:false};
  if(!apply||unchanged)return plan;
  const suffix=`.backup-${Date.now()}`;
  if(original)await copyFile(configFile,configFile+suffix);if(oldSkill)await copyFile(skillFile,skillFile+suffix);
  await mkdir(dirname(configFile),{recursive:true});await mkdir(dirname(skillFile),{recursive:true});
  parsed.mcp_servers={...parsed.mcp_servers,dengagent:registration};
  await writeFile(configFile,stringify(parsed),{mode:0o600});await writeFile(skillFile,skill);
  return{...plan,applied:true};
}
export async function migrateProjectIntegration(config,{apply=false}={}){
  const plan=await setupCodex(config,{apply:false});
  const original=await optional(plan.config_file),oldSkill=await optional(plan.skill_file);
  const parsed=original?parse(original):{};
  const changes={scope:'global',project:plan.project,remove_project_mcp:Boolean(parsed.mcp_servers?.dengagent),remove_project_skill:Boolean(oldSkill),applied:false,backups:[]};
  if(!apply)return changes;
  const suffix=`.backup-global-${Date.now()}`;
  if(changes.remove_project_mcp){
    await copyFile(plan.config_file,plan.config_file+suffix);changes.backups.push(plan.config_file+suffix);
    delete parsed.mcp_servers.dengagent;await writeFile(plan.config_file,stringify(parsed),{mode:0o600});
  }
  if(oldSkill){await copyFile(plan.skill_file,plan.skill_file+suffix);changes.backups.push(plan.skill_file+suffix);await unlink(plan.skill_file);}
  return {...changes,applied:true};
}
