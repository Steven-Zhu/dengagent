import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,readFile,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { projectInput } from '../src/setup-prompts.mjs';
import { environment } from './helpers.mjs';
import { terminal } from './pty.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
test('project paths accept Finder quotes, escaped spaces and home notation',()=>{
  assert.equal(projectInput("  '/tmp/project with spaces'  "),'/tmp/project with spaces');
  assert.equal(projectInput('/tmp/project\\ with\\ spaces'),'/tmp/project with spaces');
  assert.equal(projectInput('"/tmp/project with spaces"'),'/tmp/project with spaces');
  assert.equal(projectInput('~/project'),join(homedir(),'project'));
});

test('real terminal setup rejects file paths, creates a nested project and configures compatible model and hidden key',async t=>{
  const{root}=await environment(t);const project=join(root,'new parent','project with spaces');const blocker=join(root,'existing file');await writeFile(blocker,'keep me');
  const config=join(root,'wizard.json');const secret='fake-wizard-key-not-for-network';
  const result=await terminal([process.execPath,cli,'init','--config',config],[
    {wait:'（回车使用默认目录）: ',send:blocker+'\n'},
    {wait:'（回车使用默认目录）: ',send:join(blocker,'child')+'\n'},
    {wait:'（回车使用默认目录）: ',send:"'"+project+"'\n"},
    {wait:'Model base URL / ',send:'\n'},
    {wait:'Model base URL / ',send:'not-a-url\n'},
    {wait:'Model base URL / ',send:'https://custom-api.invalid/v1\n'},
    {wait:'Model ID / ',send:'\n'},
    {wait:'Model ID / ',send:'fixture-model\n'},
    {wait:'API Key（',send:secret+'\r'},
  ],{env:{TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''}});
  assert.equal(result.code,0,result.output);assert.equal(result.steps,9);
  assert.match(result.output,/无法使用这个路径/);assert.equal(await readFile(blocker,'utf8'),'keep me');assert.equal((await stat(project)).isDirectory(),true);
  assert.ok(!result.output.includes('ExperimentalWarning'));assert.ok(!result.output.includes(secret));
  assert.ok(!result.output.includes('回车使用默认值'));assert.ok(!result.output.includes('deepseek/deepseek-flash'));
  assert.ok(!result.output.includes('api_key_file'));assert.match(result.output,/修改连接：/);
  const text=await readFile(config,'utf8');assert.ok(!text.includes(secret));
  const settings=JSON.parse(text);
  assert.equal(settings.workspace_root,project);assert.equal(settings.provider,'compatible');
  assert.equal(settings.models.profiles.worker.api_key_env,'DENG_API_KEY');assert.equal(settings.models.profiles.worker.thinking,'enabled');
  assert.match(result.output,/请输入有效的 HTTPS/);
  assert.equal(await readFile(settings.models.profiles.worker.api_key_file,'utf8'),secret+'\n');
  assert.equal((await stat(settings.models.profiles.worker.api_key_file)).mode&0o077,0);
  assert.match(await readFile(join(project,'.codex','config.toml'),'utf8'),/mcp_servers.dengagent/);
});


test('real terminal setup displays cwd as default and Enter accepts it',async t=>{
  const{root}=await environment(t);const project=join(root,'default project');await mkdir(project);
  const config=join(root,'default-wizard.json');
  const result=await terminal([process.execPath,cli,'init','--offline','--config',config],[
    {wait:`项目目录 [${project}]（回车使用默认目录）: `,send:'\n'},
  ],{cwd:project});
  assert.equal(result.code,0,result.output);assert.equal(result.steps,1);
  assert.equal(JSON.parse(await readFile(config,'utf8')).workspace_root,project);
  assert.match(await readFile(join(project,'.codex/config.toml'),'utf8'),/mcp_servers.dengagent/);
});

test('real terminal setup creates a relative nested directory from cwd',async t=>{
  const{root}=await environment(t);const config=join(root,'relative-wizard.json');
  const result=await terminal([process.execPath,cli,'init','--offline','--config',config],[
    {wait:'（回车使用默认目录）: ',send:'new parent/relative project\n'},
  ],{cwd:root});
  assert.equal(result.code,0,result.output);
  const project=join(root,'new parent','relative project');
  assert.equal(JSON.parse(await readFile(config,'utf8')).workspace_root,project);
  assert.equal((await stat(project)).isDirectory(),true);
});

