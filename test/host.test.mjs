import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startHost,request } from '../src/host.mjs';
import { setupCodex } from '../src/setup.mjs';
import { parse } from 'smol-toml';
import { environment,until } from './helpers.mjs';
import { fileURLToPath } from 'node:url';

test('one engine serves multiple clients, cursor reconnect and bounded artifacts',async t=>{
  const{config}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
  await assert.rejects(startHost(config),{code:'ENGINE_BUSY'});
  const result=await request(config,'/tasks','POST',{goal:'Observe an offline task from multiple clients'});const id=result.task.id;
  await until(async()=>['completed','failed'].includes((await request(config,`/tasks/${id}`)).status));
  const first=await request(config,`/tasks/${id}/events?limit=2`);const second=await request(config,`/tasks/${id}/events?after=${first.next_seq}&limit=2`);
  assert.equal(first.events.length,2);assert.ok(second.events[0].seq>first.events.at(-1).seq);
  let offset=0,text='',digest;
  do{const page=await request(config,`/tasks/${id}/artifact?offset=${offset}&limit=50`);digest??=page.sha256;assert.equal(page.sha256,digest);text+=page.content;offset=page.next_offset;}while(offset!==null);
  assert.equal(JSON.parse(text).result.output.offline,true);
});

test('Codex setup preserves unrelated config, installs workflow and is idempotent',async t=>{
  const{root,config}=await environment(t);await mkdir(join(root,'.codex'));await writeFile(join(root,'.codex','config.toml'),'model = "existing-model"\n[mcp_servers.other]\ncommand = "other-server"\n');
  const preview=await setupCodex(config);assert.equal(preview.applied,false);
  await setupCodex(config,{apply:true});const parsed=parse(await readFile(join(root,'.codex','config.toml'),'utf8'));
  assert.equal(parsed.model,'existing-model');assert.equal(parsed.mcp_servers.other.command,'other-server');assert.ok(parsed.mcp_servers.dengagent.args.includes('mcp'));
  assert.equal((await setupCodex(config,{apply:true})).unchanged,true);assert.match(await readFile(join(root,'.agents','skills','dengagent','SKILL.md'),'utf8'),/DengAgent/);
});

test('actual stdio MCP submits and queries a task against the shared engine',async t=>{
  const{root,path,config}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
  await writeFile(join(root,'task.json'),JSON.stringify({goal:'Run a bounded offline task through actual MCP'}));
  const client=new Client({name:'deng-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/deng.mjs',import.meta.url)),'mcp','--config',path],stderr:'pipe'});
  await client.connect(transport);t.after(()=>client.close());
  const names=(await client.listTools()).tools.map(tool=>tool.name);assert.deepEqual(names.sort(),['console_input','console_status','render_console','console_snapshot','console_select_model','console_control','prepare_console','submit_task','get_task','control_task','read_events','read_artifact','get_models','set_model','wait_task','get_task_details','send_input','verify_delivery','runtime_status'].sort());
  const catalog=JSON.parse((await client.callTool({name:'get_models',arguments:{}})).content[0].text);
  assert.equal(catalog.default.model,'offline-fixture');assert.equal(catalog.selection_model_calls,0);
  const selected=JSON.parse((await client.callTool({name:'set_model',arguments:{model:'offline-selected'}})).content[0].text);
  assert.equal(selected.scope,'future_tasks');assert.equal(selected.selection_model_calls,0);
  const prepared=JSON.parse((await client.callTool({name:'prepare_console',arguments:{}})).content[0].text);assert.equal(host.engine.store.list().length,0);assert.equal(prepared.selection_model_calls,0);
  const result=await client.callTool({name:'submit_task',arguments:{task_file:'task.json'}});assert.equal(result.isError,undefined);
  const value=JSON.parse(result.content[0].text);assert.ok(value.watch.args.includes(value.task.id));assert.equal(value.watch.panel_url,prepared.panel_url);
  assert.match(value.watch.panel_url,/^http:\/\/127\.0\.0\.1:\d+\/view\//);
  assert.equal((await fetch(value.watch.panel_url)).status,200);
  assert.equal(value.task.model_info.model,'offline-selected');
  assert.equal(value.task.schema,'deng.task-summary.v1');assert.ok(!('goal' in value.task));
  const details=JSON.parse((await client.callTool({name:'get_task_details',arguments:{task_id:value.task.id}})).content[0].text);assert.match(details.content,/bounded offline task/);assert.ok(details.sha256);

  await until(async()=>{
    const state=await client.callTool({name:'get_task',arguments:{task_id:value.task.id}});
    return JSON.parse(state.content[0].text).status==='completed';
  });
});

test('prepared console remains reachable past normal idle shutdown before any browser connects',async t=>{
  const {config}=await environment(t,{idle_shutdown_ms:1000});const host=await startHost(config);t.after(()=>host.close());
  const prepared=await request(config,'/console/prepare','POST',{});assert.equal(prepared.connected,false);assert.equal(prepared.launch_grace_ms,600000);
  const{setTimeout:delay}=await import('node:timers/promises');await delay(2300);
  const response=await fetch(prepared.panel_url);assert.equal(response.status,200);assert.match(await response.text(),/Deng/);
  assert.equal(host.engine.store.list().length,0);
});

test('HTTP completion wait is bounded, cursor-aware and makes no inference requests',async t=>{
 const{config}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
 const submitted=await request(config,'/tasks','POST',{goal:'Wait through host notification endpoint'});const id=submitted.task.id;
 const notice=await request(config,`/tasks/${id}/wait?timeout=1000`);
 assert.equal(notice.timed_out,false);assert.equal(notice.notification.status,'completed');assert.equal(notice.model_calls,0);
 const calls=host.engine.get(id).usage.model_calls;
 const quiet=await request(config,`/tasks/${id}/wait?after=${notice.cursor}&timeout=10`);
 assert.equal(quiet.timed_out,true);assert.equal(quiet.notification,null);assert.equal(host.engine.get(id).usage.model_calls,calls);
 await assert.rejects(request(config,`/tasks/${id}/wait?timeout=60000`),{code:'CURSOR'});
});
