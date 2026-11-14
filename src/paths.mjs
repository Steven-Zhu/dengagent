import { realpath, lstat, mkdir, open } from 'node:fs/promises';
import { resolve, relative, dirname, sep,join } from 'node:path';
import {homedir} from 'node:os';
import { DengError } from './config.mjs';
import { constants } from 'node:fs';

export const inside = (root,path) => path === root || (!relative(root,path).startsWith(`..${sep}`) && relative(root,path)!=='..' && !relative(root,path).startsWith(sep));
const protectedPart = part => ['.git','.codex','.agents','.aws','.ssh','.dengagent'].includes(part) || part==='.env' || part.startsWith('.env.');
export async function workspacePath(config, task, path, write=false) {
  const root=config.workspace_root;
  if (typeof path !== 'string' || path.includes('\0')) throw new DengError('PATH','Invalid workspace path');
  const candidate=resolve(root,path);
  const credentials=[...Object.values(config.models.profiles).map(profile=>profile.api_key_file),...(config.retired_credential_files??[]),task.profile?.api_key_file].filter(Boolean);
  if (!inside(root,candidate) || relative(root,candidate).split(sep).some(protectedPart) || inside(join(homedir(),'.config','dengagent'),candidate) || inside(join(homedir(),'.agents'),candidate) || (config.defaults_file&&inside(dirname(config.defaults_file),candidate)) || inside(config.data_dir,candidate) || candidate===config.path || credentials.some(secret=>inside(secret,candidate))) throw new DengError('PATH_SCOPE','Path is outside the allowed workspace or is protected');
  if(write&&(task.spec.acceptance?.protected_files??[]).some(p=>candidate===resolve(root,p)))throw new DengError('ACCEPTANCE_PROTECTED','This acceptance dependency is declared read-only');
  const scopes=write ? task.spec.scope.write : [...task.spec.scope.read,...task.spec.scope.write];
  if (!scopes.some(scope=>inside(resolve(root,scope),candidate))) throw new DengError('PATH_SCOPE',`${write?'Write':'Read'} path is outside task scope`);
  // Refuse symlinks in every existing path component, including the final file.
  let cursor=root;
  for (const segment of relative(root,candidate).split(sep).filter(Boolean)) {
    cursor=resolve(cursor,segment);
    try { const info=await lstat(cursor); if(info.isSymbolicLink()) throw new DengError('PATH_SYMLINK','Symlink workspace paths are not allowed'); }
    catch(error) { if(error.code==='ENOENT') break; throw error; }
  }
  return candidate;
}
export async function privateWrite(path,content) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const handle=await open(path,constants.O_CREAT|constants.O_TRUNC|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
  try {await handle.writeFile(content);} finally {await handle.close();}
}

export async function commandCwd(config,task,path,field='command.cwd'){
  try{return await workspacePath(config,task,path);}
  catch(error){
    if(error.code!=='PATH_SCOPE')throw error;
    const candidate=resolve(config.workspace_root,path),scope=relative(config.workspace_root,candidate);
    const location=inside(config.workspace_root,candidate)?(scope||'.'):'outside project';
    throw new DengError('COMMAND_CWD_SCOPE',`${field}: cwd (${location}) must be inside an existing read/write scope and must not be protected. Choose an authorized cwd; no scope was expanded.`);
  }
}
