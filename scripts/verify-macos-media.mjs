import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {normalizeConfig} from '../src/config.mjs';
import {ProcessRunner} from '../src/process.mjs';
import {VERSION} from '../src/version.mjs';

const {values}=parseArgs({options:{out:{type:'string'}}});
if(process.platform!=='darwin')throw new Error('This opt-in native-media check requires macOS.');
const root=await mkdtemp(join(tmpdir(),'deng-native-media-'));
let report;
try{
 await mkdir(join(root,'work'));
 const source=new URL('../test/fixtures/native-media.swift',import.meta.url);
 await writeFile(join(root,'work/probe.swift'),await readFile(source));
 const {stdout}=await promisify(execFile)('/usr/bin/xcrun',['--find','swift']);
 const direct=stdout.trim();if(!direct.startsWith('/')||!direct.endsWith('/swift'))throw new Error('No trusted local Swift toolchain found');
 const config=await normalizeConfig({workspace_root:root,provider:'offline',models:{default:'fixture',profiles:{fixture:{base_url:'https://example.invalid/v1',model:'offline'}}},tools:{isolation:'macos',command_timeout_ms:120000}},join(root,'config.json'));
 const runner=new ProcessRunner(config),checks=[];
 for(const [name,executable]of [['system-shim','/usr/bin/swift'],['toolchain',direct]]){
  for(const phase of ['imports','png','mp4']){
   const command={argv:[executable,'-module-cache-path',join(root,'work/module-cache'),'probe.swift',phase,name],cwd:'work'};
   const task={id:randomUUID(),spec:{scope:{read:['work'],write:['work'],commands:[command]},acceptance:{commands:[]}}};
   const result=await runner.run(task,command,new AbortController().signal);
   const passed=result.code===0&&!result.timed_out&&result.output.includes('PASS '+phase);
   checks.push({launcher:name,phase,passed,command_code:result.code,signal:result.signal,timed_out:result.timed_out,xcrun_cache_warning:/couldn.t create cache file|xcrun_db/.test(result.output),...(!passed?{failure_excerpt:result.output.replaceAll(root,'<temporary-project>').slice(-3000)}:{})});
  }
 }
 report={version:VERSION,platform:process.platform,arch:process.arch,node:process.version,passed:checks.every(c=>c.passed),model_calls:0,scope:'Disposable same-sandbox framework import, PNG readback and two-frame H.264 finalize/decode; no original animation work.',checks};
 if(values.out)await writeFile(values.out,JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(!report.passed)process.exitCode=1;
}finally{await rm(root,{recursive:true,force:true});}
