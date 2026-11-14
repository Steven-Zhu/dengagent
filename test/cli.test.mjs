import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startHost,request,ensureHost,socketPath } from '../src/host.mjs';
import { hash } from '../src/store.mjs';
import { environment,until } from './helpers.mjs';

const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
const invoke=promisify(execFile);
const models={default:'worker',profiles:{
  worker:{base_url:'https://example.invalid/v1',model:'small'},
  reviewer:{base_url:'https://other.invalid/v1',model:'large'},
}};

test('CLI lists without prompting, switches defaults and stopped tasks, and prints watcher model metadata',async t=>{
  const{path,config}=await environment(t,{models});const host=await startHost(config);t.after(()=>host.close());
  const run=(...args)=>invoke(process.execPath,[cli,...args,'--config',path],{timeout:15000});
  const listed=JSON.parse((await run('model','--json')).stdout);assert.equal(listed.default.model,'small');
  assert.equal(JSON.parse((await run('model','reviewer')).stdout).scope,'future_tasks');
  const {task}=await request(config,'/tasks','POST',{goal:'Pause for model selection in the actual terminal CLI',offline_script:[
    {name:'request_input',arguments:{question:'Choose a model'}},{name:'finish_task',arguments:{summary:'CLI fixture done'}},
  ]});
  assert.equal(task.model,'large');await until(()=>host.engine.get(task.id).status==='waiting_input'&&!host.engine.active);
  const switched=JSON.parse((await run('model','worker','--task',task.id)).stdout);
  assert.equal(switched.task.status,'waiting_input');assert.equal(switched.task.model,'small');
  const observation=await run('watch',task.id);assert.match(observation.stdout,/\[Deng model\] worker \/ small \(offline\)/);
  await run('resume',task.id);await until(()=>host.engine.get(task.id).status==='completed');
  const doctor=JSON.parse((await run('doctor')).stdout);assert.equal(doctor.model_info.model,'large');
});

test('terminal model menu accepts a numbered profile without making model calls',async t=>{
  const{path,config}=await environment(t,{models});const host=await startHost(config);t.after(()=>host.close());
  // System Python is used only by this macOS integration test to provide a real PTY.
  const program=`import os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen([sys.argv[1], sys.argv[2], 'model', '--config', sys.argv[3]], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b''
sent = False
deadline = time.monotonic() + 12
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try: data = os.read(master, 65536)
            except OSError: break
            if not data: break
            output += data
            if not sent and b'empty cancels' in output:
                os.write(master, b'2\\n')
                sent = True
        elif child.poll() is not None: break
    # PTY EOF can arrive just before the process exit becomes visible to poll().
    # Keep the original deadline while waiting for that final process state.
    try:
        status = child.wait(timeout=max(0.1, deadline-time.monotonic()))
    except subprocess.TimeoutExpired:
        child.kill()
        raise RuntimeError('Model menu timed out')
    sys.stdout.buffer.write(output)
    sys.exit(status)
finally:
    os.close(master)
    if child.poll() is None: child.kill()
`;
  const output=(await invoke('/usr/bin/python3',['-c',program,process.execPath,cli,path],{timeout:15000})).stdout;
  assert.match(output,/1\. worker \/ small/);assert.match(output,/2\. reviewer \/ large/);
  assert.equal(host.engine.models().default.model,'large');assert.equal(host.engine.store.list().length,0);
});

test('updated clients reject an old engine without stopping it; explicit stop-engine still works',async t=>{
  const{path,config}=await environment(t);let shutdowns=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/shutdown'){shutdowns++;res.end(JSON.stringify({stopping:true}));}
    else res.end(JSON.stringify({version:'0.1.0',config_hash:hash(config)}));
  });
  await new Promise(resolve=>server.listen(socketPath(config),resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  await assert.rejects(ensureHost(config),{code:'ENGINE_VERSION_CHANGED'});assert.equal(shutdowns,0);
  const result=await invoke(process.execPath,[cli,'stop-engine','--config',path],{timeout:15000});
  assert.equal(JSON.parse(result.stdout).stopping,true);assert.equal(shutdowns,1);
});
