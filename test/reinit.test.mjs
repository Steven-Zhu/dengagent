import {VERSION} from '../src/version.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { environment } from './helpers.mjs';
import { terminal } from './pty.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
const invoke=promisify(execFile);
const env={TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''};
async function stop(config){await invoke(process.execPath,[cli,'stop-engine','--config',config]);}

test('terminal init --json preserves machine-readable completion',async t=>{
  const {root}=await environment(t);const path=join(root,'machine.json');
  const result=await terminal([process.execPath,cli,'init','--project',root,'--config',path,'--offline','--json'],[],{cwd:root,env});
  assert.equal(result.code,0,result.output);
  const output=JSON.parse(result.output);assert.equal(output.project,root);assert.equal(output.config,path);
  assert.equal(output.provider,'offline');assert.equal(output.applied,true);
});

test('existing project init continues into connection prompts, preserves blank Key and prints a readable summary',async t=>{
  const {root,path}=await environment(t,{provider:'compatible'});
  const key='fake-existing-project-key',keyFile=join(root,'existing.credential');
  await writeFile(keyFile,key+'\n',{mode:0o600});
  const raw=JSON.parse(await readFile(path,'utf8'));Object.assign(raw.models.profiles.worker,{api_key_file:keyFile,credential_source:'file'});
  await writeFile(path,JSON.stringify(raw));
  const result=await terminal([process.execPath,cli,'init','--config',path],[
    {wait:'（回车使用默认目录）: ',send:'\n'},
    {wait:'API URL（留空保留）',send:'\n'},
    {wait:'模型 ID（留空保留）',send:'updated-existing-model\n'},
    {wait:'API Key（不回显',send:'\r'},
    {wait:'保存连接设置？',send:'\n'},
  ],{cwd:root,env});
  try{
    assert.equal(result.code,0,result.output);assert.equal(result.steps,5,result.output);
    assert.match(result.output,/检测到已有项目配置/);assert.match(result.output,/项目接入完成/);
    assert.ok(result.output.includes('DengAgent '+VERSION));assert.match(result.output,/配置文件：/);
    assert.ok(!result.output.includes('"configuration_reused"'));assert.ok(!result.output.includes(key));
    const saved=JSON.parse(await readFile(path,'utf8'));
    assert.equal(saved.models.profiles.worker.model,'updated-existing-model');
    assert.equal(saved.models.profiles.worker.api_key_file,keyFile);
    assert.equal(await readFile(keyFile,'utf8'),key+'\n');assert.equal((await stat(keyFile)).mode&0o077,0);
  }finally{await stop(path);}
});

test('existing init can cancel connection editing without overwriting saved configuration',async t=>{
  const {root,path}=await environment(t,{provider:'compatible'});const before=await readFile(path,'utf8');
  const result=await terminal([process.execPath,cli,'init','--config',path],[
    {wait:'（回车使用默认目录）: ',send:'\n'},
    {wait:'API URL（留空保留）',send:'\n'},
    {wait:'模型 ID（留空保留）',send:'cancelled-model\n'},
    {wait:'API Key（不回显',send:'\r'},
    {wait:'保存连接设置？',send:'n\n'},
  ],{cwd:root,env});
  try{
    assert.equal(result.code,0,result.output);assert.equal(result.steps,5,result.output);
    assert.match(result.output,/连接修改已取消/);assert.equal(await readFile(path,'utf8'),before);
  }finally{await stop(path);}
});
