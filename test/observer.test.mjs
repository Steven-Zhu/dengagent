import test from 'node:test';
import assert from 'node:assert/strict';
import { startHost,request } from '../src/host.mjs';
import { startObserver } from '../src/observer.mjs';
import { environment,until } from './helpers.mjs';

test('browser observer serves actual historical events including failed task state without inference',async t=>{
  const{config}=await environment(t);const host=await startHost(config);t.after(()=>host.close());
  const {task}=await host.engine.submit({goal:'Exercise real observer events without a model service',budget:{max_model_calls:1},offline_script:[{name:'request_input',arguments:{question:'A decision is needed'}}]});
  await until(()=>host.engine.get(task.id).status==='waiting_input'&&!host.engine.active);
  // Model an interrupted request with a real task error field; successful reads must not treat it as HTTP failure.
  const stored=host.engine.store.get(task.id);stored.status='budget_exceeded';stored.error={code:'BUDGET_EXCEEDED',message:'Admission budget blocked'};host.engine.store.save(stored);
  const state=await request(config,`/tasks/${task.id}`);assert.equal(state.status,'budget_exceeded');
  host.engine.store.event(stored,'model.text_delta',{text:'<script>not executable</script>'});
  const calls=stored.usage.model_calls;
  const observer=await startObserver(config,task.id);t.after(()=>observer.close());
  const response=await fetch(observer.url);assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/script-src 'nonce-/);
  const html=await response.text();assert.ok(!html.includes('__NONCE__'));assert.match(html,/textContent/);
  const page=await (await fetch(observer.url+'events?after=0')).json();
  assert.equal(page.task.status,'budget_exceeded');assert.equal(page.task.model_info.provider_mode,'offline');
  assert.ok(page.events.some(event=>event.payload.text==='<script>not executable</script>'));
  assert.equal(page.task.profile,undefined);assert.ok(!JSON.stringify(page).includes('api_key_env'));
  const next=await (await fetch(observer.url+'events?after='+page.next_seq)).json();assert.equal(next.events.length,0);
  host.engine.store.event(stored,'model.text_delta',{text:'A newly emitted event appears after the cursor'});
  const live=await (await fetch(observer.url+'events?after='+page.next_seq)).json();
  assert.equal(live.events.length,1);assert.equal(live.events[0].payload.text,'A newly emitted event appears after the cursor');
  assert.equal(host.engine.get(task.id).usage.model_calls,calls);
  assert.equal((await fetch(observer.url+'events',{method:'POST'})).status,405);
  assert.equal((await fetch(observer.url+'events',{headers:{Origin:'https://other.invalid'}})).status,403);
  assert.equal((await fetch(new URL('/view/wrong/',observer.url))).status,404);
  assert.equal((await fetch(observer.url+'events?after=-1')).status,400);
});

async function snapshots(url,{cursor}={}){
  const controller=new AbortController();const response=await fetch(url,{headers:cursor?{'Last-Event-ID':cursor}:{},signal:controller.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  return {close:()=>controller.abort(),async next(predicate=()=>true){
    const timer=setTimeout(()=>controller.abort(),5000);
    try{while(true){let split;while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=frame.split('\n').find(line=>line.startsWith('data: '));if(data){const page=JSON.parse(data.slice(6));if(predicate(page))return page;}}
      const part=await reader.read();if(part.done)throw new Error('Stream ended');buffer+=decoder.decode(part.value,{stream:true});
    }}finally{clearTimeout(timer);}
  }};
}

test('console streams before work, follows later tasks, resumes cursor, and model selection affects only future tasks',async t=>{
  const {config}=await environment(t,{models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'first'}},choices:[{profile:'worker',model:'second',name:'Second'}]}});
  const host=await startHost(config);t.after(()=>host.close());
  const health=await request(config,'/health');const url=health.console_url;
  const html=await(await fetch(url)).text();const csrf=/x-deng-csrf':'([^']+)'/.exec(html)[1];
  const js=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];const{Script}=await import('node:vm');new Script(js);
  assert.equal((html.match(/<select /g)||[]).length,5);
  const stream=await snapshots(url+'stream');t.after(()=>stream.close());
  assert.equal((await stream.next()).task,null);
  const command={argv:[process.execPath,'-e','setTimeout(()=>{},2000)'],cwd:'.'};
  const first=await host.engine.submit({goal:'Keep a real worker running while changing the future model',scope:{read:['.'],commands:[command]},offline_script:[{name:'run_command',arguments:command},{name:'request_input',arguments:{question:'Hold here'}}]});
  await stream.next(p=>p.task?.id===first.task.id&&p.events.some(e=>e.type==='tool.started'));
  const before=host.engine.get(first.task.id);assert.equal(before.status,'running');
  const headers={Origin:new URL(url).origin,'content-type':'application/json','x-deng-csrf':csrf};
  const changed=await fetch(url+'model',{method:'POST',headers,body:JSON.stringify({profile:'worker',model:'second'})});assert.equal(changed.status,200);
  const current=host.engine.get(first.task.id);assert.equal(current.model_info.model,'first');assert.equal(current.status,'running');assert.equal(current.usage.model_calls,before.usage.model_calls);
  const selected=await stream.next(p=>p.models.default.model==='second');assert.equal(selected.task.id,first.task.id);
  stream.close();
  const second=await host.engine.submit({goal:'A newly submitted task uses the saved selection'});assert.equal(second.task.model_info.model,'second');
  const resumed=await snapshots(url+'stream',{cursor:first.task.id+':'+selected.next_seq});t.after(()=>resumed.close());
  const page=await resumed.next(p=>p.task?.id===second.task.id);assert.ok(page.events.some(e=>e.type==='task.queued'));
  assert.equal((await fetch(url+'model',{method:'POST',headers,body:JSON.stringify({profile:'worker',model:'first',task_id:first.task.id})})).status,400);
  assert.equal((await fetch(url+'model',{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'model',{method:'POST',headers:{Origin:headers.Origin,'content-type':'application/json'},body:'{}'})).status,403);
  const paused=await fetch(url+'control',{method:'POST',headers,body:JSON.stringify({task_id:first.task.id,action:'pause',expected_revision:current.revision})});assert.equal(paused.status,200);assert.equal((await paused.json()).status,'paused');
  assert.equal(host.engine.get(first.task.id).model_info.model,'first');
  await until(()=>host.engine.get(second.task.id).status==='completed');resumed.close();
  const fixed=await startObserver(config,second.task.id);t.after(()=>fixed.close());
  const history=await request(config,`/tasks/${second.task.id}/events`);
  const tail=await snapshots(fixed.url+'stream',{cursor:second.task.id+':'+history.next_seq});t.after(()=>tail.close());assert.equal((await tail.next()).events.length,0);
  host.engine.store.event(host.engine.store.get(second.task.id),'model.text_delta',{text:'Reconnect evidence'});
  const delta=await tail.next(p=>p.events.length>0);assert.equal(delta.events.length,1);assert.equal(delta.events[0].payload.text,'Reconnect evidence');
});
