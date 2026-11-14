import { Type } from 'typebox';
import { readFile, writeFile, mkdir, rename, readdir, lstat, unlink } from 'node:fs/promises';
import { dirname, relative, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { workspacePath } from './paths.mjs';
import { hash } from './store.mjs';
import { DengError, commandSchema,safeError } from './config.mjs';
import {markProgress} from './guardrails.mjs';
import {fileManifest} from './artifacts.mjs';
import {WRITE_CHUNK_LIMIT,WRITE_BATCH_LIMIT} from './protocol.mjs';

const result=(value,terminate=false,details={})=>({content:[{type:'text',text:JSON.stringify(value)}],details,...(terminate?{terminate:true}:{})});
export function buildTools({config,store,task,runId,signal,runner,onCandidate,onInput}) {
  const chunkLimit=config.tools.write_chunk_chars??WRITE_CHUNK_LIMIT;
  const batchLimit=config.tools.write_batch_chars??WRITE_BATCH_LIMIT;
  const active=()=>{
    signal.throwIfAborted();
    const current=store.get(task.id);
    if(current.status!=='running'||current.run_id!==runId)throw new DengError('STOPPED','Task run is no longer active');
    return current;
  };
  const tool=(name,description,parameters,execute)=>({name,label:name,description,parameters,
    execute:async(id,args,toolSignal)=>{
      active();
      try{return await execute(args,AbortSignal.any([signal,...(toolSignal?[toolSignal]:[])]),id);}
      catch(error){
        if(signal.aborted||toolSignal?.aborted)throw error;
        const problem=safeError(error);
        const hints={WRITE_CHUNK_LIMIT:`Split content into chunks of at most ${chunkLimit} characters. Create with write_file; continue with append_file using the returned sha256. Do not resend oversized content.`,WRITE_BATCH_LIMIT:`Split the batch into calls totaling at most ${batchLimit} characters; each chunk must be at most ${chunkLimit}.`,FILE_CHANGED:'Re-read the current file. Use its new sha256 before retrying; do not overwrite a concurrent change.',FILE_MISSING:'Create the file with write_file before appending.',EDIT_MATCH:'Read the relevant range; old_text must identify exactly one occurrence, including overlaps.',COMMAND_SCOPE:'Use exactly an authorized argv/cwd pair; no command was executed.'};
        return {...result({error:problem,...(hints[problem.code]?{retry_hint:hints[problem.code]}:{})},false,{error:problem}),isError:true};
      }
    }});
  const checkChunk=content=>{
    if(content.length>chunkLimit)throw new DengError('WRITE_CHUNK_LIMIT',`Received ${content.length} characters; limit is ${chunkLimit}. No file was changed. Split content before retrying.`);
  };
  const saveFile=async(args,isEdit,isAppend=false)=>{
    checkChunk(isEdit?args.new_text:args.content);
    const path=await workspacePath(config,task,args.path,true);
    let before,mode=args.executable?0o755:0o644;
    try{before=await readFile(path,'utf8');if(args.executable===undefined)mode=(await lstat(path)).mode&0o777;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(before===undefined&&args.expected_sha256)throw new DengError('FILE_CHANGED','Expected file was deleted; re-read before creating it again');
    if(before!==undefined && (!args.expected_sha256||hash(before)!==args.expected_sha256))throw new DengError('FILE_CHANGED','Read the current file and supply its expected_sha256 before overwriting');
    if(isAppend&&before===undefined)throw new DengError('FILE_MISSING','Create the file with write_file before appending');
    let content=isAppend?before+args.content:args.content;
    if(isEdit){
      const index=before?.indexOf(args.old_text)??-1;
      if(before===undefined||!args.old_text||index<0||before.indexOf(args.old_text,index+1)!==-1)throw new DengError('EDIT_MATCH','old_text must match exactly once, including overlapping occurrences');
      content=before.replace(args.old_text,args.new_text);
    }
    if(Buffer.byteLength(content)>200000)throw new DengError('FILE_SIZE','File output exceeds 200 KB');
    active();await mkdir(dirname(path),{recursive:true});
    const temporary=join(dirname(path),`.deng-write-${randomUUID()}`);
    try{
      await writeFile(temporary,content,{flag:'wx',mode});active();
      await workspacePath(config,task,args.path,true);
      let latest;try{latest=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(latest!==before)throw new DengError('FILE_CHANGED','File changed during write; re-read it before retrying');
      await rename(temporary,path);
    }
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    const current=store.get(task.id);current.changes??={};
    const original=current.changes[args.path];
    current.changes[args.path]={before:original?original.before:before===undefined?null:hash(before),after:hash(content)};
    store.save(current);if(before!==content)markProgress(store,task.id,'file',{path:args.path,sha256:hash(content)});store.event(store.get(task.id),'file.changed',{path:args.path,sha256:hash(content),created:before===undefined});
    return result({path:args.path,sha256:hash(content),bytes:Buffer.byteLength(content)});
  };
  return [
    tool('list_files','List at most 200 immediate entries in a scoped directory. No shell, recursion, symlinks or private paths.',Type.Object({path:Type.String({minLength:1,maxLength:1024})},{additionalProperties:false}),async args=>{
      const directory=await workspacePath(config,task,args.path);
      if(!(await lstat(directory)).isDirectory())throw new DengError('PATH','list_files requires an existing scoped directory');
      const entries=[];
      for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        active();if(item.isSymbolicLink()||['node_modules','dist'].includes(item.name))continue;
        const path=join(args.path,item.name);
        try{await workspacePath(config,task,path);}catch{continue;}
        entries.push({path,type:item.isDirectory()?'directory':item.isFile()?'file':'other'});if(entries.length===201)break;
      }
      return result({entries:entries.slice(0,200),limited:entries.length>200});
    }),
    tool('read_file','Read a scoped UTF-8 file (at most 200 lines and 24000 content characters). Returns sha256, truncation flags and next_start_line; individual lines are capped at 4000 characters.',Type.Object({path:Type.String(),start_line:Type.Optional(Type.Integer({minimum:1})),end_line:Type.Optional(Type.Integer({minimum:1}))},{additionalProperties:false}),async args=>{
      const path=await workspacePath(config,task,args.path);const info=await lstat(path);
      if(!info.isFile()||info.size>1000000)throw new DengError('FILE_SIZE','Read requires a regular file up to 1 MB');
      const text=await readFile(path,'utf8');if(text.includes('\0'))throw new DengError('FILE_BINARY','read_file requires UTF-8 text, not binary data');
      const start=args.start_line??1;if(args.end_line!==undefined&&args.end_line<start)throw new DengError('LINE_RANGE','end_line must be at least start_line');
      const source=text.split('\n'),end=Math.min(args.end_line??start+199,start+199,source.length),lines=[];
      let characters=0,lineTruncated=false;
      for(let i=start-1;i<end;i++){
        const value=source[i].slice(0,4000);if(characters+value.length>24000)break;
        const truncated=value.length<source[i].length;lineTruncated ||= truncated;
        lines.push({line:i+1,text:value,...(truncated?{truncated:true}: {})});characters+=value.length;
      }
      const next=start+lines.length;
      return result({path:args.path,sha256:hash(text),start_line:start,lines,total_lines:source.length,truncated:lineTruncated||next<=end,next_start_line:next<=source.length?next:null});
    }),
    tool('search','Literal text search in scoped files. Skips generated, private and symlink paths; at most 50 matches.',Type.Object({query:Type.String({minLength:1,maxLength:256})},{additionalProperties:false}),async args=>{
      let visited=0,scanned=0;const seen=new Set(),matches=[];
      const walk=async path=>{
        active();if(scanned>=1000||matches.length>=50)return;
        let absolute;try{absolute=await workspacePath(config,task,path);}catch{return;}
        if(seen.has(absolute))return;seen.add(absolute);scanned++;
        let info;try{info=await lstat(absolute);}catch(error){if(error.code==='ENOENT')return;throw error;}
        if(info.isDirectory()){
          for(const item of await readdir(absolute,{withFileTypes:true})){
            if(item.isSymbolicLink()||['node_modules','dist','.data','.dengagent','.git'].includes(item.name))continue;
            await walk(path==='.'?item.name:join(path,item.name));if(scanned>=1000||matches.length>=50)break;
          }
        }else if(info.isFile()&&info.size<200000){
          visited++;const text=await readFile(absolute,'utf8');if(text.includes('\0'))return;
          text.split('\n').forEach((text,index)=>{if(matches.length<50&&text.includes(args.query)){const at=text.indexOf(args.query),start=Math.max(0,at-120);matches.push({path,line:index+1,text:text.slice(start,start+400),column:at+1,truncated:start>0||text.length>400});}});
        }
      };
      for(const root of new Set([...task.spec.scope.read,...task.spec.scope.write]))await walk(root);
      return result({matches,visited_files:visited,scanned_entries:scanned,limited:scanned>=1000||matches.length>=50});
    }),
    tool('write_file',`Create or replace using the current expected_sha256. At most ${chunkLimit} characters per call; continue long files with append_file. Use smaller chunks if output is constrained.`,Type.Object({path:Type.String(),content:Type.String(),expected_sha256:Type.Optional(Type.String()),executable:Type.Optional(Type.Boolean())},{additionalProperties:false}),args=>saveFile(args,false)),
    tool('append_file',`Append at most ${chunkLimit} characters atomically. Requires the current expected_sha256; use the returned new hash for the next chunk.`,Type.Object({path:Type.String(),content:Type.String(),expected_sha256:Type.String()},{additionalProperties:false}),args=>saveFile(args,false,true)),
    tool('edit_file',`Replace one exact occurrence. Replacement is at most ${chunkLimit} characters. Requires expected_sha256 from read_file.`,Type.Object({path:Type.String(),old_text:Type.String({minLength:1}),new_text:Type.String(),expected_sha256:Type.String()},{additionalProperties:false}),args=>saveFile(args,true)),
    tool('write_files',`Write up to 8 scoped files in one call, at most ${chunkLimit} characters each and ${batchLimit} total. All paths/hashes are preflighted; each file commits atomically. Returns explicit partial results if a later file changes. Use current hashes; do not repeat successful entries.`,Type.Object({files:Type.Array(Type.Object({path:Type.String(),content:Type.String(),mode:Type.Optional(Type.Union([Type.Literal('replace'),Type.Literal('append')])),expected_sha256:Type.Optional(Type.String())},{additionalProperties:false}),{minItems:1,maxItems:8})},{additionalProperties:false}),async args=>{
      for(const entry of args.files)checkChunk(entry.content);
      const size=args.files.reduce((n,f)=>n+f.content.length,0);
      if(size>batchLimit)throw new DengError('WRITE_BATCH_LIMIT',`Received ${size} characters; batch limit is ${batchLimit}. No files were changed. Split the batch before retrying.`);
      if(new Set(args.files.map(f=>f.path)).size!==args.files.length)throw new DengError('WRITE_BATCH_DUPLICATE','A batch cannot write the same path twice');
      const canonical=new Set();
      for(const entry of args.files){
        const path=await workspacePath(config,task,entry.path,true);
        if(canonical.has(path))throw new DengError('WRITE_BATCH_DUPLICATE','Batch aliases resolve to the same path');canonical.add(path);
        let before;try{before=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(before===undefined&&entry.expected_sha256)throw new DengError('FILE_CHANGED','Batch expected file was deleted; no files were written');
        if(before!==undefined&&hash(before)!==entry.expected_sha256)throw new DengError('FILE_CHANGED','Batch preflight hash mismatch; no files were written');
        if(entry.mode==='append'&&before===undefined)throw new DengError('FILE_MISSING','Append requires an existing file');
        if(Buffer.byteLength(entry.mode==='append'?before+entry.content:entry.content)>200000)throw new DengError('FILE_SIZE','Batch file would exceed 200 KB');
      }
      const committed=[];
      for(const entry of args.files){
        try{const value=await saveFile(entry,false,entry.mode==='append');committed.push(JSON.parse(value.content[0].text));}
        catch(error){return {...result({committed,error:safeError(error),retry_hint:'Retain committed entries and hashes; re-read remaining files. Do not replay committed appends.'}),isError:true};}
      }
      return result({committed});
    }),
    tool('check_milestone','Run the next immutable milestone checks by name, alone. Does not expand command or filesystem scope.',Type.Object({name:Type.String()},{additionalProperties:false}),async args=>{
      const current=active(),milestones=task.spec.milestones??[],pending=milestones.find(m=>!(current.milestones?.[m.name]?.passed||current.milestones?.[m.name]?.passed_once));
      const next=milestones.find(m=>m.name===args.name);
      if(!next||(pending?.name!==args.name&&!(current.milestones?.[args.name]?.passed||current.milestones?.[args.name]?.passed_once)))throw new DengError('MILESTONE_ORDER',`Next milestone: ${pending?.name??'none; all passed'}. Only the next pending milestone or an already-passed milestone may be checked.`);
      const checks=[];store.event(current,'milestone.started',{name:next.name});
      for(const path of next.required_files){
        try{const absolute=await workspacePath(config,task,path);checks.push({type:'file',path,passed:(await lstat(absolute)).isFile()});}
        catch{checks.push({type:'file',path,passed:false});}
      }
      for(const command of next.commands){
        const value=await runner.run(active(),command,signal,payload=>store.event(active(),'tool.output',{milestone:next.name,...payload}),{acceptance:true});
        checks.push({type:'command',argv:command.argv,cwd:command.cwd,code:value.code,timed_out:value.timed_out,passed:value.code===0&&!value.timed_out&&!value.signal});
      }
      let evidence;try{evidence=await fileManifest(config,task,next.required_files,signal);}catch{}
      const value={passed:checks.every(c=>c.passed),checks,historical:true,checked_at:new Date().toISOString(),artifact_version:evidence?.version,files:evidence?.files??[]};
      const latest=active();latest.milestones??={};
      value.passed_once=value.passed||Boolean(latest.milestones[next.name]?.passed||latest.milestones[next.name]?.passed_once);
      latest.milestone_history??=[];latest.milestone_history.push({name:next.name,...value});
      latest.milestones[next.name]=value;store.save(latest);
      if(value.passed)markProgress(store,task.id,'milestone',{name:next.name});
      store.event(active(),'milestone.completed',{name:next.name,...value});
      return {...result(value),isError:!value.passed};
    }),
    tool('run_command','Run one exact argv/cwd command authorized by the task. No implicit shell. Returns actual exit code and bounded output.',Type.Object({argv:Type.Array(Type.String(),{minItems:1,maxItems:100}),cwd:Type.Optional(Type.String()),timeout_ms:Type.Optional(Type.Integer({minimum:100,maximum:3600000})),replay_safe:Type.Optional(Type.Boolean())},{additionalProperties:false}),async(args,combined,id)=>{
      const command=commandSchema.parse(args);
      const metadata=value=>({command_code:value.code,signal:value.signal,timed_out:value.timed_out,truncated:value.truncated,executed:value.executed??true,replay_safe:value.replay_safe===true,timeout_ms:value.timeout_ms,operation_id:value.operation_id});
      const value=await runner.run(active(),command,combined,payload=>store.event(store.get(task.id),'tool.output',{tool_call_id:id,...payload}),
        {call_id:id,onExit:value=>store.event(store.get(task.id),'command.completed',{tool_call_id:id,...metadata(value)})});
      if(value.code===0&&!value.timed_out&&!value.signal)markProgress(store,task.id,'command',{command,output:hash(value.output??'')});
      return {...result(value,false,{command:metadata(value)}),isError:value.code!==0||value.timed_out||Boolean(value.signal)};
    }),
    tool('finish_task','Submit a candidate delivery, alone. Deng executes fixed acceptance checks before task completion.',Type.Object({summary:Type.String({minLength:1,maxLength:4000}),output:Type.Optional(Type.Unknown()),limitations:Type.Optional(Type.Array(Type.String({maxLength:1000}),{maxItems:20}))},{additionalProperties:false}),async args=>{
      const current=active();
      if((task.spec.milestones??[]).some(m=>!(current.milestones?.[m.name]?.passed||current.milestones?.[m.name]?.passed_once)))throw new DengError('MILESTONE_REQUIRED','Complete all declared milestones in order before finish_task.');
      onCandidate(args);return result({submitted:true},true);
    }),
    tool('request_input','Stop and request missing information or a decision from the user/main agent. Include a concise question and completed work.',Type.Object({question:Type.String({minLength:1,maxLength:4000}),context:Type.Optional(Type.String({maxLength:4000}))},{additionalProperties:false}),async args=>{
      active();onInput(args);return result({waiting_input:true},true);
    }),
  ];
}
