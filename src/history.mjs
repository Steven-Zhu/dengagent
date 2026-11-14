import {DengError} from './config.mjs';

export function validateHistory(messages){
  let pending=new Set();
  for(const message of messages){
    if(message.role==='toolResult'){
      if(!pending.delete(message.toolCallId))throw new DengError('CONTEXT_PROTOCOL_INVALID','Orphan or duplicate tool result in request history; no model request was sent.');
      continue;
    }
    if(pending.size)throw new DengError('CONTEXT_PROTOCOL_INVALID','Incomplete tool/result group in request history; no model request was sent.');
    if(message.role==='assistant')for(const block of message.content??[]){
      if(block.type!=='toolCall')continue;
      if(!block.id||pending.has(block.id))throw new DengError('CONTEXT_PROTOCOL_INVALID','Missing or repeated tool call ID in request history.');
      pending.add(block.id);
    }
  }
  if(pending.size)throw new DengError('CONTEXT_PROTOCOL_INVALID','Request history ends with pending tool calls.');
}
export function requestStructure(payload){
  const messages=payload.messages??[];
  return {message_count:messages.length,tool_count:payload.tools?.length??0,
    roles:messages.slice(-16).map(m=>m.role),
    assistant_tool_turns:messages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).length,
    tool_results:messages.filter(m=>m.role==='tool').length,
    reasoning_turns:messages.filter(m=>m.role==='assistant'&&typeof m.reasoning_content==='string').length};
}
