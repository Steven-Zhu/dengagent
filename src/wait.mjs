import {DengError,stopped} from './config.mjs';

// Wait on store changes; log/text/usage events never wake the supervising model.
export function waitTask(engine,id,{after=0,timeout=25000,signal}={}){
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(timeout)||timeout<0||timeout>25000)
    throw new DengError('CURSOR','Invalid wait cursor or timeout (0..25000 ms)');
  engine.get(id);
  return new Promise((resolve,reject)=>{
    let timer,finished=false;
    const cleanup=()=>{clearTimeout(timer);engine.store.updates.off('task-notification',changed);signal?.removeEventListener('abort',abort);};
    const finish=(timedOut=false)=>{
      if(finished)return;finished=true;cleanup();
      const task=engine.get(id);
      const row=engine.store.db.prepare('SELECT MAX(seq) AS seq FROM events WHERE task_id=?').get(id);
      resolve({task_id:id,cursor:row.seq??0,timed_out:timedOut,
        notification:timedOut?null:{status:task.status,error:task.error??null,input_required:task.input_required??null,result_summary:task.result_summary??null,usage:task.usage,usage_accounting:task.usage_accounting},model_calls:0});
    };
    const changed=event=>{
      if(event&&event.task_id!==id)return;
      if(!stopped(engine.get(id).status))return;
      const row=engine.store.db.prepare("SELECT seq FROM events WHERE task_id=? AND seq>? AND json_extract(body,'$.type') IN ('task.completed','task.failed','task.input_required','task.state_changed') ORDER BY seq DESC LIMIT 1").get(id,after);
      if(row&&stopped(engine.get(id).status))finish();
    };
    const abort=()=>{if(finished)return;finished=true;cleanup();reject(new DengError('STOPPED','Observer disconnected; task execution was not stopped.'));};
    engine.store.updates.on('task-notification',changed);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    timer=setTimeout(()=>finish(true),timeout);
    changed();
  });
}
