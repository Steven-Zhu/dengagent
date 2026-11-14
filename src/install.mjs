import { parseArgs } from 'node:util';
import { cp,mkdir,readFile,stat,symlink,lstat,readlink,rename,rm } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inside } from './paths.mjs';

async function main(){
  const{values}=parseArgs({options:{source:{type:'string'},destination:{type:'string'},project:{type:'string'},config:{type:'string'},offline:{type:'boolean'},'no-link':{type:'boolean'}}});
  if(!values.source)throw new Error('Installer source is required');
  const source=resolve(values.source);const build=JSON.parse(await readFile(join(source,'build.json'),'utf8'));
  if(build.platform!==process.platform||build.arch!==process.arch)throw new Error(`Package is for ${build.platform}/${build.arch}; running ${process.platform}/${process.arch}`);
  const destination=resolve(values.destination??join(homedir(),'Library','Application Support','DengAgent'));
  const target=join(destination,'versions',`${build.version}-${build.build_id}`);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  // Version directories are immutable; reinstalling the same build reuses them.
  try{await stat(join(target,'build.json'));}catch(error){if(error.code!=='ENOENT')throw error;await cp(source,target,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});}
  const node=join(target,'runtime','node');const cli=join(target,'app','bin','deng.mjs');
  process.stdout.write(`DengAgent 应用文件已就位：${target}\n接下来完成项目接入；看到“项目接入完成”才表示向导结束。\n`);
  if(!values['no-link']){
    const link=join(homedir(),'.local','bin','deng');await mkdir(dirname(link),{recursive:true});
    try{
      const existing=await lstat(link);
      if(existing.isSymbolicLink()){
        const previous=resolve(dirname(link),await readlink(link));
        if(inside(join(destination,'versions'),previous)&&previous.endsWith('/bin/deng')){
          const temporary=link+'.'+randomUUID();
          try{await symlink(join(target,'bin','deng'),temporary);await rename(temporary,link);}finally{await rm(temporary,{force:true});}
        }else process.stdout.write(`已保留其他程序的 deng 链接；本版启动器：${join(target,'bin','deng')}\n`);
      }else process.stdout.write(`已保留现有 ${link}；Codex 将使用应用的绝对路径。\n`);
    }
    catch(error){if(error.code!=='ENOENT')throw error;await symlink(join(target,'bin','deng'),link);}
  }
  const args=[cli,'init'];if(values.project)args.push('--project',resolve(values.project));if(values.config)args.push('--config',resolve(values.config));if(values.offline)args.push('--offline');
  const child=spawn(node,args,{stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  if(code!==0){process.stdout.write('\n项目接入尚未完成。应用文件已保留，再次运行安装器可继续配置。\n');process.exitCode=code;}
  else process.stdout.write('\n项目接入完成。请重新加载/信任该项目或新开 Codex 会话，再说“使用 DengAgent”。如尚未填写 API Key，请先完成凭证配置。\n');
}
main().catch(error=>{process.stderr.write(`Deng installer: ${error.code??'INSTALL_FAILED'} — installation did not complete\n`);process.exitCode=1;});
