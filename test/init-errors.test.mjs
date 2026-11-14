import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,chmod,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {environment} from './helpers.mjs';
import {terminal} from './pty.mjs';
import {safeError} from '../src/config.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
const invoke=promisify(execFile),env={TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''};
const tencent={provider:'compatible',models:{default:'worker',profiles:{worker:{base_url:'https://api.lkeap.cloud.tencent.com/plan/v3',model:'deepseek/deepseek-flash',api_key_env:'DENG_API_KEY',thinking:'disabled'}}}};
const errorFrom=output=>JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{"error":'))).error;

test('native filesystem errors expose only actionable codes, never native messages or credential paths',()=>{
  const key='fake-error-payload-key';
  for(const code of ['EACCES','EPERM','ENOSPC','EROFS','ENOTDIR','EISDIR','ENOENT']){
    const error=Object.assign(new Error(key),{code,path:key,syscall:key});const result=safeError(error);
    assert.equal(result.code,code);assert.ok(!JSON.stringify(result).includes(key));
  }
  assert.equal(safeError(new Error(key)).code,'INTERNAL');
  assert.ok(!JSON.stringify(safeError(new Error(key))).includes(key));
});

test('new init validates project TOML before writing a credential or connection config',async t=>{
  const{root}=await environment(t);const path=join(root,'new-config.json');
  const codex=join(root,'.codex/config.toml');await mkdir(join(root,'.codex'));
  const original='[malformed table\n';await writeFile(codex,original);
  const result=await terminal([process.execPath,cli,'init','--config',path],[
    {wait:'（回车使用默认目录）: ',send:'\n'},
    {wait:'Model base URL / ',send:'https://api.lkeap.cloud.tencent.com/plan/v3\n'},
    {wait:'Model ID / ',send:'deepseek/deepseek-flash\n'},
  ],{cwd:root,env});
  assert.equal(result.code,1,result.output);assert.equal(result.steps,3);
  assert.deepEqual(errorFrom(result.output),{code:'SETUP_TOML',message:'项目 .codex/config.toml 不是有效的 TOML。请修复格式后重试；原文件未被覆盖。',phase:'codex_validation',connection_saved:false});
  assert.equal(await readFile(codex,'utf8'),original);
  await assert.rejects(stat(path),{code:'ENOENT'});await assert.rejects(stat(path+'.credential'),{code:'ENOENT'});
});

test('existing init with invalid project TOML preserves the connection before opening its editor',async t=>{
  const{root,path}=await environment(t,tencent);const before=await readFile(path,'utf8');
  await mkdir(join(root,'.codex'));await writeFile(join(root,'.codex/config.toml'),'[bad table\n');
  const result=await terminal([process.execPath,cli,'init','--config',path],[{wait:'（回车使用默认目录）: ',send:'\n'}],{cwd:root,env});
  assert.equal(result.code,1,result.output);assert.equal(errorFrom(result.output).code,'SETUP_TOML');
  assert.equal(errorFrom(result.output).connection_saved,false);assert.equal(await readFile(path,'utf8'),before);
});

test('Tencent connection save reports a credential-directory permission error without exposing or replacing the Key',async t=>{
  if(process.getuid?.()===0)return t.skip('Requires an unprivileged filesystem user');
  const{root,path}=await environment(t,tencent);const before=await readFile(path,'utf8');
  const folder=join(root,'.dengagent/credentials');await mkdir(folder,{recursive:true});await chmod(folder,0o500);
  const key='fake-tencent-denied-key';
  try{
    const result=await terminal([process.execPath,cli,'init','--config',path],[
      {wait:'（回车使用默认目录）: ',send:'\n'},
      {wait:'API URL（留空保留）',send:'\n'},
      {wait:'模型 ID（留空保留）',send:'\n'},
      {wait:'API Key（不回显',send:key+'\r'},
      {wait:'保存连接设置？',send:'\n'},
    ],{cwd:root,env});
    assert.equal(result.code,1,result.output);assert.equal(result.steps,5);
    assert.equal(errorFrom(result.output).code,'EACCES');assert.equal(errorFrom(result.output).phase,'connection_settings');
    assert.ok(!result.output.includes(key));assert.equal(await readFile(path,'utf8'),before);
    assert.deepEqual(await readdir(folder),[]);
  }finally{
    await chmod(folder,0o700);
    await invoke(process.execPath,[cli,'stop-engine','--config',path]);
  }
});

test('invalid connection JSON identifies the read phase without returning its contents',async t=>{
  const{root,path}=await environment(t);const secret='fake-invalid-json-key';await writeFile(path,'{"api_key":"'+secret);
  const result=await terminal([process.execPath,cli,'init','--config',path],[{wait:'（回车使用默认目录）: ',send:'\n'}],{cwd:root,env});
  assert.equal(result.code,1,result.output);const error=errorFrom(result.output);
  assert.equal(error.code,'CONFIG_JSON');assert.equal(error.phase,'configuration_read');assert.ok(!result.output.includes(secret));
});

test('a later project-ignore failure reports that the connection was already saved',async t=>{
  const{root}=await environment(t);const path=join(root,'committed-config.json');await mkdir(join(root,'.gitignore'));
  const result=await terminal([process.execPath,cli,'init','--offline','--config',path],[{wait:'（回车使用默认目录）: ',send:'\n'}],{cwd:root,env});
  assert.equal(result.code,1,result.output);const error=errorFrom(result.output);
  assert.equal(error.code,'EISDIR');assert.equal(error.phase,'project_ignore');assert.equal(error.connection_saved,true);
  assert.equal(JSON.parse(await readFile(path,'utf8')).workspace_root,root);
});

test('new init identifies a private-config directory write failure without creating credentials',async t=>{
  if(process.getuid?.()===0)return t.skip('Requires an unprivileged filesystem user');
  const{root}=await environment(t);const folder=join(root,'read-only-config');await mkdir(folder);await chmod(folder,0o500);
  const path=join(folder,'new.json'),key='fake-denied-initial-key';
  try{
    const result=await terminal([process.execPath,cli,'init','--config',path],[
      {wait:'（回车使用默认目录）: ',send:'\n'},
      {wait:'Model base URL / ',send:'https://api.lkeap.cloud.tencent.com/plan/v3\n'},
      {wait:'Model ID / ',send:'deepseek/deepseek-flash\n'},
      {wait:'API Key（',send:key+'\r'},
    ],{cwd:root,env});
    assert.equal(result.code,1,result.output);const error=errorFrom(result.output);
    assert.equal(error.code,'EACCES');assert.equal(error.phase,'credential_write');assert.equal(error.connection_saved,false);
    assert.ok(!result.output.includes(key));assert.deepEqual(await readdir(folder),[]);
  }finally{await chmod(folder,0o700);}
});
