import {Worker} from 'node:worker_threads';
import {DengError} from './config.mjs';
// Standard workers provide a fresh ESM graph for each MCP operation. No custom
// MCP transport/retry loop: the SDK owns that protocol and the engine owns tasks.
export function freshService(message){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./service-worker.mjs',import.meta.url),{workerData:message,execArgv:[]});let finished=false;
 const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);};
 const timer=setTimeout(()=>finish(new DengError('LOCAL_SERVICE_TIMEOUT','Deng service did not reply. No retry was issued; inspect the original task/request_id before submitting again.')),60000);timer.unref();
 worker.once('message',data=>finish(data.error?new DengError(data.error.code,data.error.message):null,data.value));
 worker.once('error',()=>finish(new DengError('CLIENT_RELOAD_REQUIRED','Deng service could not load. Finish installation and refresh the Deng connection; active tasks were not stopped.')));
 worker.once('exit',code=>{if(!finished)finish(new DengError('LOCAL_SERVICE_EXIT','Deng service exited without a reply; inspect the original task before retrying.'));});
});}
