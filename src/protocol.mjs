// Detection only. Public model text is never promoted to executable tool calls.
export const WRITE_CHUNK_LIMIT=16000;
export const WRITE_BATCH_LIMIT=64000;
export const protocolMarker=text=>/<[｜|]{1,2}DSML[｜|]{1,2}/i.test(text);
export function responseSummary(message){
  const blocks=message.content??[];
  return {stop_reason:['stop','length','toolUse','error','aborted'].includes(message.stopReason)?message.stopReason:'other',
    text_blocks:blocks.filter(b=>b.type==='text').length,
    tool_calls:blocks.filter(b=>b.type==='toolCall').length,
    protocol_marker:blocks.some(b=>b.type==='text'&&protocolMarker(b.text))};
}

export const recoveryCodes=new Set(['OUTPUT_TRUNCATED','TOOL_PROTOCOL_MISMATCH','MISSING_FINISH_TASK']);
const failureCodes=new Set([...recoveryCodes,'UPSTREAM_HTTP','UPSTREAM_UNCERTAIN','BUDGET_EXCEEDED','CONTEXT_LIMIT','USAGE_UNKNOWN','MISSING_CREDENTIAL','CREDENTIAL_MODE','REPLAY_BLOCKED','STOPPED','NO_PROGRESS','CONTEXT_PROTOCOL_INVALID']);
export function workerFailure(message){
  const code=typeof message==='string'?/^([A-Z_]+):/.exec(message)?.[1]:undefined;
  return failureCodes.has(code)?{code,message:message.slice(0,1000)}:{code:'WORKER_STOPPED',message:'Worker stopped without a valid delivery; inspect the last response diagnostics.'};
}

export function usageBreakdown(usage){
  const settled=(usage.input_tokens??0)+(usage.output_tokens??0);
  const reserved=Math.max(0,(usage.tokens??0)-settled);
  const unknown=Math.min(reserved,usage.unknown_reserved_tokens??(usage.unknown_calls||usage.acknowledged_unknown_calls?reserved:0));
  return {settled_tokens:settled,in_flight_reserved_tokens:reserved-unknown,unknown_reserved_tokens:unknown,accounted_tokens:usage.tokens??0};
}
