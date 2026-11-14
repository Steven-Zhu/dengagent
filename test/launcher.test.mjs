import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {launcher} from '../src/launcher.mjs';
const run=promisify(execFile);

test('bundled launcher resolves direct paths, PATH links and relative symlink chains with spaces',async t=>{
  const root=await mkdtemp(join(tmpdir(),'deng launcher '));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'installed app'),links=join(root,'user bin');
  for(const path of [join(app,'bin'),join(app,'runtime'),join(app,'app','bin'),links])await mkdir(path,{recursive:true});
  await symlink(process.execPath,join(app,'runtime','node'));
  await writeFile(join(app,'app','bin','deng.mjs'),'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  await writeFile(join(app,'bin','deng'),launcher,{mode:0o755});
  await symlink(join(app,'bin','deng'),join(links,'deng'));
  await symlink('deng',join(links,'relative deng'));
  await symlink('relative deng',join(links,'chain'));
  const args=['help','argument with spaces','literal $HOME'];
  const env={PATH:'/usr/bin:/bin'};
  for(const path of [join(app,'bin','deng'),join(links,'deng'),join(links,'relative deng'),join(links,'chain')]){
    const result=await run(path,args,{cwd:tmpdir(),env});assert.deepEqual(JSON.parse(result.stdout),args);
  }
  const result=await run('/bin/sh',['-c','deng help'],{cwd:tmpdir(),env:{PATH:links+':/usr/bin:/bin'}});assert.deepEqual(JSON.parse(result.stdout),['help']);
});
