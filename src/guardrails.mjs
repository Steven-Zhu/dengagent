import {DengError} from './config.mjs';
import {hash} from './store.mjs';
export function markProgress(store,id,kind,evidence){
 const task=store.get(id),key=hash({kind,evidence});task.progress??={revision:0,seen:[]};if(task.progress.seen.includes(key))return;
 task.progress.revision++;task.progress.seen=[...task.progress.seen,key].slice(-200);task.discovery={used:0,revision:task.discovery?.revision??0,seen:[]};task.tool_failures=[];store.save(task);
}
export function recordToolOutcome(store,id,{toolCall,result,isError},discoveryLimit=12){
 const task=store.get(id);let value;try{value=JSON.parse(result.content?.find(b=>b.type==='text')?.text??'null');}catch{}
 if(isError){
  const code=result.details?.error?.code??value?.error?.code??'TOOL_ERROR',key=hash({name:toolCall.name,code,args:toolCall.arguments});
  task.tool_failures=[...(task.tool_failures??[]),{key,tool:toolCall.name,code}].slice(-20);
 }else if(['read_file','list_files','search'].includes(toolCall.name)){
  const key=hash({name:toolCall.name,args:toolCall.arguments,evidence:value});task.discovery??={used:0,revision:0,seen:[]};
  if(task.discovery.used<discoveryLimit&&!task.discovery.seen.includes(key)){task.discovery.used++;task.discovery.revision++;task.discovery.seen.push(key);}
 }
 store.save(task);
}
export function checkProgress(task){
 const guard=task.progress_guard??{consecutive:0,revision:0,discovery_revision:0},call=task.last_model_response?.call_id;
 const failures=task.tool_failures??[],last=failures.at(-1),limit=task.spec.budget.max_no_progress_calls??4;
 if(last&&failures.filter(f=>f.key===last.key).length>=limit)throw new DengError('NO_PROGRESS',`Repeated ${last.tool} failure (${last.code}) without a successful change. Use the error recovery hint; do not resend identical arguments.`);
 if(call&&call!==guard.observed_call){const revision=task.progress?.revision??0,discovery=task.discovery?.revision??0;guard.consecutive=revision>guard.revision||discovery>(guard.discovery_revision??0)?0:guard.consecutive+1;guard.revision=revision;guard.discovery_revision=discovery;guard.observed_call=call;}
 task.progress_guard=guard;
 if(guard.consecutive>=limit)throw new DengError('NO_PROGRESS',`Stopped after ${guard.consecutive} repeated turns without new executable evidence or bounded discovery. Narrow the next step before resuming.`);
}
export function conciseToolErrors(messages){return messages.map(message=>{if(message.role!=='toolResult'||!message.isError)return message;return{...message,content:message.content.map(block=>{if(block.type!=='text')return block;const text=block.text.split(/\n\nReceived arguments:/)[0];return{...block,text:text.slice(0,600)+(text.length>600?'…':'')};})};});}
export function boundedToolResult(result,isError){if(!isError)return undefined;const message=conciseToolErrors([{role:'toolResult',isError:true,content:result.content}])[0];return{content:message.content};}
