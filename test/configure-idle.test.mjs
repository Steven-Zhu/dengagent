import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {environment,until} from './helpers.mjs';
import {terminal} from './pty.mjs';
import {socketPath} from '../src/host.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
const invoke=promisify(execFile),env={TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''};
const tencent={provider:'compatible',idle_shutdown_ms:1000,models:{default:'worker',profiles:{worker:{base_url:'https://api.lkeap.cloud.tencent.com/plan/v3',model:'deepseek/deepseek-flash',thinking:'disabled',api_key_env:'DENG_API_KEY'}}}};

test('connection editor remains usable when a person waits longer than the engine idle timeout',async t=>{
  const{root,path,config}=await environment(t,tencent);const key='fake-human-delayed-tencent-key';
  const result=await terminal([process.execPath,cli,'init','--config',path],[
    {wait:'（回车使用默认目录）: ',send:'\n'},
    {wait:'API URL（留空保留）',send:'\n'},
    {wait:'模型 ID（留空保留）',send:'\n'},
    {wait:'API Key（不回显',send:key+'\r',delay_ms:2400},
    {wait:'保存连接设置？',send:'\n',delay_ms:2400},
  ],{cwd:root,env});
  try{
    assert.equal(result.code,0,result.output);assert.equal(result.steps,5);
    assert.ok(!result.output.includes(key));assert.match(result.output,/项目接入完成/);
    const saved=JSON.parse(await readFile(path,'utf8'));
    assert.equal(await readFile(saved.models.profiles.worker.api_key_file,'utf8'),key+'\n');
    assert.equal((await stat(saved.models.profiles.worker.api_key_file)).mode&0o077,0);
    // Finishing the editor must stop its keepalive and preserve the configured idle shutdown.
    await until(async()=>{try{await stat(socketPath(config));return false;}catch(error){return error.code==='ENOENT';}},6000);
  }finally{await invoke(process.execPath,[cli,'stop-engine','--config',path]);}
});

test('explicit engine shutdown while editing reports a disconnected session without restarting or saving',async t=>{
  const{root,path,config}=await environment(t,{...tencent,idle_shutdown_ms:10000});
  const before=await readFile(path,'utf8'),key='fake-manually-disconnected-key';
  const flow=terminal([process.execPath,cli,'configure','--config',path],[
    {wait:'API URL（留空保留）',send:'\n'},
    {wait:'模型 ID（留空保留）',send:'\n'},
    {wait:'API Key（不回显',send:key+'\r',delay_ms:2400},
    {wait:'保存连接设置？',send:'\n'},
  ],{cwd:root,env});
  try{
    const {request}=await import('../src/host.mjs');
    await until(async()=>{try{await request(config,'/health');return true;}catch{return false;}});
    await new Promise(resolve=>setTimeout(resolve,500));
    await request(config,'/shutdown','POST',{});
    const result=await flow;assert.equal(result.code,1,result.output);assert.equal(result.steps,4);
    assert.match(result.output,/CONNECTION_DISCONNECTED/);assert.ok(!result.output.includes(key));
    assert.equal(await readFile(path,'utf8'),before);await assert.rejects(stat(socketPath(config)),{code:'ENOENT'});
  }finally{await invoke(process.execPath,[cli,'stop-engine','--config',path]);}
});
