import { cp,mkdir,readFile,writeFile,chmod,stat,rm,realpath,readdir,lstat,readlink } from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { dirname,join,resolve,isAbsolute,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn,execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { launcher } from '../src/launcher.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const{values}=parseArgs({options:{node:{type:'string',default:process.execPath},out:{type:'string',default:join(root,'releases')}}});
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const runtime=JSON.parse(execFileSync(resolve(values.node),['-p','JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'],{encoding:'utf8'}));
if(Number(runtime.version.slice(1).split('.')[0])<24)throw new Error('Bundled Node must be version 24+');
if(runtime.platform!=='darwin')throw new Error('The .command installer currently supports macOS only');
const output=resolve(values.out);const id=new Date().toISOString().replace(/[-:.TZ]/g,'');
const stage=join(output,`stage-${id}`);const bundle=join(stage,'DengAgent');
await mkdir(join(bundle,'app'),{recursive:true});await mkdir(join(bundle,'runtime'));await mkdir(join(bundle,'bin'));
for(const name of ['src','bin','skills','docs','examples','licenses','README.md','README.zh-CN.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CHANGELOG.md','SECURITY.md','package.json','package-lock.json','node_modules']){
  // A development checkout may link its dependency directory. Copy the actual
  // directory while retaining package-local relative links such as .bin entries.
  await cp(await realpath(join(root,name)),join(bundle,'app',name),{recursive:true,verbatimSymlinks:true});
}
async function checkLinks(folder){
  for(const name of await readdir(folder)){
    const path=join(folder,name),info=await lstat(path);
    if(info.isSymbolicLink()){
      const link=await readlink(path),target=await realpath(path),outside=relative(bundle,target);
      if(isAbsolute(link)||outside==='..'||outside.startsWith('../')||isAbsolute(outside))throw new Error('Bundle contains an external/absolute symbolic link');
    }else if(info.isDirectory())await checkLinks(path);
  }
}
await checkLinks(bundle);
await cp(resolve(values.node),join(bundle,'runtime','node'));await chmod(join(bundle,'runtime','node'),0o755);
const runtimeRoot=dirname(dirname(resolve(values.node)));
let licensed=false;
for(const path of [join(dirname(resolve(values.node)),'LICENSE'),...['LICENSE','LICENSE.txt'].map(name=>join(runtimeRoot,name))]){
  try{await cp(path,join(bundle,'runtime','LICENSE'));licensed=true;break;}catch(error){if(error.code!=='ENOENT')throw error;}
}
if(!licensed)throw new Error('Node runtime LICENSE is required beside the runtime distribution');
await writeFile(join(bundle,'bin','deng'),launcher,{mode:0o755});
const build={version:manifest.version,build_id:id,platform:runtime.platform,arch:runtime.arch,node:runtime.version,built_at:new Date().toISOString()};
await writeFile(join(bundle,'build.json'),JSON.stringify(build,null,2)+'\n');
const basename=`DengAgent-${manifest.version}-${runtime.platform}-${runtime.arch}`;
const archive=join(output,`${basename}.tar.gz`);
await new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/tar',['--no-mac-metadata','--no-xattrs','--no-acls','--no-fflags','--uid','0','--gid','0','--uname','root','--gname','wheel','-czf',archive,'-C',stage,'DengAgent'],{stdio:'inherit',env:{PATH:'/usr/bin:/bin',COPYFILE_DISABLE:'1'}});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Archive failed')));
});
const installer=join(output,`${basename}.command`);
// The shell reads the textual header and exits before it reaches the gzip payload.
const headerLines=[
  '#!/bin/bash','set -eu',
  'DENG_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/deng-installer.XXXXXX")',
  'trap \'rm -rf "$DENG_TEMP"\' EXIT',
  'tail -n +PAYLOAD_LINE "$0" | /usr/bin/tar -xzf - -C "$DENG_TEMP"',
  '"$DENG_TEMP/DengAgent/runtime/node" "$DENG_TEMP/DengAgent/app/src/install.mjs" --source "$DENG_TEMP/DengAgent" "$@"',
  'exit $?','__DENG_PAYLOAD__',
];
const header=headerLines.join('\n').replace('PAYLOAD_LINE',String(headerLines.length+1))+'\n';
await writeFile(installer,header,{mode:0o755});await pipeline(createReadStream(archive),createWriteStream(installer,{flags:'a'}));await chmod(installer,0o755);
const digest=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
const record={...build,installer,archive,installer_bytes:(await stat(installer)).size,installer_sha256:await digest(installer),archive_sha256:await digest(archive)};
await writeFile(join(output,`${basename}.json`),JSON.stringify(record,null,2)+'\n');
await rm(stage,{recursive:true,force:true});
process.stdout.write(JSON.stringify(record,null,2)+'\n');
