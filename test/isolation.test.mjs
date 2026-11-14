import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { environment,completion } from './helpers.mjs';
import http from 'node:http';

test('macOS command backend permits scoped tests but blocks undeclared writes and private reads',{skip:process.platform!=='darwin'},async t=>{
  const{root,config}=await environment(t,{tools:{isolation:'macos'}});await mkdir(join(root,'src'));await writeFile(join(root,'.env'),'must-stay-private');
  const script=`const fs=require('fs');fs.writeFileSync('src/allowed.txt','ok');let blocked=0;try{fs.writeFileSync('outside.txt','bad')}catch{blocked++}try{fs.readFileSync('.env')}catch{blocked++}if(blocked!==2)process.exit(9);`;
  const command={argv:['node','-e',script],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());
  const{id}=(await engine.submit({goal:'Verify operating-system write and private-file boundaries',scope:{read:['.'],write:['src'],commands:[command]},acceptance:{commands:[command]},budget:{max_repair_rounds:0}})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed',JSON.stringify(task.acceptance));assert.equal(task.effective_isolation,'macos-write-network');assert.equal(await readFile(join(root,'src','allowed.txt'),'utf8'),'ok');
});

test('macOS command sandbox blocks network access',{skip:process.platform!=='darwin'},async t=>{
  let reached=0;const server=http.createServer((_request,response)=>{reached++;response.end('should not be reached');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const{config}=await environment(t,{tools:{isolation:'macos'}});
  const command={argv:['node','-e',`fetch('http://127.0.0.1:${server.address().port}').then(()=>process.exit(17)).catch(()=>console.log('network blocked'))`],cwd:'.'};
  const engine=new Engine(config);t.after(()=>engine.close());const{id}=(await engine.submit({goal:'Verify the declared command network restriction',acceptance:{commands:[command]},budget:{max_repair_rounds:0}})).task;
  const task=await completion(engine,id);assert.equal(task.status,'completed',JSON.stringify(task.acceptance));assert.equal(reached,0);assert.match(task.acceptance.checks[0].output,/network blocked/);
});
