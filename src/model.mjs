import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { randomUUID } from 'node:crypto';
import { DengError, getCredential } from './config.mjs';
import { modelInfo } from './selection.mjs';
import {responseSummary} from './protocol.mjs';
import {checkProgress} from './guardrails.mjs';
import {requestStructure} from './history.mjs';
import {applyReasoning,reasoningSettings} from './model-options.mjs';

export const piModel = profile => ({
  id:profile.model,name:profile.model,provider:'deng-configured',api:'openai-completions',baseUrl:profile.base_url,
  reasoning:profile.thinking==='enabled',input:['text'],
  cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:profile.context_window,maxTokens:profile.max_output_tokens,
  compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,
    requiresReasoningContentOnAssistantMessages:profile.thinking==='enabled'&&reasoningSettings(profile).reasoning_format==='deepseek',
    supportsUsageInStreaming:profile.compat.include_usage,maxTokensField:profile.compat.max_tokens_field},
});
const emptyMessage=profile=>({role:'assistant',content:[],api:'openai-completions',provider:'deng-configured',model:profile.model,timestamp:Date.now(),
  usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop'});

// Explicit deterministic fixture. Never selected as fallback for a live failure.
function offlineStream(profile,context,script,signal) {
  const output=new AssistantMessageEventStream();
  queueMicrotask(async()=>{
    const message=emptyMessage(profile);
    try {
      signal.throwIfAborted();
      const done=context.messages.filter(message=>message.role==='toolResult').length;
      const action=script[done]??{name:'finish_task',arguments:{summary:'OFFLINE fixture completed; not a model quality measurement',output:{offline:true}}};
      output.push({type:'start',partial:message});
      message.content.push({type:'text',text:''});
      output.push({type:'text_start',contentIndex:0,partial:message});
      for(const delta of ['OFFLINE ','fixture: ',action.name+'\n']) {
        signal.throwIfAborted();message.content[0].text+=delta;
        output.push({type:'text_delta',contentIndex:0,delta,partial:message});
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      output.push({type:'text_end',contentIndex:0,content:message.content[0].text,partial:message});
      message.content.push({type:'toolCall',id:randomUUID(),name:action.name,arguments:action.arguments});
      message.stopReason='toolUse';message.usage.input=100;message.usage.output=50;message.usage.totalTokens=150;
      output.push({type:'done',reason:'toolUse',message});
    }catch{message.stopReason='aborted';message.errorMessage='Offline request stopped';output.push({type:'error',reason:'aborted',error:message});}
  });
  return output;
}

export function controlledStream(config,store,task,runId,signal,{testFetch}={}) {
  return (_model,context,options={})=>{
    const output=new AssistantMessageEventStream();
    void (async()=>{
      let reserved=0,callId,dispatched=false,settled=false,status,requestId;
      let providerTextDeltas=0,providerToolDeltas=0,providerFinishReason;
      const profile={...task.profile,...(store.get(task.id).recovery_mode?{reasoning_effort:'low'}:{})};
      const fail=error=>{
        const message=emptyMessage(profile);message.stopReason=signal.aborted?'aborted':'error';
        message.errorMessage=error instanceof DengError?`${error.code}: ${error.message}`:'Model request failed; usage may be unknown';
        output.push({type:'error',reason:message.stopReason,error:message});
      };
      try {
        const current=store.get(task.id);
        if(current.status!=='running'||current.run_id!==runId)throw new DengError('STOPPED','Task is not active');
        signal.throwIfAborted();
        try{checkProgress(current);}finally{store.save(current);}
        if(current.usage.unknown_calls)throw new DengError('USAGE_UNKNOWN','Reconcile unknown usage before new requests, or explicitly resume with the reservation retained');
        if(current.spec.budget.max_model_calls!==null&&current.usage.model_calls>=current.spec.budget.max_model_calls){const e=new DengError('BUDGET_EXCEEDED','Task model-call allowance exhausted; no request was sent');e.admission={reason:'model_call_limit',calls_used:current.usage.model_calls,calls_limit:current.spec.budget.max_model_calls};throw e;}
        const prepared={context,inputReserve:Buffer.byteLength(JSON.stringify(context))+2048};
        const inputReserve=prepared.inputReserve;
        const remaining=current.spec.budget.max_total_tokens-current.usage.tokens-inputReserve;
        const cap=Math.min(profile.max_output_tokens,current.recovery_mode?8192:profile.max_output_tokens,remaining,profile.context_window-inputReserve);
        if(current.spec.budget.max_model_calls!==null&&current.usage.model_calls>=current.spec.budget.max_model_calls)throw new DengError('BUDGET_EXCEEDED','Task model-call allowance exhausted; no request was sent');
        if(cap<128)throw new DengError(profile.context_window-inputReserve<128?'CONTEXT_LIMIT':'BUDGET_EXCEEDED','The next request cannot fit the remaining context or task allowance; no request was sent');
        const key=(task.provider_mode??config.provider)==='offline'?undefined:await getCredential(profile);
        const latest=store.get(task.id);
        if(signal.aborted||latest.status!=='running'||latest.run_id!==runId)throw new DengError('STOPPED','Task stopped before model dispatch');
        callId=randomUUID();reserved=inputReserve+cap;
        const info=modelInfo(profile,task.profile_name,task.provider_mode??config.provider);
        store.reserveModel(task.id,callId,reserved,info);
        if((task.provider_mode??config.provider)==='offline')store.dispatchModel(task.id,callId);
        const combined=AbortSignal.any([signal,...(options.signal?[options.signal]:[]),AbortSignal.timeout(profile.timeout_ms)]);
        let nativeUsage,reportedModel;
        const upstream=(task.provider_mode??config.provider)==='offline' ? offlineStream(profile,context,task.spec.offline_script??[],combined) : stream(piModel(profile),prepared.context,{
          apiKey:key,signal:combined,maxTokens:cap,maxRetries:0,env:{},
          onPayload:payload=>{
            const selected=applyReasoning(payload,profile);
            store.event(store.get(task.id),'model.request',{call_id:callId,...requestStructure(selected),output_token_limit:cap,wire_reasoning_effort:reasoningSettings(profile).wire_reasoning_effort});
            return selected;
          },
          onProviderStreamEvent:data=>{
            if(typeof data?.model==='string'&&data.model.length<=256&&!/\s/.test(data.model))reportedModel=data.model;
            if(data?.usage&&Number.isSafeInteger(data.usage.prompt_tokens)&&Number.isSafeInteger(data.usage.completion_tokens))nativeUsage=data.usage;
            for(const choice of data?.choices??[]){
              if(typeof choice.delta?.content==='string')providerTextDeltas++;
              if(Array.isArray(choice.delta?.tool_calls))providerToolDeltas+=choice.delta.tool_calls.length;
              if(['stop','length','tool_calls','function_call','content_filter'].includes(choice.finish_reason))providerFinishReason=choice.finish_reason;
            }
          },
          fetch:async(input,init)=>{
            if(dispatched)throw new DengError('REPLAY_BLOCKED','Hidden provider retry blocked');
            store.dispatchModel(task.id,callId);dispatched=true;
            const response=await (testFetch??fetch)(input,{...init,redirect:'error'});status=response.status;
            for(const name of ['x-request-id','x-tc-requestid','request-id']){
              const value=response.headers.get(name);
              // Correlation identifiers only, never arbitrary headers/error bodies.
              if(value&&/^(?:[a-f0-9]{16,64}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(value)){requestId=value;break;}
            }
            // Do not expose arbitrary provider error bodies, which may contain request details.
            if(!response.ok){await response.body?.cancel();return new Response('{}',{status:response.status,headers:{'content-type':'application/json'}});}
            return response;
          },
        });
        for await(const event of upstream) {
          if(event.type==='done'||event.type==='error') {
            const message=event.type==='done'?event.message:event.error;
            const usage=(task.provider_mode??config.provider)==='offline'?{prompt_tokens:100,completion_tokens:50}:nativeUsage;
            let now=store.get(task.id);
            const diagnostic={call_id:callId,http_status:status??null,...(requestId?{request_id:requestId}:{}),
              ...responseSummary(message),provider_finish_reason:providerFinishReason??null,
              provider_text_deltas:providerTextDeltas,provider_tool_deltas:providerToolDeltas,output_token_limit:cap,
              thinking:reasoningSettings(profile).thinking,requested_reasoning_effort:profile.reasoning_effort??null,
              wire_reasoning_effort:reasoningSettings(profile).wire_reasoning_effort,request_timeout_ms:profile.timeout_ms};
            store.transaction(()=>{
            const operation=store.operation(callId);operation.http_status=status??null;if(requestId)operation.provider_request_id=requestId;store.saveOperation(operation);
            now.last_model_response=diagnostic;
            store.save(now);store.event(now,'model.response',diagnostic);
            if(reportedModel){now.last_reported_model={model:reportedModel,requested_model:profile.model,call_id:callId,run_id:runId};store.save(now);}
            if(usage&&usage.prompt_tokens>=0&&usage.completion_tokens>=0) {
              now=store.settleModel(task.id,callId,usage,reportedModel);settled=true;
            }else{now=store.unknownModel(task.id,callId);settled=true;}
            });
            if(event.type==='error') {
              message.errorMessage=status&&status>=400?`UPSTREAM_HTTP: Model service returned HTTP ${status}`:'UPSTREAM_UNCERTAIN: Model response did not finish; inspect usage';
            }
            if(event.type==='done'&&now.usage.tokens>now.spec.budget.max_total_tokens)throw new DengError('BUDGET_EXCEEDED','Provider usage exceeded the reserved budget');
            if(event.type==='done'&&message.stopReason==='length')throw new DengError('OUTPUT_TRUNCATED','Incomplete model output cannot execute tools');
            if(event.type==='done'&&diagnostic.protocol_marker)throw new DengError('TOOL_PROTOCOL_MISMATCH','Tool protocol markup arrived as ordinary text; no tool in this response was executed.');
            signal.throwIfAborted();
            output.push(event);
          }else if(!signal.aborted) output.push(event);
        }
        if(!settled)throw new DengError('UPSTREAM_UNCERTAIN','Model stream ended without a terminal result; usage remains reserved');
      } catch(error) {
        if(error.admission){const now=store.get(task.id);now.last_admission=error.admission;store.save(now);store.event(now,'model.admission_rejected',error.admission);}
        if(callId&&!settled)store.unknownModel(task.id,callId,'request_did_not_settle');
        fail(error);
      }
    })();
    return output;
  };
}
