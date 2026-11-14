import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {environment} from './helpers.mjs';
import {hash} from '../src/store.mjs';
const invoke=promisify(execFile),cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));

test('CLI infers project configuration, and an unconfigured project gets first-run guidance',async t=>{
  const {root}=await environment(t);const testHome=join(root,'home');await mkdir(testHome);
  const env={...process.env,HOME:testHome};
  const run=(...args)=>invoke(process.execPath,[cli,...args],{env,cwd:root,timeout:15000});
  await assert.rejects(run('models'),error=>{const value=JSON.parse(error.stderr);assert.equal(value.error.code,'GLOBAL_NOT_CONFIGURED');assert.match(value.error.message,/deng init/);return true;});
  const initialized=JSON.parse((await run('init','--project',root,'--offline')).stdout);
  assert.equal(initialized.config,join(testHome,'.config/dengagent',`project-${hash(root).slice(0,16)}.json`));
  t.after(()=>run('stop-engine').catch(()=>{}));
  assert.equal(JSON.parse((await run('doctor','--project',root)).stdout).ready,true);
  assert.equal(JSON.parse((await run('configure','--project',root,'--show')).stdout).profiles[0].profile,'worker');
  assert.equal(JSON.parse((await run('console','--project',root)).stdout).model_calls,0);
  await run('stop-engine');
});

test('initialization through a symlink shares the canonical project config without duplicating credentials',async t=>{
  const {root}=await environment(t);const project=join(root,'project'),alias=join(root,'alias'),testHome=join(root,'home');
  await mkdir(project);await mkdir(testHome);await symlink(project,alias);
  const env={...process.env,HOME:testHome};const run=(...args)=>invoke(process.execPath,[cli,...args],{env,timeout:15000});
  const first=JSON.parse((await run('init','--project',alias,'--offline')).stdout);
  t.after(()=>run('stop-engine','--project',project).catch(()=>{}));
  const before=await readFile(first.config,'utf8');
  const repeated=JSON.parse((await run('init','--project',project,'--offline')).stdout);
  assert.equal(repeated.configuration_reused,true);assert.equal(repeated.config,first.config);assert.equal(await readFile(first.config,'utf8'),before);
  assert.equal(JSON.parse((await run('configure','--project',project,'--show')).stdout).profiles[0].profile,'worker');
  await run('stop-engine','--project',project);
});
