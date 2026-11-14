// Public console snapshots only: provider credentials and conversation checkpoints never leave the host.
export function publicTask(task){
  if(!task)return null;
  const {id,status,revision,goal,model_info,usage,usage_accounting,budget,changes,acceptance,error,result_summary,input_required,last_failure_reason,last_model_response,progress_guard,milestones,recovery_mode,phase,unknown_command_count,delivery}=task;
  return {id,status,revision,goal,model_info,usage,usage_accounting,budget,changes,acceptance,error,result_summary,input_required,last_failure_reason,last_model_response,progress_guard,milestones,recovery_mode,phase,unknown_command_count,delivery:delivery?{id:delivery.id,file_count:delivery.file_count??delivery.files?.length??0,quality_scope:delivery.quality_scope,checked_at:delivery.checked_at}:undefined};
}

export function liveStream(engine,req,res,{touch=()=>{}}={}){
  const url=new URL(req.url,'http://localhost');
  const fixed=url.searchParams.get('task');
  if(fixed)engine.get(fixed);
  let taskId=null,after=0,blocked=false,pending=false,closed=false;
  const cursor=req.headers['last-event-id']||url.searchParams.get('cursor')||'';
  const match=/^([a-f0-9-]{36}):(\d+)$/.exec(cursor);
  if(cursor&&!match)throw new Error('Invalid stream cursor');
  if(match){taskId=match[1];after=Number(match[2]);if(!Number.isSafeInteger(after))throw new Error('Invalid stream cursor');}
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'});
  res.flushHeaders();
  const flush=()=>{
    pending=false;if(closed||blocked)return;
    try{
      touch();const latest=fixed?engine.get(fixed):engine.store.list().at(-1);
      const task=latest?publicTask(fixed?latest:engine.get(latest.id)):null;
      if(task?.id!==taskId){taskId=task?.id??null;after=0;}
      const events=task?engine.store.events(taskId,after,100):[];
      after=events.at(-1)?.seq??after;
      const catalog=engine.models();
      const frame={task,events,next_seq:after,models:{default:catalog.default,default_error:catalog.default_error,profiles:catalog.profiles,choices:catalog.choices}};
      blocked=!res.write(`id: ${taskId?taskId+':'+after:''}\nevent: snapshot\ndata: ${JSON.stringify(frame)}\n\n`);
      if(events.length===100&&!blocked)schedule();
    }catch{res.end();cleanup();}
  };
  const schedule=()=>{if(!pending&&!closed){pending=true;queueMicrotask(flush);}};
  const drained=()=>{blocked=false;schedule();};
  const cleanup=()=>{if(closed)return;closed=true;clearInterval(heartbeat);engine.store.updates.off('change',schedule);res.off('drain',drained);};
  const heartbeat=setInterval(()=>{if(!blocked&&!closed){touch();blocked=!res.write(': keepalive\n\n');}},15000);heartbeat.unref();
  engine.store.updates.on('change',schedule);res.on('drain',drained);res.once('close',cleanup);flush();
}
