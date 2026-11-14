import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareContext } from '../src/context.mjs';

const profile={context_window:24000,max_output_tokens:4096};
const task={spec:{budget:{max_total_tokens:80000}},usage:{tokens:1000},changes:{'index.html':{after:'known-hash'}}};

test('context compaction preserves user requirements, tool pairs, file evidence and the full local transcript',()=>{
  const context={systemPrompt:'Immutable scope and policy',tools:[],messages:[
    {role:'user',content:'Build only inside src; fixed acceptance must not change.'},
    {role:'assistant',content:[{type:'toolCall',id:'old',name:'write_file',arguments:{path:'index.html',content:'x'.repeat(20000)}}]},
    {role:'toolResult',toolCallId:'old',toolName:'write_file',content:[{type:'text',text:'{"sha256":"known-hash"}'}]},
    {role:'user',content:'Later clarification: use Chinese labels.'},
    {role:'assistant',content:[{type:'toolCall',id:'recent',name:'read_file',arguments:{path:'app.js'}}]},
    {role:'toolResult',toolCallId:'recent',toolName:'read_file',content:[{type:'text',text:'small file content'}]},
  ]};
  const original=JSON.stringify(context);
  const result=prepareContext(context,task,profile);
  assert.ok(result.compacted);
  assert.equal(JSON.stringify(context),original);
  assert.equal(result.context.systemPrompt,context.systemPrompt);
  const text=JSON.stringify(result.context.messages);
  assert.match(text,/fixed acceptance must not change/);
  assert.match(text,/Later clarification/);
  assert.match(text,/known-hash/);
  assert.ok(!text.includes('x'.repeat(1000)));
  const recent=result.context.messages.findIndex(m=>m.role==='assistant');
  assert.equal(result.context.messages[recent+1].toolCallId,'recent');
  assert.ok(result.inputReserve+1024<=profile.context_window);
});

test('irreducible context and exhausted task allowance have distinct errors and do not mutate usage',()=>{
  const context={systemPrompt:'x'.repeat(30000),tools:[],messages:[{role:'user',content:'Do not omit this task.'}]};
  assert.throws(()=>prepareContext(context,task,profile),{code:'CONTEXT_LIMIT'});
  assert.throws(()=>prepareContext(context,{...task,usage:{tokens:79000}},profile),{code:'BUDGET_EXCEEDED'});
  assert.equal(task.usage.tokens,1000);
});

test('DeepSeek thinking compaction removes complete tool chains, retaining immutable user instructions and no chain suffix',()=>{
 const ds={...profile,thinking:'enabled',model:'deepseek/deepseek-flash',reasoning_effort:'low',compat:{reasoning_format:'deepseek'}};
 const context={systemPrompt:'policy',tools:[],messages:[
  {role:'user',content:'Immutable task'},
  {role:'assistant',content:[{type:'thinking',thinking:'r'.repeat(20000)},{type:'toolCall',id:'a',name:'write_file',arguments:{}}]},
  {role:'toolResult',toolCallId:'a',content:[{type:'text',text:'done'}]},
  {role:'assistant',content:[{type:'thinking',thinking:'needed-continuation'},{type:'toolCall',id:'b',name:'append_file',arguments:{}}]},
  {role:'toolResult',toolCallId:'b',content:[{type:'text',text:'done'}]},
 ]};
 const original=JSON.stringify(context),result=prepareContext(context,task,ds);
 assert.equal(result.compacted.policy,'whole-reasoning-chain');
 assert.ok(result.context.messages.every(m=>m.role==='user'));
 assert.match(JSON.stringify(result.context),/Immutable task/);
 assert.equal(JSON.stringify(context),original);
});

