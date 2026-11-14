import {hash} from './store.mjs';

// MCP projections only. CLI, console and the durable ledger keep their views.
export const SUMMARY_LIMIT=4096;
const short=(value,limit=240)=>{
 if(value==null)return null;
 let text=String(value);if(Buffer.byteLength(text)<=limit)return text;
 return Buffer.from(text).subarray(0,limit-3).toString('utf8').replace(/\uFFFD$/,'')+'…';
};
const error=value=>value?{code:short(value.code,64),message:short(value.message,380),truncated:Buffer.byteLength(value.message??'')>380}:null;
export function taskSummary(task){
 const checks=task.acceptance?.checks??[];
 const milestones=Object.values(task.milestones??{});
 const result={schema:'deng.task-summary.v1',id:task.id,revision:task.revision,status:task.status,
  model:short(task.model,160),model_info:{profile:short(task.model_info?.profile,80),model:short(task.model_info?.model??task.model,160)},
  phase:task.phase?.name??null,unknown_command_count:task.unknown_command_count??0,delivery:task.delivery?{id:task.delivery.id,file_count:task.delivery.file_count??task.delivery.files?.length??0,quality_scope:task.delivery.quality_scope}:null,
  changed_file_count:Object.keys(task.changes??{}).length,
  checks:{final:task.acceptance?.passed??null,passed:checks.filter(c=>c.passed).length,total:checks.length,milestones_passed:milestones.filter(c=>c.passed||c.passed_once).length},
  usage:task.usage,usage_accounting:task.usage_accounting,budget:task.budget,
  budget_resolution:task.budget_resolution??null,admission:task.last_admission??null,
  error:error(task.error),last_failure:error(task.last_failure_reason),
  input_required:task.input_required?{question:short(task.input_required.question,320)}:null,
  result_summary:task.result_summary?{summary:short(task.result_summary.summary,320)}:null,
  next_action:task.status==='completed'?'read_result':task.status==='budget_exceeded'?'inspect_budget':task.status==='waiting_input'?'inspect_and_clarify':['running','queued'].includes(task.status)?'wait':'inspect_status',
  details_ref:{tool:'get_task_details',task_id:task.id},result_ref:task.result_ref??null};
 // Known schema has bounded scalars; fail closed if a future field breaks it.
 if(Buffer.byteLength(JSON.stringify(result))>SUMMARY_LIMIT)throw new Error('Task summary exceeds its 4096-byte contract');
 return result;
}
export function detailPage(task,{offset=0,limit=4096}={}){
 const text=JSON.stringify(task),content=text.slice(offset,offset+limit);
 return {task_id:task.id,revision:task.revision,sha256:hash(text),format:'json-fragment',offset,next_offset:offset+content.length<text.length?offset+content.length:null,content};
}
export function compactResponse(value){
 if(!value||typeof value!=='object')return value;
 if(value.id&&value.status&&value.usage)return taskSummary(value);
 if(value.task?.id)return {...value,task:taskSummary(value.task)};
 if(value.notification){
  const n=value.notification;
  return {...value,notification:{...n,error:error(n.error),input_required:n.input_required?{question:short(n.input_required.question,320)}:null,result_summary:n.result_summary?{summary:short(n.result_summary.summary,320)}:null}};
 }
 return value;
}
