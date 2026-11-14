import { mkdtemp,writeFile,mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=await mkdtemp(join(tmpdir(),'deng-demo-'));await mkdir(join(root,'src'));await mkdir(join(root,'test'));
const config=join(root,'config.json'),task=join(root,'task.json');
await writeFile(config,JSON.stringify({schema_version:'0.1',workspace_root:root,provider:'offline',models:{default:'worker',profiles:{worker:{base_url:'https://example.invalid/v1',model:'offline-fixture'}}},tools:{isolation:process.platform==='darwin'?'macos':'host'}}));
await writeFile(join(root,'test','sum.test.mjs'),`import assert from 'node:assert/strict';import {sum} from '../src/sum.mjs';assert.equal(sum(20,22),42);`);
const command={argv:['node','--test','test/sum.test.mjs'],cwd:'.'};
await writeFile(task,JSON.stringify({goal:'OFFLINE fixture: implement sum and pass the immutable test',scope:{read:['.'],write:['src'],commands:[command]},acceptance:{commands:[command],required_files:['src/sum.mjs']},offline_script:[{name:'write_file',arguments:{path:'src/sum.mjs',content:'export const sum=(a,b)=>a+b;\n'}},{name:'finish_task',arguments:{summary:'OFFLINE fixture delivered a real file and executed a real test',output:{file:'src/sum.mjs'},limitations:['Deterministic fixture, not model quality or savings evidence']}}]}));
const cli=fileURLToPath(new URL('../bin/deng.mjs',import.meta.url));
async function invoke(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
try{process.stdout.write(`OFFLINE DEMO — no model calls. Workspace: ${root}\n`);process.exitCode=await invoke(['run','--config',config,'--task',task,'--watch']);}
finally{await invoke(['stop-engine','--config',config]);process.stdout.write(`Demo artifacts retained at ${root}\n`);}