test('malformed tool history is refused before compaction or dispatch',()=>{
 for(const messages of [
  [{role:'toolResult',toolCallId:'orphan',content:[]}],
  [{role:'assistant',content:[{type:'toolCall',id:'a'}]}],
  [{role:'assistant',content:[{type:'toolCall',id:'a'}]},{role:'user',content:'interruption'}],
 ])assert.throws(()=>prepareContext({messages,tools:[],systemPrompt:''},task,profile),{code:'CONTEXT_PROTOCOL_INVALID'});
});

for (const reasoning of [false,true]) test(`normalized transcript preserves system policy and tool declarations during ${reasoning?'DeepSeek':'ordinary'} compaction`,()=>{
 const normalized={messages:[
  {role:'system',content:'Immutable worker policy',toolsAdded:[{name:'read_file',description:'Read file',parameters:{type:'object',properties:{path:{type:'string'}}}}]},
  {role:'user',content:'Immutable task'},
  {role:'assistant',content:[{type:'text',text:'x'.repeat(20000)}]},
  {role:'system',content:'Additional policy',toolsRemoved:[{name:'read_file'}],toolsAdded:[{name:'finish_task',description:'Finish',parameters:{type:'object'}}]},
  {role:'assistant',content:[{type:'text',text:'y'.repeat(2000)}]},
 ]};
 const original=JSON.stringify(normalized);
 const selected={...profile,thinking:reasoning?'enabled':'disabled',reasoning_effort:'low',compat:{reasoning_format:'deepseek'}};
 const result=prepareContext(normalized,task,selected);
 assert.ok(result.compacted);
 assert.deepEqual(result.context.messages.filter(m=>m.role==='system'),normalized.messages.filter(m=>m.role==='system'));
 assert.equal(result.context.messages[0].role,'system');
 assert.equal(JSON.stringify(normalized),original);
 assert.ok(!JSON.stringify(result.context).includes('x'.repeat(1000)));
 const again=prepareContext(result.context,task,selected);
 assert.deepEqual(again.context.messages.filter(m=>m.role==='system'),normalized.messages.filter(m=>m.role==='system'));
});

test('oversized normalized system policy and tools are irreducible, never silently discarded',()=>{
 const context={messages:[
  {role:'system',content:'Immutable policy',toolsAdded:[{name:'read_file',description:'x'.repeat(30000),parameters:{type:'object'}}]},
  {role:'user',content:'Task'}
 ]};
 assert.throws(()=>prepareContext(context,task,profile),{code:'CONTEXT_LIMIT'});
 assert.throws(()=>prepareContext(context,{...task,usage:{tokens:79000}},profile),{code:'BUDGET_EXCEEDED'});
});

test('contextfix.1 current read/hash evidence survives projection without rewriting the original ledger',()=>{
 const lines=Array.from({length:150},(_,i)=>({line:i+1,text:'中文code'.repeat(70)}));
 const context={systemPrompt:'immutable policy',tools:[],messages:[{role:'user',content:'Preserve task'},
  {role:'assistant',content:[{type:'toolCall',id:'old',name:'write_file',arguments:{content:'x'.repeat(25000)}}]},
  {role:'toolResult',toolName:'write_file',toolCallId:'old',content:[{type:'text',text:'{"sha256":"known-hash"}'}]},
  {role:'assistant',content:[{type:'toolCall',id:'read',name:'read_file',arguments:{path:'index.html'}}]},
  {role:'toolResult',toolName:'read_file',toolCallId:'read',content:[{type:'text',text:JSON.stringify({path:'index.html',sha256:'known-hash',start_line:1,lines})}]},
 ]};
 const original=JSON.stringify(context),r=prepareContext(context,task,profile);
 const read=r.context.messages.find(m=>m.toolName==='read_file'),v=JSON.parse(read.content[0].text);
 assert.equal(v.sha256,'known-hash');assert.ok(v.lines.length>0&&v.lines.length<lines.length);assert.ok(v.context_excerpt.omitted_line_count>0);
 assert.equal(JSON.stringify(context),original);assert.ok(r.context.messages.some(m=>m.role==='assistant'&&m.content.some(b=>b.id==='read')));
});
