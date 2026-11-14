import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Engine} from '../src/engine.mjs';
import {hash} from '../src/store.mjs';
import {environment,completion,until} from './helpers.mjs';

const finish={name:'finish_task',arguments:{summary:'Verified tool regression scenario'}};
const scope={read:['work'],write:['work']};
const results=task=>task.messages.filter(m=>m.role==='toolResult');
const parsed=message=>JSON.parse(message.content[0].text);
async function fixture(t,script,{setup=async()=>{},overrides={},extra={}}={}){
  const {root,config}=await environment(t,overrides);await mkdir(join(root,'work'));await setup(root);
  const engine=new Engine(config);t.after(()=>engine.close());
  const {id}=(await engine.submit({goal:'Verify released file tool behavior and scope',scope,offline_script:[...script,finish],...extra})).task;
  return {root,engine,task:await completion(engine,id)};
}

test('ordinary 3KB code writes, batched writes and hash-checked appends share the same 16K default',async t=>{
  const content='x'.repeat(3000);
  const {task,root}=await fixture(t,[
    {name:'write_file',arguments:{path:'work/a',content}},
    {name:'append_file',arguments:{path:'work/a',content:'!',expected_sha256:hash(content)}},
    {name:'write_files',arguments:{files:[{path:'work/b',content:'y'.repeat(16000)}]}},
  ]);
  assert.equal(task.status,'completed');assert.equal(await readFile(join(root,'work/a'),'utf8'),content+'!');
  assert.equal((await stat(join(root,'work/b'))).size,16000);
});

test('custom chunk limits return actionable errors without content echoes; next smaller native call succeeds',async t=>{
  const {task,root,engine}=await fixture(t,[
    {name:'write_file',arguments:{path:'work/a',content:'PRIVATE_CODE_SENTINEL'+'x'.repeat(800)}},
    {name:'write_file',arguments:{path:'work/a',content:'ok'}},
  ],{overrides:{tools:{isolation:'host',write_chunk_chars:512}}});
  assert.equal(task.status,'completed');assert.equal(await readFile(join(root,'work/a'),'utf8'),'ok');
  const failed=results(task).find(m=>m.isError),error=parsed(failed);
  assert.equal(error.error.code,'WRITE_CHUNK_LIMIT');assert.match(error.error.message,/512/);assert.match(error.retry_hint,/append_file/);
  assert.ok(!JSON.stringify(error).includes('PRIVATE_CODE_SENTINEL'));
  const event=engine.store.events(task.id,0,100).find(e=>e.type==='tool.completed'&&e.payload.is_error);
  assert.equal(event.payload.error.code,'WRITE_CHUNK_LIMIT');
});

test('batch size and per-entry size are checked before the first file is changed',async t=>{
  const {task,root}=await fixture(t,[
    {name:'write_files',arguments:{files:[{path:'work/a',content:'ok'},{path:'work/b',content:'x'.repeat(513)}]}},
    {name:'write_files',arguments:{files:[{path:'work/a',content:'x'.repeat(500)},{path:'work/b',content:'y'.repeat(500)}]}},
  ],{overrides:{tools:{isolation:'host',write_chunk_chars:512,write_batch_chars:800}}});
  assert.equal(task.status,'completed');await assert.rejects(stat(join(root,'work/a')),{code:'ENOENT'});
  assert.deepEqual(results(task).filter(m=>m.isError).map(m=>parsed(m).error.code),['WRITE_CHUNK_LIMIT','WRITE_BATCH_LIMIT']);
});

test('edits reject overlapping ambiguous matches and preserve the original file',async t=>{
  const {task,root}=await fixture(t,[{name:'edit_file',arguments:{path:'work/a',old_text:'aa',new_text:'b',expected_sha256:hash('aaa')}}],{setup:r=>writeFile(join(r,'work/a'),'aaa')});
  assert.equal(parsed(results(task)[0]).error.code,'EDIT_MATCH');assert.equal(await readFile(join(root,'work/a'),'utf8'),'aaa');
});

test('file reads bound content, expose long-line truncation, paginate, and reject invalid ranges',async t=>{
  const data=Array.from({length:20},()=> 'a'.repeat(5000)).join('\n');
  const {task}=await fixture(t,[
    {name:'read_file',arguments:{path:'work/a'}},
    {name:'read_file',arguments:{path:'work/a',start_line:7,end_line:8}},
    {name:'read_file',arguments:{path:'work/a',start_line:5,end_line:2}},
  ],{setup:r=>writeFile(join(r,'work/a'),data)});
  const first=parsed(results(task)[0]);assert.equal(first.next_start_line,7);assert.equal(first.truncated,true);
  assert.equal(first.lines.length,6);assert.ok(first.lines.every(line=>line.truncated));
  assert.ok(first.lines.reduce((n,line)=>n+line.text.length,0)<=24000);
  assert.equal(parsed(results(task)[1]).lines.length,2);assert.equal(parsed(results(task)[2]).error.code,'LINE_RANGE');
});

test('binary reads are rejected and binary acceptance digests hash the original bytes',async t=>{
  const bytes=Buffer.from([0,255,254,128,1]);
  const {task}=await fixture(t,[{name:'read_file',arguments:{path:'work/a'}}],{setup:r=>writeFile(join(r,'work/a'),bytes),extra:{acceptance:{required_files:['work/a']}}});
  assert.equal(parsed(results(task)[0]).error.code,'FILE_BINARY');
  assert.equal(task.acceptance.checks[0].sha256,createHash('sha256').update(bytes).digest('hex'));
});

