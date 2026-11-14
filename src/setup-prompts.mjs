import { createInterface } from 'node:readline/promises';
import { stat,realpath,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { homedir } from 'node:os';
import { DengError } from './config.mjs';

export function projectInput(value){
  let path=value.trim();
  if((path.startsWith("'")&&path.endsWith("'"))||(path.startsWith('"')&&path.endsWith('"')))path=path.slice(1,-1);
  else path=path.replace(/\\([ \t\\'"()])/g,'$1');
  if(path==='~')path=homedir();else if(path.startsWith('~/'))path=join(homedir(),path.slice(2));
  return path;
}

export async function chooseProject(){
  const defaultProject=await realpath(process.cwd());
  process.stdout.write('接下来把 Deng 接入一个项目。直接回车使用当前目录，也可以输入其他路径或从 Finder 拖入文件夹。\n目录不存在时会自动创建（包括中间目录）；相对路径从当前目录计算。Ctrl+C 取消。\n');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const controller=new AbortController();
  const cancel=()=>controller.abort();rl.once('SIGINT',cancel);rl.once('close',cancel);
  try{
    while(true){
      let answer;try{answer=await rl.question(`Project folder / 项目目录 [${defaultProject}]（回车使用默认目录）: `,{signal:controller.signal});}
      catch{throw new DengError('CANCELLED','项目配置已取消。应用文件已保留，可以再次运行安装器继续。');}
      const path=resolve(defaultProject,projectInput(answer)||defaultProject);
      try{await mkdir(path,{recursive:true});const absolute=await realpath(path);if(!(await stat(absolute)).isDirectory())throw new Error('directory');return absolute;}
      catch(error){process.stdout.write(['EACCES','EPERM','EROFS'].includes(error.code)
        ?'无法创建或访问这个目录，请检查目录权限或输入其他路径。\n'
        :'无法使用这个路径：它或上级路径可能已是文件，或目录无法创建。请重新输入项目目录。\n');}
    }
  }finally{rl.close();}
}