test('cancel at first prompt exits without configuration or registration',async t=>{
  const{root}=await environment(t);const config=join(root,'cancelled.json');
  const result=await terminal([process.execPath,cli,'init','--config',config],[{wait:'（回车使用默认目录）: ',send:'\u0003'}]);
  assert.equal(result.code,1,result.output);assert.match(result.output,/CANCELLED/);
  await assert.rejects(stat(config),{code:'ENOENT'});
});


test('init without a Key names both later settings routes and configure can fill it',async t=>{
  const{root}=await environment(t);const config=join(root,'deferred-key.json');
  const env={TENCENT_TOKENHUB_API_KEY:'',DENG_API_KEY:''};
  const result=await terminal([process.execPath,cli,'init','--config',config],[
    {wait:'（回车使用默认目录）: ',send:'\n'},
    {wait:'Model base URL / 模型接口（必填）: ',send:'https://deferred.invalid/v1\n'},
    {wait:'Model ID / 模型名称（必填）: ',send:'deferred-model\n'},
    {wait:'API Key（',send:'\r'},
  ],{cwd:root,env});
  assert.equal(result.code,0,result.output);assert.equal(result.steps,4);
  assert.match(result.output,/deng configure/);assert.match(result.output,/deng console/);
  assert.match(result.output,/API Key：未配置，可稍后补填/);
  const initial=JSON.parse(await readFile(config,'utf8'));
  assert.equal(initial.models.profiles.worker.api_key_file,undefined);
  await assert.rejects(stat(config+'.credential'),{code:'ENOENT'});
  const key='fake-deferred-setup-key';
  const updated=await terminal([process.execPath,cli,'configure','--config',config],[
    {wait:'API URL（留空保留）',send:'\n'},
    {wait:'模型 ID（留空保留）',send:'\n'},
    {wait:'API Key（不回显',send:key+'\r'},
    {wait:'保存连接设置？',send:'\n'},
  ],{cwd:root,env});
  try{
    assert.equal(updated.code,0,updated.output);assert.ok(!updated.output.includes(key));
    const text=await readFile(config,'utf8');assert.ok(!text.includes(key));
    const saved=JSON.parse(text);assert.equal(await readFile(saved.models.profiles.worker.api_key_file,'utf8'),key+'\n');
    assert.equal((await stat(saved.models.profiles.worker.api_key_file)).mode&0o077,0);
  }finally{await promisify(execFile)(process.execPath,[cli,'stop-engine','--config',config]);}
});

test('noninteractive first-time setup requires explicit URL and model',async t=>{
  const{root}=await environment(t);const config=join(root,'explicit-model.json');const invoke=promisify(execFile);
  for(const extra of [[],['--base-url','https://explicit.invalid/v1']]){
    await assert.rejects(invoke(process.execPath,[cli,'init','--project',root,'--config',config,...extra]),error=>{
      assert.equal(JSON.parse(error.stderr).error.code,'MODEL_REQUIRED');return true;
    });
    await assert.rejects(stat(config),{code:'ENOENT'});
  }
  const result=await invoke(process.execPath,[cli,'init','--project',root,'--config',config,'--base-url','https://explicit.invalid/v1','--model-id','explicit-model']);
  assert.equal(JSON.parse(result.stdout).provider,'compatible');
  assert.equal(JSON.parse(await readFile(config,'utf8')).models.profiles.worker.model,'explicit-model');
});

test('repeat setup reuses same-project configuration without overwriting credentials and rejects another project',async t=>{
  const{root,path}=await environment(t);const original=await readFile(path,'utf8');
  const invoke=promisify(execFile);
  const result=await invoke(process.execPath,[cli,'init','--project',root,'--config',path]);
  assert.equal(JSON.parse(result.stdout).configuration_reused,true);assert.equal(await readFile(path,'utf8'),original);
  assert.ok(!result.stderr.includes('ExperimentalWarning'));
  const other=join(root,'other');await mkdir(other);
  await assert.rejects(invoke(process.execPath,[cli,'init','--project',other,'--config',path]),error=>{
    assert.equal(JSON.parse(error.stderr).error.code,'CONFIG_PROJECT');return true;
  });
  assert.equal(await readFile(path,'utf8'),original);
});