test('search snippets include matches after column 1000 and deduplicate overlapping roots',async t=>{
  const {task}=await fixture(t,[{name:'search',arguments:{query:'NEEDLE'}}],{setup:r=>writeFile(join(r,'work/a'),'x'.repeat(3000)+'NEEDLE'),extra:{scope:{read:['work','work/a'],write:['work']}}});
  const found=parsed(results(task)[0]);assert.equal(found.matches.length,1);assert.match(found.matches[0].text,/NEEDLE/);assert.equal(found.matches[0].column,3001);
});

test('search limits all scanned entries, including directories without files',async t=>{
  const {task}=await fixture(t,[{name:'search',arguments:{query:'absent'}}],{setup:async r=>{for(let i=0;i<1010;i++)await mkdir(join(r,'work',String(i)));}});
  const found=parsed(results(task)[0]);assert.equal(found.scanned_entries,1000);assert.equal(found.limited,true);
});

test('symlinks, private paths, stale hashes and undeclared commands remain blocked',async t=>{
  const {task,root}=await fixture(t,[
    {name:'write_file',arguments:{path:'work/link',content:'bad'}},
    {name:'write_file',arguments:{path:'work/.env',content:'bad'}},
    {name:'write_file',arguments:{path:'work/a',content:'bad',expected_sha256:hash('older')}},
    {name:'run_command',arguments:{argv:['node','-e','process.exit(0)'],cwd:'work'}},
  ],{setup:async r=>{await writeFile(join(r,'work/a'),'old');await symlink('a',join(r,'work/link'));},overrides:{budget:{max_no_progress_calls:6}}});
  assert.equal(task.status,'completed');assert.equal(await readFile(join(root,'work/a'),'utf8'),'old');
  assert.deepEqual(results(task).filter(m=>m.isError).map(m=>parsed(m).error.code),['PATH_SYMLINK','PATH_SCOPE','FILE_CHANGED','COMMAND_SCOPE']);
});

test('search also discovers files in write scopes, consistent with read_file permissions',async t=>{
  const {task}=await fixture(t,[{name:'search',arguments:{query:'find-me'}}],{setup:r=>writeFile(join(r,'work/a'),'find-me'),extra:{scope:{read:['docs'],write:['work']}}});
  assert.equal(parsed(results(task)[0]).matches.length,1);
});

test('expired resume becomes a terminal deadline state without a model call or budget reset',async t=>{
  const {task,engine}=await fixture(t,[{name:'request_input',arguments:{question:'Wait for fixture'}}]);
  await until(()=>!engine.active);
  const old=engine.store.get(task.id);old.created_at='2000-01-01T00:00:00.000Z';engine.store.save(old);
  const before=engine.get(task.id).usage.model_calls;
  await assert.rejects(engine.control(task.id,'resume',{input:'Continue same scope'}),{code:'DEADLINE'});
  const after=engine.get(task.id);assert.equal(after.status,'budget_exceeded');assert.equal(after.error.code,'DEADLINE');assert.equal(after.usage.model_calls,before);
});

test('new instructions reset a paused progress window without resetting token, call or time budgets',async t=>{
  const {task,engine}=await fixture(t,[{name:'request_input',arguments:{question:'Wait for bounded review feedback'}}]);
  await until(()=>!engine.active);
  const old=engine.store.get(task.id);old.status='paused';old.progress_guard={consecutive:3,revision:0,observed_call:old.last_model_response?.call_id};engine.store.save(old);
  const before=structuredClone(old);
  const resumed=await engine.control(task.id,'resume',{input:'Next step: finish the existing verified fixture.'});
  const after=engine.store.get(task.id);
  assert.equal(after.progress_guard.consecutive,0);assert.equal(after.created_at,before.created_at);
  assert.deepEqual(after.spec.budget,before.spec.budget);assert.equal(resumed.usage.tokens,before.usage.tokens);assert.equal(resumed.usage.model_calls,before.usage.model_calls);
  assert.equal((await completion(engine,task.id)).status,'completed');
});

test('milestone rechecks retain historical evidence while reporting the latest failure',async t=>{
  const command={argv:['node','-e',"require('fs').unlinkSync('a')"],cwd:'work'};
  const {task}=await fixture(t,[
    {name:'check_milestone',arguments:{name:'preview'}},
    {name:'check_milestone',arguments:{name:'short'}},
    {name:'check_milestone',arguments:{name:'preview'}},
    {name:'run_command',arguments:command},
    {name:'check_milestone',arguments:{name:'preview'}},
    {name:'request_input',arguments:{question:'Expected prerequisite missing after recheck'}},
  ],{setup:r=>writeFile(join(r,'work/a'),'ok'),extra:{scope:{...scope,commands:[command]},milestones:[{name:'preview',required_files:['work/a']},{name:'short',required_files:['work/a']}]}});
  const checks=results(task).filter(m=>m.toolName==='check_milestone');
  assert.deepEqual(checks.map(m=>parsed(m).passed),[true,true,true,false]);
  assert.equal(task.milestones.preview.passed,false);assert.equal(task.milestones.preview.passed_once,true);assert.equal(task.milestones.short.passed,true);assert.equal(task.milestones.short.historical,true);assert.equal(task.milestone_history.length,4);
});
